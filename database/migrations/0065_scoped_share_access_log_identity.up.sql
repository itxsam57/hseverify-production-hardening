ALTER TABLE scoped_share_access_logs
  ADD COLUMN access_log_id bigserial;

ALTER TABLE scoped_share_access_logs
  ADD CONSTRAINT scoped_share_access_logs_pkey PRIMARY KEY (access_log_id);
