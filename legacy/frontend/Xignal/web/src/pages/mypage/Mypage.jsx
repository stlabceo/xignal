import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authState';
import { auth } from '../../services/auth';
import AccountBalancePanel from '../../components/account/AccountBalancePanel';

const authRequest = (requester, ...args) =>
	new Promise((resolve) => {
		const timer = window.setTimeout(() => resolve(false), 10000);
		requester(...args, (response) => {
			window.clearTimeout(timer);
			resolve(response);
		});
	});

const MOJIBAKE_PATTERN = /[\uFFFD\u8B20\u5AC4\u6D39\u4E8C\uF9DD]|(?:\u00EC|\u00EB|\uB5C6|\uACD5)/;

const safeMessage = (payload, fallback) => {
	const candidate =
		payload?.messageKo ||
		payload?.message ||
		payload?.msg ||
		payload?.errors?.[0]?.messageKo ||
		payload?.errors?.[0]?.msg ||
		'';
	const normalized = String(candidate || '').trim();
	if (!normalized || MOJIBAKE_PATTERN.test(normalized)) {
		return fallback;
	}
	return normalized;
};

const isSuccess = (payload) => payload?.ok === true || payload?.success === true;

const formatDateTime = (value) => {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString('ko-KR', { hour12: false });
};

const formatMetric = (value, digits = 4) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
};

const getReadinessTone = (status) => {
	const normalized = String(status || '').toUpperCase();
	if (['READY', 'OK', 'CONNECTED', 'HEDGE', 'READ_OK_ORDER_PERMISSION_UNVERIFIED', 'STREAM_CONNECTED'].includes(normalized)) {
		return 'border-emerald-200 bg-emerald-50 text-emerald-700';
	}
	if (
		[
			'ACTION_REQUIRED',
			'CHECK_RUNTIME_HEALTH',
			'UNKNOWN',
			'ONE_WAY',
			'VALIDATION_REQUIRED',
			'API_KEY_MISSING',
			'API_READ_OK_LIVE_DISABLED',
			'STREAM_NOT_REQUIRED_READONLY',
			'STREAM_RECONNECTING',
			'INFO',
			'WARN'
		].includes(normalized)
	) {
		return 'border-amber-200 bg-amber-50 text-amber-700';
	}
	return 'border-red-200 bg-red-50 text-red-700';
};

const formatReadinessBadgeLabel = (status) => {
	const normalized = String(status || '').toUpperCase();
	if (['OK', 'READY', 'CONNECTED', 'HEDGE'].includes(normalized)) return '정상';
	if (normalized === 'READ_OK_ORDER_PERMISSION_UNVERIFIED') return '읽기 정상';
	if (normalized === 'STREAM_CONNECTED') return '정상';
	if (normalized === 'STREAM_NOT_REQUIRED_READONLY') return '대기';
	if (normalized === 'API_READ_OK_LIVE_DISABLED') return '대기';
	if (normalized === 'API_KEY_MISSING') return '입력 필요';
	if (normalized === 'STREAM_RECONNECTING') return '재연결';
	if (normalized === 'UNKNOWN') return '검증 불가';
	if (normalized === 'ONE_WAY') return '자동 설정 필요';
	if (['ACTION_REQUIRED', 'CHECK_RUNTIME_HEALTH', 'MISSING', 'BLOCKED', 'VALIDATION_REQUIRED'].includes(normalized)) {
		return '확인 필요';
	}
	return status || '-';
};

