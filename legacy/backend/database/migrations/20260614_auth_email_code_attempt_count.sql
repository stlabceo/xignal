-- QUANTU auth email-code verification attempt counter.
-- Auth table only. Do not run against trading, order, ledger, snapshot, reservation, or Grid tables.

ALTER TABLE auth_email_verification_tokens
  ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER used_at;
