import api from '../api';
import { clearSessionAuth, persistSessionAuth } from '../utils/sessionAuth';

const OPS_ADMIN_IDS = new Set(['test1']);

const performLogin = async ({ userId, password, adminSession = false }) => {
	const res = await api.post('/user/admin/login', { userId, password });
	const { token } = res || {};

	if (!token?.accessToken || !token?.refreshToken) {
		throw new Error('invalid-login-response');
	}

	persistSessionAuth({
		accessToken: token.accessToken,
		refreshToken: token.refreshToken,
		adminSession
	});

	return res;
};

export const auth = {
	login(body, callback) {
		performLogin({ ...body, adminSession: false })
			.then(() => {
				callback(true);
			})
			.catch(() => {
				callback(false);
			});
	},
	adminLogin(body, callback) {
		performLogin({ ...body, adminSession: true })
			.then(() => api.get('/admin/myinfo'))
			.then((res) => {
				if (Number(res?.grade) <= 0 && OPS_ADMIN_IDS.has(String(res?.mem_id || '').trim())) {
					callback({ ok: true, profile: res });
					return;
				}

				clearSessionAuth();
				callback({ ok: false, message: '관리자 접근 권한이 없습니다.' });
			})
			.catch((error) => {
				clearSessionAuth();
				callback({
					ok: false,
					message: error?.response?.data?.errors?.[0]?.msg || '관리자 로그인에 실패했습니다.'
				});
			});
	},
	logout() {
		clearSessionAuth();
	},
	myInfo(callback) {
		api
			.get('/admin/myinfo')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				console.log('내 정보 요청 오류', res);
			});
	},
	member(callback) {
		api
			.get('/admin/member')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				console.log('회원 정보 조회 오류', res);
			});
	},
	saveMemberKeys(body, callback) {
		api
			.post('/admin/member/keys', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || { msg: 'API 정보를 저장하지 못했습니다.' });
			});
	},
	validateMemberKeys(body, callback) {
		api
			.post('/admin/member/keys/validate', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || { message: 'API 키 검증에 실패했습니다.' });
			});
	},
	webhookRecent(params, callback) {
		api
			.get('/admin/webhook/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	webhookSummary(params, callback) {
		api
			.get('/admin/webhook/summary', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	webhookTargetRecent(params, callback) {
		api
			.get('/admin/webhook/targets/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	webhookTargetSummary(params, callback) {
		api
			.get('/admin/webhook/targets/summary', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	webhookTargetStatus(body, callback) {
		api
			.post('/admin/webhook/targets/status', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminBinanceOrderMonitor(params, callback) {
		api
			.get('/admin/runtime/binance/order-monitor/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	adminOrderProcessRecent(params, callback) {
		api
			.get('/admin/runtime/order-process/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	adminOrderProcessItem(params, callback) {
		api
			.get('/admin/runtime/order-process/item', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminStrategyControlAuditRecent(params, callback) {
		api
			.get('/admin/strategy-control-audit/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	adminSystemLogRecent(params, callback) {
		api
			.get('/admin/system/logs/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	binanceRuntimeHealth(callback) {
		api
			.get('/admin/runtime/binance/health')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	binanceRuntimeReconcile(callback) {
		api
			.get('/admin/runtime/binance/reconcile')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	sharedPrices(callback) {
		api
			.get('/admin/price')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || {});
			});
	},
	accountRiskCurrent(params, callback) {
		api
			.get('/admin/runtime/account-risk/current', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	accountRiskHistory(params, callback) {
		api
			.get('/admin/runtime/account-risk/history', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	accountRiskSummary(params, callback) {
		api
			.get('/admin/runtime/account-risk/summary', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	accountReadiness(params, callback) {
		api
			.get('/admin/account/readiness', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	ensureHedgeMode(body, callback) {
		api
			.post('/admin/account/ensure-hedge-mode', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	runtimeOpsOverview(params, callback) {
		api
			.get('/admin/runtime/ops/overview', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	runtimeOpsUsersOverview(params, callback) {
		api
			.get('/admin/runtime/ops/users/overview', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	runtimeOpsUserItem(params, callback) {
		api
			.get('/admin/runtime/ops/users/item', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminStrategyOverview(params, callback) {
		api
			.get('/admin/manage/strategies/overview', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminStrategyItem(params, callback) {
		api
			.get('/admin/manage/strategies/item', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminStrategySave(body, callback) {
		api
			.post('/admin/manage/strategies/save', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminStrategyDelete(body, callback) {
		api
			.post('/admin/manage/strategies/delete', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminUsersOverview(params, callback) {
		api
			.get('/admin/manage/users/overview', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminUserItem(params, callback) {
		api
			.get('/admin/manage/users/item', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminUserTradeAccess(body, callback) {
		api
			.post('/admin/manage/users/access', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminUserDelete(body, callback) {
		api
			.post('/admin/manage/users/delete', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	adminRevenueSummary(params, callback) {
		api
			.get('/admin/manage/revenue/summary', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	policyRules(params, callback) {
		api
			.get('/admin/policy/rules', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	policyEvalRecent(params, callback) {
		api
			.get('/admin/policy/evals/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	policyEvalSummary(params, callback) {
		api
			.get('/admin/policy/evals/summary', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	policyActionRecent(params, callback) {
		api
			.get('/admin/policy/actions/recent', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	policyActionSummary(params, callback) {
		api
			.get('/admin/policy/actions/summary', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || []);
			});
	},
	policyRuleUpdate(body, callback) {
		api
			.post('/admin/policy/rules/update', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	policyPreviewUser(params, callback) {
		api
			.get('/admin/policy/preview/user', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	registerEmail(body, callback) {
		api
			.post('/user/reg1', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || { msg: '이메일 등록 중 오류가 발생했습니다.' });
			});
	},
	registerId(body, callback) {
		api
			.post('/user/reg2', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || { msg: '아이디 또는 비밀번호 등록 중 오류가 발생했습니다.' });
			});
	},
	registerCode(body, callback) {
		api
			.post('/user/code', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || { msg: '추천 코드 확인 중 오류가 발생했습니다.' });
			});
	},
	registerFin(body, callback) {
		api
			.post('/user/reg', body)
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || { msg: '회원가입 중 오류가 발생했습니다.' });
			});
	}
};
