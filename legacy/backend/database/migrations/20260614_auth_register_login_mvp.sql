-- QUANTU auth register/login MVP schema proposal.
-- Do not run automatically against an operating DB.
-- Apply only after reviewing existing admin_member email duplicates and rollback plan.

ALTER TABLE admin_member
  MODIFY mem_id VARCHAR(254) NOT NULL,
  MODIFY email VARCHAR(254) NULL,
  MODIFY password VARCHAR(255) NULL,
  ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 1 AFTER email,
  ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'local' AFTER email_verified,
  ADD COLUMN google_sub VARCHAR(128) NULL AFTER auth_provider,
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' AFTER google_sub,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD UNIQUE KEY uq_admin_member_email (email),
  ADD UNIQUE KEY uq_admin_member_google_sub (google_sub);

CREATE TABLE auth_email_verification_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_email_verification_token_hash (token_hash),
  KEY idx_auth_email_verification_user_created (user_id, created_at),
  CONSTRAINT fk_auth_email_verification_user
    FOREIGN KEY (user_id)
    REFERENCES admin_member (id)
    ON DELETE CASCADE
);
