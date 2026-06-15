// DEV_SUPER_LOGIN: local QA only, remove before production release.
const DEV_SUPER_LOGIN_SESSION_KEY = 'xignal.devSuperLogin.enabled';
const DEV_SUPER_LOGIN_FLAG = 'VITE_ENABLE_DEV_SUPER_LOGIN';

const isBrowser = () => typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';

const isLocalHostname = () => {
	if (!isBrowser()) return false;
	const hostname = window.location?.hostname;
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

export const isDevSuperLoginAvailable = () =>
	Boolean(
		import.meta.env.DEV &&
			!import.meta.env.PROD &&
			import.meta.env[DEV_SUPER_LOGIN_FLAG] === 'true' &&
			isLocalHostname()
	);

export const activateDevSuperLogin = () => {
	if (!isDevSuperLoginAvailable() || !isBrowser()) return false;
	sessionStorage.setItem(DEV_SUPER_LOGIN_SESSION_KEY, 'Y');
	return true;
};

export const clearDevSuperLogin = () => {
	if (!isBrowser()) return;
	sessionStorage.removeItem(DEV_SUPER_LOGIN_SESSION_KEY);
};

export const isDevSuperLoginActive = () =>
	Boolean(isDevSuperLoginAvailable() && isBrowser() && sessionStorage.getItem(DEV_SUPER_LOGIN_SESSION_KEY) === 'Y');

export const getDevSuperUser = () => ({
	id: 'dev-super-user',
	email: 'dev-super@local.quantu',
	name: 'DEV SUPER',
	role: 'SUPER_ADMIN',
	isDevSuperLogin: true
});
