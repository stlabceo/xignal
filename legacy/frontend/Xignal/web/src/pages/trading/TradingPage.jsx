import React, { useEffect, useMemo, useState } from 'react';
import TradingGrid from './TradingGrid';
import OrderView from './OrderView';
import GridTradingGrid from './GridTradingGrid';
import GridOrderView from './GridOrderView';
import { trading } from '../../services/trading';
import TradingViewWidget from './TradingViewWidget';
import { useChartStore } from '../../store/useChartStore';
import { comma } from '../../utils/comma';
import { buildEstimatedUnrealizedPnl, estimateGridUnrealizedPnl, getMarketPriceForSymbol } from './estimatedPnl';

const STRATEGY_CATEGORY = {
	SIGNAL: 'SIGNAL',
	GRID: 'GRID'
};

const toNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
};

const formatPnl = (value, unavailableText = '데이터 준비중') => {
	if (value === null || value === undefined || value === '') {
		return unavailableText;
	}
	const numeric = toNumber(value);
	return `${numeric >= 0 ? '+' : ''}${comma(Number(numeric.toFixed(8)))} USDT`;
};

const formatCount = (value) => `${comma(toNumber(value))}개`;
const formatWinRate = (value) => (value === null || value === undefined ? '집계 불가' : `${toNumber(value).toFixed(1)}%`);

const getSignalOpenQty = (item = {}) => toNumber(item.openQty || item.r_qty);
const getSignalEntryPrice = (item = {}) => toNumber(item.avgEntryPrice || item.entryPrice || item.r_exactPrice || item.r_signalPrice);
const getSignalUnrealizedPnl = (item = {}, marketPrices = {}) => {
	return buildEstimatedUnrealizedPnl({
		side: item.signalType,
		positionSide: item.positionSide,
		openQty: getSignalOpenQty(item),
		avgEntryPrice: getSignalEntryPrice(item),
		markPrice: getMarketPriceForSymbol(marketPrices, item.symbol)
	});
};

const getGridUnrealizedPnl = (item = {}, marketPrices = {}) => {
	return estimateGridUnrealizedPnl(item, getMarketPriceForSymbol(marketPrices, item.symbol));
};

const SummaryCard = ({ label, value, tone = 'neutral', helper }) => {
	const toneClass =
		tone === 'profit'
			? 'text-[#8EE6B5]'
			: tone === 'loss'
				? 'text-[#FF8E8E]'
				: 'text-white';
	return (
		<div className="rounded-2xl border border-[#2D343F] bg-[#12161D] p-4 shadow-[0_18px_55px_rgba(0,0,0,0.24)]">
			<p className="text-[12px] font-medium text-[#8B96A8]">{label}</p>
			<p className={`mt-2 text-[22px] font-semibold ${toneClass}`}>{value}</p>
			{helper ? <p className="mt-2 text-[11px] text-[#697386]">{helper}</p> : null}
		</div>
	);
};

const SectionHeader = ({ title, description, action }) => (
	<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
		<div>
			<h3 className="text-[20px] font-semibold text-white">{title}</h3>
			<p className="mt-1 text-sm text-[#8B96A8]">{description}</p>
		</div>
		{action}
	</div>
);

