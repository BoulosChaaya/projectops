import type { RouteDefinition } from '../http/path-matching.ts';
import type { KernelRouteHandler } from '../bootstrap/http-listener.ts';
import { HttpError } from '../http/errors/classify.ts';
import {
  ProjectOpsOperationError,
  ProjectOpsValidationError,
} from '../../../../packages/projectops/src/index.ts';
import type {
  AddressProjectFeedbackInput,
  ArchiveProjectDocumentInput,
  ArchiveProjectNoteInput,
  ApproveProjectRequestInput,
  CompleteProjectTaskInput,
  DecideProjectExpenseInput,
  DecideProjectChangeRequestInput,
  EstimateProjectRequestInput,
  MitigateProjectRiskInput,
  NewClientInput,
  NewProjectActivityInput,
  NewProjectChangeRequestInput,
  NewProjectDeliverableInput,
  NewProjectDocumentInput,
  NewProjectExpenseInput,
  NewProjectFeedbackInput,
  NewProjectInvoiceInput,
  NewProjectIssueInput,
  NewProjectMilestoneInput,
  NewProjectNoteInput,
  NewProjectRequestInput,
  NewProjectRiskInput,
  NewProjectTaskInput,
  NewProjectWorkLogInput,
  ProjectDeliverable,
  ProjectActivity,
  ProjectChangeRequest,
  ProjectFeedback,
  ProjectDocument,
  ProjectExpense,
  ProjectInvoice,
  ProjectIssue,
  ProjectOpsClient,
  ProjectOpsDashboardView,
  ProjectMilestone,
  ProjectNote,
  ProjectRequest,
  ProjectRequestStatus,
  ProjectRisk,
  ProjectTask,
  ProjectWorkLog,
  ResolveProjectIssueInput,
} from '../../../../packages/projectops/src/index.ts';

