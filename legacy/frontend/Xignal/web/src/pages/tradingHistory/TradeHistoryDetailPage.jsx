import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { trading } from '../../services/trading';
import { getDateFormat } from '../../utils/getDateFormat';
import { comma, formatPrice } from '../../utils/comma';

const toNumber = (value, fallback = 0) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
};

const formatDateTime = (value) => {
	if (!value) {
		return '-';
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '-';
	}

	return getDateFormat(date, 'YYYY.MM.DD hh:mm:ss');
};

const formatPnl = (value) => {
	const numeric = toNumber(value);
	const rounded = Number(numeric.toFixed(8));
	return `${rounded >= 0 ? '+' : ''}${comma(rounded)}$`;
};

const formatPriceValue = (value) => {
	const numeric = toNumber(value);
	return numeric > 0 ? comma(formatPrice(numeric)) : '-';
};

const formatAmount = (value) => {
	const numeric = toNumber(value);
	return numeric > 0 ? `${comma(numeric)} USDT` : '-';
};

const formatBunbong = (value) => {
	const raw = String(value || '').trim().toUpperCase();
	if (!raw) {
		return '-';
	}
	if (raw.endsWith('MIN')) {
		return `${raw.slice(0, -3)}분`;
	}
	return raw;
};

const StagePill = ({ label }) => {
	const toneClass =
		label === '비정상'
			? 'border-[#7A2E2E] bg-[#2A1111] text-[#FF8E8E]'
			: label === '정상' || label === '완료'
				? 'border-[#2A5C44] bg-[#0D1F17] text-[#94E2B7]'
				: 'border-[#394150] bg-[#151A22] text-[#CBD3E1]';

	return <span className={`rounded-full border px-2.5 py-1 text-[12px] ${toneClass}`}>{label || '-'}</span>;
};

const SummaryCard = ({ label, value, tone = 'default' }) => {
	const toneClass =
		tone === 'profit'
			? 'text-[#94E2B7]'
			: tone === 'danger'
				? 'text-[#FF8E8E]'
				: 'text-white';

	return (
		<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] px-4 py-4">
			<p className="text-[12px] text-[#8b94a3]">{label}</p>
			<p className={`mt-2 text-[18px] font-semibold ${toneClass}`}>{value}</p>
		</div>
	);
};

const InfoRow = ({ label, value }) => (
	<div className="flex items-center justify-between gap-4 border-b border-[#232323] py-3 text-sm last:border-b-0">
		<span className="text-[#8b94a3]">{label}</span>
		<span className="text-right text-white">{value}</span>
	</div>
);

