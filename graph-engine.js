// Cosmos graph engine — GPU rendering for large vaults.
// The scene is uploaded to the GPU only when notes, links or the selection change.
// Rotating, panning and zooming only update a few uniforms, so a 5 000-note vault
// stays fluid. Labels are drawn on a single 2D canvas with collision culling, and
// hit-testing projects points on the CPU instead of creating one DOM node per note.
const GRAPH_LIMIT = 30000;
let gl = null, glProgram = null, glLoc = null;
const G = {
  shown: [], index: new Map(), byId: new Map(), degree: new Map(), adj: new Map(), order: [],
  linksRef: null, linksLen: -1, notesRef: null, notesLen: -1, recent: null,
  hover: null, size: new Float32Array(0), batches: null, renderFrame: 0, refreshFrame: 0,
  labelWidths: new Map(), colorCache: new Map(), motion: false, motionTimer: 0, lastFrame: 0, edgeBudget: 4000, importantEdges: 0
};
const labelCanvas = document.createElement('canvas');
labelCanvas.className = 'graph-labels'; labelCanvas.setAttribute('aria-hidden', 'true');
canvas.after(labelCanvas);
const lctx = labelCanvas.getContext('2d');

function hexRgb(hex){ let c = G.colorCache.get(hex); if (!c) { c = [1,3,5].map(i => parseInt(String(hex).slice(i, i+2), 16) / 255); G.colorCache.set(hex, c); } return c; }
function noteColor(n){ return colors[n.group] || colors['Idées']; }

/* ---------- WebGL ---------- */
function initGraphGL(){
  try {
    gl = canvas.getContext('webgl', {alpha: true, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false});
    if (!gl) return false;
    const vs = `attribute vec3 aPosition;attribute vec4 aColor;attribute float aSize;attribute float aKind;
      uniform mat3 uRotation;uniform vec2 uScale;uniform vec2 uPan;uniform float uPointScale;
      varying vec4 vColor;varying float vKind;
      void main(){vec3 p=uRotation*aPosition;float perspective=1.0/max(0.3,1.0+p.z*0.27);
        vec2 xy=p.xy*perspective*uScale;gl_Position=vec4(xy+uPan,clamp(p.z*0.16,-0.9,0.9),1.0);
        gl_PointSize=max(1.0,aSize*perspective*uPointScale);vColor=aColor;vKind=aKind;}`;
    const fs = `precision mediump float;varying vec4 vColor;varying float vKind;uniform float uPoint;
      void main(){
        if(uPoint<0.5){gl_FragColor=vColor;return;}
        vec2 uv=(gl_PointCoord-vec2(0.5))*2.0;float d=length(uv);
        if(vKind>1.5){
          vec2 q=vec2(0.9063*uv.x-0.4226*uv.y,0.4226*uv.x+0.9063*uv.y);q.y/=0.57;
          float r=length(q);if(r>1.0)discard;
          float a=atan(q.y,q.x);float t=clamp((r-0.11)/0.82,0.0,1.0);
          float arms=pow(0.5+0.5*cos(3.0*(a-t*4.8)),7.0);
          float fade=1.0-smoothstep(0.3,0.97,r);
          float core=exp(-r*r*60.0);float bulge=exp(-r*r*11.0);
          float boost=vKind>2.5?1.45:1.0;
          float glow=(arms*fade*0.85+(1.0-r)*0.1+bulge*0.32)*boost+core*1.1;
          vec3 c=mix(vColor.rgb,vec3(1.0,0.96,0.87),clamp(core*1.3,0.0,1.0));
          float alpha=clamp(glow,0.0,1.0)*vColor.a;if(alpha<0.012)discard;
          gl_FragColor=vec4(c,alpha);return;}
        if(d>1.0)discard;
        if(vKind>0.5){gl_FragColor=vec4(vColor.rgb,(1.0-smoothstep(0.18,1.0,d))*vColor.a);return;}
        vec3 normal=vec3(uv.x,-uv.y,sqrt(max(0.0,1.0-d*d)));vec3 light=normalize(vec3(-0.5,0.7,1.0));
        float diffuse=max(0.0,dot(normal,light));
        float spec=pow(max(0.0,dot(reflect(-light,normal),vec3(0.0,0.0,1.0))),28.0);
        vec3 c=vColor.rgb*(0.22+0.78*diffuse)+vec3(0.65)*spec;
        gl_FragColor=vec4(c,vColor.a*(1.0-smoothstep(0.9,1.0,d)));}`;
    const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
    glProgram = gl.createProgram();
    gl.attachShader(glProgram, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(glProgram, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(glProgram);
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(glProgram));
    glLoc = {p: gl.getAttribLocation(glProgram,'aPosition'), c: gl.getAttribLocation(glProgram,'aColor'), s: gl.getAttribLocation(glProgram,'aSize'), k: gl.getAttribLocation(glProgram,'aKind'),
      r: gl.getUniformLocation(glProgram,'uRotation'), scale: gl.getUniformLocation(glProgram,'uScale'), pan: gl.getUniformLocation(glProgram,'uPan'),
      point: gl.getUniformLocation(glProgram,'uPoint'), pointScale: gl.getUniformLocation(glProgram,'uPointScale')};
    const batch = () => ({p: gl.createBuffer(), c: gl.createBuffer(), s: gl.createBuffer(), k: gl.createBuffer(), count: 0});
    G.batches = {edges: batch(), halos: batch(), nodes: batch()};
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; });
    canvas.addEventListener('webglcontextrestored', () => { initGraphGL(); draw(); });
    return true;
  } catch (e) { console.warn('Cosmos: WebGL indisponible, rendu 2D activé.', e); gl = null; return false; }
}
function uploadBatch(b, pos, col, size, kind, count){
  b.count = count;
  const put = (buf, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); };
  put(b.p, pos); put(b.c, col); put(b.s, size || new Float32Array(count).fill(1)); put(b.k, kind || new Float32Array(count));
}
function drawBatch(b, mode){
  if (!b.count) return;
  const bind = (buf, loc, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
  bind(b.p, glLoc.p, 3); bind(b.c, glLoc.c, 4); bind(b.s, glLoc.s, 1); bind(b.k, glLoc.k, 1);
  gl.uniform1f(glLoc.point, mode === gl.POINTS ? 1 : 0);
  gl.drawArrays(mode, 0, b.count);
}
const hasGL = initGraphGL();

/* ---------- Model ---------- */
function ensureModel(force){
  if (!force && G.linksRef === links && G.linksLen === links.length && G.notesRef === notes && G.notesLen === notes.length) return;
  G.linksRef = links; G.linksLen = links.length; G.notesRef = notes; G.notesLen = notes.length; G.recent = null;
  const byId = new Map(), degree = new Map(), adj = new Map();
  for (const n of notes) byId.set(n.id, n);
  for (const e of links) {
    const a = e[0], b = e[1]; if (!byId.has(a) || !byId.has(b) || a === b) continue;
    degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1);
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
  G.byId = byId; G.degree = degree; G.adj = adj;
}
function recentIds(){ if (!G.recent) G.recent = new Set([...notes].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,10).map(n=>n.id)); return G.recent; }
const searchCache = new WeakMap();
function searchText(n){
  let c = searchCache.get(n);
  if (!c || c.title !== n.title || c.body !== n.body || c.tags !== (n.tags||[]).join(' ')) {
    c = {title: n.title, body: n.body, tags: (n.tags||[]).join(' '), text: `${n.title} ${n.group} ${(n.tags||[]).join(' ')} ${n.body}`.toLocaleLowerCase(), lowTitle: String(n.title).toLocaleLowerCase()};
    searchCache.set(n, c);
  }
  return c;
}
function visible(n){
  ensureModel();
  if (neighborsOnly && selected && n.id !== selected && !G.adj.get(selected)?.has(n.id)) return false;
  const ok = filter === 'inbox' ? !G.degree.get(n.id) : filter === 'recent' ? recentIds().has(n.id) : filter === 'favorites' ? !!n.favorite : (filter === 'all' || n.group === filter);
  if (!ok) return false;
  return !query || searchText(n).text.includes(query.toLocaleLowerCase());
}
function nodeSize(n){
  const degree = G.degree.get(n.id) || 0;
  return (currentGalaxyId ? (n.id === selected ? 21 : 16) : (n.id === selected ? 62 : 50)) + Math.min(9, Math.sqrt(degree) * 2);
}
function densityFactor(count){ return Math.max(currentGalaxyId ? .45 : .26, Math.min(1, Math.sqrt(70 / Math.max(1, count)))); }
function pointScale(){ return Math.max(.55, Math.min(2.6, Math.sqrt(scale))); }

