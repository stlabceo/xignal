import axios from 'axios';
import { useAuthStore } from '../store/authState';
import { clearSessionAuth, getSessionToken } from '../utils/sessionAuth';

const api = axios.create({
	baseURL: import.meta.env.VITE_API_URL,
	headers: {
		Authorization: getSessionToken(),
		'Content-Type': 'application/json'
	}
});

api.interceptors.request.use(
	async (config) => {
		const token = getSessionToken();
		if (token) {
			config.headers.Authorization = `Bearer ${token}`;
		}
		return config;
	},
	(error) => Promise.reject(error)
);

api.interceptors.response.use(
	(response) => {
		const res = response.data;
		if (res.status == 402) {
			clearSessionAuth();
			useAuthStore.setState({ isLoggedIn: false, isAdminSession: false });
			return undefined;
		}
		return res;
	},

	async (error) => {
		if (error.response && (error.response.status === 401 || error.response.status === 403)) {
			clearSessionAuth();
			useAuthStore.setState({ isLoggedIn: false, isAdminSession: false });
		}
		return Promise.reject(error);
	}
);

export default api;
