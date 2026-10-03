export const projectExecution = `<section id="work-logs"><h2>Work logs</h2>
  <p id="work-log-execution-help"></p>
  <form id="create-work-log" hidden><h3>Log work</h3>
    <label>Task ID (optional)<input name="taskId" maxlength="120"></label>
    <label>Minutes<input name="minutes" type="number" min="1" max="1440" required></label>
    <label><input name="billable" type="checkbox" checked> Billable</label>
    <label>Note<textarea name="note" maxlength="1000" rows="3"></textarea></label>
    <button>Log work</button>
  </form>
  <p id="work-log-execution-status" role="status" aria-live="polite"></p>
  <div id="records-work-logs" aria-live="polite">Loading…</div>
</section>
<section id="notes"><h2>Notes</h2>
  <p id="note-execution-help"></p>
  <form id="create-note" hidden><h3>Add note</h3>
    <label>Visibility<select name="visibility"><option selected>internal</option><option>client</option></select></label>
    <label>Note<textarea name="body" maxlength="2000" rows="4" required></textarea></label>
    <button>Add note</button>
  </form>
  <p id="note-execution-status" role="status" aria-live="polite"></p>
  <div id="records-notes" aria-live="polite">Loading…</div>
</section>
<section id="documents"><h2>Documents</h2>
  <p id="document-execution-help"></p>
  <form id="create-document" hidden><h3>Add document link</h3>
    <label>Title<input name="title" maxlength="160" required></label>
    <label>Type<select name="documentType"><option>proposal</option><option>contract</option><option>asset</option><option>handoff</option><option selected>other</option></select></label>
    <label>HTTP(S) URL<input name="url" type="url" maxlength="2048" required></label>
    <label>Deliverable ID (optional)<input name="deliverableId" maxlength="120"></label>
    <button>Add document link</button>
  </form>
  <p id="document-execution-status" role="status" aria-live="polite"></p>
  <div id="records-documents" aria-live="polite">Loading…</div>
</section>
<section id="issues"><h2>Issues</h2>
  <p id="issue-execution-help"></p>
  <form id="create-issue" hidden><h3>Add issue</h3>
    <label>Title<input name="title" maxlength="160" required></label>
    <label>Description<textarea name="description" maxlength="2000" rows="4" required></textarea></label>
    <label>Severity<select name="severity"><option>low</option><option selected>medium</option><option>high</option></select></label>
    <label>Owner<input name="owner" maxlength="120"></label>
    <button>Add issue</button>
  </form>
  <p id="issue-execution-status" role="status" aria-live="polite"></p>
  <div id="records-issues" aria-live="polite">Loading…</div>
</section>
<section id="risks"><h2>Risks</h2>
  <p id="risk-execution-help"></p>
  <form id="create-risk" hidden><h3>Add risk</h3>
    <label>Title<input name="title" maxlength="160" required></label>
    <label>Description<textarea name="description" maxlength="2000" rows="4" required></textarea></label>
    <label>Probability<select name="probability"><option>low</option><option selected>medium</option><option>high</option></select></label>
    <label>Impact<select name="impact"><option>low</option><option selected>medium</option><option>high</option></select></label>
    <label>Mitigation plan<textarea name="mitigationPlan" maxlength="1000" rows="3"></textarea></label>
    <label>Owner<input name="owner" maxlength="120"></label>
    <button>Add risk</button>
  </form>
  <p id="risk-execution-status" role="status" aria-live="polite"></p>
  <div id="records-risks" aria-live="polite">Loading…</div>
</section>`;