/* ---------- Scene building ---------- */
function rebuildScene(){
  const shown = G.shown, N = shown.length, galaxyMode = !currentGalaxyId;
  G.index = new Map(shown.map((n, i) => [n.id, i]));
  const focus = G.hover && G.index.has(G.hover) ? G.hover : null, focusSet = focus ? G.adj.get(focus) : null;
  const density = densityFactor(N);
  // Painter's order for translucent galaxies: far first. Computed per rebuild, not per frame.
  let ordered = shown;
  if (galaxyMode && is3d && N > 1) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
    const depth = n => (n.y * sx + ((n.x * sy) + (n.z || 0) * cy) * cx);
    ordered = [...shown].sort((a, b) => depth(b) - depth(a));
  }
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N), kind = new Float32Array(N);
  const hpos = galaxyMode ? null : new Float32Array(N * 3), hcol = galaxyMode ? null : new Float32Array(N * 4), hsize = galaxyMode ? null : new Float32Array(N), hkind = galaxyMode ? null : new Float32Array(N).fill(1);
  G.size = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const n = ordered[i], [r, g, b] = hexRgb(noteColor(n)), isSel = n.id === selected;
    const dim = focus && n.id !== focus && !isSel && !focusSet?.has(n.id) ? .3 : 1;
    const z = is3d ? (n.z || 0) : 0, sz = nodeSize(n) * density * (galaxyMode ? 1.45 : 1);
    pos[i*3] = n.x; pos[i*3+1] = n.y; pos[i*3+2] = z;
    col[i*4] = r; col[i*4+1] = g; col[i*4+2] = b; col[i*4+3] = dim;
    size[i] = sz; kind[i] = galaxyMode ? (isSel || n.id === focus ? 3 : 2) : 0;
    G.size[G.index.get(n.id)] = sz;
    if (!galaxyMode) { hpos[i*3] = n.x; hpos[i*3+1] = n.y; hpos[i*3+2] = z; hcol[i*4] = r; hcol[i*4+1] = g; hcol[i*4+2] = b; hcol[i*4+3] = (isSel ? .2 : .1) * dim; hsize[i] = sz * 2.3; }
  }
  // Edges: important ones first, the rest in a spread-out order so that a partial
  // draw during camera motion still looks like the whole constellation.
  const total = links.length, baseA = Math.max(.1, Math.min(.34, .34 * Math.sqrt(400 / Math.max(1, total))));
  const stride = total > 1 ? [7919, 7907, 7901, 104729].find(p => total % p !== 0) : 1;
  const ends = new Int32Array(total * 2), flags = new Uint8Array(total); let m = 0, important = 0;
  for (let t = 0; t < total; t++) {
    const e = links[(t * stride) % total], ia = G.index.get(e[0]), ib = G.index.get(e[1]);
    if (ia == null || ib == null || ia === ib) continue;
    const f = (e[0] === selected || e[1] === selected) ? 1 : (focus && (e[0] === focus || e[1] === focus)) ? 2 : 0;
    ends[m*2] = ia; ends[m*2+1] = ib; flags[m] = f; if (f) important++; m++;
  }
  const edgeP = new Float32Array(m * 6), edgeC = new Float32Array(m * 8);
  const baseC = [.42, .57, .85, focus ? baseA * .35 : baseA], selC = [.68, .77, 1, .7], hovC = [.82, .86, 1, .75];
  let front = 0, back = important;
  for (let t = 0; t < m; t++) {
    const f = flags[t], slot = f ? front++ : back++, a = shown[ends[t*2]], b = shown[ends[t*2+1]], c = f === 1 ? selC : f === 2 ? hovC : baseC;
    const o = slot * 6; edgeP[o] = a.x; edgeP[o+1] = a.y; edgeP[o+2] = is3d ? (a.z || 0) : 0; edgeP[o+3] = b.x; edgeP[o+4] = b.y; edgeP[o+5] = is3d ? (b.z || 0) : 0;
    const q = slot * 8; for (let k = 0; k < 4; k++) { edgeC[q+k] = c[k]; edgeC[q+4+k] = c[k]; }
  }
  G.importantEdges = important;
  G.edgeCount = edgeP.length / 6;
  G.scene = {pos, col, size, kind, edgeP, edgeC};
  if (gl) {
    uploadBatch(G.batches.edges, edgeP, edgeC, null, null, edgeP.length / 3);
    if (!galaxyMode) uploadBatch(G.batches.halos, hpos, hcol, hsize, hkind, N); else G.batches.halos.count = 0;
    uploadBatch(G.batches.nodes, pos, col, size, kind, N);
  }
  // Label priority: degree first, computed once per rebuild.
  G.order = shown.map((n, i) => i).sort((a, b) => (G.degree.get(shown[b].id) || 0) - (G.degree.get(shown[a].id) || 0));
}

