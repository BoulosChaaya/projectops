import { ProjectOpsValidationError } from './domain.ts';
import { totalProjectFinances, type ProjectFinanceTotalsByCurrency } from './finances.ts';

/** The public artifact is allowlisted independently of storage rows and future columns. */
export const exportFields = Object.freeze({
  project: ['id','clientId','title','brief','budgetRange','deadlineIso','estimateAmountCents','estimateCurrency','estimatedAtIso','approvedAtIso','approvedBy','priority','status','createdAtIso','updatedAtIso','revision'],
  client: ['id','name','contactName','email','status','createdAtIso','revision'],
  milestones: ['id','projectRequestId','title','dueAtIso','status','createdAtIso','completedAtIso','updatedAtIso','revision'],
  tasks: ['id','projectRequestId','title','description','assignee','priority','status','dueAtIso','createdAtIso','completedAtIso','completedBy','updatedAtIso','revision'],
  workLogs: ['id','projectRequestId','taskId','actor','minutes','billable','note','loggedAtIso','createdAtIso'],
  notes: ['id','projectRequestId','author','visibility','body','status','createdAtIso','archivedAtIso','archivedBy','updatedAtIso'],
  issues: ['id','projectRequestId','title','description','severity','owner','status','openedAtIso','resolvedAtIso','resolutionNote','updatedAtIso'],
  risks: ['id','projectRequestId','title','description','probability','impact','mitigationPlan','owner','status','identifiedAtIso','mitigatedAtIso','mitigationNote','updatedAtIso'],
  documents: ['id','projectRequestId','deliverableId','title','documentType','url','status','uploadedBy','uploadedAtIso','archivedAtIso','archivedBy','updatedAtIso'],
  deliverables: ['id','projectRequestId','milestoneId','title','artifactUrl','status','submittedAtIso','acceptedAtIso','updatedAtIso'],
  feedback: ['id','projectRequestId','deliverableId','author','sentiment','message','status','receivedAtIso','addressedAtIso','addressedBy','responseNote','updatedAtIso'],
  invoices: ['id','projectRequestId','deliverableId','invoiceNumber','amountCents','currency','status','issuedAtIso','dueAtIso','paidAtIso','updatedAtIso'],
  expenses: ['id','projectRequestId','category','description','vendor','amountCents','currency','reimbursable','receiptUrl','incurredAtIso','status','decidedAtIso','decidedBy','decisionNote','updatedAtIso'],
  activities: ['id','projectRequestId','eventType','summary','actor','happenedAtIso','createdAtIso'],
  changeRequests: ['id','projectRequestId','title','description','requestedBy','estimateDeltaCents','estimateCurrency','status','requestedAtIso','decidedAtIso','decidedBy','decisionNote','updatedAtIso'],
} as const);
export type ExportEntity = keyof typeof exportFields;
export type ExportCollection = Exclude<ExportEntity, 'project' | 'client'>;
export const exportCollections = Object.freeze(Object.keys(exportFields).filter(k => k !== 'project' && k !== 'client') as ExportCollection[]);
export type ExportRecord = Readonly<Record<string, string | number | boolean | null>>;
export interface ProjectExportSnapshot {
  readonly project: ExportRecord;
  readonly client: ExportRecord;
  readonly collections: Readonly<Record<ExportCollection, readonly ExportRecord[]>>;
  readonly financeTotalsByCurrency: ProjectFinanceTotalsByCurrency;
}
export interface ProjectExportArtifact extends ProjectExportSnapshot {
  readonly format: 'projectops.internal-project';
  readonly version: 1;
  readonly generatedAtIso: string;
  readonly generatedBy: string;
}

