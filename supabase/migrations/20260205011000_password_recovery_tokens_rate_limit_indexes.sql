create index if not exists password_recovery_tokens_email_created_idx
  on password_recovery_tokens (email, created_at);

create index if not exists password_recovery_tokens_ip_created_idx
  on password_recovery_tokens (request_ip, created_at);
