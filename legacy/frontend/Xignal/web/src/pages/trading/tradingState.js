export const isTradingEnabled = (item = {}) => {
	const rawEnabled = item.enabled;
	if (typeof rawEnabled === 'boolean') {
		return rawEnabled;
	}

	const normalized = String(rawEnabled ?? '').trim().toUpperCase();
	if (['Y', 'YES', 'TRUE', '1', 'ON', 'START'].includes(normalized)) {
		return true;
	}
	if (['N', 'NO', 'FALSE', '0', 'OFF', 'STOP'].includes(normalized)) {
		return false;
	}

	const controlState = String(item.controlState ?? '').trim().toUpperCase();
	return ['Y', 'TRUE', '1', 'ON', 'START'].includes(controlState);
};

export const stopTradingActionEvent = (event) => {
	event?.preventDefault?.();
	event?.stopPropagation?.();
};

export const buildStrategyDeletePayload = (id) => ({
	idList: [{ id }],
	confirmDelete: true,
	deleteIntent: 'USER_DELETE_STRATEGY',
});

export const confirmStrategyDelete = (label = 'strategy') => {
	if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
		return true;
	}
	return window.confirm(`${label} will be permanently deleted. OFF only does not delete rows. Continue?`);
};
