// Cosmos tools — command palette, graph filters, node actions, editor helpers and shortcuts.
(() => {
const $ = id => document.getElementById(id);
const isTyping = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, word) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;

/* ============ Saving: flush any pending camera save with editor saves ============ */
const flushEditor = flushEditorSave;
flushEditorSave = function(){ flushEditor(); if (pendingWorkspaceSave()) saveWorkspace(); };

/* ============ Faster wiki links in Markdown (title index per render) ============ */
const renderMd = renderMarkdown;
let titleIndex = null; const titleCache = {};
renderMarkdown = function(source, interactive = true){
  let data = null; try { data = projectDocuments(); } catch {}
  const c = titleCache;
  if (!c.map || c.data !== data || c.notes !== notes || c.len !== notes.length) {
    const map = new Map(); for (const n of notes) { const k = n.title.trim().toLocaleLowerCase(); if (!map.has(k)) map.set(k, n); }
    if (data) for (const e of data.entries) { const k = e.note.title.trim().toLocaleLowerCase(); if (!map.has(k)) map.set(k, e.note); }
    Object.assign(c, {map, data, notes, len: notes.length});
  }
  titleIndex = c.map;
  try { return renderMd(source, interactive).replace(/&lt;br\s*\/?&gt;/gi, '<br>'); } finally { titleIndex = null; }
};
const md = markdownEngine();
md.renderer.rules.cosmos_wiki = (tokens, i, options, env) => {
  const title = tokens[i].content, key = title.trim().toLocaleLowerCase();
  const target = titleIndex ? titleIndex.get(key) : notes.find(n => n.title.trim().toLocaleLowerCase() === key);
  return env.interactive ? `<a href="#" class="wiki-link${target ? '' : ' missing'}" ${target ? `data-linked="${escapeHtml(target.id)}"` : `data-create-wiki="${escapeHtml(title)}" title="Créer cette note"`}>${escapeHtml(title)}</a>` : `<span>${escapeHtml(title)}</span>`;
};

/* ============ Command palette (Ctrl+K) ============ */
const overlay = $('search-overlay'), input = $('search-input'), results = $('search-results');
input.placeholder = 'Rechercher une note… ou « > » pour les commandes';
const footer = document.createElement('div');
footer.className = 'search-footer';
footer.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>↵</kbd> ouvrir</span><span><kbd>&gt;</kbd> commandes</span><span><kbd>Échap</kbd> fermer</span>';
results.after(footer);
let paletteItems = [], paletteActive = 0, paletteStale = false;

function commands(){
  const galaxy = !!currentGalaxyId, list = [
    {label: 'Nouvelle page', hint: 'N', run: () => window.cosmosWorkbench?.ready ? cosmosWorkbench.createPage(null) : addNote()},
    {label: 'Nouvelle base de données', run: () => cosmosWorkbench?.createPage(null, {database: true, title: 'Nouvelle base'})},
    {label: 'Note du jour', hint: 'J', run: todayNote},
    {label: documentMode ? 'Afficher le graphe' : 'Afficher les documents', hint: 'G', run: () => setDisplayMode(documentMode ? 'graph' : 'documents')},
    {label: 'Vue 3D', hint: '3', run: () => { setDisplayMode('graph'); $('view3d').click(); }},
    {label: 'Vue 2D', hint: '2', run: () => { setDisplayMode('graph'); $('view2d').click(); }},
    {label: 'Tout voir dans le graphe', hint: 'F', run: () => { setDisplayMode('graph'); requestAnimationFrame(() => fitGraph()); }},
    {label: 'Organiser le graphe', hint: 'O', run: () => { setDisplayMode('graph'); organizeGraph(); }},
    {label: showLabels ? 'Masquer les libellés' : 'Afficher les libellés', hint: 'L', run: () => $('labels-toggle').click()},
    {label: neighborsOnly ? 'Afficher toutes les notes' : 'Seulement les connexions proches', run: () => $('neighbors-toggle').click()},
    {label: 'Centrer sur la note', hint: 'C', run: focusSelectedSmooth},
    {label: 'Écrire dans la note', hint: 'E', run: () => { if (selected) toggleWritingMode(); }},
    {label: 'Ajouter / retirer des favoris', run: () => $('favorite').click()},
    {label: 'Exporter la note en Markdown', run: exportMarkdown},
    {label: 'Exporter le projet (JSON)', run: exportVault},
    {label: 'Sauvegarder tous les projets', run: exportWorkspace},
    {label: 'Importer une sauvegarde JSON', run: () => $('backup-import').click()},
    {label: 'Importer des notes Markdown', run: chooseMarkdownFiles},
    {label: 'Ouvrir la corbeille', run: () => $('open-trash').click()},
    {label: 'Nouveau projet', run: () => openProjectDialog()},
    {label: 'Renommer le projet', run: () => openProjectDialog(true)},
    {label: 'Supprimer le projet', run: removeCurrentProject},
    {label: 'Coffre : ouvrir le dossier', run: () => openNativeVault()},
    {label: 'Coffre : changer de dossier…', run: () => window.openVaultPanel()},
    {label: 'Raccourcis clavier', hint: '?', run: openShortcuts},
  ];
  if (galaxy) list.unshift({label: '← Revenir aux galaxies', hint: 'Retour', run: leaveGalaxy});
  else if (selected) list.unshift({label: 'Ouvrir la carte d’étoiles', run: () => openGalaxy(selected)});
  for (const p of workspace.projects) if (p.id !== activeProjectId) list.push({label: 'Projet : ' + p.name, run: () => switchProject(p.id)});
  return list;
}
function highlight(text, term){
  const safe = escapeHtml(text); if (!term) return safe;
  const i = text.toLocaleLowerCase().indexOf(term); if (i < 0) return safe;
  return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + term.length)) + '</mark>' + escapeHtml(text.slice(i + term.length));
}
function snippet(body, term){
  const text = String(body || '').replace(/\s+/g, ' ');
  const i = text.toLocaleLowerCase().indexOf(term); if (i < 0) return '';
  const start = Math.max(0, i - 40), out = (start ? '…' : '') + text.slice(start, i + term.length + 70);
  return highlight(out, term);
}
searchRender = function(q){
  const raw = String(q || ''), cmdMode = raw.startsWith('>'), term = (cmdMode ? raw.slice(1) : raw).trim().toLocaleLowerCase();
  paletteItems = []; paletteActive = 0; paletteStale = false;
  let html = '';
  if (!cmdMode) {
    const docs = projectDocuments(), galaxyName = new Map(activeProject().notes.map(n => [n.id, n.title]));
    let found;
    if (!term) {
      found = [...docs.entries].sort((a, b) => String(b.note.updatedAt || '').localeCompare(String(a.note.updatedAt || ''))).slice(0, 8).map(e => ({e, score: 0}));
    } else {
      const words = term.split(/\s+/).filter(Boolean); found = [];
      for (const e of docs.entries) {
        const c = searchText(e.note); let score = 0, ok = true;
        for (const w of words) {
          if (c.lowTitle.startsWith(w)) score += 120; else if (c.lowTitle.includes(w)) score += 70;
          else if (c.text.includes(w)) score += 12; else { ok = false; break; }
        }
        if (ok) found.push({e, score: score - Math.min(30, c.lowTitle.length / 8)});
      }
      found.sort((a, b) => b.score - a.score); found = found.slice(0, 40);
    }
    if (found.length) html += `<div class="palette-section">${term ? plural(found.length, 'résultat') : 'Notes récentes'}</div>`;
    html += found.map(({e}, i) => {
      const n = e.note, where = e.galaxy ? '✧ ' + (galaxyName.get(e.galaxy) || 'Galaxie') : (n.group || 'Idées');
      const snip = term ? snippet(n.body, term.split(/\s+/)[0]) : '';
      paletteItems.push(() => { if (window.cosmosWorkbench?.ready) return cosmosWorkbench.openNote(n.id); openDocument(n.id); if (!documentMode) requestAnimationFrame(focusSelectedSmooth); });
      return `<button class="result" data-idx="${paletteItems.length - 1}" data-id="${escapeHtml(n.id)}"><i class="result-dot" style="background:${colors[n.group] || colors['Idées']}"></i><div class="result-main">${highlight(n.title, term.split(/\s+/)[0] || '')}<div class="result-sub">${escapeHtml(where)}${snip ? ' · ' + snip : ''}</div></div><span class="result-key">${i === 0 ? '↵' : ''}</span></button>`;
    }).join('');
    if (term && !found.length) html += `<div class="palette-empty">Aucune note trouvée pour « ${escapeHtml(term)} ».</div>`;
  }
  const cmds = commands().filter(c => cmdMode ? (!term || c.label.toLocaleLowerCase().includes(term)) : !term).slice(0, cmdMode ? 40 : 5);
  if (!cmdMode && term) {
    paletteItems.push(() => { if (window.cosmosWorkbench?.ready) return cosmosWorkbench.createPage(null, {title: raw.trim()}); addNote(); const t = $('editor-title'); if (t) { t.value = raw.trim(); captureEditor(); } });
    html += `<button class="cmd-result" data-idx="${paletteItems.length - 1}"><span class="cmd-icon">＋</span><span>Créer « ${escapeHtml(raw.trim())} »</span><kbd>${currentGalaxyId ? 'étoile' : 'galaxie'}</kbd></button>`;
  }
  if (cmds.length) {
    html += `<div class="palette-section">${cmdMode ? 'Commandes' : 'Actions rapides'}</div>`;
    html += cmds.map(c => { paletteItems.push(c.run); return `<button class="cmd-result" data-idx="${paletteItems.length - 1}"><span class="cmd-icon">›</span><span>${highlight(c.label, term)}</span>${c.hint ? `<kbd>${escapeHtml(c.hint)}</kbd>` : ''}</button>`; }).join('');
  }
  if (cmdMode && !cmds.length) html += '<div class="palette-empty">Aucune commande.</div>';
  results.innerHTML = html;
  results.querySelectorAll('[data-idx]').forEach(b => {
    b.onclick = () => runPalette(Number(b.dataset.idx));
    b.onmousemove = () => setPaletteActive(Number(b.dataset.idx), false);
  });
  setPaletteActive(0, false);
};
function setPaletteActive(i, scroll = true){
  const items = results.querySelectorAll('[data-idx]'); if (!items.length) return;
  paletteActive = (i + items.length) % items.length;
  items.forEach(el => el.classList.toggle('active', Number(el.dataset.idx) === paletteActive));
  if (scroll) results.querySelector(`[data-idx="${paletteActive}"]`)?.scrollIntoView({block: 'nearest'});
}
function runPalette(i){ const run = paletteItems[i]; closePalette(); run?.(); }
function closePalette(){ overlay.classList.remove('open'); }
openSearch = function(prefix = ''){
  overlay.classList.add('open'); input.value = prefix; query = ''; searchRender(prefix); input.focus();
};
const liveSearch = debounce(v => searchRender(v), 70);
input.addEventListener('input', e => { if (projectDocuments().entries.length > 1500) { paletteStale = true; liveSearch(e.target.value); } else searchRender(e.target.value); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteActive(paletteActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteActive(paletteActive - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); if (paletteStale) searchRender(input.value); runPalette(paletteActive); }
  else if (e.key === 'Escape') closePalette();
});
overlay.addEventListener('click', e => { if (e.target === overlay) closePalette(); });
$('search-open').innerHTML = '<span class="search-pill-icon">⌕</span><span class="search-pill-text">Rechercher</span><kbd>Ctrl K</kbd>';
$('search-open').classList.add('search-pill');
$('search-open').onclick = () => openSearch();