/* ---------- Projection ---------- */
function projector(){
  const w = svg.clientWidth, h = svg.clientHeight, unit = Math.min(w * .38, h * .44) * scale;
  const cy = Math.cos(is3d ? rotY : 0), sy = Math.sin(is3d ? rotY : 0), cx = Math.cos(is3d ? rotX : 0), sx = Math.sin(is3d ? rotX : 0);
  const ox = w / 2 + panX, oy = h * .51 + panY;
  const fn = n => { const x = n.x, y = n.y, z = is3d ? (n.z || 0) : 0; const xx = x*cy - z*sy, zz = x*sy + z*cy, yy = y*cx - zz*sx, depth = y*sx + zz*cx; const f = 1 / Math.max(.3, 1 + depth * .27); return {x: ox + xx*unit*f, y: oy + yy*unit*f, r: f, depth}; };
  fn.w = w; fn.h = h; return fn;
}

/* ---------- Rendering ---------- */
function markMotion(){
  G.motion = true; clearTimeout(G.motionTimer);
  G.motionTimer = setTimeout(() => { G.motion = false; G.lastFrame = 0; if (!currentGalaxyId && is3d && G.shown.length > 1) queueRefresh(); else queueRender(); }, 170);
}
function renderGraph(){
  G.renderFrame = 0;
  const now = performance.now();
  if (G.motion && G.lastFrame) { const dt = now - G.lastFrame; if (dt > 40) G.edgeBudget = Math.max(300, G.edgeBudget * .6); else if (dt < 22) G.edgeBudget = Math.min(200000, G.edgeBudget * 1.25); }
  G.lastFrame = G.motion ? now : 0;
  if (typeof documentMode !== 'undefined' && documentMode) return;
  const w = svg.clientWidth, h = svg.clientHeight; if (!w || !h) return;
  window.renderCosmosSky?.(is3d ? rotY : 0, is3d ? rotX : 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  if (labelCanvas.width !== cw || labelCanvas.height !== ch) { labelCanvas.width = cw; labelCanvas.height = ch; }
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0); lctx.clearRect(0, 0, w, h);
  if (gl) {
    canvas.style.display = 'block';
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    gl.viewport(0, 0, cw, ch); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(glProgram);
    const ry = is3d ? rotY : 0, rx = is3d ? rotX : 0, cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    gl.uniformMatrix3fv(glLoc.r, false, new Float32Array([cy, -sx*sy, cx*sy, 0, cx, sx, -sy, -sx*cy, cx*cy]));
    const unit = Math.min(w * .38, h * .44);
    gl.uniform2f(glLoc.scale, unit * 2 / w * scale, -unit * 2 / h * scale);
    gl.uniform2f(glLoc.pan, panX * 2 / w, -.02 - panY * 2 / h);
    gl.uniform1f(glLoc.pointScale, pointScale() * dpr);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    const edges = G.batches.edges, full = edges.count;
    if (G.motion && full > 2 * G.edgeBudget) edges.count = 2 * Math.max(G.importantEdges, Math.floor(G.edgeBudget));
    drawBatch(edges, gl.LINES); edges.count = full;
    drawBatch(G.batches.halos, gl.POINTS);
    if (currentGalaxyId) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); }
    drawBatch(G.batches.nodes, gl.POINTS);
    gl.depthMask(true);
  } else { canvas.style.display = 'none'; renderFallback(w, h); }
  renderLabels();
  positionTooltip();
}
function renderFallback(w, h){
  const P = projector(), shown = G.shown, ps = pointScale();
  lctx.lineWidth = 1;
  const pts = shown.map(n => P(n));
  for (const e of links) {
    const i = G.index.get(e[0]), j = G.index.get(e[1]); if (i == null || j == null) continue;
    const sel = e[0] === selected || e[1] === selected;
    lctx.strokeStyle = sel ? 'rgba(174,191,255,.7)' : 'rgba(128,159,215,.3)';
    lctx.beginPath(); lctx.moveTo(pts[i].x, pts[i].y); lctx.lineTo(pts[j].x, pts[j].y); lctx.stroke();
  }
  const order = shown.map((n, i) => i).sort((a, b) => pts[b].depth - pts[a].depth);
  for (const i of order) {
    const n = shown[i], p = pts[i], r = Math.max(2, G.size[i] * p.r * ps / (currentGalaxyId ? 2 : 3.2));
    const g = lctx.createRadialGradient(p.x - r * .3, p.y - r * .3, r * .1, p.x, p.y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.25, noteColor(n)); g.addColorStop(1, noteColor(n) + '22');
    lctx.fillStyle = g; lctx.beginPath(); lctx.arc(p.x, p.y, r, 0, Math.PI * 2); lctx.fill();
  }
}
let labelFont = null;
function renderLabels(){
  const shown = G.shown; if (!shown.length) return;
  if (!labelFont) { const f = getComputedStyle(document.body).fontFamily; labelFont = `500 11px ${f}`; }
  const P = projector(), w = P.w, h = P.h, ps = pointScale();
  const budget = showLabels ? Math.round(Math.min(260, 30 + 45 * scale * scale)) : 0;
  const forced = [], seen = new Set();
  const push = id => { const i = G.index.get(id); if (i != null && !seen.has(i)) { seen.add(i); forced.push(i); } };
  if (G.hover) push(G.hover);
  if (selected) push(selected);
  if (showLabels && selected) { let k = 0; for (const id of G.adj.get(selected) || []) { if (k++ > 40) break; push(id); } }
  const candidates = forced.slice();
  if (budget) for (const i of G.order) { if (candidates.length >= budget * 3) break; if (!seen.has(i)) candidates.push(i); }
  const cell = 48, grid = new Map(), boxes = [];
  const collides = (x0, y0, x1, y1) => {
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
      const list = grid.get(gx * 100003 + gy); if (!list) continue;
      for (const b of list) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return true;
    }
    return false;
  };
  const occupy = box => { for (let gx = Math.floor(box[0] / cell); gx <= Math.floor(box[2] / cell); gx++) for (let gy = Math.floor(box[1] / cell); gy <= Math.floor(box[3] / cell); gy++) { const k = gx * 100003 + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(box); } };
  // Keep labels out from under the floating toolbars.
  const origin = svg.getBoundingClientRect();
  for (const sel of ['.graph-head', '.graph-explore', '#galaxy-navigation', '.graph-tools', '.legend', '.graph-hint:not(.faded)']) {
    const el = document.querySelector(sel); if (!el || !el.offsetParent) continue;
    for (const child of sel === '.graph-head' ? el.querySelectorAll('.graph-title,.graph-controls') : sel === '.graph-explore' ? el.querySelectorAll('button') : [el]) {
      const r = child.getBoundingClientRect(); if (!r.width) continue;
      occupy([r.left - origin.left - 4, r.top - origin.top - 4, r.right - origin.left + 4, r.bottom - origin.top + 4]);
    }
  }
  lctx.font = labelFont; lctx.textAlign = 'center'; lctx.textBaseline = 'top'; lctx.lineJoin = 'round'; lctx.lineWidth = 4;
  let drawn = 0;
  for (let c = 0; c < candidates.length; c++) {
    const i = candidates[c], isForced = c < forced.length;
    if (!isForced && drawn >= budget) break;
    const n = shown[i], p = P(n);
    if (p.x < -60 || p.y < -30 || p.x > w + 60 || p.y > h + 30) continue;
    let text = n.title || 'Sans titre'; if (text.length > 42) text = text.slice(0, 40) + '…';
    let tw = G.labelWidths.get(text); if (tw == null) { tw = lctx.measureText(text).width; if (G.labelWidths.size > 20000) G.labelWidths.clear(); G.labelWidths.set(text, tw); }
    const radius = G.size[i] * p.r * ps / (currentGalaxyId ? 2 : 2.6);
    const y = p.y + radius + 4, box = [p.x - tw / 2 - 3, y - 1, p.x + tw / 2 + 3, y + 14];
    if (!isForced && collides(...box)) continue;
    occupy(box); drawn++;
    const strong = n.id === selected || n.id === G.hover;
    lctx.globalAlpha = strong ? 1 : Math.max(.45, Math.min(1, p.r));
    lctx.strokeStyle = '#0b1124'; lctx.strokeText(text, p.x, y);
    lctx.fillStyle = strong ? '#ffffff' : '#c7d5ed'; lctx.fillText(text, p.x, y);
  }
  lctx.globalAlpha = 1;
}
function queueRender(){ if (!G.renderFrame) G.renderFrame = requestAnimationFrame(renderGraph); }
function refreshGraph(){ ensureModel(true); rebuildScene(); renderGraph(); }
function queueRefresh(){ if (!G.refreshFrame) G.refreshFrame = requestAnimationFrame(() => { G.refreshFrame = 0; refreshGraph(); }); }

