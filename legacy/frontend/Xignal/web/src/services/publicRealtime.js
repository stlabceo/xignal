const DEFAULT_PUBLIC_REALTIME_API_BASE = '';

const getPublicRealtimeBase = () =>
	(import.meta.env.VITE_PUBLIC_REALTIME_API_BASE || DEFAULT_PUBLIC_REALTIME_API_BASE).replace(/\/+$/, '');

const appendParams = (url, params = {}) => {
	Object.entries(params).forEach(([key, value]) => {
		if (value === undefined || value === null || value === '') return;
		url.searchParams.set(key, String(value));
	});
	return url;
};

const buildRequestUrl = (path, params = {}) => {
	const base = getPublicRealtimeBase();
	if (base) return appendParams(new URL(path, base), params).toString();
	const url = appendParams(new URL(path, window.location.origin), params);
	return `${url.pathname}${url.search}`;
};

const itemPath = {
	ny_box: 'ny-box',
	fear_greed: 'fear-greed',
	support_resistance: 'support-resistance'
};

const requestPublicRealtime = async (path, params = {}) => {
	const url = buildRequestUrl(path, params);
	try {
		const response = await fetch(url, {
			headers: { accept: 'application/json' }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			return {
				ok: false,
				dataStatus: 'ERROR',
				items: [],
				raw: payload,
				error: payload?.message || payload?.error || `HTTP ${response.status}`
			};
		}
		const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.items) ? payload.items : [];
		return {
			ok: payload?.ok !== false,
			dataStatus: items.length ? 'READY' : payload?.dataStatus || 'NO_REAL_DATA',
			items,
			raw: payload,
			itemType: payload?.itemType || null,
			timeframe: payload?.timeframe || params.timeframe || null,
			updatedAt: payload?.updatedAt || payload?.meta?.livePriceUpdatedAtKst || null,
			error: payload?.error || null
		};
	} catch (error) {
		return {
			ok: false,
			dataStatus: 'ERROR',
			items: [],
			raw: null,
			error: error?.message || 'public realtime API request failed'
		};
	}
};

const streamParamsForItem = (itemType, params = {}) => {
	if (itemType === 'ny_box') return params;
	if (itemType === 'support_resistance') return { ...params, logic: params.logic || 'vp' };
	return params;
};

const createFetchItemStream = (url, handlers = {}) => {
	let closed = false;
	let controller = null;
	let retryTimer = null;

	const parseChunk = (buffer) => {
		const events = buffer.split('\n\n');
		const rest = events.pop() || '';
		for (const rawEvent of events) {
			const data = rawEvent
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart())
				.join('\n');
			if (!data) continue;
			handlers.onEvent?.(JSON.parse(data));
		}
		return rest;
	};

	const connect = async () => {
		controller = new AbortController();
		let buffer = '';
		try {
			const response = await fetch(url, {
				headers: { accept: 'text/event-stream' },
				signal: controller.signal
			});
			if (!response.ok || !response.body) throw new Error(`Stream failed: ${response.status}`);
			handlers.onOpen?.();
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			while (!closed) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer = parseChunk(buffer + decoder.decode(value, { stream: true }));
			}
		} catch {
			if (!closed) handlers.onError?.();
		}
		if (!closed) {
			retryTimer = window.setTimeout(() => {
				void connect();
			}, 1500);
		}
	};

	void connect();

	return () => {
		closed = true;
		if (retryTimer !== null) window.clearTimeout(retryTimer);
		controller?.abort();
	};
};

const createItemStream = (itemType, params = {}, handlers = {}) => {
	const path = itemPath[itemType];
	if (!path) return () => {};
	const url = buildRequestUrl(`/api/items/${path}/stream`, streamParamsForItem(itemType, params));
	if (typeof EventSource === 'undefined') {
		return createFetchItemStream(url, handlers);
	}
	const source = new EventSource(url);
	let closed = false;
	source.onopen = () => {
		if (!closed) handlers.onOpen?.();
	};
	source.onerror = () => {
		if (!closed) handlers.onError?.();
	};
	for (const eventName of ['snapshot', 'patch', 'heartbeat']) {
		source.addEventListener(eventName, (message) => {
			if (closed) return;
			handlers.onEvent?.(JSON.parse(message.data));
		});
	}
	return () => {
		closed = true;
		source.close();
	};
};

export const publicRealtime = {
	nyBoxSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/ny-box/snapshot', params);
	},
	nyBoxSymbol(symbol, params = {}) {
		return requestPublicRealtime(`/api/items/ny-box/symbol/${encodeURIComponent(symbol)}`, params);
	},
	fearGreedSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/fear-greed/snapshot', params);
	},
	fearGreedSymbol(symbol, params = {}) {
		return requestPublicRealtime(`/api/items/fear-greed/symbol/${encodeURIComponent(symbol)}`, params);
	},
	supportResistanceSnapshot(params = {}) {
		return requestPublicRealtime('/api/items/support-resistance/snapshot', params);
	},
	supportResistanceSymbol(symbol, params = {}) {
		return requestPublicRealtime(`/api/items/support-resistance/symbol/${encodeURIComponent(symbol)}`, params);
	},
	createItemStream
};