const TradingPage = () => {
	const [isOrderViewOn, setOrderViewOn] = useState(false);
	const [showChart, setShowChart] = useState(false);
	const [tradingDetailId, setTradingDetailId] = useState(null);
	const [presetData, setPresetData] = useState(null);
	const [strategyCategory, setStrategyCategory] = useState(STRATEGY_CATEGORY.SIGNAL);
	const [signalListData, setSignalListData] = useState([]);
	const [gridListData, setGridListData] = useState([]);
	const [marketPrices, setMarketPrices] = useState({});
	const [performanceSummary, setPerformanceSummary] = useState(null);

	const { symbol, bunbong } = useChartStore();

	const loadSignalList = () => {
		trading.liveList({ live: 'Y' }, (res) => {
			if (Array.isArray(res)) {
				setSignalListData([...res]);
			}
		});
	};

	const loadGridList = () => {
		trading.gridLiveList({}, (res) => {
			if (Array.isArray(res)) {
				setGridListData([...res]);
			}
		});
	};

	const loadPerformance = () => {
		trading.performanceSummary({}, (res) => {
			if (res && typeof res === 'object') {
				setPerformanceSummary(res);
			}
		});
	};

	useEffect(() => {
		if (!tradingDetailId) return;
		setPresetData(null);
		setOrderViewOn(true);
	}, [tradingDetailId]);

	useEffect(() => {
		const loadAll = () => {
			loadSignalList();
			loadGridList();
			loadPerformance();
		};

		loadAll();
		const interval = setInterval(loadAll, 3000);
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		const loadPrices = () => {
			trading.livePrice({ live: 'Y' }, (res) => {
				if (res && typeof res === 'object') {
					setMarketPrices(res);
				}
			});
		};

		loadPrices();
		const interval = setInterval(loadPrices, 3000);
		return () => clearInterval(interval);
	}, []);

	const activeGetListData = strategyCategory === STRATEGY_CATEGORY.SIGNAL ? loadSignalList : loadGridList;

	const handleOpenNewStrategy = (nextCategory) => {
		setStrategyCategory(nextCategory);
		setTradingDetailId(null);
		setPresetData(
			nextCategory === STRATEGY_CATEGORY.GRID
				? {
						a_name: 'SQZ GRID',
						strategySignal: 'SQZ+GRID',
						symbol: 'BTCUSDT',
						bunbong: '1MIN',
						marginType: '교차',
						margin: '100',
						leverage: '20',
						profit: '0.5'
				  }
				: null
		);
		setOrderViewOn(true);
	};

	const summaryCards = useMemo(() => {
		const cards = performanceSummary?.cards || {};
		const unrealizedEstimates = [
			...signalListData.map((item) => getSignalUnrealizedPnl(item, marketPrices)),
			...gridListData.map((item) => getGridUnrealizedPnl(item, marketPrices))
		];
		const openEstimates = unrealizedEstimates.filter((estimate) => estimate.status !== 'FLAT');
		const currentUnrealized = openEstimates.length
			? openEstimates.every((estimate) => estimate.status === 'ESTIMATED')
				? openEstimates.reduce((sum, estimate) => sum + toNumber(estimate.value), 0)
				: null
			: 0;
		const totalRealized = toNumber(cards.totalRealizedPnl);
		const todayPnl = toNumber(cards.todayPnl);
		const sevenDayPnl = toNumber(cards.sevenDayPnl);
		const thirtyDayPnl = toNumber(cards.thirtyDayPnl);

		return [
			{ label: '총 누적 실현손익', value: formatPnl(totalRealized), tone: totalRealized >= 0 ? 'profit' : 'loss' },
			{ label: '현재 추정 손익', value: formatPnl(currentUnrealized), tone: toNumber(currentUnrealized) >= 0 ? 'profit' : 'loss', helper: '실시간 가격 기준 추정' },
			{ label: '오늘 손익', value: formatPnl(todayPnl), tone: todayPnl >= 0 ? 'profit' : 'loss' },
			{ label: '7일 손익', value: formatPnl(sevenDayPnl), tone: sevenDayPnl >= 0 ? 'profit' : 'loss' },
			{ label: '30일 손익', value: formatPnl(thirtyDayPnl), tone: thirtyDayPnl >= 0 ? 'profit' : 'loss' },
			{ label: '운용 중 전략', value: formatCount(cards.runningStrategyCount), helper: 'ON 상태 전략 수' },
			{ label: '열린 포지션', value: formatCount(cards.openPositionCount), helper: '로컬 정본 기준' },
			{ label: '최근 승률', value: formatWinRate(cards.recentWinRate), helper: '완료 fill 기준' }
		];
	}, [gridListData, marketPrices, performanceSummary, signalListData]);

	return (
		<>
			<div className="inner-container">
				<div className="space-y-6">
					<div className="rounded-[28px] border border-[#27313D] bg-[radial-gradient(circle_at_top_left,#233A35_0%,#111820_42%,#0B0E13_100%)] p-5 shadow-[0_28px_70px_rgba(0,0,0,0.28)] md:p-6">
						<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
							<div>
								<p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#8EE6B5]">Performance First</p>
								<h2 className="mt-2 text-[30px] font-semibold text-white md:text-[38px]">수익과 성과를 먼저 확인하세요</h2>
								<p className="mt-2 max-w-3xl text-sm text-[#A7B1C2]">
									내부 주문 lifecycle은 관리자에서 정본 기준으로 관리하고, 사용자 화면은 손익과 전략 성과를 중심으로 보여줍니다.
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									className="rounded-xl border border-white/15 bg-white px-4 py-2 text-sm font-semibold text-black"
									onClick={() => handleOpenNewStrategy(STRATEGY_CATEGORY.SIGNAL)}
								>
									알고리즘 전략 추가
								</button>
								<button
									type="button"
									className="rounded-xl border border-white/15 bg-[#141A22] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2631]"
									onClick={() => handleOpenNewStrategy(STRATEGY_CATEGORY.GRID)}
								>
									그리드 전략 추가
								</button>
							</div>
						</div>

						<div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
							{summaryCards.map((card) => (
								<SummaryCard key={card.label} {...card} />
							))}
						</div>
					</div>

					{isOrderViewOn && (
						<div className="rounded-2xl border border-[#303744] bg-[#141923] p-4">
							{strategyCategory === STRATEGY_CATEGORY.SIGNAL ? (
								<OrderView id={tradingDetailId} getListData={activeGetListData} presetData={presetData} />
							) : (
								<GridOrderView id={tradingDetailId} getListData={activeGetListData} presetData={presetData} />
							)}
						</div>
					)}

					<section className="space-y-3">
						<SectionHeader
							title="알고리즘 전략"
							description="투자금, 현재 포지션, 실현손익, 최근 상태만 빠르게 확인합니다."
						/>
						<TradingGrid
							setTradingDetailId={(id) => {
								setStrategyCategory(STRATEGY_CATEGORY.SIGNAL);
								setTradingDetailId(id);
							}}
							listData={signalListData}
							getListData={loadSignalList}
						/>
					</section>

					<section className="space-y-3">
						<SectionHeader
							title="그리드 전략"
							description="현재 레짐, LONG/SHORT 보유 상태, 누적 손익과 익절 횟수를 중심으로 표시합니다."
						/>
						<GridTradingGrid
							setTradingDetailId={(id) => {
								setStrategyCategory(STRATEGY_CATEGORY.GRID);
								setTradingDetailId(id);
							}}
							listData={gridListData}
							getListData={loadGridList}
						/>
					</section>

					<section className="rounded-2xl border border-[#27313D] bg-[#12161D] p-4">
						<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
							<div>
								<h3 className="text-[18px] font-semibold text-white">차트 보기</h3>
								<p className="mt-1 text-sm text-[#8B96A8]">차트는 보조 정보입니다. 필요할 때만 펼쳐서 확인하세요.</p>
							</div>
							<button
								type="button"
								className="rounded-xl border border-[#3A4655] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2631]"
								onClick={() => setShowChart((value) => !value)}
							>
								{showChart ? '차트 접기' : '차트 펼치기'}
							</button>
						</div>
						{showChart && (
							<div className="mt-4 h-[520px] overflow-hidden rounded-2xl border border-[#27313D] bg-black">
								<TradingViewWidget symbol={symbol} bunbong={bunbong} />
							</div>
						)}
					</section>
				</div>
			</div>
		</>
	);
};

export default TradingPage;
