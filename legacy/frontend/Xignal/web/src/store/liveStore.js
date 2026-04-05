import { create } from 'zustand';

export const useLiveStore = create((set) => ({
	isLivePriceSignal: false,
	markLivePriceSignal: () => set({ isLivePriceSignal: true }),
	clearLivePriceSignal: () => set({ isLivePriceSignal: false })
}));