function draw(){
  if (typeof documentMode !== 'undefined' && documentMode) { updateCounts(); return; }
  renderGalaxyUI();
  if (!layoutFrame) document.getElementById('layout-graph').textContent = is3d ? 'Organiser en 3D' : 'Organiser en 2D';
  document.getElementById('neighbors-toggle').classList.toggle('on', neighborsOnly);
  document.getElementById('labels-toggle').classList.toggle('on', showLabels);
  document.getElementById('focus-note').disabled = !selected;
  document.getElementById('layout-graph').disabled = notes.length < 2;
  document.getElementById('graph-welcome').hidden = notes.length > 0;
  ensureModel(true);
  let shown = notes.filter(visible);
  if (shown.length > GRAPH_LIMIT) { const picked = shown.find(n => n.id === selected); shown = shown.slice(0, GRAPH_LIMIT); if (picked && !shown.includes(picked)) shown[GRAPH_LIMIT - 1] = picked; }
  G.shown = shown;
  if (G.hover && (!G.byId.has(G.hover) || !shown.some(n => n.id === G.hover))) { G.hover = null; tooltip.hidden = true; svg.style.cursor = ''; }
  updateCounts();
  rebuildScene();
  const filtered = shown.length !== notes.length ? ` sur ${notes.length.toLocaleString('fr-FR')}` : '';
  document.querySelector('.graph-title p').innerHTML = `<span id="visible-count">${shown.length.toLocaleString('fr-FR')}</span> notes${filtered}${notes.length > GRAPH_LIMIT ? ' · vue limitée, utilise les filtres' : ''} <span style="color:#4c5550">·</span> ${G.edgeCount.toLocaleString('fr-FR')} connexions <span style="color:#4c5550">·</span> espace privé`;
  window.updateFilterBadge?.();
  renderGraph();
}
function queueDraw(){ if (!drawFrame) drawFrame = requestAnimationFrame(() => { drawFrame = 0; draw(); }); }

