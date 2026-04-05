import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useNotifyStore = create(
	persist(
		(set) => ({
			isNewMsg: false,
			markNewMsg: () => set({ isNewMsg: true }),
			clearNewMsg: () => set({ isNewMsg: false })
		}),
		{
			name: 'notify-storage'
		}
	)
);
