// Cosmos databases — typed properties and Notion-like views (table, board, calendar, gallery, list).
// A database lives in note.notion = {kind:'database', columns, rows, schema, views, activeView}.
const DB_TYPES = {
  title: {label: 'Titre', icon: 'Aa'}, text: {label: 'Texte', icon: '≡'}, number: {label: 'Nombre', icon: '#'},
  select: {label: 'Sélection', icon: '◉'}, status: {label: 'Statut', icon: '◐'}, multi_select: {label: 'Multi-sélection', icon: '☰'},
  date: {label: 'Date', icon: '◷'}, checkbox: {label: 'Case à cocher', icon: '☑'}, url: {label: 'Lien', icon: '↗'},
  email: {label: 'E-mail', icon: '@'}, phone: {label: 'Téléphone', icon: '☏'}, person: {label: 'Personne', icon: '☺'},
  relation: {label: 'Relation', icon: '⇄'}, files: {label: 'Fichiers', icon: '⎙'}, formula: {label: 'Formule', icon: 'ƒ'},
};
const DB_OPTION_COLORS = ['#8fa4ff', '#74dfec', '#c396ff', '#ffc58e', '#9be3a7', '#ff9fb2', '#f5e27a', '#a9b4c8', '#7fd4ff', '#e3a8ff'];
const DB_MONTHS = {janvier:0,février:1,fevrier:1,mars:2,avril:3,mai:4,juin:5,juillet:6,août:7,aout:7,septembre:8,octobre:9,novembre:10,décembre:11,decembre:11,
  january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
  janv:0,févr:1,fevr:1,avr:3,juil:6,sept:8,oct:9,nov:10,déc:11,dec:11,jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8};

function dbParseDate(value){
  const s = String(value || '').split(/\s+(?:→|->)\s+/)[0].trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/); if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})\s+([\p{L}.]+)\s+(\d{4})/u); if (m) { const mo = DB_MONTHS[m[2].toLowerCase().replace('.', '')]; if (mo != null) return new Date(+m[3], mo, +m[1]); }
  m = s.match(/^([\p{L}.]+)\s+(\d{1,2}),?\s+(\d{4})/u); if (m) { const mo = DB_MONTHS[m[1].toLowerCase().replace('.', '')]; if (mo != null) return new Date(+m[3], mo, +m[2]); }
  return null;
}
const dbIso = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
const dbTruthy = v => /^(yes|oui|true|1|✓|✔|x|vrai|checked)$/i.test(String(v || '').trim());
// "Page (Page%20abc123.md), Autre (…)" → "Page, Autre" (Notion Markdown/CSV relations).
function dbCleanRelation(v){ return String(v || '').replace(/\s*\((?:[^()]|\([^()]*\))*?\.(?:md|html|csv)\)/gi, '').replace(/\s*\(https?:\/\/(?:www\.)?notion\.so[^)]*\)/gi, '').trim(); }
function dbSplit(v){ return String(v || '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean); }

function dbInferType(name, values, total, isFirst){
  if (isFirst) return 'title';
  const vals = values.map(v => String(v ?? '').trim()).filter(Boolean);
  if (!vals.length) return /date|échéance|deadline/i.test(name) ? 'date' : 'text';
  const all = re => vals.every(v => re.test(v));
  if (vals.some(v => /\.(md|html)\)/i.test(v))) return 'relation';
  if (all(/^(yes|no|oui|non|true|false|vrai|faux)$/i)) return 'checkbox';
  if (all(/^-?[\d\s ]+([.,]\d+)?\s*[%€$]?$/)) return 'number';
  if (vals.every(v => dbParseDate(v))) return 'date';
  if (all(/^https?:\/\/\S+$/i)) return 'url';
  if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return 'email';
  const avg = vals.reduce((s, v) => s + v.length, 0) / vals.length;
  const tokens = vals.flatMap(dbSplit), distinctTokens = new Set(tokens).size;
  if (vals.some(v => v.includes(', ')) && distinctTokens <= Math.max(15, total * .5) && tokens.every(t => t.length < 40)) return 'multi_select';
  const distinct = new Set(vals).size;
  if (/statut|status|état|etat/i.test(name) && distinct <= 20) return 'status';
  if (/tags?|étiquettes?|catégories?|categories?/i.test(name) && avg < 60) return 'multi_select';
  if (vals.length >= 2 && distinct <= Math.max(3, Math.min(20, total * .45)) && avg < 32) return 'select';
  return 'text';
}
function dbOptions(d, col){
  const s = d.schema[col]; if (!s) return [];
  if (!Array.isArray(s.options)) s.options = [];
  const known = new Set(s.options.map(o => o.name));
  const add = name => { if (name && !known.has(name)) { known.add(name); s.options.push({name, color: DB_OPTION_COLORS[s.options.length % DB_OPTION_COLORS.length]}); } };
  for (const r of d.rows) { const v = r[col]; if (s.type === 'multi_select') dbSplit(v).forEach(add); else add(String(v ?? '').trim()); }
  return s.options;
}
function dbEnsure(d){
  notionColumns(d);
  if (!d.columns.length) { d.columns = ['Nom']; }
  d.schema = d.schema && typeof d.schema === 'object' ? d.schema : {};
  d.columns.forEach((c, i) => {
    if (!d.schema[c] || !DB_TYPES[d.schema[c].type]) d.schema[c] = {type: dbInferType(c, d.rows.map(r => r[c]), d.rows.length, i === 0)};
    if (i === 0) d.schema[c].type = 'title';
  });
  for (const c of d.columns) if (d.schema[c].type === 'relation') for (const r of d.rows) if (/\.(md|html|csv)\)/i.test(r[c] || '')) r[c] = dbCleanRelation(r[c]);
  for (const c of d.columns) if (['select', 'status', 'multi_select'].includes(d.schema[c].type)) dbOptions(d, c);
  if (!Array.isArray(d.views) || !d.views.length) {
    const group = d.columns.find(c => ['status', 'select'].includes(d.schema[c].type));
    const date = d.columns.find(c => d.schema[c].type === 'date');
    d.views = [{id: 'v' + Date.now().toString(36), name: 'Tableau', type: 'table', filters: [], sorts: [], hidden: []}];
    if (group) d.views.push({id: 'vb' + Date.now().toString(36), name: 'Kanban', type: 'board', groupBy: group, filters: [], sorts: [], hidden: []});
    if (date) d.views.push({id: 'vc' + Date.now().toString(36), name: 'Calendrier', type: 'calendar', dateProp: date, filters: [], sorts: [], hidden: []});
    if (d.view === 'kanban' && group) d.activeView = d.views[1].id;
  }
  if (!d.views.some(v => v.id === d.activeView)) d.activeView = d.views[0].id;
  for (const v of d.views) { v.filters ||= []; v.sorts ||= []; v.hidden ||= []; }
  return d;
}
function dbCreate(columns = ['Nom', 'Statut', 'Date', 'Tags']){
  const d = {kind: 'database', version: 3, columns: [...columns], rows: [], properties: {}, schema: {}};
  d.schema[columns[0]] = {type: 'title'};
  if (columns.includes('Statut')) d.schema.Statut = {type: 'status', options: [{name: 'À faire', color: '#a9b4c8'}, {name: 'En cours', color: '#8fa4ff'}, {name: 'Terminé', color: '#9be3a7'}]};
  if (columns.includes('Date')) d.schema.Date = {type: 'date'};
  if (columns.includes('Tags')) d.schema.Tags = {type: 'multi_select', options: []};
  return dbEnsure(d);
}