/* ---------- Saving camera without stalling ---------- */
let workspaceSaveTimer = 0;
const writeWorkspaceNow = saveWorkspace;
saveWorkspace = function(){ clearTimeout(workspaceSaveTimer); workspaceSaveTimer = 0; return writeWorkspaceNow(); };
function scheduleWorkspaceSave(delay = 900){ clearTimeout(workspaceSaveTimer); workspaceSaveTimer = setTimeout(() => { workspaceSaveTimer = 0; writeWorkspaceNow(); }, delay); }
function pendingWorkspaceSave(){ return !!workspaceSaveTimer; }
window.addEventListener('pagehide', () => { if (workspaceSaveTimer) saveWorkspace(); });

/* ---------- Camera ---------- */
function zoomLabel(){ document.getElementById('zoomlevel').textContent = Math.round(scale * 100) + '%'; }
function zoomAt(factor, sx, sy){
  const w = svg.clientWidth, h = svg.clientHeight;
  const cx = (sx ?? w / 2) - w / 2, cy = (sy ?? h * .51) - h * .51;
  const old = scale; scale = Math.max(.3, Math.min(12, scale * factor)); const k = scale / old;
  panX = cx - (cx - panX) * k; panY = cy - (cy - panY) * k; markMotion();
  zoomLabel(); queueRender(); scheduleWorkspaceSave();
}
function fitGraph(animate = true){
  const shown = G.shown.length ? G.shown : notes; if (!shown.length) return;
  const w = svg.clientWidth, h = svg.clientHeight; if (!w || !h) return;
  const saved = {scale, panX, panY}; scale = 1; panX = 0; panY = 0;
  const P = projector(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of shown) { const p = P(n); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const bw = Math.max(40, x1 - x0), bh = Math.max(40, y1 - y0);
  const target = Math.max(.3, Math.min(shown.length === 1 ? 1.4 : 6, Math.min((w * .78) / bw, (h * .6) / bh)));
  const ax = (x0 + x1) / 2 - w / 2, ay = (y0 + y1) / 2 - h * .51;
  const to = {scale: target, panX: -ax * target, panY: -ay * target - 8};
  scale = saved.scale; panX = saved.panX; panY = saved.panY;
  animateCamera(to, animate ? 380 : 0);
}
let cameraAnim = 0;
function animateCamera(to, ms){
  cancelAnimationFrame(cameraAnim);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!ms || reduce) { scale = to.scale ?? scale; panX = to.panX ?? panX; panY = to.panY ?? panY; if (to.rotX != null) rotX = to.rotX; if (to.rotY != null) rotY = to.rotY; zoomLabel(); queueRender(); scheduleWorkspaceSave(); return; }
  const from = {scale, panX, panY, rotX, rotY}, t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
    const lerp = k => to[k] == null ? from[k] : from[k] + (to[k] - from[k]) * e;
    markMotion(); scale = lerp('scale'); panX = lerp('panX'); panY = lerp('panY'); rotX = lerp('rotX'); rotY = lerp('rotY');
    zoomLabel(); renderGraph();
    if (t < 1) cameraAnim = requestAnimationFrame(step); else { cameraAnim = 0; scheduleWorkspaceSave(); }
  };
  cameraAnim = requestAnimationFrame(step);
}
function focusSelected(){
  const n = notes.find(v => v.id === selected); if (!n) return;
  const p = project(n), {w, h} = dims();
  panX += w / 2 - p.x; panY += h * .51 - p.y;
  queueRender(); saveWorkspace();
}
function focusSelectedSmooth(){
  const n = notes.find(v => v.id === selected); if (!n) return;
  const p = project(n), {w, h} = dims();
  animateCamera({panX: panX + w / 2 - p.x, panY: panY + h * .51 - p.y}, 320);
}

