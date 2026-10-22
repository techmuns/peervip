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
  // Ready-made industries bundled with the app (read-only; loaded from /data/manual).
  // They render alongside — and never touch — the browser-local drafts in `items`.
  let builtins = [];
  let onHome = true;
  // Stage-specific selections live outside DOM render functions.
  const pending = new Map();
  const pickerActions = new Map();
  const frame = () => {
    onHome = true;
    root.innerHTML = `<div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div class="flex justify-between gap-3 items-center mb-7">
        <div><div class="text-sm text-slate-500 font-semibold">PeerVIP / Manual</div><h1 class="font-display text-3xl font-extrabold">My industries</h1></div>
        <button data-exit class="${button}">← Automatic mode</button>
      </div>
      <p class="text-slate-500 mb-5">You decide the industry, every value-chain stage and every company. Only the companies you choose get financial data from Screener. No AI industry or player discovery runs.</p>
      <div class="pv-card p-4 mb-5"><form data-new class="flex flex-col sm:flex-row gap-2">
        <input required maxlength="120" name="industry" class="${cls} flex-1" placeholder="New industry name (e.g. Indian Defence)" aria-label="Industry name">
        <button class="rounded-xl brand-gradient text-white px-5 py-2 font-semibold">+ Create industry</button></form>
        <div class="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
          <label class="${button} cursor-pointer">⬆ Import industry from Excel<input data-xlsx type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
          <span class="text-xs text-slate-500">Builds a whole industry from a value-chain workbook — reads the “ALL COMPANIES” sheet and fetches live financials.</span>
        </div></div>
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
    const xlsxInput = root.querySelector('[data-xlsx]');
    if (xlsxInput) xlsxInput.onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(f); };
    const list = root.querySelector('[data-list]');
    const builtinCards = builtins.map((x) => `<button data-open-builtin="${esc(x.id)}" class="pv-card p-5 text-left hover:ring-2 hover:ring-indigo-200">
      <div class="flex items-center gap-2 flex-wrap"><div class="text-lg font-extrabold text-slate-800">${esc(x.name)}</div><span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 rounded-full px-2 py-0.5 uppercase tracking-wide">Built-in</span></div>
      <div class="text-xs text-slate-500 mt-2">${x.nodes.length} stages · ${names(x).length} players</div></button>`).join('');
    const localCards = items.map((x) => `<button data-open="${esc(x.id)}" class="pv-card p-5 text-left hover:ring-2 hover:ring-indigo-200">
      <div class="text-lg font-extrabold text-slate-800">${esc(x.name)}</div>
      <div class="text-xs text-slate-500 mt-2">${x.nodes.length} stages · ${names(x).length} players</div></button>`).join('');
    list.innerHTML = (builtinCards + localCards) || '<div class="text-slate-400 text-sm">No industries yet — create one above.</div>';
    list.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => open(b.dataset.open));
    list.querySelectorAll('[data-open-builtin]').forEach((b) => b.onclick = () => openBuiltin(b.dataset.openBuiltin));
  };
  function notice(s) { const n=root.querySelector('[data-notice]'); if (n) n.textContent=s; else alert(s); }
  const persist = () => write(items, notice);
  function open(industryId) {
    onHome = false;
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
    onHome = false;
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
    const reopen = x.builtin ? () => openBuiltin(x.id) : () => open(x.id);
    renderDashboard(root,report,{onBack:reopen,onRefresh:reopen});
    root.querySelectorAll('[data-refresh]').forEach(b=>b.remove());
    const title=root.querySelector('h1');if(title)title.title='Manual universe: edit membership via My Industries';
  }
  // Load the bundled, ready-made industries. Best-effort: any failure leaves the
  // user's own local industries fully intact (builtins simply don't appear).
  async function loadBuiltins() {
    try {
      const res = await fetch('./data/manual/index.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const manifest = await res.json();
      const metas = Array.isArray(manifest && manifest.industries) ? manifest.industries : [];
      const loaded = await Promise.all(metas.map(async (meta) => {
        try {
          const r = await fetch('./data/manual/' + meta.file, { cache: 'no-cache' });
          if (!r.ok) return null;
          const ind = await r.json();
          if (!ind || typeof ind.name !== 'string' || !Array.isArray(ind.nodes)) return null;
          ind.builtin = true;
          return ind;
        } catch (_) { return null; }
      }));
      return loaded.filter(Boolean);
    } catch (_) { return []; }
  }
  // Read-only detail for a bundled industry. Editing/persistence paths are
  // deliberately absent — builtins are never written to browser storage.
  function openBuiltin(industryId) {
    const b = builtins.find((x) => x.id === industryId);
    if (!b) return frame();
    onHome = false;
    const total = names(b).length;
    root.innerHTML = `<div class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div class="flex flex-wrap justify-between gap-3 items-start mb-5">
        <div><button data-back class="text-sm text-indigo-700 mb-2">← My industries</button>
          <h1 class="font-display text-3xl font-extrabold">${esc(b.name)} <span class="align-middle text-xs font-bold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 rounded-full px-2 py-0.5">Built-in</span></h1>
          <p class="text-sm text-slate-500">Ready-made universe · ${b.nodes.length} stages · ${total} players${b.source ? ' · ' + esc(b.source) : ''}</p></div>
        <div class="flex flex-wrap gap-2"><button data-compare class="rounded-xl brand-gradient text-white px-5 py-2 font-semibold">Financial dashboard</button></div>
      </div>
      <p class="text-sm text-slate-500 mb-4">A ready-made industry that ships with PeerVIP. Open the financial dashboard to benchmark every company, or browse the value-chain stages below. Read-only — your own Manual industries stay separate and fully editable.</p>
      <div class="space-y-4">${b.nodes.map((n, i) => `<section class="pv-card p-4">
        <h3 class="font-display font-extrabold text-lg mb-3">${i + 1}. ${esc(n.label)} <span class="font-normal text-xs text-slate-400">(${n.players.length})</span></h3>
        <div class="overflow-x-auto"><table class="w-full text-sm"><tbody>${n.players.map((p) => `<tr class="border-t border-slate-100"><td class="py-2 font-semibold align-top whitespace-nowrap pr-3">${esc(p.name)}</td><td class="px-2 text-slate-500 align-top whitespace-nowrap">${esc(p.ticker || '—')}</td><td class="px-2 text-slate-500 text-xs align-top">${esc(p.business_model || '')}</td></tr>`).join('')}</tbody></table></div>
      </section>`).join('')}</div>
      <p class="text-xs text-slate-500 mt-6">Financials are consolidated company-level metrics from Screener, not revenue attributable to a single value-chain stage.</p>
    </div>`;
    root.querySelector('[data-back]').onclick = frame;
    root.querySelector('[data-compare]').onclick = () => compare(b);
  }
  // ---- Import a whole industry from a value-chain Excel workbook --------------
  // Fully generic: stage names, stage COUNT, company names and the industry name
  // all come from the file. The ONLY fixed assumption is the column layout of the
  // "ALL COMPANIES" sheet (Company / Ticker / Value-chain stage / What it does …).
  // Produces an ordinary editable local industry — nothing is deployed or shared.
  function cellText(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
      if (v.text != null) return String(v.text);
      if (v.result != null) return String(v.result);
      if (v.hyperlink != null) return String(v.hyperlink);
      return '';
    }
    return String(v);
  }
  function hnorm(s) { return cellText(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function excelNote(cells, col) {
    const get = (k) => (col[k] != null ? cellText(cells[col[k]]).trim() : '');
    const tag = [get('evidence'), get('exposure') && get('exposure') + ' exposure'].filter(Boolean).join(' · ');
    const parts = [];
    if (tag) parts.push('[' + tag + ']');
    if (get('why')) parts.push(get('why'));
    if (get('caution')) parts.push('Caution: ' + get('caution'));
    return parts.join(' ');
  }
  // Map header labels -> column indexes by meaning, so column order can vary too.
  function mapHeader(cells) {
    const col = {};
    for (let c = 1; c < cells.length; c++) {
      const h = hnorm(cells[c]);
      if (!h) continue;
      if (h === 'company' || h === 'company name' || h === 'name') col.company = col.company ?? c;
      else if (/ticker|symbol|code/.test(h)) col.ticker = col.ticker ?? c;
      else if (/value.?chain stage|^stage$|value chain/.test(h)) col.stage = col.stage ?? c;
      else if (/what.*does/.test(h)) col.does = col.does ?? c;
      else if (/why included|source evidence/.test(h)) col.why = col.why ?? c;
      else if (/evidence status/.test(h)) col.evidence = col.evidence ?? c;
      else if (/^exposure$/.test(h)) col.exposure = col.exposure ?? c;
      else if (/caution/.test(h)) col.caution = col.caution ?? c;
    }
    return col;
  }
  async function parseWorkbook(file) {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    // Prefer an "ALL COMPANIES" sheet, else the first sheet that has a usable header.
    const sheets = wb.worksheets.slice().sort((a, b) =>
      (/all companies/i.test(b.name) ? 1 : 0) - (/all companies/i.test(a.name) ? 1 : 0));
    let found = null;
    for (const ws of sheets) {
      const rows = ws.getSheetValues(); // 1-indexed; rows[0] is empty
      for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (!Array.isArray(cells)) continue;
        const col = mapHeader(cells);
        if (col.company != null && col.stage != null) { found = { rows, headerRow: r, col }; break; }
      }
      if (found) break;
    }
    if (!found) throw new Error('No sheet with “Company” and “Value-chain stage” columns was found.');
    const { rows, headerRow, col } = found;
    const stageOrder = [];
    const byStage = new Map();
    for (let r = headerRow + 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!Array.isArray(cells)) continue;
      const name = cellText(cells[col.company]).trim();
      if (!name) continue;
      const stageRaw = (cellText(cells[col.stage]).trim()) || 'Unassigned';
      const label = stageRaw.replace(/^\s*\d+\s*[|\-.:]\s*/, '').trim() || stageRaw; // drop any "01 | " style prefix
      if (!byStage.has(label)) { byStage.set(label, []); stageOrder.push(label); }
      const tickerRaw = col.ticker != null ? cellText(cells[col.ticker]).trim() : '';
      const ticker = /verify|symbol|tbd|^[-—–]$/i.test(tickerRaw) ? '' : tickerRaw;
      byStage.get(label).push({
        name,
        ticker,
        business: col.does != null ? cellText(cells[col.does]).trim() : '',
        note: excelNote(cells, col),
      });
    }
    // Suggested industry name: the "START HERE" banner's first token, else the file name.
    let name = '';
    const startWs = wb.worksheets.find((w) => /start here/i.test(w.name));
    if (startWs) { const v = cellText(startWs.getCell('A1').value).trim(); if (v) name = v.split('|')[0].trim(); }
    if (name) name = name.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
    return { name, stages: stageOrder.map((label) => ({ label, companies: byStage.get(label) })) };
  }
  async function importExcel(file) {
    if (typeof ExcelJS === 'undefined') return notice('Excel library not loaded — check your connection and retry.');
    let parsed;
    try { parsed = await parseWorkbook(file); }
    catch (e) { return notice('Could not read this Excel: ' + e.message); }
    const total = parsed.stages.reduce((s, st) => s + st.companies.length, 0);
    if (!total) return notice('No companies found in this workbook.');
    const fallbackName = (file.name || 'Imported industry').replace(/\.xlsx$/i, '');
    const chosen = prompt('Name this industry (' + parsed.stages.length + ' stages · ' + total + ' companies found)', parsed.name || fallbackName);
    if (chosen === null) return;
    const finalName = chosen.trim() || parsed.name || fallbackName;
    if (items.some((a) => norm(a.name) === norm(finalName)) && !confirm('An industry named “' + finalName + '” already exists. Import as another copy?')) return;
    const industry = { id: id(), name: finalName, created_at: new Date().toISOString(), source: file.name || '', nodes: parsed.stages.map((st) => ({ id: id(), label: st.label, players: [] })) };
    items.unshift(industry);
    if (!persist()) return;
    onHome = false;
    const tasks = [];
    parsed.stages.forEach((st, si) => st.companies.forEach((c) => tasks.push({ node: industry.nodes[si], c })));
    let done = 0, okc = 0;
    const failures = [];
    const progress = (label) => {
      const pct = Math.round((done / total) * 100);
      root.innerHTML = `<div class="max-w-xl mx-auto px-4 py-16 text-center">
        <div class="text-sm text-slate-500 font-semibold mb-1">PeerVIP / Manual</div>
        <h1 class="font-display text-2xl font-extrabold mb-2">Importing ${esc(finalName)}</h1>
        <p class="text-slate-500 mb-5">${industry.nodes.length} stages · ${total} companies · fetching live financials from Screener…</p>
        <div class="h-3 rounded-full bg-slate-100 overflow-hidden ring-1 ring-slate-200"><div class="h-full brand-gradient" style="width:${pct}%"></div></div>
        <p class="text-sm text-slate-500 mt-3">${done} / ${total}${label ? ' · ' + esc(label) : ''}</p>
        <p class="text-xs text-slate-400 mt-1">Please keep this tab open until it finishes.</p>
      </div>`;
    };
    progress('');
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const t = tasks[cursor++];
        const q = (t.c.ticker || t.c.name || '').trim();
        try {
          const res = await fetch('/api/peer?name=' + encodeURIComponent(q), { cache: 'no-store' });
          const data = await res.json();
          if (!res.ok || !data.ok || !data.peer || !data.peer.name) throw new Error((data && data.error) || 'not found');
          const peer = { ...data.peer, added_by: 'user', business_model: t.c.business || data.peer.business_model || '', note: t.c.note || '' };
          if (!t.node.players.some((p) => norm(p.ticker || p.name) === norm(peer.ticker || peer.name))) t.node.players.push(peer);
          okc++;
        } catch (_) {
          t.node.players.push({ name: t.c.name, ticker: '', added_by: 'user', business_model: t.c.business, products: '', note: (t.c.note ? t.c.note + ' ' : '') + '(Not resolvable on Screener — verify symbol.)', source: null, current: {}, series: {} });
          failures.push(t.c.name);
        }
        done++;
        persist();
        progress(t.c.name);
      }
    };
    // A few requests in flight at once — fast, but gentle on Screener.
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
    persist();
    open(industry.id);
    notice(okc + ' of ' + total + ' companies imported with financials' + (failures.length ? ' · ' + failures.length + ' added without (verify symbol): ' + failures.slice(0, 6).join(', ') + (failures.length > 6 ? '…' : '') : '') + '.');
  }
  frame();
  loadBuiltins().then((b) => { if (b.length) { builtins = b; if (onHome) frame(); } });
}
