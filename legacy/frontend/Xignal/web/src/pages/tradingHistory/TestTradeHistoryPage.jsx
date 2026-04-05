import React, { useCallback, useEffect, useState } from 'react';
import { trading } from '../../services/trading';
import { useNavigate } from 'react-router';
import DatePicker from '../../components/form/input/DatePicker';
import { getDateFormat } from '../../utils/getDateFormat';
import { comma } from '../../utils/comma';
import Pagination from '../../components/ui/pagination/Pagination';
import { DefaultModal } from '../../components/modal/DefaultModal';

const typeEnum = {
	scalping: 'Scalping',
	trend: 'Trend',
	greenlight: 'GreenLight'
};

const signalTypeEnum = {
	BUY: 'Buy',
	SELL: 'Sell',
	TWO: 'Both'
};

const TestTradeHistoryPage = () => {
	const navigate = useNavigate();
	const [topData, setTopData] = useState({});
	const [doneData, setDoneData] = useState([]);
	const [progressData, setProgressData] = useState([]);
	const [sd, setSd] = useState(null);
	const [ed, setEd] = useState(null);
	const [page, setPage] = useState(1);
	const [totalPage, setTotalPage] = useState(1);
	const [tap, setTap] = useState('done');
	const PAGE_SIZE = 10;
	const [isSearchModalOn, setSearchModalOn] = useState(false);
	const [searchList, setSearchList] = useState([]);

	useEffect(() => {
		if (tap === 'done') {
			const today = new Date();
			const oneMonthAgo = new Date();
			oneMonthAgo.setMonth(today.getMonth() - 1);

			setSd(oneMonthAgo.toISOString().slice(0, 10));
			setEd(today.toISOString().slice(0, 10));
			getTopData();
		} else {
			const params = {
				page,
				size: PAGE_SIZE
			};
			trading.getTestExactTrackRecord(params, (res) => {
				setProgressData(res);
			});
		}
	}, [tap, page]);

	useEffect(() => {
		if (!sd || !ed) return;
		const params = {
			sDate: sd,
			eDate: ed,
			page,
			size: PAGE_SIZE
		};
		trading.getTestTrackRecord(params, (res) => {
			if (res === false) return;
			setDoneData(res.item);
			setTotalPage(Math.ceil(res.pageInfo.totalCount / PAGE_SIZE));
		});
	}, [page, sd, ed]);

	const getTopData = useCallback(() => {
		trading.testRate((res) => {
			setTopData(res);
		});
	}, []);

	const searchByName = () => {
		trading.searchTestTrackRecordByName({}, (res) => {
			setSearchList(res);
			setSearchModalOn(true);
		});
	};

	return (
		<div className="inner-container">
			<div className="mb-5 flex flex-col gap-3 md:mb-5.5 md:flex-row md:items-center md:gap-4">
				<h2 className="text-[26px] font-bold text-[#fff] md:text-[32px]">TRACK RECORD</h2>
				<div className="flex items-center gap-2">
					<div className="rounded-sm border border-[#494949] px-2 text-[14px] font-bold text-[#fff] md:text-[16px]">TRADING</div>
					<div className="rounded-sm bg-[#fff] px-2 text-[14px] font-bold md:text-[16px]">DEMO</div>
				</div>
			</div>

			<div className="mb-5 flex gap-4 overflow-x-auto text-[18px] font-bold md:gap-5 md:text-[22px]">
				<button
					className={`shrink-0 px-2 pb-2 cursor-pointer ${tap === 'done' ? 'text-[#fff] border-b-4 border-[#fff]' : 'text-[#666666]'}`}
					onClick={() => {
						setTap('done');
						setPage(1);
					}}
				>
					Settled Trades
				</button>
				<button
					className={`shrink-0 px-2 pb-2 cursor-pointer ${tap === 'inProgress' ? 'text-[#fff] border-b-4 border-[#fff]' : 'text-[#666666]'}`}
					onClick={() => {
						setTap('inProgress');
						setPage(1);
					}}
				>
					Open Trades
				</button>
			</div>

			<div className="w-full pb-5">
				{tap === 'done' ? (
					<>
						<div className="mb-5 rounded-lg bg-[#1B1B1B] p-4 md:p-5">
							<div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:flex xl:items-center xl:gap-12">
									<div className="flex items-center gap-2.5 rounded-lg bg-[#161616] p-3">
										<div className="flex min-w-[82px] items-center justify-center rounded-lg bg-[#0F0F0F] px-3 py-2">
											<p className="text-[14px] text-[#999999] md:text-[16px]">Total P/L</p>
										</div>
										<p className="text-[22px] font-bold text-[#fff] md:text-[25px]">{comma(topData?.pol_sum || 0)}$</p>
									</div>

									<div className="flex items-center gap-2.5 rounded-lg bg-[#161616] p-3">
										<div className="flex min-w-[82px] items-center justify-center rounded-lg bg-[#0F0F0F] px-3 py-2">
											<p className="text-[14px] text-[#999999] md:text-[16px]">Win Rate</p>
										</div>
										<p className="text-[22px] font-bold text-[#fff] md:text-[25px]">{comma(topData?.win_rate || 0)}%</p>
									</div>
								</div>

								<div className="flex flex-col gap-3 xl:items-end">
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:gap-5">
										<button
											className="rounded-md border border-[#494949] bg-[#0F0F0F] px-4 py-2 text-[14px] font-bold text-[#fff] cursor-pointer md:text-[15px]"
											onClick={searchByName}
										>
											Search Strategy
										</button>
									</div>

									<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center text-sm text-[#fff]">
										<div className="min-w-0 flex-1 sm:flex-none">
											<DatePicker date={sd} setDate={setSd} />
										</div>
										<span className="hidden sm:inline">~</span>
										<div className="min-w-0 flex-1 sm:flex-none">
											<DatePicker date={ed} setDate={setEd} />
										</div>
										<button
											className="rounded-md border border-[#494949] bg-[#0F0F0F] px-4 py-2 text-[14px] font-bold text-[#fff] cursor-pointer md:text-[15px]"
										>
											Search
										</button>
									</div>
								</div>
							</div>
						</div>

						<div className="md:hidden space-y-3">
							{doneData.map((item, idx) => (
								<div
									key={`test_done_trade_mobile_${idx}`}
									className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4 text-white cursor-pointer"
									onClick={() => navigate(`/test/trade-history/${item.pid}`)}
								>
									<div className="mb-3 break-all text-[16px] font-semibold">{item.a_name}</div>
									<div className="grid grid-cols-1 gap-2 text-sm">
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Close Time</span>
											<span className="text-right">{getDateFormat(new Date(item.closeTime), 'YYYY.MM.DD hh:mm')}</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Entry Time</span>
											<span className="text-right">{getDateFormat(new Date(item.openTime), 'YYYY.MM.DD hh:mm')}</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Strategy/Candle</span>
											<span className="text-right">{typeEnum[item.type]}/{item.bunbong}min</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Trade Amount</span>
											<span className="text-right">{item.margin}$ X {item.leverage} = {item.margin * item.leverage}$</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Direction</span>
											<span
												className={`text-right font-semibold ${
													item.signalType === 'BUY'
														? 'text-[#FF3D3D]'
														: item.signalType === 'SELL'
														? 'text-[#225CEF]'
														: 'text-[#fff]'
												}`}
											>
												{signalTypeEnum[item.signalType]}
											</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">P/L</span>
											<span className="text-right">{comma(item.pol_sum)}$</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Win/Lose</span>
											<span className={`text-right font-semibold ${item.win_loss === 'Lose' ? 'text-[#666666]' : ''}`}>
												{item.win_loss}
											</span>
										</div>
									</div>
								</div>
							))}
						</div>

						<div className="hidden md:flex items-stretch justify-center bg-[#1B1B1B] rounded-lg overflow-x-auto">
							<table className="w-full table-fixed text-[16px] text-center whitespace-nowrap overflow-hidden">
								<thead className="bg-[#1A1C22] border-b border-[#4E5766] text-[#828DA0] font-medium">
									<tr>
										<th className="px-5 py-4.5">Close Time</th>
										<th className="px-5 py-4.5">Entry Time</th>
										<th className="px-5 py-4.5">Strategy Name</th>
										<th className="px-5 py-4.5">Strategy/Candle</th>
										<th className="px-5 py-4.5">Trade Amount</th>
										<th className="px-5 py-4.5">Direction</th>
										<th className="px-5 py-4.5">P/L</th>
										<th className="px-5 py-4.5">Win/Lose</th>
									</tr>
								</thead>
								<tbody>
									{Boolean(doneData.length) &&
										doneData.map((item, idx) => (
											<tr
												key={`trading_list_item${idx}`}
												className="border-b border-[#494949] cursor-pointer text-[#FFFFFF]"
												onClick={() => navigate(`/test/trade-history/${item.pid}`)}
											>
												<td className="px-5 py-4">{getDateFormat(new Date(item.closeTime), 'YYYY.MM.DD hh:mm')}</td>
												<td className="px-5 py-4">{getDateFormat(new Date(item.openTime), 'YYYY.MM.DD hh:mm')}</td>
												<td className="px-5 py-4">{item.a_name}</td>
												<td className="px-5 py-4">{typeEnum[item.type]}/{item.bunbong}min</td>
												<td className="px-5 py-4">{item.margin}$X{item.leverage}={item.margin * item.leverage}$</td>
												<td
													className={`px-5 py-4 font-semibold ${
														item.signalType === 'BUY'
															? 'text-[#FF3D3D]'
															: item.signalType === 'SELL'
															? 'text-[#225CEF]'
															: 'text-[#fff]'
													}`}
												>
													{signalTypeEnum[item.signalType]}
												</td>
												<td className="px-5 py-4">{comma(item.pol_sum)}$</td>
												<td className={`px-5 py-4 font-semibold ${item.win_loss === 'Lose' ? 'text-[#666666]' : ''}`}>
													{item.win_loss}
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>

						<Pagination currentPage={page} totalPages={totalPage} onPageChange={(newPage) => setPage(newPage)} />
					</>
				) : (
					<div className="flex flex-col gap-4">
						<div className="rounded-lg bg-[#1B1B1B] p-4 md:p-5">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<button
									className="rounded-md border border-[#494949] bg-[#0F0F0F] px-4 py-2 text-[14px] font-bold text-[#fff] cursor-pointer md:text-[15px]"
									onClick={searchByName}
								>
									Search Strategy
								</button>
							</div>
						</div>

						<div className="md:hidden space-y-3">
							{progressData.map((item, idx) => (
								<div
									key={`test_progress_trade_mobile_${idx}`}
									className="rounded-lg border border-[#2d3340] bg-[#1B1B1B] p-4 text-white cursor-pointer"
									onClick={() => navigate(`/test/trade-history/${item.pid}`)}
								>
									<div className="mb-3 break-all text-[16px] font-semibold">{item.a_name}</div>
									<div className="grid grid-cols-1 gap-2 text-sm">
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Entry Time</span>
											<span className="text-right">{getDateFormat(new Date(item.openTime), 'YYYY.MM.DD hh:mm')}</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Symbol</span>
											<span className="text-right">{item.symbol}</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Entry Price</span>
											<span className="text-right">{comma(item.openPrice)}$</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Strategy/Candle</span>
											<span className="text-right">{typeEnum[item.type]}/{item.bunbong}min</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Trade Amount</span>
											<span className="text-right">{item.margin}$ X {item.leverage} = {item.margin * item.leverage}$</span>
										</div>
										<div className="flex justify-between gap-4">
											<span className="text-[#828DA0]">Direction</span>
											<span className="text-right font-semibold">{signalTypeEnum[item.r_signalType]}</span>
										</div>
									</div>
								</div>
							))}
						</div>

						<div className="hidden md:flex items-stretch justify-center bg-[#1B1B1B] rounded-lg overflow-x-auto">
							<table className="w-full table-fixed text-[16px] text-center whitespace-nowrap overflow-hidden">
								<thead className="bg-[#1A1C22] border-b border-[#4E5766] text-[#828DA0] font-medium">
									<tr>
										<th className="px-5 py-4.5">Entry Time</th>
										<th className="px-5 py-4.5">Symbol</th>
										<th className="px-5 py-4.5">Entry Price</th>
										<th className="px-5 py-4.5">Strategy Name</th>
										<th className="px-5 py-4.5">Strategy/Candle</th>
										<th className="px-5 py-4.5">Trade Amount</th>
										<th className="px-5 py-4.5">Direction</th>
									</tr>
								</thead>
								<tbody>
									{Boolean(progressData.length) &&
										progressData.map((item, idx) => (
											<tr
												key={`trading_list_item${idx}`}
												className="border-b border-[#494949] cursor-pointer text-[#FFFFFF]"
												onClick={() => navigate(`/test/trade-history/${item.pid}`)}
											>
												<td className="px-5 py-4">{getDateFormat(new Date(item.openTime), 'YYYY.MM.DD hh:mm')}</td>
												<td className="px-5 py-4">{item.symbol}</td>
												<td className="px-5 py-4">{comma(item.openPrice)}$</td>
												<td className="px-5 py-4">{item.a_name}</td>
												<td className="px-5 py-4">{typeEnum[item.type]}/{item.bunbong}min</td>
												<td className="px-5 py-4">{item.margin}$X{item.leverage}={item.margin * item.leverage}$</td>
												<td className="px-5 py-4 font-semibold">{signalTypeEnum[item.r_signalType]}</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</div>

			<DefaultModal isOpen={isSearchModalOn} showCloseButton={false} className="w-[92vw] max-w-[720px] md:w-2/3 xl:w-1/3">
				<div className="flex items-center justify-between border-b border-[#494949] p-4 md:p-5">
					<h2 className="text-[18px] font-semibold text-[#fff] md:text-[22px]">Strategy Search Results</h2>
					<button
						onClick={() => setSearchModalOn(false)}
						className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 cursor-pointer"
					>
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path
								fillRule="evenodd"
								clipRule="evenodd"
								d="M6.04289 16.5413C5.65237 16.9318 5.65237 17.565 6.04289 17.9555C6.43342 18.346 7.06658 18.346 7.45711 17.9555L11.9987 13.4139L16.5408 17.956C16.9313 18.3466 17.5645 18.3466 17.955 17.956C18.3455 17.5655 18.3455 16.9323 17.955 16.5418L13.4129 11.9997L17.955 7.4576C18.3455 7.06707 18.3455 6.43391 17.955 6.04338C17.5645 5.65286 16.9313 5.65286 16.5408 6.04338L11.9987 10.5855L7.45711 6.0439C7.06658 5.65338 6.43342 5.65338 6.04289 6.0439C5.65237 6.43442 5.65237 7.06759 6.04289 7.45811L10.5845 11.9997L6.04289 16.5413Z"
								fill="currentColor"
							/>
						</svg>
					</button>
				</div>
				<div className="my-6 max-h-[500px] space-y-3 overflow-y-auto px-4 md:px-5">
					{searchList.map((item) => (
						<div key={item.id} className="flex flex-col gap-3 rounded-lg bg-[#1B1B1B] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
							<p className="break-all px-2 py-1 text-[16px] text-[#fff] md:text-[19px]">{item.a_name}</p>
							<button
								className="rounded-lg border border-[#494949] bg-[#0F0F0F] px-4 py-2 text-[15px] text-[#fff] cursor-pointer md:text-[17px]"
								onClick={() => {
									navigate(`/test/trade-history/${item.id}`);
									setSearchModalOn(false);
								}}
							>
								Select
							</button>
						</div>
					))}
				</div>
			</DefaultModal>
		</div>
	);
};

export default TestTradeHistoryPage;