/* ============ Graph filter panel ============ */
const filterBtn = $('filter-btn');
const panel = document.createElement('div');
panel.className = 'graph-popover'; panel.id = 'filter-panel'; panel.hidden = true;
document.querySelector('.graph-controls').append(panel);
panel.innerHTML = `<div class="popover-title">Filtrer le graphe</div>
  <input id="graph-query" type="search" placeholder="Mot, tag, titre…" autocomplete="off" aria-label="Filtrer par texte">
  <div class="popover-label">Espaces</div><div class="chip-row" id="filter-groups"></div>
  <div class="popover-label">Afficher</div><div class="chip-row" id="filter-views"></div>
  <label class="popover-check"><input type="checkbox" id="filter-neighbors"> Seulement les voisins de la note ouverte</label>
  <button class="control" id="filter-reset">Réinitialiser</button>`;
function renderFilterPanel(){
  const counts = {all: notes.length}; for (const n of notes) counts[n.group] = (counts[n.group] || 0) + 1;
  $('filter-groups').innerHTML = ['all', 'Idées', 'Recherche', 'Projets', 'Journal'].map(g => `<button class="chip ${filter === g ? 'on' : ''}" data-f="${g}">${g !== 'all' ? `<i style="background:${colors[g]}"></i>` : ''}${g === 'all' ? 'Tout' : g}<small>${counts[g] || 0}</small></button>`).join('');
  $('filter-views').innerHTML = [['favorites', '☆ Favoris'], ['recent', '◷ Récents'], ['inbox', '⌑ Isolées']].map(([f, l]) => `<button class="chip ${filter === f ? 'on' : ''}" data-f="${f}">${l}</button>`).join('');
  panel.querySelectorAll('[data-f]').forEach(b => b.onclick = () => applyFilter(b.dataset.f === filter ? 'all' : b.dataset.f));
  $('filter-neighbors').checked = neighborsOnly;
  if (document.activeElement !== $('graph-query')) $('graph-query').value = query;
}
function applyFilter(f){
  filter = f;
  document.querySelectorAll('.folder').forEach(el => el.classList.toggle('selected', el.dataset.filter === f));
  const nav = {favorites: 'Favoris', recent: 'Récents', inbox: 'Boîte de réception'}[f] || 'Graphe global';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === nav));
  draw(); renderFilterPanel();
}
window.updateFilterBadge = () => {
  const active = filter !== 'all' || !!query || neighborsOnly;
  filterBtn.classList.toggle('on', active || !panel.hidden);
  filterBtn.dataset.active = active ? '1' : '';
  if (!panel.hidden) renderFilterPanel();
};
filterBtn.onclick = e => { e.stopPropagation(); panel.hidden = !panel.hidden; if (!panel.hidden) { renderFilterPanel(); $('graph-query').focus(); } window.updateFilterBadge(); };
filterBtn.title = 'Filtrer par espace, texte ou voisinage';
const applyQuery = debounce(v => { query = v.trim(); draw(); }, 140);
$('graph-query').addEventListener('input', e => applyQuery(e.target.value));
$('graph-query').addEventListener('keydown', e => { if (e.key === 'Escape') { panel.hidden = true; window.updateFilterBadge(); } });
$('filter-neighbors').onchange = e => { neighborsOnly = e.target.checked; draw(); };
$('filter-reset').onclick = () => { query = ''; neighborsOnly = false; $('graph-query').value = ''; applyFilter('all'); };
panel.addEventListener('pointerdown', e => e.stopPropagation());