/* ---------- Picking ---------- */
function pickNode(clientX, clientY){
  const rect = svg.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
  const P = projector(), ps = pointScale(), galaxyMode = !currentGalaxyId;
  let best = null, bestScore = Infinity;
  for (let i = 0; i < G.shown.length; i++) {
    const n = G.shown[i], p = P(n);
    const rad = Math.max(8, G.size[i] * p.r * ps / (galaxyMode ? 2.6 : 2));
    const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
    if (d2 > rad * rad) continue;
    const score = d2 / (rad * rad) + p.depth * .4;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

/* ---------- Tooltip ---------- */
const tooltip = document.createElement('div');
tooltip.className = 'graph-tooltip'; tooltip.hidden = true; document.getElementById('main').append(tooltip);
function setHover(id){
  if (G.hover === id) return;
  G.hover = id; svg.style.cursor = id ? 'pointer' : '';
  const n = id && G.byId.get(id);
  if (!n) { tooltip.hidden = true; } else {
    const deg = G.degree.get(n.id) || 0, stars = n.starMap?.notes?.length || 0;
    const preview = String(n.body || '').replace(/^#.*$/m, '').replace(/[#*_>`\[\]]/g, '').trim().slice(0, 110);
    tooltip.innerHTML = `<div class="tt-kind"><i style="background:${noteColor(n)}"></i>${escapeHtml(n.group)}</div><strong>${escapeHtml(n.title)}</strong>${preview ? `<p>${escapeHtml(preview)}${n.body.length > 110 ? '…' : ''}</p>` : ''}<small>${deg} connexion${deg > 1 ? 's' : ''}${!currentGalaxyId ? ` · ${stars} étoile${stars > 1 ? 's' : ''} · double-clic pour ouvrir` : ''} · clic droit : actions</small>`;
    tooltip.hidden = false;
  }
  queueRefresh();
}
function positionTooltip(){
  if (tooltip.hidden || !G.hover) return;
  const n = G.byId.get(G.hover); if (!n) return;
  const p = projector()(n), i = G.index.get(n.id), r = i == null ? 10 : G.size[i] * p.r * pointScale() / (currentGalaxyId ? 2 : 2.6);
  const w = svg.clientWidth, tw = tooltip.offsetWidth || 220;
  let x = p.x + r + 12, y = p.y - 20; if (x + tw > w - 10) x = p.x - r - 12 - tw;
  tooltip.style.transform = `translate(${Math.round(x)}px,${Math.round(Math.max(90, y))}px)`;
}

/* ---------- Pointer interactions ---------- */
let hoverFrame = 0, lastPointer = null;
svg.addEventListener('contextmenu', e => e.preventDefault());
svg.addEventListener('pointerdown', e => {
  window.closeGraphMenus?.();
  cancelAnimationFrame(cameraAnim);
  const hit = pickNode(e.clientX, e.clientY);
  try { svg.setPointerCapture(e.pointerId); } catch {}
  if (hit && e.button === 2) { drag = {type: 'menu', id: hit.id, sx: e.clientX, sy: e.clientY, rx: rotX, ry: rotY, px: panX, py: panY, panning: true, moved: false}; return; }
  if (hit && e.button === 0) { if (layoutFrame) cancelLayout(); drag = {type: 'node', id: hit.id, sx: e.clientX, sy: e.clientY, ox: hit.x, oy: hit.y, oz: hit.z || 0, moved: false}; return; }
  drag = {type: 'pan', sx: e.clientX, sy: e.clientY, rx: rotX, ry: rotY, px: panX, py: panY, panning: e.shiftKey || e.button === 2 || e.button === 1 || !is3d, moved: false};
  document.getElementById('main').classList.add('graph-grabbing');
});
window.addEventListener('pointermove', e => {
  if (!drag) {
    if (e.target !== svg) { if (G.hover && !e.target.closest?.('.graph-tooltip')) setHover(null); return; }
    lastPointer = e; if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (lastPointer) setHover(pickNode(lastPointer.clientX, lastPointer.clientY)?.id || null); });
    return;
  }
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
  if (drag.type === 'menu') { if (!drag.moved) return; drag.type = 'pan'; }
  if (drag.type === 'node') {
    const n = notes.find(v => v.id === drag.id); if (!n) return;
    const {w, h} = dims(), u = Math.min(w * .38, h * .44) * scale;
    const cy = Math.cos(is3d ? rotY : 0), sy = Math.sin(is3d ? rotY : 0), cx = Math.cos(is3d ? rotX : 0), sx = Math.sin(is3d ? rotX : 0), factor = project({x: drag.ox, y: drag.oy, z: drag.oz}).r;
    const vx = dx / u / factor, vy = dy / u / factor;
    if (e.altKey && is3d) n.z = Math.max(-2.5, Math.min(2.5, drag.oz + dy / u));
    else { n.x = drag.ox + cy * vx - sx * sy * vy; n.y = drag.oy + cx * vy; n.z = drag.oz - sy * vx - sx * cy * vy; }
    queueRefresh(); return;
  }
  markMotion();
  if (drag.panning) { panX = drag.px + dx; panY = drag.py + dy; }
  else { rotY = drag.ry + dx * .006; rotX = Math.max(-1.45, Math.min(1.45, drag.rx + dy * .006)); }
  queueRender();
});
window.addEventListener('pointerup', e => {
  if (!drag) return;
  const done = drag; drag = null;
  document.getElementById('main').classList.remove('graph-grabbing');
  window.markGraphUsed?.();
  if (done.type === 'node') {
    ignoreClickUntil = performance.now() + 120;
    if (!done.moved) {
      select(done.id);
      if (lastNodeClick.id === done.id && performance.now() - lastNodeClick.time < 350) openGalaxy(done.id);
      lastNodeClick = {id: done.id, time: performance.now()};
    } else persist();
    return;
  }
  if (done.type === 'menu') { if (!done.moved) window.openNodeMenu?.(done.id, e.clientX, e.clientY); return; }
  if (done.moved) scheduleWorkspaceSave();
});
window.addEventListener('pointercancel', () => { if (drag?.type === 'node' && drag.moved) persist(); drag = null; document.getElementById('main').classList.remove('graph-grabbing'); });
svg.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = svg.getBoundingClientRect(), delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  zoomAt(Math.exp(-delta * .0012), e.clientX - rect.left, e.clientY - rect.top);
  window.markGraphUsed?.();
}, {passive: false});
document.getElementById('zoom-in').onclick = () => zoomAt(1.2);
document.getElementById('zoom-out').onclick = () => zoomAt(1 / 1.2);
document.getElementById('center').onclick = () => animateCamera({scale: 1, rotY: -.22, rotX: .18, panX: 0, panY: 0}, 360);
new ResizeObserver(() => queueRender()).observe(document.getElementById('main'));

