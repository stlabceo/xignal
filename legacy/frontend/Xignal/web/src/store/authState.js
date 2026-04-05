import { create } from 'zustand';

export const useAuthStore = create((set) => ({
	isLoggedIn: sessionStorage.getItem('token') || false,
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
	setUserInfo: (data) => set({ userInfo: data }),
	setUserPrice: (data) => set({ userPrice: data })
}));