const optional = new Set(['contactName','email','budgetRange','deadlineIso','estimateAmountCents','estimateCurrency','estimatedAtIso','approvedAtIso','approvedBy','dueAtIso','completedAtIso','completedBy','description','assignee','taskId','note','owner','resolvedAtIso','resolutionNote','mitigationPlan','mitigatedAtIso','mitigationNote','deliverableId','archivedAtIso','archivedBy','milestoneId','acceptedAtIso','addressedAtIso','addressedBy','responseNote','paidAtIso','vendor','receiptUrl','decidedAtIso','decidedBy','decisionNote','actor','estimateDeltaCents']);
const numeric = new Set(['revision','minutes','amountCents','estimateAmountCents','estimateDeltaCents']);
export function validateExportIdentifier(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) {
    throw new ProjectOpsValidationError('INVALID_PROJECTOPS_IDENTIFIER', 'A valid project identifier is required.');
  }
  return value;
}
export function projectExportFilename(id: string): string {
  return `projectops-project-${validateExportIdentifier(id).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
}
function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('Invalid export timestamp.');
  return new Date(value).toISOString();
}
export function composeExportRecord(entity: ExportEntity, value: unknown): ExportRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Missing export source record.');
  const source = value as Record<string, unknown>;
  return Object.freeze(Object.fromEntries(exportFields[entity].map(key => {
    const item = source[key];
    if (item == null) {
      // Actor is nullable only on legacy activity rows; required descriptions remain required.
      if (!optional.has(key) || (key === 'actor' && entity !== 'activities') || (key === 'description' && entity !== 'tasks')) throw Error(`Missing export field: ${entity}.${key}.`);
      return [key, null];
    }
    if (key.endsWith('Iso')) return [key, canonicalInstant(item)];
    if (numeric.has(key)) { if (typeof item !== 'number' || !Number.isSafeInteger(item)) throw Error('Invalid export integer.'); }
    else if (key === 'billable' || key === 'reimbursable') { if (typeof item !== 'boolean') throw Error('Invalid export boolean.'); }
    else if (typeof item !== 'string') throw Error('Invalid export text.');
    return [key, item];
  })));
}
/** Dates are compared as instants, independent of source offset and process locale. */
export const exportOrder = Object.freeze({
  milestones: [['dueAtIso',1],['createdAtIso',1]], tasks: [['dueAtIso',1],['createdAtIso',-1]],
  workLogs: [['loggedAtIso',-1],['createdAtIso',-1]], notes: [['createdAtIso',-1]],
  issues: [['openedAtIso',-1]], risks: [['identifiedAtIso',-1],['updatedAtIso',-1]],
  documents: [['uploadedAtIso',-1]], deliverables: [['submittedAtIso',-1]],
  feedback: [['receivedAtIso',-1]], invoices: [['issuedAtIso',-1]],
  expenses: [['incurredAtIso',-1],['updatedAtIso',-1]],
  activities: [['happenedAtIso',-1],['createdAtIso',-1]], changeRequests: [['requestedAtIso',-1]],
} as const);
export function orderExportCollection(kind: ExportCollection, rows: readonly ExportRecord[]): readonly ExportRecord[] {
  return Object.freeze([...rows].sort((a,b) => {
    for (const [key, direction] of exportOrder[kind]) {
      const av=a[key], bv=b[key]; if (av == null || bv == null) { if (av !== bv) return av == null ? 1 : -1; }
      else { const difference=Date.parse(String(av))-Date.parse(String(bv)); if (difference) return direction*difference; }
    }
    return a.id === b.id ? 0 : String(a.id) < String(b.id) ? -1 : 1;
  }));
}
export function composeProjectExportSnapshot(value: unknown): ProjectExportSnapshot {
  if (!value || typeof value !== 'object') throw Error('Missing project snapshot.');
  const source=value as any, project=composeExportRecord('project',source.project), client=composeExportRecord('client',source.client);
  if (project.clientId !== client.id) throw Error('Invalid snapshot client relationship.');
  const collections=Object.fromEntries(exportCollections.map(kind=>{
    if (!Array.isArray(source.collections?.[kind])) throw Error(`Missing snapshot collection: ${kind}.`);
    const rows=source.collections[kind].map((row: unknown)=>composeExportRecord(kind,row));
    if (rows.some((row: ExportRecord)=>row.projectRequestId !== project.id)) throw Error('Invalid snapshot project relationship.');
    return [kind,orderExportCollection(kind,rows)];
  })) as Record<ExportCollection, readonly ExportRecord[]>;
  return Object.freeze({project,client,collections:Object.freeze(collections),
    financeTotalsByCurrency:totalProjectFinances(collections.invoices as any,collections.expenses as any)});
}
export function createProjectExportArtifact(snapshot: ProjectExportSnapshot, generatedBy: string, now: string): ProjectExportArtifact {
  if (typeof generatedBy !== 'string' || !generatedBy.trim() || generatedBy.length > 120) throw Error('Trusted generation identity required.');
  return Object.freeze({format:'projectops.internal-project',version:1,generatedAtIso:canonicalInstant(now),generatedBy,project:snapshot.project,client:snapshot.client,collections:snapshot.collections,financeTotalsByCurrency:snapshot.financeTotalsByCurrency});
}
