// The workspace's record sections, in page order. Shared with the browser journeys, which walk
// the section navigation and expect each section's records under #records-<path>.
export const projectSections = [
  { path: 'milestones', label: 'Milestones' },
  { path: 'tasks', label: 'Tasks' },
  { path: 'work-logs', label: 'Work logs' },
  { path: 'notes', label: 'Notes' },
  { path: 'documents', label: 'Documents' },
  { path: 'issues', label: 'Issues' },
  { path: 'risks', label: 'Risks' },
  { path: 'deliverables', label: 'Deliverables' },
  { path: 'feedback', label: 'Feedback' },
  { path: 'invoices', label: 'Invoices' },
  { path: 'expenses', label: 'Expenses' },
  { path: 'change-requests', label: 'Change requests' },
  { path: 'activities', label: 'History' },
] as const;

export type CollectionPath = typeof projectSections[number]['path'];
