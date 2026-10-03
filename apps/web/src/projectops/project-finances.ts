export const projectFinances = `<section id="finance-totals"><h2>Finance totals by currency</h2><p>Each currency is reported separately. No currency conversion or combined total.</p><div id="finance-totals-status" role="status" aria-live="polite">Loading totals…</div></section>
<section id="invoices"><h2>Invoices</h2><p id="invoice-finance-help"></p>
<form id="create-invoice" hidden><h3>Issue invoice</h3>
<label>Invoice number<input name="invoiceNumber" maxlength="80" required></label>
<label>Amount (integer cents)<input name="amountCents" type="number" min="1" max="1000000000" step="1" required></label>
<label>Currency<input name="currency" maxlength="3" required></label>
<label>Accepted deliverable (optional)<select name="deliverableId"><option value="">No deliverable</option></select></label>
<label>Due date/time (UTC, optional)<input name="dueAtIso" type="datetime-local" step="1"></label>
<button>Issue invoice</button></form>
<p id="invoice-finance-status" role="status" aria-live="polite"></p><div id="records-invoices">Loading…</div></section>
<section id="expenses"><h2>Expenses</h2><p id="expense-finance-help"></p>
<form id="create-expense" hidden><h3>Submit expense</h3>
<label>Category<select name="category" aria-label="Category"><option>software</option><option>asset</option><option>service</option><option>travel</option><option selected>other</option></select></label>
<label>Description<textarea name="description" maxlength="500" required></textarea></label>
<label>Vendor (optional)<input name="vendor" maxlength="120"></label>
<label>Amount (integer cents)<input name="amountCents" type="number" min="1" max="1000000000" step="1" required></label>
<label>Currency<input name="currency" maxlength="3" required></label>
<label>Reimbursable<input name="reimbursable" type="checkbox" checked></label>
<label>HTTP(S) receipt URL (optional)<input name="receiptUrl" type="url" maxlength="2048"></label>
<label>Incurred date/time (UTC, optional; defaults to now)<input name="incurredAtIso" type="datetime-local" step="1"></label>
<button>Submit expense</button></form>
<p id="expense-finance-status" role="status" aria-live="polite"></p><div id="records-expenses">Loading…</div></section>`;

