const crypto = require('crypto');
const jwt = require('./util/jwt.util');
const redisClient = require('./util/redis.util');
const db = require('./database/connect/config');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const DEFAULT_GOOGLE_CLIENT_ID =
  '318325527196-1h1d65s069ot50qrr3b6mled1a6gtpks.apps.googleusercontent.com';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const hashSha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const makeToken = () => crypto.randomBytes(32).toString('base64url');
const makeEmailCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const normalizeEmailCode = (value) => String(value || '').trim();
const hashEmailCode = (userId, code) => hashSha256(`${userId}:${normalizeEmailCode(code)}`);

const publicUser = (row = {}) => ({
  id: String(row.id),
  email: row.email || null,
  emailVerified: Boolean(Number(row.email_verified || 0)),
  authProvider: row.auth_provider || 'local',
});

const errorResult = (status, code, messageKo, extra = {}) => ({
  ok: false,
  status,
  code,
  messageKo,
  ...extra,
});

const validateEmailPasswordInput = ({ email, password } = {}) => {
  const normalizedEmail = normalizeEmail(email);

  if (!EMAIL_RE.test(normalizedEmail)) {
    return errorResult(400, 'INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
  }

  if (String(password || '').length < 8) {
    return errorResult(400, 'INVALID_PASSWORD', '비밀번호는 8자 이상이어야 합니다.');
  }

  return {
    ok: true,
    email: normalizedEmail,
    password: String(password),
  };
};

const getAuthSchemaState = async () => {
  const [columns] = await db.query(
    `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'admin_member'`
  );
  const columnMap = new Map(columns.map((row) => [row.COLUMN_NAME, row]));
  const [tables] = await db.query(
    `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'auth_email_verification_tokens'`
  );
  const [verificationColumns] = await db.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'auth_email_verification_tokens'`
  );

  const requiredColumns = ['email_verified', 'auth_provider', 'google_sub', 'status', 'updated_at'];
  const missingColumns = requiredColumns.filter((column) => !columnMap.has(column));
  const verificationColumnSet = new Set(verificationColumns.map((row) => row.COLUMN_NAME));
  const missingVerificationColumns = ['attempt_count'].filter((column) => !verificationColumnSet.has(column));
  const memIdLength = Number(columnMap.get('mem_id')?.CHARACTER_MAXIMUM_LENGTH || 0);
  const emailLength = Number(columnMap.get('email')?.CHARACTER_MAXIMUM_LENGTH || 0);
  const passwordLength = Number(columnMap.get('password')?.CHARACTER_MAXIMUM_LENGTH || 0);
  const hasVerificationTable = tables.length > 0;
  const lengthReady = memIdLength >= 254 && emailLength >= 254 && passwordLength >= 255;

  return {
    ready: missingColumns.length === 0 && hasVerificationTable && missingVerificationColumns.length === 0 && lengthReady,
    missingColumns,
    missingVerificationColumns,
    hasVerificationTable,
    lengths: {
      memId: memIdLength,
      email: emailLength,
      password: passwordLength,
      ready: lengthReady,
    },
  };
};

const requireAuthSchemaReady = async () => {
  const schema = await getAuthSchemaState();
  if (!schema.ready) {
    return errorResult(503, 'AUTH_SCHEMA_NOT_READY', '이메일 인증 스키마 적용이 필요합니다.', {
      schema,
    });
  }
  return { ok: true, schema };
};

const findMemberByEmail = async (email) => {
  const normalized = normalizeEmail(email);
  const [rows] = await db.query(
    `SELECT *
       FROM admin_member
      WHERE LOWER(email) = ?
      LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
};

const createSessionForUser = async (userId) => {
  const accessToken = jwt.sign(String(userId));
  const refreshToken = jwt.refresh();
  await redisClient.set(String(userId), refreshToken);
  return {
    accessToken,
    refreshToken,
  };
};

const createVerificationToken = async (connection, userId) => {
  const rawToken = makeToken();
  const tokenHash = hashSha256(rawToken);
  await connection.query(
    `INSERT INTO auth_email_verification_tokens
       (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 60 MINUTE))`,
    [userId, tokenHash]
  );
  return rawToken;
};

const createVerificationCode = async (connection, userId) => {
  const code = makeEmailCode();
  const codeHash = hashEmailCode(userId, code);

  await connection.query(
    `UPDATE auth_email_verification_tokens
        SET used_at = NOW()
      WHERE user_id = ?
        AND used_at IS NULL`,
    [userId]
  );
  await connection.query(
    `INSERT INTO auth_email_verification_tokens
       (user_id, token_hash, expires_at, attempt_count)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0)`,
    [userId, codeHash]
  );

  return code;
};

const buildVerifyUrl = (token) => {
  const apiBaseUrl = String(process.env.API_BASE_URL || 'http://localhost:3079').replace(/\/+$/, '');
  return `${apiBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
};

const exposeDevVerificationUrl = () =>
  process.env.AUTH_DEV_EXPOSE_VERIFICATION_LINK === '1' &&
  !['production', 'prod'].includes(String(process.env.NODE_ENV || '').toLowerCase());

const exposeDevEmailCode = () =>
  process.env.AUTH_DEV_EXPOSE_EMAIL_CODE === '1' &&
  !['production', 'prod'].includes(String(process.env.NODE_ENV || '').toLowerCase());

const sendVerificationEmail = async ({ email, token }) => {
  const verifyUrl = buildVerifyUrl(token);

  if (String(process.env.MAIL_PROVIDER || '').toLowerCase() !== 'resend') {
    return { sent: false, skipped: true, reason: 'MAIL_PROVIDER_NOT_RESEND', verifyUrl };
  }

  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: true, reason: 'RESEND_API_KEY_MISSING', verifyUrl };
  }

  const from = process.env.MAIL_FROM || 'no-reply@quantu.co.kr';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'QUANTU 이메일 인증',
      html: [
        '<h1>QUANTU 이메일 인증</h1>',
        '<p>아래 버튼을 눌러 이메일 인증을 완료하세요.</p>',
        `<p><a href="${verifyUrl}">이메일 인증하기</a></p>`,
        '<p>이 요청을 본인이 하지 않았다면 무시하세요.</p>',
      ].join(''),
    }),
  });

  if (!response.ok) {
    return { sent: false, skipped: false, reason: `RESEND_HTTP_${response.status}`, verifyUrl };
  }

  return { sent: true, skipped: false, reason: null, verifyUrl };
};

const sendVerificationCodeEmail = async ({ email, code }) => {
  if (String(process.env.MAIL_PROVIDER || '').toLowerCase() !== 'resend') {
    return { sent: false, skipped: true, reason: 'MAIL_PROVIDER_NOT_RESEND' };
  }

  if (!process.env.RESEND_API_KEY) {
    return { sent: false, skipped: true, reason: 'RESEND_API_KEY_MISSING' };
  }

  const from = process.env.MAIL_FROM || 'no-reply@quantu.co.kr';
  const html = [
    '<h1>QUANTU 이메일 인증</h1>',
    '<p>아래 인증번호를 입력해 이메일 인증을 완료하세요.</p>',
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p>`,
    '<p>이 인증번호는 10분 후 만료됩니다.</p>',
    '<p>본인이 요청하지 않았다면 이 메일을 무시하세요.</p>',
  ].join('');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'QUANTU 이메일 인증번호',
      html,
      text: [
        'QUANTU 이메일 인증',
        '',
        '아래 인증번호를 입력해 이메일 인증을 완료하세요.',
        '',
        `인증번호: ${code}`,
        '',
        '이 인증번호는 10분 후 만료됩니다.',
        '본인이 요청하지 않았다면 이 메일을 무시하세요.',
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    return { sent: false, skipped: false, reason: `RESEND_HTTP_${response.status}` };
  }

  return { sent: true, skipped: false, reason: null };
};