export const projectExecutionScript = `const executionSections={
  'work-logs':{singular:'work log',fields:['actor','minutes','billable','taskId','note','loggedAtIso']},
  notes:{singular:'note',fields:['author','visibility','body','status','createdAtIso','archivedBy','archivedAtIso']},
  documents:{singular:'document',fields:['title','documentType','url','deliverableId','status','uploadedBy','uploadedAtIso','archivedBy','archivedAtIso']},
  issues:{singular:'issue',fields:['title','description','severity','owner','status','openedAtIso','resolutionNote','resolvedAtIso']},
  risks:{singular:'risk',fields:['title','description','probability','impact','owner','mitigationPlan','status','identifiedAtIso','mitigationNote','mitigatedAtIso']}
};
const executionRows={'work-logs':[],notes:[],documents:[],issues:[],risks:[]};
const executionForms={'work-logs':document.getElementById('create-work-log'),notes:document.getElementById('create-note'),documents:document.getElementById('create-document'),issues:document.getElementById('create-issue'),risks:document.getElementById('create-risk')};
function executionOptional(value){const text=String(value||'').trim();return text||undefined;}
function executionCanCreate(kind){if(!project)return false;if(kind==='work-logs')return ['estimated','approved','in_progress','delivered'].includes(project.status);if(kind==='notes')return !['cancelled','archived'].includes(project.status);return ['estimated','approved','in_progress','on_hold','delivered'].includes(project.status);}
function executionCanAct(){return Boolean(project&&!['cancelled','archived'].includes(project.status));}
function executionStatusId(kind){return (kind==='work-logs'?'work-log':executionSections[kind].singular)+'-execution-status';}
function executionMessage(kind,text){document.getElementById(executionStatusId(kind)).textContent=text;}
function executionFailure(kind,error){executionMessage(kind,error.message);if(error.status===409)reload.hidden=false;}
function executionActionForm(kind,row){if(!executionCanAct())return null;const action=kind==='issues'?'resolve':kind==='risks'?'mitigate':'archive';const form=document.createElement('form');form.className='execution-action';if(kind==='issues'||kind==='risks'){const label=document.createElement('label');label.textContent=kind==='issues'?'Resolution note (optional)':'Mitigation note (optional)';const note=document.createElement('textarea');note.name='actionNote';note.maxLength=500;note.rows=2;label.append(note);form.append(label);}const button=document.createElement('button');button.textContent=action[0].toUpperCase()+action.slice(1)+' '+executionSections[kind].singular;form.append(button);form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;executionMessage(kind,'');try{const data=Object.fromEntries(new FormData(form));const body=kind==='issues'?{resolutionNote:executionOptional(data.actionNote)}:kind==='risks'?{mitigationNote:executionOptional(data.actionNote)}:{archivedBy:operatorLogin};await api('project-requests/'+id+'/'+kind+'/'+encodeURIComponent(row.id)+'/'+action,{method:'POST',body:JSON.stringify(body)});executionMessage(kind,action==='resolve'?'Issue resolved.':action==='mitigate'?'Risk mitigated.':kind==='notes'?'Note archived.':'Document archived.');await loadExecutionSection(kind);}catch(error){executionFailure(kind,error);}finally{button.disabled=false;}});return form;}
function renderExecutionSection(kind){const container=document.getElementById('records-'+kind);container.replaceChildren();const rows=executionRows[kind];if(!rows.length){const empty=document.createElement('p');empty.textContent='No '+(kind==='work-logs'?'work logs':kind)+' recorded.';container.append(empty);return;}for(const row of rows){const article=recordCard(row,executionSections[kind]);article.className='execution-record';article.dataset.recordId=row.id;const actionable=(kind==='issues'&&row.status==='open')||(kind==='risks'&&row.status==='open')||((kind==='notes'||kind==='documents')&&row.status==='active');if(actionable){const action=executionActionForm(kind,row);if(action)article.append(action);}container.append(article);}}
function renderExecutionAccess(){if(!project)return;for(const kind of Object.keys(executionSections)){const allowed=executionCanCreate(kind);executionForms[kind].hidden=!allowed;const help=document.getElementById((kind==='work-logs'?'work-log':executionSections[kind].singular)+'-execution-help');help.textContent=allowed?'Add and manage '+(kind==='work-logs'?'work logs':kind)+'.':kind==='work-logs'&&project.status==='on_hold'?'Work logging is paused while the project is on hold.':(executionCanAct()?'New '+executionSections[kind].singular+' records are unavailable in this project state.':executionSections[kind].singular[0].toUpperCase()+executionSections[kind].singular.slice(1)+' records are read-only in this project state.');renderExecutionSection(kind);}}
async function loadExecutionSection(kind){const container=document.getElementById('records-'+kind);container.replaceChildren();const loading=document.createElement('p');loading.textContent='Loading…';container.append(loading);try{executionRows[kind]=await api('project-requests/'+id+'/'+kind);renderExecutionSection(kind);}catch(error){container.replaceChildren();const text=document.createElement('p');text.textContent='Could not load '+(kind==='work-logs'?'work logs':kind)+'. '+error.message;const retry=document.createElement('button');retry.textContent='Retry '+(kind==='work-logs'?'work logs':kind);retry.addEventListener('click',()=>loadExecutionSection(kind));container.append(text,retry);}}
async function loadExecution(){await Promise.all(Object.keys(executionSections).map(loadExecutionSection));}
function bindExecutionCreate(kind,bodyFromData,success){const form=executionForms[kind];form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;executionMessage(kind,'');try{const data=Object.fromEntries(new FormData(form));await api('project-requests/'+id+'/'+kind,{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),...bodyFromData(data,form)})});form.reset();if(kind==='work-logs')form.elements.namedItem('billable').checked=true;if(kind==='notes')form.elements.namedItem('visibility').value='internal';if(kind==='documents')form.elements.namedItem('documentType').value='other';if(kind==='issues')form.elements.namedItem('severity').value='medium';if(kind==='risks'){form.elements.namedItem('probability').value='medium';form.elements.namedItem('impact').value='medium';}executionMessage(kind,success);await loadExecutionSection(kind);}catch(error){executionFailure(kind,error);}finally{button.disabled=false;}});}
bindExecutionCreate('work-logs',(data,form)=>({taskId:executionOptional(data.taskId),actor:operatorLogin,minutes:Number(data.minutes),billable:form.elements.namedItem('billable').checked,note:executionOptional(data.note)}),'Work logged.');
bindExecutionCreate('notes',data=>({author:operatorLogin,visibility:data.visibility,body:data.body}),'Note added.');
bindExecutionCreate('documents',data=>({deliverableId:executionOptional(data.deliverableId),title:data.title,documentType:data.documentType,url:data.url,uploadedBy:operatorLogin}),'Document link added.');
bindExecutionCreate('issues',data=>({title:data.title,description:data.description,severity:data.severity,owner:executionOptional(data.owner)}),'Issue added.');
bindExecutionCreate('risks',data=>({title:data.title,description:data.description,probability:data.probability,impact:data.impact,mitigationPlan:executionOptional(data.mitigationPlan),owner:executionOptional(data.owner)}),'Risk added.');
`;
