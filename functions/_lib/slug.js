// functions/_lib/slug.js — slug creation. The /api/research Function OWNS slug
// creation and returns it. MUST stay identical to lib/slug.mjs (the Action's
// copy), so the slug the browser is told matches the file the Action writes.

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'report';
}
