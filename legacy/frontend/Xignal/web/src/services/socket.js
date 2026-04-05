import { io } from 'socket.io-client';

let socket;

export const getSocket = (token) => {
	if (!socket || !socket.connected) {
		socket = io(import.meta.env.VITE_API_URL, {
			auth: { token },
			transports: ['websocket'],
			autoConnect: false
		});
	}
	return socket;
};
