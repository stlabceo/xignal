import React, { useEffect, useMemo, useState } from 'react';
import { auth } from '../../services/auth';
import { useAuthStore } from '../../store/authState';

const authRequest = (requester, ...args) =>
	new Promise((resolve) => {
		requester(...args, (response) => resolve(response));
	});

const topTabs = [
	{ key: 'status', label: '상태 관리' },
	{ key: 'strategies', label: '전략 관리' },
	{ key: 'users', label: '사용자 관리' },
	{ key: 'revenue', label: '매출 관리' }
];

const statusTabs = [
	{ key: 'exchange', label: '거래소 공통 상태' },
	{ key: 'orders', label: '사용자 주문 로그' },
	{ key: 'controls', label: '전략 제어 이력' },
	{ key: 'accounts', label: '사용자 계정 연결' },
	{ key: 'system', label: '시스템 로그' }
];

const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
const inputClass =
	'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500';
const selectClass = `${inputClass} pr-8`;

const strategyEmptyForm = {
	id: '',
	strategyCategory: 'signal',
	strategyName: '',
	signalName: '',
	allowedSymbols: [],
	allowedTimeframesText: '',
	permissionMode: 'ALL',
	allowedMemberIdsText: '',
	isActive: 'Y',
	notes: ''
};

const formatNumber = (value, digits = 2) => {
	const num = Number(value || 0);
	if (!Number.isFinite(num)) return '-';
	return num.toLocaleString('ko-KR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
};

const formatDateTime = (value) => {
	if (!value) return '-';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return String(value);
	return parsed.toLocaleString('ko-KR', { hour12: false });
};

const formatAgo = (value) => {
	if (!value) return '-';
	const parsed = new Date(value).getTime();
	if (!Number.isFinite(parsed)) return '-';
	const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
    if (diffSec < 60) return `${diffSec}초`;
	const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}분`;
	const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간`;
    return `${Math.floor(diffHour / 24)}일`;
};

const toDateInputValue = (date) => {
	const safe = date instanceof Date ? date : new Date(date);
	return safe.toISOString().slice(0, 10);
};

const statusTone = (label) => {
	const normalized = String(label || '').trim().toUpperCase();
	if (['정상', 'EXPECTED', 'INFO', 'CONNECTED', 'LIVE_DEMO', 'SAFE'].includes(normalized)) {
		return 'border-emerald-200 bg-emerald-50 text-emerald-700';
	}
	if (['미확인', 'UNKNOWN', 'WATCH', 'WARNING', 'WARN', 'REVIEW', '진행중'].includes(normalized)) {
		return 'border-amber-200 bg-amber-50 text-amber-700';
	}
	if (
		[
			'비정상',
			'ABNORMAL',
			'DISCONNECTED',
			'운영 제외',
			'EXCLUDED',
			'DANGER',
			'CRITICAL',
			'DEMO_ONLY',
			'오류'
		].includes(normalized)
	) {
		return 'border-red-200 bg-red-50 text-red-700';
	}
	return 'border-slate-200 bg-slate-50 text-slate-700';
};

const StatusBadge = ({ label, className = '' }) => (
	<span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(label)} ${className}`}>
		{label || '-'}
	</span>
);

const getOrderProcessKind = (item = {}) => {
	const kind = String(item.processKind || item.strategyCategory || item.category || '')
		.trim()
		.toLowerCase();
	return kind === 'grid' ? 'grid' : 'algorithm';
};

const renderStageBadge = (label) =>
	label ? <StatusBadge label={label} /> : <span className="text-slate-300">-</span>;

const renderNumberOrDash = (value, digits = 6, suffix = '') => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric === 0) return '-';
	return `${formatNumber(numeric, digits)}${suffix}`;
};

const infoToneClass = (tone = 'slate') => {
	if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
	if (tone === 'blue') return 'border-sky-200 bg-sky-50 text-sky-700';
	if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700';
	if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-700';
	return 'border-slate-200 bg-slate-50 text-slate-700';
};

const InfoBadge = ({ label, tone = 'slate' }) => (
	<span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${infoToneClass(tone)}`}>
		{label || '-'}
	</span>
);

const getOrderIssueTone = (issueCategory) => {
	const normalized = String(issueCategory || '')
		.trim()
		.toUpperCase();
	if (['EXCHANGE_ACCOUNT', 'EXCHANGE_ORDER'].includes(normalized)) return 'rose';
	if (['EXIT_RESERVATION', 'PID_LEDGER'].includes(normalized)) return 'amber';
	if (['WEBHOOK_INPUT', 'WEBHOOK_RUNTIME'].includes(normalized)) return 'blue';
	if (['INTERNAL_RUNTIME', 'GRID_RUNTIME'].includes(normalized)) return 'slate';
	return 'slate';
};

const isEnabledState = (value) => {
	const normalized = String(value ?? '')
		.trim()
		.toUpperCase();
	return ['Y', '1', 'TRUE', 'START', 'ON'].includes(normalized);
};

const formatStrategyCategoryLabel = (value) => {
	const normalized = String(value || '')
		.trim()
		.toLowerCase();
	if (normalized === 'signal') return '알고리즘';
	if (normalized === 'grid') return '그리드';
	return normalized ? normalized.toUpperCase() : '-';
};

const formatControlActionLabel = (value) => {
	const normalized = String(value || '')
		.trim()
		.toUpperCase();
	if (normalized === 'TOGGLE') return '수동 ON/OFF';
	if (normalized === 'USER_ON') return '사용자 ON';
	if (normalized === 'USER_OFF') return '사용자 OFF';
	if (normalized === 'CREATE') return '생성';
	if (normalized === 'DELETE') return '삭제';
	if (normalized === 'USER_DELETE_STRATEGY') return '사용자 전략 삭제';
	if (normalized === 'SYSTEM_RESET_READY') return '시스템 READY 복귀';
	if (normalized === 'POLICY_AUTO_OFF_USER_HARD') return '정책 사용자 강제 OFF';
	if (normalized === 'POLICY_AUTO_OFF_USER_SOFT') return '정책 사용자 OFF';
	if (normalized === 'POLICY_AUTO_OFF_STRATEGY') return '정책 전략 OFF';
	return normalized || '-';
};

const getControlSourceMeta = (item = {}) => {
	const actionCode = String(item.actionCode || '')
		.trim()
		.toUpperCase();
	const requestIp = String(item.requestIp || '').trim().toLowerCase();

	if (actionCode === 'DELETE' || actionCode === 'USER_DELETE_STRATEGY') {
		return { label: '삭제', tone: 'rose' };
	}
	if (actionCode.startsWith('POLICY_')) {
		return { label: '정책', tone: 'amber' };
	}
	if (actionCode === 'SYSTEM_RESET_READY' || requestIp.startsWith('system:')) {
		return { label: '시스템', tone: 'blue' };
	}
	return { label: '수동/화면', tone: 'emerald' };
};

const formatControlChangeLabel = (previousEnabled, nextEnabled) =>
	`${isEnabledState(previousEnabled) ? '운용ON' : '운용OFF'} -> ${isEnabledState(nextEnabled) ? '운용ON' : '운용OFF'}`;

