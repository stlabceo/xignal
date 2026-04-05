import { useEffect } from 'react';
import { getSocket } from '../services/socket';
import { SOCKET_EVENTS } from '../services/socketEvents';
import { useLiveStore } from '../store/liveStore';
import { useNotifyStore } from '../store/notifyStore';
import { useErrorStore } from '../store/errorStore';
import { useMessageModal } from './useMessageModal';

export const useSocket = () => {
	const token = sessionStorage.getItem('token');
	const markLivePriceSignal = useLiveStore((s) => s.markLivePriceSignal);
	const markNewMsg = useNotifyStore((s) => s.markNewMsg);
	const markErrorMsg = useErrorStore((s) => s.markErrorMsg);

	useEffect(() => {
		if (!token) return;
		const socket = getSocket(token);

		socket.connect();

		// 연결 확인
		socket.on(SOCKET_EVENTS.CONNECT, () => {
			console.log('소켓 연결 성공');
		});

		socket.on(SOCKET_EVENTS.DATA, (data) => {
			console.log('data 수신:', data);
		});

		socket.on(SOCKET_EVENTS.USER_UPDATED, (data) => {
			console.log('업데이트 알림 수신:', data);
			if (data?.type === 'live-price') {
				// user left money
				markLivePriceSignal();
			}

			if (data?.type === 'live-error') {
				// new message (temp)
				markNewMsg();

				// error msg
				markErrorMsg();
			}
		});

		socket.on(SOCKET_EVENTS.RESPONSE, (msg) => {
			console.log('서버 응답:', msg);
		});

		socket.on(SOCKET_EVENTS.CONNECT_ERROR, (err) => {
			console.error('소켓 연결 실패:', err.message);
		});

		return () => {
			socket.off(SOCKET_EVENTS.CONNECT);
			socket.off(SOCKET_EVENTS.DATA);
			socket.off(SOCKET_EVENTS.USER_UPDATED);
			socket.off(SOCKET_EVENTS.RESPONSE);
			socket.off(SOCKET_EVENTS.CONNECT_ERROR);
			socket.disconnect();
		};
	}, [token, markLivePriceSignal]);
};
