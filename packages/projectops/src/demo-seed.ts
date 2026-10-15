import { ProjectOpsRepository, type ProjectOpsSqlExecutor } from './repository.ts';

/** The identity a demo visitor works under: their actions, and the seeded history, are by "demo". */
export const DEMO_LOGIN = 'demo';

/**
 * A small fictional studio's book of work, written through the repository's own commands so every
 * record passes the same business rules as real use, and the history is the history those
 * commands record. Times are relative to `now`, so the dashboard always has something overdue,
 * something upcoming and money outstanding. Names, people and addresses are invented; email
 * addresses use the reserved .example domain and links the reserved example.com.
 */
export async function seedDemoAgency(sql: ProjectOpsSqlExecutor, now: Date = new Date()): Promise<void> {
  const base = now.getTime();
  // An instant `days` from now (negative: in the past), at a whole minute.
  const at = (days: number, hours = 0) => new Date(Math.floor((base + (days * 24 + hours) * 3_600_000) / 60_000) * 60_000).toISOString();
  let cursor = at(-60);
  const repo = new ProjectOpsRepository(sql).withHistory({ actor: DEMO_LOGIN, clock: () => cursor });
  // Every command happens "at" its business time, so the history reads in the order things happened.
  const when = (iso: string) => { cursor = iso; return iso; };
  const revision = async (id: string) => (await repo.getProjectRequest(id))!.revision;
  const transition = async (id: string, status: Parameters<ProjectOpsRepository['transitionProjectRequest']>[1], iso: string) =>
    repo.transitionProjectRequest(id, status, when(iso), await revision(id));

  // Clients
  const clients = [
    { id: 'harbor-finch', name: 'Harbor & Finch Bakery', contactName: 'Maya Lindqvist', email: 'maya@harborfinch.example', days: -58 },
    { id: 'lumen-physio', name: 'Lumen Physio Clinic', contactName: 'Omar Haddad', email: 'omar@lumenphysio.example', days: -50 },
    { id: 'atlas-trail', name: 'Atlas Trail Outfitters', contactName: 'Jonas Weber', email: 'jonas@atlastrail.example', days: -41 },
    { id: 'brightwave', name: 'Brightwave Language School', contactName: 'Sofia Marín', email: 'sofia@brightwave.example', days: -57 },
    { id: 'kestrel-freight', name: 'Kestrel Freight', contactName: 'Priya Nair', email: 'priya@kestrelfreight.example', days: -55 },
    { id: 'juniper-house', name: 'Juniper House Hotel', contactName: 'Lena Fischer', email: 'lena@juniperhouse.example', days: -59 },
  ];
  for (const client of clients) await repo.createClient({ id: client.id, name: client.name, contactName: client.contactName, email: client.email, createdAtIso: when(at(client.days)) });

  // 1. In progress, with every kind of record: the project a visitor should open first.
  const p = 'bakery-ordering';
  await repo.createProjectRequest({ id: p, clientId: 'harbor-finch', title: 'Online ordering for Harbor & Finch',
    brief: 'Customers order bread and cakes online for pickup at either shop.\nScope: menu with daily availability, pickup slots, card payment, order emails, and a staff view of the day\'s orders.',
    budgetRange: 'EUR 8–10k', priority: 'high', deadlineIso: at(21), createdAtIso: when(at(-45)) });
  await repo.estimateProjectRequest(p, { amountCents: 840_000, currency: 'EUR', estimatedAtIso: when(at(-43)) });
  await repo.approveProjectRequest(p, { approvedBy: 'Maya Lindqvist', approvedAtIso: when(at(-41)) });
  await transition(p, 'in_progress', at(-40));
  const milestones = [
    { id: 'discovery', title: 'Discovery and plan', due: -33, done: -34 },
    { id: 'design', title: 'Design system and mockups', due: -18, done: -19 },
    { id: 'build', title: 'Ordering flow built', due: 6 },
    { id: 'launch', title: 'Launch at both shops', due: 20 },
  ];
  for (const m of milestones) await repo.createProjectMilestone(p, { id: m.id, projectRequestId: p, title: m.title, dueAtIso: at(m.due), createdAtIso: when(at(-39)) });
  const tasks = [
    { id: 'interviews', title: 'Interview shop staff about the morning rush', assignee: 'Ana', priority: 'medium', due: -36, done: -35 },
    { id: 'menu-model', title: 'Model the menu and daily availability', assignee: 'Ana', priority: 'high', due: -30, done: -31 },
    { id: 'mockups', title: 'Mockups: menu, basket, pickup slot', assignee: 'Rui', priority: 'high', due: -20, done: -20 },
    { id: 'payments', title: 'Card payments with the payment provider', assignee: 'Ana', priority: 'high', due: -2 },
    { id: 'slots', title: 'Pickup slots with a cap per slot', assignee: 'Rui', priority: 'medium', due: 4 },
    { id: 'emails', title: 'Order confirmation and ready-for-pickup emails', assignee: 'Rui', priority: 'medium', due: 8 },
    { id: 'staff-view', title: 'Staff view of today\'s orders', assignee: 'Ana', priority: 'medium', due: 12 },
    { id: 'training', title: 'Train staff at both shops', priority: 'low', due: 19 },
  ] as const;
  for (const t of tasks) await repo.createProjectTask(p, { id: t.id, projectRequestId: p, title: t.title, ...('assignee' in t ? { assignee: t.assignee } : {}), priority: t.priority, dueAtIso: at(t.due), createdAtIso: when(at(-38)) });
  for (const t of tasks) if ('done' in t) await repo.completeProjectTask(p, t.id, { completedBy: 'assignee' in t ? t.assignee : DEMO_LOGIN, completedAtIso: when(at(t.done)) });
  for (const m of milestones) if (m.done !== undefined) await repo.completeProjectMilestone(p, m.id, { completedAtIso: when(at(m.done)) });
  const logs = [
    { id: 'log-1', taskId: 'interviews', minutes: 180, note: 'Two interviews per shop; the 7–9am rush drives the slot cap.', days: -35 },
    { id: 'log-2', taskId: 'menu-model', minutes: 240, note: 'Availability by weekday, with a sold-out switch staff can flip.', days: -31 },
    { id: 'log-3', taskId: 'mockups', minutes: 420, days: -21 },
    { id: 'log-4', taskId: 'payments', minutes: 300, note: 'Checkout works; refunds still to do.', days: -3 },
    { id: 'log-5', minutes: 60, billable: false, note: 'Internal review of the build plan.', days: -15 },
  ];
  for (const l of logs) await repo.createProjectWorkLog(p, { id: l.id, projectRequestId: p, ...(l.taskId ? { taskId: l.taskId } : {}), actor: DEMO_LOGIN, minutes: l.minutes, billable: l.billable ?? true, ...(l.note ? { note: l.note } : {}), loggedAtIso: when(at(l.days)) });
  await repo.createProjectNote(p, { id: 'note-kickoff', projectRequestId: p, author: DEMO_LOGIN, visibility: 'client', body: 'Kick-off agreed: launch before the holiday season, pickup only (no delivery) in the first version.', createdAtIso: when(at(-40)) });
  await repo.createProjectNote(p, { id: 'note-margin', projectRequestId: p, author: DEMO_LOGIN, visibility: 'internal', body: 'Payments took longer than planned. Keep the gift-card change request separate from this budget.', createdAtIso: when(at(-3)) });
  await repo.createProjectDocument(p, { id: 'doc-proposal', projectRequestId: p, title: 'Proposal and estimate', documentType: 'proposal', url: 'https://example.com/harbor-finch/proposal.pdf', uploadedBy: DEMO_LOGIN, uploadedAtIso: when(at(-43)) });
  await repo.createProjectDocument(p, { id: 'doc-contract', projectRequestId: p, title: 'Signed contract', documentType: 'contract', url: 'https://example.com/harbor-finch/contract.pdf', uploadedBy: DEMO_LOGIN, uploadedAtIso: when(at(-41)) });
  await repo.createProjectIssue(p, { id: 'issue-cards', projectRequestId: p, title: 'Test cards declined in the payment sandbox', description: 'The provider\'s sandbox rejects every test card from the shop\'s account. Support ticket open.', severity: 'high', owner: 'Ana', openedAtIso: when(at(-4)) });
  await repo.createProjectIssue(p, { id: 'issue-logo', projectRequestId: p, title: 'Logo file is low resolution', description: 'Only a small PNG exists.', severity: 'low', owner: 'Rui', openedAtIso: when(at(-30)) });
  await repo.resolveProjectIssue(p, 'issue-logo', { resolvedAtIso: when(at(-27)), resolutionNote: 'Client found the original vector file.' });
  await repo.createProjectRisk(p, { id: 'risk-rush', projectRequestId: p, title: 'Launch lands in the holiday rush', description: 'Staff have little time to learn a new system in December.', probability: 'medium', impact: 'high', mitigationPlan: 'Launch one shop first; train in short sessions before opening.', owner: DEMO_LOGIN, identifiedAtIso: when(at(-38)) });
  await repo.createProjectDeliverable(p, { id: 'del-design', projectRequestId: p, milestoneId: 'design', title: 'Design system and clickable mockups', artifactUrl: 'https://example.com/harbor-finch/mockups', submittedAtIso: when(at(-20)) });
  await repo.createProjectFeedback(p, { id: 'fb-design', projectRequestId: p, deliverableId: 'del-design', author: 'Maya Lindqvist', sentiment: 'positive', message: 'Love the menu layout. Can the sold-out badge be more visible?', receivedAtIso: when(at(-19, 2)) });
  await repo.addressProjectFeedback(p, 'fb-design', { addressedBy: DEMO_LOGIN, addressedAtIso: when(at(-19, 5)), responseNote: 'Badge is now high-contrast and shown on the photo.' });
  await repo.acceptProjectDeliverable(p, 'del-design', when(at(-19, 6)));
  await repo.createProjectDeliverable(p, { id: 'del-beta', projectRequestId: p, milestoneId: 'build', title: 'Ordering flow beta', artifactUrl: 'https://example.com/harbor-finch/beta', submittedAtIso: when(at(-2)) });
  await repo.createProjectFeedback(p, { id: 'fb-beta', projectRequestId: p, deliverableId: 'del-beta', author: 'Maya Lindqvist', sentiment: 'neutral', message: 'Works well on my phone. Staff ask whether they can pause orders when the oven is full.', receivedAtIso: when(at(-1)) });
  await repo.createProjectInvoice(p, { id: 'inv-deposit', projectRequestId: p, invoiceNumber: 'CS-2026-031', amountCents: 252_000, currency: 'EUR', issuedAtIso: when(at(-41)), dueAtIso: at(-27) });
  await repo.markProjectInvoicePaid(p, 'inv-deposit', when(at(-30)));
  await repo.createProjectInvoice(p, { id: 'inv-design', projectRequestId: p, deliverableId: 'del-design', invoiceNumber: 'CS-2026-038', amountCents: 252_000, currency: 'EUR', issuedAtIso: when(at(-18)), dueAtIso: at(-4) });
  await repo.createProjectExpense(p, { id: 'exp-fonts', projectRequestId: p, category: 'software', description: 'Web font licence for the bakery\'s typeface', vendor: 'Type foundry', amountCents: 12_000, currency: 'EUR', incurredAtIso: when(at(-24)) });
  await repo.approveProjectExpense(p, 'exp-fonts', { decidedBy: DEMO_LOGIN, decidedAtIso: when(at(-23)) });
  await repo.createProjectExpense(p, { id: 'exp-photos', projectRequestId: p, category: 'asset', description: 'Product photography, half day', vendor: 'Local photographer', amountCents: 35_000, currency: 'EUR', receiptUrl: 'https://example.com/harbor-finch/photo-receipt.pdf', incurredAtIso: when(at(-6)) });
  await repo.createProjectChangeRequest(p, { id: 'cr-giftcards', projectRequestId: p, title: 'Gift cards', description: 'Sell gift cards online, redeemable in the shops.', requestedBy: 'Maya Lindqvist', estimateDeltaCents: 120_000, estimateCurrency: 'EUR', requestedAtIso: when(at(-5)) });

  // 2. Approved, ready to start.
  const lumen = 'physio-booking';
  await repo.createProjectRequest({ id: lumen, clientId: 'lumen-physio', title: 'Patient booking portal', brief: 'Patients book, move and cancel physiotherapy sessions online; reminders by email the day before.', budgetRange: 'EUR 10–14k', priority: 'medium', deadlineIso: at(75), createdAtIso: when(at(-20)) });
  await repo.estimateProjectRequest(lumen, { amountCents: 1_200_000, currency: 'EUR', estimatedAtIso: when(at(-12)) });
  await repo.approveProjectRequest(lumen, { approvedBy: 'Omar Haddad', approvedAtIso: when(at(-6)) });
  await repo.createProjectMilestone(lumen, { id: 'lumen-scope', projectRequestId: lumen, title: 'Booking rules agreed', dueAtIso: at(9), createdAtIso: when(at(-5)) });
  await repo.createProjectTask(lumen, { id: 'lumen-rules', projectRequestId: lumen, title: 'Collect cancellation and no-show rules', assignee: 'Rui', priority: 'high', dueAtIso: at(3), createdAtIso: when(at(-5)) });

  // 3. Estimated, waiting for the client's approval.
  const atlas = 'rental-catalogue';
  await repo.createProjectRequest({ id: atlas, clientId: 'atlas-trail', title: 'Rental catalogue refresh', brief: 'Rebuild the gear rental catalogue with sizes, availability by date and a deposit at checkout.', budgetRange: 'EUR 3–5k', priority: 'medium', deadlineIso: at(45), createdAtIso: when(at(-9)) });
  await repo.estimateProjectRequest(atlas, { amountCents: 380_000, currency: 'EUR', estimatedAtIso: when(at(-2)) });

  // 4. New: a brief, nothing more yet.
  await repo.createProjectRequest({ id: 'course-enrolment', clientId: 'brightwave', title: 'Course enrolment site', brief: 'Students pick a language, level and timetable, then pay the term fee. Placement test optional.', priority: 'low', deadlineIso: at(90), createdAtIso: when(at(-1)) });

  // 5. On hold, billed in US dollars: totals stay per currency.
  const kestrel = 'tracking-dashboard';
  await repo.createProjectRequest({ id: kestrel, clientId: 'kestrel-freight', title: 'Shipment tracking dashboard', brief: 'One screen for dispatchers with every truck\'s position, delays and proof-of-delivery photos.', budgetRange: 'USD 14–18k', priority: 'high', deadlineIso: at(40), createdAtIso: when(at(-35)) });
  await repo.estimateProjectRequest(kestrel, { amountCents: 1_500_000, currency: 'USD', estimatedAtIso: when(at(-33)) });
  await repo.approveProjectRequest(kestrel, { approvedBy: 'Priya Nair', approvedAtIso: when(at(-31)) });
  await transition(kestrel, 'in_progress', at(-30));
  await repo.createProjectTask(kestrel, { id: 'kestrel-map', projectRequestId: kestrel, title: 'Live map of trucks', assignee: 'Ana', priority: 'high', dueAtIso: at(-8), createdAtIso: when(at(-29)) });
  await repo.createProjectIssue(kestrel, { id: 'kestrel-api', projectRequestId: kestrel, title: 'Waiting for the carrier\'s API access', description: 'Positions come from the carrier\'s API; credentials have been requested twice.', severity: 'high', owner: 'Priya Nair', openedAtIso: when(at(-12)) });
  await repo.createProjectInvoice(kestrel, { id: 'kestrel-deposit', projectRequestId: kestrel, invoiceNumber: 'CS-2026-034', amountCents: 450_000, currency: 'USD', issuedAtIso: when(at(-31)), dueAtIso: at(-17) });
  await repo.markProjectInvoicePaid(kestrel, 'kestrel-deposit', when(at(-20)));
  await repo.createProjectExpense(kestrel, { id: 'kestrel-maps', projectRequestId: kestrel, category: 'service', description: 'Map tiles, first month', vendor: 'Map provider', amountCents: 4_900, currency: 'USD', incurredAtIso: when(at(-25)) });
  await repo.approveProjectExpense(kestrel, 'kestrel-maps', { decidedBy: DEMO_LOGIN, decidedAtIso: when(at(-24)) });
  await transition(kestrel, 'on_hold', at(-11));

  // 6. Delivered: everything accepted and paid.
  const brand = 'brand-landing';
  await repo.createProjectRequest({ id: brand, clientId: 'brightwave', title: 'Brand refresh and landing page', brief: 'New logo lock-ups, colours and a landing page for the autumn term.', budgetRange: 'EUR 4–6k', priority: 'medium', deadlineIso: at(-8), createdAtIso: when(at(-56)) });
  await repo.estimateProjectRequest(brand, { amountCents: 520_000, currency: 'EUR', estimatedAtIso: when(at(-54)) });
  await repo.approveProjectRequest(brand, { approvedBy: 'Sofia Marín', approvedAtIso: when(at(-53)) });
  await transition(brand, 'in_progress', at(-52));
  await repo.createProjectDeliverable(brand, { id: 'brand-kit', projectRequestId: brand, title: 'Brand kit and landing page', artifactUrl: 'https://example.com/brightwave/brand-kit', submittedAtIso: when(at(-16)) });
  await repo.acceptProjectDeliverable(brand, 'brand-kit', when(at(-14)));
  await repo.createProjectDocument(brand, { id: 'brand-handoff', projectRequestId: brand, deliverableId: 'brand-kit', title: 'Handoff: files and usage guide', documentType: 'handoff', url: 'https://example.com/brightwave/handoff', uploadedBy: DEMO_LOGIN, uploadedAtIso: when(at(-13)) });
  await repo.createProjectNote(brand, { id: 'brand-thanks', projectRequestId: brand, author: DEMO_LOGIN, visibility: 'client', body: 'Thank you, Sofia. Every source file is in the handoff folder.', createdAtIso: when(at(-13)) });
  await repo.createProjectInvoice(brand, { id: 'brand-final', projectRequestId: brand, deliverableId: 'brand-kit', invoiceNumber: 'CS-2026-036', amountCents: 520_000, currency: 'EUR', issuedAtIso: when(at(-13)), dueAtIso: at(1) });
  await repo.markProjectInvoicePaid(brand, 'brand-final', when(at(-7)));
  await transition(brand, 'delivered', at(-12));

  // 7. Cancelled: records kept, read-only.
  const loyalty = 'loyalty-prototype';
  await repo.createProjectRequest({ id: loyalty, clientId: 'kestrel-freight', title: 'Driver loyalty app prototype', brief: 'Points for on-time deliveries, redeemable for fuel vouchers.', priority: 'low', createdAtIso: when(at(-48)) });
  await repo.estimateProjectRequest(loyalty, { amountCents: 600_000, currency: 'USD', estimatedAtIso: when(at(-46)) });
  await repo.createProjectNote(loyalty, { id: 'loyalty-why', projectRequestId: loyalty, author: DEMO_LOGIN, visibility: 'internal', body: 'Client paused all new initiatives until the tracking dashboard ships.', createdAtIso: when(at(-44)) });
  await transition(loyalty, 'cancelled', at(-44));

  // 8. Delivered, then archived, for a client that has since been archived.
  const campaign = 'summer-microsite';
  await repo.createProjectRequest({ id: campaign, clientId: 'juniper-house', title: 'Summer campaign microsite', brief: 'A one-page site for the summer offer with a booking link.', priority: 'medium', createdAtIso: when(at(-59)) });
  await repo.estimateProjectRequest(campaign, { amountCents: 180_000, currency: 'EUR', estimatedAtIso: when(at(-58)) });
  await repo.approveProjectRequest(campaign, { approvedBy: 'Lena Fischer', approvedAtIso: when(at(-58, 4)) });
  await transition(campaign, 'in_progress', at(-57));
  await repo.createProjectDeliverable(campaign, { id: 'campaign-site', projectRequestId: campaign, title: 'Microsite', artifactUrl: 'https://example.com/juniper-house/summer', submittedAtIso: when(at(-50)) });
  await repo.acceptProjectDeliverable(campaign, 'campaign-site', when(at(-49)));
  await repo.createProjectInvoice(campaign, { id: 'campaign-invoice', projectRequestId: campaign, deliverableId: 'campaign-site', invoiceNumber: 'CS-2026-029', amountCents: 180_000, currency: 'EUR', issuedAtIso: when(at(-49)), dueAtIso: at(-35) });
  await repo.markProjectInvoicePaid(campaign, 'campaign-invoice', when(at(-40)));
  await transition(campaign, 'delivered', at(-48));
  await transition(campaign, 'archived', at(-30));
  const juniper = await repo.getClient('juniper-house');
  await repo.archiveClient('juniper-house', juniper!.revision ?? 1);
}
