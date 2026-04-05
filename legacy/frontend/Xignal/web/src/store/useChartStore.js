import { create } from 'zustand';

export const useChartStore = create((set) => ({
	symbol: 'BTCUSDT.P',
	bunbong: '4Hour',
	trafficLights: 'y',

	setSymbol: (symbol) => set({ symbol }),
	setBunbong: (bunbong) => set({ bunbong }),
	setTrafficLights: (trafficLights) => set({ trafficLights })
}));
