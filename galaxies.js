// Exactly two levels: project galaxies and their terminal star maps.
let currentGalaxyId = null;
function activeMap(){
  if (!currentGalaxyId) return activeProject();
  return activeProject().notes.find(n=>n.id===currentGalaxyId)?.starMap || activeProject();
}
function openGalaxy(id){
  if(currentGalaxyId) { select(id); return; }
  const galaxy=notes.find(n=>n.id===id);if(!galaxy)return;
  if(editing)captureEditor();cancelLayout();saveWorkspace();
  galaxy.starMap ||= {notes:[],links:[],trash:[]};
  currentGalaxyId=id;enterMap(galaxy.starMap);saveWorkspace();
}
function leaveGalaxy(){
  if(!currentGalaxyId)return;
  if(editing)captureEditor();cancelLayout();saveWorkspace();
  const id=currentGalaxyId;currentGalaxyId=null;enterMap(activeProject());select(id);saveWorkspace();
}
function enterMap(map){
  notes=map.notes;links=map.links;selected=notes[0]?.id;editing=false;filter='all';query='';neighborsOnly=false;lastLayout=null;lastNodeClick={id:null,time:0};
  document.getElementById('undo-layout').disabled=true;
  restoreCamera(map.camera);renderProjectUI();draw();renderDetail();
}
function renderGalaxyUI(){
  let bar=document.getElementById('galaxy-navigation');
  if(!bar){bar=document.createElement('div');bar.id='galaxy-navigation';document.getElementById('main').append(bar);}
  const galaxy=activeProject().notes.find(n=>n.id===currentGalaxyId);
  bar.replaceChildren();
  if(galaxy){const back=document.createElement('button');back.className='control';back.textContent='← Galaxies';back.onclick=leaveGalaxy;bar.append(back);const label=document.createElement('span');label.textContent=galaxy.title+' / Carte d’étoiles';bar.append(label);}
  else {const label=document.createElement('span');label.textContent='GALAXIES · Double-clique pour explorer les étoiles';bar.append(label);}
  document.querySelector('.graph-title h1').textContent=galaxy?'Carte d’étoiles':'Carte des galaxies';
  document.querySelector('.graph-welcome h2').textContent=galaxy?'La première étoile de cette galaxie.':'Ton univers commence ici.';
  document.querySelector('.graph-welcome p').textContent=galaxy?'Chaque étoile est une note. Relie-les pour construire cette carte, sans sous-galaxies.':'Crée une galaxie, puis ouvre-la pour y réunir tes notes sous forme d’étoiles.';
  document.querySelector('.graph-welcome button').textContent=galaxy?'＋ Créer une étoile':'＋ Créer une galaxie';
  for(const id of ['new-note-top','project-new-note','add-space'])document.getElementById(id).title=galaxy?'Nouvelle étoile':'Nouvelle galaxie';
}
function drawGalaxyGlyph(group,n,p){
  if(currentGalaxyId)return;
  const size=nodeSize(n)*p.r;
  const disk=createSvg('g',{transform:`rotate(-25) scale(${size/48})`,class:'galaxy-glyph','pointer-events':'none'});
  disk.append(createSvg('ellipse',{rx:27,ry:15,fill:'currentColor',opacity:'.08'}));
  for(let arm=0;arm<3;arm++){
    let d='';for(let i=0;i<=45;i++){const t=i/45,r=3+22*t,a=t*4.8+arm*Math.PI*2/3;d+=(i?'L':'M')+(Math.cos(a)*r).toFixed(2)+' '+(Math.sin(a)*r*.57).toFixed(2)+' ';}
    disk.append(createSvg('path',{d,fill:'none',stroke:'currentColor','stroke-width':2.4,opacity:'.65'}));
    disk.append(createSvg('path',{d,fill:'none',stroke:'currentColor','stroke-width':6,opacity:'.12'}));
  }
  disk.append(createSvg('ellipse',{rx:6,ry:4,fill:'currentColor'}));disk.append(createSvg('ellipse',{rx:2.8,ry:2,fill:'#fff5df'}));group.append(disk);
}