const TrackRecordDetailPage = ({ mode = 'live' }) => {
	const navigate = useNavigate();
	const { id } = useParams();
	const [item, setItem] = useState(null);
	const isDemoMode = mode === 'test';
	const listPath = isDemoMode ? '/test/trade-history' : '/trade-history';
	const itemRequester = isDemoMode ? trading.getTestRuntimeTrackRecordItem : trading.getRuntimeTrackRecordItem;

	useEffect(() => {
		if (!id) {
			return;
		}

		itemRequester({ id }, (res) => {
			if (res === false) {
				return;
			}
			setItem(res || null);
		});
	}, [id, itemRequester]);

	const isGrid = useMemo(
		() => String(item?.strategyCategory || '').trim().toLowerCase() === 'grid',
		[item?.strategyCategory]
	);

	const processStages = useMemo(() => {
		if (!item) {
			return [];
		}

		if (isGrid) {
			return [
				{ key: 'webhook', label: '웹훅 수신', value: item.gridProcess?.webhook || '-' },
				{ key: 'gridding', label: 'Gridding', value: item.gridProcess?.gridding || '-' },
				{ key: 'finish', label: '종료', value: item.gridProcess?.finish || '-' },
			];
		}

		return [
			{ key: 'webhook', label: '웹훅 수신', value: item.algorithmProcess?.webhook || '-' },
			{ key: 'exactWait', label: '진입대기', value: item.algorithmProcess?.exactWait || '-' },
			{ key: 'entry', label: '진입', value: item.algorithmProcess?.entry || '-' },
			{ key: 'exit', label: '청산', value: item.algorithmProcess?.exit || '-' },
		];
	}, [isGrid, item]);

	const lineageLines = useMemo(() => {
		if (!item) {
			return [];
		}
		return isGrid ? item.gridMeta?.lineageLines || [] : item.algorithmMeta?.lineageLines || [];
	}, [isGrid, item]);

	if (!item) {
		return (
			<div className="inner-container">
				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-6 text-center text-[#9aa3b2]">
					트랙레코드를 불러오는 중입니다.
				</div>
			</div>
		);
	}

	const realizedTone = toNumber(item.realizedPnl) >= 0 ? 'profit' : 'danger';

	return (
		<div className="inner-container space-y-5">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div>
					<button
						type="button"
						className="cursor-pointer rounded-md border border-[#494949] bg-[#0F0F0F] px-4 py-2 text-[14px] font-bold text-white md:text-[15px]"
						onClick={() => navigate(listPath)}
					>
						목록으로 돌아가기
					</button>
					<h2 className="mt-3 text-[24px] font-bold text-white md:text-[30px]">
						PID {item.pid} / {item.seriesLabel || '-'} / LOG {item.id}
					</h2>
					<p className="mt-1 text-sm text-[#aeb7c6]">
						{item.strategyCategoryLabel} / {item.strategyName}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<StagePill label={item.overallResultLabel} />
					<StagePill label={item.summaryStatusLabel} />
				</div>
			</div>

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
				<SummaryCard label="실현손익" value={formatPnl(item.realizedPnl)} tone={realizedTone} />
				<SummaryCard label="웹훅 시각" value={formatDateTime(item.webhookOccurredAt)} />
				<SummaryCard label="완료 시각" value={formatDateTime(item.completedAt)} />
				<SummaryCard label="비정상 시각" value={formatDateTime(item.abnormalAt)} tone={item.abnormalAt ? 'danger' : 'default'} />
				<SummaryCard label="처리 요약" value={item.summaryText || '-'} tone={item.summaryStatusLabel === '비정상' ? 'danger' : 'default'} />
			</div>

			<div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
					<h3 className="text-[18px] font-semibold text-white">기본 정보</h3>
					<div className="mt-3">
						<InfoRow label="전략 구분" value={item.strategyCategoryLabel || '-'} />
						<InfoRow label="시리즈" value={item.seriesLabel || '-'} />
						<InfoRow label="종목" value={item.symbol || '-'} />
						<InfoRow label="방향" value={item.directionLabel || '-'} />
						<InfoRow label="타임프레임" value={formatBunbong(item.bunbong)} />
						<InfoRow label="현재 단계" value={item.currentStepLabel || '-'} />
						<InfoRow label="문제 특정" value={item.issueLabel || '-'} />
						<InfoRow label="문제 출처" value={item.issueSourceLabel || '-'} />
					</div>
				</div>

				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
					<h3 className="text-[18px] font-semibold text-white">프로세스 단계</h3>
					<div className="mt-3 space-y-3">
						{processStages.map((stage) => (
							<div key={stage.key} className="flex items-center justify-between gap-3 rounded-lg bg-[#101318] px-4 py-3">
								<span className="text-sm text-[#c7d0de]">{stage.label}</span>
								<StagePill label={stage.value} />
							</div>
						))}
					</div>
				</div>
			</div>

			{isGrid ? (
				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
					<h3 className="text-[18px] font-semibold text-white">그리드 상태</h3>
					<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<SummaryCard label="전체 상태" value={item.gridMeta?.overallStatusLabel || '-'} />
						<SummaryCard label="매수 상태" value={item.gridMeta?.buyStatusLabel || '-'} />
						<SummaryCard label="매도 상태" value={item.gridMeta?.sellStatusLabel || '-'} />
						<SummaryCard label="거래금액" value={formatAmount(item.gridMeta?.tradeAmount)} />
						<SummaryCard label="트리거라인" value={formatPriceValue(item.gridMeta?.triggerPrice)} />
						<SummaryCard label="지지선" value={formatPriceValue(item.gridMeta?.supportPrice)} />
						<SummaryCard label="저항선" value={formatPriceValue(item.gridMeta?.resistancePrice)} />
						<SummaryCard label="목표 익절" value={toNumber(item.gridMeta?.targetTakeProfitPercent) > 0 ? `${item.gridMeta.targetTakeProfitPercent}%` : '-'} />
						<SummaryCard label="현재 레짐 손익" value={formatPnl(item.gridMeta?.currentRegimeRealizedPnl)} tone={toNumber(item.gridMeta?.currentRegimeRealizedPnl) >= 0 ? 'profit' : 'danger'} />
						<SummaryCard label="현재 레짐 익절 횟수" value={`${comma(toNumber(item.gridMeta?.currentRegimeTakeProfitCount))}회`} />
						<SummaryCard label="누적 손익" value={formatPnl(item.gridMeta?.cumulativeRealizedPnl)} tone={toNumber(item.gridMeta?.cumulativeRealizedPnl) >= 0 ? 'profit' : 'danger'} />
						<SummaryCard label="누적 익절/손절" value={`${comma(toNumber(item.gridMeta?.cumulativeTakeProfitCount))} / ${comma(toNumber(item.gridMeta?.cumulativeStopLossCount))}`} />
					</div>
				</div>
			) : (
				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
					<h3 className="text-[18px] font-semibold text-white">알고리즘 상태</h3>
					<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<SummaryCard label="상태" value={item.algorithmMeta?.statusLabel || '-'} />
						<SummaryCard label="진입가" value={formatPriceValue(item.algorithmMeta?.entryPrice)} />
						<SummaryCard label="목표 익절가" value={formatPriceValue(item.algorithmMeta?.targetTakeProfitPrice)} />
						<SummaryCard label="거래금액" value={formatAmount(item.algorithmMeta?.tradeAmount)} />
						<SummaryCard label="손절 조건" value={item.algorithmMeta?.stopConditionLabel || '-'} />
						<SummaryCard label="미실현 손익" value={formatPnl(item.algorithmMeta?.unrealizedPnl)} tone={toNumber(item.algorithmMeta?.unrealizedPnl) >= 0 ? 'profit' : 'danger'} />
						<SummaryCard label="이번 사이클 손익" value={formatPnl(item.algorithmMeta?.realizedPnl)} tone={toNumber(item.algorithmMeta?.realizedPnl) >= 0 ? 'profit' : 'danger'} />
						<SummaryCard label="누적 실현손익" value={formatPnl(item.algorithmMeta?.cumulativeRealizedPnl)} tone={toNumber(item.algorithmMeta?.cumulativeRealizedPnl) >= 0 ? 'profit' : 'danger'} />
					</div>
				</div>
			)}

			<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
				<h3 className="text-[18px] font-semibold text-white">주문 Lineage</h3>
				<div className="mt-3 space-y-2">
					{lineageLines.length === 0 ? (
						<p className="text-sm text-[#8b94a3]">표시할 주문 라인이 없습니다.</p>
					) : (
						lineageLines.map((line, index) => (
							<div key={`lineage_${index}`} className="rounded-lg bg-[#101318] px-4 py-3 text-sm text-[#d8deea]">
								{line}
							</div>
						))
					)}
				</div>
			</div>

			<div className="grid gap-5 xl:grid-cols-2">
				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
					<h3 className="text-[18px] font-semibold text-white">사이클 Ledger</h3>
					<div className="mt-3 overflow-x-auto">
						<table className="min-w-full whitespace-nowrap text-left text-sm text-white">
							<thead className="border-b border-[#2d3340] text-[#8b94a3]">
								<tr>
									<th className="px-3 py-2">시각</th>
									<th className="px-3 py-2">이벤트</th>
									<th className="px-3 py-2">방향</th>
									<th className="px-3 py-2">수량</th>
									<th className="px-3 py-2">체결가</th>
									<th className="px-3 py-2">실현손익</th>
								</tr>
							</thead>
							<tbody>
								{(item.detail?.cycleLedgerEvents || []).length === 0 ? (
									<tr>
										<td className="px-3 py-4 text-[#8b94a3]" colSpan={6}>
											사이클 Ledger가 없습니다.
										</td>
									</tr>
								) : (
									(item.detail?.cycleLedgerEvents || []).map((row) => (
										<tr key={`ledger_${row.id}`} className="border-b border-[#1f2430] last:border-b-0">
											<td className="px-3 py-3">{formatDateTime(row.tradeTime || row.createdAt)}</td>
											<td className="px-3 py-3">{row.eventType || '-'}</td>
											<td className="px-3 py-3">{row.positionSide || '-'}</td>
											<td className="px-3 py-3">{comma(toNumber(row.fillQty).toFixed(8))}</td>
											<td className="px-3 py-3">{formatPriceValue(row.fillPrice)}</td>
											<td className={`px-3 py-3 ${toNumber(row.realizedPnl) >= 0 ? 'text-[#94E2B7]' : 'text-[#FF8E8E]'}`}>
												{formatPnl(row.realizedPnl)}
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>

				<div className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4">
					<h3 className="text-[18px] font-semibold text-white">보호주문 / 런타임 메시지</h3>
					<div className="mt-3 space-y-3">
						<div className="rounded-lg bg-[#101318] p-3">
							<p className="text-sm font-semibold text-white">보호주문</p>
							<div className="mt-2 space-y-2 text-sm text-[#cfd5df]">
								{(item.detail?.reservations || []).length === 0 ? (
									<p className="text-[#8b94a3]">보호주문 기록이 없습니다.</p>
								) : (
									(item.detail?.reservations || []).map((row) => (
										<div key={`reservation_${row.id}`} className="rounded-md border border-[#232a36] px-3 py-2">
											<div>{row.reservationKind || '-'}</div>
											<div className="mt-1 text-[12px] text-[#8b94a3]">
												CID {row.clientOrderId || '-'} / ALGO {row.sourceOrderId || '-'} / EXCH {row.actualOrderId || '-'}
											</div>
											<div className="mt-1 text-[12px] text-[#8b94a3]">
												상태 {row.status || '-'} / 수량 {comma(toNumber(row.reservedQty).toFixed(8))}
											</div>
										</div>
									))
								)}
							</div>
						</div>

						<div className="rounded-lg bg-[#101318] p-3">
							<p className="text-sm font-semibold text-white">런타임 메시지</p>
							<div className="mt-2 space-y-2 text-sm text-[#cfd5df]">
								{(item.detail?.runtimeMessages || []).length === 0 ? (
									<p className="text-[#8b94a3]">런타임 메시지가 없습니다.</p>
								) : (
									(item.detail?.runtimeMessages || []).map((row) => (
										<div key={`msg_${row.id}`} className="rounded-md border border-[#232a36] px-3 py-2">
											<div>{row.summary || row.msg || '-'}</div>
											<div className="mt-1 text-[12px] text-[#8b94a3]">{formatDateTime(row.createdAt)}</div>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default TrackRecordDetailPage;
