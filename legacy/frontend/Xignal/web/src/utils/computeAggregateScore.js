export const computeAggregateScore = (currentCandle) => {
	if (!currentCandle || typeof currentCandle !== 'object') return 0;

	const data = currentCandle;
	let score = 0;

	if (data.RSI_Slope > 0.15) score += 1;
	else if (data.RSI_Slope < -0.15) score -= 1;

	if (data.Vol_Z_score > 0.7) score += 1;
	else if (data.Vol_Z_score < -0.7) score -= 1;

	if (data.BBW_NOW < 0.1) {
		if (data.CLOSE_NOW > data.BB_UPPER) score += 1;
		else if (data.CLOSE_NOW < data.BB_LOWER) score -= 1;
	}

	if (data.F_UP_LV1) score += 1;
	if (data.F_DN_LV2) score -= 1;

	return score;
};