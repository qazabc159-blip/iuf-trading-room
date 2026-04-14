ALTER TABLE openalice_jobs
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN lease_expires_at TIMESTAMPTZ;

UPDATE openalice_jobs
SET
  last_heartbeat_at = COALESCE(claimed_at, created_at),
  lease_expires_at = CASE
    WHEN status = 'running' AND claimed_at IS NOT NULL
      THEN claimed_at + make_interval(secs => COALESCE(timeout_seconds, 900))
    ELSE lease_expires_at
  END
WHERE claimed_at IS NOT NULL OR status = 'running';

CREATE INDEX openalice_jobs_workspace_status_idx
  ON openalice_jobs(workspace_id, status, created_at);

CREATE INDEX openalice_jobs_lease_expires_idx
  ON openalice_jobs(status, lease_expires_at);
