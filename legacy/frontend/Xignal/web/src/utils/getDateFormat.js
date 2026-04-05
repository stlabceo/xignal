export const getDateFormat = (date, format) => {
	if (!date) return '';

	// 혹시 문자열 들어오는 경우 방어적으로 처리해도 좋음
	if (!(date instanceof Date)) {
		date = new Date(date);
	}

	const YYYY = date.getFullYear().toString();
	const YY = YYYY.slice(2, 4);

	const month = (date.getMonth() + 1).toString();
	const MM = month.length === 1 ? '0' + month : month;

	const D = date.getDate().toString();
	const DD = D.length === 1 ? '0' + D : D;

	const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
	const day = WEEKDAY[date.getDay()];

	const hour = date.getHours().toString();
	const hh = hour.length === 1 ? '0' + hour : hour;

	const minutes = date.getMinutes().toString();
	const mm = minutes.length === 1 ? '0' + minutes : minutes;

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
			return `${YYYY}.${MM}.${DD}-${hh}:${mm}`;
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
