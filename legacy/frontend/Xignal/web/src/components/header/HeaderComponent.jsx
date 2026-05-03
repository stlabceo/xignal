import { useCallback, useEffect, useRef, useState } from 'react';

import BitIcon from '../../assets/icon/bitcoin.png';
import SolanaIcon from '../../assets/icon/solana.png';
import DogeIcon from '../../assets/icon/doge.png';
import EthIcon from '../../assets/icon/Ethereum.png';
import XrpIcon from '../../assets/icon/xrp.png';
import DefaultDropdown from '../ui/dropdown/DefaultDropdown';
import CenterModal from '../modal/CenterModal';
import { trading } from '../../services/trading';
import { comma } from '../../utils/comma';
import { computeAggregateScore } from '../../utils/computeAggregateScore';
import TrafficLight from './TrafficLight';

const symbolLabel = {
	'BTCUSDT.P': 'BTCUSDT',
	'ETHUSDT.P': 'ETHUSDT',
	'XRPUSDT.P': 'XRPUSDT',
	'SOLUSDT.P': 'SOLUSDT',
	'DOGEUSDT.P': 'DOGEUSDT',
	'PUMPUSDT.P': 'PUMPUSDT'
};

const bunbongLabel = {
	'1Hour': '1h',
	'4Hour': '4h',
	'1Day': '1d'
};

