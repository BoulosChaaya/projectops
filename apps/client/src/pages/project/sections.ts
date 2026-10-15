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

/**
 * The workspace's tabs and the record sections each one shows. History is not a tab: it is the
 * activity rail beside every tab, so each action's record appears where the action was taken.
 */
export const workspaceTabs = [
  { id: 'overview', label: 'Overview', sections: [] },
  { id: 'plan', label: 'Plan', sections: ['milestones', 'tasks'] },
  { id: 'work', label: 'Work', sections: ['work-logs', 'notes', 'documents', 'issues', 'risks'] },
  { id: 'delivery', label: 'Delivery', sections: ['deliverables', 'feedback'] },
  { id: 'money', label: 'Money', sections: ['invoices', 'expenses', 'change-requests'] },
] as const satisfies readonly { id: string; label: string; sections: readonly CollectionPath[] }[];

export type WorkspaceTab = typeof workspaceTabs[number]['id'];

/** The tab that shows a section (history is beside every tab, so it maps to the default tab). */
export function tabForSection(path: string): WorkspaceTab {
  return workspaceTabs.find(tab => (tab.sections as readonly string[]).includes(path))?.id ?? 'overview';
}

/**
 * The tab named in the address (?tab=plan); without one, the tab of a section in the hash, so a
 * link to /projects/:id#tasks still lands on the tasks.
 */
export function tabFromLocation(search: string, hash: string): WorkspaceTab {
  const value = new URLSearchParams(search).get('tab');
  const named = workspaceTabs.find(tab => tab.id === value)?.id;
  return named ?? tabForSection(hash.replace(/^#/, ''));
}