const AlgorithmMetaCell = ({ item }) => {
	const meta = item.algorithmMeta || {};
	const lineageLines = Array.isArray(meta.lineageLines) ? meta.lineageLines.slice(0, 4) : [];
	return (
		<div className="space-y-1">
			<div className="font-semibold text-slate-900">
				{meta.symbol || item.symbol || '-'} / {meta.direction || item.signalType || '-'} / {meta.statusLabel || '-'}
			</div>
			<div className="text-xs text-slate-500">
				진입가 {renderNumberOrDash(meta.entryPrice)} / 목표 익절 {renderNumberOrDash(meta.targetTakeProfitPrice)}
			</div>
			<div className="text-xs text-slate-500">
				거래금액 {renderNumberOrDash(meta.tradeAmount, 2, ' USDT')} / 손절 {meta.stopConditionLabel || '-'}
			</div>
			<div className="text-xs text-slate-500">
				미실현 {renderNumberOrDash(meta.unrealizedPnl, 4, ' USDT')} / 실현 {renderNumberOrDash(meta.realizedPnl, 4, ' USDT')}
			</div>
			{lineageLines.length > 0 ? (
				<div className="space-y-1 pt-1 text-[11px] text-slate-500">
					{lineageLines.map((line, index) => (
						<div key={`${item.id || item.pid || 'algorithm'}-lineage-${index}`} className="break-all">
							{line}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
};

const GridMetaCell = ({ item }) => {
	const meta = item.gridMeta || {};
	const lineageLines = Array.isArray(meta.lineageLines) ? meta.lineageLines.slice(0, 4) : [];
	return (
		<div className="space-y-1">
			<div className="font-semibold text-slate-900">
				{meta.symbol || item.symbol || '-'} / {meta.overallStatusLabel || '-'}
			</div>
			<div className="text-xs text-slate-500">
				매수 {meta.buyStatusLabel || '-'} / 매도 {meta.sellStatusLabel || '-'}
			</div>
			<div className="text-xs text-slate-500">
				트리거 {renderNumberOrDash(meta.triggerPrice)} / 지지 {renderNumberOrDash(meta.supportPrice)} / 저항 {renderNumberOrDash(meta.resistancePrice)}
			</div>
			<div className="text-xs text-slate-500">
				목표 익절 {meta.targetTakeProfitPercent ? `${formatNumber(meta.targetTakeProfitPercent, 2)}%` : '-'} / 현재 레짐 익절 {meta.currentRegimeTakeProfitCount || 0}회
			</div>
			<div className="text-xs text-slate-500">
				누적 손익 {renderNumberOrDash(meta.cumulativeRealizedPnl, 4, ' USDT')} / 누적 익절 {meta.cumulativeTakeProfitCount || 0}회 / 누적 손절 {meta.cumulativeStopLossCount || 0}회
			</div>
			{lineageLines.length > 0 ? (
				<div className="space-y-1 pt-1 text-[11px] text-slate-500">
					{lineageLines.map((line, index) => (
						<div key={`${item.id || item.pid || 'grid'}-lineage-${index}`} className="break-all">
							{line}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
};

const OrderProcessDetailPanel = ({ item, loading, onRefresh, onClose }) => {
	if (loading) {
		return (
			<div className={cardClass}>
				<p className="text-sm text-slate-500">주문 상세를 불러오는 중입니다.</p>
			</div>
		);
	}

	if (!item) {
		return (
			<div className={cardClass}>
				<p className="text-sm text-slate-500">표에서 `상세`를 누르면 PID 주문 흐름의 내부 이벤트, ledger, 보호주문까지 한 번에 볼 수 있습니다.</p>
			</div>
		);
	}

	const detail = item.detail || {};
	const counts = detail.counts || {};
	const binanceEvents = Array.isArray(detail.binanceEvents) ? detail.binanceEvents : [];
	const cycleLedgerEvents = Array.isArray(detail.cycleLedgerEvents) ? detail.cycleLedgerEvents : [];
	const reservations = Array.isArray(detail.reservations) ? detail.reservations : [];
	const runtimeMessages = Array.isArray(detail.runtimeMessages) ? detail.runtimeMessages : [];
	const currentItem = detail.currentItem || null;
	const issue = detail.issue || {};

	return (
		<div className={cardClass}>
			<SectionHeader
				title={`선택 주문 상세 · UID ${item.uid} / PID ${item.pid || '-'}`}
				description="목록 한 줄의 근거가 되는 거래소 이벤트, PID ledger, 보호주문, 내부 메시지를 같은 화면에서 확인합니다."
				action={
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onRefresh}
							className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
						>
							다시 조회
						</button>
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
						>
							닫기
						</button>
					</div>
				}
			/>
			<div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
				<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
					{getOrderProcessKind(item) === 'grid' ? <GridMetaCell item={item} /> : <AlgorithmMetaCell item={item} />}
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-xl border border-slate-200 bg-white p-4">
						<p className="text-xs uppercase tracking-wide text-slate-500">전체 결과</p>
						<div className="mt-2 flex items-center gap-2">
							<StatusBadge label={item.overallResultLabel || item.normalityLabel || '-'} />
							<StatusBadge label={item.currentStepLabel || '-'} />
						</div>
						<p className="mt-2 text-xs text-slate-500">{item.summaryText || '-'}</p>
						{issue.issueLabel ? (
							<>
								<div className="mt-3 flex flex-wrap gap-2">
									<InfoBadge label={issue.issueCategoryLabel || '문제'} tone={getOrderIssueTone(issue.issueCategory)} />
									<InfoBadge label={issue.issueSourceLabel || '-'} tone="slate" />
									<InfoBadge label={issue.issueLabel} tone={getOrderIssueTone(issue.issueCategory)} />
								</div>
								{issue.issueDetail ? <p className="mt-2 text-xs text-slate-500">{issue.issueDetail}</p> : null}
							</>
						) : null}
					</div>
					<div className="rounded-xl border border-slate-200 bg-white p-4">
						<p className="text-xs uppercase tracking-wide text-slate-500">웹훅 정보</p>
						<p className="mt-2 text-sm text-slate-900">{detail.webhook?.routePath || '-'}</p>
						<p className="mt-1 text-xs text-slate-500">
							{detail.webhook?.status || '-'} / {detail.webhook?.resultCode || '-'} / HTTP {detail.webhook?.httpStatus || '-'}
						</p>
					</div>
					<div className="rounded-xl border border-slate-200 bg-white p-4">
						<p className="text-xs uppercase tracking-wide text-slate-500">집계</p>
						<p className="mt-2 text-sm text-slate-900">
							Binance {counts.binanceEvents || 0} / Ledger {counts.cycleLedgerEvents || 0}
						</p>
						<p className="mt-1 text-xs text-slate-500">
							보호주문 {counts.reservations || 0} / 내부메시지 {counts.runtimeMessages || 0}
						</p>
					</div>
					<div className="rounded-xl border border-slate-200 bg-white p-4">
						<p className="text-xs uppercase tracking-wide text-slate-500">윈도우</p>
						<p className="mt-2 text-xs text-slate-700 break-all">{detail.window?.fromTime || '-'} ~ {detail.window?.toTime || '-'}</p>
						<p className="mt-1 text-xs text-slate-500">
							현재 상태 {currentItem?.runtimeStateLabel || currentItem?.userStatusLabel || currentItem?.userOverallStatusLabel || '-'}
						</p>
					</div>
				</div>
			</div>
			<div className="mt-6 grid gap-3 md:grid-cols-5">
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs uppercase tracking-wide text-slate-500">웹훅 수신</p>
					<div className="mt-2">{renderStageBadge(item.webhookStage)}</div>
				</div>
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs uppercase tracking-wide text-slate-500">대기</p>
					<div className="mt-2">{renderStageBadge(item.waitingStage)}</div>
				</div>
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs uppercase tracking-wide text-slate-500">진입</p>
					<div className="mt-2">{renderStageBadge(item.entryStage)}</div>
				</div>
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs uppercase tracking-wide text-slate-500">청산대기</p>
					<div className="mt-2">{renderStageBadge(item.exitPendingStage)}</div>
				</div>
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs uppercase tracking-wide text-slate-500">청산</p>
					<div className="mt-2">{renderStageBadge(item.exitStage)}</div>
				</div>
			</div>
			<div className="mt-6 space-y-6">
				<div className="space-y-3">
					<h3 className="text-base font-semibold text-slate-900">Binance Runtime Event</h3>
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-slate-200">
							<thead>
								<tr>
									<th className={tableHeadClass}>시각</th>
									<th className={tableHeadClass}>이벤트</th>
									<th className={tableHeadClass}>상태</th>
									<th className={tableHeadClass}>메모</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 bg-white">
								{binanceEvents.length === 0 ? (
									<tr>
										<td colSpan={4} className={`${tableCellClass} text-center text-slate-400`}>
											해당 Binance runtime event가 없습니다.
										</td>
									</tr>
								) : (
									binanceEvents.map((row) => (
										<tr key={`detail-binance-${row.id}`}>
											<td className={tableCellClass}>{formatDateTime(row.createdAt)}</td>
											<td className={tableCellClass}>
												<div className="font-semibold text-slate-900">{row.eventCodeLabel || row.eventCode || '-'}</div>
												<div className="mt-1 text-xs text-slate-500">{row.eventTypeLabel || row.eventType || '-'}</div>
											</td>
											<td className={tableCellClass}>
												<div className="text-sm font-semibold text-slate-700">
													{row.orderDisplayState || row.orderStatus || row.algoStatus || row.executionType || '-'}
												</div>
												<div className="mt-1 text-xs text-slate-500">
													{row.orderStatus || row.algoStatus || row.executionType || '-'} / {row.lifecycleResult || row.severityLabel || '-'}
												</div>
												<div className="mt-1 text-xs text-slate-500">
													판정 {row.normalityLabel || row.expectedOrAbnormal || '-'} / 위험 {row.riskStatus || '-'}
												</div>
												<div className="mt-1 text-xs text-slate-500">
													exec {renderNumberOrDash(row.executedQty, 8)} / remain {renderNumberOrDash(row.remainingQty, 8)}
												</div>
												{row.systemAction ? (
													<div className="mt-1 text-xs text-amber-700">{row.systemAction}</div>
												) : null}
											</td>
											<td className={tableCellClass}>
												<div>{row.note || '-'}</div>
												{row.normalizedReason ? <div className="mt-1 text-xs text-slate-500">{row.normalizedReason}</div> : null}
												{row.nextUserAction ? <div className="mt-1 text-xs text-rose-600">{row.nextUserAction}</div> : null}
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>
				<div className="grid gap-6 xl:grid-cols-2">
					<div className="space-y-3">
						<h3 className="text-base font-semibold text-slate-900">PID Ledger</h3>
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead>
									<tr>
										<th className={tableHeadClass}>시각</th>
										<th className={tableHeadClass}>이벤트</th>
										<th className={tableHeadClass}>수량/가격</th>
										<th className={tableHeadClass}>주문 ID</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{cycleLedgerEvents.length === 0 ? (
										<tr>
											<td colSpan={4} className={`${tableCellClass} text-center text-slate-400`}>
												해당 cycle ledger가 없습니다.
											</td>
										</tr>
									) : (
										cycleLedgerEvents.map((row) => (
											<tr key={`detail-ledger-${row.id}`}>
												<td className={tableCellClass}>{formatDateTime(row.tradeTime || row.createdAt)}</td>
												<td className={tableCellClass}>
													<div className="font-semibold text-slate-900">{row.eventType || '-'}</div>
													<div className="mt-1 text-xs text-slate-500">{row.positionSide || '-'}</div>
												</td>
												<td className={tableCellClass}>
													<div>{renderNumberOrDash(row.fillQty, 8)}</div>
													<div className="mt-1 text-xs text-slate-500">
														AVG {renderNumberOrDash(row.fillPrice, 10)} / PNL {renderNumberOrDash(row.realizedPnl, 4, ' USDT')}
													</div>
												</td>
												<td className={tableCellClass}>
													<div className="break-all text-xs text-slate-700">{row.sourceClientOrderId || '-'}</div>
													<div className="mt-1 text-xs text-slate-500">{row.sourceOrderId || '-'}</div>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
					<div className="space-y-3">
						<h3 className="text-base font-semibold text-slate-900">보호주문 Reservation</h3>
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead>
									<tr>
										<th className={tableHeadClass}>방향</th>
										<th className={tableHeadClass}>종류</th>
										<th className={tableHeadClass}>수량</th>
										<th className={tableHeadClass}>상태/주문 ID</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{reservations.length === 0 ? (
										<tr>
											<td colSpan={4} className={`${tableCellClass} text-center text-slate-400`}>
												보호주문 reservation이 없습니다.
											</td>
										</tr>
									) : (
										reservations.map((row) => (
											<tr key={`detail-reservation-${row.id}`}>
												<td className={tableCellClass}>{row.positionSide || '-'}</td>
												<td className={tableCellClass}>{row.reservationKind || '-'}</td>
												<td className={tableCellClass}>
													<div>{renderNumberOrDash(row.reservedQty, 8)}</div>
													<div className="mt-1 text-xs text-slate-500">filled {renderNumberOrDash(row.filledQty, 8)}</div>
												</td>
												<td className={tableCellClass}>
													<div className="font-semibold text-slate-900">{row.status || '-'}</div>
													<div className="mt-1 break-all text-xs text-slate-500">
														CID {row.clientOrderId || '-'} / ALGO {row.sourceOrderId || '-'} / EXCH {row.actualOrderId || '-'}
													</div>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
				</div>
				<div className="space-y-3">
					<h3 className="text-base font-semibold text-slate-900">내부 메시지</h3>
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-slate-200">
							<thead>
								<tr>
									<th className={tableHeadClass}>시각</th>
									<th className={tableHeadClass}>함수</th>
									<th className={tableHeadClass}>코드</th>
									<th className={tableHeadClass}>내용</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 bg-white">
								{runtimeMessages.length === 0 ? (
									<tr>
										<td colSpan={4} className={`${tableCellClass} text-center text-slate-400`}>
											해당 내부 메시지가 없습니다.
										</td>
									</tr>
								) : (
									runtimeMessages.map((row) => (
										<tr key={`detail-msg-${row.id}`}>
											<td className={tableCellClass}>{formatDateTime(row.createdAt)}</td>
											<td className={tableCellClass}>{row.funLabel || row.fun || '-'}</td>
											<td className={tableCellClass}>{row.codeLabel || row.code || '-'}</td>
											<td className={tableCellClass}>{row.summary || row.msg || '-'}</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	);
};

const SummaryCard = ({ title, value, description }) => (
	<div className={cardClass}>
		<p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</p>
		<p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
		<p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
	</div>
);

const accessModeButtonClass = (active) =>
	active
		? 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm'
		: 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700';

const referralShareOptions = [
	{ value: '0.1', label: '10%' },
	{ value: '0.2', label: '20%' },
	{ value: '0.3', label: '30%' },
	{ value: '0.4', label: '40%' },
	{ value: '0.5', label: '50%' }
];

const SectionHeader = ({ title, description, action }) => (
	<div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
		<div>
			<h2 className="text-xl font-semibold text-slate-900">{title}</h2>
			<p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
		</div>
		{action}
	</div>
);

const tableCellClass = 'px-3 py-3 align-top text-sm text-slate-700';
const tableHeadClass = 'px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';

const AdminConsole = () => {
	const { userInfo } = useAuthStore();
	const canAccessAdmin = Number(userInfo?.grade) <= 0;

	const [activeTopTab, setActiveTopTab] = useState('status');
	const [activeStatusTab, setActiveStatusTab] = useState('exchange');
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState('');

	const [sharedPrices, setSharedPrices] = useState({});
	const [opsUsers, setOpsUsers] = useState([]);
	const [selectedOpsUid, setSelectedOpsUid] = useState(null);
	const [selectedOpsUser, setSelectedOpsUser] = useState(null);
	const [orderProcesses, setOrderProcesses] = useState([]);
	const [selectedOrderProcessId, setSelectedOrderProcessId] = useState(null);
	const [selectedOrderProcessDetail, setSelectedOrderProcessDetail] = useState(null);
	const [orderProcessDetailLoading, setOrderProcessDetailLoading] = useState(false);
	const [controlAudits, setControlAudits] = useState([]);
	const [systemLogs, setSystemLogs] = useState([]);
	const [orderFilters, setOrderFilters] = useState({
		uid: '',
		pid: '',
		symbol: '',
		category: '',
		keyword: '',
		abnormalOnly: 'N'
	});
	const [controlFilters, setControlFilters] = useState({
		uid: '',
		pid: '',
		strategyCategory: '',
		actionCode: '',
		keyword: ''
	});
	const [systemFilters, setSystemFilters] = useState({
		category: '',
		keyword: '',
		abnormalOnly: 'Y'
	});

	const [strategyOverview, setStrategyOverview] = useState({ items: [], summary: {}, meta: {} });
	const [selectedStrategyId, setSelectedStrategyId] = useState(null);
	const [selectedStrategyItem, setSelectedStrategyItem] = useState(null);
	const [strategyForm, setStrategyForm] = useState(strategyEmptyForm);
	const [strategySymbolKeyword, setStrategySymbolKeyword] = useState('');
	const [strategySaving, setStrategySaving] = useState(false);

	const [managedUsers, setManagedUsers] = useState({ items: [], summary: {} });
	const [selectedManagedUid, setSelectedManagedUid] = useState(null);
	const [selectedManagedUser, setSelectedManagedUser] = useState(null);
	const [userFilters, setUserFilters] = useState({
		keyword: '',
		tradeAccessMode: '',
		strategyKey: ''
	});
	const [userSaving, setUserSaving] = useState(false);

	const [revenueFilters, setRevenueFilters] = useState({
		startDate: toDateInputValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
		endDate: toDateInputValue(new Date()),
		referralShareRate: '0.3'
	});
	const [revenueSummary, setRevenueSummary] = useState(null);

	const loadOrderProcesses = async (nextFilters = orderFilters) => {
		const response = await authRequest(auth.adminOrderProcessRecent.bind(auth), {
			limit: 120,
			uid: nextFilters.uid || undefined,
			pid: nextFilters.pid || undefined,
			symbol: nextFilters.symbol || undefined,
			category: nextFilters.category || undefined,
			keyword: nextFilters.keyword || undefined,
			abnormalOnly: nextFilters.abnormalOnly
		});
		const nextRows = Array.isArray(response) ? response : [];
		setOrderProcesses(nextRows);
		if (selectedOrderProcessId && !nextRows.some((item) => item.id === selectedOrderProcessId)) {
			setSelectedOrderProcessId(null);
			setSelectedOrderProcessDetail(null);
		}
	};

	const loadOrderProcessDetail = async (id) => {
		if (!id) {
			setSelectedOrderProcessId(null);
			setSelectedOrderProcessDetail(null);
			return;
		}
		setOrderProcessDetailLoading(true);
		const response = await authRequest(auth.adminOrderProcessItem.bind(auth), { id });
		setOrderProcessDetailLoading(false);
		if (!response || response.errors) {
			setMessage(response?.errors?.[0]?.msg || '주문 상세를 불러오지 못했습니다.');
			return;
		}
		setSelectedOrderProcessId(id);
		setSelectedOrderProcessDetail(response);
	};

	const loadControlAudits = async (nextFilters = controlFilters) => {
		const response = await authRequest(auth.adminStrategyControlAuditRecent.bind(auth), {
			limit: 120,
			uid: nextFilters.uid || undefined,
			pid: nextFilters.pid || undefined,
			strategyCategory: nextFilters.strategyCategory || undefined,
			actionCode: nextFilters.actionCode || undefined,
			keyword: nextFilters.keyword || undefined
		});
		setControlAudits(Array.isArray(response) ? response : []);
	};

	const loadSystemLogs = async (nextFilters = systemFilters) => {
		const response = await authRequest(auth.adminSystemLogRecent.bind(auth), {
			limit: 120,
			category: nextFilters.category || undefined,
			keyword: nextFilters.keyword || undefined,
			abnormalOnly: nextFilters.abnormalOnly
		});
		setSystemLogs(Array.isArray(response) ? response : []);
	};

	const loadStatusDashboard = async () => {
		const [priceRes, usersRes, orderRes, controlRes, systemRes] = await Promise.all([
			authRequest(auth.sharedPrices.bind(auth)),
			authRequest(auth.runtimeOpsUsersOverview.bind(auth), { hours: 24, limit: 100 }),
			authRequest(auth.adminOrderProcessRecent.bind(auth), {
				limit: 120,
				abnormalOnly: orderFilters.abnormalOnly
			}),
			authRequest(auth.adminStrategyControlAuditRecent.bind(auth), {
				limit: 120
			}),
			authRequest(auth.adminSystemLogRecent.bind(auth), {
				limit: 120,
				abnormalOnly: systemFilters.abnormalOnly
			})
		]);

		const nextUsers = Array.isArray(usersRes?.item)
			? usersRes.item
			: Array.isArray(usersRes?.items)
				? usersRes.items
				: Array.isArray(usersRes)
					? usersRes
					: [];

		setSharedPrices(priceRes && !priceRes.errors ? priceRes : {});
		setOpsUsers(nextUsers);
		const nextOrderRows = Array.isArray(orderRes) ? orderRes : [];
		setOrderProcesses(nextOrderRows);
		if (selectedOrderProcessId && !nextOrderRows.some((item) => item.id === selectedOrderProcessId)) {
			setSelectedOrderProcessId(null);
			setSelectedOrderProcessDetail(null);
		}
		setControlAudits(Array.isArray(controlRes) ? controlRes : []);
		setSystemLogs(Array.isArray(systemRes) ? systemRes : []);

		const preferredUid = nextUsers.find((item) => item.hasCredentials)?.uid ?? nextUsers[0]?.uid ?? null;
		setSelectedOpsUid((prev) => prev || preferredUid);
	};

	const loadSelectedOpsUser = async (uid) => {
		if (!uid) {
			setSelectedOpsUser(null);
			return;
		}
		const response = await authRequest(auth.runtimeOpsUserItem.bind(auth), { uid, hours: 24 });
		setSelectedOpsUser(response && !response.errors ? response : null);
	};

	const loadStrategyOverview = async () => {
		const response = await authRequest(auth.adminStrategyOverview.bind(auth), {});
		if (response && !response.errors) {
			setStrategyOverview(response);
			const firstId = response.items?.[0]?.id || null;
			setSelectedStrategyId((prev) => prev || firstId);
		}
	};

	const loadSelectedStrategy = async (id) => {
		if (!id) {
			setSelectedStrategyItem(null);
			setStrategyForm(strategyEmptyForm);
			return;
		}
		const response = await authRequest(auth.adminStrategyItem.bind(auth), { id });
		if (response && !response.errors) {
			setSelectedStrategyItem(response);
			setStrategySymbolKeyword('');
			setStrategyForm({
				id: String(response.id || ''),
				strategyCategory: response.strategyCategory || 'signal',
				strategyName: response.strategyName || '',
				signalName: response.signalName || '',
				allowedSymbols: Array.isArray(response.allowedSymbols) ? response.allowedSymbols : [],
				allowedTimeframesText: Array.isArray(response.allowedTimeframes) ? response.allowedTimeframes.join(', ') : '',
				permissionMode: response.permissionMode || 'ALL',
				allowedMemberIdsText: Array.isArray(response.allowedMembers)
					? response.allowedMembers.map((item) => item.memId || item.uid).join(', ')
					: '',
				isActive: response.isActive ? 'Y' : 'N',
				notes: response.notes || ''
			});
		}
	};

	const loadManagedUsers = async (nextFilters = userFilters) => {
		const response = await authRequest(auth.adminUsersOverview.bind(auth), {
			keyword: nextFilters.keyword || undefined,
			tradeAccessMode: nextFilters.tradeAccessMode || undefined,
			strategyKey: nextFilters.strategyKey || undefined
		});
		if (response && !response.errors) {
			setManagedUsers(response);
			const firstUid = response.items?.[0]?.uid || null;
			setSelectedManagedUid((prev) => prev || firstUid);
		}
	};

	const loadSelectedManagedUser = async (uid) => {
		if (!uid) {
			setSelectedManagedUser(null);
			return;
		}
		const response = await authRequest(auth.adminUserItem.bind(auth), { uid });
		setSelectedManagedUser(response && !response.errors ? response : null);
	};

	const loadRevenueSummary = async (nextFilters = revenueFilters) => {
		const response = await authRequest(auth.adminRevenueSummary.bind(auth), nextFilters);
		setRevenueSummary(response && !response.errors ? response : null);
	};

	useEffect(() => {
		if (!canAccessAdmin) return;
		setLoading(true);
		setMessage('');
		Promise.all([
			loadStatusDashboard(),
			loadStrategyOverview(),
			loadManagedUsers(),
			loadRevenueSummary()
		])
			.catch(() => setMessage('愿由ъ옄 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??'))
			.finally(() => setLoading(false));
	}, [canAccessAdmin]);

	useEffect(() => {
		if (!canAccessAdmin || !selectedOpsUid) return;
		loadSelectedOpsUser(selectedOpsUid).catch(() => setMessage('?댁쁺 ?ъ슜???곸꽭瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??'));
	}, [canAccessAdmin, selectedOpsUid]);

	useEffect(() => {
		if (!canAccessAdmin || !selectedStrategyId) return;
		loadSelectedStrategy(selectedStrategyId).catch(() => setMessage('?꾨왂 ?곸꽭瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??'));
	}, [canAccessAdmin, selectedStrategyId]);

	useEffect(() => {
		if (!canAccessAdmin || !selectedManagedUid) return;
		loadSelectedManagedUser(selectedManagedUid).catch(() => setMessage('?ъ슜???곸꽭瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??'));
	}, [canAccessAdmin, selectedManagedUid]);

	const exchangeRows = useMemo(() => {
		return Object.values(sharedPrices || {}).map((row) => {
			const freshnessMs = Math.max(0, Date.now() - Number(row?.lastTradeTime || 0));
			const abnormal = !row?.st || freshnessMs > 15000;
			return {
				...row,
				abnormal,
				freshnessMs,
				statusLabel: abnormal ? '비정상' : '정상',
				statusDetail: !row?.st ? '가격 미수신' : freshnessMs > 15000 ? '가격 갱신 지연' : '최근 15초 내 수신'
			};
		});
	}, [sharedPrices]);

	const abnormalExchangeRows = useMemo(() => exchangeRows.filter((item) => item.abnormal), [exchangeRows]);
	const abnormalAccountRows = useMemo(
		() => (managedUsers.items || []).filter((item) => item.hasCredentials && item.tradeAccessMode === 'LIVE_DEMO' && (!item.latestRisk || item.latestRisk.riskLevel !== 'SAFE')),
		[managedUsers]
	);
	const abnormalSystemLogs = useMemo(() => systemLogs.filter((item) => item.abnormal), [systemLogs]);
	const abnormalOrderProcesses = useMemo(
		() =>
			orderProcesses.filter(
				(item) =>
					!item.isExpectedIgnore &&
					(
						String(item.summaryStatusLabel || '').trim() === '비정상' ||
						String(item.summaryStatusLabel || '').trim() === '확인 필요' ||
						String(item.normality || '').toUpperCase() === 'ABNORMAL' ||
						String(item.expectedOrAbnormal || '').toUpperCase() === 'ABNORMAL' ||
						Boolean(item.isAbnormal)
					)
			),
		[orderProcesses]
	);
	const algorithmOrderProcesses = useMemo(
		() => orderProcesses.filter((item) => getOrderProcessKind(item) === 'algorithm'),
		[orderProcesses]
	);
	const gridOrderProcesses = useMemo(
		() => orderProcesses.filter((item) => getOrderProcessKind(item) === 'grid'),
		[orderProcesses]
	);
	const exchangeSymbolOptions = useMemo(() => {
		const items = Array.isArray(strategyOverview.meta?.exchangeSymbolCatalog?.items)
			? strategyOverview.meta.exchangeSymbolCatalog.items
			: [];
		const keyword = String(strategySymbolKeyword || '').trim().toUpperCase();
		if (!keyword) {
			return items;
		}
		return items.filter((item) => String(item.symbol || '').includes(keyword));
	}, [strategyOverview.meta, strategySymbolKeyword]);

	const handleToggleListValue = (field, value) => {
		setStrategyForm((prev) => {
			const current = Array.isArray(prev[field]) ? prev[field] : [];
			const exists = current.includes(value);
			return {
				...prev,
				[field]: exists ? current.filter((item) => item !== value) : current.concat(value)
			};
		});
	};

	const handleStrategySave = async () => {
		setStrategySaving(true);
		setMessage('');
		const response = await authRequest(auth.adminStrategySave.bind(auth), {
			id: strategyForm.id || undefined,
			strategyCategory: strategyForm.strategyCategory,
			strategyName: strategyForm.strategyName,
			signalName: strategyForm.signalName,
			allowedSymbols: strategyForm.allowedSymbols,
			allowedTimeframes: strategyForm.allowedTimeframesText,
			permissionMode: strategyForm.permissionMode,
			allowedMemberIds: strategyForm.allowedMemberIdsText,
			isActive: strategyForm.isActive,
			notes: strategyForm.notes
		});
		setStrategySaving(false);
		if (!response || response.errors) {
			setMessage(response?.errors?.[0]?.msg || '?꾨왂 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.');
			return;
		}
		await loadStrategyOverview();
		if (response.id) {
			setSelectedStrategyId(Number(response.id));
		}
		setMessage('?꾨왂 ??μ씠 ?꾨즺?섏뿀?듬땲??');
	};

	const handleStrategyDelete = async () => {
		if (!strategyForm.id) return;
		if (!window.confirm('?좏깮???꾨왂 移댄깉濡쒓렇瑜???젣?좉퉴?? ?ъ슜 以묒씤 ?꾨왂???덉쑝硫???젣?섏? ?딆뒿?덈떎.')) {
			return;
		}
		const response = await authRequest(auth.adminStrategyDelete.bind(auth), { id: strategyForm.id });
		if (!response || response.errors) {
			setMessage(response?.errors?.[0]?.msg || '?꾨왂 ??젣???ㅽ뙣?덉뒿?덈떎.');
			return;
		}
		setSelectedStrategyId(null);
		setSelectedStrategyItem(null);
		setStrategyForm(strategyEmptyForm);
		await loadStrategyOverview();
		setMessage('?꾨왂 ??젣媛 ?꾨즺?섏뿀?듬땲??');
	};

	const handleUserAccessSave = async (mode) => {
		if (!selectedManagedUser?.uid) return;
		setUserSaving(true);
		const response = await authRequest(auth.adminUserTradeAccess.bind(auth), {
			uid: selectedManagedUser.uid,
			tradeAccessMode: mode
		});
		setUserSaving(false);
		if (!response || response.errors) {
			setMessage(response?.errors?.[0]?.msg || '?ъ슜??沅뚰븳 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎.');
			return;
		}
		await Promise.all([loadManagedUsers(), loadSelectedManagedUser(selectedManagedUser.uid)]);
		setMessage('?ъ슜??嫄곕옒 沅뚰븳????ν뻽?듬땲??');
	};

	const handleUserDelete = async () => {
		if (!selectedManagedUser?.uid) return;
		if (!window.confirm('?좏깮???ъ슜?먮? ??젣?좉퉴?? ?꾨왂/嫄곕옒 ?대젰???⑥븘 ?덉쑝硫???젣?섏? ?딆뒿?덈떎.')) {
			return;
		}
		const response = await authRequest(auth.adminUserDelete.bind(auth), { uid: selectedManagedUser.uid });
		if (!response || response.errors) {
			setMessage(response?.errors?.[0]?.msg || '?ъ슜????젣???ㅽ뙣?덉뒿?덈떎.');
			return;
		}
		setSelectedManagedUid(null);
		setSelectedManagedUser(null);
		await loadManagedUsers();
		setMessage('?ъ슜????젣媛 ?꾨즺?섏뿀?듬땲??');
	};

	if (!canAccessAdmin) {
		return (
			<div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				관리자 권한이 없는 계정입니다.
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="rounded-2xl bg-slate-900 p-6 text-white shadow-lg">
				<p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-300">Operations Console</p>
				<h1 className="mt-3 text-3xl font-semibold">관리자 콘솔</h1>
				<p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
					실시간 운영 상태와 주문 lifecycle을 정본 기준으로 확인합니다. expected-ignore 이벤트는 INFO로 분리하고,
					실제 사용자 조치가 필요한 WARN/CRITICAL만 운영 리스크로 집계합니다.
				</p>
			</div>

			{message ? (
				<div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{message}</div>
			) : null}

			<div className="flex flex-wrap gap-2">
				{topTabs.map((tab) => (
					<button
						key={tab.key}
						type="button"
						onClick={() => setActiveTopTab(tab.key)}
						className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
							activeTopTab === tab.key
								? 'bg-slate-900 text-white'
								: 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			{loading ? (
				<div className={cardClass}>관리자 데이터를 불러오는 중입니다.</div>
			) : null}

			{activeTopTab === 'status' ? (
				<div className="space-y-6">
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
						<SummaryCard
							title="공통 데이터"
							value={abnormalExchangeRows.length}
							description="WARN/CRITICAL 가격 피드 지연 종목 수입니다. INFO expected-ignore는 제외합니다."
						/>
						<SummaryCard
							title="주문 프로세스"
							value={abnormalOrderProcesses.length}
							description="정본 lifecycle 기준 CRITICAL/확인 필요 주문 흐름 수입니다."
						/>
						<SummaryCard
							title="최근 제어 이벤트"
							value={controlAudits.length}
							description="수동 ON/OFF, 정책 OFF, 시스템 READY 복귀 같은 운용 상태 변경 이력 수입니다."
						/>
						<SummaryCard
							title="계정 연결"
							value={abnormalAccountRows.length}
							description="권한/잔고/리스크 확인이 필요한 사용자 수입니다."
						/>
						<SummaryCard
							title="시스템 로그"
							value={abnormalSystemLogs.length}
							description="WARN/CRITICAL 시스템 로그 수입니다."
						/>
					</div>

					<div className="flex flex-wrap gap-2">
						{statusTabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => setActiveStatusTab(tab.key)}
								className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
									activeStatusTab === tab.key
										? 'bg-slate-900 text-white'
										: 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>

					{activeStatusTab === 'exchange' ? (
						<div className={cardClass}>
							<SectionHeader
								title="거래소 공통 상태"
								description="모든 사용자가 같이 쓰는 가격 피드 상태입니다. 여기 이상이 있으면 전체 진입·청산 판단이 흔들립니다."
							/>
							<div className="mt-6 overflow-x-auto">
								<table className="min-w-full divide-y divide-slate-200">
									<thead>
										<tr>
											<th className={tableHeadClass}>종목</th>
											<th className={tableHeadClass}>상태</th>
											<th className={tableHeadClass}>최근가</th>
											<th className={tableHeadClass}>매수/매도 호가</th>
											<th className={tableHeadClass}>마지막 체결</th>
											<th className={tableHeadClass}>상태 설명</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{exchangeRows.map((row) => (
											<tr key={row.symbol}>
												<td className={tableCellClass}>{row.symbol}</td>
												<td className={tableCellClass}>
													<StatusBadge label={row.statusLabel} />
												</td>
												<td className={tableCellClass}>{formatNumber(row.lastPrice, 6)}</td>
												<td className={tableCellClass}>
													{formatNumber(row.bestBid, 6)} / {formatNumber(row.bestAsk, 6)}
												</td>
												<td className={tableCellClass}>{formatAgo(row.lastTradeTime)}</td>
												<td className={tableCellClass}>{row.statusDetail}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					{activeStatusTab === 'orders' ? (
						<div className={cardClass}>
							<SectionHeader
								title="사용자 주문 로그"
								description="각 PID에 매칭된 웹훅 한 건이 어떻게 마무리됐는지 보여줍니다. 전체 결과는 최종 종료 상태를, 처리 요약은 지금 어디서 끝났는지 또는 왜 멈췄는지를 뜻합니다."
								action={
									<button
										type="button"
										onClick={() => loadOrderProcesses(orderFilters)}
										className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
									>
										새로고침
									</button>
								}
							/>
							<div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
								<input className={inputClass} placeholder="사용자 ID" value={orderFilters.uid} onChange={(e) => setOrderFilters((prev) => ({ ...prev, uid: e.target.value }))} />
								<input className={inputClass} placeholder="전략 PID" value={orderFilters.pid} onChange={(e) => setOrderFilters((prev) => ({ ...prev, pid: e.target.value }))} />
								<input className={inputClass} placeholder="종목" value={orderFilters.symbol} onChange={(e) => setOrderFilters((prev) => ({ ...prev, symbol: e.target.value }))} />
								<select className={selectClass} value={orderFilters.category} onChange={(e) => setOrderFilters((prev) => ({ ...prev, category: e.target.value }))}>
									<option value="">전체 전략 구분</option>
									<option value="signal">알고리즘</option>
									<option value="grid">그리드</option>
								</select>
								<input className={inputClass} placeholder="전략명/키워드" value={orderFilters.keyword} onChange={(e) => setOrderFilters((prev) => ({ ...prev, keyword: e.target.value }))} />
								<select className={selectClass} value={orderFilters.abnormalOnly} onChange={(e) => setOrderFilters((prev) => ({ ...prev, abnormalOnly: e.target.value }))}>
									<option value="N">전체 보기</option>
									<option value="Y">비정상만 보기</option>
								</select>
							</div>
							<div className="mt-3 flex justify-end">
								<button
									type="button"
									onClick={() => loadOrderProcesses(orderFilters)}
									className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
								>
									필터 적용
								</button>
							</div>
							<div className="mt-6 space-y-8">
								<div className="space-y-3">
									<div>
										<h3 className="text-base font-semibold text-slate-900">알고리즘 주문 로그</h3>
										<p className="mt-1 text-sm text-slate-500">웹훅수신 → 진입대기 → 진입 → 청산 기준으로 각 PID 주문 사이클을 봅니다.</p>
									</div>
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-slate-200">
											<thead>
												<tr>
													<th className={tableHeadClass}>사용자/전략</th>
													<th className={tableHeadClass}>설정/상태</th>
													<th className={tableHeadClass}>전체 결과</th>
													<th className={tableHeadClass}>처리 요약</th>
													<th className={tableHeadClass}>웹훅수신</th>
													<th className={tableHeadClass}>진입대기</th>
													<th className={tableHeadClass}>진입</th>
													<th className={tableHeadClass}>청산</th>
													<th className={tableHeadClass}>웹훅 발생</th>
													<th className={tableHeadClass}>청산 시각</th>
													<th className={tableHeadClass}>비정상 시각</th>
													<th className={tableHeadClass}>작업</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100 bg-white">
												{algorithmOrderProcesses.length === 0 ? (
													<tr>
														<td colSpan={12} className={`${tableCellClass} text-center text-slate-400`}>
															표시할 알고리즘 주문 로그가 없습니다.
														</td>
													</tr>
												) : (
													algorithmOrderProcesses.map((item) => (
														<tr key={item.id} className={selectedOrderProcessId === item.id ? 'bg-slate-50' : ''}>
															<td className={tableCellClass}>
																<div className="font-semibold text-slate-900">UID {item.uid} / PID {item.pid || '-'}</div>
																<div className="mt-1 text-xs text-slate-500">{item.strategyName || '-'}</div>
															</td>
															<td className={tableCellClass}>
																<AlgorithmMetaCell item={item} />
															</td>
															<td className={tableCellClass}>
																<StatusBadge label={item.overallResultLabel || (item.completed ? '완료' : '진행중')} />
															</td>
															<td className={tableCellClass}>
																<div className="font-semibold text-slate-900">{item.summaryText || '-'}</div>
																{item.issueLabel ? (
																	<div className="mt-2 flex flex-wrap gap-1.5">
																		<InfoBadge label={item.issueCategoryLabel || '문제'} tone={getOrderIssueTone(item.issueCategory)} />
																		<InfoBadge label={item.issueSourceLabel || '-'} tone="slate" />
																	</div>
																) : null}
																{item.latestRuntimeIssue?.detail ? (
																	<div className="mt-1 text-xs text-rose-600">
																		최신 내부 이슈: {item.latestRuntimeIssue.detail}
																	</div>
																) : null}
															</td>
															<td className={tableCellClass}>{renderStageBadge(item.algorithmProcess?.webhook)}</td>
															<td className={tableCellClass}>{renderStageBadge(item.algorithmProcess?.exactWait)}</td>
															<td className={tableCellClass}>{renderStageBadge(item.algorithmProcess?.entry)}</td>
															<td className={tableCellClass}>{renderStageBadge(item.algorithmProcess?.exit)}</td>
															<td className={tableCellClass}>{formatDateTime(item.webhookOccurredAt || item.createdAt)}</td>
															<td className={tableCellClass}>{formatDateTime(item.completedAt)}</td>
															<td className={tableCellClass}>{formatDateTime(item.abnormalAt)}</td>
															<td className={tableCellClass}>
																<button
																	type="button"
																	onClick={() => loadOrderProcessDetail(item.id)}
																	className={`rounded-lg px-3 py-2 text-xs font-semibold ${
																		selectedOrderProcessId === item.id
																			? 'bg-slate-900 text-white'
																			: 'border border-slate-300 bg-white text-slate-700'
																	}`}
																>
																	상세
																</button>
															</td>
														</tr>
													))
												)}
											</tbody>
										</table>
									</div>
								</div>

								<div className="space-y-3">
									<div>
										<h3 className="text-base font-semibold text-slate-900">그리드 주문 로그</h3>
										<p className="mt-1 text-sm text-slate-500">웹훅수신 → Gridding → 종료 기준으로 한 PID의 한 레짐 시리즈를 봅니다.</p>
									</div>
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-slate-200">
											<thead>
												<tr>
													<th className={tableHeadClass}>사용자/전략</th>
													<th className={tableHeadClass}>설정/상태</th>
													<th className={tableHeadClass}>전체 결과</th>
													<th className={tableHeadClass}>처리 요약</th>
													<th className={tableHeadClass}>웹훅수신</th>
													<th className={tableHeadClass}>Gridding</th>
													<th className={tableHeadClass}>종료</th>
													<th className={tableHeadClass}>웹훅 발생</th>
													<th className={tableHeadClass}>종료 시각</th>
													<th className={tableHeadClass}>비정상 시각</th>
													<th className={tableHeadClass}>작업</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100 bg-white">
												{gridOrderProcesses.length === 0 ? (
													<tr>
														<td colSpan={11} className={`${tableCellClass} text-center text-slate-400`}>
															표시할 그리드 주문 로그가 없습니다.
														</td>
													</tr>
												) : (
													gridOrderProcesses.map((item) => (
														<tr key={item.id} className={selectedOrderProcessId === item.id ? 'bg-slate-50' : ''}>
															<td className={tableCellClass}>
																<div className="font-semibold text-slate-900">UID {item.uid} / PID {item.pid || '-'}</div>
																<div className="mt-1 text-xs text-slate-500">{item.strategyName || item.strategyKey || '-'}</div>
															</td>
															<td className={tableCellClass}>
																<GridMetaCell item={item} />
															</td>
															<td className={tableCellClass}>
																<StatusBadge label={item.overallResultLabel || (item.completed ? '완료' : '진행중')} />
															</td>
															<td className={tableCellClass}>
																<div className="font-semibold text-slate-900">{item.summaryText || '-'}</div>
																{item.issueLabel ? (
																	<div className="mt-2 flex flex-wrap gap-1.5">
																		<InfoBadge label={item.issueCategoryLabel || '문제'} tone={getOrderIssueTone(item.issueCategory)} />
																		<InfoBadge label={item.issueSourceLabel || '-'} tone="slate" />
																	</div>
																) : null}
																{item.latestRuntimeIssue?.detail ? (
																	<div className="mt-1 text-xs text-rose-600">
																		최신 내부 이슈: {item.latestRuntimeIssue.detail}
																	</div>
																) : null}
															</td>
															<td className={tableCellClass}>{renderStageBadge(item.gridProcess?.webhook)}</td>
															<td className={tableCellClass}>{renderStageBadge(item.gridProcess?.gridding)}</td>
															<td className={tableCellClass}>{renderStageBadge(item.gridProcess?.finish)}</td>
															<td className={tableCellClass}>{formatDateTime(item.webhookOccurredAt || item.createdAt)}</td>
															<td className={tableCellClass}>{formatDateTime(item.completedAt)}</td>
															<td className={tableCellClass}>{formatDateTime(item.abnormalAt)}</td>
															<td className={tableCellClass}>
																<button
																	type="button"
																	onClick={() => loadOrderProcessDetail(item.id)}
																	className={`rounded-lg px-3 py-2 text-xs font-semibold ${
																		selectedOrderProcessId === item.id
																			? 'bg-slate-900 text-white'
																			: 'border border-slate-300 bg-white text-slate-700'
																	}`}
																>
																	상세
																</button>
															</td>
														</tr>
													))
												)}
											</tbody>
										</table>
									</div>
								</div>
								<OrderProcessDetailPanel
									item={selectedOrderProcessDetail}
									loading={orderProcessDetailLoading}
									onRefresh={() => loadOrderProcessDetail(selectedOrderProcessId)}
									onClose={() => {
										setSelectedOrderProcessId(null);
										setSelectedOrderProcessDetail(null);
									}}
								/>
							</div>
						</div>
					) : null}

					{activeStatusTab === 'controls' ? (
						<div className={cardClass}>
							<SectionHeader
								title="전략 제어 이력"
								description="전략이 언제, 누구에 의해, 어떤 이유로 ON/OFF 또는 READY 복귀됐는지 바로 확인하는 영역입니다. PID18 같은 의도치 않은 상태 변경 추적용으로 씁니다."
								action={
									<button
										type="button"
										onClick={() => loadControlAudits(controlFilters)}
										className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
									>
										새로고침
									</button>
								}
							/>
							<div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
								<input
									className={inputClass}
									placeholder="사용자 ID"
									value={controlFilters.uid}
									onChange={(e) => setControlFilters((prev) => ({ ...prev, uid: e.target.value }))}
								/>
								<input
									className={inputClass}
									placeholder="전략 PID"
									value={controlFilters.pid}
									onChange={(e) => setControlFilters((prev) => ({ ...prev, pid: e.target.value }))}
								/>
								<select
									className={selectClass}
									value={controlFilters.strategyCategory}
									onChange={(e) => setControlFilters((prev) => ({ ...prev, strategyCategory: e.target.value }))}
								>
									<option value="">전체 전략 구분</option>
									<option value="signal">알고리즘</option>
									<option value="grid">그리드</option>
								</select>
								<select
									className={selectClass}
									value={controlFilters.actionCode}
									onChange={(e) => setControlFilters((prev) => ({ ...prev, actionCode: e.target.value }))}
								>
									<option value="">전체 제어 이벤트</option>
									<option value="TOGGLE">수동 ON/OFF</option>
									<option value="USER_ON">사용자 ON</option>
									<option value="USER_OFF">사용자 OFF</option>
									<option value="SYSTEM_RESET_READY">시스템 READY 복귀</option>
									<option value="POLICY_AUTO_OFF_USER_SOFT">정책 사용자 OFF</option>
									<option value="POLICY_AUTO_OFF_USER_HARD">정책 사용자 강제 OFF</option>
									<option value="POLICY_AUTO_OFF_STRATEGY">정책 전략 OFF</option>
									<option value="CREATE">생성</option>
									<option value="DELETE">삭제</option>
									<option value="USER_DELETE_STRATEGY">사용자 전략 삭제</option>
								</select>
								<input
									className={inputClass}
									placeholder="메모/IP/메타데이터 키워드"
									value={controlFilters.keyword}
									onChange={(e) => setControlFilters((prev) => ({ ...prev, keyword: e.target.value }))}
								/>
							</div>
							<div className="mt-3 flex justify-end">
								<button
									type="button"
									onClick={() => loadControlAudits(controlFilters)}
									className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
								>
									필터 적용
								</button>
							</div>
							<div className="mt-6 overflow-x-auto">
								<table className="min-w-full divide-y divide-slate-200">
									<thead>
										<tr>
											<th className={tableHeadClass}>발생 시각</th>
											<th className={tableHeadClass}>사용자/전략</th>
											<th className={tableHeadClass}>전략 구분</th>
											<th className={tableHeadClass}>제어 이벤트</th>
											<th className={tableHeadClass}>운용 변경</th>
											<th className={tableHeadClass}>요청 주체</th>
											<th className={tableHeadClass}>사유</th>
											<th className={tableHeadClass}>상세</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{controlAudits.length === 0 ? (
											<tr>
												<td colSpan={8} className={`${tableCellClass} text-center text-slate-400`}>
													표시할 전략 제어 이력이 없습니다.
												</td>
											</tr>
										) : (
											controlAudits.map((item) => {
												const sourceMeta = getControlSourceMeta(item);
												return (
													<tr key={item.id}>
														<td className={tableCellClass}>{formatDateTime(item.createdAt)}</td>
														<td className={tableCellClass}>
															<div className="font-semibold text-slate-900">UID {item.targetUserId || '-'} / PID {item.pid || '-'}</div>
															<div className="mt-1 text-xs text-slate-500">
																actor UID {item.actorUserId || '-'} / mode {item.strategyMode || '-'}
															</div>
														</td>
														<td className={tableCellClass}>
															<InfoBadge label={formatStrategyCategoryLabel(item.strategyCategory)} tone="slate" />
														</td>
														<td className={tableCellClass}>
															<div className="font-semibold text-slate-900">{formatControlActionLabel(item.actionCode)}</div>
															<div className="mt-1 text-xs text-slate-500">{item.actionCode || '-'}</div>
														</td>
														<td className={tableCellClass}>
															<InfoBadge
																label={formatControlChangeLabel(item.previousEnabled, item.nextEnabled)}
																tone={isEnabledState(item.nextEnabled) ? 'emerald' : 'amber'}
															/>
														</td>
														<td className={tableCellClass}>
															<InfoBadge label={sourceMeta.label} tone={sourceMeta.tone} />
														</td>
														<td className={tableCellClass}>
															<div className="font-semibold text-slate-900">{item.note || '-'}</div>
														</td>
														<td className={tableCellClass}>
															<div className="text-xs text-slate-600">IP/Source: {item.requestIp || '-'}</div>
															<div className="mt-1 text-xs text-slate-500 break-all">
																{item.metadata ? JSON.stringify(item.metadata) : '-'}
															</div>
														</td>
													</tr>
												);
											})
										)}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					{activeStatusTab === 'accounts' ? (
						<div className={cardClass}>
							<SectionHeader
								title="사용자 계정 연결"
								description="개별 사용자 계정의 연결 상태와 현재 리스크를 봅니다. 우리 시스템 문제인지, 사용자 계정 문제인지 분리해서 판단하는 용도입니다."
							/>
							<div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-slate-200">
										<thead>
											<tr>
												<th className={tableHeadClass}>사용자</th>
												<th className={tableHeadClass}>권한</th>
												<th className={tableHeadClass}>API 연결</th>
												<th className={tableHeadClass}>리스크</th>
												<th className={tableHeadClass}>손익/거래금액</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100 bg-white">
											{managedUsers.items.map((item) => (
												<tr
													key={item.uid}
													className={`cursor-pointer ${selectedManagedUid === item.uid ? 'bg-slate-50' : ''}`}
													onClick={() => setSelectedManagedUid(item.uid)}
												>
													<td className={tableCellClass}>
														<div className="font-semibold text-slate-900">{item.memId}</div>
														<div className="mt-1 text-xs text-slate-500">{item.memName || '-'} / UID {item.uid}</div>
													</td>
													<td className={tableCellClass}><StatusBadge label={item.tradeAccessMode === 'LIVE_DEMO' ? '실거래+모의' : '모의만'} /></td>
													<td className={tableCellClass}><StatusBadge label={item.hasCredentials ? '연결됨' : '미등록'} /></td>
													<td className={tableCellClass}>
														<div className="font-semibold text-slate-900">{item.latestRisk?.riskLevel || 'UNKNOWN'}</div>
														<div className="mt-1 text-xs text-slate-500">MR {formatNumber(item.latestRisk?.accountMarginRatio || 0, 2)}%</div>
													</td>
													<td className={tableCellClass}>
														<div>{formatNumber(item.totalPnl, 4)} USDT</div>
														<div className="mt-1 text-xs text-slate-500">거래금액 {formatNumber(item.liveTradeAmount, 2)}</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
								<div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5">
									<h3 className="text-lg font-semibold text-slate-900">선택 사용자</h3>
									{selectedManagedUser ? (
										<>
											<div className="grid gap-3 sm:grid-cols-2">
												<div>
													<p className="text-xs uppercase tracking-wide text-slate-500">사용자</p>
													<p className="mt-1 font-semibold text-slate-900">{selectedManagedUser.memId}</p>
													<p className="text-sm text-slate-500">{selectedManagedUser.memName || '-'}</p>
												</div>
												<div>
													<p className="text-xs uppercase tracking-wide text-slate-500">권한</p>
													<div className="mt-1">
														<StatusBadge label={selectedManagedUser.tradeAccessMode === 'LIVE_DEMO' ? '실거래+모의' : '모의만'} />
													</div>
												</div>
												<div>
													<p className="text-xs uppercase tracking-wide text-slate-500">연락처</p>
													<p className="mt-1 text-sm text-slate-700">{selectedManagedUser.mobile || '-'}</p>
													<p className="text-sm text-slate-500">{selectedManagedUser.email || '-'}</p>
												</div>
												<div>
													<p className="text-xs uppercase tracking-wide text-slate-500">리스크</p>
													<p className="mt-1 text-sm text-slate-700">{selectedManagedUser.latestRisk?.riskLevel || 'UNKNOWN'}</p>
													<p className="text-sm text-slate-500">마진 레이셔 {formatNumber(selectedManagedUser.latestRisk?.accountMarginRatio || 0, 2)}%</p>
												</div>
											</div>
											<div className="flex flex-wrap gap-2">
												<button
													type="button"
													disabled={userSaving}
													onClick={() => handleUserAccessSave('LIVE_DEMO')}
													className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
												>
													실거래+모의 허용
												</button>
												<button
													type="button"
													disabled={userSaving}
													onClick={() => handleUserAccessSave('DEMO_ONLY')}
													className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
												>
													모의만 허용
												</button>
												<button
													type="button"
													disabled={userSaving}
													onClick={handleUserDelete}
													className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
												>
													사용자 삭제
												</button>
											</div>
										</>
									) : (
										<p className="text-sm text-slate-500">왼쪽 목록에서 사용자를 선택해 주세요.</p>
									)}
								</div>
							</div>
						</div>
					) : null}

					{activeStatusTab === 'system' ? (
						<div className={cardClass}>
							<SectionHeader
								title="시스템 로그"
								description="거래소 주문 로그가 아니라 통계 웹훅, 서버, 자체 프로그램 오류만 모아 보는 영역입니다."
								action={
									<button
										type="button"
										onClick={() => loadSystemLogs(systemFilters)}
										className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
									>
										새로고침
									</button>
								}
							/>
							<div className="mt-6 grid gap-3 md:grid-cols-3">
								<select className={selectClass} value={systemFilters.category} onChange={(e) => setSystemFilters((prev) => ({ ...prev, category: e.target.value }))}>
									<option value="">전체 범주</option>
									<option value="TV_STATS_WEBHOOK">트뷰 통계 웹훅</option>
									<option value="SERVER">서버</option>
									<option value="PROGRAM">자체 프로그램 오류</option>
								</select>
								<input className={inputClass} placeholder="키워드" value={systemFilters.keyword} onChange={(e) => setSystemFilters((prev) => ({ ...prev, keyword: e.target.value }))} />
								<select className={selectClass} value={systemFilters.abnormalOnly} onChange={(e) => setSystemFilters((prev) => ({ ...prev, abnormalOnly: e.target.value }))}>
									<option value="Y">비정상만 보기</option>
									<option value="N">전체 보기</option>
								</select>
							</div>
							<div className="mt-3 flex justify-end">
								<button
									type="button"
									onClick={() => loadSystemLogs(systemFilters)}
									className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
								>
									필터 적용
								</button>
							</div>
							<div className="mt-6 overflow-x-auto">
								<table className="min-w-full divide-y divide-slate-200">
									<thead>
										<tr>
											<th className={tableHeadClass}>범주</th>
											<th className={tableHeadClass}>상태</th>
											<th className={tableHeadClass}>제목</th>
											<th className={tableHeadClass}>상세 내용</th>
											<th className={tableHeadClass}>관련 사용자/전략</th>
											<th className={tableHeadClass}>발생 시각</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{systemLogs.map((row) => (
											<tr key={`${row.category}-${row.id}`}>
												<td className={tableCellClass}>{row.categoryLabel || row.category}</td>
												<td className={tableCellClass}><StatusBadge label={row.normalityLabel || '-'} /></td>
												<td className={tableCellClass}>{row.title || '-'}</td>
												<td className={tableCellClass}>{row.detail || '-'}</td>
												<td className={tableCellClass}>UID {row.uid || '-'} / PID {row.pid || '-'}</td>
												<td className={tableCellClass}>{formatDateTime(row.createdAt)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{activeTopTab === 'strategies' ? (
				<div className="space-y-6">
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
						<SummaryCard title="등록 전략" value={strategyOverview.summary?.total || 0} description="전략 카탈로그에 등록된 전체 전략 수입니다." />
						<SummaryCard title="활성 전략" value={strategyOverview.summary?.active || 0} description="현재 사용자에게 노출 가능한 활성 전략 수입니다." />
						<SummaryCard title="신호 수신 이상" value={strategyOverview.summary?.abnormalWebhook || 0} description="신호 웹훅 상태가 비정상인 전략 수입니다." />
						<SummaryCard title="가격 데이터 이상" value={strategyOverview.summary?.abnormalPrice || 0} description="전략이 사용하는 종목의 가격 데이터 상태가 비정상인 전략 수입니다." />
					</div>

					<div className="grid gap-6 xl:grid-cols-[1.25fr,0.75fr]">
						<div className={cardClass}>
							<SectionHeader
								title="전략 목록"
								description="전략 카탈로그 기준으로 사용 현황, 수신 상태, 전체 손익을 확인합니다."
								action={
									<button
										type="button"
										onClick={() => {
											setSelectedStrategyId(null);
											setSelectedStrategyItem(null);
											setStrategySymbolKeyword('');
											setStrategyForm(strategyEmptyForm);
										}}
										className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
									>
										신규 전략
									</button>
								}
							/>
							<div className="mt-6 overflow-x-auto">
								<table className="min-w-full divide-y divide-slate-200">
									<thead>
										<tr>
											<th className={tableHeadClass}>전략</th>
											<th className={tableHeadClass}>사용 가능 종목 / 타임프레임</th>
											<th className={tableHeadClass}>사용 현황</th>
											<th className={tableHeadClass}>상태</th>
											<th className={tableHeadClass}>전체 손익</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{(strategyOverview.items || []).map((item) => (
											<tr
												key={item.id}
												className={`cursor-pointer ${selectedStrategyId === item.id ? 'bg-slate-50' : ''}`}
												onClick={() => setSelectedStrategyId(item.id)}
											>
												<td className={tableCellClass}>
													<div className="font-semibold text-slate-900">{item.signalName || item.strategyName}</div>
													<div className="mt-1 text-xs text-slate-500">
														{item.strategyCategory === 'grid' ? '그리드' : '알고리즘'} / 이름 {item.strategyName}
													</div>
												</td>
												<td className={tableCellClass}>
													<div>{(item.allowedSymbols || []).join(', ') || '-'}</div>
													<div className="mt-1 text-xs text-slate-500">{(item.allowedTimeframes || []).join(', ') || '-'}</div>
												</td>
												<td className={tableCellClass}>
													<div>사용자 {item.usage?.usersTotal || 0}명</div>
													<div className="mt-1 text-xs text-slate-500">등록 ID {item.usage?.registeredCount || 0} / ON {item.usage?.onCount || 0}</div>
												</td>
												<td className={tableCellClass}>
													<div className="flex flex-wrap gap-2">
														<StatusBadge label={`신호 ${item.signalWebhookStatus?.label || '-'}`} />
														<StatusBadge label={`통계 ${item.statsWebhookStatus?.label || '-'}`} />
														<StatusBadge label={`가격 ${item.priceFeedStatus?.label || '-'}`} />
													</div>
												</td>
												<td className={tableCellClass}>
													<div className="font-semibold text-slate-900">{formatNumber(item.profit?.totalPnl || 0, 4)} USDT</div>
													<div className="mt-1 text-xs text-slate-500">매수 {formatNumber(item.profit?.buyPnl || 0, 4)} / 매도 {formatNumber(item.profit?.sellPnl || 0, 4)}</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>

						<div className={cardClass}>
							<SectionHeader
								title="전략 추가 / 수정"
								description="전략 카테고리, 신호 이름, 사용 가능 종목/타임프레임, 사용자 권한을 관리합니다."
							/>
							<div className="mt-6 space-y-4">
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">전략 카테고리</label>
									<select className={selectClass} value={strategyForm.strategyCategory} onChange={(e) => setStrategyForm((prev) => ({ ...prev, strategyCategory: e.target.value }))}>
										<option value="signal">알고리즘</option>
										<option value="grid">그리드</option>
									</select>
								</div>
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">전략 이름</label>
									<input className={inputClass} value={strategyForm.strategyName} onChange={(e) => setStrategyForm((prev) => ({ ...prev, strategyName: e.target.value }))} />
								</div>
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">시그널 이름(JSON 신호명)</label>
									<input className={inputClass} value={strategyForm.signalName} onChange={(e) => setStrategyForm((prev) => ({ ...prev, signalName: e.target.value }))} />
								</div>
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">사용 가능 종목</label>
									<p className="mb-2 text-xs text-slate-500">
										바이낸스 선물 거래 가능 심볼 목록을 하루 1회 갱신합니다.
										{strategyOverview.meta?.exchangeSymbolCatalog?.refreshedAt ? ` 최근 갱신: ${formatDateTime(strategyOverview.meta.exchangeSymbolCatalog.refreshedAt)}` : ''}
									</p>
									<input className={inputClass} placeholder="종목 검색 (예: XRP, BTC, PUMP)" value={strategySymbolKeyword} onChange={(e) => setStrategySymbolKeyword(e.target.value)} />
									<div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-3">
										<div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
											{exchangeSymbolOptions.map((item) => (
												<label key={item.symbol} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
													<input type="checkbox" checked={strategyForm.allowedSymbols.includes(item.symbol)} onChange={() => handleToggleListValue('allowedSymbols', item.symbol)} />
													<span>{item.symbol}</span>
												</label>
											))}
										</div>
									</div>
								</div>
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">사용 가능 타임프레임</label>
									<p className="mb-2 text-xs text-slate-500">쉼표 또는 줄바꿈으로 직접 입력합니다. 예: 1MIN, 3MIN, 5MIN, 4H, 1D</p>
									<textarea className={`${inputClass} min-h-[88px]`} placeholder={'예: 1MIN, 3MIN, 5MIN\n또는 4H, 1D'} value={strategyForm.allowedTimeframesText} onChange={(e) => setStrategyForm((prev) => ({ ...prev, allowedTimeframesText: e.target.value }))} />
								</div>
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">사용자 권한</label>
									<select className={selectClass} value={strategyForm.permissionMode} onChange={(e) => setStrategyForm((prev) => ({ ...prev, permissionMode: e.target.value }))}>
										<option value="ALL">전체 회원 사용</option>
										<option value="SPECIFIC">특정 ID만 사용</option>
									</select>
								</div>
								{strategyForm.permissionMode === 'SPECIFIC' ? (
									<div>
										<label className="mb-2 block text-sm font-medium text-slate-700">허용 회원 ID</label>
										<input className={inputClass} placeholder="예: tmdtka1, test1" value={strategyForm.allowedMemberIdsText} onChange={(e) => setStrategyForm((prev) => ({ ...prev, allowedMemberIdsText: e.target.value }))} />
									</div>
								) : null}
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">활성 상태</label>
									<select className={selectClass} value={strategyForm.isActive} onChange={(e) => setStrategyForm((prev) => ({ ...prev, isActive: e.target.value }))}>
										<option value="Y">활성</option>
										<option value="N">비활성</option>
									</select>
								</div>
								<div>
									<label className="mb-2 block text-sm font-medium text-slate-700">비고</label>
									<textarea className={`${inputClass} min-h-[96px]`} value={strategyForm.notes} onChange={(e) => setStrategyForm((prev) => ({ ...prev, notes: e.target.value }))} />
								</div>
								<div className="flex flex-wrap gap-2">
									<button type="button" onClick={handleStrategySave} disabled={strategySaving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
										{strategySaving ? '저장 중...' : '전략 저장'}
									</button>
									<button type="button" onClick={handleStrategyDelete} disabled={!strategyForm.id || strategySaving} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
										전략 삭제
									</button>
								</div>
							</div>
						</div>
					</div>

					{selectedStrategyItem ? (
						<div className={cardClass}>
							<SectionHeader title={`전략 상세: ${selectedStrategyItem.signalName || selectedStrategyItem.strategyName}`} description="전략 사용 현황과 개별 전략 ID 손익을 함께 봅니다." />
							<div className="mt-6 grid gap-4 lg:grid-cols-2">
								<div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
									<p className="text-sm font-semibold text-slate-900">상태 요약</p>
									<div className="flex flex-wrap gap-2">
										<StatusBadge label={`신호 ${selectedStrategyItem.signalWebhookStatus?.label || '-'}`} />
										<StatusBadge label={`통계 ${selectedStrategyItem.statsWebhookStatus?.label || '-'}`} />
										<StatusBadge label={`가격 ${selectedStrategyItem.priceFeedStatus?.label || '-'}`} />
									</div>
									<p className="text-xs text-slate-500">신호명 {selectedStrategyItem.signalName || '-'} / 이름 {selectedStrategyItem.strategyName || '-'}</p>
									<p className="text-sm text-slate-600">{selectedStrategyItem.signalWebhookStatus?.detail || '-'}</p>
									<p className="text-sm text-slate-600">{selectedStrategyItem.statsWebhookStatus?.detail || '-'}</p>
									<p className="text-sm text-slate-600">{selectedStrategyItem.priceFeedStatus?.detail || '-'}</p>
								</div>
								<div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
									<p className="text-sm font-semibold text-slate-900">사용 / 권한 요약</p>
									<p className="text-sm text-slate-600">사용자 {selectedStrategyItem.usage?.usersTotal || 0}명 / 등록 ID {selectedStrategyItem.usage?.registeredCount || 0} / ON {selectedStrategyItem.usage?.onCount || 0}</p>
									<p className="text-sm text-slate-600">권한: {selectedStrategyItem.permissionMode === 'SPECIFIC' ? '특정 회원만' : '전체 회원'}</p>
									<p className="text-sm text-slate-600">허용 회원: {(selectedStrategyItem.allowedMembers || []).map((item) => item.memId).join(', ') || '전체'}</p>
								</div>
							</div>
							<div className="mt-6 overflow-x-auto">
								<table className="min-w-full divide-y divide-slate-200">
									<thead>
										<tr>
											<th className={tableHeadClass}>사용자</th>
											<th className={tableHeadClass}>전략 ID / 모드</th>
											<th className={tableHeadClass}>종목 / 타임프레임</th>
											<th className={tableHeadClass}>방향</th>
											<th className={tableHeadClass}>손익</th>
											<th className={tableHeadClass}>거래금액</th>
											<th className={tableHeadClass}>거래횟수</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{(selectedStrategyItem.instancePerformance || []).map((item) => (
											<tr key={`${item.uid}-${item.pid}`}>
												<td className={tableCellClass}>
													<div className="font-semibold text-slate-900">{item.member?.memId || `UID ${item.uid}`}</div>
													<div className="mt-1 text-xs text-slate-500">{item.member?.memName || '-'}</div>
												</td>
												<td className={tableCellClass}>
													<div>PID {item.pid}</div>
													<div className="mt-1 text-xs text-slate-500">{item.mode}</div>
												</td>
												<td className={tableCellClass}>
													<div>{item.symbol || '-'}</div>
													<div className="mt-1 text-xs text-slate-500">{item.bunbong || '-'}</div>
												</td>
												<td className={tableCellClass}>{item.signalType || '-'}</td>
												<td className={tableCellClass}>{formatNumber(item.pnl, 4)} USDT</td>
												<td className={tableCellClass}>{formatNumber(item.tradeAmount, 2)}</td>
												<td className={tableCellClass}>{item.tradeCount || 0}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{activeTopTab === 'users' ? (
				<div className="space-y-6">
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
						<SummaryCard title="전체 회원" value={managedUsers.summary?.total || 0} description="현재 관리자 콘솔에서 관리 중인 전체 회원 수입니다." />
						<SummaryCard title="실거래+모의 허용" value={managedUsers.summary?.liveDemo || 0} description="실거래와 모의 거래를 모두 사용할 수 있는 회원 수입니다." />
						<SummaryCard title="모의만 허용" value={managedUsers.summary?.demoOnly || 0} description="모의 거래만 허용된 회원 수입니다." />
						<SummaryCard title="API 연결 회원" value={managedUsers.summary?.withCredentials || 0} description="바이낸스 API/Secret이 등록된 회원 수입니다." />
					</div>

					<div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
						<div className={cardClass}>
							<SectionHeader title="사용자 목록" description="회원 조회, 실거래 권한 수정, 전략 사용 현황, 재무 상태를 함께 봅니다." />
							<div className="mt-6 grid gap-3 md:grid-cols-3">
								<input
									className={inputClass}
									placeholder="ID / 이름 / 전화번호 / 이메일"
									value={userFilters.keyword}
									onChange={(e) => setUserFilters((prev) => ({ ...prev, keyword: e.target.value }))}
								/>
								<select className={selectClass} value={userFilters.tradeAccessMode} onChange={(e) => setUserFilters((prev) => ({ ...prev, tradeAccessMode: e.target.value }))}>
									<option value="">전체 권한</option>
									<option value="LIVE_DEMO">실거래+모의</option>
									<option value="DEMO_ONLY">모의만</option>
								</select>
								<select className={selectClass} value={userFilters.strategyKey} onChange={(e) => setUserFilters((prev) => ({ ...prev, strategyKey: e.target.value }))}>
									<option value="">전체 전략</option>
									{(strategyOverview.items || []).map((item) => (
										<option key={`${item.strategyCategory}-${item.signalName}`} value={item.signalName}>
											{item.strategyName} ({item.signalName})
										</option>
									))}
								</select>
							</div>
							<div className="mt-3 flex justify-end">
								<button
									type="button"
									onClick={() => loadManagedUsers(userFilters)}
									className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
								>
									필터 적용
								</button>
							</div>
							<div className="mt-6 overflow-x-auto">
								<table className="min-w-full divide-y divide-slate-200">
									<thead>
										<tr>
											<th className={tableHeadClass}>사용자</th>
											<th className={tableHeadClass}>권한</th>
											<th className={tableHeadClass}>전략 사용</th>
											<th className={tableHeadClass}>거래금액 / 손익</th>
											<th className={tableHeadClass}>재무 리스크</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100 bg-white">
										{(managedUsers.items || []).map((item) => (
											<tr
												key={item.uid}
												className={`cursor-pointer ${selectedManagedUid === item.uid ? 'bg-slate-50' : ''}`}
												onClick={() => setSelectedManagedUid(item.uid)}
											>
												<td className={tableCellClass}>
													<div className="font-semibold text-slate-900">{item.memId}</div>
													<div className="mt-1 text-xs text-slate-500">{item.memName || '-'} / {item.mobile || '-'}</div>
													<div className="mt-1 text-xs text-slate-500">{item.email || '-'}</div>
												</td>
												<td className={tableCellClass}>
													<StatusBadge label={item.tradeAccessMode === 'LIVE_DEMO' ? '실거래+모의' : '모의만'} />
													<div className="mt-2 text-xs text-slate-500">{item.hasCredentials ? 'API 연결됨' : 'API 미등록'}</div>
												</td>
												<td className={tableCellClass}>
													<div>총 {item.totalStrategyCount || 0}</div>
													<div className="mt-1 text-xs text-slate-500">Live {item.liveStrategyCount || 0} / Demo {item.demoStrategyCount || 0} / ON {item.onStrategyCount || 0}</div>
												</td>
												<td className={tableCellClass}>
													<div>{formatNumber(item.liveTradeAmount, 2)} USDT</div>
													<div className="mt-1 text-xs text-slate-500">실거래 {formatNumber(item.livePnl, 4)} / 모의 {formatNumber(item.demoPnl, 4)}</div>
												</td>
												<td className={tableCellClass}>
													<div>{item.latestRisk?.riskLevel || 'UNKNOWN'}</div>
													<div className="mt-1 text-xs text-slate-500">MR {formatNumber(item.latestRisk?.accountMarginRatio || 0, 2)}% / Equity {formatNumber(item.latestRisk?.accountEquity || 0, 2)}</div>
													<div className="mt-1 text-xs text-slate-500">가용 {formatNumber(item.latestRisk?.availableBalance || 0, 2)} USDT</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>

						<div className={cardClass}>
							<SectionHeader title="사용자 상세" description="실거래 권한 변경, 현재 전략, 재무 리스크를 빠르게 확인합니다." />
							{selectedManagedUser ? (
								<div className="mt-6 space-y-5">
									<div className="grid gap-3 sm:grid-cols-2">
										<div>
											<p className="text-xs uppercase tracking-wide text-slate-500">회원 ID</p>
											<p className="mt-1 font-semibold text-slate-900">{selectedManagedUser.memId}</p>
										</div>
										<div>
											<p className="text-xs uppercase tracking-wide text-slate-500">이름</p>
											<p className="mt-1 text-slate-700">{selectedManagedUser.memName || '-'}</p>
										</div>
										<div>
											<p className="text-xs uppercase tracking-wide text-slate-500">전화번호</p>
											<p className="mt-1 text-slate-700">{selectedManagedUser.mobile || '-'}</p>
										</div>
										<div>
											<p className="text-xs uppercase tracking-wide text-slate-500">이메일</p>
											<p className="mt-1 text-slate-700">{selectedManagedUser.email || '-'}</p>
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<button type="button" disabled={userSaving} onClick={() => handleUserAccessSave('LIVE_DEMO')} className={`${accessModeButtonClass(selectedManagedUser.tradeAccessMode === 'LIVE_DEMO')} disabled:opacity-50`}>
											실거래+모의 허용
										</button>
										<button type="button" disabled={userSaving} onClick={() => handleUserAccessSave('DEMO_ONLY')} className={`${accessModeButtonClass(selectedManagedUser.tradeAccessMode === 'DEMO_ONLY')} disabled:opacity-50`}>
											모의만 허용
										</button>
										<button type="button" disabled={userSaving} onClick={handleUserDelete} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
											사용자 삭제
										</button>
									</div>
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<p className="text-sm font-semibold text-slate-900">재무 리스크</p>
										<p className="mt-2 text-sm text-slate-600">Risk {selectedManagedUser.latestRisk?.riskLevel || 'UNKNOWN'}</p>
										<p className="text-sm text-slate-600">Margin Ratio {formatNumber(selectedManagedUser.latestRisk?.accountMarginRatio || 0, 2)}%</p>
										<p className="text-sm text-slate-600">Equity {formatNumber(selectedManagedUser.latestRisk?.accountEquity || 0, 2)} USDT</p>
										<p className="text-sm text-slate-600">Available Balance {formatNumber(selectedManagedUser.latestRisk?.availableBalance || 0, 2)} USDT</p>
										<p className="text-sm text-slate-600">Buffer {formatNumber(selectedManagedUser.latestRisk?.marginBuffer || 0, 2)} USDT</p>
									</div>
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-slate-200">
											<thead>
												<tr>
													<th className={tableHeadClass}>전략</th>
													<th className={tableHeadClass}>모드</th>
													<th className={tableHeadClass}>종목</th>
													<th className={tableHeadClass}>운용</th>
													<th className={tableHeadClass}>상태</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100 bg-white">
												{(selectedManagedUser.currentStrategies || []).map((item) => (
													<tr key={`${item.category}-${item.mode}-${item.pid}`}>
														<td className={tableCellClass}>
															<div className="font-semibold text-slate-900">{item.strategyName}</div>
															<div className="mt-1 text-xs text-slate-500">{item.signalName}</div>
														</td>
														<td className={tableCellClass}>{item.categoryLabel || item.category} / {item.mode}</td>
														<td className={tableCellClass}>{item.symbol} / {item.bunbong}</td>
														<td className={tableCellClass}><StatusBadge label={item.controlStateLabel || (item.enabled ? '운용중' : '중지')} /></td>
														<td className={tableCellClass}>
															<StatusBadge
																label={
																	item.category === 'grid'
																		? item.userOverallStatusLabel || item.runtimeStateLabel || '-'
																		: item.userStatusLabel || item.runtimeStateLabel || '-'
																}
															/>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							) : (
								<p className="mt-6 text-sm text-slate-500">왼쪽 목록에서 사용자를 선택해 주세요.</p>
							)}
						</div>
					</div>
				</div>
			) : null}
			{activeTopTab === 'revenue' ? (
				<div className="space-y-6">
					<div className={cardClass}>
						<SectionHeader
							title="매출 관리"
							description="기간별 거래금액, 지정가/시장가 체결 비중, 발생 수수료와 예상 매출액을 확인합니다."
							action={
								<button
									type="button"
									onClick={() => loadRevenueSummary(revenueFilters)}
									className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
								>
									집계 새로고침
								</button>
							}
						/>
						<div className="mt-6 grid gap-3 md:grid-cols-3">
							<input className={inputClass} type="date" value={revenueFilters.startDate} onChange={(e) => setRevenueFilters((prev) => ({ ...prev, startDate: e.target.value }))} />
							<input className={inputClass} type="date" value={revenueFilters.endDate} onChange={(e) => setRevenueFilters((prev) => ({ ...prev, endDate: e.target.value }))} />
							<select className={selectClass} value={revenueFilters.referralShareRate} onChange={(e) => setRevenueFilters((prev) => ({ ...prev, referralShareRate: e.target.value }))}>
								{referralShareOptions.map((option) => (
									<option key={option.value} value={option.value}>
										예상 매출 배분율 {option.label}
									</option>
								))}
							</select>
						</div>
						<div className="mt-3 flex justify-end">
							<button
								type="button"
								onClick={() => loadRevenueSummary(revenueFilters)}
								className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
							>
								필터 적용
							</button>
						</div>
					</div>

					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
						<SummaryCard title="전체 거래금액" value={`${formatNumber(revenueSummary?.totalTradeAmount || 0, 2)} USDT`} description="선택 기간 전체 체결 거래금액 합계입니다." />
						<SummaryCard title="지정가 거래금액" value={`${formatNumber(revenueSummary?.limitTradeAmount || 0, 2)} USDT`} description="LIMIT / STOP / TAKE_PROFIT 계열 체결 합계입니다." />
						<SummaryCard title="시장가 거래금액" value={`${formatNumber(revenueSummary?.marketTradeAmount || 0, 2)} USDT`} description="MARKET 계열 체결 합계입니다." />
						<SummaryCard title="발생 수수료" value={`${formatNumber(revenueSummary?.totalCommission || 0, 6)} USDT`} description="선택 기간 실제 발생 수수료 합계입니다." />
						<SummaryCard title="예상 매출액" value={`${formatNumber(revenueSummary?.estimatedRevenue || 0, 6)} USDT`} description={`발생 수수료 x 배분율 ${formatNumber(revenueSummary?.referralShareRate || 0, 2)}`} />
						<SummaryCard title="체결 수" value={formatNumber(revenueSummary?.tradeCount || 0, 0)} description={revenueSummary?.source || 'fill-unit 집계'} />
					</div>

					<div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
						집계 기준: 주문 수가 아니라 Binance tradeId/sourceTradeId 체결 단위입니다. 마지막 업데이트: {formatDateTime(revenueSummary?.lastUpdatedAt)}
					</div>

					<div className={cardClass}>
						<SectionHeader title="사용자별 거래 / 매출" description="거래금액과 예상 매출액을 사용자별로 확인합니다." />
						<div className="mt-6 overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead>
									<tr>
										<th className={tableHeadClass}>사용자</th>
										<th className={tableHeadClass}>거래금액</th>
										<th className={tableHeadClass}>지정가</th>
										<th className={tableHeadClass}>시장가</th>
										<th className={tableHeadClass}>수수료</th>
										<th className={tableHeadClass}>예상 매출액</th>
										<th className={tableHeadClass}>체결 수</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{(revenueSummary?.perUser || []).map((item) => (
										<tr key={item.uid}>
											<td className={tableCellClass}>
												<div className="font-semibold text-slate-900">{item.member?.memId || `UID ${item.uid}`}</div>
												<div className="mt-1 text-xs text-slate-500">{item.member?.memName || '-'}</div>
											</td>
											<td className={tableCellClass}>{formatNumber(item.totalTradeAmount, 2)}</td>
											<td className={tableCellClass}>{formatNumber(item.limitTradeAmount, 2)}</td>
											<td className={tableCellClass}>{formatNumber(item.marketTradeAmount, 2)}</td>
											<td className={tableCellClass}>{formatNumber(item.totalCommission, 6)}</td>
											<td className={tableCellClass}>{formatNumber(item.estimatedRevenue, 6)}</td>
											<td className={tableCellClass}>{item.tradeCount}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
};

export default AdminConsole;
