// Cosmos Workbench — a Notion/Obsidian-style shell on top of the Cosmos vault:
// page tree with drag & drop, tabs, block editor with slash commands, typed databases,
// outline/backlinks panel, home dashboard and full-page search. The graph becomes a tab.
(() => {
const $ = id => document.getElementById(id);
const esc = s => escapeHtml(s);
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const collator = new Intl.Collator('fr', {sensitivity: 'base', numeric: true});
const store = {get(k, f){ try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }};
const app = document.querySelector('.app');
const W = window.cosmosWorkbench = {tabs: [], active: 0, projectId: null, expanded: new Set(), blocks: [], editing: -1, noteId: null, ctx: store.get('cosmos-wb-ctx', true), side: store.get('cosmos-wb-side', true)};

/* ================= Data helpers ================= */
const docs = () => projectDocuments();
const entryOf = id => docs().byId.get(id);
const noteOf = id => entryOf(id)?.note;
const isDb = n => n?.notion?.kind === 'database';
const galaxyOf = entry => entry?.galaxy ? noteOf(entry.galaxy) : null;
function mapOf(entry){ const g = galaxyOf(entry); return g ? (g.starMap ||= {notes: [], links: [], trash: []}) : activeProject(); }
const touch = n => { n.updatedAt = new Date().toISOString(); };
const pageIcon = n => n?.icon || (isDb(n) ? '▦' : n?.starMap?.notes?.length ? '✧' : '▤');
const displayTitle = n => (n?.title || '').trim() || 'Sans titre';

// Inline #tags plus explicit tags, cached per body.
const tagCache = new WeakMap();
function noteTags(n){
  let c = tagCache.get(n);
  if (!c || c.body !== n.body || c.tags !== n.tags) {
    const inline = [...String(n.body || '').replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '').matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)].map(m => m[1]);
    c = {body: n.body, tags: n.tags, list: [...new Set([...(n.tags || []).filter(t => t !== 'notion' && t !== 'html' && t !== 'markdown' && t !== 'tableur'), ...inline])]};
    tagCache.set(n, c);
  }
  return c.list;
}

/* ================= Page tree ================= */
let treeCache = null;
function buildTree(){
  const data = docs();
  if (treeCache && treeCache.data === data && treeCache.version === W.treeVersion) return treeCache;
  const nodes = new Map(), roots = [];
  const node = (id, props) => { let n = nodes.get(id); if (!n) { n = {id, children: [], parent: null, ...props}; nodes.set(id, n); } return n; };
  for (const e of data.entries) node(e.note.id, {note: e.note, galaxy: e.galaxy});
  // Notion sources: strip each import's shared top folder, then map folders to their pages.
  const bySource = new Map(), prefixes = new Map();
  for (const e of data.entries) { const s = e.note.notion?.source; if (!s) continue; const root = e.note.notion.root || ''; const top = s.split('/')[0]; if (!prefixes.has(root)) prefixes.set(root, s.includes('/') ? top : null); else if (prefixes.get(root) !== top) prefixes.set(root, null); }
  const rel = n => { let s = String(n.notion.source).replaceAll('\\', '/'); const p = prefixes.get(n.notion.root || ''); if (p && s.startsWith(p + '/')) s = s.slice(p.length + 1); return s; };
  const stem = s => s.replace(/\.[^./]+$/, '').replace(/_all$/, '');
  for (const e of data.entries) if (e.note.notion?.source) bySource.set((e.note.notion.root || '') + '|' + stem(rel(e.note)), nodes.get(e.note.id));
  const folderNode = (root, dir) => {
    const key = root + '|' + dir, page = bySource.get(key); if (page) return page;
    const id = 'dir:' + key; if (nodes.has(id)) return nodes.get(id);
    const f = node(id, {folder: true, title: cleanNotionTitle(dir.split('/').pop())});
    const parentDir = dir.split('/').slice(0, -1).join('/');
    const parent = parentDir ? folderNode(root, parentDir) : null;
    if (parent) { f.parent = parent; parent.children.push(f); } else roots.push(f);
    return f;
  };
  const isAncestor = (a, b) => { for (let p = b; p; p = p.parent) if (p === a) return true; return false; };
  for (const e of data.entries) {
    const n = nodes.get(e.note.id); let parent = null;
    if (e.note.parentId && nodes.has(e.note.parentId)) parent = nodes.get(e.note.parentId);
    else if (e.note.notion?.source) { const r = rel(e.note), dir = r.split('/').slice(0, -1).join('/'); if (dir) parent = folderNode(e.note.notion.root || '', dir); else if (e.galaxy) parent = nodes.get(e.galaxy); }
    else if (e.galaxy) parent = nodes.get(e.galaxy);
    if (parent && (parent === n || isAncestor(n, parent))) parent = e.galaxy ? nodes.get(e.galaxy) : null;
    if (parent && parent !== n) { n.parent = parent; parent.children.push(n); } else roots.push(n);
  }
  const title = n => n.folder ? n.title : displayTitle(n.note);
  const sortRec = list => { list.sort((a, b) => (b.folder === true) - (a.folder === true) || collator.compare(title(a), title(b))); for (const n of list) if (n.children.length) sortRec(n.children); };
  sortRec(roots);
  // A galaxy that only groups orphan pages is shown only if it still holds something.
  treeCache = {data, version: W.treeVersion, nodes, roots: roots.filter(n => !(n.note && !n.note.notion && n.note.title === 'Autres pages importées' && !n.children.length)), title};
  return treeCache;
}
W.treeVersion = 0;
const titleTreeSoon = debounce(() => { bumpTree(); refreshSidebar(); }, 400);
function bumpTree(){ W.treeVersion++; invalidateNavigation(); }
function ancestorsOf(id){ const t = buildTree(); const out = []; for (let n = t.nodes.get(id)?.parent; n; n = n.parent) out.unshift(n); return out; }

/* ================= Page operations ================= */
function createPage(parentId = null, opts = {}){
  flushAll();
  const project = activeProject(), stamp = new Date().toISOString();
  const note = {id: 'n' + crypto.randomUUID(), title: opts.title || '', group: opts.group || 'Idées', x: (Math.random() - .5) * 1.4, y: (Math.random() - .5) * 1.2, z: (Math.random() - .5) * .6, tags: [], body: opts.body || '', updatedAt: stamp, createdAt: stamp};
  if (opts.database) { note.notion = dbCreate(); note.body = databaseMarkdown(note.notion); }
  const parentEntry = parentId && entryOf(parentId);
  if (!parentEntry) { note.starMap = {notes: [], links: [], trash: []}; project.notes.push(note); }
  else {
    const galaxy = parentEntry.galaxy ? noteOf(parentEntry.galaxy) : parentEntry.note;
    galaxy.starMap ||= {notes: [], links: [], trash: []};
    galaxy.starMap.notes.push(note); note.parentId = parentEntry.note.id;
    W.expanded.add(parentEntry.note.id); saveExpanded();
  }
  bumpTree(); saveWorkspace();
  if (opts.open !== false) { openNote(note.id, {newTab: opts.newTab}); requestAnimationFrame(() => { const t = document.querySelector('.wb-title'); t?.focus(); }); }
  refreshSidebar(true);
  return note.id;
}
W.createPage = createPage;
function spliceOut(arr, pred){ for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i], i)) arr.splice(i, 1); }
function moveNote(id, targetId){
  flushAll();
  const entry = entryOf(id); if (!entry) return;
  const t = buildTree(), target = targetId ? t.nodes.get(targetId) : null;
  if (target?.folder) return toast('Dépose la page sur une page, pas sur un dossier importé');
  for (let p = target; p; p = p.parent) if (p.id === id) return toast('Impossible de déplacer une page dans ses propres sous-pages');
  const note = entry.note, project = activeProject(), from = mapOf(entry);
  const destGalaxy = target ? (target.galaxy ? noteOf(target.galaxy) : target.note) : null;
  const detach = () => { spliceOut(from.notes, n => n === note); spliceOut(from.links, e => e.includes(note.id)); };
  if (!destGalaxy) { // to top level
    if (!entry.galaxy) { delete note.parentId; bumpTree(); saveWorkspace(); refreshSidebar(true); return; }
    detach(); delete note.parentId; note.starMap ||= {notes: [], links: [], trash: []}; project.notes.push(note);
  } else {
    const dest = destGalaxy.starMap ||= {notes: [], links: [], trash: []};
    if (!entry.galaxy) { // a galaxy becomes a sub-page: its stars travel with it
      if (destGalaxy === note) return;
      const stars = note.starMap?.notes || [];
      for (const s of stars) { if (!s.parentId) s.parentId = note.id; dest.notes.push(s); }
      for (const l of note.starMap?.links || []) dest.links.push(l);
      for (const r of note.starMap?.trash || []) (dest.trash ||= []).push(r);
      delete note.starMap; detach(); dest.notes.push(note);
    } else if (from !== dest) { detach(); dest.notes.push(note); }
    note.parentId = target.note.id;
    W.expanded.add(target.id); saveExpanded();
  }
  if (currentGalaxyId && !noteOf(currentGalaxyId)) currentGalaxyId = null;
  touch(note); bumpTree(); saveWorkspace();
  // Keep the live map references consistent.
  const e = entryOf(W.noteId || id); if (e) { currentGalaxyId = e.galaxy; const m = activeMap(); notes = m.notes; links = m.links; }
  refreshSidebar(true); renderCenter(); toast('Page déplacée');
}
function trashNote(id){
  const e = entryOf(id); if (!e) return;
  openDocument(id);
  const before = activeMap().notes.length; trashSelectedNote();
  if (activeMap().notes.length === before) return;
  W.tabs = W.tabs.filter(t => t.noteId !== id); if (!W.tabs.length) W.tabs.push({type: 'home'});
  W.active = Math.min(W.active, W.tabs.length - 1); bumpTree(); saveTabs(); refreshSidebar(true); renderTabs(); renderCenter();
}
function duplicateNote(id){
  const e = entryOf(id); if (!e) return;
  const copy = structuredClone(e.note); copy.id = 'n' + crypto.randomUUID(); copy.title = displayTitle(e.note) + ' (copie)'; delete copy.starMap; touch(copy);
  const m = mapOf(e); m.notes.push(copy); if (!e.galaxy) copy.starMap = {notes: [], links: [], trash: []};
  bumpTree(); saveWorkspace(); refreshSidebar(true); openNote(copy.id);
}
function renameNote(n, title){
  const old = n.title; title = String(title || '').trim() || 'Sans titre';
  if (old === title) return;
  renameNoteReferences(old, title, n.id); n.title = title; touch(n);
  if (W.blocks.hiddenTitle && W.noteId === n.id) { W.blocks[0] = '# ' + title; n.body = W.blocks.join('\n\n'); }
  bumpTree(); scheduleEditorSave(n); flushEditorSave(); refreshSidebar(true); renderTabs(); renderContextSoon();
}

