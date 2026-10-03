# ProjectOps locked roadmap

Approved by the Project Manager on 2026-10-03. This is the reconstructed, approved map, not a recovered copy of the deleted chat. No V1/V2 split.

## Goal
Run client projects from intake through planning, execution, delivery and payment in one reliable application built on URUK. Reuse the existing product implementation and keep URUK untouched.

## Ordered vertical slices
| Order | Slice | Completion result |
| --- | --- | --- |
| 1 | Lock map and checkpoint | Repository records scope, completed slices, remaining work and next action. |
| 2 | Durable application runtime | PostgreSQL migrations and startup work; records survive restarts. |
| 3 | Operator access and settings | Login/logout, protected pages/APIs, credential management and application defaults. |
| 4 | Client management | Browser create/view/edit/archive/search, with projects listed per client. |
| 5 | Project workspace and editing | Project detail page connects all sections; briefs, budgets, priorities and deadlines can be updated. |
| 6 | Estimates and project controls | Estimate/approve/start/hold/resume/cancel/deliver/archive through enforced transitions. |
| 7 | Planning | Create/edit/reschedule/complete/reopen tasks and milestones. |
| 8 | Execution workspace | Manage work logs, notes, document links, issues and risks through the browser. |
| 9 | Delivery and acceptance | Submit deliverables, handle feedback, record acceptance and enforce completion rules. |
| 10 | Finances | Manage invoices/payments/expenses; accurate totals separately by currency. |
| 11 | Automatic history | Successful actions record events with actor and timestamp; project timeline displays them. |
| 12 | Operational dashboard | Search/filter projects; surface overdue work, upcoming deadlines and outstanding invoices. |
| 13 | Export and handoff | Export project information and generate a delivery summary. |
| 14 | Final acceptance and deployment | Complete a real project journey, verify backup/restore, deploy and check the deployed application. |

## Completion gate for every slice
- Browser actions and useful error states where the slice has a user interface.
- API validation and access checks appropriate to the operation.
- Real database behavior for persistence changes.
- Meaningful tests for business rules and failure cases.
- Updated status with commands, results, limitations and commit evidence.
- Passing canonical verification; no claim of production readiness based only on memory tests.

## Confirmed defects assigned to slices
- Migration upgrades and real connection/startup: slice 2.
- Generic status endpoint bypassing estimate/approval metadata: slice 6.
- Read-then-write commands without concurrent state checks: slices 6-10, beginning in slice 6.
- Aggregating multiple currencies and displaying them as USD: slice 10.
- Missing automatic workflow activity: slice 11.

## Finish gate
Run a project from client creation through planning, changes, delivery, expenses and payment. Verify editing, overdue work, cancellation, history, export and persistence after restart. Verify backup/restore and the deployed application.

## Scope control
Do not invent additional feature categories or change this map silently. Record any Project Manager-approved change here. This roadmap does not authorize guessing account models or external service credentials. Payments are recorded; document functionality currently stores links.