export interface ProjectOpsApiService {
  createClient(input: NewClientInput): Promise<ProjectOpsClient>;
  createProjectRequest(input: NewProjectRequestInput): Promise<ProjectRequest>;
  listClients(): Promise<readonly ProjectOpsClient[]>;
  getClient(id: string): Promise<ProjectOpsClient | undefined>;
  listProjectRequests(): Promise<readonly ProjectRequest[]>;
  getProjectRequest(id: string): Promise<ProjectRequest | undefined>;
  createProjectMilestone(
    projectRequestId: string,
    input: NewProjectMilestoneInput
  ): Promise<ProjectMilestone>;
  listProjectMilestones(projectRequestId: string): Promise<readonly ProjectMilestone[]>;
  completeProjectMilestone(
    projectRequestId: string,
    milestoneId: string,
    completedAtIso: string
  ): Promise<ProjectMilestone>;
  createProjectDeliverable(
    projectRequestId: string,
    input: NewProjectDeliverableInput
  ): Promise<ProjectDeliverable>;
  listProjectDeliverables(projectRequestId: string): Promise<readonly ProjectDeliverable[]>;
  acceptProjectDeliverable(
    projectRequestId: string,
    deliverableId: string,
    acceptedAtIso: string
  ): Promise<ProjectDeliverable>;
  createProjectInvoice(
    projectRequestId: string,
    input: NewProjectInvoiceInput
  ): Promise<ProjectInvoice>;
  listProjectInvoices(projectRequestId: string): Promise<readonly ProjectInvoice[]>;
  markProjectInvoicePaid(
    projectRequestId: string,
    invoiceId: string,
    paidAtIso: string
  ): Promise<ProjectInvoice>;
  createProjectChangeRequest(
    projectRequestId: string,
    input: NewProjectChangeRequestInput
  ): Promise<ProjectChangeRequest>;
  listProjectChangeRequests(projectRequestId: string): Promise<readonly ProjectChangeRequest[]>;
  approveProjectChangeRequest(
    projectRequestId: string,
    changeRequestId: string,
    input: DecideProjectChangeRequestInput
  ): Promise<ProjectChangeRequest>;
  rejectProjectChangeRequest(
    projectRequestId: string,
    changeRequestId: string,
    input: DecideProjectChangeRequestInput
  ): Promise<ProjectChangeRequest>;
  createProjectIssue(
    projectRequestId: string,
    input: NewProjectIssueInput
  ): Promise<ProjectIssue>;
  listProjectIssues(projectRequestId: string): Promise<readonly ProjectIssue[]>;
  resolveProjectIssue(
    projectRequestId: string,
    issueId: string,
    input: ResolveProjectIssueInput
  ): Promise<ProjectIssue>;
  createProjectRisk(
    projectRequestId: string,
    input: NewProjectRiskInput
  ): Promise<ProjectRisk>;
  listProjectRisks(projectRequestId: string): Promise<readonly ProjectRisk[]>;
  mitigateProjectRisk(
    projectRequestId: string,
    riskId: string,
    input: MitigateProjectRiskInput
  ): Promise<ProjectRisk>;
  createProjectFeedback(
    projectRequestId: string,
    input: NewProjectFeedbackInput
  ): Promise<ProjectFeedback>;
  listProjectFeedback(projectRequestId: string): Promise<readonly ProjectFeedback[]>;
  addressProjectFeedback(
    projectRequestId: string,
    feedbackId: string,
    input: AddressProjectFeedbackInput
  ): Promise<ProjectFeedback>;
  createProjectDocument(
    projectRequestId: string,
    input: NewProjectDocumentInput
  ): Promise<ProjectDocument>;
  listProjectDocuments(projectRequestId: string): Promise<readonly ProjectDocument[]>;
  archiveProjectDocument(
    projectRequestId: string,
    documentId: string,
    input: ArchiveProjectDocumentInput
  ): Promise<ProjectDocument>;
  createProjectNote(
    projectRequestId: string,
    input: NewProjectNoteInput
  ): Promise<ProjectNote>;
  listProjectNotes(projectRequestId: string): Promise<readonly ProjectNote[]>;
  archiveProjectNote(
    projectRequestId: string,
    noteId: string,
    input: ArchiveProjectNoteInput
  ): Promise<ProjectNote>;
  createProjectTask(
    projectRequestId: string,
    input: NewProjectTaskInput
  ): Promise<ProjectTask>;
  listProjectTasks(projectRequestId: string): Promise<readonly ProjectTask[]>;
  completeProjectTask(
    projectRequestId: string,
    taskId: string,
    input: CompleteProjectTaskInput
  ): Promise<ProjectTask>;
  createProjectWorkLog(
    projectRequestId: string,
    input: NewProjectWorkLogInput
  ): Promise<ProjectWorkLog>;
  listProjectWorkLogs(projectRequestId: string): Promise<readonly ProjectWorkLog[]>;
  createProjectExpense(
    projectRequestId: string,
    input: NewProjectExpenseInput
  ): Promise<ProjectExpense>;
  listProjectExpenses(projectRequestId: string): Promise<readonly ProjectExpense[]>;
  approveProjectExpense(
    projectRequestId: string,
    expenseId: string,
    input: DecideProjectExpenseInput
  ): Promise<ProjectExpense>;
  rejectProjectExpense(
    projectRequestId: string,
    expenseId: string,
    input: DecideProjectExpenseInput
  ): Promise<ProjectExpense>;
  createProjectActivity(
    projectRequestId: string,
    input: NewProjectActivityInput
  ): Promise<ProjectActivity>;
  listProjectActivities(projectRequestId: string): Promise<readonly ProjectActivity[]>;
  estimateProjectRequest(
    id: string,
    input: EstimateProjectRequestInput
  ): Promise<ProjectRequest>;
  approveProjectRequest(
    id: string,
    input: ApproveProjectRequestInput
  ): Promise<ProjectRequest>;
  transitionProjectRequest(
    id: string,
    nextStatus: ProjectRequestStatus,
    nowIso: string
  ): Promise<ProjectRequest>;
  getDashboard(): Promise<ProjectOpsDashboardView>;
}

