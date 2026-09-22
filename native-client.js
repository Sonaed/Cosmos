let nativeStore=null;
let nativeHydrated=false;
function diskStatus(message,error=false){const el=document.getElementById('disk-status');if(el){el.textContent=message;el.style.color=error?'#e5aa87':'#9aae87'}}
function queueNativeSave(payload){if(!nativeStore||!nativeHydrated)return;diskStatus('Sauvegarde sur disque…');nativeStore.stageWorkspace(payload)}
function connectNativeStore(){
 if(typeof qt==='undefined'||typeof QWebChannel==='undefined'){diskStatus('Stockage local de cette fenêtre');return}
 new QWebChannel(qt.webChannelTransport,channel=>{
  nativeStore=channel.objects.vault;
  nativeStore.saved.connect(path=>{diskStatus('Sauvegardé sur disque');document.getElementById('disk-status').title=path});
  nativeStore.failed.connect(message=>{diskStatus('Sauvegarde à vérifier',true);toast(message)});
  nativeStore.markdownImported.connect(payload=>{try{importMarkdownNotes(JSON.parse(payload))}catch(e){toast('Import impossible : '+e.message)}});
  nativeStore.loadWorkspace(payload=>{
   try{const disk=payload?JSON.parse(payload):null;if(disk&&Array.isArray(disk.projects)&&disk.projects.length&&((disk.savedAt||0)>(workspace.savedAt||0)||(!hadStoredWorkspace&&!workspace.savedAt))){workspace=disk;currentGalaxyId=null;activeProjectId=workspace.projects.some(p=>p.id===workspace.activeId)?workspace.activeId:workspace.projects[0].id;notes=activeProject().notes;links=activeProject().links;selected=notes[0]?.id;editing=false;restoreCamera(activeProject().camera);syncWikiLinks();try{localStorage.setItem('cosmos-workspace-v2',JSON.stringify(workspace))}catch{}renderProjectUI();draw();renderDetail();toast('Projets restaurés depuis le disque')}}catch(e){diskStatus('Copie disque illisible : sauvegarde locale conservée',true)}
   nativeHydrated=true;window.cosmosNativeReady=true;queueNativeSave(JSON.stringify(workspace));
  });
 });
}
function openNativeVault(){if(nativeStore)nativeStore.openFolder();else toast('Disponible dans l’application de bureau')}
function chooseMarkdownFiles(){if(nativeStore)nativeStore.importMarkdown();else toast('Disponible dans l’application de bureau')}
function importMarkdownNotes(entries){if(!Array.isArray(entries))throw Error('Fichiers invalides');cancelLayout();let count=0;
 for(const entry of entries){if(typeof entry.title!=='string'||typeof entry.body!=='string')continue;let title=entry.title,body=entry.body,tags=[];
 const front=body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);if(front){for(const line of front[1].split(/\r?\n/)){if(line.startsWith('title: ')){try{title=JSON.parse(line.slice(7))}catch{title=line.slice(7).trim()}}if(line.startsWith('tags: ')){try{tags=JSON.parse(line.slice(6))}catch{}}}body=body.slice(front[0].length).replace(/^\r?\n/,'')}
 if(typeof title!=='string'||!title.trim())title=entry.title;const base=title;let suffix=2;while(notes.some(n=>n.title===title))title=base+' ('+(suffix++)+')';
 notes.push({id:'n'+crypto.randomUUID(),title,body,group:'Idées',tags:Array.isArray(tags)?tags.filter(t=>typeof t==='string'):[],x:(Math.random()-.5)*1.3,y:(Math.random()-.5)*1.3,z:(Math.random()-.5)*.6,updatedAt:new Date().toISOString()});count++;
 }
 if(count){filter='all';selected=notes[notes.length-1].id;persist();draw();renderDetail();toast(`${count} note(s) Markdown importée(s)`)}
}