/* ============ Node context menu ============ */
const menu = document.createElement('div');
menu.className = 'graph-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
document.body.append(menu);
window.openNodeMenu = (id, x, y) => {
  const n = notes.find(v => v.id === id); if (!n) return;
  const sel = selected && selected !== id ? notes.find(v => v.id === selected) : null;
  const linked = sel && links.some(e => e.includes(id) && e.includes(sel.id));
  const items = [
    ['Ouvrir', () => select(id)],
    ['Écrire', () => { select(id); editing = true; renderDetail(); $('editor-body')?.focus(); }],
    ...(!currentGalaxyId ? [['✧ Ouvrir la carte d’étoiles', () => openGalaxy(id)]] : []),
    ['Centrer', () => { select(id); focusSelectedSmooth(); }],
    ...(sel ? [[linked ? `Délier de « ${sel.title.slice(0, 26)} »` : `Relier à « ${sel.title.slice(0, 26)} »`, () => {
      if (linked) { links.splice(0, links.length, ...links.filter(e => !(e.includes(id) && e.includes(sel.id) && e[2] !== 'wiki'))); toast(links.some(e => e.includes(id) && e.includes(sel.id)) ? 'Lien [[wiki]] conservé : retire-le du texte' : 'Connexion retirée'); }
      else { links.push([sel.id, id]); toast('Connexion créée'); }
      persist(); draw(); renderDetail();
    }]] : []),
    [n.favorite ? '★ Retirer des favoris' : '☆ Ajouter aux favoris', () => { n.favorite = !n.favorite; persist(); draw(); renderDetail(); }],
    ['Déplacer dans la corbeille', () => { select(id); trashSelectedNote(); }, 'danger'],
  ];
  menu.innerHTML = `<div class="menu-title">${escapeHtml(n.title)}</div>` + items.map(([l, , c], i) => `<button role="menuitem" data-i="${i}" class="${c || ''}">${escapeHtml(l)}</button>`).join('');
  menu.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeGraphMenus(); items[Number(b.dataset.i)][1](); });
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menu.querySelector('button')?.focus();
};
function closeGraphMenus(){ menu.hidden = true; }
window.closeGraphMenus = closeGraphMenus;
document.addEventListener('pointerdown', e => {
  if (!menu.hidden && !menu.contains(e.target)) closeGraphMenus();
  if (!panel.hidden && !panel.contains(e.target) && e.target !== filterBtn) { panel.hidden = true; window.updateFilterBadge(); }
});
menu.addEventListener('keydown', e => {
  const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === 'Escape') closeGraphMenus();
});