const HeaderComponent = ({ isOrderViewOn, setOrderViewOn = () => {}, setTradingDetailId, symbol, setSymbol, bunbong, setBunbong }) => {
	const [isCenterModalOn, setCenterModalOn] = useState(false);
	const [centerModalData, setCenterModalData] = useState([]);
	const [isTopDropdownOn, setTopDropdownOn] = useState(false);
	const [isBottomDropdownOn, setBottomDropdownOn] = useState(false);
	const [livePrice, setLivePrice] = useState({});
	const [trafficLightState, setTrafficLightState] = useState({
		active: 'y',
		direction: null,
		isBlinking: false,
		score: 0
	});

	const prevScoreMapRef = useRef({});

	useEffect(() => {
		getCandleData();
		const interval = setInterval(() => {
			getCandleData();
		}, 1000);
		return () => clearInterval(interval);
	}, [symbol, bunbong]);

	useEffect(() => {
		getData();
		const interval = setInterval(() => {
			getData();
		}, 1000);
		return () => clearInterval(interval);
	}, [centerModalData, symbol]);

	useEffect(() => {
		const currentCandle = centerModalData?.[0];
		if (!currentCandle) {
			setTrafficLightState({
				active: 'y',
				direction: null,
				isBlinking: false,
				score: 0
			});
			return;
		}

		const score = computeAggregateScore(currentCandle);
		const key = `${symbol}__${bunbong}`;
		const prevScore = prevScoreMapRef.current[key];

		let direction = null;
		if (typeof prevScore === 'number') {
			if (score > prevScore) direction = 'up';
			else if (score < prevScore) direction = 'down';
			else direction = 'flat';
		}

		let active = 'y';
		if (score >= 2) active = 'g';
		else if (score <= -2) active = 'r';
		const isBlinking = [2, 1, -1, -2].includes(score);

		setTrafficLightState({
			active,
			direction,
			isBlinking,
			score
		});

		prevScoreMapRef.current[key] = score;
	}, [centerModalData, symbol, bunbong]);

	const getData = useCallback(() => {
		trading.livePrice({ live: 'Y' }, (res) => {
			const current = res?.[symbolLabel[symbol]]?.bestBid;
			const past = centerModalData?.[1]?.CLOSE_NOW;
			const diff = current != null && past != null ? current - past : 0;
			const rate = past ? (diff / past) * 100 : 0;

			let rateText = '0%';
			if (rate > 0) {
				rateText = `${comma(rate)}% 상승`;
			} else if (rate < 0) {
				rateText = `${comma(Math.abs(rate))}% 하락`;
			}

			let tempBestData = null;
			if (symbol === 'BTCUSDT.P' || symbol === 'ETHUSDT.P') {
				tempBestData = {
					bestAsk: comma(res?.[symbolLabel[symbol]]?.bestAsk),
					bestBid: comma(res?.[symbolLabel[symbol]]?.bestBid),
					lastPrice: comma(res?.[symbolLabel[symbol]]?.lastPrice)
				};
			} else {
				tempBestData = {
					bestAsk: comma(res?.[symbolLabel[symbol]]?.bestAsk, true),
					bestBid: comma(res?.[symbolLabel[symbol]]?.bestBid, true),
					lastPrice: comma(res?.[symbolLabel[symbol]]?.lastPrice, true)
				};
			}

			setLivePrice({
				...res?.[symbolLabel[symbol]],
				rate: rateText,
				...tempBestData
			});
		});
	}, [centerModalData, symbol]);

	const getCandleData = useCallback(() => {
		const params = {
			symbol: symbolLabel[symbol],
			bunbong: bunbongLabel[bunbong]
		};

		trading.candle(params, (res) => {
			setCenterModalData(Array.isArray(res) ? res : []);
		});
	}, [symbol, bunbong]);

	return (
		<header className="relative w-full">
			<div className="w-full rounded-lg bg-[#1B1B1B]">
				<div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-stretch xl:justify-between">
					<div className="grid grid-rows-[auto_auto] gap-2 xl:w-[30%]">
						<div className="grid grid-cols-[72px_1fr] gap-2">
							<div className="flex items-center justify-center rounded-md bg-[#0F0F0F] p-4">
								{symbol === 'BTCUSDT.P' && <img className="h-[28px] w-[28px]" src={BitIcon} alt="bitIcon" />}
								{symbol === 'ETHUSDT.P' && <img className="h-[28px] w-[28px]" src={EthIcon} alt="ethIcon" />}
								{symbol === 'XRPUSDT.P' && <img className="h-[28px] w-[28px]" src={XrpIcon} alt="xrpIcon" />}
								{symbol === 'SOLUSDT.P' && <img className="h-[28px] w-[28px]" src={SolanaIcon} alt="solanaIcon" />}
								{symbol === 'DOGEUSDT.P' && <img className="h-[28px] w-[28px]" src={DogeIcon} alt="dogeIcon" />}
								{symbol === 'PUMPUSDT.P' && (
									<div className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-[#F97316] text-[14px] font-bold text-white">P</div>
								)}
							</div>

							<div className="grid grid-rows-2 gap-2 text-[14px] text-[#ffffff]">
								<div className="flex min-h-[42px] items-center rounded-md bg-[#0F0F0F] px-3">
									<DefaultDropdown cur={symbol} onChange={setSymbol} isOpen={isTopDropdownOn} setIsOpen={setTopDropdownOn} option={['BTCUSDT.P', 'ETHUSDT.P', 'XRPUSDT.P', 'SOLUSDT.P', 'DOGEUSDT.P', 'PUMPUSDT.P']} className="w-full" />
								</div>

								<div className="flex min-h-[42px] items-center rounded-md bg-[#0F0F0F] px-3">
									<DefaultDropdown cur={bunbong} onChange={setBunbong} isOpen={isBottomDropdownOn} setIsOpen={setBottomDropdownOn} option={['1Hour', '4Hour', '1Day']} className="w-full" />
								</div>
							</div>
						</div>

						<div className="grid grid-cols-3 gap-2 text-[13px] md:text-[14px]">
							<div className="flex min-h-[34px] items-center justify-center rounded-md bg-[#0F0F0F] py-1.5 text-[#ED4555]">{livePrice.bestAsk}</div>
							<div className="flex min-h-[34px] items-center justify-center rounded-md bg-[#0F0F0F] py-1.5 text-[#3D6EFF]">{livePrice.bestBid}</div>
							<div className="flex min-h-[34px] items-center justify-center rounded-md bg-[#0F0F0F] py-1.5 text-[#ffffff]">{livePrice.lastPrice || livePrice.rate}</div>
						</div>
					</div>

					<div className="flex flex-col gap-3 xl:w-[70%] xl:flex-row">
						<div className="flex min-h-[138px] w-full items-center justify-center rounded-[22px] bg-[#0F0F0F] px-4 py-4">
							<TrafficLight active={trafficLightState.active} direction={trafficLightState.direction} isBlinking={trafficLightState.isBlinking} score={trafficLightState.score} />
						</div>

						<div className="shrink-0 rounded-md bg-[#0F0F0F] xl:w-[132px]">
							<button
								className="group flex min-h-[138px] w-full cursor-pointer flex-col items-center justify-center gap-3 px-4 py-4"
								onClick={() => {
									setOrderViewOn(!isOrderViewOn);
									setTradingDetailId(null);
								}}
							>
								<div className="text-[18px] font-bold text-[#666666] group-hover:text-[#ffffff]">주문 설정</div>
								<svg xmlns="http://www.w3.org/2000/svg" width="22" height="12" viewBox="0 0 24 14" fill="none">
									<path
										d="M12.9174 12.8447C12.1788 13.5733 10.9991 13.5733 10.2605 12.8447L0.575801 3.29025C-0.642356 2.08815 0.200635 0 1.90425 0H21.2732C22.9772 0 23.8202 2.08815 22.6016 3.29025L12.9174 12.8447Z"
										className="fill-[#666666] group-hover:fill-[#ffffff]"
									/>
								</svg>
							</button>
						</div>
					</div>
				</div>
			</div>

			{isCenterModalOn && (
				<div className="absolute left-0 right-5 top-54">
					<CenterModal centerModalData={centerModalData} />
				</div>
			)}
		</header>
	);
};

export default HeaderComponent;
