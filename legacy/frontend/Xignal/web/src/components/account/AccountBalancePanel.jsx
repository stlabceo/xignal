import React, { useEffect, useMemo, useState } from 'react';
import { auth } from '../../services/auth';

const authRequest = (requester, ...args) =>
	new Promise((resolve) => {
		requester(...args, (response) => resolve(response));
	});

const formatMetric = (value, digits = 4) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
};

const formatPercent = (value, digits = 2) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return '-';
	return `${numeric.toLocaleString('ko-KR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	})}%`;
};

const formatDateTime = (value) => {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString('ko-KR', { hour12: false });
};

const toneByRisk = (riskTone) => {
	switch (String(riskTone || '').toLowerCase()) {
		case 'critical':
			return 'border-red-200 bg-red-50 text-red-700';
		case 'danger':
			return 'border-orange-200 bg-orange-50 text-orange-700';
		case 'warning':
			return 'border-amber-200 bg-amber-50 text-amber-700';
		case 'watch':
			return 'border-sky-200 bg-sky-50 text-sky-700';
		case 'safe':
			return 'border-emerald-200 bg-emerald-50 text-emerald-700';
		default:
			return 'border-slate-200 bg-slate-50 text-slate-700';
	}
};

const toneByConnection = (status) => {
	switch (String(status || '').toUpperCase()) {
		case 'CONNECTED':
		case 'STREAM_CONNECTED':
			return 'border-emerald-200 bg-emerald-50 text-emerald-700';
		case 'API_KEY_MISSING':
		case 'API_READ_OK_LIVE_DISABLED':
		case 'STREAM_NOT_REQUIRED_READONLY':
		case 'STREAM_RECONNECTING':
		case 'UNKNOWN':
		case 'INFO':
		case 'WARN':
			return 'border-amber-200 bg-amber-50 text-amber-700';
		case 'ERROR':
		case 'DISCONNECTED':
		case 'DISABLED':
		case 'STREAM_AUTH_ERROR':
		case 'STREAM_DISCONNECTED_REQUIRED':
			return 'border-red-200 bg-red-50 text-red-700';
		case 'CONNECTING':
			return 'border-amber-200 bg-amber-50 text-amber-700';
		default:
			return 'border-slate-200 bg-slate-50 text-slate-700';
	}
};

const metricItems = (snapshot) => [
	{ label: 'Account Equity', value: formatMetric(snapshot?.accountEquity) },
	{ label: 'Available Balance', value: formatMetric(snapshot?.availableBalance) },
	{ label: 'Unrealized PnL', value: formatMetric(snapshot?.totalUnrealizedProfit) },
	{ label: 'Margin Ratio', value: formatPercent(snapshot?.accountMarginRatio) },
	{ label: 'Margin Buffer', value: formatMetric(snapshot?.accountMarginBuffer) },
	{ label: 'Maint Margin', value: formatMetric(snapshot?.accountMaintMargin) },
	{ label: 'Wallet Balance', value: formatMetric(snapshot?.totalWalletBalance) },
	{ label: 'Position Count', value: Number(snapshot?.positionCount || 0).toLocaleString('ko-KR') }
];

const summaryItems = (summary) => [
	{ label: '24h Max Margin Ratio', value: formatPercent(summary?.overview?.maxAccountMarginRatio) },
	{ label: '24h Avg Margin Ratio', value: formatPercent(summary?.overview?.avgAccountMarginRatio) },
	{ label: '24h Min Equity', value: formatMetric(summary?.overview?.minAccountEquity) },
	{ label: '24h Max Maint Margin', value: formatMetric(summary?.overview?.maxAccountMaintMargin) },
	{ label: '24h Min Margin Buffer', value: formatMetric(summary?.overview?.minAccountMarginBuffer) },
	{ label: '24h Max Position Count', value: Number(summary?.overview?.maxPositionCount || 0).toLocaleString('ko-KR') }
];