/* ============ Graph toolbar additions ============ */
const fit = document.createElement('button');
fit.id = 'fit-graph'; fit.title = 'Tout voir (F)'; fit.textContent = '⤢';
$('center').after(fit); fit.onclick = () => fitGraph();
$('center').title = 'Réinitialiser la caméra (0)';
$('zoom-in').title = 'Zoomer (+)'; $('zoom-out').title = 'Dézoomer (−)';
$('labels-toggle').title = 'Libellés (L)'; $('focus-note').title = 'Centrer sur la note ouverte (C)';
$('layout-graph').title = 'Placement automatique (O) — Échap pour arrêter';
$('view3d').title = 'Vue 3D (3)'; $('view2d').title = 'Vue 2D (2)';
$('focus-note').onclick = focusSelectedSmooth;
const hint = document.querySelector('.graph-hint');
hint.innerHTML = '<span>Glisser : orbite</span><span>Molette : zoom</span><span>Maj + glisser : déplacer</span><span>Clic droit sur une note : actions</span><span><kbd>F</kbd> tout voir</span><span><kbd>?</kbd> raccourcis</span>';
let hintSeen = false; try { hintSeen = localStorage.getItem('cosmos-graph-hint') === 'seen'; } catch {}
if (hintSeen) hint.classList.add('faded');
window.markGraphUsed = () => { if (hintSeen) return; hintSeen = true; setTimeout(() => hint.classList.add('faded'), 2500); try { localStorage.setItem('cosmos-graph-hint', 'seen'); } catch {} };
hint.addEventListener('mouseenter', () => hint.classList.remove('faded'));
document.getElementById('edit-note').textContent = '✎';
document.getElementById('edit-note').title = 'Modifier (E)';
$('note-menu').title = 'Déplacer dans la corbeille (Suppr)';
$('day-note').title = 'Note du jour (J)';
$('new-note-top').title = 'Nouvelle note (N)';