/* ================= Tabs ================= */
const tabKey = () => 'cosmos-wb-tabs-' + activeProjectId;
function saveTabs(){ store.set(tabKey(), {tabs: W.tabs.map(t => ({type: t.type, noteId: t.noteId, q: t.q})), active: W.active}); }
function saveExpanded(){ store.set('cosmos-wb-open-' + activeProjectId, [...W.expanded].slice(-2000)); }
function loadProjectState(){
  W.projectId = activeProjectId;
  const saved = store.get(tabKey(), null);
  W.tabs = (saved?.tabs || []).filter(t => t.type !== 'note' || entryOf(t.noteId));
  if (!W.tabs.length) W.tabs = [{type: 'home'}];
  W.active = Math.max(0, Math.min(saved?.active ?? 0, W.tabs.length - 1));
  W.expanded = new Set(store.get('cosmos-wb-open-' + activeProjectId, []));
}
function tabLabel(t){ if (t.type === 'home') return {icon: '⌂', text: 'Accueil'}; if (t.type === 'graph') return {icon: '✧', text: 'Graphe'}; if (t.type === 'search') return {icon: '⌕', text: t.q ? 'Recherche : ' + t.q : 'Recherche'}; const n = noteOf(t.noteId); return {icon: pageIcon(n), text: n ? displayTitle(n) : 'Page supprimée'}; }
function renderTabs(){
  const bar = $('wb-tabs-list'); if (!bar) return;
  bar.innerHTML = W.tabs.map((t, i) => { const l = tabLabel(t); return `<div class="wb-tab ${i === W.active ? 'on' : ''}" data-tab="${i}" draggable="true" title="${esc(l.text)}"><span class="wb-tab-icon">${esc(l.icon)}</span><span class="wb-tab-text">${esc(l.text)}</span><button class="wb-tab-x" data-close="${i}" title="Fermer (Ctrl+W)">×</button></div>`; }).join('') + '<button class="wb-tab-new" data-newtab title="Nouvel onglet (Ctrl+T)">＋</button>';
}
function activate(i, opts = {}){
  flushAll();
  W.active = Math.max(0, Math.min(i, W.tabs.length - 1));
  const t = W.tabs[W.active];
  if (t.type === 'note') { const e = entryOf(t.noteId); if (e && (selected !== t.noteId || !notes.includes(e.note))) enterNote(e); }
  if (t.type === 'note' && buildTree().nodes.get(t.noteId)?.children.length && !W.expanded.has(t.noteId)) { W.expanded.add(t.noteId); saveExpanded(); }
  saveTabs(); renderTabs(); renderCenter(opts); revealInTree(t.noteId);
}
// Light-weight map switch: no full save, no hidden legacy re-render of lists.
function enterNote(e){
  const before = activeMap();
  if (currentGalaxyId !== e.galaxy) { before.camera = cameraState(); currentGalaxyId = e.galaxy; const m = activeMap(); notes = m.notes; links = m.links; restoreCamera(m.camera); scheduleWorkspaceSave(); }
  else if (!notes.includes(e.note)) { const m = activeMap(); notes = m.notes; links = m.links; }
  selected = e.note.id; editing = false; filter = 'all'; query = '';
  renderDetail();
}
function openNote(id, opts = {}){
  if (!entryOf(id)) return;
  const cur = W.tabs[W.active];
  const existing = W.tabs.findIndex(t => t.type === 'note' && t.noteId === id);
  if (existing >= 0 && !opts.newTab) return activate(existing, opts);
  if (opts.newTab || !cur || cur.type === 'graph' && !opts.replaceGraph) { W.tabs.splice(W.active + 1, 0, {type: 'note', noteId: id}); return activate(W.active + 1, opts); }
  W.tabs[W.active] = {type: 'note', noteId: id};
  activate(W.active, opts);
}
W.openNote = openNote;
function openSpecial(type, extra = {}, newTab = false){
  const idx = W.tabs.findIndex(t => t.type === type);
  if (type !== 'search' && idx >= 0 && !newTab) return activate(idx);
  if (newTab || type === 'graph') { W.tabs.splice(W.active + 1, 0, {type, ...extra}); return activate(W.active + 1); }
  W.tabs[W.active] = {type, ...extra}; activate(W.active);
}
function closeTab(i){
  if (W.tabs.length === 1) { W.tabs = [{type: 'home'}]; return activate(0); }
  W.tabs.splice(i, 1); activate(i <= W.active ? Math.max(0, W.active - 1) : W.active);
}

/* ================= Sidebar ================= */
let sideKey = '';
function refreshSidebar(force){
  if (!$('wb-side')) return;
  if (force) sideKey = '';
  renderProjectButton(); renderTree(); renderFavorites(); renderTags(); renderTrashCount();
}
const refreshSidebarSoon = debounce(() => refreshSidebar(), 180);
function renderProjectButton(){ const p = activeProject(); $('wb-project-name').textContent = p.name; }
function renderTrashCount(){ const count = (activeProject().trash || []).length + activeProject().notes.reduce((s, g) => s + (g.starMap?.trash?.length || 0), 0) + (workspace.archivedProjects || []).length; $('wb-trash-count').textContent = count || ''; }
const TREE_PAGE = 300;
W.treeLimits = new Map();
function renderTree(){
  const t = buildTree(), host = $('wb-tree'); if (!host) return;
  const active = W.tabs[W.active]?.noteId;
  const rows = [];
  const walk = (list, depth, parentId) => {
    const limit = W.treeLimits.get(parentId || 'root') || TREE_PAGE;
    for (let i = 0; i < list.length; i++) {
      if (i >= limit) { rows.push(`<button class="wb-more" data-more="${esc(parentId || 'root')}" style="--d:${depth}">… ${list.length - limit} de plus</button>`); break; }
      const n = list[i], open = W.expanded.has(n.id), kids = n.children.length;
      const label = t.title(n), icon = n.folder ? (open ? '▾' : '▸') : pageIcon(n.note);
      rows.push(`<div class="wb-row ${n.id === active ? 'on' : ''} ${n.folder ? 'folder' : ''}" data-node="${esc(n.id)}" style="--d:${depth}" ${n.folder ? '' : 'draggable="true"'}><button class="wb-caret ${kids ? '' : 'none'}" data-toggle="${esc(n.id)}" tabindex="-1">${kids ? (open ? '▾' : '▸') : ''}</button><span class="wb-ricon">${esc(icon)}</span><span class="wb-rtitle">${esc(label)}</span>${kids ? `<span class="wb-rcount">${kids}</span>` : ''}${n.folder ? '' : `<span class="wb-racts"><button data-add-child="${esc(n.id)}" title="Ajouter une sous-page">＋</button><button data-row-menu="${esc(n.id)}" title="Actions">⋯</button></span>`}</div>`);
      if (open && kids) walk(n.children, depth + 1, n.id);
    }
  };
  walk(t.roots, 0, null);
  const key = rows.join('');
  if (key === sideKey) return; sideKey = key;
  host.innerHTML = key || '<p class="wb-empty">Aucune page. Crée ta première page avec ＋.</p>';
  $('wb-tree-count').textContent = docs().entries.length.toLocaleString('fr-FR');
}
function revealInTree(id){
  if (!id) return; let changed = false;
  for (const a of ancestorsOf(id)) if (!W.expanded.has(a.id)) { W.expanded.add(a.id); changed = true; }
  if (changed) saveExpanded();
  sideKey = ''; renderTree();
  requestAnimationFrame(() => document.querySelector(`#wb-tree [data-node="${CSS.escape(id)}"]`)?.scrollIntoView({block: 'nearest'}));
}
function renderFavorites(){
  const favs = docs().entries.filter(e => e.note.favorite).slice(0, 50);
  $('wb-favs-section').hidden = !favs.length;
  $('wb-favs').innerHTML = favs.map(e => `<div class="wb-row" data-node="${esc(e.note.id)}" style="--d:0"><span class="wb-caret none"></span><span class="wb-ricon">${esc(pageIcon(e.note))}</span><span class="wb-rtitle">${esc(displayTitle(e.note))}</span></div>`).join('');
}
function allTags(){
  const counts = new Map();
  for (const e of docs().entries) for (const t of noteTags(e.note)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
}
function renderTags(){
  const tags = allTags(); $('wb-tags-section').hidden = !tags.length;
  $('wb-tags').innerHTML = tags.slice(0, 60).map(([t, c]) => `<button class="wb-tag" data-tag="${esc(t)}">#${esc(t)} <small>${c}</small></button>`).join('') + (tags.length > 60 ? `<button class="wb-tag" data-search="#">+${tags.length - 60}</button>` : '');
}
function nodeMenu(anchor, id){
  const n = noteOf(id); if (!n) return;
  const pop = dbPopover(anchor, `<button data-a="open">Ouvrir</button><button data-a="tab">Ouvrir dans un nouvel onglet</button><button data-a="child">＋ Sous-page</button><button data-a="db">＋ Base de données</button><hr><button data-a="rename">Renommer</button><button data-a="fav">${n.favorite ? '★ Retirer des favoris' : '☆ Ajouter aux favoris'}</button><button data-a="dup">Dupliquer</button><button data-a="root">Déplacer au premier niveau</button><button data-a="graph">Voir dans le graphe</button><hr><button class="danger" data-a="trash">Déplacer dans la corbeille</button>`);
  pop.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; pop._close?.();
    if (a === 'open') openNote(id); if (a === 'tab') openNote(id, {newTab: true});
    if (a === 'child') createPage(id); if (a === 'db') createPage(id, {database: true, title: 'Nouvelle base'});
    if (a === 'rename') { const t = prompt('Nouveau titre', n.title); if (t != null) { renameNote(n, t); renderCenter(); } }
    if (a === 'fav') { n.favorite = !n.favorite; persist(); refreshSidebar(true); renderCenter(); }
    if (a === 'dup') duplicateNote(id); if (a === 'root') moveNote(id, null);
    if (a === 'graph') { openDocument(id); openSpecial('graph'); requestAnimationFrame(() => focusSelectedSmooth()); }
    if (a === 'trash') trashNote(id);
  };
}
function projectMenu(anchor){
  const native = typeof nativeStore !== 'undefined' && nativeStore;
  const pop = dbPopover(anchor, `<div class="wb-pop-title">Projets</div>${workspace.projects.map(p => `<button data-p="${esc(p.id)}" class="${p.id === activeProjectId ? 'on' : ''}">${p.id === activeProjectId ? '● ' : ''}${esc(p.name)} <small>${p.notes.length}</small></button>`).join('')}<hr>
    <button data-a="new">＋ Nouveau projet</button><button data-a="rename">Renommer ce projet</button><button data-a="delete" class="danger">Supprimer ce projet</button><hr>
    <div class="wb-pop-title">Importer</div><button data-a="notion" ${native ? '' : 'disabled'}>Export Notion (.zip)…</button><button data-a="notionfiles" ${native ? '' : 'disabled'}>Fichiers Notion (HTML/CSV/MD)…</button><button data-a="md">Notes Markdown…</button><button data-a="json">Sauvegarde Cosmos (.json)…</button><hr>
    <div class="wb-pop-title">Exporter</div><button data-a="export">Ce projet (.json)</button><button data-a="exportall">Tous les projets (.json)</button><hr><button data-a="vault">Dossier du coffre…</button>`, 'wb-project-pop');
  pop.onclick = e => {
    const p = e.target.closest('[data-p]')?.dataset.p; const a = e.target.closest('[data-a]')?.dataset.a; if (!p && !a) return; pop._close?.();
    if (p && p !== activeProjectId) switchProject(p);
    if (a === 'new') openProjectDialog(); if (a === 'rename') openProjectDialog(true); if (a === 'delete') removeCurrentProject();
    if (a === 'notion') nativeStore.importNotionZip(); if (a === 'notionfiles') nativeStore.importNotionFiles();
    if (a === 'md') chooseMarkdownFiles(); if (a === 'json') $('backup-import').click();
    if (a === 'export') exportVault(); if (a === 'exportall') exportWorkspace(); if (a === 'vault') window.openVaultPanel();
  };
}

