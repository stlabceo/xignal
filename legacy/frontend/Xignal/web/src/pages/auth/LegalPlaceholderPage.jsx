import { Link } from 'react-router';

const LEGAL_COPY = {
	terms: {
		title: 'QUANTU 이용약관',
		description: '정식 약관 문서는 준비 중입니다.'
	},
	privacy: {
		title: 'QUANTU 개인정보처리방침',
		description: '정식 개인정보처리방침 문서는 준비 중입니다.'
	}
};

const LegalPlaceholderPage = ({ type }) => {
	const copy = LEGAL_COPY[type] || LEGAL_COPY.terms;
	return (
		<div className="min-h-screen bg-white px-6 py-10 text-[#0F172A]">
			<div className="mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-[560px] flex-col justify-center">
				<p className="mb-3 text-[13px] font-semibold tracking-[0.18em] text-[#2563EB]">QUANTU</p>
				<h1 className="text-[32px] font-bold leading-tight">{copy.title}</h1>
				<p className="mt-5 rounded-[14px] bg-[#F8FAFC] p-5 text-[15px] leading-7 text-[#334155]">{copy.description}</p>
				<Link to="/register" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-[#2563EB] px-5 text-[15px] font-bold text-white">
					회원가입으로 돌아가기
				</Link>
			</div>
		</div>
	);
};

export default LegalPlaceholderPage;
