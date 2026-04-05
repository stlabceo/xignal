import React, { useCallback, useEffect, useState } from 'react';
import CheckboxBig from '../../components/form/input/CheckboxBig';
import DefaultDropdown from '../../components/ui/dropdown/DefaultDropdown';
import { trading } from '../../services/trading';
import { useMessageModal } from '../../hooks/useMessageModal';
import Radio from '../../components/form/input/Radio';

const typeEnum = {
	scalping: 'Scalping',
	trend: 'Trend',
	greenlight: 'GreenLight'
};

const signalTypeEnum = {
	BUY: 'Buy',
	SELL: 'Sell',
	TWO: 'Combined'
};

const aiStEnum = {
	attack: 'Aggressive',
	conser: 'Conservative',
	neutral: 'Neutral'
};

const marginTypeEnum = {
	isolated: 'Isolated',
	cross: 'Cross'
};

const STRATEGY_CONFIG = {
	scalping: {
		attack: { second2: 5, second3: 3, second4: 3 },
		conser: { second2: 14, second3: 3, second4: 3 },
		neutral: { second2: 10, second3: 6, second4: 6 }
	},
	trend: {
		attack: { second2: 1.5, second3: null, second4: null },
		conser: { second2: 2.5, second3: null, second4: null },
		neutral: { second2: 2, second3: null, second4: null }
	},
	greenlight: {
		attack: { second2: -1, second3: 1, second4: null },
		conser: { second2: -3, second3: 3, second4: null },
		neutral: { second2: -2, second3: 2, second4: null }
	}
};