/* ================= Center ================= */
function showGraph(on){
  app.classList.toggle('wb-graph', on);
  documentMode = !on;
  if (on) { const was = app.dataset.graphShown === '1'; app.dataset.graphShown = '1'; requestAnimationFrame(() => { draw(); if (!was) fitGraph(false); queueRender(); }); } else app.dataset.graphShown = '0';
}
function renderCenter(opts = {}){
  const t = W.tabs[W.active] || {type: 'home'};
  flushBlockEdit();
  showGraph(t.type === 'graph');
  const page = $('wb-page');
  if (t.type === 'graph') { page.hidden = true; W.noteId = null; renderContext(); return; }
  page.hidden = false;
  if (t.type === 'home') { W.noteId = null; renderHome(page); }
  else if (t.type === 'search') { W.noteId = null; renderSearch(page, t); }
  else { const n = noteOf(t.noteId); if (!n) { W.tabs[W.active] = {type: 'home'}; return renderCenter(); } W.noteId = n.id; renderNotePage(page, n, opts); }
  if (t.type === 'note') { const host = $('wb-ctx-body'); if (host) host.innerHTML = ''; renderContextSoon(); } else renderContext();
  if (!opts.keepScroll) page.scrollTop = 0;
}

/* ---------- Home ---------- */
function renderHome(page){
  const all = docs().entries.map(e => e.note), recents = [...all].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 12);
  const dbs = all.filter(isDb).length, favs = all.filter(n => n.favorite).slice(0, 8);
  const hour = new Date().getHours(), hello = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
  const snippet = n => isDb(n) ? `${n.notion.rows?.length || 0} lignes` : esc(String(n.body || '').replace(/^#.*$/m, '').replace(/\[!\w+\][+-]?/g, '').replace(/[#*_>`\[\]|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110));
  page.innerHTML = `<div class="wb-home">
    <div class="wb-home-hero"><div class="wb-home-orb"></div><div><p class="wb-eyebrow">${esc(activeProject().name)}</p><h1>${hello}.</h1><p class="wb-sub">${all.length.toLocaleString('fr-FR')} pages · ${dbs} bases de données · ${allTags().length} tags</p></div></div>
    <button class="wb-home-search" data-act="search"><span>⌕</span>Rechercher ou lancer une commande…<kbd>Ctrl K</kbd></button>
    <div class="wb-home-actions">
      <button data-act="page"><b>＋</b><span>Nouvelle page</span><small>N</small></button>
      <button data-act="db"><b>▦</b><span>Base de données</span><small>tableau, kanban, calendrier</small></button>
      <button data-act="day"><b>◷</b><span>Journal du jour</span><small>J</small></button>
      <button data-act="graph"><b>✧</b><span>Graphe</span><small>G</small></button>
      <button data-act="import"><b>⇪</b><span>Importer Notion</span><small>.zip HTML et/ou Markdown</small></button>
    </div>
    ${favs.length ? `<h2>Favoris</h2><div class="wb-cards">${favs.map(n => `<button class="wb-card" data-open="${esc(n.id)}"><span class="wb-card-icon">${esc(pageIcon(n))}</span><b>${esc(displayTitle(n))}</b><small>${snippet(n)}</small></button>`).join('')}</div>` : ''}
    <h2>Récemment modifiées</h2>${recents.length ? `<div class="wb-cards">${recents.map(n => `<button class="wb-card" data-open="${esc(n.id)}"><span class="wb-card-icon">${esc(pageIcon(n))}</span><b>${esc(displayTitle(n))}</b><small>${snippet(n)}</small><time>${n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'}) : ''}</time></button>`).join('')}</div>` : '<div class="wb-home-empty"><p>Ton univers est vide pour l’instant.</p><p>Crée une page, ou importe ton espace Notion depuis le menu du projet (en haut à gauche).</p></div>'}
    <div class="wb-home-tips"><div><b>Écrire</b><span>Clique dans une page et écris. Tape <kbd>/</kbd> pour insérer un titre, une liste, une base de données…</span></div><div><b>Relier</b><span>Tape <kbd>[[</kbd> pour lier une page. Les liens apparaissent dans le panneau de droite et dans le graphe.</span></div><div><b>Organiser</b><span>Glisse les pages dans l’arborescence pour les ranger les unes dans les autres.</span></div></div>
  </div>`;
  page.onclick = e => {
    const o = e.target.closest('[data-open]'); if (o) return openNote(o.dataset.open, {newTab: e.ctrlKey || e.metaKey});
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'search') openSearch(); if (a === 'page') createPage(null); if (a === 'db') createPage(null, {database: true, title: 'Nouvelle base'});
    if (a === 'day') dailyNote(); if (a === 'graph') openSpecial('graph');
    if (a === 'import') { if (typeof nativeStore !== 'undefined' && nativeStore) nativeStore.importNotionZip(); else toast('Import Notion disponible dans l’application de bureau'); }
  };
}
function dailyNote(){
  const stamp = new Intl.DateTimeFormat('fr-CA', {timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const title = `Journal · ${stamp}`, existing = docs().entries.find(e => e.note.title === title);
  if (existing) return openNote(existing.note.id);
  let journal = docs().entries.find(e => !e.galaxy && e.note.title === 'Journal' && !e.note.notion);
  const parent = journal ? journal.note.id : createPage(null, {title: 'Journal', group: 'Journal', open: false});
  createPage(parent, {title, group: 'Journal', body: `## Aujourd’hui\n\n- [ ] \n\n## Notes\n\n## Une idée à garder\n`});
}

/* ---------- Search ---------- */
function searchNotes(q, limit = 200){
  const raw = String(q || '').trim().toLocaleLowerCase(); if (!raw) return [];
  const tags = [...raw.matchAll(/(?:^|\s)(?:#|tag:)([^\s]+)/g)].map(m => m[1]);
  const words = raw.replace(/(?:^|\s)(?:#|tag:)[^\s]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const e of docs().entries) {
    const n = e.note;
    if (tags.length) { const nt = noteTags(n).map(t => t.toLocaleLowerCase()); if (!tags.every(t => nt.some(x => x === t || x.startsWith(t + '/')))) continue; }
    const c = searchText(n); let score = 1, ok = true;
    for (const w of words) { if (c.lowTitle.startsWith(w)) score += 120; else if (c.lowTitle.includes(w)) score += 70; else if (c.text.includes(w)) score += 12; else { ok = false; break; } }
    if (ok) out.push({e, score});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
function renderSearch(page, tab){
  page.innerHTML = `<div class="wb-search"><div class="wb-search-bar"><span>⌕</span><input id="wb-search-in" value="${esc(tab.q || '')}" placeholder="Rechercher dans toutes les pages… (#tag pour filtrer)" autocomplete="off"></div><div id="wb-search-res"></div></div>`;
  const input = $('wb-search-in'), res = $('wb-search-res');
  const run = () => {
    const q = input.value; tab.q = q; saveTabs(); renderTabs();
    const found = searchNotes(q), term = q.replace(/(?:^|\s)(?:#|tag:)[^\s]+/g, ' ').trim().split(/\s+/)[0]?.toLocaleLowerCase() || '';
    res.innerHTML = q.trim() ? `<p class="wb-muted">${found.length === 200 ? '200+ résultats' : found.length + ' résultat' + (found.length > 1 ? 's' : '')}</p>` + found.map(({e}) => {
      const n = e.note, crumbs = ancestorsOf(n.id).map(a => a.folder ? a.title : displayTitle(a.note)).join(' / ');
      const text = String(n.body || '').replace(/\s+/g, ' '), i = term ? text.toLocaleLowerCase().indexOf(term) : -1;
      const snip = i >= 0 ? esc((i > 60 ? '…' : '') + text.slice(Math.max(0, i - 60), i)) + '<mark>' + esc(text.slice(i, i + term.length)) + '</mark>' + esc(text.slice(i + term.length, i + 140)) : esc(text.slice(0, 160));
      return `<button class="wb-result" data-open="${esc(n.id)}"><span class="wb-card-icon">${esc(pageIcon(n))}</span><div><b>${esc(displayTitle(n))}</b>${crumbs ? `<small>${esc(crumbs)}</small>` : ''}<p>${snip}</p>${noteTags(n).length ? `<div>${noteTags(n).slice(0, 6).map(t => `<span class="wb-tagchip">#${esc(t)}</span>`).join('')}</div>` : ''}</div></button>`;
    }).join('') : `<div class="wb-home-empty"><p>Tape un mot, ou <b>#tag</b> pour filtrer par tag.</p><div class="wb-tags-inline">${allTags().slice(0, 40).map(([t, c]) => `<button class="wb-tag" data-tag="${esc(t)}">#${esc(t)} <small>${c}</small></button>`).join('')}</div></div>`;
  };
  input.oninput = debounce(run, docs().entries.length > 1500 ? 120 : 30);
  page.onclick = e => { const o = e.target.closest('[data-open]'); if (o) return openNote(o.dataset.open, {newTab: e.ctrlKey || e.metaKey}); const tg = e.target.closest('[data-tag]'); if (tg) { input.value = '#' + tg.dataset.tag; run(); } };
  run(); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}
function openSearchTab(q = ''){ const idx = W.tabs.findIndex(t => t.type === 'search'); if (idx >= 0) { W.tabs[idx].q = q; activate(idx); } else openSpecial('search', {q}, true); }

/* ---------- Note page & block editor ---------- */
function parseBlocks(body){
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n'), out = []; let i = 0;
  const isList = l => /^\s*([-*+]|\d+[.)])\s/.test(l), isQuote = l => /^\s*>/.test(l), isTable = l => /^\s*\|/.test(l), isFence = l => /^\s*(```|~~~)/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isFence(l)) { const fence = l.trim().slice(0, 3); const buf = [l]; i++; while (i < lines.length) { buf.push(lines[i]); if (lines[i].trim().startsWith(fence)) { i++; break; } i++; } out.push(buf.join('\n')); continue; }
    if (/^#{1,6}\s/.test(l) || /^\s*(---|\*\*\*|___)\s*$/.test(l)) { out.push(l); i++; continue; }
    const take = pred => { const buf = []; while (i < lines.length && lines[i].trim() && pred(lines[i])) buf.push(lines[i++]); out.push(buf.join('\n')); };
    if (isTable(l)) { take(isTable); continue; }
    if (isQuote(l)) { take(isQuote); continue; }
    if (isList(l)) { take(x => isList(x) || /^\s+\S/.test(x)); continue; }
    take(x => !isFence(x) && !/^#{1,6}\s/.test(x) && !isList(x) && !isQuote(x) && !isTable(x));
  }
  return out;
}
// Callouts "> [!note] …" and toggles "> [!toggle] Titre" rendered Notion-style.
function decorate(root){
  root.querySelectorAll('blockquote').forEach(bq => {
    const first = bq.firstElementChild; if (!first) return;
    const m = first.innerHTML.match(/^\s*\[!(\w+)\]([+-]?)\s*([^\n<]*)(?:<br>\n?|\n)?/); if (!m) return;
    const type = m[1].toLowerCase(), rest = first.innerHTML.slice(m[0].length);
    if (type === 'toggle') {
      const det = document.createElement('details'); det.className = 'md-toggle'; if (m[2] === '+') det.open = true;
      const sum = document.createElement('summary'); sum.innerHTML = m[3] || 'Afficher'; det.append(sum);
      const body = document.createElement('div'); body.className = 'md-toggle-body';
      if (rest.trim()) { const p = document.createElement('p'); p.innerHTML = rest; body.append(p); }
      [...bq.children].slice(1).forEach(c => body.append(c)); det.append(body); bq.replaceWith(det); return;
    }
    const icons = {note: 'ℹ', info: 'ℹ', tip: '✦', important: '❗', warning: '⚠', caution: '⚠', danger: '⛔', success: '✓', question: '?', quote: '❝', abstract: '≡', example: '✎', todo: '☐'};
    const box = document.createElement('div'); box.className = 'md-callout md-callout-' + type;
    const emoji = m[3].match(/^\s*((?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+)\s*/u);
    const icon = `<span class="md-callout-icon">${emoji ? emoji[1] : icons[type] || '✦'}</span>`;
    const headText = emoji ? m[3].slice(emoji[0].length) : m[3];
    const head = headText.trim() ? `<p>${headText}${rest.trim() ? '<br>' + rest : ''}</p>` : rest.trim() ? `<p>${rest}</p>` : '';
    box.innerHTML = `${icon}<div class="md-callout-body">${head}</div>`;
    const bodyEl = box.querySelector('.md-callout-body'); [...bq.children].slice(1).forEach(c => bodyEl.append(c));
    bq.replaceWith(box);
  });
  root.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}
W.decorate = decorate;
function renderBlockHtml(text){
  const holder = document.createElement('div');
  holder.innerHTML = renderMarkdown(text) || '';
  decorate(holder);
  return holder;
}
function breadcrumbs(n){
  const parts = ancestorsOf(n.id).map(a => a.folder ? `<span>${esc(a.title)}</span>` : `<button data-open="${esc(a.note.id)}">${esc(pageIcon(a.note))} ${esc(displayTitle(a.note))}</button>`);
  return `<button data-home>${esc(activeProject().name)}</button>${parts.map(p => '<i>/</i>' + p).join('')}`;
}
function renderNotePage(page, n, opts = {}){
  const title = displayTitle(n);
  W.blocks = parseBlocks(n.body); W.editing = -1;
  W.blocks.hiddenTitle = !!W.blocks[0] && W.blocks[0].replace(/^#\s+/, '').trim().toLocaleLowerCase() === title.toLocaleLowerCase() && /^#\s/.test(W.blocks[0]);
  const props = Object.entries(n.notion?.kind !== 'database' ? n.notion?.properties || {} : n.notion?.properties || {}).filter(([k]) => k);
  const tags = noteTags(n);
  page.innerHTML = `<div class="wb-note ${isDb(n) ? 'wb-note-db' : ''}">
    ${n.cover ? `<div class="wb-cover" style="background-image:url('${esc(String(n.cover).replace(/'/g, '%27'))}')"></div>` : ''}
    <div class="wb-note-inner">
      <nav class="wb-crumbs">${breadcrumbs(n)}</nav>
      <div class="wb-note-tools"><button class="wb-icon-btn" data-icon title="Changer l’icône">${esc(n.icon || pageIcon(n))}</button><span class="wb-spacer"></span>
        <button class="wb-tool" data-fav title="Favori">${n.favorite ? '★' : '☆'}</button><button class="wb-tool" data-graph title="Voir dans le graphe">✧</button><button class="wb-tool" data-md title="Exporter en Markdown">⇩</button><button class="wb-tool" data-menu title="Plus">⋯</button></div>
      <textarea class="wb-title" rows="1" placeholder="Sans titre" spellcheck="true">${esc(n.title || '')}</textarea>
      <div class="wb-props">
        <div class="wb-prop"><span class="wb-prop-k">◉ Espace</span><span class="wb-prop-v"><select data-group>${Object.keys(colors).map(g => `<option ${n.group === g ? 'selected' : ''}>${g}</option>`).join('')}</select></span></div>
        <div class="wb-prop"><span class="wb-prop-k"># Tags</span><span class="wb-prop-v wb-tag-edit">${(n.tags || []).filter(t => !['notion', 'html', 'markdown', 'tableur'].includes(t)).map(t => `<span class="wb-tagchip">#${esc(t)}<button data-untag="${esc(t)}">×</button></span>`).join('')}${tags.filter(t => !(n.tags || []).includes(t)).map(t => `<span class="wb-tagchip inline" title="Tag présent dans le texte">#${esc(t)}</span>`).join('')}<input data-addtag placeholder="Ajouter un tag…"></span></div>
        ${props.map(([k, v], i) => `<div class="wb-prop"><span class="wb-prop-k" title="${esc(k)}">≡ ${esc(k)}</span><span class="wb-prop-v"><input data-prop="${i}" value="${esc(v)}"></span></div>`).join('')}
        <button class="wb-prop-add" data-addprop>＋ Ajouter une propriété</button>
      </div>
      ${isDb(n) ? '<div class="wb-db" id="wb-db"></div>' : '<div class="wb-blocks" id="wb-blocks"></div><div class="wb-tail" data-tail></div>'}
    </div></div>`;
  const ta = page.querySelector('.wb-title'); autoSize(ta);
  let origTitle = n.title;
  ta.addEventListener('input', () => { autoSize(ta); n.title = ta.value; touch(n); titleTreeSoon(); renderTabs(); scheduleEditorSave(n); });
  ta.addEventListener('blur', () => { const next = ta.value; n.title = origTitle; renameNote(n, next); origTitle = n.title; if (!ta.value.trim()) ta.value = ''; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); if (isDb(n)) return; if (!visibleBlocks().length) addBlockAt(W.blocks.length, ''); else editBlock(firstVisible()); } });
  page.querySelector('[data-group]').onchange = e => { n.group = e.target.value; touch(n); persist(); };
  const addTag = page.querySelector('[data-addtag]');
  addTag.onkeydown = e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const t = addTag.value.trim().replace(/^#/, ''); if (t && !(n.tags || []).includes(t)) { n.tags = [...(n.tags || []), t]; touch(n); persist(); renderNotePage(page, n); refreshSidebarSoon(); page.querySelector('[data-addtag]')?.focus(); } } };
  page.querySelectorAll('[data-untag]').forEach(b => b.onclick = () => { n.tags = (n.tags || []).filter(t => t !== b.dataset.untag); touch(n); persist(); renderNotePage(page, n); refreshSidebarSoon(); });
  page.querySelectorAll('[data-prop]').forEach(el => el.oninput = () => { n.notion.properties[props[Number(el.dataset.prop)][0]] = el.value; touch(n); scheduleEditorSave(n); });
  page.querySelector('[data-addprop]').onclick = () => { const k = prompt('Nom de la propriété'); if (!k?.trim()) return; n.notion ||= {kind: 'page', version: 3, properties: {}}; n.notion.properties ||= {}; n.notion.properties[k.trim()] = ''; touch(n); persist(); renderNotePage(page, n); };
  page.querySelector('[data-fav]').onclick = () => { n.favorite = !n.favorite; persist(); refreshSidebar(true); renderNotePage(page, n, {keepScroll: true}); };
  page.querySelector('[data-graph]').onclick = () => { openDocument(n.id); openSpecial('graph'); requestAnimationFrame(() => { select(n.id); focusSelectedSmooth(); }); };
  page.querySelector('[data-md]').onclick = () => { openDocument(n.id); exportMarkdown(); };
  page.querySelector('[data-menu]').onclick = e => nodeMenu(e.currentTarget, n.id);
  page.querySelector('[data-icon]').onclick = e => iconPicker(e.currentTarget, n);
  page.querySelector('.wb-crumbs').onclick = e => { const o = e.target.closest('[data-open]'); if (o) openNote(o.dataset.open); if (e.target.closest('[data-home]')) openSpecial('home'); };
  if (isDb(n)) {
    renderDatabase($('wb-db'), n, {openNote: id => openNote(id), createRowPage: (db, title) => createPage(db.id, {title, open: false}), onChange: () => renderContextSoon()});
  } else {
    renderBlocks();
    page.querySelector('[data-tail]').onmousedown = e => { e.preventDefault(); const last = W.blocks.length - 1; if (last >= 0 && !W.blocks[last].trim()) editBlock(last); else addBlockAt(W.blocks.length, ''); };
    if (!visibleBlocks().length && opts.focus !== false && !n.title) {} // title gets focus for new pages
  }
}
function iconPicker(anchor, n){
  const icons = ['▤', '✧', '✦', '★', '◉', '◈', '☀', '☾', '♫', '✎', '⚑', '⚙', '☕', '✈', '⌂', '♥', '☘', '⚡', '✿', '❄', '☯', '⚖', '✉', '☎', '📘', '🚀', '💡', '🎨', '🎯', '📌', '🧠', '🌌', '🪐', '🔭', '📚', '🗂️', '✅', '🔥', '🌱', '🎬'];
  const pop = dbPopover(anchor, `<div class="wb-icons">${icons.map(i => `<button data-i="${i}">${i}</button>`).join('')}</div><button data-i="">Retirer l’icône</button>`, 'wb-icon-pop');
  pop.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; n.icon = b.dataset.i || undefined; touch(n); persist(); pop._close?.(); bumpTree(); refreshSidebar(true); renderTabs(); renderCenter({keepScroll: true}); };
}
function autoSize(el){ el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
const visibleBlocks = () => W.blocks.map((b, i) => i).filter(i => !(i === 0 && W.blocks.hiddenTitle));
const firstVisible = () => visibleBlocks()[0] ?? 0;
function currentNote(){ return W.noteId ? noteOf(W.noteId) : null; }
function commitBlocks(){
  const n = currentNote(); if (!n) return;
  const body = W.blocks.join('\n\n');
  if (body === n.body) return;
  n.body = body; touch(n); scheduleEditorSave(n); renderContextSoon(); refreshSidebarSoon();
}
const commitSoon = debounce(commitBlocks, 250);
function renderBlocks(){
  const host = $('wb-blocks'); if (!host) return;
  host.replaceChildren();
  W.blocks.forEach((text, i) => {
    if (i === 0 && W.blocks.hiddenTitle) return;
    host.append(blockEl(i));
  });
  if (!visibleBlocks().length) host.innerHTML = '<div class="wb-placeholder" data-tail>Commence à écrire, ou tape <kbd>/</kbd> pour insérer un bloc…</div>';
  host.querySelector('.wb-placeholder')?.addEventListener('mousedown', e => { e.preventDefault(); addBlockAt(W.blocks.length, ''); });
}
function blockEl(i){
  const el = document.createElement('div'); el.className = 'wb-block'; el.dataset.i = i;
  const text = W.blocks[i];
  const kind = /^#{1,6}\s/.test(text) ? 'h' : /^\s*```/.test(text) ? 'code' : /^\s*\|/.test(text) ? 'table' : /^\s*>/.test(text) ? 'quote' : /^\s*([-*+]|\d+[.)])\s/.test(text) ? 'list' : 'p';
  el.classList.add('k-' + kind);
  el.innerHTML = `<div class="wb-gutter"><button class="wb-add" title="Ajouter un bloc en dessous" tabindex="-1">＋</button><button class="wb-handle" draggable="true" title="Glisser pour déplacer · clic pour le menu" tabindex="-1">⋮⋮</button></div>`;
  const content = renderBlockHtml(text); content.className = 'wb-content markdown';
  if (!text.trim()) content.innerHTML = '<p class="wb-empty-block">&nbsp;</p>';
  el.append(content);
  return el;
}
function blockIndex(el){ return Number(el.closest('.wb-block')?.dataset.i); }
function flushBlockEdit(){
  const ta = document.querySelector('.wb-block-input'); if (!ta) return 0;
  return finishEdit(Number(ta.dataset.i), ta.value);
}
// Returns how many blocks were added (positive) or removed (negative) at/after i.
function finishEdit(i, value){
  window.closeEditorAssist?.(); closeSlash();
  const before = W.blocks.length;
  if (W.blocks[i] === undefined) return 0;
  const parts = value.trim() ? parseBlocks(value) : [''];
  const keepEmpty = !value.trim() && visibleBlocks().length === 1;
  if (!value.trim() && !keepEmpty) W.blocks.splice(i, 1);
  else W.blocks.splice(i, 1, ...(parts.length ? parts : ['']));
  W.editing = -1;
  commitBlocks(); renderBlocks();
  return W.blocks.length - before;
}
function editBlock(i, caret = 'end'){
  const host = $('wb-blocks'); if (!host) return;
  if (W.editing >= 0 && W.editing !== i) { const delta = flushBlockEdit(); if (i > W.editing) i += delta; }
  const el = host.querySelector(`.wb-block[data-i="${i}"]`); if (!el) return;
  W.editing = i;
  const ta = document.createElement('textarea'); ta.className = 'wb-block-input'; ta.dataset.i = i; ta.value = W.blocks[i]; ta.spellcheck = true;
  ta.placeholder = 'Tape / pour les commandes, [[ pour lier une page';
  el.classList.add('editing'); el.querySelector('.wb-content').replaceWith(ta);
  autoSize(ta); ta.focus();
  const pos = caret === 'start' ? 0 : caret === 'end' ? ta.value.length : Math.max(0, Math.min(ta.value.length, caret));
  ta.setSelectionRange(pos, pos);
  window.attachEditorAssist?.(ta, () => { W.blocks[i] = ta.value; autoSize(ta); commitSoon(); });
  ta.addEventListener('input', () => { W.blocks[Number(ta.dataset.i)] = ta.value; autoSize(ta); commitSoon(); slashCheck(ta); });
  ta.addEventListener('keydown', e => blockKeys(e, ta));
  ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta && ta.isConnected && !document.querySelector('.wb-slash:hover') && !document.querySelector('.wiki-suggest:hover')) finishEdit(Number(ta.dataset.i), ta.value); }, 120));
}
function addBlockAt(i, text, caret = 'end'){
  flushBlockEdit();
  W.blocks.splice(i, 0, text); commitBlocks(); renderBlocks(); editBlock(i, caret);
}
function caretFromPoint(content, x, y, raw){
  try {
    const r = document.caretRangeFromPoint?.(x, y); if (!r || !content.contains(r.startContainer)) return 'end';
    const pre = document.createRange(); pre.selectNodeContents(content); pre.setEnd(r.startContainer, r.startOffset);
    const before = pre.toString(), ctx = before.slice(-14);
    if (!ctx) return 'start';
    const idx = raw.indexOf(ctx); if (idx >= 0) return idx + ctx.length;
    const loose = raw.replace(/[*_`~\[\]#>]/g, ''); const j = loose.indexOf(ctx); return j >= 0 ? Math.min(raw.length, j + ctx.length + (raw.length - loose.length) / 2 | 0) : 'end';
  } catch { return 'end'; }
}
function blockKeys(e, ta){
  const i = Number(ta.dataset.i), v = ta.value, s = ta.selectionStart, end = ta.selectionEnd;
  if (slashState && !slashEl.hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slashState.active = (slashState.active + (e.key === 'ArrowDown' ? 1 : -1) + slashState.items.length) % slashState.items.length; paintSlash(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlash(slashState.items[slashState.active]); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
  }
  if (e.defaultPrevented) return;
  const inCode = /^\s*```/.test(v) && !/```\s*$/.test(v.slice(0, s).split('\n').slice(-1)[0] || '') && (v.slice(0, s).match(/```/g) || []).length % 2 === 1;
  if (e.key === 'Escape') { e.preventDefault(); ta.blur(); return; }
  if (e.key === 'Tab') { e.preventDefault(); const ls = v.lastIndexOf('\n', s - 1) + 1; if (e.shiftKey) { if (v.slice(ls, ls + 2) === '  ') { ta.setRangeText('', ls, ls + 2, 'end'); } } else ta.setRangeText('  ', ls, ls, 'end'); ta.dispatchEvent(new Event('input')); return; }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !inCode && !/^\s*\|/.test(v)) {
    const listy = /^\s*([-*+]|\d+[.)]|>)\s/.test(v.slice(v.lastIndexOf('\n', s - 1) + 1));
    if (listy && !ta._listEnded) return; // handled by list continuation
    ta._listEnded = false;
    e.preventDefault();
    const head = v.slice(0, s).replace(/\n+$/, ''), tail = v.slice(end);
    W.blocks[i] = head; ta.value = head;
    const delta = finishEdit(i, head);
    const at = i + 1 + Math.max(0, delta);
    W.blocks.splice(at, 0, tail); commitBlocks(); renderBlocks(); editBlock(at, 'start');
    return;
  }
  if (e.key === 'Backspace' && s === 0 && end === 0) {
    const vis = visibleBlocks(), k = vis.indexOf(i); if (k <= 0) return;
    e.preventDefault(); const prev = vis[k - 1], prevText = W.blocks[prev];
    const plain = t => !/^\s*(#|```|\||>|[-*+] |\d+[.)] |---)/.test(t);
    if (!v.trim()) { W.blocks.splice(i, 1); W.editing = -1; commitBlocks(); renderBlocks(); editBlock(prev, 'end'); return; }
    if (plain(prevText) && plain(v)) { const caret = prevText.length; W.blocks[prev] = prevText + v; W.blocks.splice(i, 1); W.editing = -1; commitBlocks(); renderBlocks(); editBlock(prev, caret); return; }
    finishEdit(i, v); editBlock(prev, 'end'); return;
  }
  if (e.key === 'ArrowUp' && s === end && !v.slice(0, s).includes('\n')) { const vis = visibleBlocks(), k = vis.indexOf(i); if (k > 0) { e.preventDefault(); const target = vis[k - 1]; finishEdit(i, v); editBlock(Math.min(target, W.blocks.length - 1), 'end'); } else { e.preventDefault(); document.querySelector('.wb-title')?.focus(); } return; }
  if (e.key === 'ArrowDown' && s === end && !v.slice(s).includes('\n')) { const vis = visibleBlocks(), k = vis.indexOf(i); if (k >= 0 && k < vis.length - 1) { e.preventDefault(); const delta = finishEdit(i, v); editBlock(vis[k + 1] + delta, 'start'); } return; }
}

/* ---------- Slash menu ---------- */
const slashEl = document.createElement('div'); slashEl.className = 'wb-slash'; slashEl.hidden = true; document.body.append(slashEl);
let slashState = null;
const SLASH = [
  {k: 'texte paragraphe', l: 'Texte', i: '¶', d: 'Paragraphe simple', t: ''},
  {k: 'titre 1 h1 heading', l: 'Titre 1', i: 'H1', d: 'Grand titre de section', t: '# '},
  {k: 'titre 2 h2', l: 'Titre 2', i: 'H2', d: 'Titre moyen', t: '## '},
  {k: 'titre 3 h3', l: 'Titre 3', i: 'H3', d: 'Petit titre', t: '### '},
  {k: 'liste puces bullet', l: 'Liste à puces', i: '•', d: 'Liste simple', t: '- '},
  {k: 'liste numérotée numbered', l: 'Liste numérotée', i: '1.', d: 'Liste ordonnée', t: '1. '},
  {k: 'tâche todo case cocher checkbox', l: 'Liste de tâches', i: '☐', d: 'Cases à cocher', t: '- [ ] '},
  {k: 'toggle dépliant replier', l: 'Bloc dépliant', i: '▸', d: 'Contenu masquable', t: '> [!toggle] ', after: '\n> '},
  {k: 'callout encadré note info', l: 'Encadré', i: '✦', d: 'Mettre en valeur une idée', t: '> [!note] '},
  {k: 'citation quote', l: 'Citation', i: '❝', d: 'Bloc de citation', t: '> '},
  {k: 'code', l: 'Code', i: '</>', d: 'Bloc de code', t: '```\n', after: '\n```'},
  {k: 'tableau table markdown', l: 'Tableau simple', i: '▦', d: 'Tableau Markdown', t: '| Colonne 1 | Colonne 2 |\n| --- | --- |\n| ', after: ' |  |'},
  {k: 'séparateur divider ligne hr', l: 'Séparateur', i: '—', d: 'Ligne horizontale', t: '---', done: true},
  {k: 'lien page wiki relier mention', l: 'Lien vers une page', i: '[[', d: 'Relier une page existante', t: '[['},
  {k: 'sous-page page enfant nouvelle', l: 'Sous-page', i: '▤', d: 'Crée une page rangée dans celle-ci', run: 'subpage'},
  {k: 'base données database tableau kanban calendrier', l: 'Base de données', i: '▦', d: 'Tableau, Kanban, calendrier…', run: 'database'},
  {k: 'image photo', l: 'Image', i: '▣', d: 'Depuis une adresse ou un fichier', run: 'image'},
  {k: 'date aujourd’hui jour', l: 'Date du jour', i: '◷', d: 'Insère la date', run: 'date'},
];
function slashCheck(ta){
  const s = ta.selectionStart, before = ta.value.slice(0, s), m = before.match(/(?:^|\n|\s)\/([\p{L}\d ’'-]{0,24})$/u);
  if (!m || m[1].includes('  ')) return closeSlash();
  const q = m[1].toLocaleLowerCase().trim();
  const items = SLASH.filter(x => !q || x.k.includes(q) || x.l.toLocaleLowerCase().includes(q));
  if (!items.length) return closeSlash();
  slashState = {ta, start: s - m[1].length - 1, items, active: 0};
  paintSlash();
  const r = ta.getBoundingClientRect();
  slashEl.style.left = Math.min(r.left + 8, innerWidth - 300) + 'px';
  slashEl.style.top = (r.bottom + 280 > innerHeight ? Math.max(8, r.top - 290) : r.bottom + 4) + 'px';
}
function paintSlash(){
  const st = slashState; slashEl.hidden = false;
  slashEl.innerHTML = '<div class="wb-slash-head">Blocs</div>' + st.items.map((x, i) => `<button data-i="${i}" class="${i === st.active ? 'on' : ''}"><span class="wb-slash-i">${esc(x.i)}</span><span><b>${esc(x.l)}</b><small>${esc(x.d)}</small></span></button>`).join('');
  slashEl.querySelectorAll('[data-i]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => applySlash(st.items[Number(b.dataset.i)]); });
  slashEl.querySelector('.on')?.scrollIntoView({block: 'nearest'});
}
function closeSlash(){ slashEl.hidden = true; slashState = null; }
function applySlash(item){
  const st = slashState; if (!st) return; closeSlash();
  const ta = st.ta, i = Number(ta.dataset.i), caret = ta.selectionStart;
  ta.setRangeText('', st.start, caret, 'end');
  const at = ta.selectionStart, lineStart = ta.value.lastIndexOf('\n', at - 1) + 1, lineEmpty = !ta.value.slice(lineStart, at).trim() && !ta.value.slice(at).split('\n')[0].trim();
  if (item.run) {
    const n = currentNote();
    if (item.run === 'subpage' || item.run === 'database') {
      const title = item.run === 'database' ? 'Nouvelle base' : 'Nouvelle page';
      const id = createPage(n.id, {title, database: item.run === 'database', open: false});
      ta.setRangeText(`[[${title}]]`, ta.selectionStart, ta.selectionStart, 'end');
      W.blocks[i] = ta.value; finishEdit(i, ta.value); openNote(id); requestAnimationFrame(() => { const t = document.querySelector('.wb-title'); t?.focus(); t?.select(); });
      return;
    }
    if (item.run === 'date') { ta.setRangeText(new Date().toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}), ta.selectionStart, ta.selectionStart, 'end'); }
    if (item.run === 'image') {
      const url = prompt('Adresse de l’image (https://… ou chemin d’un fichier local)');
      if (url?.trim()) { const u = url.trim(); const src = /^(https?|file):/i.test(u) ? u : 'file://' + u.split('/').map(encodeURIComponent).join('/').replace(/^file:\/\/%2F/, 'file:///'); ta.setRangeText(`![](${src.replace(/\)/g, '%29')})`, ta.selectionStart, ta.selectionStart, 'end'); }
    }
    ta.dispatchEvent(new Event('input')); ta.focus(); return;
  }
  if (lineEmpty) { ta.setRangeText(item.t, lineStart, at, 'end'); if (item.after) { const p = ta.selectionStart; ta.setRangeText(item.after, p, p, 'start'); } }
  else ta.setRangeText(item.t + (item.after || ''), at, at, 'end');
  ta.dispatchEvent(new Event('input'));
  if (item.done) { finishEdit(i, ta.value); addBlockAt(i + 1, ''); return; }
  ta.focus();
  if (item.t === '[[') ta.dispatchEvent(new Event('input'));
}

/* ---------- Block interactions (delegated) ---------- */
function bindPage(){
  const page = $('wb-page');
  page.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const block = e.target.closest('.wb-block'); if (!block || block.classList.contains('editing')) return;
    if (e.target.closest('.wb-gutter')) return;
    if (e.target.closest('a,input,summary,button,.md-toggle > summary,img')) return;
    e.preventDefault();
    const i = Number(block.dataset.i), content = block.querySelector('.wb-content');
    const caret = caretFromPoint(content, e.clientX, e.clientY, W.blocks[i] || '');
    editBlock(i, caret);
  });
  page.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a && a.closest('.wb-content,.wb-home,.wb-search,.wb-ctx')) {
      const linked = a.dataset.linked, create = a.dataset.createWiki, url = a.dataset.notionUrl;
      if (linked) { e.preventDefault(); return openNote(linked, {newTab: e.ctrlKey || e.metaKey}); }
      if (create) { e.preventDefault(); const n = currentNote(); const id = createPage(n ? n.id : null, {title: create, open: false}); bumpTree(); return openNote(id, {newTab: e.ctrlKey || e.metaKey}); }
      if (url && !/^https?:/i.test(url)) { e.preventDefault(); const match = resolveUrl(url); if (match) return openNote(match.note.id, {newTab: e.ctrlKey || e.metaKey}); toast('Page introuvable dans ce projet'); return; }
    }
    const task = e.target.closest('input[data-task-line]');
    if (task) { const block = task.closest('.wb-block'); const i = Number(block.dataset.i); const lines = W.blocks[i].split('\n'), ln = Number(task.dataset.taskLine); lines[ln] = lines[ln].replace(/^(\s*[-*+] \[)[ xX](\])/, '$1' + (task.checked ? 'x' : ' ') + '$2'); W.blocks[i] = lines.join('\n'); commitBlocks(); return; }
    const add = e.target.closest('.wb-add'); if (add) { const i = blockIndex(add); addBlockAt(i + 1, '/'); requestAnimationFrame(() => { const ta = document.querySelector('.wb-block-input'); if (ta) slashCheck(ta); }); return; }
    const handle = e.target.closest('.wb-handle'); if (handle) return blockMenu(handle, blockIndex(handle));
  });
  page.addEventListener('dragstart', e => { const h = e.target.closest?.('.wb-handle'); if (!h) return; e.dataTransfer.setData('text/cosmos-block', String(blockIndex(h))); e.dataTransfer.effectAllowed = 'move'; h.closest('.wb-block').classList.add('dragging'); });
  page.addEventListener('dragend', () => page.querySelectorAll('.dragging,.drop-above,.drop-below').forEach(x => x.classList.remove('dragging', 'drop-above', 'drop-below')));
  page.addEventListener('dragover', e => { if (!e.dataTransfer.types.includes('text/cosmos-block')) return; const b = e.target.closest('.wb-block'); if (!b) return; e.preventDefault(); page.querySelectorAll('.drop-above,.drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below')); const r = b.getBoundingClientRect(); b.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below'); });
  page.addEventListener('drop', e => {
    const raw = e.dataTransfer.getData('text/cosmos-block'), b = e.target.closest('.wb-block'); if (!raw || !b) return; e.preventDefault();
    flushBlockEdit();
    const from = Number(raw), r = b.getBoundingClientRect(); let to = Number(b.dataset.i) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    const [moved] = W.blocks.splice(from, 1); if (to > from) to--; W.blocks.splice(to, 0, moved); commitBlocks(); renderBlocks();
  });
}
function resolveUrl(url){
  const d = docs(), clean = String(url).split('#')[0];
  return d.byUrl.get(clean) || (/notion\.(so|com)/.test(url) ? d.byNotionId.get(url.replaceAll('-', '').match(/[a-f\d]{32}/i)?.[0]) : null) || d.byNotionId.get(decodeURIComponent(clean).match(/([a-f\d]{32})(?:_all)?\.[a-z]+$/i)?.[1]);
}
function blockMenu(anchor, i){
  const turn = [['Texte', ''], ['Titre 1', '# '], ['Titre 2', '## '], ['Titre 3', '### '], ['Liste', '- '], ['Tâches', '- [ ] '], ['Citation', '> '], ['Encadré', '> [!note] ']];
  const pop = dbPopover(anchor, `<div class="wb-pop-title">Transformer en</div><div class="wb-turn">${turn.map(([l], k) => `<button data-turn="${k}">${l}</button>`).join('')}</div><hr><button data-a="up">↑ Monter</button><button data-a="down">↓ Descendre</button><button data-a="dup">Dupliquer</button><button data-a="copy">Copier le Markdown</button><button class="danger" data-a="del">Supprimer le bloc</button>`);
  pop.onclick = e => {
    const t = e.target.closest('[data-turn]'), a = e.target.closest('[data-a]')?.dataset.a; if (!t && !a) return; pop._close?.();
    if (t) { const [, prefix] = turn[Number(t.dataset.turn)]; const body = W.blocks[i].split('\n').map(l => l.replace(/^\s*(#{1,6}\s|[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> \[!\w+\]\s*|> )/, '')).join('\n'); W.blocks[i] = prefix.startsWith('> ') ? body.split('\n').map((l, k) => (k ? '> ' : prefix) + l).join('\n') : prefix.startsWith('#') ? prefix + body.replace(/\n/g, ' ') : prefix ? body.split('\n').map(l => prefix + l).join('\n') : body; }
    if (a === 'up' && i > firstVisible()) [W.blocks[i - 1], W.blocks[i]] = [W.blocks[i], W.blocks[i - 1]];
    if (a === 'down' && i < W.blocks.length - 1) [W.blocks[i + 1], W.blocks[i]] = [W.blocks[i], W.blocks[i + 1]];
    if (a === 'dup') W.blocks.splice(i + 1, 0, W.blocks[i]);
    if (a === 'copy') navigator.clipboard?.writeText(W.blocks[i]).then(() => toast('Markdown copié'), () => {});
    if (a === 'del') W.blocks.splice(i, 1);
    commitBlocks(); renderBlocks();
  };
}

/* ================= Context panel ================= */
let backCache = {key: null, data: null, time: 0, val: null};
function backlinksOf(n){
  const data = docs(), key = n.id + '|' + n.title;
  if (backCache.key === key && backCache.data === data && performance.now() - backCache.time < 15000) return backCache.val;
  const val = computeBacklinks(n); backCache = {key, data, time: performance.now(), val}; return val;
}
function computeBacklinks(n){
  const title = displayTitle(n).toLocaleLowerCase(), src = n.notion?.source ? notionUrl(n.notion.source, '', n.notion.root) : null, out = [];
  for (const e of docs().entries) {
    if (e.note === n) continue;
    const body = e.note.body || '';
    const hit = cachedWiki(e.note).some(t => t.toLocaleLowerCase() === title) || (src && body.includes(src));
    if (!hit) continue;
    const text = body.replace(/\s+/g, ' '), idx = text.toLocaleLowerCase().indexOf('[[' + title);
    out.push({note: e.note, snippet: idx >= 0 ? text.slice(Math.max(0, idx - 50), idx + title.length + 60).replace(/\((?:file|https?):[^)]*\)/g, '').replace(/\[!\w+\]|[#*_>`|]/g, '').replace(/\s+/g, ' ').trim() : ''});
    if (out.length >= 200) break;
  }
  return out;
}
function outgoingOf(n){
  const titles = cachedWiki(n), seen = new Set(), out = [];
  const index = new Map(docs().entries.map(e => [e.note.title.trim().toLocaleLowerCase(), e.note]));
  for (const t of titles) { const k = t.toLocaleLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push({title: t, note: index.get(k)}); }
  for (const m of String(n.body || '').matchAll(/(?<!!)\[([^\]]+)\]\((file:[^)]+)\)/g)) { const r = resolveUrl(m[2]); if (r && !seen.has(r.note.id)) { seen.add(r.note.id); out.push({title: r.note.title, note: r.note}); } }
  return out;
}
const renderContextSoon = debounce(() => renderContext(), 120);
function renderContext(){
  const host = $('wb-ctx-body'); if (!host) return;
  const t = W.tabs[W.active] || {};
  app.classList.toggle('wb-ctx-off', !W.ctx || t.type === 'home' || t.type === 'search');
  let n = t.type === 'note' ? noteOf(t.noteId) : t.type === 'graph' ? notes.find(x => x.id === selected) : null;
  if (!n) { host.innerHTML = `<div class="wb-ctx-empty">${t.type === 'graph' ? 'Clique une étoile ou une galaxie pour voir son aperçu ici.' : 'Ouvre une page pour voir son plan, ses liens et ses mentions.'}</div>`; return; }
  const outline = isDb(n) ? [] : String(n.body || '').split('\n').filter(l => /^#{1,4}\s/.test(l)).map(l => ({level: l.match(/^#+/)[0].length, text: l.replace(/^#+\s*/, '')})).filter((h, i) => !(i === 0 && h.level === 1 && h.text.trim().toLocaleLowerCase() === displayTitle(n).toLocaleLowerCase()));
  const back = backlinksOf(n), out = outgoingOf(n);
  const map = notes.includes(n) ? links.filter(e => e.includes(n.id) && e[2] !== 'wiki').map(e => notes.find(x => x.id === e.find(id => id !== n.id))).filter(Boolean) : [];
  const words = (String(n.body || '').match(/[\p{L}\p{N}’'-]+/gu) || []).length;
  const preview = t.type === 'graph' ? `<section class="wb-ctx-sec wb-ctx-preview"><div class="wb-ctx-head"><span>${esc(pageIcon(n))}</span><b>${esc(displayTitle(n))}</b></div><div class="markdown wb-ctx-md"></div><div class="wb-ctx-btns"><button class="share" data-open="${esc(n.id)}">Ouvrir la page</button>${!currentGalaxyId ? `<button class="control" data-galaxy="${esc(n.id)}">✧ Carte d’étoiles</button>` : ''}</div></section>` : '';
  host.innerHTML = `${preview}
    ${outline.length ? `<section class="wb-ctx-sec"><h4>Plan</h4>${outline.map(h => `<button class="wb-outline l${h.level}" data-heading="${esc(h.text)}">${esc(h.text)}</button>`).join('')}</section>` : ''}
    <section class="wb-ctx-sec"><h4>Mentions entrantes <small>${back.length}</small></h4>${back.map(b => `<button class="wb-link" data-open="${esc(b.note.id)}"><span>${esc(pageIcon(b.note))}</span><b>${esc(displayTitle(b.note))}</b>${b.snippet ? `<small>${esc(b.snippet)}</small>` : ''}</button>`).join('') || '<p class="wb-muted">Aucune page ne mentionne celle-ci. Écris <code>[[' + esc(displayTitle(n)) + ']]</code> ailleurs pour la relier.</p>'}</section>
    <section class="wb-ctx-sec"><h4>Liens sortants <small>${out.length}</small></h4>${out.map(o => o.note ? `<button class="wb-link" data-open="${esc(o.note.id)}"><span>${esc(pageIcon(o.note))}</span><b>${esc(displayTitle(o.note))}</b></button>` : `<button class="wb-link missing" data-create="${esc(o.title)}"><span>＋</span><b>${esc(o.title)}</b><small>Page à créer</small></button>`).join('') || '<p class="wb-muted">Tape <kbd>[[</kbd> dans le texte pour lier une page.</p>'}</section>
    ${map.length ? `<section class="wb-ctx-sec"><h4>Connexions du graphe <small>${map.length}</small></h4>${map.map(m => `<button class="wb-link" data-open="${esc(m.id)}"><span>${esc(pageIcon(m))}</span><b>${esc(displayTitle(m))}</b></button>`).join('')}</section>` : ''}
    <section class="wb-ctx-sec wb-ctx-info"><h4>Infos</h4><dl><dt>Modifiée</dt><dd>${n.updatedAt ? new Date(n.updatedAt).toLocaleString('fr-FR', {dateStyle: 'medium', timeStyle: 'short'}) : '—'}</dd>${isDb(n) ? `<dt>Lignes</dt><dd>${n.notion.rows.length}</dd>` : `<dt>Mots</dt><dd>${words.toLocaleString('fr-FR')} · ${Math.max(1, Math.round(words / 230))} min</dd>`}${n.notion?.source ? `<dt>Source</dt><dd class="wb-src" title="${esc(n.notion.source)}">${esc(n.notion.source.split('/').pop())}</dd>` : ''}</dl>${n.notion?.source && typeof nativeStore !== 'undefined' && nativeStore?.readImportFile ? '<button class="control" data-source>Voir le document Notion d’origine</button>' : ''}</section>`;
  const md = host.querySelector('.wb-ctx-md'); if (md) { md.innerHTML = isDb(n) ? `<p>Base de données · ${n.notion.rows.length} lignes</p>` : renderMarkdown(String(n.body || '').slice(0, 1800)); decorate(md); }
  host.onclick = e => {
    const o = e.target.closest('[data-open]'); if (o) return openNote(o.dataset.open, {newTab: e.ctrlKey || e.metaKey, replaceGraph: true});
    const g = e.target.closest('[data-galaxy]'); if (g) return openGalaxy(g.dataset.galaxy);
    const c = e.target.closest('[data-create]'); if (c) { const id = createPage(n.id, {title: c.dataset.create, open: false}); return openNote(id); }
    const h = e.target.closest('[data-heading]'); if (h) { const el = [...document.querySelectorAll('#wb-blocks h1,#wb-blocks h2,#wb-blocks h3,#wb-blocks h4')].find(x => x.textContent.trim() === h.dataset.heading.trim()); el?.scrollIntoView({behavior: 'smooth', block: 'start'}); el?.closest('.wb-block')?.classList.add('flash'); setTimeout(() => el?.closest('.wb-block')?.classList.remove('flash'), 1200); return; }
    if (e.target.closest('[data-source]')) return showSource(n);
  };
}
function showSource(n){
  const source = (n.notion.alternateSources || []).find(s => /\.html?$/i.test(s.source)) || n.notion;
  nativeStore.readImportFile(notionUrl(source.source, '', source.root), text => {
    const dlg = document.createElement('dialog'); dlg.className = 'wb-source-dialog';
    dlg.innerHTML = `<div class="recovery-head"><h2>Document d’origine</h2><button class="control" data-close>Fermer</button></div>`;
    if (!text) dlg.insertAdjacentHTML('beforeend', '<p>Source indisponible dans ce coffre.</p>');
    else if (/\.html?$/i.test(source.source)) { const f = document.createElement('iframe'); f.setAttribute('sandbox', ''); f.srcdoc = sanitizedSource(text, source.source, source.root); dlg.append(f); }
    else { const pre = document.createElement('pre'); pre.textContent = text; dlg.append(pre); }
    document.body.append(dlg); dlg.showModal(); dlg.querySelector('[data-close]').onclick = () => dlg.close(); dlg.onclose = () => dlg.remove();
  });
}

/* ================= Shell ================= */
function flushAll(){ flushBlockEdit(); commitBlocks(); flushEditorSave(); }
function buildShell(){
  app.classList.add('workbench');
  if (!W.side) app.classList.add('wb-side-off');
  const side = document.createElement('aside'); side.id = 'wb-side';
  side.innerHTML = `<div class="wb-side-top"><button id="wb-project" class="wb-project" title="Projets, imports et exports"><span class="wb-logo"></span><span id="wb-project-name"></span><span class="wb-caret-d">▾</span></button><button class="wb-iconbtn" id="wb-collapse" title="Masquer le panneau (Ctrl+\\)">⟨</button></div>
    <button class="wb-search-btn" id="wb-search-btn"><span>⌕</span>Rechercher<kbd>Ctrl K</kbd></button>
    <div class="wb-quick"><button id="wb-new" title="Nouvelle page (N)"><b>＋</b>Page</button><button id="wb-day" title="Journal du jour (J)"><b>◷</b>Journal</button><button id="wb-graph-btn" title="Graphe (G)"><b>✧</b>Graphe</button><button id="wb-home-btn" title="Accueil"><b>⌂</b></button></div>
    <div class="wb-scroll">
      <section class="wb-sec" id="wb-favs-section"><div class="wb-sec-head"><span>Favoris</span></div><div id="wb-favs"></div></section>
      <section class="wb-sec wb-sec-tree"><div class="wb-sec-head"><span>Pages <small id="wb-tree-count"></small></span><span><button data-collapse-all title="Tout replier">⊟</button><button data-new-root title="Nouvelle page">＋</button></span></div><div id="wb-tree" class="wb-tree"></div><div class="wb-root-drop" id="wb-root-drop">Déposer ici pour placer au premier niveau</div></section>
      <section class="wb-sec" id="wb-tags-section"><div class="wb-sec-head"><span>Tags</span><button data-search="#" title="Explorer les tags">⌕</button></div><div id="wb-tags" class="wb-tags"></div></section>
    </div>
    <div class="wb-side-bottom"><button id="wb-trash"><span>⌫</span>Corbeille <small id="wb-trash-count"></small></button><button id="wb-help" title="Raccourcis (?)">?</button></div>`;
  app.prepend(side);
  side.querySelector('.wb-side-bottom').prepend($('disk-status'));
  const tabs = document.createElement('header'); tabs.id = 'wb-tabs';
  tabs.innerHTML = `<button class="wb-iconbtn wb-show-side" id="wb-show-side" title="Afficher le panneau (Ctrl+\\)">⟩</button><div id="wb-tabs-list" class="wb-tabs-list"></div><div class="wb-tabs-right"></div><button class="wb-iconbtn" id="wb-ctx-toggle" title="Panneau de contexte (Ctrl+Alt+\\)">◨</button>`;
  tabs.querySelector('.wb-tabs-right').append(document.querySelector('.save-state'));
  app.append(tabs);
  const page = document.createElement('section'); page.id = 'wb-page'; app.append(page);
  const ctx = document.createElement('aside'); ctx.id = 'wb-ctx'; ctx.innerHTML = '<div id="wb-ctx-body" class="wb-ctx"></div>'; app.append(ctx);

  $('wb-project').onclick = e => projectMenu(e.currentTarget);
  $('wb-search-btn').onclick = () => openSearch();
  $('wb-new').onclick = () => createPage(null);
  $('wb-day').onclick = dailyNote;
  $('wb-graph-btn').onclick = () => openSpecial('graph');
  $('wb-home-btn').onclick = () => openSpecial('home');
  $('wb-trash').onclick = () => $('open-trash').click();
  $('wb-help').onclick = () => $('shortcuts-open')?.click();
  const toggleSide = () => { W.side = !W.side; store.set('cosmos-wb-side', W.side); app.classList.toggle('wb-side-off', !W.side); queueRender(); };
  $('wb-collapse').onclick = toggleSide; $('wb-show-side').onclick = toggleSide; W.toggleSide = toggleSide;
  $('wb-ctx-toggle').onclick = () => { W.ctx = !W.ctx; store.set('cosmos-wb-ctx', W.ctx); renderContext(); queueRender(); };
  side.querySelector('[data-new-root]').onclick = () => createPage(null);
  side.querySelector('[data-collapse-all]').onclick = () => { W.expanded.clear(); saveExpanded(); sideKey = ''; renderTree(); };
  side.addEventListener('click', e => {
    const tg = e.target.closest('[data-tag]'); if (tg) return openSearchTab('#' + tg.dataset.tag);
    const sr = e.target.closest('[data-search]'); if (sr) return openSearchTab(sr.dataset.search === '#' ? '' : sr.dataset.search);
    const more = e.target.closest('[data-more]'); if (more) { const k = more.dataset.more; W.treeLimits.set(k, (W.treeLimits.get(k) || TREE_PAGE) + TREE_PAGE); sideKey = ''; return renderTree(); }
    const tog = e.target.closest('[data-toggle]'); if (tog) { const id = tog.dataset.toggle; W.expanded.has(id) ? W.expanded.delete(id) : W.expanded.add(id); saveExpanded(); sideKey = ''; return renderTree(); }
    const add = e.target.closest('[data-add-child]'); if (add) return createPage(add.dataset.addChild);
    const m = e.target.closest('[data-row-menu]'); if (m) return nodeMenu(m, m.dataset.rowMenu);
    const row = e.target.closest('[data-node]'); if (!row) return;
    const id = row.dataset.node;
    if (id.startsWith('dir:')) { W.expanded.has(id) ? W.expanded.delete(id) : W.expanded.add(id); saveExpanded(); sideKey = ''; return renderTree(); }
    openNote(id, {newTab: e.ctrlKey || e.metaKey || e.button === 1});
  });
  side.addEventListener('auxclick', e => { const row = e.target.closest('[data-node]'); if (e.button === 1 && row && !row.dataset.node.startsWith('dir:')) { e.preventDefault(); openNote(row.dataset.node, {newTab: true}); } });
  side.addEventListener('contextmenu', e => { const row = e.target.closest('[data-node]'); if (!row || row.dataset.node.startsWith('dir:')) return; e.preventDefault(); nodeMenu(row, row.dataset.node); });
  // Tree drag & drop
  side.addEventListener('dragstart', e => { const row = e.target.closest?.('[data-node]'); if (!row || row.dataset.node.startsWith('dir:')) return; e.dataTransfer.setData('text/cosmos-page', row.dataset.node); e.dataTransfer.effectAllowed = 'move'; side.classList.add('dragging-page'); });
  side.addEventListener('dragend', () => { side.classList.remove('dragging-page'); side.querySelectorAll('.drop-into').forEach(x => x.classList.remove('drop-into')); });
  side.addEventListener('dragover', e => { if (!e.dataTransfer.types.includes('text/cosmos-page')) return; const row = e.target.closest('[data-node]'), zone = e.target.closest('#wb-root-drop'); if (!row && !zone) return; e.preventDefault(); side.querySelectorAll('.drop-into').forEach(x => x.classList.remove('drop-into')); (row || zone).classList.add('drop-into'); });
  side.addEventListener('drop', e => { const id = e.dataTransfer.getData('text/cosmos-page'); if (!id) return; const row = e.target.closest('[data-node]'), zone = e.target.closest('#wb-root-drop'); e.preventDefault(); side.classList.remove('dragging-page'); if (zone) return moveNote(id, null); if (row && row.dataset.node !== id) moveNote(id, row.dataset.node); });
  // Tabs
  tabs.addEventListener('click', e => {
    const x = e.target.closest('[data-close]'); if (x) { e.stopPropagation(); return closeTab(Number(x.dataset.close)); }
    if (e.target.closest('[data-newtab]')) { W.tabs.splice(W.active + 1, 0, {type: 'home'}); return activate(W.active + 1); }
    const t = e.target.closest('[data-tab]'); if (t) activate(Number(t.dataset.tab));
  });
  tabs.addEventListener('auxclick', e => { const t = e.target.closest('[data-tab]'); if (e.button === 1 && t) closeTab(Number(t.dataset.tab)); });
  tabs.addEventListener('dragstart', e => { const t = e.target.closest?.('[data-tab]'); if (t) e.dataTransfer.setData('text/cosmos-tab', t.dataset.tab); });
  tabs.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/cosmos-tab')) e.preventDefault(); });
  tabs.addEventListener('drop', e => { const from = Number(e.dataTransfer.getData('text/cosmos-tab')), t = e.target.closest('[data-tab]'); if (!t || isNaN(from)) return; const to = Number(t.dataset.tab); const cur = W.tabs[W.active]; const [m] = W.tabs.splice(from, 1); W.tabs.splice(to, 0, m); W.active = W.tabs.indexOf(cur); saveTabs(); renderTabs(); });
  bindPage();
  // Graph → context panel preview; graph double click stays "open star map".
  const main = document.getElementById('main');
  const openBtn = document.createElement('button'); openBtn.className = 'control'; openBtn.id = 'wb-graph-open'; openBtn.textContent = '▤ Ouvrir la page'; openBtn.title = 'Ouvrir la note sélectionnée comme page';
  openBtn.onclick = () => { if (selected) openNote(selected, {replaceGraph: true}); };
  document.querySelector('.graph-controls')?.prepend(openBtn);
  void main;
}

/* ================= Legacy hooks ================= */
function hook(name, after){ const base = window[name]; if (typeof base !== 'function') return; window[name] = function(...a){ const r = base.apply(this, a); try { after(...a); } catch (e) { console.warn('Cosmos workbench', name, e); } return r; }; }
hook('select', () => { if (W.tabs[W.active]?.type === 'graph') renderContextSoon(); });
hook('switchProject', () => { if (W.projectId !== activeProjectId) { loadProjectState(); bumpTree(); refreshSidebar(true); renderTabs(); activate(W.active); } });
hook('updateCounts', () => { if (W.projectId && W.projectId !== activeProjectId) { loadProjectState(); bumpTree(); renderTabs(); activate(W.active); } refreshSidebarSoon(); });
hook('restoreNoteFromTrash', () => { bumpTree(); refreshSidebar(true); });
hook('restoreArchivedProject', () => { bumpTree(); refreshSidebar(true); });
hook('importMarkdownNotes', () => { bumpTree(); refreshSidebar(true); });
hook('createProject', () => { loadProjectState(); bumpTree(); refreshSidebar(true); renderTabs(); activate(0); });
const baseSetDisplay = setDisplayMode;
setDisplayMode = function(mode){
  baseSetDisplay(mode);
  if (!W.ready) return;
  if (W.projectId !== activeProjectId) { loadProjectState(); bumpTree(); refreshSidebar(true); }
  if (mode === 'graph') { const idx = W.tabs.findIndex(t => t.type === 'graph'); if (W.tabs[W.active]?.type !== 'graph') { if (idx >= 0) W.active = idx; else { W.tabs.splice(W.active + 1, 0, {type: 'graph'}); W.active++; } } }
  else if (W.tabs[W.active]?.type === 'graph') { const idx = W.tabs.findIndex(t => t.type !== 'graph'); W.active = idx >= 0 ? idx : 0; if (W.tabs[W.active]?.type === 'graph') W.tabs[W.active] = {type: 'home'}; }
  saveTabs(); renderTabs(); renderCenter();
};
// The legacy side panel stays hidden: never let it overwrite pages edited here.
const baseCapture = captureEditor;
captureEditor = function(){
  const title = $('editor-title'), body = $('editor-body');
  if (W.ready && title && body && title.dataset.snap === title.value && body.dataset.snap === body.value) return;
  return baseCapture();
};
const baseRender = renderDetail;
renderDetail = function(){ baseRender(); const title = $('editor-title'), body = $('editor-body'); if (title && body) { title.dataset.snap = title.value; body.dataset.snap = body.value; } };
// Legacy entry points now land in the workbench.
openSearch = (orig => function(p = ''){ return orig(p); })(openSearch);

const baseProjectNotes = renderProjectNotes;
renderProjectNotes = function(){ if (W.ready) return; return baseProjectNotes(); };

/* ================= Keyboard ================= */
window.addEventListener('keydown', e => {
  if (!W.ready) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const typing = (el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable))(document.activeElement);
  if (mod && k === 't') { e.preventDefault(); e.stopImmediatePropagation(); W.tabs.splice(W.active + 1, 0, {type: 'home'}); return activate(W.active + 1); }
  if (mod && k === 'w') { e.preventDefault(); e.stopImmediatePropagation(); return closeTab(W.active); }
  if (mod && e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); return activate((W.active + (e.shiftKey ? -1 : 1) + W.tabs.length) % W.tabs.length); }
  if (mod && e.key === '\\') { e.preventDefault(); if (e.altKey) { W.ctx = !W.ctx; store.set('cosmos-wb-ctx', W.ctx); renderContext(); } else W.toggleSide(); return; }
  if (mod && e.shiftKey && k === 'f') { e.preventDefault(); e.stopImmediatePropagation(); return openSearchTab(''); }
  if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); return createPage(null); }
  if (mod && k === 's') { e.preventDefault(); e.stopImmediatePropagation(); flushAll(); saveWorkspace(); toast('Enregistré'); return; }
  if (typing || mod || e.altKey || document.querySelector('dialog[open]') || document.querySelector('#search-overlay.open')) return;
  const inGraph = W.tabs[W.active]?.type === 'graph';
  if (k === 'n') { e.preventDefault(); e.stopImmediatePropagation(); return createPage(null); }
  if (k === 'j') { e.preventDefault(); e.stopImmediatePropagation(); return dailyNote(); }
  if (k === 'g') { e.preventDefault(); e.stopImmediatePropagation(); return inGraph ? activate(W.tabs.findIndex(t => t.type !== 'graph') >= 0 ? W.tabs.findIndex(t => t.type !== 'graph') : 0) : openSpecial('graph'); }
  if (k === 'e' && !inGraph) { e.preventDefault(); e.stopImmediatePropagation(); if (W.noteId && $('wb-blocks')) { const vis = visibleBlocks(); vis.length ? editBlock(vis[vis.length - 1], 'end') : addBlockAt(W.blocks.length, ''); } return; }
  if (e.key === 'Enter' && inGraph && selected) { e.preventDefault(); e.stopImmediatePropagation(); return openNote(selected, {replaceGraph: true}); }
  if ((e.key === 'Delete') && !inGraph && W.noteId) { e.preventDefault(); e.stopImmediatePropagation(); return trashNote(W.noteId); }
}, true);
window.addEventListener('beforeunload', flushAll);
window.addEventListener('pagehide', flushAll);

/* ================= Boot ================= */
buildShell();
loadProjectState();
W.ready = true;
refreshSidebar(true); renderTabs(); activate(W.active);
// The native "new note" menu entry and the legacy buttons create pages here.
$('new-note-top').onclick = () => createPage(null);
$('day-note').onclick = dailyNote;
})();
