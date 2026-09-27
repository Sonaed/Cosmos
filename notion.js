// Import data is inert content: never execute HTML, scripts or embedded instructions.
function cleanNotionTitle(value){return String(value||'Sans titre').replace(/\s+[a-f\d]{32}(?:_all)?$/i,'').trim()}
function csvTable(source){
 const records=[];let row=[],cell='',quoted=false;const text=String(source).replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted||!cell)quoted=!quoted;else cell+=c}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))records.push(row);row=[];cell=''}else cell+=c}
 if(cell||row.length){row.push(cell);records.push(row)}
 const seen=new Set(),columns=(records.shift()||[]).map((h,i)=>{let key=h||`Colonne ${i+1}`,base=key,j=2;while(seen.has(key))key=base+' ('+j+++')';seen.add(key);return key});
 const width=Math.max(columns.length,...records.map(r=>r.length));while(columns.length<width){let k=`Colonne ${columns.length+1}`;while(seen.has(k))k+=' ';seen.add(k);columns.push(k)}
 return {columns,rows:records.map(r=>Object.fromEntries(columns.map((k,i)=>[k,r[i]??''])))};
}
function csvRows(source){return csvTable(source).rows}
function databaseMarkdown(data){const esc=v=>String(v??'').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');return ['| '+data.columns.map(esc).join(' | ')+' |','| '+data.columns.map(()=>'---').join(' | ')+' |',...data.rows.map(r=>'| '+data.columns.map(k=>esc(r[k])).join(' | ')+' |')].join('\n')}
function notionUrl(src,path,root){try{const base='file://'+root.split('/').map(encodeURIComponent).join('/')+'/';const url=new URL(src,new URL(path.split('/').map(encodeURIComponent).join('/'),base));return ['file:','https:','http:','mailto:'].includes(url.protocol)?url.href:''}catch{return ''}}
function notionCellValue(td){if(!td)return '';const sel=[...td.querySelectorAll('.selected-value,.status-value')];if(sel.length)return sel.map(x=>x.textContent.trim()).filter(Boolean).join(', ');const box=td.querySelector('.checkbox');if(box)return box.classList.contains('checkbox-on')?'Yes':'No';const time=td.querySelector('time');if(time)return time.textContent.trim().replace(/^@/,'');const anchors=[...td.querySelectorAll('a')];if(anchors.length&&anchors.every(a=>!/^https?:/i.test(a.getAttribute('href')||'')))return anchors.map(a=>a.textContent.trim()).filter(Boolean).join(', ');if(anchors.length===1&&/^https?:/i.test(anchors[0].getAttribute('href')||''))return anchors[0].getAttribute('href');return td.textContent.replace(/\s+/g,' ').trim()}
const NOTION_TYPES={typesTitle:'title',typesText:'text',typesNumber:'number',typesSelect:'select',typesMultipleSelect:'multi_select',typesStatus:'status',typesDate:'date',typesCreatedAt:'date',typesLastEditedAt:'date',typesCheckbox:'checkbox',typesUrl:'url',typesEmail:'email',typesPhoneNumber:'phone',typesPerson:'person',typesCreatedBy:'person',typesLastEditedBy:'person',typesRelation:'relation',typesFormula:'formula',typesRollup:'formula',typesFile:'files'};
function notionPropType(el){const svg=el?.querySelector('svg[class*="types"],.property-icon svg,svg');const cls=[...(svg?.classList||[])].find(c=>NOTION_TYPES[c]);if(cls)return NOTION_TYPES[cls];const row=el?.closest?.('tr');const m=[...(row?.classList||[])].find(c=>c.startsWith('property-row-'));return m?({'property-row-select':'select','property-row-multi_select':'multi_select','property-row-status':'status','property-row-date':'date','property-row-checkbox':'checkbox','property-row-url':'url','property-row-number':'number','property-row-person':'person','property-row-relation':'relation','property-row-email':'email'})[m]||null:null}
function notionProperties(html){const doc=(html?.nodeType?html:new DOMParser().parseFromString(html,'text/html'));return Object.fromEntries([...doc.querySelectorAll('table.properties tr')].map(r=>{const cells=[...r.children];return [cells[0]?.textContent.trim()||'',cells.slice(1).map(notionCellValue).join(' · ')]}).filter(([k])=>k))}
function notionCollection(table,path,root){const heads=[...table.querySelectorAll('thead th')];const seen=new Set();const columns=heads.map((th,i)=>{let k=th.textContent.trim()||`Colonne ${i+1}`,b=k,j=2;while(seen.has(k))k=b+' ('+j+++')';seen.add(k);return k});const schema={};heads.forEach((th,i)=>{const t=notionPropType(th);if(t)schema[columns[i]]={type:i===0?'title':t}});if(columns[0])schema[columns[0]]={type:'title'};const rows=[...table.querySelectorAll('tbody tr')].map(tr=>{const cells=[...tr.children];const row=Object.fromEntries(columns.map((k,i)=>[k,notionCellValue(cells[i])]));const link=cells[0]?.querySelector('a[href]');if(link){const url=notionUrl(link.getAttribute('href'),path,root);if(url)row.__url=url}return row});return {columns,rows,schema}}
function notionTitle(html,fallback){const doc=(html?.nodeType?html:new DOMParser().parseFromString(html,'text/html'));return cleanNotionTitle(doc.querySelector('h1')?.textContent||doc.title||fallback)}
function notionHtmlToMarkdown(html,path,root,kind){
 if(kind==='markdown')return String(html).split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part,i)=>i%2?part:part.replace(/(!?\[[^\]]*\]\()([^\n]*?)(\))/g,(_,a,url,b)=>a+notionUrl(url,path,root)+b)).join('');
 if(kind==='csv')return databaseMarkdown(csvTable(html));
 const doc=(html?.nodeType?html:new DOMParser().parseFromString(html,'text/html'));doc.querySelectorAll('script,style,nav,iframe,object,embed,form,audio,video,.page-header-icon,.page-cover-image').forEach(e=>e.remove());doc.querySelectorAll('table.properties').forEach(table=>{const images=[...table.querySelectorAll('img')].filter(img=>!/^https?:/i.test(img.getAttribute('src')||''));table.replaceWith(...images)});
 const link=(url,text)=>'['+(text||url).replace(/[\[\]]/g,'').trim()+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/ /g,'%20')+')';
 const quote=text=>text.trim().replace(/\n{3,}/g,'\n\n').split('\n').map(l=>l.trim()?'> '+l:'>').join('\n');
 const inlineOf=node=>[...node.childNodes].map(walk).join('').replace(/\n{2,}/g,'\n').trim();
 function list(el,depth){const ordered=el.tagName==='OL';let n=Number(el.getAttribute('start'))||1;return [...el.children].filter(li=>li.tagName==='LI').map(li=>{
  const pad='  '.repeat(depth),details=li.querySelector(':scope > details');
  if(details){const sum=details.querySelector(':scope > summary');const body=[...details.childNodes].filter(c=>c!==sum).map(walk).join('').trim();return pad+quote('[!toggle] '+(sum?inlineOf(sum):'')+(body?'\n'+body:''))}
  const box=li.querySelector(':scope > .checkbox');const marker=box?'- ['+(box.classList.contains('checkbox-on')?'x':' ')+'] ':ordered?(n++)+'. ':'- ';
  const nested=[],parts=[];for(const c of li.childNodes){if(c.nodeType===1&&(c.tagName==='UL'||c.tagName==='OL'))nested.push(list(c,depth+1));else if(c.nodeType===1&&c.classList.contains('indented'))nested.push([...c.children].map(x=>x.tagName==='UL'||x.tagName==='OL'?list(x,depth+1):'  '.repeat(depth+1)+walk(x).trim().replace(/\n+/g,'\n'+'  '.repeat(depth+1))).join('\n'));else if(!(c.nodeType===1&&c.classList?.contains('checkbox')))parts.push(walk(c))}
  const text=parts.join('').replace(/\n{2,}/g,'\n').trim().replace(/\n/g,'\n'+pad+'  ');
  return pad+marker+text+(nested.length?'\n'+nested.filter(Boolean).join('\n'):'')}).join('\n')}
 function walk(node){if(node.nodeType===3)return node.textContent.replace(/\s+/g,' ');if(node.nodeType!==1)return '';const tag=node.tagName.toLowerCase(),cls=node.classList;const inner=()=>[...node.childNodes].map(walk).join('');
 if(tag==='img'){const url=notionUrl(node.getAttribute('src')||'',path,root);if(!url||/notion\.so\/icons|notion-static\.com\/.*emoji/i.test(url))return '';return '\n!['+(node.getAttribute('alt')||'Image').replace(/[\[\]]/g,'')+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')\n'}
 if(tag==='figure'){
  if(cls.contains('callout')){const icon=node.querySelector('.icon')?.textContent.trim()||'';const kids=[...node.children];const bodyEl=kids.length>1?kids[kids.length-1]:node;const color=[...cls].find(c=>/^block-color-/.test(c))||'';const type=/red/.test(color)?'danger':/yellow|orange/.test(color)?'warning':/green/.test(color)?'success':/blue|purple/.test(color)?'info':'note';const body=[...bodyEl.childNodes].map(walk).join('').trim();return '\n\n'+quote('[!'+type+'] '+icon+(body?'\n'+body:''))+'\n\n'}
  if(cls.contains('equation')){const tex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent||node.textContent;return '\n\n```math\n'+tex.trim()+'\n```\n\n'}
  if(cls.contains('link-to-page')){const a=node.querySelector('a[href]');if(a){const url=notionUrl(a.getAttribute('href'),path,root);const c=a.cloneNode(true);c.querySelectorAll('.icon,img').forEach(x=>x.remove());const text=c.textContent.replace(/\s+/g,' ').trim();return url?'\n\n'+link(url,text)+'\n\n':'\n\n'+text+'\n\n'}}
  const bm=node.querySelector('a.bookmark,a[href] .bookmark-info')?.closest('a');if(bm){const url=bm.getAttribute('href')||'';const title=bm.querySelector('.bookmark-title')?.textContent.trim()||url;return '\n\n'+(/^https?:/i.test(url)?link(url,title):title)+'\n\n'}
  const img=node.querySelector('img');if(img){const cap=node.querySelector('figcaption')?.textContent.trim();return '\n\n'+walk(img).trim()+(cap?'\n*'+cap.replace(/\*/g,'')+'*':'')+'\n\n'}
  const src=node.querySelector('.source a[href],a[href]');if(src&&!node.querySelector('p,ul,ol,table')){const url=notionUrl(src.getAttribute('href'),path,root);return '\n\n'+(url?link(url,src.textContent.trim()||decodeURIComponent(src.getAttribute('href')).split('/').pop()):src.textContent)+'\n\n'}
  return '\n\n'+inner().trim()+'\n\n'}
 if(tag==='a'){const url=notionUrl(node.getAttribute('href')||'',path,root);if(node.querySelector('img'))return inner();const text=inner().trim();return url?link(url,text):text}
 if(tag==='pre'){const code=node.querySelector('code');const lang=[...(code?.classList||[])].find(c=>c.startsWith('language-'))?.slice(9).toLowerCase().replace(/\s+/g,'')||'';return '\n\n```'+(lang==='plaintext'||lang==='plain'?'':lang)+'\n'+(code||node).textContent.replace(/\n$/,'')+'\n```\n\n'}
 if(tag==='code')return '`'+node.textContent+'`';
 if(cls.contains('notion-text-equation-token')){const tex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent||node.textContent;return '`'+tex.trim()+'`'}
 if(tag==='table'){if(cls.contains('collection-content')){const data=notionCollection(node,path,root);return '\n\n'+databaseMarkdown(data)+'\n\n'}const rr=[...node.rows].map(r=>[...r.cells].map(c=>[...c.childNodes].map(walk).join('').replace(/\n+/g,' ').trim()));if(!rr.length)return '';const columns=rr.shift().map((c,i)=>c||' '.repeat(i+1));return '\n\n'+databaseMarkdown({columns,rows:rr.map(r=>Object.fromEntries(columns.map((k,i)=>[k,r[i]||''])))})+'\n\n'}
 if(tag==='ul'||tag==='ol'){if(cls.contains('toggle')||node.querySelector(':scope > li > details'))return '\n\n'+list(node,0)+'\n\n';return '\n\n'+list(node,0)+'\n\n'}
 if(tag==='details'){const sum=node.querySelector(':scope > summary');const body=[...node.childNodes].filter(c=>c!==sum).map(walk).join('').trim();return '\n\n'+quote('[!toggle] '+(sum?inlineOf(sum):'')+(body?'\n'+body:''))+'\n\n'}
 if(tag==='summary')return inner();
 if(/^h[1-6]$/.test(tag)){if(node.parentElement?.tagName==='SUMMARY')return inner().trim();return '\n\n'+'#'.repeat(Number(tag[1]))+' '+inner().trim()+'\n\n'}
 if(tag==='br')return '\n';if(tag==='hr')return '\n\n---\n\n';if(tag==='strong'||tag==='b'){const t=inner();return t.trim()?'**'+t.trim()+'**'+(/\s$/.test(t)?' ':''):t}if(tag==='em'||tag==='i'){const t=inner();return t.trim()?'*'+t.trim()+'*'+(/\s$/.test(t)?' ':''):t}if(tag==='del'||tag==='s')return '~~'+inner()+'~~';
 if(tag==='li')return '\n- '+inner().trim()+'\n';
 if(tag==='blockquote')return '\n\n'+quote(inner().trim())+'\n\n';
 if(tag==='h4'&&cls.contains('collection-title'))return '\n\n### '+inner().trim()+'\n\n';
 if(['p','div','section','article','header','main','footer'].includes(tag)){const t=inner().trim();return t?'\n\n'+t+'\n\n':''}
 return inner();
 }
 return walk(doc.body).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function buildNotionProject(payload){
 if(!payload||!Array.isArray(payload.pages)||!payload.pages.length)throw Error('Export Notion vide');
 const pages=payload.pages.map(p=>({...p,path:String(p.path).replaceAll('\\','/')}));
 // Strip only a shared enclosing directory; never strip a root filename.
 let common=pages[0].path.split('/').slice(0,-1);for(const p of pages){const parts=p.path.split('/');while(common.some((v,i)=>parts[i]!==v))common.pop()}
 const prefix=common.length?common.join('/')+'/':'';
 const entries=payload.prepared||pages.map(p=>convertNotionPage(p,payload.root));for(const e of entries){e.path=e.note.notion.source.replace(/^Export-[^/]+\//,'');if(e.path===e.note.notion.source)e.path=e.path.slice(prefix.length);}
 dedupeNotionCsv(entries);
 const targets=new Map();for(const e of entries){targets.set(notionUrl(e.note.notion.source,'',e.note.notion.root),e.note);for(const a of e.note.notion.alternateSources||[])targets.set(notionUrl(a.source,'',a.root),e.note)}
 for(const entry of entries)for(const match of entry.note.body.matchAll(/(?<!!)\[([^\]]+)\]\((file:[^)]+)\)/g)){const target=targets.get(match[2]);if(target&&/^Untitled(?:\s|$)/i.test(target.title)&&!/^Untitled(?:\s|$)/i.test(match[1]))target.title=match[1]}
 // Links between imported pages become [[wiki links]] when the title is unambiguous.
 {const count=new Map();for(const e of entries){const k=e.note.title.trim().toLocaleLowerCase();count.set(k,(count.get(k)||0)+1)}
  for(const e of entries){if(e.note.notion.kind==='database')continue;e.note.body=e.note.body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part,i)=>i%2?part:part.replace(/(?<!!)\[([^\]]+)\]\((file:[^)\s]+)\)/g,(whole,text,url)=>{let target=targets.get(url);if(!target){try{target=targets.get(decodeURIComponent(url))||targets.get(url.replace(/%20/g,' '))}catch{}}if(!target)return whole;const t=target.title.trim();if(count.get(t.toLocaleLowerCase())!==1||/[\[\]|#]/.test(t))return whole;const label=text.replace(/\s+[a-f\d]{32}$/i,'').replace(/\.(md|html|csv)$/i,'').trim();return label.toLocaleLowerCase()===t.toLocaleLowerCase()||/%20|\.(md|html)$/i.test(text)?'[['+t+']]':whole})).join('')}}
 const project={id:'project-'+crypto.randomUUID(),name:'Notion · '+new Date().toLocaleDateString('fr-FR'),notes:[],links:[],trash:[]};
 const roots=entries.filter(e=>!e.path.includes('/'));if(!roots.length)roots.push(entries[0]);
 const folders=e=>[e.path.replace(/\.[^.]+$/,''),e.path.replace(/\s+[a-f\d]{32}\.[^.]+$/i,'')];
 for(const e of roots){e.note.starMap={notes:[],links:[],trash:[]};project.notes.push(e.note)}
 let orphan;
 for(const e of entries){if(roots.includes(e))continue;const owner=roots.filter(r=>folders(r).some(f=>e.path.startsWith(f+'/'))).sort((a,b)=>b.path.length-a.path.length)[0];if(owner)owner.note.starMap.notes.push(e.note);else{if(!orphan){orphan={id:'n'+crypto.randomUUID(),title:'Autres pages importées',body:'Pages conservées sans page racine correspondante dans cet export.',group:'Idées',tags:['notion'],x:0,y:0,z:0,starMap:{notes:[],links:[],trash:[]}};project.notes.push(orphan)}orphan.starMap.notes.push(e.note)}}
 return project;
}
function markdownNotionContent(source,path,root){
 let body=String(source),properties={};const header=body.match(/^(# [^\n]+\r?\n\s*\n)((?:[^:\n]{1,80}: [^\n]*\r?\n?)+)/);
 if(header){const lines=header[2].trim().split(/\r?\n/);if(lines.length>1||/^[\p{L}][^:\n]{0,40}: /u.test(lines[0]||'')){for(const line of lines){const colon=line.indexOf(': ');const value=line.slice(colon+2);properties[line.slice(0,colon)]=/\.(md|html|csv)\)/i.test(value)&&typeof dbCleanRelation==='function'?dbCleanRelation(value):value}body=header[1]+body.slice(header[0].length)}}
 const attachments=[];for(const [key,value] of Object.entries(properties))for(const file of value.split(/,\s*/)){if(/\.(png|jpe?g|gif|webp|svg)$/i.test(file.trim()))attachments.push(`![${key}](${notionUrl(file.trim(),path,root)})`);else if(/\.(pdf|psd|eps)$/i.test(file.trim()))attachments.push(`[${key}](${notionUrl(file.trim(),path,root)})`)}
 body=body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part,i)=>{if(i%2)return part;return part.replace(/<aside>([\s\S]*?)<\/aside>/gi,(_,content)=>{const lines=content.replace(/<br\s*\/?>/gi,'\n').trim().split('\n');return ['> [!note] '+(lines.shift()||''),...lines.map(line=>'> '+line)].join('\n')}).replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,(_,sum,content)=>['> [!toggle] '+sum.replace(/<[^>]+>/g,'').trim(),...content.trim().split('\n').map(line=>'> '+line)].join('\n')).replace(/<br\s*\/?>/gi,'  \n').replace(/<img\b[^>]*>/gi,tag=>{const img=new DOMParser().parseFromString(tag,'text/html').querySelector('img');const src=img?.getAttribute('src');if(!src||src.includes('app.notion.com/icons/'))return '';return `![${img.getAttribute('alt')||'Image'}](${notionUrl(src,path,root)})`})}).join('');
 return {body:notionHtmlToMarkdown(body,path,root,'markdown')+(attachments.length?'\n\n'+attachments.join('\n\n'):''),properties};
}
function convertNotionPage(p,defaultRoot){
 const csv=p.kind==='csv',md=p.kind==='markdown',root=p.assetRoot||defaultRoot;
 const doc=csv||md?null:new DOMParser().parseFromString(p.html,'text/html');
 const markdown=md?markdownNotionContent(p.html,p.path,root):null;const properties=doc?notionProperties(doc):markdown?.properties||{};
 const title=csv?cleanNotionTitle(p.title):md?cleanNotionTitle(String(p.html).match(/^# (.+)$/m)?.[1]||p.title):notionTitle(doc,p.title);
 let icon,cover,htmlDb=null;
 if(doc){const ic=doc.querySelector('.page-header-icon');const t=ic?.textContent.trim();if(t&&[...t].length<=4)icon=t;const cv=doc.querySelector('img.page-cover-image')?.getAttribute('src');if(cv)cover=notionUrl(cv,p.path,root)||undefined;
  const table=doc.querySelector('table.collection-content');if(table){const clone=doc.body.cloneNode(true);clone.querySelectorAll('table.collection-content,header,.collection-title,h1,script,style').forEach(e=>e.remove());if(clone.textContent.replace(/\s+/g,'').length<300)htmlDb=notionCollection(table,p.path,root)}}
 const data=csv?csvTable(p.html):htmlDb||{};const stamp=new Date().toISOString();const isDb=csv||!!htmlDb;
 const body=isDb?databaseMarkdown(data):md?markdown.body:notionHtmlToMarkdown(doc,p.path,root,p.kind);
 const note={id:'n'+crypto.randomUUID(),title,body,group:'Idées',tags:['notion',isDb?'tableur':p.kind],x:(Math.random()-.5)*1.4,y:(Math.random()-.5)*1.2,z:(Math.random()-.5)*.7,updatedAt:stamp,notion:{version:3,kind:isDb?'database':md?'document':'page',source:p.path,root,properties,importedAt:stamp,...data}};
 if(icon)note.icon=icon;if(cover)note.cover=cover;
 if(isDb&&typeof dbEnsure==='function')try{dbEnsure(note.notion)}catch{}
 return {path:p.path,note};
}
// Notion Markdown exports ship "DB id.csv" (current view) next to "DB id_all.csv" (every row): keep the complete one.
function dedupeNotionCsv(entries){
const byKey=new Map();for(const e of entries){const src=e.note.notion.source;if(!/\.csv$/i.test(src))continue;const key=e.note.notion.root+'|'+src.replace(/_all\.csv$/i,'.csv');if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(e)}
  const drop=new Set();for(const group of byKey.values()){if(group.length<2)continue;const keep=group.find(e=>/_all\.csv$/i.test(e.note.notion.source))||group[0];for(const e of group)if(e!==keep){drop.add(e);(keep.note.notion.alternateSources||=[]).push({source:e.note.notion.source,root:e.note.notion.root})}}
  if(drop.size)for(let i=entries.length-1;i>=0;i--)if(drop.has(entries[i]))entries.splice(i,1)
 return entries}
function mergeNotionExports(entries){
 entries=dedupeNotionCsv([...entries]);
 const byIdentity=new Map(),merged=[];
 for(const entry of entries){const n=entry.note,d=n.notion;const sourceId=d.source.match(/([a-f\d]{32})(?:_all)?\.[^.]+$/i)?.[1];const identity=d.kind==='database'?(sourceId?'db:'+sourceId:'csv:'+JSON.stringify([d.columns,d.rows])):sourceId?'page:'+sourceId:null;
 const existing=identity&&byIdentity.get(identity);if(!existing||existing.note.notion.root===d.root){merged.push(entry);if(identity)byIdentity.set(identity,entry);continue}
 const old=existing.note,previous=old.notion;
 const incomingMd=d.kind==='document'||/\.csv$/i.test(d.source),oldMd=previous.kind==='document'||/\.csv$/i.test(previous.source);
 const preferred=incomingMd&&!oldMd?n:old,other=preferred===n?old:n;
 if(preferred.notion.kind==='database'&&other.notion.kind==='database'){const ps=preferred.notion.schema||={},os=other.notion.schema||{};for(const [k,v] of Object.entries(os))if(preferred.notion.columns?.includes(k)&&v?.type&&v.type!=='text')ps[k]={...v,options:ps[k]?.options||v.options};const byTitle=new Map((other.notion.rows||[]).map(r=>[String(r[other.notion.columns?.[0]]||''),r.__url]));for(const r of preferred.notion.rows||[]){const u=byTitle.get(String(r[preferred.notion.columns[0]]||''));if(u&&!r.__url)r.__url=u}try{delete preferred.notion.views;dbEnsure(preferred.notion)}catch{}}
 const imageKey=url=>{try{return decodeURIComponent(url).split('/').pop()}catch{return url}};
 const known=new Set([...preferred.body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m=>imageKey(m[1])));
 for(const image of other.body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)){if(!known.has(imageKey(image[1]))){preferred.body+='\n\n'+image[0];known.add(imageKey(image[1]))}}
 preferred.notion.properties={...other.notion.properties,...preferred.notion.properties};if(!preferred.icon&&other.icon)preferred.icon=other.icon;if(!preferred.cover&&other.cover)preferred.cover=other.cover;
 {const alts=[...(preferred.notion.alternateSources||[]),...(other.notion.alternateSources||[]),{source:other.notion.source,root:other.notion.root}];const seenAlt=new Set();preferred.notion.alternateSources=alts.filter(x=>{const k=x.root+'|'+x.source;if(seenAlt.has(k)||(x.source===preferred.notion.source&&x.root===preferred.notion.root))return false;seenAlt.add(k);return true})}
 existing.note=preferred;existing.path=preferred.notion.source;
 }
 return merged;
}
let notionImportRunning=false;
async function importNotionWorkspace(payload){
 if(notionImportRunning)throw Error('Un import est déjà en cours');
 if(!Array.isArray(payload?.pages)||!payload.pages.length)throw Error('Export vide');
 notionImportRunning=true;let cancelled=false;
 const overlay=document.createElement('div');overlay.className='import-progress';overlay.innerHTML='<div><h2>Import Notion</h2><p>Préparation des documents…</p><progress></progress><button>Annuler</button></div>';document.body.append(overlay);overlay.querySelector('button').onclick=()=>{cancelled=true};
 try{const prepared=[];for(let i=0;i<payload.pages.length;i++){if(cancelled){if(!payload.multiFile)nativeStore?.discardImport?.(payload.root);toast('Import annulé, aucun projet ajouté');return}prepared.push(convertNotionPage(payload.pages[i],payload.root));if(i%20===0){overlay.querySelector('p').textContent=`${i+1} / ${payload.pages.length} documents`;overlay.querySelector('progress').max=payload.pages.length;overlay.querySelector('progress').value=i+1;await new Promise(resolve=>setTimeout(resolve,0))}}
 const merged=mergeNotionExports(prepared);const project=buildNotionProject({...payload,prepared:merged});project.notionImport={root:payload.root,version:3,documents:merged.length,sources:payload.pages.length,importedAt:new Date().toISOString()};cancelLayout();if(editing)captureEditor();flushEditorSave();saveWorkspace();workspace.projects.push(project);workspace.activeId=project.id;activeProjectId=project.id;currentGalaxyId=null;notes=project.notes;links=project.links;selected=notes[0]?.id;editing=false;filter='all';query='';invalidateNavigation();documentFolder='';sidebarTerm='';restoreCamera();saveWorkspace();renderProjectUI();setDisplayMode('documents');toast(`${merged.length} documents importés${payload.pages.length!==merged.length?' · exports réunis sans doublons':''}`);return project;
 }catch(error){if(!payload.multiFile&&!workspace.projects.some(p=>p.notionImport?.root===payload.root))nativeStore?.discardImport?.(payload.root);throw error}finally{overlay.remove();notionImportRunning=false}
}
function notionColumns(data){data.rows=Array.isArray(data.rows)?data.rows:[];data.columns=Array.isArray(data.columns)?data.columns:[...new Set(data.rows.flatMap(Object.keys))];return data.columns}
function enhanceNotionDetail(n,box){
 if(n.notion){const d=n.notion,columns=notionColumns(d);const section=document.createElement('section');section.className='notion-tools';
 const properties=Object.entries(d.properties||{});section.innerHTML=properties.length?'<details><summary>Propriétés de la page</summary><div class="notion-properties">'+properties.map(([k,v],i)=>`<label>${escapeHtml(k)}<input data-prop="${i}" value="${escapeHtml(v)}"></label>`).join('')+'</div></details>':'';
 section.querySelectorAll('[data-prop]').forEach(el=>el.oninput=()=>{d.properties[properties[Number(el.dataset.prop)][0]]=el.value;n.updatedAt=new Date().toISOString();scheduleEditorSave(n)});
 if(d.kind==='database'){
 if((d.version||0)<2){n.body=databaseMarkdown(d);d.version=2} // Old imports duplicated the CSV as unreadable pipe-delimited prose.
 box.querySelector('.note-body')?.replaceChildren();
 if(editing){const textarea=box.querySelector('#editor-body');textarea.hidden=true;box.querySelector('.preview').hidden=true}
 d.view=d.view==='kanban'?'kanban':'table';d.groupBy=columns.includes(d.groupBy)?d.groupBy:columns.find(k=>/status|statut|état|etat|select|priorit/i.test(k))||columns[1]||columns[0];
 const controls=document.createElement('div');controls.className='notion-tabs';controls.innerHTML=`<button data-view="table" class="${d.view==='table'?'active':''}">Tableau</button><button data-view="kanban" class="${d.view==='kanban'?'active':''}">Kanban</button><label>Regrouper par <select aria-label="Propriété du Kanban">${columns.map(k=>`<option ${k===d.groupBy?'selected':''}>${escapeHtml(k)}</option>`).join('')}</select></label><button data-add>＋ Ligne</button><button data-column>＋ Colonne</button><button data-export>Exporter CSV</button>`;section.append(controls);
 const save=()=>{n.updatedAt=new Date().toISOString();scheduleEditorSave(n)};const refresh=()=>{save();flushEditorSave();renderDetail()};
 controls.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{d.view=b.dataset.view;refresh()});controls.querySelector('select').onchange=e=>{d.groupBy=e.target.value;refresh()};controls.querySelector('[data-add]').onclick=()=>{d.rows.push(Object.fromEntries(columns.map(k=>[k,''])));d.page=Math.floor((d.rows.length-1)/100);refresh()};controls.querySelector('[data-column]').onclick=()=>{const k=prompt('Nom de la nouvelle propriété');if(!k?.trim()||columns.includes(k.trim()))return;columns.push(k.trim());d.rows.forEach(r=>r[k.trim()]='');refresh()};controls.querySelector('[data-export]').onclick=()=>{const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';downloadFile(n.title+'.csv','text/csv;charset=utf-8','\uFEFF'+[columns,...d.rows.map(r=>columns.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n'))};
 const search=document.createElement('input');search.type='search';search.placeholder='Filtrer les lignes…';search.setAttribute('aria-label','Filtrer les lignes');section.append(search);
 const content=document.createElement('div');section.append(content);let term='';
 function paint(){let indexed=d.rows.map((row,index)=>({row,index})).filter(({row})=>columns.some(k=>String(row[k]??'').toLocaleLowerCase().includes(term)));const total=indexed.length;let page=Math.max(0,Math.min(Number(d.page)||0,Math.ceil(total/100)-1));d.page=page;const visible=indexed.slice(page*100,(page+1)*100);
 const cell=(row,index,k)=>`${k===columns[0]&&typeof databaseRowPage==='function'&&databaseRowPage(n,row)?`<button class="row-page" data-open-row="${index}" title="Ouvrir la page">↗ Ouvrir</button>`:''}<textarea rows="1" data-row="${index}" data-key="${columns.indexOf(k)}" aria-label="${escapeHtml(k)} · ligne ${index+1}">${escapeHtml(row[k]??'')}</textarea>`;
 if(d.view==='table')content.innerHTML=`<div class="notion-table-wrap"><table class="notion-table"><thead><tr>${columns.map(k=>`<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${visible.map(({row,index})=>`<tr>${columns.map(k=>`<td>${cell(row,index,k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 else {const groups=[...new Set(indexed.map(({row})=>String(row[d.groupBy]??'')))];if(!groups.length)groups.push('');content.innerHTML='<div class="notion-kanban">'+groups.map((group,g)=>`<section data-group="${g}"><h4>${escapeHtml(group||'Sans valeur')} <small>${indexed.filter(x=>String(x.row[d.groupBy]??'')===group).length}</small></h4>${visible.filter(x=>String(x.row[d.groupBy]??'')===group).map(({row,index})=>`<article draggable="true" data-card="${index}"><b>${escapeHtml(row[columns[0]]||'Sans titre')}</b>${columns.slice(0,3).map(k=>`<label>${escapeHtml(k)}${cell(row,index,k)}</label>`).join('')}<details><summary>Autres propriétés</summary>${columns.slice(3).map(k=>`<label>${escapeHtml(k)}${cell(row,index,k)}</label>`).join('')}</details></article>`).join('')}</section>`).join('')+'</div>';content.querySelectorAll('[data-card]').forEach(card=>card.ondragstart=e=>e.dataTransfer.setData('text/plain',card.dataset.card));content.querySelectorAll('[data-group]').forEach(lane=>{lane.ondragover=e=>e.preventDefault();lane.ondrop=e=>{e.preventDefault();const raw=e.dataTransfer.getData('text/plain');if(!/^\d+$/.test(raw)||!d.rows[Number(raw)]||!d.groupBy)return;d.rows[Number(raw)][d.groupBy]=groups[Number(lane.dataset.group)];save();paint()}})}
 const footer=document.createElement('div');footer.className='notion-tabs';footer.innerHTML=`<button data-prev ${page===0?'disabled':''}>←</button><span>${total? page*100+1:0}–${Math.min(total,(page+1)*100)} / ${total} lignes</span><button data-next ${(page+1)*100>=total?'disabled':''}>→</button>`;content.append(footer);footer.querySelector('[data-prev]').onclick=()=>{d.page=page-1;paint()};footer.querySelector('[data-next]').onclick=()=>{d.page=page+1;paint()};
 content.querySelectorAll('[data-open-row]').forEach(b=>b.onclick=()=>{const page=databaseRowPage(n,d.rows[Number(b.dataset.openRow)]);if(page)openDocument(page.note.id)});
 content.querySelectorAll('[data-row]').forEach(el=>{el.oninput=()=>{d.rows[Number(el.dataset.row)][columns[Number(el.dataset.key)]]=el.value;save()};el.onchange=()=>{if(d.view==='kanban')paint()}});
 }
 search.oninput=()=>{term=search.value.toLocaleLowerCase();d.page=0;paint()};paint();
 }
 if(section.childNodes.length){const anchor=box.querySelector('.note-meta')||box.querySelector('.edit-fields');if(anchor)anchor.after(section);else box.append(section)}
 }
 box.querySelectorAll('a[data-notion-url]').forEach(a=>a.onclick=e=>{const url=a.dataset.notionUrl;const all=activeProject().notes.flatMap(g=>[{note:g,galaxy:null},...(g.starMap?.notes||[]).map(note=>({note,galaxy:g.id}))]);const match=all.find(({note})=>note.notion&&notionUrl(note.notion.source,'',note.notion.root)===url.split('#')[0]);if(match){e.preventDefault();if(currentGalaxyId)leaveGalaxy();if(match.galaxy)openGalaxy(match.galaxy);select(match.note.id)}});
 const editor=box.querySelector('#editor-body');if(editor&&!editor.hidden){const toolbar=document.createElement('div');toolbar.className='editor-toolbar';[['Titre','## ',''],['Gras','**','**'],['Italique','*','*'],['Liste','- ',''],['Tâche','- [ ] ',''],['Citation','> ',''],['Code','\n```\n','\n```\n']].forEach(([label,start,end])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onmousedown=e=>e.preventDefault();b.onclick=()=>{const a=editor.selectionStart,z=editor.selectionEnd;editor.setRangeText(start+editor.value.slice(a,z)+end,a,z,'select');editor.focus();captureEditor()};toolbar.append(b)});editor.before(toolbar);const preview=box.querySelector('.preview');preview.open=true;editor.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');captureEditor()}}}
}
let cosmosMarkdown;
function markdownEngine(){
 if(cosmosMarkdown)return cosmosMarkdown;
 const md=window.markdownit({html:false,linkify:true,breaks:false});
 const validate=md.validateLink;md.validateLink=url=>/^file:\/\//i.test(url)||validate(url);
 md.inline.ruler.before('link','cosmos_wiki',(state,silent)=>{const match=state.src.slice(state.pos).match(/^\[\[([^\]]+)\]\]/);if(!match)return false;if(!silent){const token=state.push('cosmos_wiki','',0);token.content=match[1]}state.pos+=match[0].length;return true});
 md.renderer.rules.cosmos_wiki=(tokens,i,options,env)=>{const title=tokens[i].content;const target=notes.find(n=>n.title.trim().toLocaleLowerCase()===title.trim().toLocaleLowerCase());return env.interactive?`<a href="#" ${target?`data-linked="${escapeHtml(target.id)}"`:`data-create-wiki="${escapeHtml(title)}"`}>${escapeHtml(title)}</a>`:`<span>${escapeHtml(title)}</span>`};
 md.core.ruler.after('inline','cosmos_tasks',state=>{const sourceLines=state.src.split('\n');for(const token of state.tokens){if(token.type!=='inline'||!token.map)continue;const match=token.content.match(/^\[([ xX])\] /);if(!match||!/^\s*[-*+] \[/.test(sourceLines[token.map[0]]||''))continue;const first=token.children[0];if(first?.type!=='text')continue;first.content=first.content.slice(4);const checkbox=new state.Token('html_inline','',0);checkbox.content=`<input type="checkbox" ${state.env.interactive?`data-task-line="${token.map[0]}"`:'disabled'} ${match[1]!==' '?'checked':''}> `;token.children.unshift(checkbox)}});
 const imageRule=md.renderer.rules.image;md.renderer.rules.image=(tokens,i,options,env,self)=>{tokens[i].attrSet('class','note-image');tokens[i].attrSet('loading','lazy');tokens[i].attrSet('decoding','async');return imageRule(tokens,i,options,env,self)};
 md.renderer.rules.link_open=(tokens,i,options,env,self)=>{tokens[i].attrSet('data-notion-url',tokens[i].attrGet('href'));tokens[i].attrSet('rel','noopener noreferrer');return self.renderToken(tokens,i,options)};
 md.renderer.rules.table_open=()=>'<div class="notion-table-wrap"><table class="notion-table">';md.renderer.rules.table_close=()=>'</table></div>';
 cosmosMarkdown=md;return md;
}
function renderMarkdown(source,interactive=true){return markdownEngine().render(String(source||''),{interactive})||'<p class="notion-muted">Cette note est vide.</p>'}
