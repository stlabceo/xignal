import axios from 'axios';
import { useAuthStore } from '../store/authState';

const api = axios.create({
	baseURL: import.meta.env.VITE_API_URL,
	headers: {
		Authorization: sessionStorage.getItem('token'),
		'Content-Type': 'application/json'
	}
});

api.interceptors.request.use(
	async (config) => {
		// const regex = /^https?:\/\/[^\/]+/;

		const token = sessionStorage.getItem('token');
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
			sessionStorage.removeItem('token');
			sessionStorage.removeItem('refreshToken');
			useAuthStore.setState({ isLoggedIn: false });
			return;
		}
		return res;
	},

	async (error) => {
		// console.log('응답 에러:', error.response);
		if (error.response && error.response.status === 401) {
			console.log('401');
			sessionStorage.removeItem('token');
			sessionStorage.removeItem('refreshToken');
			useAuthStore.setState({ isLoggedIn: false });

			// try {
			// 	const refreshResponse = await axios.post(
			// 		API_URL + '/api/auth/refresh',
			// 		{
			// 			token: sessionStorage.getItem('token'),
			// 			refreshToken: sessionStorage.getItem('refreshToken')
			// 		},
			// 		{
			// 			headers: {
			// 				Authorization: `Bearer ${sessionStorage.getItem('refreshToken')}`
			// 			}
			// 		}
			// 	);
			// 	console.log('refreshResponse', refreshResponse.data.data);
			// 	const { token, refreshToken } = refreshResponse.data.data;
			// 	sessionStorage.setItem('token', token);
			// 	sessionStorage.setItem('refreshToken', refreshToken);

			// 	error.config.headers.Authorization = `Bearer ${token}`;
			// 	return api.request(error.config);
			// } catch {
			// 	sessionStorage.removeItem('token');
			// 	sessionStorage.removeItem('refreshToken');
			// 	sessionStorage.removeItem('userId');
			// 	useAuthStore.setState({ isLoggedIn: false });
			// 	// navigation.navigate('authMain');
			// }
		}
		if (error.response && error.response.status === 403) {
			// localStorage.clear()
			// window.dispatchEvent(new Event('storage'))
		}
		return Promise.reject(error);
	}
);

export default api;