export function createProjectOpsRoutes(
  service: ProjectOpsApiService,
  clock: () => string = () => new Date().toISOString()
): readonly RouteDefinition<KernelRouteHandler>[] {
  return Object.freeze([
    {
      method: 'POST',
      path: '/projectops/clients',
      handler: async (request) =>
        await runProjectOpsRequest(() => service.createClient(readClientInput(request.body, clock))),
    },
    {
      method: 'GET',
      path: '/projectops/clients',
      handler: async () => await service.listClients(),
    },
    {
      method: 'GET',
      path: '/projectops/clients/:id',
      handler: async (_request, _context, params) =>
        await requireFound(service.getClient(params.id), 'PROJECTOPS_CLIENT_NOT_FOUND'),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests',
      handler: async (request) =>
        await runProjectOpsRequest(() =>
          service.createProjectRequest(readProjectRequestInput(request.body, clock))
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests',
      handler: async () => await service.listProjectRequests(),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/milestones',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectMilestones(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/milestones',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectMilestone(params.id, readMilestoneInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/milestones/:milestoneId/complete',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.completeProjectMilestone(
            params.id,
            params.milestoneId,
            readCompletedAtIso(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/deliverables',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectDeliverables(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/deliverables',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectDeliverable(params.id, readDeliverableInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/deliverables/:deliverableId/accept',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.acceptProjectDeliverable(
            params.id,
            params.deliverableId,
            readAcceptedAtIso(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/invoices',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectInvoices(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/invoices',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectInvoice(params.id, readInvoiceInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/invoices/:invoiceId/pay',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.markProjectInvoicePaid(
            params.id,
            params.invoiceId,
            readPaidAtIso(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/change-requests',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectChangeRequests(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/change-requests',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectChangeRequest(
            params.id,
            readChangeRequestInput(params.id, request.body, clock)
          )
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/change-requests/:changeRequestId/approve',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.approveProjectChangeRequest(
            params.id,
            params.changeRequestId,
            readChangeRequestDecisionInput(request.body, clock)
          )
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/change-requests/:changeRequestId/reject',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.rejectProjectChangeRequest(
            params.id,
            params.changeRequestId,
            readChangeRequestDecisionInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/issues',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectIssues(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/issues',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectIssue(params.id, readIssueInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/issues/:issueId/resolve',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.resolveProjectIssue(
            params.id,
            params.issueId,
            readResolveIssueInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/risks',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectRisks(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/risks',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectRisk(params.id, readRiskInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/risks/:riskId/mitigate',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.mitigateProjectRisk(
            params.id,
            params.riskId,
            readMitigateRiskInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/feedback',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectFeedback(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/feedback',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectFeedback(params.id, readFeedbackInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/feedback/:feedbackId/address',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.addressProjectFeedback(
            params.id,
            params.feedbackId,
            readAddressFeedbackInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/documents',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectDocuments(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/documents',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectDocument(params.id, readDocumentInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/documents/:documentId/archive',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.archiveProjectDocument(
            params.id,
            params.documentId,
            readArchiveDocumentInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/notes',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectNotes(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/notes',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectNote(params.id, readNoteInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/notes/:noteId/archive',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.archiveProjectNote(
            params.id,
            params.noteId,
            readArchiveNoteInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/tasks',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectTasks(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/tasks',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectTask(params.id, readTaskInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/tasks/:taskId/complete',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.completeProjectTask(
            params.id,
            params.taskId,
            readCompleteTaskInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/work-logs',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectWorkLogs(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/work-logs',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectWorkLog(params.id, readWorkLogInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/expenses',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectExpenses(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/expenses',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectExpense(params.id, readExpenseInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/expenses/:expenseId/approve',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.approveProjectExpense(
            params.id,
            params.expenseId,
            readExpenseDecisionInput(request.body, clock)
          )
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/expenses/:expenseId/reject',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.rejectProjectExpense(
            params.id,
            params.expenseId,
            readExpenseDecisionInput(request.body, clock)
          )
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id/activities',
      handler: async (_request, _context, params) =>
        await runProjectOpsRequest(() => service.listProjectActivities(params.id)),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/activities',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.createProjectActivity(params.id, readActivityInput(params.id, request.body, clock))
        ),
    },
    {
      method: 'GET',
      path: '/projectops/project-requests/:id',
      handler: async (_request, _context, params) =>
        await requireFound(service.getProjectRequest(params.id), 'PROJECTOPS_REQUEST_NOT_FOUND'),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/estimate',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.estimateProjectRequest(params.id, readEstimateInput(request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/approve',
      handler: async (request, _context, params) =>
        await runProjectOpsRequest(() =>
          service.approveProjectRequest(params.id, readApprovalInput(request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/status',
      handler: async (request, _context, params) => {
        const body = readRecord(request.body);
        const nextStatus = readStatus(body.status);
        return await runProjectOpsRequest(() =>
          service.transitionProjectRequest(params.id, nextStatus, clock())
        );
      },
    },
    {
      method: 'GET',
      path: '/projectops/dashboard',
      handler: async () => await service.getDashboard(),
    },
  ]);
}

async function requireFound<T>(value: Promise<T | undefined>, code: string): Promise<T> {
  const resolved = await value;
  if (!resolved) {
    throw new HttpError(404, code, 'ProjectOps resource not found.');
  }
  return resolved;
}

async function runProjectOpsRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isProjectOpsValidationError(error)) {
      throw new HttpError(400, error.code, error.message);
    }
    if (isProjectOpsOperationError(error)) {
      throw new HttpError(statusForProjectOpsOperation(error), error.code, error.message);
    }
    throw error;
  }
}

function isProjectOpsValidationError(
  error: unknown
): error is ProjectOpsValidationError {
  return (
    error instanceof ProjectOpsValidationError ||
    (
      Boolean(error) &&
      typeof error === 'object' &&
      (error as { name?: unknown }).name === 'ProjectOpsValidationError' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { message?: unknown }).message === 'string'
    )
  );
}

function isProjectOpsOperationError(
  error: unknown
): error is ProjectOpsOperationError {
  return (
    error instanceof ProjectOpsOperationError ||
    (
      Boolean(error) &&
      typeof error === 'object' &&
      (error as { name?: unknown }).name === 'ProjectOpsOperationError' &&
      typeof (error as { kind?: unknown }).kind === 'string' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { message?: unknown }).message === 'string'
    )
  );
}

function statusForProjectOpsOperation(error: ProjectOpsOperationError): number {
  if (error.kind === 'conflict') return 409;
  if (error.kind === 'not_found') return 404;
  return 400;
}

function readClientInput(body: unknown, clock: () => string): NewClientInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    name: readString(value.name, 'name'),
    contactName: readOptionalString(value.contactName, 'contactName'),
    email: readOptionalString(value.email, 'email'),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readProjectRequestInput(body: unknown, clock: () => string): NewProjectRequestInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    clientId: readString(value.clientId, 'clientId'),
    title: readString(value.title, 'title'),
    brief: readString(value.brief, 'brief'),
    budgetRange: readOptionalString(value.budgetRange, 'budgetRange'),
    deadlineIso: readOptionalString(value.deadlineIso, 'deadlineIso'),
    priority: readOptionalPriority(value.priority),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readEstimateInput(body: unknown, clock: () => string): EstimateProjectRequestInput {
  const value = readRecord(body);
  return Object.freeze({
    amountCents: readPositiveInteger(value.amountCents, 'amountCents'),
    currency: readString(value.currency, 'currency'),
    estimatedAtIso: readOptionalString(value.estimatedAtIso, 'estimatedAtIso') ?? clock(),
  });
}

function readApprovalInput(body: unknown, clock: () => string): ApproveProjectRequestInput {
  const value = readRecord(body);
  return Object.freeze({
    approvedBy: readString(value.approvedBy, 'approvedBy'),
    approvedAtIso: readOptionalString(value.approvedAtIso, 'approvedAtIso') ?? clock(),
  });
}

function readMilestoneInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectMilestoneInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    title: readString(value.title, 'title'),
    dueAtIso: readOptionalString(value.dueAtIso, 'dueAtIso'),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readCompletedAtIso(body: unknown, clock: () => string): string {
  const value = readRecord(body);
  return readOptionalString(value.completedAtIso, 'completedAtIso') ?? clock();
}

function readDeliverableInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectDeliverableInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    milestoneId: readOptionalString(value.milestoneId, 'milestoneId'),
    title: readString(value.title, 'title'),
    artifactUrl: readString(value.artifactUrl, 'artifactUrl'),
    submittedAtIso: readOptionalString(value.submittedAtIso, 'submittedAtIso') ?? clock(),
  });
}

function readAcceptedAtIso(body: unknown, clock: () => string): string {
  const value = readRecord(body);
  return readOptionalString(value.acceptedAtIso, 'acceptedAtIso') ?? clock();
}

function readInvoiceInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectInvoiceInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    deliverableId: readOptionalString(value.deliverableId, 'deliverableId'),
    invoiceNumber: readString(value.invoiceNumber, 'invoiceNumber'),
    amountCents: readPositiveInteger(value.amountCents, 'amountCents'),
    currency: readString(value.currency, 'currency'),
    issuedAtIso: readOptionalString(value.issuedAtIso, 'issuedAtIso') ?? clock(),
    dueAtIso: readOptionalString(value.dueAtIso, 'dueAtIso'),
  });
}

function readPaidAtIso(body: unknown, clock: () => string): string {
  const value = readRecord(body);
  return readOptionalString(value.paidAtIso, 'paidAtIso') ?? clock();
}

function readChangeRequestInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectChangeRequestInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    title: readString(value.title, 'title'),
    description: readString(value.description, 'description'),
    requestedBy: readString(value.requestedBy, 'requestedBy'),
    estimateDeltaCents: readOptionalPositiveInteger(value.estimateDeltaCents, 'estimateDeltaCents'),
    estimateCurrency: readOptionalString(value.estimateCurrency, 'estimateCurrency'),
    requestedAtIso: readOptionalString(value.requestedAtIso, 'requestedAtIso') ?? clock(),
  });
}