/* ============ Shortcuts dialog ============ */
const dlg = document.createElement('dialog');
dlg.id = 'shortcuts-dialog';
const rows = [
  ['Général', [['Ctrl K', 'Rechercher / commandes'], ['Ctrl Maj F', 'Recherche plein écran'], ['N · Ctrl N', 'Nouvelle page'], ['J', 'Journal du jour'], ['G', 'Graphe ↔ pages'], ['Ctrl T', 'Nouvel onglet'], ['Ctrl W', 'Fermer l’onglet'], ['Ctrl Tab', 'Onglet suivant'], ['Ctrl \\', 'Masquer le panneau gauche'], ['Ctrl Alt \\', 'Masquer le panneau droit'], ['?', 'Cette aide']]],
  ['Écriture', [['clic', 'Modifier un bloc'], ['/', 'Insérer un bloc (titre, liste, base…)'], ['[[', 'Lier une page'], ['Entrée', 'Nouveau bloc / continue une liste'], ['↑ ↓', 'Bloc précédent / suivant'], ['Ctrl B / I', 'Gras / italique'], ['Tab', 'Indenter'], ['Échap', 'Terminer le bloc'], ['E', 'Écrire en fin de page'], ['Suppr', 'Page à la corbeille']]],
  ['Graphe', [['F', 'Tout voir'], ['C', 'Centrer'], ['Entrée', 'Ouvrir la page sélectionnée'], ['0', 'Réinitialiser la caméra'], ['+ / −', 'Zoom'], ['2 / 3', 'Vue 2D / 3D'], ['L', 'Libellés'], ['O', 'Organiser'], ['Retour', 'Revenir aux galaxies'], ['Clic droit', 'Actions']]],
];
dlg.innerHTML = `<div class="recovery-head"><h2>Raccourcis clavier</h2><button class="control" data-close>Fermer</button></div><div class="shortcut-grid">${rows.map(([t, list]) => `<section><h3>${t}</h3>${list.map(([k, d]) => `<div><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span></div>`).join('')}</section>`).join('')}</div>`;
document.body.append(dlg);
dlg.querySelector('[data-close]').onclick = () => dlg.close();
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
function openShortcuts(){ if (!dlg.open) dlg.showModal(); }
const help = document.createElement('button');
help.className = 'iconbtn'; help.id = 'shortcuts-open'; help.title = 'Raccourcis clavier (?)'; help.textContent = '?';
help.onclick = openShortcuts;
document.querySelector('.top-actions').insertBefore(help, $('share'));

