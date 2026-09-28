// lib/slug.mjs — slugify for the pipeline. MUST stay identical to
// functions/_lib/slug.js (the Pages Function that owns slug creation), so a
// query slugified in the browser-facing Function matches the file the Action
// writes. Keep the two in sync.

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')                       // non-alnum -> hyphen
    .replace(/-+/g, '-')                               // collapse
    .replace(/^-|-$/g, '')                             // trim hyphens
    .slice(0, 80) || 'report';
}