/* ---------- Layout: force-directed with a spatial grid (O(n) per tick) ---------- */
function cancelLayout(){ if (layoutFrame) cancelAnimationFrame(layoutFrame); layoutFrame = 0; const b = document.getElementById('layout-graph'); b.textContent = is3d ? 'Organiser en 3D' : 'Organiser en 2D'; b.classList.remove('on'); }
function organizeGraph(){
  cancelLayout(); if (notes.length < 2) return;
  lastLayout = Object.fromEntries(notes.map(n => [n.id, {x: n.x, y: n.y, z: n.z}]));
  document.getElementById('undo-layout').disabled = false;
  const button = document.getElementById('layout-graph'); button.textContent = 'Placement… (Échap)'; button.classList.add('on');
  const layoutProject = activeProjectId, layoutNotes = notes, N = notes.length, three = is3d;
  const P = new Float64Array(N * 3), D = new Float64Array(N * 3), idx = new Map(notes.map((n, i) => [n.id, i]));
  notes.forEach((n, i) => { P[i*3] = n.x || 0; P[i*3+1] = n.y || 0; P[i*3+2] = three ? (n.z || 0) : 0; });
  const E = []; for (const e of links) { const i = idx.get(e[0]), j = idx.get(e[1]); if (i != null && j != null && i !== j) E.push(i, j); }
  const k = Math.min(.48, .8 * (three ? Math.cbrt(Math.pow(4.2, 3) / N) : Math.sqrt(4.2 * 4.2 / N)));
  const cell = k * (three ? 1.6 : 2), inv = 1 / cell, cut2 = cell * cell, k2 = k * k, gravity = Math.max(.06, k2 * N / 3.2);
  const TICKS = Math.min(320, 110 + Math.round(N / 30));
  let temp = Math.max(.04, k * 1.2), tick = 0;
  const gw = Math.ceil(4.8 * inv) + 3, cells = three ? gw * gw * gw : gw * gw;
  const start = new Int32Array(cells + 1), order = new Int32Array(N), cellOf = new Int32Array(N), cc = new Int32Array(N * 3);
  const cellCoord = v => Math.max(0, Math.min(gw - 1, Math.floor((v + 2.4) * inv) + 1));
  // Far field: a coarse grid of centres of mass keeps the whole map spread out
  // (global repulsion) without comparing every pair of notes.
  const CG = three ? 8 : 16, cgCells = three ? CG * CG * CG : CG * CG, cgN = new Float64Array(cgCells), cgX = new Float64Array(cgCells), cgY = new Float64Array(cgCells), cgZ = new Float64Array(cgCells), cgOf = new Int32Array(N);
  const cgCoord = v => Math.max(0, Math.min(CG - 1, Math.floor((v + 2.4) / 4.8 * CG)));
  const oneTick = () => {
    D.fill(0); start.fill(0); cgN.fill(0); cgX.fill(0); cgY.fill(0); cgZ.fill(0);
    for (let i = 0; i < N; i++) { const c = ((three ? cgCoord(P[i*3+2]) : 0) * CG + cgCoord(P[i*3+1])) * CG + cgCoord(P[i*3]); cgOf[i] = c; cgN[c]++; cgX[c] += P[i*3]; cgY[c] += P[i*3+1]; cgZ[c] += P[i*3+2]; }
    const active = []; for (let c = 0; c < cgCells; c++) if (cgN[c]) { cgX[c] /= cgN[c]; cgY[c] /= cgN[c]; cgZ[c] /= cgN[c]; active.push(c); }
    for (let i = 0; i < N; i++) {
      const own = cgOf[i], px = P[i*3], py = P[i*3+1], pz = P[i*3+2]; let fx = 0, fy = 0, fz = 0;
      for (const c of active) { if (c === own) continue; const dx = px - cgX[c], dy = py - cgY[c], dz = three ? pz - cgZ[c] : 0; const d2 = dx*dx + dy*dy + dz*dz + 1e-6, f = k2 * cgN[c] / d2; fx += dx*f; fy += dy*f; fz += dz*f; }
      D[i*3] = fx; D[i*3+1] = fy; D[i*3+2] = fz;
    }
    for (let i = 0; i < N; i++) {
      const x = cellCoord(P[i*3]), y = cellCoord(P[i*3+1]), z = three ? cellCoord(P[i*3+2]) : 0;
      cc[i*3] = x; cc[i*3+1] = y; cc[i*3+2] = z;
      const c = (z * gw + y) * gw + x; cellOf[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells);
    for (let i = 0; i < N; i++) order[fill[cellOf[i]]++] = i;
    const zr = three ? 1 : 0;
    for (let i = 0; i < N; i++) {
      const x = cc[i*3], y = cc[i*3+1], z = cc[i*3+2];
      const px = P[i*3], py = P[i*3+1], pz = P[i*3+2];
      let fx = 0, fy = 0, fz = 0;
      for (let az = z - zr; az <= z + zr; az++) { if (az < 0 || az >= gw) continue;
        for (let ay = y - 1; ay <= y + 1; ay++) { if (ay < 0 || ay >= gw) continue;
          const row = (az * gw + ay) * gw, from = start[row + Math.max(0, x - 1)], to = start[row + Math.min(gw - 1, x + 1) + 1];
          for (let o = from; o < to; o++) {
            const j = order[o]; if (j === i) continue;
            let dx = px - P[j*3], dy = py - P[j*3+1], dz = three ? pz - P[j*3+2] : 0;
            let d2 = dx*dx + dy*dy + dz*dz;
            if (d2 > cut2) continue;
            if (d2 < 1e-8) { dx = (Math.random() - .5) * k * .1; dy = (Math.random() - .5) * k * .1; dz = three ? (Math.random() - .5) * k * .1 : 0; d2 = dx*dx + dy*dy + dz*dz + 1e-9; }
            const f = k2 / d2; fx += dx*f; fy += dy*f; fz += dz*f;
          }
        }
      }
      D[i*3] += fx; D[i*3+1] += fy; D[i*3+2] += fz;
    }
    for (let e = 0; e < E.length; e += 2) {
      const i = E[e], j = E[e+1];
      const dx = P[j*3] - P[i*3], dy = P[j*3+1] - P[i*3+1], dz = three ? P[j*3+2] - P[i*3+2] : 0;
      const f = Math.sqrt(dx*dx + dy*dy + dz*dz) / k;
      D[i*3] += dx*f; D[i*3+1] += dy*f; D[i*3+2] += dz*f; D[j*3] -= dx*f; D[j*3+1] -= dy*f; D[j*3+2] -= dz*f;
    }
    for (let i = 0; i < N; i++) {
      D[i*3] -= P[i*3] * gravity; D[i*3+1] -= P[i*3+1] * gravity; if (three) D[i*3+2] -= P[i*3+2] * gravity;
      const len = Math.hypot(D[i*3], D[i*3+1], three ? D[i*3+2] : 0); if (len < 1e-9) continue;
      const s = Math.min(len, temp) / len;
      P[i*3] = Math.max(-2.3, Math.min(2.3, P[i*3] + D[i*3] * s));
      P[i*3+1] = Math.max(-2.3, Math.min(2.3, P[i*3+1] + D[i*3+1] * s));
      if (three) P[i*3+2] = Math.max(-2.3, Math.min(2.3, P[i*3+2] + D[i*3+2] * s));
    }
    temp = Math.max(.0015, temp * .972);
  };
  const writeBack = () => { for (let i = 0; i < N; i++) { const n = layoutNotes[i]; n.x = P[i*3]; n.y = P[i*3+1]; if (three) n.z = P[i*3+2]; } };
  const step = () => {
    if (layoutProject !== activeProjectId || layoutNotes !== notes) { layoutFrame = 0; return; }
    const t0 = performance.now();
    do { oneTick(); tick++; } while (tick < TICKS && performance.now() - t0 < 28);
    G.layoutTicks = tick; G.layoutCompute = (G.layoutCompute || 0) + performance.now() - t0; markMotion();
    writeBack(); refreshGraph();
    if (tick < TICKS) layoutFrame = requestAnimationFrame(step);
    else { layoutFrame = 0; cancelLayout(); persist(); draw(); if (G.shown.length > 1) fitGraph(); toast('Placement terminé · ↶ pour annuler'); }
  };
  layoutFrame = requestAnimationFrame(step);
}