const TestOrderView = ({ id, getListData, presetData }) => {
	const showMessage = useMessageModal();

	const [formData, setFormData] = useState({
		a_name: '',
		symbol: 'BTCUSDT',
		bunbong: '1MIN',
		signalType: 'Buy',
		margin: '',
		leverage: '',
		type: 'Scalping',
		enter: '',
		profit: '',
		stopLoss: '',
		stopLossTimeEnabled: false,
		stopLossTimeValue: '',
		stopLossReverseEnabled: false,
		trendOrderST: false,
		t_cancelStopLoss: '',
		t_chase: '',
		limitST: 'N',
		AI_ST: 'Aggressive',
		marginType: 'Isolated',

		live_ST: 'N',
		second1: null,
		second2: null,
		second3: null,
		second4: null,
		repeatConfig: 'repeat',
		profitTradeType: 'per',
		profitFixValue: 'res',
		profitAbsValue: null,
		lossTradeType: 'per',
		lossFixValue: 'res',
		lossAbsValue: null,
		absValue: '0',
		cancel: 0,
		minimumOrderST: 'N',
		m_cancelStopLoss: 0,
		m_profit: 0,
		t_profit: 0,
		t_ST: 'N',
		t_autoST: 'N',
		t_direct: 'N',
		alarmSignalST: 'Y',
		alarmResultST: 'Y',
		orderSize: 1,
		st: 'START',
		status: 'READY',
		autoST: 'N',
		direct1ST: 'N',
		direct2ST: 'N',
		detailTap: 'B',
		selectST: 'Y',
		r_tid: null,
		r_oid: null,
		r_m_st: 'N',
		r_t_st: 'N',
		r_t_tick: 0,
		r_t_cnt: 0,
		r_tempPrice: null,
		r_signalType: null,
		r_signalPrice: null,
		r_signalTime: null,
		r_exactPrice: null,
		r_exactTime: null,
		r_profitPrice: 0,
		r_profitTime: null,
		r_stopPrice: 0,
		r_stopTime: null,
		r_endPrice: 0,
		r_endTime: null,
		r_exact_cnt: 0,
		r_profit_cnt: 0,
		r_profit_tick: 0,
		r_stop_cnt: 0,
		r_stop_tick: 0,
		r_forcing_cnt: 0,
		r_forcing_tick: 0,
		r_real_tick: null,
		r_pol_tick: 0,
		r_charge: 0,
		r_t_charge: 0,
		r_pol_sum: 0,
		r_minQty: 0,
		r_qty: 0,
		r_margin: 0
	});

	const [isSymbolDropDownOn, setSymbolDropDownOn] = useState(false);
	const [isBunbongDropDownOn, setBunbongDropDownOn] = useState(false);
	const [isSignalTypeDropDownOn, setIsSignalTypeDropDownOn] = useState(false);
	const [isTypeDropDownOn, setTypeDropDownOn] = useState(false);
	const [isAISTDropDownOn, setAISTDropDownOn] = useState(false);
	const [isMarginTypeDropDownOn, setMarginTypeDropDownOn] = useState(false);
	const [mode, setMode] = useState('add');

	useEffect(() => {
		if (!id) return;

		setMode('edit');

		const params = { id };
		trading.testDetail(params, (res) => {
			setFormData({
				...res,
				symbol: res.symbol,
				bunbong: res.bunbong + 'MIN',
				signalType: signalTypeEnum[res.signalType] || 'Buy',
				margin: res.margin,
				leverage: res.leverage,
				type: typeEnum[res.type] || 'Scalping',
				enter: res.enter,
				profit: res.profit,
				stopLoss: res.stopLoss || '',
				stopLossTimeEnabled: res.stopLossTimeEnabled || false,
				stopLossTimeValue: res.stopLossTimeValue || '',
				stopLossReverseEnabled: res.stopLossReverseEnabled || false,
				trendOrderST: res.trendOrderST === 'Y',
				t_cancelStopLoss: res.t_cancelStopLoss,
				t_chase: res.t_chase,
				limitST: res.limitST || 'N',
				AI_ST: aiStEnum[res.AI_ST] || 'Aggressive',
				marginType: marginTypeEnum[res.marginType] || 'Isolated'
			});
		});
	}, [id]);

	useEffect(() => {
		if (!presetData) return;

		setMode('add');
		setFormData((prev) => ({
			...prev,
			...presetData
		}));
	}, [presetData]);

	const handleSave = useCallback(() => {
		const editData = { ...formData };

		editData.type = Object.entries(typeEnum).find(([, v]) => v === formData.type)?.[0];
		editData.signalType = Object.entries(signalTypeEnum).find(([, v]) => v === formData.signalType)?.[0];
		editData.trendOrderST = formData.trendOrderST ? 'Y' : 'N';
		editData.bunbong = formData.bunbong.split('MIN')[0];
		editData.AI_ST = Object.entries(aiStEnum).find(([, v]) => v === formData.AI_ST)?.[0];
		editData.marginType = Object.entries(marginTypeEnum).find(([, v]) => v === formData.marginType)?.[0];

		Object.assign(editData, STRATEGY_CONFIG[editData.type][editData.AI_ST]);

		trading.testDetailUpload(editData, null, () => {
			showMessage({
				message: 'Added Successfully',
				confirmText: 'Confirm',
				onConfirm: () => {
					getListData();
				}
			});
		});
	}, [formData, getListData, showMessage]);

	const handleEdit = useCallback(() => {
		const editData = { ...formData };

		editData.type = Object.entries(typeEnum).find(([, v]) => v === formData.type)?.[0];
		editData.signalType = Object.entries(signalTypeEnum).find(([, v]) => v === formData.signalType)?.[0];
		editData.trendOrderST = formData.trendOrderST ? 'Y' : 'N';
		editData.bunbong = formData.bunbong.split('MIN')[0];
		editData.id = id;
		editData.AI_ST = Object.entries(aiStEnum).find(([, v]) => v === formData.AI_ST)?.[0];
		editData.marginType = Object.entries(marginTypeEnum).find(([, v]) => v === formData.marginType)?.[0];

		Object.assign(editData, STRATEGY_CONFIG[editData.type][editData.AI_ST]);

		trading.testDetailEdit(editData, null, () => {
			showMessage({
				message: 'Updated Successfully',
				confirmText: 'Confirm',
				onConfirm: () => {
					getListData();
				}
			});
		});
	}, [formData, getListData, id, showMessage]);

	const rowLabelClass = 'mb-2 flex items-center gap-1.5 text-[13px] text-[#999]';
	const cardClass = 'rounded-xl border border-[#2D2D2D] bg-[#141414] p-4';
	const inputClass =
		'w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5 pr-8 text-right text-white focus:outline-none disabled:bg-[#212121]';
	const dropdownWrapClass = 'w-full rounded-md border border-[#494949] bg-[#0F0F0F] px-3 py-2.5';

	return (
		<div className="h-full w-full bg-[#1B1B1B] p-4 text-white md:p-5">
			<div className="space-y-3 md:space-y-4">
				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">Strategy Setup</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Strategy Name</div>
							<input
								type="text"
								value={formData.a_name}
								onChange={(e) => setFormData({ ...formData, a_name: e.target.value })}
								className="w-full rounded-md border border-[#494949] bg-[#0F0F0F] p-2.5 text-white focus:outline-none"
							/>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Symbol</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.symbol}
									onChange={(value) => setFormData({ ...formData, symbol: value })}
									setIsOpen={setSymbolDropDownOn}
									isOpen={isSymbolDropDownOn}
									option={['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT']}
									className={'w-full'}
								/>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Strategy</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.type || 'Scalping'}
									onChange={(value) => setFormData({ ...formData, type: value })}
									isOpen={isTypeDropDownOn}
									setIsOpen={setTypeDropDownOn}
									option={['Scalping', 'Trend', 'GreenLight']}
									className={'w-full'}
								/>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />AI Mode</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.AI_ST}
									onChange={(value) => setFormData({ ...formData, AI_ST: value })}
									isOpen={isAISTDropDownOn}
									setIsOpen={setAISTDropDownOn}
									option={['Aggressive', 'Conservative', 'Neutral']}
									className={'w-full'}
								/>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />TS Condition</div>
							<div className="flex items-center gap-2">
								<CheckboxBig
									checked={formData.trendOrderST}
									id={'trendOrderST'}
									onChange={(value) => setFormData({ ...formData, trendOrderST: value })}
									className={''}
								/>
								<div className="relative flex-1">
									<input
										type="text"
										value={formData.t_cancelStopLoss}
										onChange={(e) => setFormData({ ...formData, t_cancelStopLoss: e.target.value })}
										className={inputClass}
									/>
									<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
								</div>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Trailing Stop</div>
							<div className="relative">
								<input
									type="text"
									value={formData.t_chase}
									onChange={(e) => setFormData({ ...formData, t_chase: e.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Timeframe</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.bunbong}
									onChange={(value) => setFormData({ ...formData, bunbong: value })}
									isOpen={isBunbongDropDownOn}
									setIsOpen={setBunbongDropDownOn}
									option={['1MIN', '3MIN', '5MIN', '10MIN', '15MIN']}
									className={'w-full'}
								/>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Direction</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.signalType}
									onChange={(value) => setFormData({ ...formData, signalType: value })}
									isOpen={isSignalTypeDropDownOn}
									setIsOpen={setIsSignalTypeDropDownOn}
									option={['Buy', 'Sell', 'Combined']}
									className={'w-full'}
								/>
							</div>
						</div>
					</div>
				</div>

				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">Order Setup</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Margin Mode</div>
							<div className={dropdownWrapClass}>
								<DefaultDropdown
									cur={formData.marginType}
									onChange={(value) => setFormData({ ...formData, marginType: value })}
									isOpen={isMarginTypeDropDownOn}
									setIsOpen={setMarginTypeDropDownOn}
									option={['Isolated', 'Cross']}
									className={'w-full'}
								/>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Margin</div>
							<div className="relative">
								<input
									type="text"
									value={formData.margin}
									onChange={(e) => setFormData({ ...formData, margin: e.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">$</span>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Leverage</div>
							<div className="relative">
								<input
									type="text"
									value={formData.leverage}
									onChange={(e) => setFormData({ ...formData, leverage: e.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">X</span>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Profit</div>
							<div className="relative">
								<input
									type="text"
									value={formData.profit}
									onChange={(e) => setFormData({ ...formData, profit: e.target.value })}
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Limit Order</div>
							<div className="flex items-center gap-2">
								<Radio
									id="radio_option_enter"
									name="radio_option"
									value={formData.limitST}
									checked={formData.limitST === 'Y'}
									onChange={() => {
										setFormData({
											...formData,
											limitST: 'Y'
										});
									}}
								/>
								<div className="relative flex-1">
									<input
										type="text"
										value={formData.enter}
										onChange={(e) => setFormData({ ...formData, enter: e.target.value })}
										disabled={formData.limitST !== 'Y'}
										className={inputClass}
									/>
									<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
								</div>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Market Order</div>
							<div className="flex min-h-[44px] items-center">
								<Radio
									id="radio_option_market"
									name="radio_option"
									value={formData.limitST}
									checked={formData.limitST === 'N'}
									onChange={() => {
										setFormData({
											...formData,
											limitST: 'N'
										});
									}}
								/>
							</div>
						</div>

						<div className="md:col-span-2">
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Trade Amount</div>
							<div className="relative">
								<input
									type="text"
									value={Number(formData.margin || 0) * Number(formData.leverage || 0)}
									onChange={() => {}}
									disabled
									className={inputClass}
								/>
								<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">$</span>
							</div>
						</div>
					</div>
				</div>

				<div className={cardClass}>
					<h3 className="mb-4 text-[15px] font-semibold text-white">Risk Management</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Stop Loss (%)</div>
							<div className="flex items-center gap-2">
								<CheckboxBig
									checked={formData.stopLoss !== ''}
									id="stopLossEnabled"
									onChange={() => {
										if (formData.stopLoss !== '') {
											setFormData({
												...formData,
												stopLoss: ''
											});
										}
									}}
									className={''}
								/>
								<div className="relative flex-1">
									<input
										type="text"
										value={formData.stopLoss}
										onChange={(e) => setFormData({ ...formData, stopLoss: e.target.value })}
										className={inputClass}
									/>
									<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">%</span>
								</div>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Reverse Signal</div>
							<div className="flex min-h-[44px] items-center">
								<CheckboxBig
									checked={formData.stopLossReverseEnabled}
									id="stopLossReverseEnabled"
									onChange={(value) =>
										setFormData({
											...formData,
											stopLossReverseEnabled: value
										})
									}
									className={''}
								/>
							</div>
						</div>

						<div>
							<div className={rowLabelClass}><p className="h-1 w-1 rounded-full bg-[#999]" />Time Stop</div>
							<div className="flex items-center gap-2">
								<CheckboxBig
									checked={formData.stopLossTimeEnabled}
									id="stopLossTimeEnabled"
									onChange={(value) => {
										setFormData({
											...formData,
											stopLossTimeEnabled: value
										});
									}}
									className={''}
								/>
								<div className="relative flex-1">
									<input
										type="text"
										value={formData.stopLossTimeValue}
										onChange={(e) => setFormData({ ...formData, stopLossTimeValue: e.target.value })}
										disabled={!formData.stopLossTimeEnabled}
										className={inputClass}
										placeholder="10"
									/>
									<span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999]">min</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="flex justify-end pt-1">
					{mode === 'add' ? (
						<button
							className="cursor-pointer rounded-md border border-[#494949] px-6 py-2 hover:bg-[#0f0f0f]"
							onClick={handleSave}
						>
							Add
						</button>
					) : (
						<button
							className="cursor-pointer rounded-md border border-[#494949] px-6 py-2 hover:bg-[#0f0f0f]"
							onClick={handleEdit}
						>
							Modify
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

export default TestOrderView;
