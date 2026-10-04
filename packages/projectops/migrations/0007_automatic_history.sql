ALTER TABLE projectops_project_activities
  DROP CONSTRAINT projectops_project_activities_event_type_check;

ALTER TABLE projectops_project_activities
  ADD CONSTRAINT projectops_project_activities_event_type_check CHECK (
    event_type IN (
      'request_created',
      'request_estimated',
      'request_approved',
      'status_changed',
      'milestone_created',
      'milestone_completed',
      'deliverable_submitted',
      'deliverable_accepted',
      'invoice_issued',
      'invoice_paid',
      'note_added',
      'request_edited',
      'milestone_edited',
      'milestone_reopened',
      'task_created',
      'task_edited',
      'task_completed',
      'task_reopened',
      'work_log_added',
      'note_archived',
      'issue_created',
      'issue_resolved',
      'risk_created',
      'risk_mitigated',
      'document_added',
      'document_archived',
      'feedback_added',
      'feedback_addressed',
      'expense_submitted',
      'expense_approved',
      'expense_rejected',
      'operator_annotation'
    )
  );
