import { randomBytes } from 'node:crypto';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';
import { projectFields, projectInputScript } from './project-fields.ts';

const fields = `<label>Client name<input name="name" required maxlength="120"></label>
  <label>Contact name<input name="contactName" maxlength="120"></label>
  <label>Email<input name="email" type="email" maxlength="254"></label>`;
const directory = `<h1>Clients</h1><section><h2>Find clients</h2><form id="search" class="filters">
  <label>Search<input name="q" maxlength="120" placeholder="Name, contact or email"></label>
  <label for="client-status">Status</label><select name="status" id="client-status"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All clients</option></select><button>Search</button>
  </form><p id="count" role="status"></p><div class="table-scroll"><table><caption>Client directory</caption><thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Status</th></tr></thead><tbody id="clients"></tbody></table></div><p id="empty" hidden>No clients found. Create a client or change the search.</p></section>
  <section><h2>Create client</h2><form id="create">${fields}<button disabled>Create client</button></form></section>`;
const detail = `<p><a href="/projectops/client-management">Back to clients</a></p><h1 id="client-title">Client</h1><p id="client-status" role="status">Loading client…</p>
  <section id="client-record" hidden><h2>Contact details</h2><dl><dt>Contact</dt><dd id="contact"></dd><dt>Email</dt><dd id="email"></dd></dl>
  <form id="edit">${fields}<button disabled>Save changes</button></form><button id="archive" disabled>Archive client</button>
  <div id="confirmation" hidden><p>Archive this client? Existing projects remain available. New projects will be blocked.</p><button id="confirm-archive">Confirm archive</button> <button id="cancel-archive" class="secondary">Cancel</button></div>
  <p id="archived" hidden>This client is archived. Contact details and existing projects remain viewable.</p>
  <h2>Projects</h2><div class="table-scroll"><table><caption>Projects for this client</caption><thead><tr><th>Project</th><th>Status</th><th>Priority</th></tr></thead><tbody id="projects"></tbody></table></div><p id="no-projects" hidden>No projects for this client.</p></section>
  <button id="reload" class="secondary" hidden>Reload client</button>
  <section id="new-project" hidden><h2>Create project</h2><form id="create-project">${projectFields}<button disabled>Create project</button></form></section>`;

