import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useErrorStore = create(
	persist(
		(set) => ({
			isErrorMsg: false,
			markErrorMsg: () => set({ isErrorMsg: true }),
			clearErrorMsg: () => set({ isErrorMsg: false })
		}),
		{
			name: 'error-storage'
		}
	)
);