/* ============ Global keyboard ============ */
window.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey, k = e.key;
  if (mod && k.toLowerCase() === 'k') { e.preventDefault(); overlay.classList.contains('open') ? closePalette() : openSearch(); return; }
  if (mod && k.toLowerCase() === 's') { e.preventDefault(); if (editing) saveEdit(); else saveWorkspace(); return; }
  if (k === 'Escape') {
    if (overlay.classList.contains('open')) { closePalette(); return; }
    if (!menu.hidden || !panel.hidden) { closeGraphMenus(); panel.hidden = true; window.updateFilterBadge(); return; }
    if (layoutFrame) { cancelLayout(); persist(); draw(); toast('Placement arrêté · ↶ pour annuler'); return; }
    if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
    return;
  }
  if (mod || e.altKey || isTyping(document.activeElement) || document.querySelector('dialog[open]') || overlay.classList.contains('open')) return;
  const graph = !documentMode;
  const act = {
    'n': addNote, 'j': todayNote, '?': openShortcuts, '/': () => openSearch(),
    'g': () => setDisplayMode(documentMode ? 'graph' : 'documents'),
    'e': () => { if (selected && !editing) toggleWritingMode(); },
    'Delete': () => { if (selected) trashSelectedNote(); },
    'Backspace': () => { if (currentGalaxyId && graph) leaveGalaxy(); },
  };
  const graphAct = {
    'f': () => fitGraph(), 'c': focusSelectedSmooth, 'l': () => $('labels-toggle').click(), 'o': organizeGraph,
    '0': () => $('center').click(), '+': () => zoomAt(1.2), '=': () => zoomAt(1.2), '-': () => zoomAt(1 / 1.2),
    '2': () => $('view2d').click(), '3': () => $('view3d').click(),
  };
  const fn = act[k] || act[k.toLowerCase()] || (graph && (graphAct[k] || graphAct[k.toLowerCase()]));
  if (fn) { e.preventDefault(); fn(); }
});
window.addEventListener('resize', () => queueRender());

/* ============ Detail panel: link picker and editor helpers ============ */
const baseRenderDetail = renderDetail;
renderDetail = function(){
  baseRenderDetail();
  enhanceLinkPicker();
  enhanceEditor();
};
function enhanceLinkPicker(){
  const search = $('connect-search'), box = $('connect-suggest'), hidden = $('connect-target');
  if (!search || !box) return;
  const current = notes.find(n => n.id === selected); if (!current) return;
  let options = [], active = 0;
  const show = () => {
    const term = search.value.trim().toLocaleLowerCase();
    if (!term) { box.hidden = true; hidden.value = ''; return; }
    ensureModel();
    const linked = G.adj.get(current.id) || new Set(); options = [];
    for (const n of notes) {
      if (n.id === current.id || linked.has(n.id)) continue;
      const t = n.title.toLocaleLowerCase(), i = t.indexOf(term); if (i < 0) continue;
      options.push({n, s: (i === 0 ? 0 : 1) + t.length / 1000}); if (options.length > 400) break;
    }
    options.sort((a, b) => a.s - b.s); options = options.slice(0, 8).map(o => o.n); active = 0;
    box.innerHTML = options.map((n, i) => `<button role="option" data-i="${i}" class="${i === 0 ? 'active' : ''}"><i style="background:${colors[n.group] || colors['Idées']}"></i><span>${highlight(n.title, term)}</span></button>`).join('') || '<p>Aucune note correspondante</p>';
    box.hidden = false; hidden.value = options[0]?.id || '';
    box.querySelectorAll('[data-i]').forEach(b => { b.onmousedown = ev => ev.preventDefault(); b.onclick = () => choose(Number(b.dataset.i)); });
  };
  const choose = i => { const n = options[i]; if (!n) return; hidden.value = n.id; box.hidden = true; $('connect-note').click(); };
  search.addEventListener('input', debounce(show, 60));
  search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!options.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; box.querySelectorAll('[data-i]').forEach(b => b.classList.toggle('active', Number(b.dataset.i) === active)); hidden.value = options[active].id; }
    if (e.key === 'Enter') { e.preventDefault(); show(); choose(active); }
    if (e.key === 'Escape') { box.hidden = true; }
  });
  search.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  $('connect-note').onmousedown = e => e.preventDefault();
  const click = $('connect-note').onclick;
  $('connect-note').onclick = () => { if (!hidden.value && search.value.trim()) { show(); hidden.value = options[0]?.id || ''; } click?.(); };
}