const registerLocalUser = async (input = {}) => {
  const validation = validateEmailPasswordInput(input);
  if (!validation.ok) return validation;

  const schema = await requireAuthSchemaReady();
  if (!schema.ok) return schema;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [duplicates] = await connection.query(
      `SELECT id, email
         FROM admin_member
        WHERE LOWER(email) = ?
        LIMIT 1`,
      [validation.email]
    );

    if (duplicates.length > 0) {
      await connection.rollback();
      return errorResult(409, 'EMAIL_EXISTS', '이미 사용 중인 이메일입니다.');
    }

    const passwordHash = hashSha256(validation.password);
    const [result] = await connection.query(
      `INSERT INTO admin_member
         (mem_id, mem_name, mem_mobile, password, email, grade,
          email_verified, auth_provider, status)
       VALUES (?, ?, ?, ?, ?, 1, 0, 'local', 'PENDING_EMAIL')`,
      [validation.email, validation.email, '00000000000', passwordHash, validation.email]
    );
    const userId = result.insertId;
    const code = await createVerificationCode(connection, userId);
    await connection.commit();

    const emailResult = await sendVerificationCodeEmail({
      email: validation.email,
      code,
    });

    const emailPayload = {
      sent: Boolean(emailResult.sent),
      skipped: Boolean(emailResult.skipped),
      reason: emailResult.reason,
    };
    if (exposeDevEmailCode()) {
      emailPayload.devCode = code;
    }

    return {
      ok: true,
      requiresEmailVerification: true,
      email: validation.email,
      user: {
        id: String(userId),
        email: validation.email,
        emailVerified: false,
        authProvider: 'local',
      },
      emailDelivery: emailPayload,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const verifyEmailToken = async (token) => {
  const schema = await requireAuthSchemaReady();
  if (!schema.ok) return schema;

  const tokenHash = hashSha256(String(token || ''));
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, user_id
         FROM auth_email_verification_tokens
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return errorResult(400, 'INVALID_OR_EXPIRED_TOKEN', '인증 링크가 만료되었거나 유효하지 않습니다.');
    }

    const row = rows[0];
    await connection.query(`UPDATE auth_email_verification_tokens SET used_at = NOW() WHERE id = ?`, [row.id]);
    await connection.query(
      `UPDATE admin_member
          SET email_verified = 1,
              status = 'ACTIVE'
        WHERE id = ?`,
      [row.user_id]
    );
    await connection.commit();
    return { ok: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const verifyEmailCode = async ({ email, code } = {}) => {
  const schema = await requireAuthSchemaReady();
  if (!schema.ok) return schema;

  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeEmailCode(code);

  if (!EMAIL_RE.test(normalizedEmail) || !/^\d{6}$/.test(normalizedCode)) {
    return errorResult(400, 'INVALID_CODE', '인증번호를 확인해 주세요.');
  }

  const member = await findMemberByEmail(normalizedEmail);
  if (!member) {
    return errorResult(400, 'INVALID_CODE', '인증번호를 확인해 주세요.');
  }

  if (Number(member.email_verified || 0) === 1) {
    return errorResult(409, 'EMAIL_ALREADY_VERIFIED', '이미 인증된 이메일입니다.');
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, user_id, token_hash, expires_at, attempt_count
         FROM auth_email_verification_tokens
        WHERE user_id = ?
          AND used_at IS NULL
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE`,
      [member.id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return errorResult(400, 'INVALID_CODE', '인증번호를 확인해 주세요.');
    }

    const tokenRow = rows[0];
    if (Number(tokenRow.attempt_count || 0) >= 5) {
      await connection.rollback();
      return errorResult(429, 'TOO_MANY_ATTEMPTS', '인증번호 입력 횟수가 초과되었습니다. 다시 보내기를 이용해 주세요.');
    }

    const [timeRows] = await connection.query(`SELECT NOW() AS nowTime`);
    const nowTime = new Date(timeRows[0].nowTime).getTime();
    const expiresAt = new Date(tokenRow.expires_at).getTime();
    if (expiresAt <= nowTime) {
      await connection.rollback();
      return errorResult(400, 'EXPIRED_CODE', '인증번호가 만료되었습니다. 다시 보내기를 이용해 주세요.');
    }

    const expectedHash = hashEmailCode(member.id, normalizedCode);
    if (tokenRow.token_hash !== expectedHash) {
      const nextAttempt = Number(tokenRow.attempt_count || 0) + 1;
      await connection.query(
        `UPDATE auth_email_verification_tokens
            SET attempt_count = ?
          WHERE id = ?`,
        [nextAttempt, tokenRow.id]
      );
      await connection.commit();
      if (nextAttempt >= 5) {
        return errorResult(429, 'TOO_MANY_ATTEMPTS', '인증번호 입력 횟수가 초과되었습니다. 다시 보내기를 이용해 주세요.');
      }
      return errorResult(400, 'INVALID_CODE', '인증번호를 확인해 주세요.');
    }

    await connection.query(`UPDATE auth_email_verification_tokens SET used_at = NOW() WHERE id = ?`, [tokenRow.id]);
    await connection.query(
      `UPDATE admin_member
          SET email_verified = 1,
              status = 'ACTIVE'
        WHERE id = ?`,
      [member.id]
    );
    await connection.commit();
    return {
      ok: true,
      email: normalizedEmail,
      emailVerified: true,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const resendVerification = async ({ email } = {}) => {
  return resendVerificationCode({ email });
};

const resendVerificationCode = async ({ email } = {}) => {
  const schema = await requireAuthSchemaReady();
  if (!schema.ok) return schema;

  const member = await findMemberByEmail(email);
  if (!member) {
    return errorResult(404, 'MEMBER_NOT_FOUND', '계정을 찾을 수 없습니다.');
  }

  if (Number(member.email_verified || 0) === 1) {
    return errorResult(409, 'EMAIL_ALREADY_VERIFIED', '이미 인증된 이메일입니다.');
  }

  const [recent] = await db.query(
    `SELECT id
       FROM auth_email_verification_tokens
      WHERE user_id = ?
        AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
      LIMIT 1`,
    [member.id]
  );

  if (recent.length > 0) {
    return errorResult(429, 'RESEND_RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const code = await createVerificationCode(connection, member.id);
    await connection.commit();
    const emailResult = await sendVerificationCodeEmail({ email: normalizeEmail(member.email), code });
    const emailPayload = {
      sent: Boolean(emailResult.sent),
      skipped: Boolean(emailResult.skipped),
      reason: emailResult.reason,
    };
    if (exposeDevEmailCode()) {
      emailPayload.devCode = code;
    }
    return {
      ok: true,
      emailDelivery: emailPayload,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const loginLocalUser = async ({ email, password } = {}) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    return errorResult(400, 'INVALID_LOGIN_REQUEST', '이메일과 비밀번호를 입력해 주세요.');
  }

  if (!EMAIL_RE.test(normalizedEmail)) {
    return errorResult(400, 'INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
  }

  const member = await findMemberByEmail(normalizedEmail);
  const passwordHash = hashSha256(String(password));
  if (!member || member.password !== passwordHash) {
    return errorResult(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호를 확인해 주세요.');
  }

  if (member.status && !['ACTIVE', 'PENDING_EMAIL'].includes(member.status)) {
    return errorResult(403, 'ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
  }

  if (Number(member.email_verified || 0) !== 1) {
    return errorResult(403, 'EMAIL_NOT_VERIFIED', '이메일 인증을 완료해 주세요.');
  }

  const token = await createSessionForUser(member.id);
  return {
    ok: true,
    user: publicUser(member),
    token,
  };
};

const verifyGoogleIdToken = async (credential) => {
  if (!credential) {
    return errorResult(400, 'GOOGLE_CREDENTIAL_REQUIRED', 'Google 인증 정보가 필요합니다.');
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
  const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`;
  const response = await fetch(url);
  if (!response.ok) {
    return errorResult(401, 'GOOGLE_TOKEN_INVALID', 'Google 인증에 실패했습니다.');
  }
  const token = await response.json();
  const validIssuer = token.iss === 'https://accounts.google.com' || token.iss === 'accounts.google.com';

  if (token.aud !== googleClientId || !validIssuer || !token.sub || !token.email || token.email_verified !== 'true') {
    return errorResult(401, 'GOOGLE_TOKEN_REJECTED', 'Google 인증 정보가 유효하지 않습니다.');
  }

  return {
    ok: true,
    googleSub: String(token.sub),
    email: normalizeEmail(token.email),
  };
};

const loginGoogleUser = async ({ credential } = {}) => {
  const schema = await requireAuthSchemaReady();
  if (!schema.ok) return schema;

  const verified = await verifyGoogleIdToken(credential);
  if (!verified.ok) return verified;

  const [existingBySub] = await db.query(
    `SELECT *
       FROM admin_member
      WHERE google_sub = ?
      LIMIT 1`,
    [verified.googleSub]
  );

  let member = existingBySub[0] || null;
  if (!member) {
    const [existingByEmail] = await db.query(
      `SELECT *
         FROM admin_member
        WHERE LOWER(email) = ?
        LIMIT 1`,
      [verified.email]
    );

    if (existingByEmail.length > 0) {
      return errorResult(409, 'GOOGLE_EMAIL_CONFLICT', '동일 이메일의 기존 계정이 있습니다. 먼저 이메일 로그인을 사용해 주세요.');
    }

    const [result] = await db.query(
      `INSERT INTO admin_member
         (mem_id, mem_name, mem_mobile, password, email, grade,
          email_verified, auth_provider, google_sub, status)
       VALUES (?, ?, ?, NULL, ?, 1, 1, 'google', ?, 'ACTIVE')`,
      [verified.email, verified.email, '00000000000', verified.email, verified.googleSub]
    );
    member = {
      id: result.insertId,
      mem_id: verified.email,
      email: verified.email,
      email_verified: 1,
      auth_provider: 'google',
      google_sub: verified.googleSub,
      status: 'ACTIVE',
    };
  }

  const token = await createSessionForUser(member.id);
  return {
    ok: true,
    user: publicUser(member),
    token,
  };
};

const getMe = async (userId) => {
  const [rows] = await db.query(
    `SELECT *
       FROM admin_member
      WHERE id = ?
      LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) {
    return errorResult(404, 'MEMBER_NOT_FOUND', '계정을 찾을 수 없습니다.');
  }
  return {
    ok: true,
    user: publicUser(rows[0]),
  };
};

const logout = async (userId) => {
  if (userId) {
    await redisClient.del(String(userId));
  }
  return { ok: true };
};

module.exports = {
  DEFAULT_GOOGLE_CLIENT_ID,
  getAuthSchemaState,
  hashSha256,
  loginGoogleUser,
  loginLocalUser,
  logout,
  getMe,
  registerLocalUser,
  resendVerificationCode,
  resendVerification,
  validateEmailPasswordInput,
  verifyEmailCode,
  verifyEmailToken,
};
