import React from 'react';
import { Link } from 'react-router';

const MenuPlaceholderPage = ({ title, description }) => {
	return (
		<div className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#0F172A] sm:px-6 lg:px-8">
			<div className="mx-auto max-w-[960px] rounded-[18px] border border-[#E2E8F0] bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.04)] sm:p-8">
				<p className="text-sm font-semibold text-[#2563EB]">준비 중</p>
				<h1 className="mt-3 text-[28px] font-bold text-[#0F172A]">{title}</h1>
				<p className="mt-2 text-sm text-[#64748B]">{description}</p>
				<Link to="/" className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-[#2563EB] px-4 text-sm font-bold text-white">
					대시보드로 돌아가기
				</Link>
			</div>
		</div>
	);
};

export default MenuPlaceholderPage;