// ---- Editor ----
const suggest = document.createElement('div');
suggest.className = 'wiki-suggest'; suggest.hidden = true; suggest.setAttribute('role', 'listbox');
document.body.append(suggest);
let wikiState = null;
function caretCoords(ta, pos){
  const div = document.createElement('div'), cs = getComputedStyle(ta);
  for (const p of ['boxSizing','width','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','paddingTop','paddingRight','paddingBottom','paddingLeft','fontStyle','fontVariant','fontWeight','fontSize','lineHeight','fontFamily','letterSpacing','wordSpacing','tabSize','textIndent'])div.style[p] = cs[p];
  Object.assign(div.style, {position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px', height: 'auto'});
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span'); span.textContent = ta.value.slice(pos, pos + 1) || '.'; div.append(span);
  document.body.append(div);
  const r = ta.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
  const out = {x: r.left + span.offsetLeft - ta.scrollLeft, y: r.top + span.offsetTop - ta.scrollTop + lh};
  div.remove(); return out;
}
function closeWiki(){ suggest.hidden = true; wikiState = null; }
function updateWiki(ta){
  const pos = ta.selectionStart, before = ta.value.slice(Math.max(0, pos - 80), pos), m = before.match(/\[\[([^\]\n\[]{0,60})$/);
  if (!m || ta.selectionStart !== ta.selectionEnd) return closeWiki();
  const term = m[1].toLocaleLowerCase(), self = notes.find(n => n.id === selected);
  let list = [];
  for (const n of (() => { try { return projectDocuments().entries.map(e => e.note); } catch { return notes; } })()) {
    if (n === self) continue;
    const t = n.title.toLocaleLowerCase(), i = term ? t.indexOf(term) : 0; if (i < 0) continue;
    list.push({n, s: (i === 0 ? 0 : 1) + t.length / 1000}); if (list.length > 600) break;
  }
  list.sort((a, b) => a.s - b.s); list = list.slice(0, 7).map(o => o.n);
  const exact = list.some(n => n.title.toLocaleLowerCase() === term.trim());
  wikiState = {ta, start: pos - m[1].length, term: m[1], list, active: 0, create: m[1].trim() && !exact ? m[1].trim() : null};
  renderWiki();
  const c = caretCoords(ta, pos - m[0].length);
  suggest.style.left = Math.min(c.x, innerWidth - 300) + 'px'; suggest.style.top = Math.min(c.y + 4, innerHeight - 260) + 'px';
}
function renderWiki(){
  const s = wikiState; if (!s) return;
  const rows = s.list.map((n, i) => `<button data-i="${i}" class="${i === s.active ? 'active' : ''}"><i style="background:${colors[n.group] || colors['Idées']}"></i><span>${highlight(n.title, s.term.toLocaleLowerCase())}</span></button>`);
  if (s.create) rows.push(`<button data-i="${s.list.length}" class="create ${s.active === s.list.length ? 'active' : ''}">＋ Lien vers une nouvelle note « ${escapeHtml(s.create)} »</button>`);
  if (!rows.length) return closeWiki();
  suggest.innerHTML = '<div class="wiki-suggest-head">Relier une note · ↵ pour insérer</div>' + rows.join('');
  suggest.hidden = false;
  suggest.querySelectorAll('[data-i]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => applyWiki(Number(b.dataset.i)); });
}
function applyWiki(i){
  const s = wikiState; if (!s) return;
  const title = i < s.list.length ? s.list[i].title : s.create; if (!title) return closeWiki();
  const ta = s.ta, end = ta.selectionStart, after = ta.value.slice(end, end + 2) === ']]' ? 2 : 0;
  ta.setRangeText(title + ']]', s.start, end + after, 'end');
  closeWiki(); ta.focus(); (ta._assistChange || captureEditor)();
}
function wrapSelection(ta, a, b){
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  if (sel.startsWith(a) && sel.endsWith(b) && sel.length >= a.length + b.length) ta.setRangeText(sel.slice(a.length, sel.length - b.length), s, e, 'select');
  else { ta.setRangeText(a + sel + b, s, e, 'select'); if (!sel) ta.setSelectionRange(s + a.length, s + a.length); }
  (ta._assistChange || captureEditor)();
}
function updateStats(ta){
  const status = document.querySelector('.editor-status'); if (!status) return;
  const words = (ta.value.match(/[\p{L}\p{N}’'-]+/gu) || []).length, minutes = Math.max(1, Math.round(words / 230));
  status.innerHTML = `<span>Enregistrement automatique</span><span>${plural(words, 'mot')} · ${minutes} min de lecture</span><span><kbd>[[</kbd> lier · <kbd>Ctrl S</kbd> terminer</span>`;
}
function enhanceEditor(){
  const ta = $('editor-body'); if (!ta || ta.dataset.enhanced) return;
  const stats = debounce(() => updateStats(ta), 250); updateStats(ta);
  ta.addEventListener('input', stats);
  attachAssist(ta);
}
// Shared writing assistance: [[ suggestions, Ctrl+B/I, list continuation.
function attachAssist(ta, onChange){
  if (ta.dataset.enhanced) return; ta.dataset.enhanced = '1';
  if (onChange) ta._assistChange = onChange;
  const change = () => (ta._assistChange || captureEditor)();
  ta.addEventListener('input', () => updateWiki(ta));
  ta.addEventListener('click', () => updateWiki(ta));
  ta.addEventListener('blur', () => setTimeout(() => { if (wikiState?.ta === ta && document.activeElement !== ta) closeWiki(); }, 120));
  ta.addEventListener('scroll', () => { if (wikiState) updateWiki(ta); });
  ta.addEventListener('keydown', e => {
    if (wikiState && !suggest.hidden) {
      const count = wikiState.list.length + (wikiState.create ? 1 : 0);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); wikiState.active = (wikiState.active + (e.key === 'ArrowDown' ? 1 : -1) + count) % count; renderWiki(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); applyWiki(wikiState.active); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWiki(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSelection(ta, '**', '**'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSelection(ta, '*', '*'); return; }
    if (e.key === 'Enter' && !e.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
      const pos = ta.selectionStart, lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1, line = ta.value.slice(lineStart, pos);
      const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)[.)] |> )/);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[2].trim()) { ta.setRangeText('', lineStart, pos, 'end'); change(); ta._listEnded = true; return; }
      let prefix = m[1] + m[2].replace(/\[[xX]\]/, '[ ]');
      if (m[3]) prefix = m[1] + (Number(m[3]) + 1) + m[2].slice(m[3].length);
      ta.setRangeText('\n' + prefix, pos, pos, 'end'); change();
    }
  }, true);
}
window.attachEditorAssist = attachAssist;
window.closeEditorAssist = () => closeWiki();
document.addEventListener('scroll', e => { if (!wikiState) return; if (e.target === wikiState.ta || (e.target.contains && e.target.contains(wikiState.ta))) { if (wikiState.ta.isConnected) updateWiki(wikiState.ta); } else closeWiki(); }, true);

/* ============ Vault folder panel ============ */
const vaultDlg = document.createElement('dialog');
vaultDlg.id = 'vault-dialog';
document.body.append(vaultDlg);
window.openVaultPanel = () => {
  const native = typeof nativeStore !== 'undefined' && nativeStore;
  vaultDlg.innerHTML = `<div class="recovery-head"><h2>Coffre Cosmos</h2><button class="control" data-close>Fermer</button></div>
    <p class="vault-text">Le coffre contient <code>workspace.json</code>, les copies Markdown, les sauvegardes datées et les fichiers importés de Notion.</p>
    <div class="vault-path"><small>DOSSIER ACTUEL</small><code id="vault-path">${native ? 'Chargement…' : 'Disponible dans l’application de bureau'}</code></div>
    <div class="vault-actions"><button class="share" data-open ${native ? '' : 'disabled'}>Ouvrir le dossier</button><button class="control" data-choose ${native ? '' : 'disabled'}>Choisir un autre dossier…</button><button class="control" data-reset ${native ? '' : 'disabled'}>Dossier par défaut</button></div>
    <p class="vault-note">Un dossier vide reçoit une copie du coffre actuel. Un dossier contenant déjà un <code>workspace.json</code> est ouvert tel quel. Cosmos redémarre pour basculer.</p>`;
  vaultDlg.querySelector('[data-close]').onclick = () => vaultDlg.close();
  if (native) {
    nativeStore.vaultPath(p => { const el = vaultDlg.querySelector('#vault-path'); if (el) el.textContent = p; });
    vaultDlg.querySelector('[data-open]').onclick = () => nativeStore.openFolder();
    const restart = msg => { if (confirm(msg + '\n\nRedémarrer Cosmos maintenant ?')) { flushEditorSave(); saveWorkspace(); setTimeout(() => nativeStore.restartApp(), 300); } };
    vaultDlg.querySelector('[data-choose]').onclick = () => { flushEditorSave(); saveWorkspace(); nativeStore.chooseFolder(dir => { if (dir) restart('Nouveau dossier du coffre : ' + dir); }); };
    vaultDlg.querySelector('[data-reset]').onclick = () => { nativeStore.resetFolder(); restart('Le dossier par défaut sera utilisé au prochain démarrage.'); };
  }
  if (!vaultDlg.open) vaultDlg.showModal();
};
$('disk-status').onclick = () => window.openVaultPanel();
$('disk-status').removeAttribute('onclick');
$('disk-status').title = 'Coffre : ouvrir ou changer de dossier';

/* ============ Boot ============ */
initializeCosmos();
if (!documentMode && notes.length > 1 && !activeProject().camera) requestAnimationFrame(() => fitGraph(false));
})();