const commonScript = `const message=document.getElementById('message');let csrf='';
async function api(path,options={}) {
  const response=await fetch('/projectops/'+path,{...options,headers:{'content-type':'application/json','x-csrf-token':csrf,...options.headers}});
  const data=await response.json();
  if(!response.ok){if(response.status===401)location.assign('/projectops/login');const error=Error(data.message||'Request failed.');error.status=response.status;throw error;}
  return data;
}
function report(error){message.textContent=error.message;}
function clientInput(form){const data=Object.fromEntries(new FormData(form));return {name:data.name,contactName:data.contactName.trim()||undefined,email:data.email.trim()||undefined};}
function cell(row,value){const td=document.createElement('td');td.textContent=value??'—';row.append(td);return td;}
async function session(){const data=await api('access/session');csrf=data.csrfToken;const priority=document.querySelector('#create-project [name="priority"]');if(priority)priority.value=data.defaults.defaultPriority;}
`;
const directoryScript = `let searchVersion=0;const newClientId=crypto.randomUUID();
async function search(){const version=++searchVersion;const query=new URLSearchParams(new FormData(document.getElementById('search')));document.getElementById('count').textContent='Loading clients…';try{const clients=await api('clients?'+query);if(version!==searchVersion)return;const body=document.getElementById('clients');body.replaceChildren();for(const client of clients){const row=document.createElement('tr');const link=document.createElement('a');link.href='/projectops/client-management/'+encodeURIComponent(client.id);link.textContent=client.name;cell(row,'').append(link);cell(row,client.contactName);cell(row,client.email);cell(row,client.status);body.append(row);}document.getElementById('count').textContent=clients.length+' clients';document.getElementById('empty').hidden=clients.length!==0;}catch(error){if(version===searchVersion){document.getElementById('count').textContent='Could not load clients.';report(error);}}}
document.getElementById('search').addEventListener('submit',event=>{event.preventDefault();message.textContent='';search();});
const form=document.getElementById('create');form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;message.textContent='';try{const client=await api('clients',{method:'POST',body:JSON.stringify({id:newClientId,...clientInput(form)})});location.assign('/projectops/client-management/'+encodeURIComponent(client.id));}catch(error){report(error);button.disabled=false;}});
session().then(()=>{form.querySelector('button').disabled=false;search();}).catch(report);
`;
const detailScript = `const id=encodeURIComponent(decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)));let client;
${projectInputScript}
const createProject=document.getElementById('create-project');const newProjectId=crypto.randomUUID();
createProject.addEventListener('submit',async event=>{event.preventDefault();const button=createProject.querySelector('button');button.disabled=true;message.textContent='';try{const project=await api('project-requests',{method:'POST',body:JSON.stringify({id:newProjectId,clientId:client.id,...projectInput(createProject)})});location.assign('/projectops/projects/'+encodeURIComponent(project.id));}catch(error){report(error);button.disabled=false;}});
const form=document.getElementById('edit');const archive=document.getElementById('archive');const confirmation=document.getElementById('confirmation');const reload=document.getElementById('reload');
function showClient(value){client=value;document.getElementById('client-title').textContent=client.name;document.getElementById('client-status').textContent=client.status==='archived'?'Archived client':'Active client';document.getElementById('contact').textContent=client.contactName||'—';document.getElementById('email').textContent=client.email||'—';for(const name of ['name','contactName','email'])form.elements.namedItem(name).value=client[name]||'';const archived=client.status==='archived';form.hidden=archived;archive.hidden=archived;archive.disabled=archived;form.querySelector('button').disabled=archived;document.getElementById('archived').hidden=!archived;document.getElementById('client-record').hidden=false;document.getElementById('new-project').hidden=archived;createProject.querySelector('button').disabled=archived;confirmation.hidden=true;reload.hidden=true;}
async function load(){const [value,projects]=await Promise.all([api('clients/'+id),api('clients/'+id+'/projects')]);showClient(value);const body=document.getElementById('projects');body.replaceChildren();for(const project of projects){const row=document.createElement('tr');const link=document.createElement('a');link.href='/projectops/projects/'+encodeURIComponent(project.id);link.textContent=project.title;cell(row,'').append(link);cell(row,project.status.replaceAll('_',' '));cell(row,project.priority);body.append(row);}document.getElementById('no-projects').hidden=projects.length!==0;}
function failure(error){report(error);if(error.status===409)reload.hidden=false;}
form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;message.textContent='';try{showClient(await api('clients/'+id,{method:'PUT',body:JSON.stringify({...clientInput(form),expectedRevision:client.revision})}));message.textContent='Client saved.';}catch(error){failure(error);}finally{button.disabled=client?.status==='archived';}});
archive.addEventListener('click',()=>{confirmation.hidden=false;document.getElementById('confirm-archive').focus();});
document.getElementById('cancel-archive').addEventListener('click',()=>{confirmation.hidden=true;archive.focus();});
document.getElementById('confirm-archive').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;message.textContent='';try{showClient(await api('clients/'+id+'/archive',{method:'POST',body:JSON.stringify({expectedRevision:client.revision})}));message.textContent='Client archived.';}catch(error){failure(error);}finally{button.disabled=false;}});
reload.addEventListener('click',()=>{message.textContent='';load().catch(failure);});
session().then(load).catch(error=>{document.getElementById('client-status').textContent=error.status===404?'Client not found.':'Could not load client.';report(error);reload.hidden=false;});
`;

export function renderClientPage(kind: 'directory' | 'detail'): DirectHttpResponse {
  const nonce = randomBytes(24).toString('base64');
  return { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  }, body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clients · ProjectOps</title><style nonce="${nonce}">
  *{box-sizing:border-box}body{font:16px system-ui;background:#f4f6fa;color:#172238;margin:0}main{max-width:1000px;margin:32px auto;padding:24px}nav{display:flex;gap:24px;flex-wrap:wrap}section{margin:24px 0;padding:24px;background:white;border-radius:12px}form{display:grid;gap:14px;max-width:520px;margin:20px 0}label{display:grid;gap:6px}input,textarea,select,button{font:inherit;padding:10px;border:1px solid #aeb9cb;border-radius:6px}button{background:#254bc5;color:white;cursor:pointer}button:disabled{opacity:.6}.secondary{background:white;color:#254bc5}a{color:#254bc5}table{border-collapse:collapse;width:100%;text-align:left}caption{text-align:left;margin-bottom:12px;font-weight:600}th,td{padding:12px;border-bottom:1px solid #dce2ec;overflow-wrap:anywhere}.table-scroll{overflow:auto}#message{min-height:24px}dd{margin:0 0 12px}dt{font-weight:600}[hidden]{display:none!important}@media(max-width:600px){main{margin:0;padding:16px}section{padding:16px}}
  </style></head><body><main><nav><a href="/projectops">Dashboard</a><a href="/projectops/client-management">Clients</a><a href="/projectops/settings">Operator settings</a></nav>${kind === 'directory' ? directory : detail}<p id="message" role="status" aria-live="polite"></p></main><script nonce="${nonce}">${commonScript}${kind === 'directory' ? directoryScript : detailScript}</script></body></html>` };
}