/* ---------- Filtering & sorting ---------- */
const DB_OPS = {
  contains: {label: 'contient', test: (v, x) => String(v || '').toLocaleLowerCase().includes(String(x || '').toLocaleLowerCase())},
  not_contains: {label: 'ne contient pas', test: (v, x) => !String(v || '').toLocaleLowerCase().includes(String(x || '').toLocaleLowerCase())},
  is: {label: 'est', test: (v, x) => String(v || '').trim().toLocaleLowerCase() === String(x || '').trim().toLocaleLowerCase() || dbSplit(v).some(t => t.toLocaleLowerCase() === String(x || '').toLocaleLowerCase())},
  is_not: {label: 'n’est pas', test: (v, x) => !DB_OPS.is.test(v, x)},
  empty: {label: 'est vide', test: v => !String(v ?? '').trim(), noValue: true},
  not_empty: {label: 'n’est pas vide', test: v => !!String(v ?? '').trim(), noValue: true},
  checked: {label: 'est coché', test: v => dbTruthy(v), noValue: true},
  unchecked: {label: 'n’est pas coché', test: v => !dbTruthy(v), noValue: true},
  gt: {label: '>', test: (v, x) => dbNum(v) > dbNum(x)}, lt: {label: '<', test: (v, x) => dbNum(v) < dbNum(x)},
  before: {label: 'avant', test: (v, x) => { const a = dbParseDate(v), b = dbParseDate(x); return !!(a && b && a < b); }},
  after: {label: 'après', test: (v, x) => { const a = dbParseDate(v), b = dbParseDate(x); return !!(a && b && a > b); }},
};
function dbNum(v){ const n = parseFloat(String(v ?? '').replace(/[\s €$%]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; }
function dbOpsFor(type){
  if (type === 'checkbox') return ['checked', 'unchecked'];
  if (type === 'number') return ['is', 'gt', 'lt', 'empty', 'not_empty'];
  if (type === 'date') return ['is', 'before', 'after', 'empty', 'not_empty'];
  if (['select', 'status', 'multi_select'].includes(type)) return ['is', 'is_not', 'empty', 'not_empty'];
  return ['contains', 'not_contains', 'is', 'empty', 'not_empty'];
}
function dbCompare(type, a, b){
  if (type === 'number') { const x = dbNum(a), y = dbNum(b); return (isNaN(x) ? Infinity : x) - (isNaN(y) ? Infinity : y); }
  if (type === 'date') { const x = dbParseDate(a), y = dbParseDate(b); return (x ? x.getTime() : Infinity) - (y ? y.getTime() : Infinity); }
  if (type === 'checkbox') return dbTruthy(b) - dbTruthy(a);
  return String(a ?? '').localeCompare(String(b ?? ''), 'fr', {numeric: true, sensitivity: 'base'});
}
function dbVisibleRows(d, view, term){
  let list = d.rows.map((row, index) => ({row, index}));
  for (const f of view.filters) { const op = DB_OPS[f.op]; if (!op || !d.columns.includes(f.col)) continue; list = list.filter(({row}) => op.test(row[f.col], f.value)); }
  if (term) { const t = term.toLocaleLowerCase(); list = list.filter(({row}) => d.columns.some(c => String(row[c] ?? '').toLocaleLowerCase().includes(t))); }
  if (view.sorts.length) list.sort((a, b) => { for (const s of view.sorts) { if (!d.columns.includes(s.col)) continue; const c = dbCompare(d.schema[s.col]?.type, a.row[s.col], b.row[s.col]); if (c) return s.dir === 'desc' ? -c : c; } return a.index - b.index; });
  return list;
}

/* ---------- Rendering ---------- */
function dbChip(d, col, name){
  const o = (d.schema[col].options || []).find(o => o.name === name), c = o?.color || '#a9b4c8';
  return `<span class="db-chip" style="--chip:${c}">${escapeHtml(name)}</span>`;
}
function dbCell(d, col, row, r){
  const t = d.schema[col]?.type || 'text', v = row[col] ?? '', attr = `data-r="${r}" data-c="${escapeHtml(col)}"`;
  switch (t) {
    case 'checkbox': return `<label class="db-check"><input type="checkbox" ${attr} ${dbTruthy(v) ? 'checked' : ''}></label>`;
    case 'select': case 'status': return `<button class="db-pick" ${attr}>${String(v).trim() ? dbChip(d, col, String(v).trim()) : '<span class="db-empty">—</span>'}</button>`;
    case 'multi_select': { const items = dbSplit(v); return `<button class="db-pick" ${attr}>${items.length ? items.map(x => dbChip(d, col, x)).join('') : '<span class="db-empty">—</span>'}</button>`; }
    case 'date': { const date = dbParseDate(v); return date && /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) || date && !String(v).includes(':') && !String(v).includes('→') ? `<input class="db-in db-date" type="date" ${attr} value="${dbIso(date)}">` : `<input class="db-in" ${attr} value="${escapeHtml(v)}" placeholder="aaaa-mm-jj">`; }
    case 'url': return `<span class="db-url"><input class="db-in" ${attr} value="${escapeHtml(v)}">${/^https?:/i.test(v) ? `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer" title="Ouvrir le lien">↗</a>` : ''}</span>`;
    case 'number': return `<input class="db-in db-num" inputmode="decimal" ${attr} value="${escapeHtml(v)}">`;
    case 'title': return `<span class="db-title-cell"><input class="db-in db-title-in" ${attr} value="${escapeHtml(v)}" placeholder="Sans titre"><button class="db-open" data-open-row="${r}" title="Ouvrir la page de cette ligne">Ouvrir</button></span>`;
    default: return `<textarea class="db-in db-text" rows="1" ${attr}>${escapeHtml(v)}</textarea>`;
  }
}
function dbPopover(anchor, html, cls = ''){
  document.querySelectorAll('.db-pop').forEach(p => p.remove());
  const pop = document.createElement('div'); pop.className = 'db-pop ' + cls; pop.innerHTML = html; document.body.append(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pr.width - 8)) + 'px';
  pop.style.top = (r.bottom + pr.height + 8 > innerHeight ? Math.max(8, r.top - pr.height - 6) : r.bottom + 6) + 'px';
  setTimeout(() => { const close = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } }; document.addEventListener('pointerdown', close, true); pop._close = () => { pop.remove(); document.removeEventListener('pointerdown', close, true); }; });
  return pop;
}