export const projectFinancesScript = `
const financeSections={invoices:{fields:['invoiceNumber','deliverableId','amountCents','currency','status','issuedAtIso','dueAtIso','paidAtIso']},expenses:{fields:['category','description','vendor','amountCents','currency','reimbursable','receiptUrl','incurredAtIso','status','decidedBy','decidedAtIso','decisionNote']}};
const financeRows={invoices:[],expenses:[]},financeLoaded={invoices:false,expenses:false};
const financeForms={invoices:document.getElementById('create-invoice'),expenses:document.getElementById('create-expense')};
function financeCan(kind,action){if(!project)return false;const states=action!=='create'?['new','estimated','approved','in_progress','on_hold','delivered']:kind==='invoices'?['approved','in_progress','delivered']:['estimated','approved','in_progress','on_hold','delivered'];return states.includes(project.status);}
function financeMessage(kind,text){document.getElementById((kind==='invoices'?'invoice':'expense')+'-finance-status').textContent=text;}
function financeFailure(kind,error){financeMessage(kind,error.message);if(error.status===409)reload.hidden=false;}
function renderFinanceTotals(){
  const container=document.getElementById('finance-totals-status');container.replaceChildren();
  for(const kind of ['invoices','expenses']){
    const categories=kind==='invoices'?[['issued','Outstanding invoices'],['paid','Paid invoices']]:[['submitted','Submitted expenses'],['approved','Approved expenses']];
    for(const [state,title] of categories){const p=document.createElement('p');p.dataset.total=state+'-'+kind;
      if(!financeLoaded[kind])p.textContent=title+': unavailable until '+kind+' load. Retry the failed section.';
      else{const totals={};for(const row of financeRows[kind])if(row.status===state)totals[row.currency]=(totals[row.currency]||0n)+BigInt(row.amountCents);
        p.textContent=title+': '+(Object.keys(totals).sort().map(currency=>money(totals[currency].toString(),currency)).join('; ')||'No recorded amounts');}
      container.append(p);
    }
  }
}
function renderFinanceSection(kind){
  const container=document.getElementById('records-'+kind);container.replaceChildren();
  if(!financeRows[kind].length){const empty=document.createElement('p');empty.textContent='No '+kind+' recorded.';container.append(empty);}
  for(const row of financeRows[kind]){const article=recordCard(row,financeSections[kind]);article.className='finance-record';article.dataset.recordId=row.id;
    if(financeCan(kind,'action')&&row.status===(kind==='invoices'?'issued':'submitted')){
      const form=document.createElement('form');form.className='finance-action';
      if(kind==='expenses'){const label=document.createElement('label');label.textContent='Decision note (optional)';const note=document.createElement('textarea');note.name='decisionNote';note.maxLength=500;label.append(note);form.append(label);}
      for(const action of kind==='invoices'?['pay']:['approve','reject']){const button=document.createElement('button');button.name='action';button.value=action;button.textContent=action==='pay'?'Record payment':action==='approve'?'Approve expense':'Reject expense';form.append(button);}
      form.addEventListener('submit',async event=>{event.preventDefault();const action=event.submitter.value,buttons=form.querySelectorAll('button');buttons.forEach(button=>button.disabled=true);financeMessage(kind,'');try{
        const data=Object.fromEntries(new FormData(form));await api('project-requests/'+id+'/'+kind+'/'+encodeURIComponent(row.id)+'/'+action,{method:'POST',body:JSON.stringify(kind==='expenses'?{decisionNote:String(data.decisionNote||'').trim()||undefined}:{})});
        financeMessage(kind,action==='pay'?'Invoice paid.':action==='approve'?'Expense approved.':'Expense rejected.');await loadFinanceSection(kind);
      }catch(error){financeFailure(kind,error);}finally{buttons.forEach(button=>button.disabled=false);}});article.append(form);
    }container.append(article);
  }renderFinanceTotals();
}
function renderFinanceAccess(){if(!project)return;for(const kind of Object.keys(financeSections)){const allowed=financeCan(kind,'create');financeForms[kind].hidden=!allowed;
  document.getElementById((kind==='invoices'?'invoice':'expense')+'-finance-help').textContent=allowed?'Create and manage '+kind+'.':financeCan(kind,'action')?'Creation is unavailable in this project state. Existing records can still be acted on.':'Records are read-only in this project state.';
  if(financeLoaded[kind])renderFinanceSection(kind);
}}
async function loadFinanceSection(kind){const container=document.getElementById('records-'+kind);financeLoaded[kind]=false;container.textContent='Loading…';renderFinanceTotals();try{
  financeRows[kind]=await api('project-requests/'+id+'/'+kind);financeLoaded[kind]=true;renderFinanceSection(kind);
}catch(error){container.replaceChildren();const text=document.createElement('p');text.textContent='Could not load '+kind+'. '+error.message;const retry=document.createElement('button');retry.textContent='Retry '+kind;retry.addEventListener('click',()=>loadFinanceSection(kind));container.append(text,retry);renderFinanceTotals();}}
async function loadFinanceDeliverables(){const select=financeForms.invoices.elements.namedItem('deliverableId');try{
  deliveryOptions(select,(await api('project-requests/'+id+'/deliverables')).filter(row=>row.status==='accepted'),'No deliverable');document.getElementById('retry-finance-deliverables')?.remove();
}catch(error){select.options[0].textContent='Deliverables unavailable — retry to select';if(!document.getElementById('retry-finance-deliverables')){const retry=document.createElement('button');retry.id='retry-finance-deliverables';retry.type='button';retry.textContent='Retry accepted deliverable choices';retry.addEventListener('click',loadFinanceDeliverables);select.parentElement.append(retry);}}}
async function loadFinances(){for(const form of Object.values(financeForms))if(!form.elements.namedItem('currency').value)form.elements.namedItem('currency').value=estimateCurrency;await Promise.all([loadFinanceSection('invoices'),loadFinanceSection('expenses'),loadFinanceDeliverables()]);}
for(const kind of Object.keys(financeForms)){const form=financeForms[kind];form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;financeMessage(kind,'');try{
  const data=Object.fromEntries(new FormData(form)),body={id:crypto.randomUUID(),amountCents:Number(data.amountCents),currency:data.currency};
  if(kind==='invoices')Object.assign(body,{invoiceNumber:data.invoiceNumber,deliverableId:data.deliverableId||undefined,dueAtIso:data.dueAtIso?new Date(data.dueAtIso+'Z').toISOString():undefined});
  else Object.assign(body,{category:data.category,description:data.description,vendor:String(data.vendor||'').trim()||undefined,reimbursable:form.elements.namedItem('reimbursable').checked,receiptUrl:String(data.receiptUrl||'').trim()||undefined,incurredAtIso:data.incurredAtIso?new Date(data.incurredAtIso+'Z').toISOString():undefined});
  await api('project-requests/'+id+'/'+kind,{method:'POST',body:JSON.stringify(body)});form.reset();form.elements.namedItem('currency').value=estimateCurrency;financeMessage(kind,kind==='invoices'?'Invoice issued.':'Expense submitted.');await loadFinanceSection(kind);
}catch(error){financeFailure(kind,error);}finally{button.disabled=false;}});}
`;