function readChangeRequestDecisionInput(
  body: unknown,
  clock: () => string
): DecideProjectChangeRequestInput {
  const value = readRecord(body);
  return Object.freeze({
    decidedBy: readString(value.decidedBy, 'decidedBy'),
    decidedAtIso: readOptionalString(value.decidedAtIso, 'decidedAtIso') ?? clock(),
    decisionNote: readOptionalString(value.decisionNote, 'decisionNote'),
  });
}

function readIssueInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectIssueInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    title: readString(value.title, 'title'),
    description: readString(value.description, 'description'),
    severity: readOptionalIssueSeverity(value.severity),
    owner: readOptionalString(value.owner, 'owner'),
    openedAtIso: readOptionalString(value.openedAtIso, 'openedAtIso') ?? clock(),
  });
}

function readResolveIssueInput(body: unknown, clock: () => string): ResolveProjectIssueInput {
  const value = readRecord(body);
  return Object.freeze({
    resolvedAtIso: readOptionalString(value.resolvedAtIso, 'resolvedAtIso') ?? clock(),
    resolutionNote: readOptionalString(value.resolutionNote, 'resolutionNote'),
  });
}

function readRiskInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectRiskInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    title: readString(value.title, 'title'),
    description: readString(value.description, 'description'),
    probability: readOptionalRiskLevel(value.probability, 'probability'),
    impact: readOptionalRiskLevel(value.impact, 'impact'),
    mitigationPlan: readOptionalString(value.mitigationPlan, 'mitigationPlan'),
    owner: readOptionalString(value.owner, 'owner'),
    identifiedAtIso: readOptionalString(value.identifiedAtIso, 'identifiedAtIso') ?? clock(),
  });
}

