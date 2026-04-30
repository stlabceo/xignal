import React from 'react';
import TradingListTable from './TestTradingListTable';

const TestTradingGrid = ({ setTradingDetailId, listData, getListData }) => {
	return (
		<div className="space-y-4 md:space-y-5">
			<TradingListTable setTradingDetailId={setTradingDetailId} listData={listData} getListData={getListData} />
		</div>
	);
};

export default TestTradingGrid;