const AccountBalancePanel = ({
	title = '실시간 계정 현황',
	subtitle = 'Binance API 기준으로 잔고와 리스크를 주기적으로 새로고침합니다.',
	streamReadiness = null
}) => {
	const [runtimeHealth, setRuntimeHealth] = useState(null);
	const [accountRiskCurrent, setAccountRiskCurrent] = useState(null);
	const [accountRiskSummary, setAccountRiskSummary] = useState(null);
	const [message, setMessage] = useState('');
	const [loading, setLoading] = useState(true);

	const refreshCurrent = async () => {
		try {
			const [health, risk] = await Promise.all([
				authRequest(auth.binanceRuntimeHealth.bind(auth)),
				authRequest(auth.accountRiskCurrent.bind(auth), { force: 'Y' })
			]);

			setRuntimeHealth(health && !health.errors ? health : null);
			setAccountRiskCurrent(risk && !risk.errors ? risk : null);
			setMessage('');
		} catch (error) {
			setMessage('계정 리스크 데이터를 불러오지 못했습니다.');
		} finally {
			setLoading(false);
		}
	};

	const refreshSummary = async () => {
		try {
			const summary = await authRequest(auth.accountRiskSummary.bind(auth), { hours: 24 });
			setAccountRiskSummary(summary && !summary.errors ? summary : null);
		} catch (error) {
			setAccountRiskSummary(null);
		}
	};

	useEffect(() => {
		refreshCurrent();
		refreshSummary();

		const currentInterval = setInterval(refreshCurrent, 5000);
		const summaryInterval = setInterval(refreshSummary, 30000);

		return () => {
			clearInterval(currentInterval);
			clearInterval(summaryInterval);
		};
	}, []);

	const hasCredentials = useMemo(() => {
		if (accountRiskCurrent?.hasCredentials === false) return false;
		if (runtimeHealth?.appKeyMasked) return true;
		return accountRiskCurrent !== null;
	}, [accountRiskCurrent, runtimeHealth]);
	const connectionStatus = streamReadiness?.status || runtimeHealth?.status;
	const connectionLabel = streamReadiness?.label || runtimeHealth?.statusLabel || '상태 확인중';

	return (
		<div className="rounded-lg border border-[#494949] bg-[#1B1B1B] p-4 text-white md:p-5">
			<div className="flex flex-col gap-3 border-b border-[#2A2A2A] pb-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<p className="text-[15px] font-semibold tracking-[0.16em] text-[#7a7a7a]">ACCOUNT SNAPSHOT</p>
					<h4 className="mt-2 text-[20px] font-semibold text-white">{title}</h4>
					<p className="mt-1 text-sm text-[#A0A0A0]">{subtitle}</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<div className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneByConnection(connectionStatus)}`}>
						{connectionLabel}
					</div>
					<div className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneByRisk(accountRiskCurrent?.riskTone)}`}>
						{accountRiskCurrent?.riskLevelLabel || '리스크 미확정'}
					</div>
				</div>
			</div>

			{loading ? (
				<div className="mt-4 rounded-md bg-[#0F0F0F] px-4 py-4 text-sm text-[#B8B8B8]">계정 스냅샷을 불러오는 중입니다.</div>
			) : !hasCredentials ? (
				<div className="mt-4 rounded-md bg-[#0F0F0F] px-4 py-4 text-sm text-[#B8B8B8]">
					등록된 Binance API/Secret이 없어 실시간 계정 현황을 표시할 수 없습니다.
				</div>
			) : (
				<>
					<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						{metricItems(accountRiskCurrent).map((item) => (
							<div key={item.label} className="rounded-md border border-[#303030] bg-[#0F0F0F] px-4 py-3">
								<p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">{item.label}</p>
								<p className="mt-2 text-[18px] font-semibold text-white">{item.value}</p>
							</div>
						))}
					</div>

					<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{summaryItems(accountRiskSummary).map((item) => (
							<div key={item.label} className="rounded-md border border-[#303030] bg-[#161616] px-4 py-3">
								<p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">{item.label}</p>
								<p className="mt-2 text-[16px] font-semibold text-white">{item.value}</p>
							</div>
						))}
					</div>

					<div className="mt-4 grid gap-3 lg:grid-cols-4">
						<div className="rounded-md border border-[#303030] bg-[#0F0F0F] px-4 py-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">Asset Mode</p>
							<p className="mt-2 text-sm font-semibold text-white">{accountRiskCurrent?.accountModeLabel || accountRiskCurrent?.accountMode || '-'}</p>
						</div>
						<div className="rounded-md border border-[#303030] bg-[#0F0F0F] px-4 py-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">Position Mode</p>
							<p className="mt-2 text-sm font-semibold text-white">{accountRiskCurrent?.positionModeLabel || accountRiskCurrent?.positionMode || '-'}</p>
						</div>
						<div className="rounded-md border border-[#303030] bg-[#0F0F0F] px-4 py-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">Last Ready</p>
							<p className="mt-2 text-sm font-semibold text-white">
								{formatDateTime(runtimeHealth?.lastReadyAt || accountRiskCurrent?.capturedAt)}
							</p>
						</div>
						<div className="rounded-md border border-[#303030] bg-[#0F0F0F] px-4 py-3">
							<p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">API Key</p>
							<p className="mt-2 text-sm font-semibold text-white">{runtimeHealth?.appKeyMasked || '-'}</p>
						</div>
					</div>
				</>
			)}

			{message && <div className="mt-4 rounded-md bg-[#3A2514] px-4 py-3 text-sm text-[#FFD6A5]">{message}</div>}
		</div>
	);
};

export default AccountBalancePanel;