function readMitigateRiskInput(
  body: unknown,
  clock: () => string
): MitigateProjectRiskInput {
  const value = readRecord(body);
  return Object.freeze({
    mitigatedAtIso: readOptionalString(value.mitigatedAtIso, 'mitigatedAtIso') ?? clock(),
    mitigationNote: readOptionalString(value.mitigationNote, 'mitigationNote'),
  });
}

function readFeedbackInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectFeedbackInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    deliverableId: readOptionalString(value.deliverableId, 'deliverableId'),
    author: readString(value.author, 'author'),
    sentiment: readOptionalFeedbackSentiment(value.sentiment),
    message: readString(value.message, 'message'),
    receivedAtIso: readOptionalString(value.receivedAtIso, 'receivedAtIso') ?? clock(),
  });
}

function readAddressFeedbackInput(
  body: unknown,
  clock: () => string
): AddressProjectFeedbackInput {
  const value = readRecord(body);
  return Object.freeze({
    addressedBy: readString(value.addressedBy, 'addressedBy'),
    addressedAtIso: readOptionalString(value.addressedAtIso, 'addressedAtIso') ?? clock(),
    responseNote: readOptionalString(value.responseNote, 'responseNote'),
  });
}

function readDocumentInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectDocumentInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    deliverableId: readOptionalString(value.deliverableId, 'deliverableId'),
    title: readString(value.title, 'title'),
    documentType: readOptionalDocumentType(value.documentType),
    url: readString(value.url, 'url'),
    uploadedBy: readString(value.uploadedBy, 'uploadedBy'),
    uploadedAtIso: readOptionalString(value.uploadedAtIso, 'uploadedAtIso') ?? clock(),
  });
}

