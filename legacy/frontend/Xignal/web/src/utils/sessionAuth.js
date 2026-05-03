export const SESSION_KINDS = {
	user: 'user',
	admin: 'admin'
};

export const SESSION_KEYS = {
	user: {
		token: 'xignal.user.token',
		refreshToken: 'xignal.user.refreshToken',
		adminSession: 'xignal.user.adminSession'
	},
	admin: {
		token: 'xignal.admin.token',
		refreshToken: 'xignal.admin.refreshToken',
		adminSession: 'xignal.admin.adminSession'
	}
};

const LEGACY_SESSION_KEYS = {
	token: 'token',
	refreshToken: 'refreshToken',
	adminSession: 'xignalAdminSession'
};

const isBrowser = () => typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';

export const resolveSessionKind = (kind = null, pathname = null) => {
	const normalizedKind = String(kind || '')
		.trim()
		.toLowerCase();

	if (normalizedKind === SESSION_KINDS.admin || normalizedKind === SESSION_KINDS.user) {
		return normalizedKind;
	}

	if (!isBrowser()) {
		return SESSION_KINDS.user;
	}

	const currentPath = String(pathname || window.location?.pathname || '').trim().toLowerCase();
	return currentPath.startsWith('/ops-') ? SESSION_KINDS.admin : SESSION_KINDS.user;
};

const getScopedKeys = (kind = null, pathname = null) => SESSION_KEYS[resolveSessionKind(kind, pathname)];

const migrateLegacySessionAuth = () => {
	if (!isBrowser()) {
		return;
	}

	const legacyToken = sessionStorage.getItem(LEGACY_SESSION_KEYS.token);
	const legacyRefreshToken = sessionStorage.getItem(LEGACY_SESSION_KEYS.refreshToken);
	const legacyAdminSession = sessionStorage.getItem(LEGACY_SESSION_KEYS.adminSession);

	if (!legacyToken && !legacyRefreshToken && !legacyAdminSession) {
		return;
	}

	const sessionKind = legacyAdminSession === 'Y' ? SESSION_KINDS.admin : SESSION_KINDS.user;
	const scopedKeys = getScopedKeys(sessionKind);

	if (legacyToken && !sessionStorage.getItem(scopedKeys.token)) {
		sessionStorage.setItem(scopedKeys.token, legacyToken);
	}

	if (legacyRefreshToken && !sessionStorage.getItem(scopedKeys.refreshToken)) {
		sessionStorage.setItem(scopedKeys.refreshToken, legacyRefreshToken);
	}

	if (legacyAdminSession && !sessionStorage.getItem(scopedKeys.adminSession)) {
		sessionStorage.setItem(scopedKeys.adminSession, legacyAdminSession);
	}

	sessionStorage.removeItem(LEGACY_SESSION_KEYS.token);
	sessionStorage.removeItem(LEGACY_SESSION_KEYS.refreshToken);
	sessionStorage.removeItem(LEGACY_SESSION_KEYS.adminSession);
};

const getSessionValue = (kind, key) => {
	if (!isBrowser()) {
		return null;
	}

	migrateLegacySessionAuth();
	return sessionStorage.getItem(getScopedKeys(kind)[key]);
};

export const persistSessionAuth = ({ accessToken, refreshToken, adminSession = false } = {}) => {
	if (!isBrowser()) {
		return;
	}

	const sessionKind = adminSession ? SESSION_KINDS.admin : SESSION_KINDS.user;
	const scopedKeys = getScopedKeys(sessionKind);

	if (accessToken) {
		sessionStorage.setItem(scopedKeys.token, accessToken);
	}

	if (refreshToken) {
		sessionStorage.setItem(scopedKeys.refreshToken, refreshToken);
	}

	sessionStorage.setItem(scopedKeys.adminSession, adminSession ? 'Y' : 'N');
};

export const clearSessionAuth = (kind = null) => {
	if (!isBrowser()) {
		return;
	}

	migrateLegacySessionAuth();
	const scopedKeys = getScopedKeys(kind);
	sessionStorage.removeItem(scopedKeys.token);
	sessionStorage.removeItem(scopedKeys.refreshToken);
	sessionStorage.removeItem(scopedKeys.adminSession);
};

export const clearAllSessionAuth = () => {
	if (!isBrowser()) {
		return;
	}

	Object.values(SESSION_KEYS).forEach((scopedKeys) => {
		sessionStorage.removeItem(scopedKeys.token);
		sessionStorage.removeItem(scopedKeys.refreshToken);
		sessionStorage.removeItem(scopedKeys.adminSession);
	});

	sessionStorage.removeItem(LEGACY_SESSION_KEYS.token);
	sessionStorage.removeItem(LEGACY_SESSION_KEYS.refreshToken);
	sessionStorage.removeItem(LEGACY_SESSION_KEYS.adminSession);
};

export const getSessionToken = (kind = null) => getSessionValue(kind, 'token');

export const getRefreshToken = (kind = null) => getSessionValue(kind, 'refreshToken');

export const isAdminSession = (kind = null) =>
	resolveSessionKind(kind) === SESSION_KINDS.admin && getSessionValue(SESSION_KINDS.admin, 'adminSession') === 'Y';

export const getSessionSnapshot = (kind = null) => {
	const sessionKind = resolveSessionKind(kind);
	const token = getSessionToken(sessionKind);
	return {
		kind: sessionKind,
		token,
		isLoggedIn: Boolean(token),
		isAdminSession: sessionKind === SESSION_KINDS.admin && isAdminSession(sessionKind)
	};
};
