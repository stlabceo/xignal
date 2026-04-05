import React, { useEffect, useRef, memo } from 'react';

const symbolMap = {
	'BTCUSDT.P': 'BINANCE:BTCUSDT',
	'ETHUSDT.P': 'BINANCE:ETHUSDT',
	'XRPUSDT.P': 'BINANCE:XRPUSDT',
	'SOLUSDT.P': 'BINANCE:SOLUSDT',
	'DOGEUSDT.P': 'BINANCE:DOGEUSDT'
};

const intervalMap = {
	'1분': '1',
	'3분': '3',
	'5분': '5',
	'10분': '10',
	'15분': '15',
	'30분': '30',
	'1Hour': '60',
	'4Hour': '240',
	'1Day': 'D'
};

function TradingViewWidget({ symbol, bunbong }) {
	const containerRef = useRef(null);

	useEffect(() => {
		if (!containerRef.current) return;

		const mappedSymbol = symbolMap[symbol] || 'BINANCE:BTCUSDT';
		const mappedInterval = intervalMap[bunbong] || '60';

		containerRef.current.innerHTML = '';

		const wrapper = document.createElement('div');
		wrapper.className = 'tradingview-widget-container';
		wrapper.style.height = '100%';
		wrapper.style.width = '100%';

		const widgetDiv = document.createElement('div');
		widgetDiv.className = 'tradingview-widget-container__widget';
		widgetDiv.style.height = 'calc(100% - 32px)';
		widgetDiv.style.width = '100%';

		const script = document.createElement('script');
		script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
		script.type = 'text/javascript';
		script.async = true;

		script.innerHTML = JSON.stringify({
			allow_symbol_change: true,
			calendar: false,
			details: false,
			hide_side_toolbar: true,
			hide_top_toolbar: false,
			hide_legend: false,
			hide_volume: false,
			hotlist: false,
			interval: mappedInterval,
			locale: 'en',
			save_image: true,
			style: '1',
			symbol: mappedSymbol,
			theme: 'dark',
			timezone: 'Asia/Seoul',
			backgroundColor: '#0F0F0F',
			gridColor: 'rgba(242, 242, 242, 0.06)',
			watchlist: [],
			withdateranges: false,
			compareSymbols: [],
			studies: [],
			autosize: true
		});

		wrapper.appendChild(widgetDiv);
		wrapper.appendChild(script);
		containerRef.current.appendChild(wrapper);

		return () => {
			if (containerRef.current) {
				containerRef.current.innerHTML = '';
			}
		};
	}, [symbol, bunbong]);

	return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}

export default memo(TradingViewWidget);