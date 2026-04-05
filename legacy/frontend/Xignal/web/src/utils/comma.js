export const comma = (str, f3 = false) => {
	const num = Number(str);
	if (isNaN(num)) return String(str);

	const floored = f3 ? floorTo3(num) : floorTo2(num);
	const isDecimal = String(floored).includes('.');

	if (isDecimal) {
		const fixed = num.toFixed(2);
		const [intPart, decimalPartRaw] = String(floored).split('.');
		const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

		const decimalPart = decimalPartRaw.padEnd(2, '0');

		return `${formattedInt}.${decimalPart}`;
	} else {
		const formatted = Math.floor(num)
			.toString()
			.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return formatted;
	}
};

export const uncomma = (str) => {
	str = String(str);
	return str.replace(/[^\d]+/g, '');
};

export const formatPrice = (price) => {
	// 10달러 미만 코인은 소수점 4자리
	return price < 10 ? Number(price).toFixed(4) : price;
};

export const floorTo2 = (num) => {
	return Math.floor(num * 100) / 100;
};

export const floorTo3 = (num) => {
	return Math.floor(num * 1000) / 1000;
};
