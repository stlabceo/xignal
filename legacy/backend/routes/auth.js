const express = require('express');
const jwtUtil = require('../util/jwt.util');
const authService = require('../auth-service');

const router = express.Router();

const sendResult = (res, result) => {
  const status = result?.status || (result?.ok ? 200 : 400);
  return res.status(status).json(result);
};

const verifyBearerToken = (req) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
  if (!token || token === 'null') {
    return { ok: false };
  }
  const verified = jwtUtil.verify(token);
  return verified?.type ? { ok: true, userId: verified.userId } : { ok: false };
};

router.get('/schema-state', async (req, res) => {
  try {
    return res.json({
      ok: true,
      schema: await authService.getAuthSchemaState(),
    });
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_SCHEMA_STATE_FAILED',
      messageKo: '인증 스키마 상태를 확인하지 못했습니다.',
    });
  }
});

router.post('/register', async (req, res) => {
  try {
    const result = await authService.registerLocalUser(req.body || {});
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_REGISTER_FAILED',
      messageKo: '회원가입 처리 중 오류가 발생했습니다.',
    });
  }
});

router.get('/verify-email', async (req, res) => {
  try {
    const result = await authService.verifyEmailToken(req.query.token);
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_EMAIL_VERIFY_FAILED',
      messageKo: '이메일 인증 처리 중 오류가 발생했습니다.',
    });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const result = await authService.resendVerification(req.body || {});
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_RESEND_FAILED',
      messageKo: '인증 메일 재발송 중 오류가 발생했습니다.',
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const result = await authService.loginLocalUser(req.body || {});
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_LOGIN_FAILED',
      messageKo: '로그인 처리 중 오류가 발생했습니다.',
    });
  }
});

router.post('/google', async (req, res) => {
  try {
    const result = await authService.loginGoogleUser(req.body || {});
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_GOOGLE_FAILED',
      messageKo: 'Google 로그인 처리 중 오류가 발생했습니다.',
    });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = verifyBearerToken(req);
    if (!token.ok) {
      return sendResult(res, {
        ok: false,
        status: 401,
        code: 'AUTH_REQUIRED',
        messageKo: '로그인이 필요합니다.',
      });
    }
    const result = await authService.getMe(token.userId);
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_ME_FAILED',
      messageKo: '로그인 상태를 확인하지 못했습니다.',
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = verifyBearerToken(req);
    const result = await authService.logout(token.ok ? token.userId : null);
    return sendResult(res, result);
  } catch (error) {
    return sendResult(res, {
      ok: false,
      status: 500,
      code: 'AUTH_LOGOUT_FAILED',
      messageKo: '로그아웃 처리 중 오류가 발생했습니다.',
    });
  }
});

module.exports = router;
