import { projectHistoryLabels } from '../../../../packages/projectops/src/history.ts';

export const projectHistory = `<section id="activities"><h2>History</h2>
  <p id="history-help"></p>
  <form id="create-annotation" hidden><h3>Operator annotation</h3>
    <label>Annotation summary<textarea name="summary" required maxlength="500" rows="3"></textarea></label>
    <button>Add annotation</button>
  </form>
  <p id="annotation-status" role="status" aria-live="polite"></p>
  <div id="records-activities" aria-live="polite">Loading…</div>
</section>`;

export const projectHistoryScript = `const historyLabels=${JSON.stringify(projectHistoryLabels)};
let historyGeneration=0;
const annotationForm=document.getElementById('create-annotation');
function renderHistoryAccess(){const terminal=['cancelled','archived'].includes(project.status);annotationForm.hidden=terminal;document.getElementById('history-help').textContent=terminal?'History is retained. This project is read-only.':'Successful project actions are recorded automatically. Add an operator annotation for additional context.';}
async function loadHistory(){const generation=++historyGeneration;const container=document.getElementById('records-activities');container.replaceChildren();const loading=document.createElement('p');loading.textContent='Loading history…';container.append(loading);try{const rows=await api('project-requests/'+id+'/activities');if(generation!==historyGeneration)return;container.replaceChildren();if(!rows.length){const empty=document.createElement('p');empty.textContent='No history recorded.';container.append(empty);}for(const row of rows){const article=document.createElement('article');article.dataset.eventType=row.eventType;article.dataset.activityId=row.id;const heading=document.createElement('h3');heading.textContent=historyLabels[row.eventType]||String(row.eventType).replaceAll('_',' ');const summary=document.createElement('p');summary.textContent=row.summary;const metadata=document.createElement('p');metadata.className='history-metadata';metadata.textContent=(row.actor||'Actor not recorded')+' · '+formatDate(row.happenedAtIso);article.append(heading,summary,metadata);container.append(article);}}catch(error){if(generation!==historyGeneration)return;container.replaceChildren();const text=document.createElement('p');text.textContent='History unavailable. '+error.message;const retry=document.createElement('button');retry.textContent='Retry history';retry.addEventListener('click',()=>loadHistory());container.append(text,retry);}}
annotationForm.addEventListener('submit',async event=>{event.preventDefault();const button=annotationForm.querySelector('button'),status=document.getElementById('annotation-status');button.disabled=true;status.textContent='';try{await api('project-requests/'+id+'/activities',{method:'POST',body:JSON.stringify({summary:annotationForm.elements.namedItem('summary').value})});annotationForm.reset();status.textContent='Annotation added.';}catch(error){status.textContent=error.message;if(error.status===409)reload.hidden=false;}finally{button.disabled=false;}});
`;
