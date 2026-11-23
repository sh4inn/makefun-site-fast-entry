// makefun-site 1.0.0: make.fun's own static site generator, the reference program of site-generator-speed-01.
// build(input) turns one site's sources into its output tree, a JSON object of path -> text. README.md states every
// rule; this file runs them as a pipeline of plugins over one build, in the shape of metalsmith's (each plugin reads
// and writes the build, in order), and lib/markdown.js renders Markdown in the shape of marked's lexer and parser.
// NOTICE credits both upstreams.
//
// The input: { site: { title, base_url, per_page, recent }, templates: { name: source }, files: [{ path, content }] }.
// It reads no clock, no environment, no randomness and no file: the output is a function of the input alone.

import { parseFrontMatter } from './lib/frontmatter.js';
import { renderMarkdown } from './lib/markdown.js';
import { parseTemplate, renderNodes, TemplateError } from './lib/template.js';
import { escapeHtml, longDate, slugify, uniqueSlug } from './lib/text.js';

export const REPORT_FILE = 'build-report.txt';
export const RESERVED = Object.freeze(['posts', 'tags', 'page']);
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function wordsOf(text) { const matches = text.match(/\S+/g); return matches === null ? 0 : matches.length; }
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
function readSources(b) {
  const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }
}
function frontMatter(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) { b.report.push(`refused ${s.path}: ${fm.error}`); continue; }
    s.data = fm.data; s.body = fm.body; s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) { b.report.push(`refused ${s.path}: ${own}/ is the generator's own`); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { b.report.push(`refused ${s.path}: a post needs a date`); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) { b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`); continue; }
    s.layout = layout;
    if (s.data.draft === true) { b.report.push(`draft ${s.path}`); continue; }
    kept.push(s);
  }
  b.sources = kept;
}
function permalinks(b) {
  const taken = new Map();
  const takenIn = (dir) => { if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : [])); return taken.get(dir); };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug; s.outDir = dir === '' ? slug : `${dir}/${slug}`; s.url = `${b.base}/${s.outDir}/`; b.bySource.set(s.path, s);
  }
}
function markdown(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = { link: (target) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#'); const rel = hash === -1 ? target : target.slice(0, hash); const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
      b.broken.add(`broken-link ${s.path} -> ${target}`); return target;
    } };
    const md = renderMarkdown(s.body, env); s.html = md.html; s.toc = md.toc; s.excerpt = md.excerpt;
  }
}
function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug)); b.posts = posts;
  for (let k = 0; k < posts.length; k++) { posts[k].newer = k === 0 ? null : posts[k - 1]; posts[k].older = k === posts.length - 1 ? null : posts[k + 1]; }
}
function tags(b) {
  const bySlug = new Map();
  const ownTags = (s) => { const seen = new Set(); const out = []; for (const name of s.data.tags ?? []) { const slug = slugify(name); if (!seen.has(slug)) { seen.add(slug); out.push(name); } } return out; };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name); let tag = bySlug.get(slug);
      if (tag === undefined) { tag = { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] }; bySlug.set(slug, tag); }
      tag.posts.push(p); p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) if (!s.post) s.tagRefs = ownTags(s).map((name) => { const slug = slugify(name); return bySlug.get(slug) ?? { name, slug, url: '', posts: [] }; });
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}
const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
const tagOf = (b, t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) });
function cardOf(s) { return { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date), summary: s.data.summary ?? '', excerpt: s.excerpt, reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)), tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })) }; }
function pageOf(s) { return { ...cardOf(s), slug: s.slug, content: s.html, toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })), newer: linkOf(s.newer ?? null), older: linkOf(s.older ?? null), is_post: s.post }; }
function layouts(b) {
  b.cards = new Map(b.posts.map((p) => [p, cardOf(p)]));
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
  const ctx = { templates: b.templates, escape: escapeHtml };
  const render = (name, vars) => { const nodes = b.templates.get(name); return nodes === undefined ? null : renderNodes(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0); };
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = b.input.site.per_page; const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', { posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)), pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) } });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) { const html = render('tag', { tag: tagOf(b, t) }); if (html !== null) b.output[`tags/${t.slug}/index.html`] = html; }
  const tagsHtml = render('tags', {}); if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) { if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`); else b.output[f.path] = f.content; }
}
function report(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits); let pages = 0;
  for (const s of b.sources) if (!s.post) pages++;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`); b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}
const PIPELINE = [readSources, frontMatter, permalinks, markdown, collections, tags, layouts, report];
export function build(input) {
  const templates = new Map(); const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try { templates.set(name, parseTemplate(name, input.templates[name])); }
    catch (err) { if (!(err instanceof TemplateError)) throw err; report.push(err.message); }
  }
  const b = { input, base: input.site.base_url.replace(/\/+$/, ''), templates, sources: [], statics: [], bySource: new Map(), broken: new Set(), report, posts: [], tags: [], cards: new Map(), output: {} };
  for (const plugin of PIPELINE) plugin(b);
  return b.output;
}
