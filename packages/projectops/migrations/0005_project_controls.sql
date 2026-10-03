ALTER TABLE projectops_project_requests DROP CONSTRAINT projectops_project_requests_status_check;
ALTER TABLE projectops_project_requests ADD CONSTRAINT projectops_project_requests_status_check
  CHECK (status IN ('new','estimated','approved','in_progress','on_hold','cancelled','delivered','archived'));
