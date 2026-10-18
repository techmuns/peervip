// Manual industry builder. Only explicitly selected players are fetched.
// Browser-local drafts deliberately never dispatch the AI industry research workflow.
import { esc } from './format.js';
import { loadReport } from './data.js';
import { renderDashboard } from './dashboard.js';

const STORE = 'peervip:manual:v1';
const read = () => { try { const data = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(data) ? data : []; } catch (_) { return []; } };
const save = (items) => { localStorage.setItem(STORE, JSON.stringify(items)); };
const id = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
const norm = (s) => String(s || '').trim().toLowerCase();
const cls = 'rounded-xl ring-1 ring-slate-200 px-3 py-2 text-sm bg-white';
const button = 'rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-slate-200 bg-white hover:bg-slate-50';
const reportSlug = (x) => 'manual-' + x.id;

function write(items, onError) {
  try { save(items); return true; } catch (e) { onError('Cannot save in this browser: ' + e.message); return false; }
}
const distinct = (x) => [...new Set(x)];
const names = (x) => distinct(x.nodes.flatMap((n) => n.players.map((p) => p.name)));

export function renderManual(root, onExit) {
  let active = null;
  let items = read();
  // Stage-specific selections live outside DOM render functions.
  const pending = new Map();
  const pickerActions = new Map();
  const frame = () => {
    root.innerHTML = `<div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div class="flex justify-between gap-3 items-center mb-7">
        <div><div class="text-sm text-slate-500 font-semibold">PeerVIP / Manual</div><h1 class="font-display text-3xl font-extrabold">My industries</h1></div>
        <button data-exit class="${button}">← Automatic mode</button>
      </div>
      <p class="text-slate-500 mb-5">You decide the industry, every value-chain stage and every company. Only the companies you choose get financial data from Screener. No AI industry or player discovery runs.</p>
      <div class="pv-card p-4 mb-5"><form data-new class="flex flex-col sm:flex-row gap-2">
        <input required maxlength="120" name="industry" class="${cls} flex-1" placeholder="New industry name (e.g. Indian Defence)" aria-label="Industry name">
        <button class="rounded-xl brand-gradient text-white px-5 py-2 font-semibold">+ Create industry</button></form></div>
      <div data-notice role="status" class="text-sm text-rose-600 mb-3"></div>
      <div data-list class="grid sm:grid-cols-2 gap-3"></div>
      <div class="mt-5 text-xs text-slate-500">Drafts are stored in this browser only. Export a JSON backup to move them to another device or avoid loss from clearing browser storage.</div>
      <div class="flex gap-2 mt-3 flex-wrap"><button data-export class="${button}">Export backup</button><label class="${button} cursor-pointer">Import backup<input data-import type="file" accept=".json,application/json" hidden></label></div>
    </div>`;
    root.querySelector('[data-exit]').onclick = onExit;
    root.querySelector('[data-new]').onsubmit = (event) => {
      event.preventDefault();
      const name = event.currentTarget.elements.industry.value.trim();
      if (!name) return;
      if (items.some((a) => norm(a.name) === norm(name))) return notice('An industry with that name already exists.');
      const x = { id:id(), name, nodes:[], created_at:new Date().toISOString() };
      items.unshift(x); if (write(items, notice)) open(x.id);
    };
    root.querySelector('[data-export]').onclick = () => {
      const blob = new Blob([JSON.stringify({ version:1, industries:items }, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='peervip-manual-backup.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    root.querySelector('[data-import]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.version !== 1 || !Array.isArray(data.industries)) throw new Error('Unsupported backup file.');
        if (!confirm('Replace local manual industries with this backup?')) return;
        const restored = data.industries;
        if (restored.some((x) => !x || typeof x.id !== 'string' || typeof x.name !== 'string' || !Array.isArray(x.nodes) || x.nodes.some(n => !n || !Array.isArray(n.players)))) throw new Error('Invalid industry records.');
        if (write(restored, notice)) { items=restored; frame(); }
      } catch (err) { notice('Import failed: ' + err.message); }
    };
    const list = root.querySelector('[data-list]');
    list.innerHTML = items.length ? items.map((x) => `<button data-open="${esc(x.id)}" class="pv-card p-5 text-left hover:ring-2 hover:ring-indigo-200">
      <div class="text-lg font-extrabold text-slate-800">${esc(x.name)}</div>
      <div class="text-xs text-slate-500 mt-2">${x.nodes.length} stages · ${names(x).length} players</div></button>`).join('') : '<div class="text-slate-400 text-sm">No manually created industries yet.</div>';
    list.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => open(b.dataset.open));
  };
  function notice(s) { const n=root.querySelector('[data-notice]'); if (n) n.textContent=s; else alert(s); }
  const persist = () => write(items, notice);
  function open(industryId) {
    active = items.find((x) => x.id === industryId);
    if (!active) return frame();
    root.innerHTML = `<div class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div class="flex flex-wrap justify-between gap-3 items-start mb-5">
        <div><button data-back class="text-sm text-indigo-700 mb-2">← My industries</button><h1 class="font-display text-3xl font-extrabold">${esc(active.name)}</h1><p class="text-sm text-slate-500">Manual universe · ${active.nodes.length} stages · ${names(active).length} unique players</p></div>
        <div class="flex flex-wrap gap-2"><button data-compare class="${button}">Financial dashboard</button><button data-rename class="${button}">Rename</button><button data-delete class="${button} text-rose-600">Delete industry</button></div>
      </div>
      <div class="pv-card p-4 mb-6"><h2 class="font-bold mb-2">Add a value-chain stage</h2><form data-node class="flex flex-col sm:flex-row gap-2">
        <input name="stage" required maxlength="120" class="${cls} flex-1" placeholder="e.g. Precision components">
        <button class="rounded-xl brand-gradient text-white px-4 py-2 font-semibold">+ Add stage</button>
      </form></div>
      <div data-notice role="status" class="text-sm text-rose-600 mb-3"></div>
      <div data-nodes class="space-y-4"></div>
      <div class="mt-5 flex gap-3 items-center justify-end"><span data-pending-total class="text-sm text-slate-500"></span><button data-add-all class="rounded-xl brand-gradient text-white px-5 py-2 font-semibold" disabled>Add all selected (0)</button></div>
      <p class="text-xs text-slate-500 mt-6">Financials are consolidated company-level metrics, not revenue attributable to this value-chain stage. Nothing is auto-added or auto-removed.</p>
    </div>`;
    root.querySelector('[data-back]').onclick=frame;
    root.querySelector('[data-compare]').onclick=()=>compare(active);
    root.querySelector('[data-rename]').onclick=()=>{ const name=prompt('Industry name',active.name); if (!name || !name.trim()) return;active.name=name.trim(); if(persist())open(active.id); };
    root.querySelector('[data-delete]').onclick=()=>{if(confirm('Delete this industry and all its manual stages?')){items=items.filter(x=>x.id!==active.id);if(persist())frame();}};
    root.querySelector('[data-node]').onsubmit=(e)=>{e.preventDefault();const title=e.currentTarget.elements.stage.value.trim();if(!title)return;if(active.nodes.some(n=>norm(n.label)===norm(title)))return notice('Stage already exists.');active.nodes.push({id:id(),label:title,players:[]});if(persist())open(active.id);};
    drawNodes();
    const addAll = root.querySelector('[data-add-all]');
    addAll.onclick = async () => {
      addAll.disabled = true;
      const actions = [...pickerActions.values()];
      for (const action of actions) if (action.count()) await action.commit();
      updatePendingTotal();
    };
  }
  function updatePendingTotal() {
    const count = active ? active.nodes.reduce((sum,n)=>sum+(pending.get(n.id)?.size||0),0) : 0;
    const all=root.querySelector('[data-add-all]');
    if(all){all.textContent='Add all selected ('+count+')';all.disabled=!count;}
    const caption=root.querySelector('[data-pending-total]');
    if(caption)caption.textContent=count ? count+' pending across value chain' : 'No pending selections';
  }
  function drawNodes() {
    const el=root.querySelector('[data-nodes]');if(!el)return;
    pickerActions.clear();
    el.innerHTML=active.nodes.length?active.nodes.map((n,i)=>`<section class="pv-card p-4" data-stage="${esc(n.id)}">
      <div class="flex items-center flex-wrap gap-2 mb-3">
      <h3 class="font-display font-extrabold text-lg flex-1">${i+1}. ${esc(n.label)} <span class="font-normal text-xs text-slate-400">(${n.players.length})</span></h3>
      <button data-move="-1" class="${button}" title="Move up" ${i===0?'disabled':''}>↑</button><button data-move="1" class="${button}" title="Move down" ${i===active.nodes.length-1?'disabled':''}>↓</button>
      <button data-rename-stage class="${button}">Rename</button><button data-remove-stage class="${button} text-rose-600">Delete</button></div>
      <div class="overflow-x-auto"><table class="w-full text-sm"><tbody>${n.players.map((p,pi)=>`<tr class="border-t border-slate-100"><td class="py-2 font-semibold">${esc(p.name)}</td><td class="px-2 text-slate-500">${esc(p.ticker||'')}</td><td class="text-right"><button data-refresh-player="${pi}" class="text-indigo-700 px-2">Refresh</button><button data-remove-player="${pi}" class="text-rose-600 px-2">Remove</button></td></tr>`).join('') || '<tr><td class="text-slate-400 py-3">No players yet</td></tr>'}</tbody></table></div>
      <div data-picker class="mt-3 relative">
        <div class="flex flex-col sm:flex-row gap-2">
          <input data-stock-query autocomplete="off" class="${cls} flex-1" placeholder="Search listed companies to select…" aria-label="Search listed companies" aria-expanded="false">
          <button type="button" data-add-selected class="${button}" disabled>+ Add selected (0)</button>
        </div>
        <div data-search-results class="mt-1 rounded-xl ring-1 ring-slate-200 bg-white shadow-lg max-h-64 overflow-y-auto" hidden></div>
        <div data-selected class="flex flex-wrap gap-2 mt-2"></div>
      </div>
      <div data-result class="text-xs text-slate-500 mt-2" role="status"></div>
    </section>`).join(''):'<div class="text-slate-400 text-sm">Add your first stage above. The value chain stays blank until you define it.</div>';
    el.querySelectorAll('[data-stage]').forEach((section)=>{
      const n=active.nodes.find(n=>n.id===section.dataset.stage);
      section.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const i=active.nodes.indexOf(n),j=i+Number(b.dataset.move);if(j<0||j>=active.nodes.length)return;[active.nodes[i],active.nodes[j]]=[active.nodes[j],active.nodes[i]];if(persist())open(active.id);});
      section.querySelector('[data-rename-stage]').onclick=()=>{const label=prompt('Stage name',n.label);if(label&&label.trim()){n.label=label.trim();if(persist())open(active.id);}};
      section.querySelector('[data-remove-stage]').onclick=()=>{if(confirm('Delete stage and its player assignments?')){active.nodes=active.nodes.filter(x=>x.id!==n.id);if(persist())open(active.id);}};
      section.querySelectorAll('[data-remove-player]').forEach(b=>b.onclick=()=>{n.players.splice(Number(b.dataset.removePlayer),1);if(persist())open(active.id);});
      section.querySelectorAll('[data-refresh-player]').forEach(b=>b.onclick=()=>fetchCompany(n,n.players[Number(b.dataset.refreshPlayer)].ticker||n.players[Number(b.dataset.refreshPlayer)].name,section,Number(b.dataset.refreshPlayer)));
      wirePicker(section,n);
    });
    updatePendingTotal();
  }
  function wirePicker(section, node) {
    const input = section.querySelector('[data-stock-query]');
    const menu = section.querySelector('[data-search-results]');
    const chips = section.querySelector('[data-selected]');
    const add = section.querySelector('[data-add-selected]');
    const status = section.querySelector('[data-result]');
    // Selection is local to this stage. It is intentionally NOT deduped across stages.
    if (!pending.has(node.id)) pending.set(node.id, new Map());
    const selected = pending.get(node.id);
    let timer = null, seq = 0, results = [];
    const key = (p) => norm(p.code || p.name);
    const present = (p) => node.players.some(x => norm(x.ticker || x.name) === key(p) || norm(x.name) === norm(p.name));
    const drawSelected = () => {
      chips.innerHTML = [...selected.values()].map(p => `<span class="inline-flex items-center gap-2 rounded-lg bg-indigo-50 text-indigo-800 px-2.5 py-1 text-xs font-semibold">${esc(p.name)}<button type="button" data-unselect="${esc(key(p))}" aria-label="Remove ${esc(p.name)}" class="text-indigo-600">×</button></span>`).join('');
      chips.querySelectorAll('[data-unselect]').forEach(b=>b.onclick=()=>{selected.delete(b.dataset.unselect);drawSelected();drawResults();});
      add.disabled = selected.size === 0;
      add.textContent = '+ Add selected (' + selected.size + ')';
      updatePendingTotal();
    };
    const drawResults = () => {
      menu.hidden = !results.length;
      menu.innerHTML = results.map((p,i) => {
        const checked=selected.has(key(p)), exists=present(p);
        return `<label class="flex items-center gap-3 p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
          <input type="checkbox" data-result-index="${i}" ${checked?'checked':''} ${exists?'disabled':''} class="accent-indigo-600 h-4 w-4">
          <span class="min-w-0 flex-1"><span class="block text-sm font-semibold text-slate-800">${esc(p.name)}</span><span class="block text-xs text-slate-500">${esc([p.code,p.country,p.industry].filter(Boolean).join(' · '))}</span></span>
          ${exists?'<span class="text-xs text-slate-400">Already added</span>':''}
        </label>`;
      }).join('');
      menu.querySelectorAll('[data-result-index]').forEach(box=>box.onchange=()=>{
        const p=results[Number(box.dataset.resultIndex)];
        if(box.checked)selected.set(key(p),p); else selected.delete(key(p));
        drawSelected();
      });
      input.setAttribute('aria-expanded', String(!menu.hidden));
    };
    input.oninput=()=>{
      const q=input.value.trim(); clearTimeout(timer); ++seq;
      if(q.length<2){results=[];drawResults();status.textContent='';return;}
      const requestId=seq;
      timer=setTimeout(async()=>{
        status.textContent='Searching stocks…';
        try {
          const response=await fetch('/api/stock-search?q='+encodeURIComponent(q),{cache:'no-store'});
          const data=await response.json();
          if(requestId!==seq || !section.isConnected)return;
          if(!response.ok || !data.ok)throw Error(data.error || 'Search unavailable');
          results=(data.results||[]).filter(p=>p.code && p.name);
          drawResults();
          status.textContent=results.length?'Tick any number of companies, then click Add selected.':'No stocks found for this search.';
        } catch(e) { if(requestId!==seq)return;results=[];drawResults();status.textContent='Stock search unavailable: '+e.message; }
      },220);
    };
    input.onkeydown=(e)=>{if(e.key==='Escape'){results=[];drawResults();}};
    const commit=async()=>{
      if(!selected.size)return;
      const picks=[...selected.values()];
      add.disabled=true;input.disabled=true;
      let added=0; const errors=[];
      // Fetch each chosen company's financials, without any industry research.
      for(let i=0;i<picks.length;i++){
        const p=picks[i];
        status.textContent='Fetching financials '+(i+1)+'/'+picks.length+': '+p.name;
        try {
          const res=await fetch('/api/peer?name='+encodeURIComponent(p.code),{cache:'no-store'});
          const data=await res.json();
          if(!res.ok || !data.ok || !data.peer || !data.peer.name)throw Error(data.error||'Financial data unavailable');
          const company=data.peer;
          if(!node.players.some(x=>norm(x.ticker||x.name)===norm(company.ticker||company.name))){
            node.players.push(company);added++;
            if(!persist())throw Error('Could not save locally');
          }
          selected.delete(key(p));
        }catch(e){errors.push(p.name+': '+e.message);}
      }
      // Keep all other stages mounted: their unsaved checkboxes must survive.
      // Refresh only this stage after successful additions.
      // Retain failed selections so the user can retry them.
      add.disabled=false;input.disabled=false;drawSelected();drawResults();
      status.textContent=added+' added. '+(errors.length?errors.join(' | '):'');
      if(added) {
        const rows=section.querySelector('tbody');
        if(rows)rows.innerHTML=node.players.map((p,pi)=>`<tr class="border-t border-slate-100"><td class="py-2 font-semibold">${esc(p.name)}</td><td class="px-2 text-slate-500">${esc(p.ticker||'')}</td><td class="text-right"><button data-refresh-player="${pi}" class="text-indigo-700 px-2">Refresh</button><button data-remove-player="${pi}" class="text-rose-600 px-2">Remove</button></td></tr>`).join('');
        section.querySelectorAll('[data-remove-player]').forEach(b=>b.onclick=()=>{node.players.splice(Number(b.dataset.removePlayer),1);if(persist())open(active.id);});
        section.querySelectorAll('[data-refresh-player]').forEach(b=>b.onclick=()=>fetchCompany(node,node.players[Number(b.dataset.refreshPlayer)].ticker||node.players[Number(b.dataset.refreshPlayer)].name,section,Number(b.dataset.refreshPlayer)));
      }
      updatePendingTotal();
    };
    add.onclick=commit;
    pickerActions.set(node.id, {count:()=>selected.size, commit});
    drawSelected();
  }
  async function fetchCompany(node, query, section, replaceAt=null) {
    const status=section.querySelector('[data-result]');
    if(!query)return;
    if(replaceAt===null && node.players.some(p=>norm(p.name)===norm(query)||norm(p.ticker)===norm(query)))return status.textContent='Already in this stage.';
    status.textContent='Fetching financials for ' + query + '…';
    try {
      const res=await fetch('/api/peer?name='+encodeURIComponent(query),{cache:'no-store'});
      const data=await res.json();
      if(!res.ok||!data.ok||!data.peer||!data.peer.name)throw new Error(data.error||'Company not found');
      const peer=data.peer;
      if(replaceAt===null && node.players.some(p=>norm(p.ticker||p.name)===norm(peer.ticker||peer.name))) throw new Error('Already in this stage');
      if(replaceAt===null)node.players.push(peer);else node.players[replaceAt]=peer;
      if(persist())open(active.id);
    }catch(e){status.textContent='Could not add company: '+e.message+'. Check the listing/name and try again.';}
  }
  async function compare(x) {
    root.innerHTML='<div class="max-w-4xl mx-auto p-8 text-slate-500">Preparing the financial comparison…</div>';
    let metrics=[];
    try { metrics=(await loadReport('data-center')).metrics||[]; } catch (_) {}
    if (!metrics.length) {
      root.innerHTML='<div class="max-w-4xl mx-auto p-8">Financial metric definitions could not load. <button data-return class="text-indigo-700 underline">Return to manual industry</button></div>';
      root.querySelector('[data-return]').onclick=()=>open(x.id);return;
    }
    const unique = new Map();
    for(const n of x.nodes)for(const p of n.players) { const key=norm(p.ticker||p.name);if(!unique.has(key))unique.set(key,{...p,value_chain_nodes:[]});unique.get(key).value_chain_nodes.push(n.id); }
    const peers=[...unique.values()];
    const report={
      meta:{slug:reportSlug(x),name:x.name,type:'industry',query:x.name,segment:x.name,generated_at:x.created_at,coverage:{peers_total:peers.length,with_full_financials:peers.filter(p=>p.current&&Object.keys(p.current).length).length}},
      peers:{indian:peers,global:[],private:[]},metrics,
      value_chain:{nodes:x.nodes.map(n=>({key:n.id,label:n.label,use:'Manually defined'})),players:peers},
      sources:peers.filter(p=>p.source).map(p=>p.source)
    };
    renderDashboard(root,report,{onBack:()=>open(x.id),onRefresh:()=>open(x.id)});
    root.querySelectorAll('[data-refresh]').forEach(b=>b.remove());
    const title=root.querySelector('h1');if(title)title.title='Manual universe: edit membership via My Industries';
  }
  frame();
}
