import api from '../api';

export const auth = {
	login(body, callback) {
		api.post('/user/admin/login', body)
			.then((res) => {
				const { token } = res;
				sessionStorage.setItem('token', token.accessToken);
				sessionStorage.setItem('refreshToken', token.refreshToken);
				callback(true);
			})
			.catch((res) => {
				callback(false);
			});
	},
	myInfo(callback) {
		api.get('/admin/myinfo')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				console.log('요청 오류', res);
			});
	},
	registerEmail(body, callback) {
		api.post('/user/reg1', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	registerId(body, callback) {
		api.post('/user/reg2', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	registerCode(body, callback) {
		api.post('/user/code', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	registerFin(body, callback) {
		api.post('/user/reg', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	}
};