function renderDatabase(outer, note, opts = {}){
  const d = dbEnsure(note.notion);
  if (outer._dbNote !== note) { outer._dbNote = note; outer._dbState = null; }
  const state = outer._dbState || (outer._dbState = {page: 0, term: '', month: null});
  outer.replaceChildren(); const host = document.createElement('div'); host.className = 'db-host'; outer.append(host);
  const view = d.views.find(v => v.id === d.activeView) || d.views[0];
  const save = (structural) => { note.updatedAt = new Date().toISOString(); scheduleEditorSave(note); if (structural) paint(); opts.onChange?.(); };
  const cols = () => d.columns.filter(c => !view.hidden.includes(c) || c === d.columns[0]);
  const openRow = r => {
    const row = d.rows[r]; if (!row) return;
    const existing = row.__page && projectDocuments().byId.get(row.__page) || (row.__url && projectDocuments().byUrl.get(row.__url)) || (typeof databaseRowPage === 'function' ? databaseRowPage(note, row) : null);
    if (existing) { opts.openNote?.(existing.note.id); return; }
    if (opts.createRowPage) { const id = opts.createRowPage(note, String(row[d.columns[0]] || 'Sans titre')); if (id) { row.__page = id; save(); } }
  };
  function toolbar(){
    const count = view.filters.length, sorts = view.sorts.length;
    return `<div class="db-bar"><div class="db-views">${d.views.map(v => `<button class="db-view ${v.id === view.id ? 'on' : ''}" data-view="${v.id}" title="Double-clic pour renommer">${{table: '▦', board: '▥', calendar: '◷', gallery: '▣', list: '☰'}[v.type] || '▦'} ${escapeHtml(v.name)}</button>`).join('')}<button class="db-view db-add-view" data-add-view title="Ajouter une vue">＋</button></div>
      <div class="db-actions"><input type="search" class="db-search" placeholder="Rechercher…" value="${escapeHtml(state.term)}"><button class="db-btn ${count ? 'on' : ''}" data-filters>Filtre${count ? ' · ' + count : ''}</button><button class="db-btn ${sorts ? 'on' : ''}" data-sorts>Tri${sorts ? ' · ' + sorts : ''}</button><button class="db-btn" data-props>Propriétés</button><button class="db-btn" data-more title="Plus">⋯</button><button class="db-new" data-new-row>＋ Nouveau</button></div></div>`;
  }
  function tableView(list){
    const c = cols(), total = list.length, pages = Math.max(1, Math.ceil(total / 100)); state.page = Math.min(state.page, pages - 1);
    const slice = list.slice(state.page * 100, state.page * 100 + 100);
    return `<div class="db-table-wrap"><table class="db-table"><thead><tr>${c.map(col => `<th data-head="${escapeHtml(col)}"><span class="db-ticon">${DB_TYPES[d.schema[col].type]?.icon || '≡'}</span>${escapeHtml(col)}${view.sorts.find(s => s.col === col) ? (view.sorts.find(s => s.col === col).dir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`).join('')}<th class="db-add-col" data-add-col title="Ajouter une propriété">＋</th></tr></thead>
      <tbody>${slice.map(({row, index}) => `<tr data-row="${index}">${c.map(col => `<td class="db-t-${d.schema[col].type}">${dbCell(d, col, row, index)}</td>`).join('')}<td class="db-row-tools"><button data-expand="${index}" title="Tout afficher">⤢</button><button data-del-row="${index}" title="Supprimer la ligne">×</button></td></tr>`).join('')}</tbody></table>
      <button class="db-add-row" data-new-row>＋ Nouvelle ligne</button></div>${pages > 1 ? `<div class="db-pager"><button data-page="-1" ${state.page ? '' : 'disabled'}>←</button><span>${state.page * 100 + 1}–${Math.min(total, state.page * 100 + 100)} sur ${total}</span><button data-page="1" ${state.page < pages - 1 ? '' : 'disabled'}>→</button></div>` : ''}`;
  }
  function cardFields(row, index, max = 4){
    return cols().slice(1).filter(col => String(row[col] ?? '').trim() && !(view.type === 'board' && col === view.groupBy)).slice(0, max).map(col => {
      const t = d.schema[col].type, v = row[col];
      const shown = t === 'select' || t === 'status' ? dbChip(d, col, String(v).trim()) : t === 'multi_select' ? dbSplit(v).map(x => dbChip(d, col, x)).join('') : t === 'checkbox' ? (dbTruthy(v) ? '☑ ' : '☐ ') + escapeHtml(col) : escapeHtml(String(v).slice(0, 90));
      return `<div class="db-card-field"><small>${escapeHtml(col)}</small><span>${shown}</span></div>`;
    }).join('');
  }
  function boardView(list){
    const by = d.columns.includes(view.groupBy) ? view.groupBy : d.columns.find(c => ['status', 'select', 'checkbox', 'multi_select'].includes(d.schema[c].type));
    if (!by) return `<div class="db-empty-view">Ajoute une propriété « Sélection » ou « Statut » pour regrouper les cartes. <button class="db-btn" data-add-col>＋ Propriété</button></div>`;
    view.groupBy = by;
    const t = d.schema[by].type, key = row => t === 'checkbox' ? (dbTruthy(row[by]) ? 'Coché' : 'Non coché') : t === 'multi_select' ? (dbSplit(row[by])[0] || '') : String(row[by] ?? '').trim();
    const lanes = t === 'checkbox' ? ['Non coché', 'Coché'] : [...dbOptions(d, by).map(o => o.name)];
    if (list.some(x => !key(x.row))) lanes.unshift('');
    return `<div class="db-board-head">Regrouper par <select data-group-by>${d.columns.filter(c => ['status', 'select', 'checkbox', 'multi_select'].includes(d.schema[c].type)).map(c => `<option ${c === by ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div><div class="db-board">${lanes.map(lane => {
      const cards = list.filter(x => key(x.row) === lane);
      return `<section class="db-lane" data-lane="${escapeHtml(lane)}"><header>${lane ? (t === 'checkbox' ? escapeHtml(lane) : dbChip(d, by, lane)) : '<span class="db-empty">Sans valeur</span>'}<small>${cards.length}</small></header>${cards.slice(0, 200).map(({row, index}) => `<article class="db-card" draggable="true" data-card="${index}"><b data-expand="${index}">${escapeHtml(row[d.columns[0]] || 'Sans titre')}</b>${cardFields(row, index, 3)}</article>`).join('')}${cards.length > 200 ? `<p class="db-more">+ ${cards.length - 200} cartes (filtre pour affiner)</p>` : ''}<button class="db-lane-add" data-new-in="${escapeHtml(lane)}">＋ Nouveau</button></section>`;
    }).join('')}</div>`;
  }
  function calendarView(list){
    const prop = d.columns.includes(view.dateProp) ? view.dateProp : d.columns.find(c => d.schema[c].type === 'date');
    if (!prop) return `<div class="db-empty-view">Ajoute une propriété « Date » pour utiliser le calendrier. <button class="db-btn" data-add-col>＋ Propriété</button></div>`;
    view.dateProp = prop;
    const base = state.month ? new Date(state.month) : (() => { const dated = list.map(x => dbParseDate(x.row[prop])).filter(Boolean).sort((a, b) => b - a); return dated[0] || new Date(); })();
    const first = new Date(base.getFullYear(), base.getMonth(), 1); state.month = first.getTime();
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const byDay = new Map(); for (const x of list) { const dt = dbParseDate(x.row[prop]); if (!dt) continue; const k = dbIso(dt); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); }
    const today = dbIso(new Date());
    let cells = '';
    for (let i = 0; i < 42; i++) { const day = new Date(start); day.setDate(start.getDate() + i); const k = dbIso(day), items = byDay.get(k) || [];
      cells += `<div class="db-day ${day.getMonth() !== first.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''}" data-day="${k}"><span>${day.getDate()}</span>${items.slice(0, 4).map(({row, index}) => `<button class="db-event" data-expand="${index}">${escapeHtml(row[d.columns[0]] || 'Sans titre')}</button>`).join('')}${items.length > 4 ? `<small>+${items.length - 4}</small>` : ''}<button class="db-day-add" data-new-on="${k}" title="Ajouter">＋</button></div>`; }
    const undated = list.filter(x => !dbParseDate(x.row[prop])).length;
    return `<div class="db-cal-head"><button class="db-btn" data-month="-1">‹</button><b>${first.toLocaleDateString('fr-FR', {month: 'long', year: 'numeric'})}</b><button class="db-btn" data-month="1">›</button><button class="db-btn" data-month="0">Aujourd’hui</button><span>Date : <select data-date-prop>${d.columns.filter(c => d.schema[c].type === 'date').map(c => `<option ${c === prop ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></span>${undated ? `<small>${undated} sans date</small>` : ''}</div><div class="db-cal"><div class="db-dow">${['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map(x => `<span>${x}</span>`).join('')}</div><div class="db-grid">${cells}</div></div>`;
  }
  function galleryView(list){
    return `<div class="db-gallery">${list.slice(0, 300).map(({row, index}) => { const img = d.columns.map(c => row[c]).find(v => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(String(v || ''))); return `<article class="db-gcard" data-expand="${index}">${img ? `<div class="db-gimg" style="background-image:url('${escapeHtml(String(img).replace(/'/g, '%27'))}')"></div>` : '<div class="db-gimg empty">✧</div>'}<b>${escapeHtml(row[d.columns[0]] || 'Sans titre')}</b>${cardFields(row, index, 3)}</article>`; }).join('')}<button class="db-gcard db-gnew" data-new-row>＋ Nouveau</button></div>`;
  }
  function listView(list){
    return `<div class="db-list">${list.slice(0, 500).map(({row, index}) => `<div class="db-li" data-expand="${index}"><b>${escapeHtml(row[d.columns[0]] || 'Sans titre')}</b><span>${cols().slice(1).filter(c => String(row[c] ?? '').trim()).slice(0, 4).map(c => { const t = d.schema[c].type; return ['select', 'status'].includes(t) ? dbChip(d, c, String(row[c]).trim()) : t === 'multi_select' ? dbSplit(row[c]).map(x => dbChip(d, c, x)).join('') : `<em>${escapeHtml(String(row[c]).slice(0, 40))}</em>`; }).join('')}</span></div>`).join('')}<button class="db-add-row" data-new-row>＋ Nouvelle ligne</button></div>`;
  }
  function paint(){
    const list = dbVisibleRows(d, view, state.term);
    const body = view.type === 'board' ? boardView(list) : view.type === 'calendar' ? calendarView(list) : view.type === 'gallery' ? galleryView(list) : view.type === 'list' ? listView(list) : tableView(list);
    const hadFocus = document.activeElement?.classList.contains('db-search');
    host.innerHTML = `<div class="db">${toolbar()}<div class="db-body">${body}</div><div class="db-foot">${list.length === d.rows.length ? `${d.rows.length} ligne${d.rows.length > 1 ? 's' : ''}` : `${list.length} sur ${d.rows.length} lignes`}</div></div>`;
    if (hadFocus) { const s = host.querySelector('.db-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    host.querySelectorAll('.db-text').forEach(autoGrow);
  }
  const autoGrow = ta => { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight) + 'px'; };
  const newRow = (preset = {}) => { const row = Object.fromEntries(d.columns.map(c => [c, ''])); Object.assign(row, preset); d.rows.push(row); state.page = Math.floor((d.rows.length - 1) / 100); save(true); const input = host.querySelector(`[data-r="${d.rows.length - 1}"].db-title-in`); input?.focus(); return d.rows.length - 1; };
  const renameCol = (old, name) => {
    name = String(name || '').trim(); if (!name || name === old || d.columns.includes(name)) return;
    d.columns[d.columns.indexOf(old)] = name; d.schema[name] = d.schema[old]; delete d.schema[old];
    for (const r of d.rows) { r[name] = r[old]; delete r[old]; }
    for (const v of d.views) { v.filters.forEach(f => { if (f.col === old) f.col = name; }); v.sorts.forEach(s => { if (s.col === old) s.col = name; }); v.hidden = v.hidden.map(h => h === old ? name : h); if (v.groupBy === old) v.groupBy = name; if (v.dateProp === old) v.dateProp = name; }
    save(true);
  };
  const addCol = (type = 'text') => {
    let name = 'Propriété', i = 2; while (d.columns.includes(name)) name = 'Propriété ' + i++;
    d.columns.push(name); d.schema[name] = {type, options: []}; d.rows.forEach(r => r[name] = ''); save(true);
    requestAnimationFrame(() => { const th = host.querySelector(`[data-head="${CSS.escape(name)}"]`); if (th) headMenu(th, name); });
  };
  function headMenu(anchor, col){
    const s = d.schema[col], first = col === d.columns[0];
    const pop = dbPopover(anchor, `<input class="db-pop-in" value="${escapeHtml(col)}" aria-label="Nom de la propriété">
      ${first ? '' : `<label class="db-pop-label">Type</label><select class="db-pop-sel" data-type>${Object.entries(DB_TYPES).filter(([k]) => k !== 'title').map(([k, t]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}</select>`}
      <button data-sort="asc">↑ Trier croissant</button><button data-sort="desc">↓ Trier décroissant</button><button data-filter>Filtrer sur cette propriété</button>
      ${first ? '' : `<button data-hide>Masquer dans cette vue</button><button data-left>← Déplacer à gauche</button><button data-right>Déplacer à droite →</button><button class="danger" data-del>Supprimer la propriété</button>`}`);
    const input = pop.querySelector('.db-pop-in'); input.select(); input.focus();
    input.onkeydown = e => { if (e.key === 'Enter') { renameCol(col, input.value); pop._close?.(); } };
    input.onblur = () => renameCol(col, input.value);
    pop.querySelector('[data-type]')?.addEventListener('change', e => { s.type = e.target.value; if (['select', 'status', 'multi_select'].includes(s.type)) dbOptions(d, col); pop._close?.(); save(true); });
    pop.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { view.sorts = [{col, dir: b.dataset.sort}]; pop._close?.(); save(true); });
    pop.querySelector('[data-filter]').onclick = () => { view.filters.push({col, op: dbOpsFor(s.type)[0], value: ''}); pop._close?.(); save(true); filterMenu(host.querySelector('[data-filters]')); };
    pop.querySelector('[data-hide]')?.addEventListener('click', () => { view.hidden.push(col); pop._close?.(); save(true); });
    const move = dir => { const i = d.columns.indexOf(col), j = i + dir; if (j < 1 || j >= d.columns.length) return; [d.columns[i], d.columns[j]] = [d.columns[j], d.columns[i]]; pop._close?.(); save(true); };
    pop.querySelector('[data-left]')?.addEventListener('click', () => move(-1));
    pop.querySelector('[data-right]')?.addEventListener('click', () => move(1));
    pop.querySelector('[data-del]')?.addEventListener('click', () => { if (!confirm(`Supprimer la propriété « ${col} » et ses valeurs ?`)) return; d.columns = d.columns.filter(c => c !== col); delete d.schema[col]; d.rows.forEach(r => delete r[col]); pop._close?.(); save(true); });
  }
  function pickMenu(anchor, r, col){
    const s = d.schema[col], multi = s.type === 'multi_select', row = d.rows[r];
    const current = () => multi ? dbSplit(row[col]) : [String(row[col] ?? '').trim()].filter(Boolean);
    const pop = dbPopover(anchor, `<input class="db-pop-in" placeholder="Rechercher ou créer une option…"><div class="db-opts"></div>`, 'db-pick-pop');
    const input = pop.querySelector('input'), box = pop.querySelector('.db-opts');
    const paintOpts = () => {
      const q = input.value.trim(), ql = q.toLocaleLowerCase(), opts = dbOptions(d, col).filter(o => !ql || o.name.toLocaleLowerCase().includes(ql)), cur = current();
      box.innerHTML = opts.map(o => `<button data-opt="${escapeHtml(o.name)}" class="${cur.includes(o.name) ? 'on' : ''}">${dbChip(d, col, o.name)}${cur.includes(o.name) ? '<i>✓</i>' : ''}</button>`).join('') + (q && !opts.some(o => o.name.toLocaleLowerCase() === ql) ? `<button data-create="${escapeHtml(q)}">Créer ${dbChip(d, col, q)}</button>` : '') + (cur.length ? '<button data-clear class="db-clear">Effacer</button>' : '');
      box.querySelectorAll('[data-opt],[data-create]').forEach(b => b.onclick = () => {
        const name = b.dataset.opt || b.dataset.create;
        if (b.dataset.create) { s.options.push({name, color: DB_OPTION_COLORS[s.options.length % DB_OPTION_COLORS.length]}); }
        if (multi) { const set = current(); row[col] = (set.includes(name) ? set.filter(x => x !== name) : [...set, name]).join(', '); input.value = ''; paintOpts(); save(); paint(); }
        else { row[col] = name; pop._close?.(); save(true); }
      });
      box.querySelector('[data-clear]')?.addEventListener('click', () => { row[col] = ''; pop._close?.(); save(true); });
    };
    input.oninput = paintOpts; input.onkeydown = e => { if (e.key === 'Enter') box.querySelector('button')?.click(); if (e.key === 'Escape') pop._close?.(); };
    paintOpts(); input.focus();
  }
  function filterMenu(anchor){
    const pop = dbPopover(anchor, '<div class="db-rules"></div><button data-add-rule>＋ Ajouter un filtre</button>', 'db-rules-pop');
    const box = pop.querySelector('.db-rules');
    const paintRules = () => {
      box.innerHTML = view.filters.map((f, i) => { const t = d.schema[f.col]?.type || 'text'; return `<div class="db-rule"><select data-i="${i}" data-k="col">${d.columns.map(c => `<option ${c === f.col ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select><select data-i="${i}" data-k="op">${dbOpsFor(t).map(o => `<option value="${o}" ${o === f.op ? 'selected' : ''}>${DB_OPS[o].label}</option>`).join('')}</select>${DB_OPS[f.op]?.noValue ? '' : `<input data-i="${i}" data-k="value" value="${escapeHtml(f.value || '')}" ${t === 'date' ? 'type="date"' : ''} placeholder="Valeur">`}<button data-del-rule="${i}">×</button></div>`; }).join('') || '<p class="db-muted">Aucun filtre. Les lignes doivent respecter tous les filtres.</p>';
      box.querySelectorAll('[data-k]').forEach(el => el[el.tagName === 'INPUT' ? 'oninput' : 'onchange'] = () => { const f = view.filters[Number(el.dataset.i)]; f[el.dataset.k] = el.value; if (el.dataset.k === 'col') { f.op = dbOpsFor(d.schema[f.col].type)[0]; paintRules(); } else if (el.dataset.k === 'op') paintRules(); state.page = 0; save(); paint(); });
      box.querySelectorAll('[data-del-rule]').forEach(b => b.onclick = () => { view.filters.splice(Number(b.dataset.delRule), 1); paintRules(); save(true); });
    };
    pop.querySelector('[data-add-rule]').onclick = () => { const col = d.columns[1] || d.columns[0]; view.filters.push({col, op: dbOpsFor(d.schema[col].type)[0], value: ''}); paintRules(); save(true); };
    paintRules();
  }
  function sortMenu(anchor){
    const pop = dbPopover(anchor, '<div class="db-rules"></div><button data-add-sort>＋ Ajouter un tri</button>', 'db-rules-pop');
    const box = pop.querySelector('.db-rules');
    const paintSorts = () => {
      box.innerHTML = view.sorts.map((s, i) => `<div class="db-rule"><select data-i="${i}" data-k="col">${d.columns.map(c => `<option ${c === s.col ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select><select data-i="${i}" data-k="dir"><option value="asc" ${s.dir !== 'desc' ? 'selected' : ''}>Croissant</option><option value="desc" ${s.dir === 'desc' ? 'selected' : ''}>Décroissant</option></select><button data-del-sort="${i}">×</button></div>`).join('') || '<p class="db-muted">Ordre d’origine.</p>';
      box.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { view.sorts[Number(el.dataset.i)][el.dataset.k] = el.value; save(true); });
      box.querySelectorAll('[data-del-sort]').forEach(b => b.onclick = () => { view.sorts.splice(Number(b.dataset.delSort), 1); paintSorts(); save(true); });
    };
    pop.querySelector('[data-add-sort]').onclick = () => { view.sorts.push({col: d.columns[0], dir: 'asc'}); paintSorts(); save(true); };
    paintSorts();
  }
  function propsMenu(anchor){
    const pop = dbPopover(anchor, `<div class="db-props">${d.columns.map((c, i) => `<div class="db-prop-row"><span class="db-ticon">${DB_TYPES[d.schema[c].type]?.icon}</span><span>${escapeHtml(c)}</span>${i ? `<button data-toggle="${escapeHtml(c)}" title="Afficher / masquer">${view.hidden.includes(c) ? '◌' : '●'}</button>` : ''}</div>`).join('')}</div><button data-add-prop>＋ Nouvelle propriété</button>`, 'db-rules-pop');
    pop.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const c = b.dataset.toggle; view.hidden = view.hidden.includes(c) ? view.hidden.filter(x => x !== c) : [...view.hidden, c]; pop._close?.(); save(true); });
    pop.querySelector('[data-add-prop]').onclick = () => { pop._close?.(); addCol(); };
  }
  function viewMenu(anchor){
    const pop = dbPopover(anchor, [['table', '▦ Tableau'], ['board', '▥ Kanban'], ['calendar', '◷ Calendrier'], ['gallery', '▣ Galerie'], ['list', '☰ Liste']].map(([t, l]) => `<button data-type="${t}">${l}</button>`).join(''));
    pop.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { const v = {id: 'v' + crypto.randomUUID().slice(0, 8), name: b.textContent.slice(2), type: b.dataset.type, filters: [], sorts: [], hidden: []}; d.views.push(v); d.activeView = v.id; pop._close?.(); save(true); });
  }
  function moreMenu(anchor){
    const pop = dbPopover(anchor, `<button data-rename-view>Renommer la vue</button><button data-dup-view>Dupliquer la vue</button>${d.views.length > 1 ? '<button class="danger" data-del-view>Supprimer la vue</button>' : ''}<hr><button data-csv>Exporter en CSV</button>`);
    pop.querySelector('[data-rename-view]').onclick = () => { const n = prompt('Nom de la vue', view.name); if (n?.trim()) { view.name = n.trim(); save(true); } pop._close?.(); };
    pop.querySelector('[data-dup-view]').onclick = () => { const v = JSON.parse(JSON.stringify(view)); v.id = 'v' + crypto.randomUUID().slice(0, 8); v.name += ' (copie)'; d.views.push(v); d.activeView = v.id; pop._close?.(); save(true); };
    pop.querySelector('[data-del-view]')?.addEventListener('click', () => { d.views = d.views.filter(v => v !== view); d.activeView = d.views[0].id; pop._close?.(); save(true); });
    pop.querySelector('[data-csv]').onclick = () => { const q = v => '"' + String(v ?? '').replaceAll('"', '""') + '"'; downloadFile((note.title || 'base') + '.csv', 'text/csv;charset=utf-8', '﻿' + [d.columns, ...d.rows.map(r => d.columns.map(c => r[c]))].map(r => r.map(q).join(',')).join('\r\n')); pop._close?.(); };
  }
  function rowPanel(r){
    const row = d.rows[r]; if (!row) return;
    const dlg = document.createElement('dialog'); dlg.className = 'db-row-dialog';
    const paintRow = () => {
      dlg.innerHTML = `<div class="db-row-head"><input class="db-row-title" data-r="${r}" data-c="${escapeHtml(d.columns[0])}" value="${escapeHtml(row[d.columns[0]] || '')}" placeholder="Sans titre"><button class="db-btn" data-open-row="${r}">Ouvrir comme page</button><button class="db-btn" data-close>Fermer</button></div><div class="db-row-props">${d.columns.slice(1).map(c => `<div class="db-row-prop"><span><i class="db-ticon">${DB_TYPES[d.schema[c].type]?.icon}</i>${escapeHtml(c)}</span><div>${dbCell(d, c, row, r)}</div></div>`).join('')}</div>`;
      dlg.querySelector('[data-close]').onclick = () => dlg.close();
      bindCells(dlg, () => paintRow());
      dlg.querySelector('[data-open-row]').onclick = () => { dlg.close(); openRow(r); };
    };
    document.body.append(dlg); paintRow(); dlg.showModal();
    dlg.addEventListener('close', () => { dlg.remove(); paint(); });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
  function bindCells(root, repaint){
    root.addEventListener('input', e => {
      const el = e.target; if (!el.dataset?.c || el.type === 'checkbox') return;
      const row = d.rows[Number(el.dataset.r)]; if (!row) return;
      row[el.dataset.c] = el.value; if (el.classList.contains('db-text')) autoGrow(el); save();
    });
    root.addEventListener('change', e => {
      const el = e.target; if (!el.dataset?.c) return;
      const row = d.rows[Number(el.dataset.r)]; if (!row) return;
      row[el.dataset.c] = el.type === 'checkbox' ? (el.checked ? 'Yes' : 'No') : el.value;
      save(); if (view.filters.length || view.sorts.length || view.type !== 'table') (repaint || paint)();
    });
    root.addEventListener('click', e => {
      const pick = e.target.closest('.db-pick'); if (pick) { e.preventDefault(); pickMenu(pick, Number(pick.dataset.r), pick.dataset.c); return; }
    });
  }
  // Delegated events on the host (bound once).
  {
    bindCells(host);
    host.addEventListener('click', e => {
      const t = e.target, q = sel => t.closest(sel);
      let el;
      if ((el = q('[data-view]'))) { if (d.activeView !== el.dataset.view) { d.activeView = el.dataset.view; state.page = 0; state.month = null; save(); renderDatabase(outer, note, opts); } return; }
      if (q('[data-add-view]')) return viewMenu(q('[data-add-view]'));
      if (q('[data-filters]')) return filterMenu(q('[data-filters]'));
      if (q('[data-sorts]')) return sortMenu(q('[data-sorts]'));
      if (q('[data-props]')) return propsMenu(q('[data-props]'));
      if (q('[data-more]')) return moreMenu(q('[data-more]'));
      if (q('[data-add-col]')) return addCol();
      if ((el = q('[data-head]'))) return headMenu(el, el.dataset.head);
      if (q('[data-new-row]')) return newRow();
      if ((el = q('[data-new-in]'))) { const by = view.groupBy, t = d.schema[by]?.type; const r = newRow(el.dataset.newIn ? {[by]: t === 'checkbox' ? (el.dataset.newIn === 'Coché' ? 'Yes' : 'No') : el.dataset.newIn} : {}); rowPanel(r); return; }
      if ((el = q('[data-new-on]'))) { const r = newRow({[view.dateProp]: el.dataset.newOn}); rowPanel(r); return; }
      if ((el = q('[data-month]'))) { const m = new Date(state.month || Date.now()); const step = Number(el.dataset.month); state.month = step ? new Date(m.getFullYear(), m.getMonth() + step, 1).getTime() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(); paint(); return; }
      if ((el = q('[data-open-row]'))) return openRow(Number(el.dataset.openRow));
      if ((el = q('[data-expand]'))) return rowPanel(Number(el.dataset.expand));
      if ((el = q('[data-del-row]'))) { d.rows.splice(Number(el.dataset.delRow), 1); save(true); return; }
      if ((el = q('[data-page]'))) { state.page += Number(el.dataset.page); paint(); host.querySelector('.db-table-wrap')?.scrollTo(0, 0); return; }
    });
    host.addEventListener('dblclick', e => { const el = e.target.closest('[data-view]'); if (!el) return; const v = d.views.find(v => v.id === el.dataset.view); const n = prompt('Nom de la vue', v.name); if (n?.trim()) { v.name = n.trim(); save(true); } });
    host.addEventListener('input', e => { if (e.target.classList.contains('db-search')) { state.term = e.target.value; state.page = 0; paint(); } });
    host.addEventListener('change', e => {
      if (e.target.matches('[data-group-by]')) { view.groupBy = e.target.value; save(true); }
      if (e.target.matches('[data-date-prop]')) { view.dateProp = e.target.value; state.month = null; save(true); }
    });
    host.addEventListener('keydown', e => {
      const el = e.target; if (!el.classList?.contains('db-in') || el.tagName === 'TEXTAREA' && e.shiftKey) return;
      if (e.key === 'Enter' && el.tagName !== 'TEXTAREA' || e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); const r = Number(el.dataset.r); const next = host.querySelector(`[data-r="${r + 1}"][data-c="${CSS.escape(el.dataset.c)}"]`); if (next) next.focus(); else if (el.classList.contains('db-title-in')) newRow(); }
    });
    host.addEventListener('dragstart', e => { const c = e.target.closest?.('[data-card]'); if (c) e.dataTransfer.setData('text/cosmos-card', c.dataset.card); });
    host.addEventListener('dragover', e => { const lane = e.target.closest?.('[data-lane]'); if (lane && e.dataTransfer.types.includes('text/cosmos-card')) { e.preventDefault(); lane.classList.add('drop'); } });
    host.addEventListener('dragleave', e => e.target.closest?.('[data-lane]')?.classList.remove('drop'));
    host.addEventListener('drop', e => {
      const lane = e.target.closest?.('[data-lane]'), raw = e.dataTransfer.getData('text/cosmos-card'); if (!lane || !/^\d+$/.test(raw)) return;
      e.preventDefault(); const row = d.rows[Number(raw)], by = view.groupBy, t = d.schema[by].type, value = lane.dataset.lane;
      if (t === 'checkbox') row[by] = value === 'Coché' ? 'Yes' : 'No';
      else if (t === 'multi_select') { const rest = dbSplit(row[by]).slice(1).filter(x => x !== value); row[by] = [value, ...rest].filter(Boolean).join(', '); }
      else row[by] = value;
      save(true);
    });
  }
  paint();
}
