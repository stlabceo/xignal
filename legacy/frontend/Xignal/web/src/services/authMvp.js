import api from '../api';
import { clearSessionAuth, persistSessionAuth } from '../utils/sessionAuth';

const normalizeAuthError = (error, fallbackMessage) => {
	const payload = error?.response?.data || error?.payload || error;
	return {
		ok: false,
		code: payload?.code || 'AUTH_REQUEST_FAILED',
		messageKo: payload?.messageKo || fallbackMessage
	};
};

const persistTokenFromResponse = (payload) => {
	const token = payload?.token;
	if (!token?.accessToken || !token?.refreshToken) {
		return false;
	}
	persistSessionAuth({
		accessToken: token.accessToken,
		refreshToken: token.refreshToken,
		adminSession: false
	});
	return true;
};

export const authMvp = {
	async register(body) {
		try {
			return await api.post('/api/auth/register', body);
		} catch (error) {
			return normalizeAuthError(error, '회원가입 처리 중 오류가 발생했습니다.');
		}
	},
	async resendVerification(body) {
		try {
			return await api.post('/api/auth/resend-verification', body);
		} catch (error) {
			return normalizeAuthError(error, '인증 메일 재발송 중 오류가 발생했습니다.');
		}
	},
	async verifyEmailCode(body) {
		try {
			return await api.post('/api/auth/verify-email-code', body);
		} catch (error) {
			return normalizeAuthError(error, '인증번호를 확인해 주세요.');
		}
	},
	async resendVerificationCode(body) {
		try {
			return await api.post('/api/auth/resend-verification-code', body);
		} catch (error) {
			return normalizeAuthError(error, '인증번호 다시 보내기 중 오류가 발생했습니다.');
		}
	},
	async login(body) {
		try {
			const payload = await api.post('/api/auth/login', body);
			if (payload?.ok) {
				persistTokenFromResponse(payload);
			}
			return payload;
		} catch (error) {
			return normalizeAuthError(error, 'ID 또는 비밀번호를 확인해 주세요.');
		}
	},
	async loginGoogle(credential) {
		try {
			const payload = await api.post('/api/auth/google', { credential });
			if (payload?.ok) {
				persistTokenFromResponse(payload);
			}
			return payload;
		} catch (error) {
			return normalizeAuthError(error, 'Google 로그인 처리 중 오류가 발생했습니다.');
		}
	},
	async me() {
		try {
			return await api.get('/api/auth/me');
		} catch (error) {
			return normalizeAuthError(error, '로그인 상태를 확인하지 못했습니다.');
		}
	},
	async logout() {
		try {
			const payload = await api.post('/api/auth/logout', {});
			clearSessionAuth('user');
			return payload;
		} catch (error) {
			clearSessionAuth('user');
			return normalizeAuthError(error, '로그아웃 처리 중 오류가 발생했습니다.');
		}
	}
};