function readArchiveDocumentInput(
  body: unknown,
  clock: () => string
): ArchiveProjectDocumentInput {
  const value = readRecord(body);
  return Object.freeze({
    archivedBy: readString(value.archivedBy, 'archivedBy'),
    archivedAtIso: readOptionalString(value.archivedAtIso, 'archivedAtIso') ?? clock(),
  });
}

function readNoteInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectNoteInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    author: readString(value.author, 'author'),
    visibility: readOptionalNoteVisibility(value.visibility),
    body: readString(value.body, 'body'),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readArchiveNoteInput(
  body: unknown,
  clock: () => string
): ArchiveProjectNoteInput {
  const value = readRecord(body);
  return Object.freeze({
    archivedBy: readString(value.archivedBy, 'archivedBy'),
    archivedAtIso: readOptionalString(value.archivedAtIso, 'archivedAtIso') ?? clock(),
  });
}

function readTaskInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectTaskInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    title: readString(value.title, 'title'),
    description: readOptionalString(value.description, 'description'),
    assignee: readOptionalString(value.assignee, 'assignee'),
    priority: readOptionalTaskPriority(value.priority),
    dueAtIso: readOptionalString(value.dueAtIso, 'dueAtIso'),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readCompleteTaskInput(
  body: unknown,
  clock: () => string
): CompleteProjectTaskInput {
  const value = readRecord(body);
  return Object.freeze({
    completedBy: readString(value.completedBy, 'completedBy'),
    completedAtIso: readOptionalString(value.completedAtIso, 'completedAtIso') ?? clock(),
  });
}

function readWorkLogInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectWorkLogInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    taskId: readOptionalString(value.taskId, 'taskId'),
    actor: readString(value.actor, 'actor'),
    minutes: readPositiveInteger(value.minutes, 'minutes'),
    billable: readOptionalBoolean(value.billable, 'billable'),
    note: readOptionalString(value.note, 'note'),
    loggedAtIso: readOptionalString(value.loggedAtIso, 'loggedAtIso') ?? clock(),
  });
}

function readExpenseInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectExpenseInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    category: readOptionalExpenseCategory(value.category),
    description: readString(value.description, 'description'),
    vendor: readOptionalString(value.vendor, 'vendor'),
    amountCents: readPositiveInteger(value.amountCents, 'amountCents'),
    currency: readString(value.currency, 'currency'),
    reimbursable: readOptionalBoolean(value.reimbursable, 'reimbursable'),
    receiptUrl: readOptionalString(value.receiptUrl, 'receiptUrl'),
    incurredAtIso: readOptionalString(value.incurredAtIso, 'incurredAtIso') ?? clock(),
  });
}

function readExpenseDecisionInput(
  body: unknown,
  clock: () => string
): DecideProjectExpenseInput {
  const value = readRecord(body);
  return Object.freeze({
    decidedBy: readString(value.decidedBy, 'decidedBy'),
    decidedAtIso: readOptionalString(value.decidedAtIso, 'decidedAtIso') ?? clock(),
    decisionNote: readOptionalString(value.decisionNote, 'decisionNote'),
  });
}

