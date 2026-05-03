import { useEffect } from 'react';
import { getSocket } from '../services/socket';
import { SOCKET_EVENTS } from '../services/socketEvents';
import { useLiveStore } from '../store/liveStore';
import { useNotifyStore } from '../store/notifyStore';
import { useErrorStore } from '../store/errorStore';
import { getSessionToken, resolveSessionKind } from '../utils/sessionAuth';

export const useSocket = () => {
	const sessionKind = resolveSessionKind();
	const token = getSessionToken(sessionKind);
	const isAdminRoute = sessionKind === 'admin';
	const markLivePriceSignal = useLiveStore((s) => s.markLivePriceSignal);
	const markNewMsg = useNotifyStore((s) => s.markNewMsg);
	const markErrorMsg = useErrorStore((s) => s.markErrorMsg);

	useEffect(() => {
		if (isAdminRoute || !token) return undefined;
		const socket = getSocket(token);

		socket.connect();

		const handleUserUpdated = (data) => {
			if (data?.type === 'live-price') {
				markLivePriceSignal();
			}

			if (data?.type === 'live-error') {
				markNewMsg();
				markErrorMsg();
			}
		};

		socket.on(SOCKET_EVENTS.USER_UPDATED, handleUserUpdated);

		return () => {
			socket.off(SOCKET_EVENTS.USER_UPDATED, handleUserUpdated);
			socket.disconnect();
		};
	}, [isAdminRoute, token, markErrorMsg, markLivePriceSignal, markNewMsg]);
};
