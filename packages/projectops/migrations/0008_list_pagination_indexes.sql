-- Indexes matching the keyset sort orders of the paginated client and project lists.
-- Measured on 50,000 rows each (PostgreSQL 16): first page 46 ms -> 0.05 ms (clients) and
-- 25 ms -> 0.04 ms (projects); a page deep in the list 39 ms -> 0.1 ms. Without them every
-- page sorts the whole table.
--
-- Migrations run in a transaction, so CONCURRENTLY is unavailable: building these briefly blocks
-- writes to each table. That is acceptable at this application's single-operator scale; a large
-- multi-tenant table would need the index built CONCURRENTLY outside the migration transaction.
CREATE INDEX projectops_clients_created_id_idx
  ON projectops_clients (created_at DESC, id ASC);

CREATE INDEX projectops_project_requests_updated_created_id_idx
  ON projectops_project_requests (updated_at DESC, created_at DESC, id ASC);
