import { randomBytes } from 'node:crypto';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';
import type { ProjectExportArtifact, ExportRecord } from '../../../../packages/projectops/src/project-export.ts';

const escape = (value: unknown) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function safeLink(value: unknown): string {
  try { const url=new URL(String(value)); if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password) return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(value)}</a>`; } catch {}
  return '<span>Link unavailable (unsafe or invalid URL).</span>';
}
export function renderDeliverySummary(artifact: ProjectExportArtifact, timezone: string): DirectHttpResponse {
  const nonce=randomBytes(24).toString('base64'), {project,client,collections}=artifact;
  const date=(value: unknown)=>value == null ? 'Not recorded' : escape(new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(String(value))));
  const list=(rows: readonly ExportRecord[],empty: string,card: (row: ExportRecord)=>string)=>rows.length ? rows.map(card).join('') : `<p>${empty}</p>`;
  const status=String(project.status),draft=!['delivered','archived'].includes(status);
  const deliverables=collections.deliverables.filter(row=>row.status==='accepted');
  const notes=collections.notes.filter(row=>row.visibility==='client'&&row.status==='active');
  const documents=collections.documents.filter(row=>row.documentType==='handoff'&&row.status==='active');
  return {status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`},body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delivery summary · ${escape(project.title)}</title><style nonce="${nonce}">
    body{font:16px system-ui;max-width:1000px;margin:24px auto;padding:24px;color:#172238}nav{display:flex;gap:20px;flex-wrap:wrap}section{margin:24px 0}article{border-top:1px solid #bbb;padding:16px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}a{overflow-wrap:anywhere}button{font:inherit;padding:10px}.draft{font-weight:bold;border:2px solid #967100;padding:12px}@media print{nav,.print-control{display:none}body{margin:0;padding:0;max-width:none}article{break-inside:avoid}a{color:inherit}}@media(max-width:600px){body{margin:0;padding:16px}}
    </style></head><body><nav><a href="/projectops/projects/${encodeURIComponent(String(project.id))}">Return to project</a><a href="/projectops">Dashboard</a></nav><h1>Delivery / handoff summary</h1><h2>${escape(project.title)}</h2>
    ${draft?'<p class="draft">CURRENT / DRAFT handoff summary — this view does not certify project delivery or completion.</p>':''}
    <p>Project ID: ${escape(project.id)}</p><p>Client: ${escape(client.name)}</p><p id="summary-project-status">Current project status: ${escape(status.replaceAll('_',' '))}</p>
    ${status==='archived'?'<p>Archived project. The source of archival is not recorded; no prior delivery state is inferred.</p>':''}
    <p>Generated: ${date(artifact.generatedAtIso)} · Timezone: ${escape(timezone)}</p><button class="print-control" id="print-summary">Print summary</button>
    <section id="summary-deliverables"><h2>Accepted deliverables</h2>${list(deliverables,'No accepted deliverables recorded.',row=>{
      const milestone=collections.milestones.find(m=>m.id===row.milestoneId);
      return `<article><h3>${escape(row.title)}</h3><p>Deliverable ID: ${escape(row.id)}</p><p>${safeLink(row.artifactUrl)}</p><p>Submitted: ${date(row.submittedAtIso)}</p><p>Accepted: ${date(row.acceptedAtIso)}</p>${milestone?`<p>Milestone: ${escape(milestone.title)} (${escape(milestone.id)}) · ${escape(milestone.status)}${milestone.dueAtIso?` · Due: ${date(milestone.dueAtIso)}`:''}</p>`:''}</article>`;
    })}</section>
    <section id="summary-notes"><h2>Client notes</h2>${list(notes,'No active client notes recorded.',row=>`<article><p>${escape(row.body)}</p><p>Note ID: ${escape(row.id)} · Created: ${date(row.createdAtIso)}</p></article>`)}</section>
    <section id="summary-documents"><h2>Handoff documents</h2>${list(documents,'No active handoff documents recorded.',row=>`<article><h3>${escape(row.title)}</h3><p>${safeLink(row.url)}</p><p>Document ID: ${escape(row.id)} · Added: ${date(row.uploadedAtIso)}</p></article>`)}</section>
    <script nonce="${nonce}">document.getElementById('print-summary').addEventListener('click',()=>window.print());</script></body></html>`};
}
export function renderHandoffUnavailable(status: number, message: string, retryPath?: string): DirectHttpResponse {
  return {status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"},body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Delivery summary unavailable</title></head><body><h1>Delivery summary unavailable</h1><p role="status">${escape(message)}</p>${retryPath?`<a href="${escape(retryPath)}">Retry delivery summary</a>`:''}<p><a href="/projectops">Return to dashboard</a></p></body></html>`};
}