function readActivityInput(
  projectRequestId: string,
  body: unknown,
  clock: () => string
): NewProjectActivityInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    projectRequestId,
    eventType: readActivityEventType(value.eventType),
    summary: readString(value.summary, 'summary'),
    actor: readOptionalString(value.actor, 'actor'),
    happenedAtIso: readOptionalString(value.happenedAtIso, 'happenedAtIso') ?? clock(),
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_PROJECTOPS_PAYLOAD', 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'INVALID_PROJECTOPS_FIELD', `Missing or invalid field: ${field}.`);
  }
  return value;
}

function readOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return readPositiveInteger(value, field);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'INVALID_PROJECTOPS_FIELD', `Missing or invalid field: ${field}.`);
  }
  return value;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_PROJECTOPS_FIELD', `Invalid field: ${field}.`);
  }
  return value;
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'INVALID_PROJECTOPS_FIELD', `Invalid field: ${field}.`);
  }
  return value;
}

function readOptionalPriority(value: unknown): 'low' | 'medium' | 'high' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_PRIORITY', 'Unsupported project priority.');
}

function readStatus(value: unknown): ProjectRequestStatus {
  if (
    value === 'new' ||
    value === 'estimated' ||
    value === 'approved' ||
    value === 'in_progress' ||
    value === 'delivered' ||
    value === 'archived'
  ) {
    return value;
  }
  throw new HttpError(400, 'INVALID_PROJECTOPS_STATUS', 'Unsupported project request status.');
}

function readOptionalIssueSeverity(value: unknown): NewProjectIssueInput['severity'] {
  if (value === undefined || value === null) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_ISSUE_SEVERITY', 'Unsupported project issue severity.');
}

function readOptionalRiskLevel(
  value: unknown,
  field: string
): NewProjectRiskInput['probability'] {
  if (value === undefined || value === null) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_RISK_LEVEL', `Unsupported project risk ${field}.`);
}

function readOptionalFeedbackSentiment(value: unknown): NewProjectFeedbackInput['sentiment'] {
  if (value === undefined || value === null) return undefined;
  if (value === 'positive' || value === 'neutral' || value === 'negative') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_FEEDBACK_SENTIMENT', 'Unsupported project feedback sentiment.');
}

function readOptionalDocumentType(value: unknown): NewProjectDocumentInput['documentType'] {
  if (value === undefined || value === null) return undefined;
  if (
    value === 'proposal' ||
    value === 'contract' ||
    value === 'asset' ||
    value === 'handoff' ||
    value === 'other'
  ) {
    return value;
  }
  throw new HttpError(400, 'INVALID_PROJECTOPS_DOCUMENT_TYPE', 'Unsupported project document type.');
}

function readOptionalNoteVisibility(value: unknown): NewProjectNoteInput['visibility'] {
  if (value === undefined || value === null) return undefined;
  if (value === 'internal' || value === 'client') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_NOTE_VISIBILITY', 'Unsupported project note visibility.');
}

function readOptionalTaskPriority(value: unknown): NewProjectTaskInput['priority'] {
  if (value === undefined || value === null) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_TASK_PRIORITY', 'Unsupported project task priority.');
}

function readOptionalExpenseCategory(value: unknown): NewProjectExpenseInput['category'] {
  if (value === undefined || value === null) return undefined;
  if (
    value === 'software' ||
    value === 'asset' ||
    value === 'service' ||
    value === 'travel' ||
    value === 'other'
  ) {
    return value;
  }
  throw new HttpError(400, 'INVALID_PROJECTOPS_EXPENSE_CATEGORY', 'Unsupported project expense category.');
}

function readActivityEventType(value: unknown): NewProjectActivityInput['eventType'] {
  if (
    value === 'request_created' ||
    value === 'request_estimated' ||
    value === 'request_approved' ||
    value === 'status_changed' ||
    value === 'milestone_created' ||
    value === 'milestone_completed' ||
    value === 'deliverable_submitted' ||
    value === 'deliverable_accepted' ||
    value === 'invoice_issued' ||
    value === 'invoice_paid' ||
    value === 'note_added'
  ) {
    return value;
  }
  throw new HttpError(400, 'INVALID_PROJECTOPS_ACTIVITY_EVENT_TYPE', 'Unsupported project activity event type.');
}
