import React, { useEffect, useState } from 'react';
import TestHeaderComponent from '../../components/header/TestHeaderComponent';
import TestTradingGrid from './TestTradingGrid';
import TestOrderView from './TestOrderView';
import TestGridTradingGrid from './TestGridTradingGrid';
import TestGridOrderView from './TestGridOrderView';
import { trading } from '../../services/trading';
import TradingViewWidget from './TradingViewWidget';
import { useChartStore } from '../../store/useChartStore';
import { comma } from '../../utils/comma';
import AccountBalancePanel from '../../components/account/AccountBalancePanel';

const symbolLabel = {
	BTCUSDT: 'BTCUSDT.P',
	ETHUSDT: 'ETHUSDT.P',
	XRPUSDT: 'XRPUSDT.P',
	SOLUSDT: 'SOLUSDT.P',
	DOGEUSDT: 'DOGEUSDT.P',
	PUMPUSDT: 'PUMPUSDT.P'
};

const STRATEGY_CATEGORY = {
	SIGNAL: 'SIGNAL',
	GRID: 'GRID'
};

const formatMarketValue = (value) => {
	if (value == null || value === '' || Number.isNaN(Number(value))) {
		return '-';
	}

	return comma(value);
};

const formatTradeTime = (value) => {
	if (!value) return '-';
	return new Date(value).toLocaleTimeString('ko-KR');
};

