export const getDateFormat = (date, format) => {
	if (!date) return '';

	let targetDate = date;
	if (!(targetDate instanceof Date)) {
		targetDate = new Date(targetDate);
	}

	if (Number.isNaN(targetDate.getTime())) {
		return '';
	}

	const YYYY = targetDate.getFullYear().toString();
	const YY = YYYY.slice(2, 4);
	const month = (targetDate.getMonth() + 1).toString();
	const MM = month.length === 1 ? `0${month}` : month;
	const dayOfMonth = targetDate.getDate().toString();
	const DD = dayOfMonth.length === 1 ? `0${dayOfMonth}` : dayOfMonth;
	const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
	const day = WEEKDAY[targetDate.getDay()];
	const hour = targetDate.getHours().toString();
	const hh = hour.length === 1 ? `0${hour}` : hour;
	const minute = targetDate.getMinutes().toString();
	const mm = minute.length === 1 ? `0${minute}` : minute;

	switch (format) {
		case 'YYYY-MM-DD':
			return `${YYYY}-${MM}-${DD}`;
		case 'YYYY.MM.DD':
			return `${YYYY}.${MM}.${DD}`;
		case 'YY.MM.DD(day)':
			return `${YY}.${MM}.${DD}(${day})`;
		case 'YY.MM.DD':
			return `${YY}.${MM}.${DD}`;
		case 'MM.DD':
			return `${MM}.${DD}`;
		case 'YY-MM-DD':
			return `${YY}-${MM}-${DD}`;
		case 'YY/MM/DD':
			return `${YY}/${MM}/${DD}`;
		case 'YYYY/MM/DD':
			return `${YYYY}/${MM}/${DD}`;
		case 'YY-MM-DD hh:mm':
			return `${YY}-${MM}-${DD} ${hh}:${mm}`;
		case 'YYYY-MM-DD hh:mm':
			return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
		case 'YYYY.MM.DD hh:mm':
			return `${YYYY}.${MM}.${DD} ${hh}:${mm}`;
		case 'YYYY년 MM월 DD일':
			return `${YYYY}년 ${MM}월 ${DD}일`;
		default:
			return '';
	}
};

export const getKoreanTimeString = (utcISOString) => {
	const date = utcISOString ? new Date(utcISOString) : new Date();
	const koreanTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

	const hours = koreanTime.getHours().toString().padStart(2, '0');
	const minutes = koreanTime.getMinutes().toString().padStart(2, '0');
	const seconds = koreanTime.getSeconds().toString().padStart(2, '0');

	return `${hours}:${minutes}:${seconds}`;
};
