import React, { useEffect, useState } from 'react';
import HeaderComponent from '../../components/header/TestHeaderComponent';
import TradingGrid from './TestTradingGrid';
import OrderView from './TestOrderView';
import { trading } from '../../services/trading';
import TradingViewWidget from './TradingViewWidget';
import TrendingSection from './TrendingSection';
import { useChartStore } from '../../store/useChartStore';

const TestTradingPage = () => {
	const [isOrderViewOn, setOrderViewOn] = useState(false);
	const [tradingDetailId, setTradingDetailId] = useState(null);
	const [presetData, setPresetData] = useState(null);
	const [listData, setListData] = useState([]);

	const { symbol, bunbong, setSymbol, setBunbong } = useChartStore();

	useEffect(() => {
		if (!tradingDetailId) return;
		setPresetData(null);
		setOrderViewOn(true);
	}, [tradingDetailId]);

	useEffect(() => {
		getListData();
		const interval = setInterval(() => {
			getListData();
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	const getListData = () => {
		const params = {};
		trading.testList(params, (res) => {
			if (Array.isArray(res)) {
				setListData([...res]);
			}
		});
	};

	const handleTrendingClick = (strategyData) => {
		const currentTrafficLights = useChartStore.getState().trafficLights;

		const directionMap = {
			r: 'Sell',
			y: 'Buy',
			g: 'Buy'
		};

		const strategyTypeMap = {
			y: 'Scalping',
			g: 'GreenLight',
			r: 'GreenLight'
		};

		const aiModeMap = {
			Aggressive: 'Aggressive',
			Moderate: 'Neutral',
			Conservative: 'Conservative'
		};

		const currentDirection = directionMap[currentTrafficLights] || 'Buy';
		const currentStrategyType = strategyTypeMap[currentTrafficLights] || 'GreenLight';
		const presetTimeframe = '10MIN';
		const presetDirection = currentDirection;
		const strategyName = `AI ${strategyData?.title || strategyData?.name || currentStrategyType} ${presetTimeframe} ${presetDirection}`;

		setPresetData({
			a_name: strategyName,
			symbol: 'BTCUSDT',
			bunbong: presetTimeframe,
			signalType: presetDirection,
			type: currentStrategyType,
			AI_ST: aiModeMap[strategyData?.aiModeLabel] || 'Aggressive',
			trendOrderST: false,
			limitST: 'N',
			enter: '',
			profit: '0.5',
			stopLoss: '',
			stopLossReverseEnabled: false,
			stopLossTimeEnabled: true,
			stopLossTimeValue: '180',
			marginType: 'Isolated',
			margin: '100',
			leverage: '20',
			t_cancelStopLoss: '',
			t_chase: ''
		});

		setTradingDetailId(null);
		setOrderViewOn(true);
	};

	return (
		<>
			<HeaderComponent
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
					<div className="xignal-trading-main rounded-lg border border-[#494949] bg-[#1B1B1B]">
						<div
							className={`xignal-trading-chart-wrap bg-[#000] ${
								isOrderViewOn ? 'xignal-trading-chart-wrap--split' : 'xignal-trading-chart-wrap--full'
							}`}
						>
							<div className="xignal-trading-chart-inner h-full w-full">
								<TradingViewWidget symbol={symbol} bunbong={bunbong} />
							</div>
						</div>

						{isOrderViewOn && (
							<div className="xignal-trading-order-wrap border-[#494949]">
								<OrderView id={tradingDetailId} getListData={getListData} presetData={presetData} />
							</div>
						)}
					</div>

					<TrendingSection onStrategyClick={handleTrendingClick} />

					<TradingGrid setTradingDetailId={setTradingDetailId} listData={listData} getListData={getListData} />
				</div>
			</div>
		</>
	);
};

export default TestTradingPage;
