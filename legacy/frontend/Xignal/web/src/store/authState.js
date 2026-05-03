import { create } from 'zustand';
import { getSessionSnapshot } from '../utils/sessionAuth';

const initialSession = getSessionSnapshot();

export const useAuthStore = create((set) => ({
	isLoggedIn: initialSession.isLoggedIn,
	isAdminSession: initialSession.isAdminSession,
	userInfo: {
		loginId: null,
		username: null,
		grade: null
	},
	userPrice: {
		livePrice: 0,
		paperPrice: 0
	},
	setIsLoggedIn: (data) => set({ isLoggedIn: data }),
	setIsAdminSession: (data) => set({ isAdminSession: Boolean(data) }),
	setUserInfo: (data) => set({ userInfo: data }),
	setUserPrice: (data) => set({ userPrice: data }),
	hydrateSessionState: (kind) => {
		const session = getSessionSnapshot(kind);
		set({
			isLoggedIn: session.isLoggedIn,
			isAdminSession: session.isAdminSession
		});
	}
}));