const ReadinessBadge = ({ value, label }) => (
	<span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getReadinessTone(value)}`}>
		{label || formatReadinessBadgeLabel(value)}
	</span>
);

const ReadinessItem = ({ label, value, status, action }) => (
	<div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p className="text-sm font-semibold text-slate-900">{label}</p>
				<p className="mt-1 text-sm text-slate-600">{value || '-'}</p>
			</div>
			<ReadinessBadge value={status} />
		</div>
		{action ? <p className="mt-2 text-xs text-amber-700">{action}</p> : null}
	</div>
);

const Mypage = () => {
	const { userInfo, setIsLoggedIn, setIsAdminSession } = useAuthStore();
	const [memberInfo, setMemberInfo] = useState(null);
	const [runtimeHealth, setRuntimeHealth] = useState(null);
	const [readiness, setReadiness] = useState(null);
	const [riskHistory, setRiskHistory] = useState([]);
	const [appKey, setAppKey] = useState('');
	const [appSecret, setAppSecret] = useState('');
	const [saveMessage, setSaveMessage] = useState('');
	const [saveTone, setSaveTone] = useState('info');
	const [validateMessage, setValidateMessage] = useState('');
	const [validateTone, setValidateTone] = useState('info');
	const [pageMessage, setPageMessage] = useState('');
	const [hedgeModeMessage, setHedgeModeMessage] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isValidating, setIsValidating] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isEnsuringHedgeMode, setIsEnsuringHedgeMode] = useState(false);

	const signout = () => {
		auth.logout();
		setIsLoggedIn(false);
		setIsAdminSession(false);
		window.location.href = '/signin';
	};

	const loadMemberInfo = async () => {
		const response = await authRequest(auth.member.bind(auth));
		setMemberInfo(response || null);
	};

	const loadRuntimeInfo = async () => {
		try {
			const [health, readinessPayload, history] = await Promise.all([
				authRequest(auth.binanceRuntimeHealth.bind(auth)),
				authRequest(auth.accountReadiness.bind(auth), {}),
				authRequest(auth.accountRiskHistory.bind(auth), { hours: 24, limit: 12 })
			]);

			setRuntimeHealth(health && !health.errors ? health : null);
			setReadiness(readinessPayload && !readinessPayload.errors ? readinessPayload : null);
			setRiskHistory(Array.isArray(history) ? history : []);
			setPageMessage('');
		} catch (error) {
			setPageMessage('계정 상태 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
		}
	};

	const refreshAll = async () => {
		setIsRefreshing(true);
		try {
			await Promise.all([loadMemberInfo(), loadRuntimeInfo()]);
		} finally {
			setIsRefreshing(false);
		}
	};

	useEffect(() => {
		refreshAll();
	}, []);

	const handleSave = async () => {
		if (!appKey.trim() && !appSecret.trim()) {
			setSaveTone('error');
			setSaveMessage('저장할 API Key 또는 Secret Key를 입력해 주세요.');
			return;
		}

		setIsSaving(true);
		setSaveMessage('');
		setSaveTone('info');

		try {
			const response = await auth.saveMemberKeys({
				appKey: appKey.trim(),
				appSecret: appSecret.trim()
			});

			if (isSuccess(response)) {
				setSaveTone('success');
				setSaveMessage(safeMessage(response, 'API 키가 저장되었습니다. 연결 검증을 진행해 주세요.'));
				setAppKey('');
				setAppSecret('');
				await refreshAll();
			} else {
				setSaveTone('error');
				setSaveMessage(safeMessage(response, 'API 키 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.'));
			}
		} catch (error) {
			setSaveTone('error');
			setSaveMessage(safeMessage(error?.response?.data, 'API 키 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.'));
		} finally {
			setIsSaving(false);
		}
	};

	const handleValidate = async () => {
		setIsValidating(true);
		setValidateMessage('');
		setValidateTone('info');

		try {
			const response = await auth.validateMemberKeys({
				appKey: appKey.trim(),
				appSecret: appSecret.trim()
			});

			if (isSuccess(response)) {
				setValidateTone('success');
				setValidateMessage(safeMessage(response, 'Binance API 연결 검증에 성공했습니다.'));
			} else {
				setValidateTone('error');
				setValidateMessage(
					safeMessage(response, 'Binance API 연결 검증에 실패했습니다. API 권한, IP 제한, Secret Key를 확인해 주세요.')
				);
			}
			await loadRuntimeInfo();
		} catch (error) {
			setValidateTone('error');
			setValidateMessage(
				safeMessage(error?.response?.data, 'Binance API 연결 검증에 실패했습니다. API 권한, IP 제한, Secret Key를 확인해 주세요.')
			);
		} finally {
			setIsValidating(false);
		}
	};

	const handleEnsureHedgeMode = async () => {
		setIsEnsuringHedgeMode(true);
		setHedgeModeMessage('');
		try {
			const response = await auth.ensureHedgeMode({});
			setHedgeModeMessage(
				safeMessage(response, '헤지 모드 자동 설정은 현재 read-only 모드에서 차단되어 있습니다.')
			);
			await loadRuntimeInfo();
		} finally {
			setIsEnsuringHedgeMode(false);
		}
	};

	const futuresBalanceIssue = readiness?.issues?.find((issue) => issue.code === 'FUTURES_BALANCE_USDT_EMPTY');
	const maskedKeyInfo = memberInfo?.appKeyMasked || (memberInfo?.hasAppKey ? '등록됨' : '미등록');
	const secretStatus = memberInfo?.hasAppSecret ? '등록됨' : '미등록';
	const userStream = readiness?.userStream || null;
	const userStreamStatus = userStream?.status || (runtimeHealth?.connected ? 'STREAM_CONNECTED' : 'UNKNOWN');
	const userStreamLabel = userStream?.label || runtimeHealth?.statusLabel || '검증 불가';
	const userStreamAction = userStream
		? userStream.nextAction || ''
		: runtimeHealth?.connected
			? ''
			: runtimeHealth?.lastErrorMessage || '';
	const messageClass = (tone) =>
		tone === 'success'
			? 'bg-emerald-50 text-emerald-700'
			: tone === 'error'
				? 'bg-red-50 text-red-700'
				: 'bg-slate-100 text-slate-700';

	return (
		<div className="inner-container">
			<div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h3 className="text-[22px] font-medium text-white sm:text-xl">My Page</h3>
					<p className="mt-2 text-sm text-slate-300">Binance 연결과 자동매매 준비 상태를 확인합니다.</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<button type="button" className="rounded-md border border-white/20 px-3 py-2 text-sm text-white" onClick={refreshAll} disabled={isRefreshing}>
						{isRefreshing ? '새로고침 중...' : '상태 새로고침'}
					</button>
					<button className="rounded-md border border-red-600 px-3 py-2 text-sm text-red-500" onClick={signout}>
						로그아웃
					</button>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1.05fr_1.2fr]">
				<div className="rounded-lg bg-white p-4 shadow sm:p-6">
					<div className="border-b border-slate-200 pb-4">
						<h4 className="text-[18px] font-semibold text-black">회원 정보</h4>
					</div>
					<div className="divide-y divide-slate-200 text-sm">
						<div className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-4">
							<p className="w-full font-medium text-slate-500 sm:w-[160px]">회원 ID</p>
							<p className="w-full break-all text-black">{memberInfo?.mem_id || userInfo.loginId || '-'}</p>
						</div>
						<div className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-4">
							<p className="w-full font-medium text-slate-500 sm:w-[160px]">이름</p>
							<p className="w-full break-all text-black">{memberInfo?.mem_name || '-'}</p>
						</div>
						<div className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-4">
							<p className="w-full font-medium text-slate-500 sm:w-[160px]">연락처</p>
							<p className="w-full break-all text-black">{memberInfo?.mem_mobile || '-'}</p>
						</div>
						<div className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-4">
							<p className="w-full font-medium text-slate-500 sm:w-[160px]">이메일</p>
							<p className="w-full break-all text-black">{memberInfo?.email || '-'}</p>
						</div>
					</div>
				</div>

				<div className="rounded-lg bg-white p-4 shadow sm:p-6">
					<div className="border-b border-slate-200 pb-4">
						<h4 className="text-[18px] font-semibold text-black">Binance API 연결</h4>
						<p className="mt-2 text-sm text-slate-500">자동매매를 실행하려면 Binance Futures 권한이 있는 API Key가 필요합니다.</p>
					</div>

					<div className="mt-4 rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
						<p>현재 등록된 API Key: <span className="font-medium text-black">{maskedKeyInfo}</span></p>
						<p className="mt-1">현재 등록된 Secret Key: <span className="font-medium text-black">{secretStatus}</span></p>
						<p className="mt-2 text-xs text-slate-500">Secret Key 원문은 저장 후 다시 표시하지 않습니다.</p>
					</div>

					<div className="mt-4 space-y-3">
						<div>
							<label className="mb-1 block text-sm font-medium text-slate-600">API Key</label>
							<input
								type="text"
								value={appKey}
								onChange={(event) => setAppKey(event.target.value)}
								placeholder="새 API Key를 입력하세요. 비워두면 기존 값을 유지합니다."
								className="w-full rounded-md border border-slate-300 px-3 py-3 text-black focus:outline-none"
								autoComplete="off"
							/>
						</div>
						<div>
							<label className="mb-1 block text-sm font-medium text-slate-600">Secret Key</label>
							<input
								type="password"
								value={appSecret}
								onChange={(event) => setAppSecret(event.target.value)}
								placeholder="새 Secret Key를 입력하세요. 비워두면 기존 값을 유지합니다."
								className="w-full rounded-md border border-slate-300 px-3 py-3 text-black focus:outline-none"
								autoComplete="new-password"
							/>
						</div>
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						<button type="button" onClick={handleSave} disabled={isSaving} className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
							{isSaving ? '저장 중...' : 'API 키 저장'}
						</button>
						<button type="button" onClick={handleValidate} disabled={isValidating} className="rounded-md border border-black px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
							{isValidating ? '검증 중...' : 'API 연결 검증'}
						</button>
					</div>

					{saveMessage && <div className={`mt-4 rounded-md px-4 py-3 text-sm ${messageClass(saveTone)}`}>{saveMessage}</div>}
					{validateMessage && <div className={`mt-3 rounded-md px-4 py-3 text-sm ${messageClass(validateTone)}`}>{validateMessage}</div>}
				</div>
			</div>

			<div className="mt-6 rounded-lg bg-white p-4 shadow sm:p-6">
				<div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h4 className="text-[18px] font-semibold text-black">자동매매 준비 상태</h4>
						<p className="mt-1 text-sm text-slate-500">API, 권한, 투자 가능 잔고, 포지션 모드를 근거 기반으로 표시합니다.</p>
					</div>
					<ReadinessBadge value={readiness?.readinessStatus} label={readiness?.readinessStatus === 'READY' ? '이용 가능' : '조치 필요'} />
				</div>

				{futuresBalanceIssue ? (
					<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
						투자 가능 USDT가 없습니다. Binance 현물 지갑에서 선물 지갑으로 USDT를 이동해야 합니다.
					</div>
				) : null}

				<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
					<ReadinessItem
						label="API 연결"
						value={readiness?.apiConnectionLabel || '검증 불가'}
						status={readiness?.apiConnection}
						action={readiness?.apiConnection === 'OK' ? '' : 'API Key를 등록하거나 Binance 오류를 확인해 주세요.'}
					/>
					<ReadinessItem
						label="API 권한"
						value={readiness?.apiPermissionLabel || '검증 불가'}
						status={readiness?.apiPermission}
						action={readiness?.apiPermission === 'ACTION_REQUIRED' ? 'Futures 권한 또는 IP 허용 목록을 확인해 주세요.' : ''}
					/>
					<ReadinessItem
						label="투자 가능 잔고"
						value={readiness?.futuresBalanceUsdt == null ? '데이터 준비중' : `${formatMetric(readiness.futuresBalanceUsdt, 2)} USDT`}
						status={readiness?.futuresBalanceUsdt > 0 ? 'OK' : 'ACTION_REQUIRED'}
						action={readiness?.futuresBalanceUsdt > 0 ? '자동매매에 사용할 수 있는 선물 지갑 USDT입니다.' : '투자 가능 USDT가 없습니다.'}
					/>
					<div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<p className="text-sm font-semibold text-slate-900">포지션 모드</p>
								<p className="mt-1 text-sm text-slate-600">{readiness?.positionModeLabel || readiness?.hedgeMode?.label || '검증 불가'}</p>
							</div>
							<ReadinessBadge
								value={readiness?.positionMode || readiness?.hedgeMode?.status}
								label={readiness?.positionMode === 'HEDGE' ? '정상' : readiness?.positionMode === 'ONE_WAY' ? '자동 설정 필요' : '검증 불가'}
							/>
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<button
								type="button"
								className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
								onClick={handleEnsureHedgeMode}
								disabled={isEnsuringHedgeMode || readiness?.hedgeMode?.blockedByWriteGuard}
							>
								{isEnsuringHedgeMode ? '확인 중...' : readiness?.hedgeMode?.actionLabel || '헤지 모드 자동 설정'}
							</button>
							<span className="text-xs text-slate-500">{readiness?.hedgeMode?.message || '설정 변경은 승인된 live-write preflight에서만 실행합니다.'}</span>
						</div>
						{hedgeModeMessage ? <p className="mt-2 text-xs text-amber-700">{hedgeModeMessage}</p> : null}
					</div>
					<ReadinessItem label="자산 모드" value={readiness?.assetModeLabel || 'USDT 선물 지원'} status="OK" />
					<ReadinessItem
						label="마지막 동기화"
						value={formatDateTime(readiness?.lastSyncedAt)}
						status={readiness?.lastSyncedAt ? 'OK' : 'ACTION_REQUIRED'}
						action={readiness?.lastSyncedAt ? '' : '새로고침 또는 API 연결 확인이 필요합니다.'}
					/>
					<ReadinessItem
						label="실시간 주문 이벤트"
						value={userStreamLabel}
						status={userStreamStatus}
						action={userStreamAction}
					/>
				</div>

				{readiness?.issues?.length ? (
					<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
						<p className="text-sm font-semibold text-amber-900">확인할 항목</p>
						<ul className="mt-2 space-y-1 text-sm text-amber-800">
							{readiness.issues.map((issue) => (
								<li key={issue.code}>{issue.label} {issue.action ? `- ${issue.action}` : ''}</li>
							))}
						</ul>
					</div>
				) : null}
			</div>

			<div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
				<AccountBalancePanel streamReadiness={userStream} />

				<div className="rounded-lg bg-white p-4 shadow sm:p-6">
					<div className="border-b border-slate-200 pb-4">
						<h4 className="text-[18px] font-semibold text-black">최근 리스크 이력</h4>
						<p className="mt-1 text-sm text-slate-500">계정 리스크 이력입니다. 사용자 조치가 필요한 항목은 준비 상태에도 표시됩니다.</p>
					</div>

					<div className="mt-4 space-y-3">
						{riskHistory.length ? (
							riskHistory.map((item) => (
								<div key={item.id} className="rounded-md border border-slate-200 p-4">
									<div className="flex flex-wrap items-center gap-2">
										<span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getReadinessTone(item.riskLevel)}`}>
											{item.riskLevelLabel || item.riskLevel || 'UNKNOWN'}
										</span>
										<span className="text-sm font-semibold text-black">{formatDateTime(item.createdAt)}</span>
									</div>
									<div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
										<div>Equity: {formatMetric(item.accountEquity)}</div>
										<div>Maint Margin: {formatMetric(item.accountMaintMargin)}</div>
										<div>Margin Ratio: {formatMetric(item.accountMarginRatio, 2)}%</div>
										<div>Position Count: {Number(item.positionCount || 0).toLocaleString('ko-KR')}</div>
									</div>
								</div>
							))
						) : (
							<div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">최근 24시간 리스크 이력이 없습니다.</div>
						)}
					</div>
				</div>
			</div>

			{pageMessage && <div className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700">{pageMessage}</div>}
		</div>
	);
};

export default Mypage;