const TestTradingPage = () => {
	const [isOrderViewOn, setOrderViewOn] = useState(false);
	const [tradingDetailId, setTradingDetailId] = useState(null);
	const [presetData, setPresetData] = useState(null);
	const [strategyCategory, setStrategyCategory] = useState(STRATEGY_CATEGORY.SIGNAL);
	const [signalListData, setSignalListData] = useState([]);
	const [gridListData, setGridListData] = useState([]);
	const [marketPrices, setMarketPrices] = useState({});

	const { symbol, bunbong, setSymbol, setBunbong } = useChartStore();

	useEffect(() => {
		if (!tradingDetailId) return;
		setPresetData(null);
		setOrderViewOn(true);
	}, [tradingDetailId]);

	useEffect(() => {
		const load = () => {
			if (strategyCategory === STRATEGY_CATEGORY.SIGNAL) {
				trading.testList({ live: 'N' }, (res) => {
					if (Array.isArray(res)) {
						setSignalListData([...res]);
					}
				});
				return;
			}

			trading.gridTestList({}, (res) => {
				if (Array.isArray(res)) {
					setGridListData([...res]);
				}
			});
		};

		load();
		const interval = setInterval(load, 1000);
		return () => clearInterval(interval);
	}, [strategyCategory]);

	useEffect(() => {
		const loadPrices = () => {
			trading.livePrice({ live: 'N' }, (res) => {
				if (res && typeof res === 'object') {
					setMarketPrices(res);
				}
			});
		};

		loadPrices();
		const interval = setInterval(loadPrices, 1000);
		return () => clearInterval(interval);
	}, []);

	const handleStrategyCategoryChange = (nextCategory) => {
		setStrategyCategory(nextCategory);
		setTradingDetailId(null);
		setPresetData(null);
		setOrderViewOn(false);
	};

	const handleOpenNewStrategy = () => {
		setTradingDetailId(null);
		setPresetData(
			strategyCategory === STRATEGY_CATEGORY.GRID
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

	const activeListData = strategyCategory === STRATEGY_CATEGORY.SIGNAL ? signalListData : gridListData;
	const activeGetListData =
		strategyCategory === STRATEGY_CATEGORY.SIGNAL
			? () =>
					trading.testList({ live: 'N' }, (res) => {
						if (Array.isArray(res)) {
							setSignalListData([...res]);
						}
					})
			: () =>
					trading.gridTestList({}, (res) => {
						if (Array.isArray(res)) {
							setGridListData([...res]);
						}
					});

	return (
		<>
			<TestHeaderComponent
				isOrderViewOn={isOrderViewOn}
				setOrderViewOn={setOrderViewOn}
				setTradingDetailId={setTradingDetailId}
				symbol={symbol}
				setSymbol={setSymbol}
				bunbong={bunbong}
				setBunbong={setBunbong}
			/>

			<div className="inner-container">
				<div className="space-y-4 md:space-y-5">
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#494949] bg-[#1B1B1B] p-4">
						<div className="flex gap-2">
							<button
								className={`rounded-md px-4 py-2 text-sm font-semibold ${strategyCategory === STRATEGY_CATEGORY.SIGNAL ? 'bg-white text-black' : 'bg-[#0F0F0F] text-white'}`}
								onClick={() => handleStrategyCategoryChange(STRATEGY_CATEGORY.SIGNAL)}
							>
								시그널 전략
							</button>
							<button
								className={`rounded-md px-4 py-2 text-sm font-semibold ${strategyCategory === STRATEGY_CATEGORY.GRID ? 'bg-white text-black' : 'bg-[#0F0F0F] text-white'}`}
								onClick={() => handleStrategyCategoryChange(STRATEGY_CATEGORY.GRID)}
							>
								Grid 전략
							</button>
						</div>
						<button className="rounded-md border border-[#494949] px-4 py-2 text-sm text-white hover:bg-[#0F0F0F]" onClick={handleOpenNewStrategy}>
							{strategyCategory === STRATEGY_CATEGORY.SIGNAL ? '시그널 전략 추가' : 'Grid 전략 추가'}
						</button>
					</div>

					<div className="xignal-trading-main rounded-lg border border-[#494949] bg-[#1B1B1B]">
						<div className={`xignal-trading-chart-wrap bg-[#000] ${isOrderViewOn ? 'xignal-trading-chart-wrap--split' : 'xignal-trading-chart-wrap--full'}`}>
							<div className="xignal-trading-chart-inner h-full w-full">
								<TradingViewWidget symbol={symbol} bunbong={bunbong} />
							</div>
						</div>

						{isOrderViewOn && (
							<div className="xignal-trading-order-wrap border-[#494949]">
								{strategyCategory === STRATEGY_CATEGORY.SIGNAL ? (
									<TestOrderView id={tradingDetailId} getListData={activeGetListData} presetData={presetData} />
								) : (
									<TestGridOrderView id={tradingDetailId} getListData={activeGetListData} presetData={presetData} />
								)}
							</div>
						)}
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						{['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT', 'PUMPUSDT'].map((marketSymbol) => {
							const market = marketPrices?.[marketSymbol] || {};

							return (
								<div key={marketSymbol} className="rounded-lg border border-[#494949] bg-[#1B1B1B] px-4 py-4 text-white">
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="text-[12px] text-[#9E9E9E]">실시간 시장 데이터</p>
											<p className="mt-1 text-[20px] font-semibold">{symbolLabel[marketSymbol]}</p>
										</div>
										<div className="text-right">
											<p className="text-[12px] text-[#9E9E9E]">최근 체결 시간</p>
											<p className="mt-1 text-[13px] text-[#FFFFFF]">{formatTradeTime(market.lastTradeTime)}</p>
										</div>
									</div>

									<div className="mt-4 grid grid-cols-3 gap-2">
										<div className="rounded-md bg-[#0F0F0F] px-3 py-3">
											<p className="text-[11px] text-[#8B8B8B]">실시간 체결가</p>
											<p className="mt-1 text-[16px] font-semibold text-[#FFFFFF]">{formatMarketValue(market.lastPrice)}</p>
										</div>
										<div className="rounded-md bg-[#0F0F0F] px-3 py-3">
											<p className="text-[11px] text-[#8B8B8B]">매수 호가</p>
											<p className="mt-1 text-[16px] font-semibold text-[#3D6EFF]">{formatMarketValue(market.bestBid)}</p>
										</div>
										<div className="rounded-md bg-[#0F0F0F] px-3 py-3">
											<p className="text-[11px] text-[#8B8B8B]">매도 호가</p>
											<p className="mt-1 text-[16px] font-semibold text-[#ED4555]">{formatMarketValue(market.bestAsk)}</p>
										</div>
									</div>
								</div>
							);
						})}
					</div>

					<AccountBalancePanel title="실계정 잔고/리스크 현황" subtitle="Demo 전략을 확인하더라도 실제 Binance 계정 스냅샷을 참고용으로 함께 보여줍니다." />

					{strategyCategory === STRATEGY_CATEGORY.SIGNAL ? (
						<TestTradingGrid setTradingDetailId={setTradingDetailId} listData={activeListData} getListData={activeGetListData} />
					) : (
						<TestGridTradingGrid setTradingDetailId={setTradingDetailId} listData={activeListData} getListData={activeGetListData} />
					)}
				</div>
			</div>
		</>
	);
};

export default TestTradingPage;
