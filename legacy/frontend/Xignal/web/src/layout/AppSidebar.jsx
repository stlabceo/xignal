import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import logo from '../assets/logo/logo_xignal.svg';
import MessageModal from '../components/modal/pageModal/MessageModal';
import { useNotifyStore } from '../store/notifyStore';
import { useAuthStore } from '../store/authState';
import { auth } from '../services/auth';

const NavIcon = ({ type }) => {
	const common = {
		fill: 'none',
		stroke: 'currentColor',
		strokeWidth: 1.8,
		strokeLinecap: 'round',
		strokeLinejoin: 'round'
	};

	const paths = {
		dashboard: (
			<>
				<path {...common} d="M4 5.5h6.5v6.5H4z" />
				<path {...common} d="M13.5 5.5H20v4h-6.5z" />
				<path {...common} d="M13.5 13H20v5.5h-6.5z" />
				<path {...common} d="M4 15h6.5v3.5H4z" />
			</>
		),
		search: (
			<>
				<path {...common} d="M10.8 18.2a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />
				<path {...common} d="M16.2 16.2 20 20" />
				<path {...common} d="M7.8 11.2h6" />
			</>
		),
		user: (
			<>
				<path {...common} d="M12 12.2a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
				<path {...common} d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
			</>
		),
		message: (
			<>
				<path {...common} d="M5 6h14v9H8.5L5 18.5V6Z" />
				<path {...common} d="M8 9.5h8" />
				<path {...common} d="M8 12.5h5" />
			</>
		),
		data: (
			<>
				<path {...common} d="M5 19V5" />
				<path {...common} d="M5 19h14" />
				<path {...common} d="M8 15l3-4 3 2 4-6" />
			</>
		)
	};

	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
			{paths[type]}
		</svg>
	);
};

const AppSidebar = ({ isDesktopSidebarOpen = false, setIsDesktopSidebarOpen = () => {} }) => {
	const location = useLocation();
	const { setIsLoggedIn, setIsAdminSession } = useAuthStore();
	const isNewMsg = useNotifyStore((state) => state.isNewMsg);

	const [isMessageOpen, setIsMessageOpen] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

	const navItems = useMemo(
		() => [
			{ name: '대시보드', path: '/', icon: 'dashboard' },
			{ name: '익절 조건 검색', path: '/take-profit-search', icon: 'search' },
			{ name: '마이페이지', path: '/mypage', icon: 'user' },
			{ name: '메시지', action: 'message', icon: 'message' },
			{ name: '실시간데이터', path: '/realtime-data', icon: 'data' }
		],
		[]
	);

	const signout = () => {
		auth.logout();
		setIsLoggedIn(false);
		setIsAdminSession(false);
		window.location.href = '/signin';
	};

	const closeMobile = () => setIsMobileMenuOpen(false);
	const toggleDesktop = () => setIsDesktopSidebarOpen((prev) => !prev);
	const isExpanded = isDesktopSidebarOpen || isMobileMenuOpen;
	const isActive = (path) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));

	const renderNavItem = (item) => {
		const active = item.path ? isActive(item.path) : false;
		const className = `xignal-gnb-link relative flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
			active ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
		} ${isExpanded ? 'justify-start' : 'justify-center'}`;

		const content = (
			<>
				<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
					<NavIcon type={item.icon} />
				</span>
				{isExpanded ? <span className="text-[15px] font-semibold">{item.name}</span> : null}
				{item.action === 'message' && isNewMsg ? (
					<span className="absolute top-2 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2563EB] px-1 text-[10px] text-white">
						N
					</span>
				) : null}
			</>
		);

		if (item.action === 'message') {
			return (
				<button
					key={item.name}
					type="button"
					onClick={() => {
						setIsMessageOpen(true);
						closeMobile();
					}}
					className={className}
					title={isExpanded ? undefined : item.name}
				>
					{content}
				</button>
			);
		}

		return (
			<Link key={item.path} to={item.path} onClick={closeMobile} className={className} title={isExpanded ? undefined : item.name}>
				{content}
			</Link>
		);
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setIsMobileMenuOpen((prev) => !prev)}
				className="xignal-gnb-mobile-toggle fixed top-4 left-4 z-[70] flex h-11 w-11 items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#0F172A] shadow-[0_10px_28px_rgba(15,23,42,0.14)] md:hidden"
				aria-label="메뉴 열기"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">
					<path d="M4 7H20M4 12H20M4 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
				</svg>
			</button>

			{isMobileMenuOpen ? <button type="button" aria-label="메뉴 닫기" className="fixed inset-0 z-[55] bg-[#0F172A]/40 md:hidden" onClick={closeMobile} /> : null}

			<aside
				className={`xignal-gnb fixed z-[60] flex flex-col bg-white transition-all duration-300 ease-in-out ${
					isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
				} ${isDesktopSidebarOpen ? 'md:w-[272px]' : 'md:w-[64px]'} md:translate-x-0`}
			>
				<div className={`border-b border-[#E2E8F0] ${isExpanded ? 'px-4 py-4' : 'px-0 py-4'}`}>
					<div className={isExpanded ? 'flex items-center justify-between' : 'flex items-center justify-center'}>
						<button type="button" onClick={toggleDesktop} className="flex items-center gap-3" aria-label="사이드바 접기">
							<img src={logo} alt="Xignal" className="h-[42px] w-[42px]" />
							{isExpanded ? <span className="text-lg font-bold text-[#0F172A]">QUANTU</span> : null}
						</button>

						<button
							type="button"
							onClick={closeMobile}
							className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] md:hidden"
							aria-label="메뉴 닫기"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none">
								<path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
							</svg>
						</button>
					</div>
				</div>

				<div className="flex flex-1 flex-col justify-between overflow-y-auto px-2 py-4">
					<nav className="flex flex-col gap-2">{navItems.map(renderNavItem)}</nav>

					<button
						type="button"
						onClick={() => {
							signout();
							closeMobile();
						}}
						className={`mt-6 flex min-h-[44px] items-center rounded-xl px-3 py-2 text-sm font-semibold text-[#64748B] transition hover:bg-[#F8FAFC] hover:text-[#0F172A] ${
							isExpanded ? 'justify-start' : 'justify-center'
						}`}
						title={isExpanded ? undefined : '로그아웃'}
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F8FAFC]">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
								<path d="M4 12h10M7 9l-3 3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</span>
						{isExpanded ? <span className="ml-3">로그아웃</span> : null}
					</button>
				</div>
			</aside>

			{isMessageOpen ? <MessageModal isOpen={true} onClose={() => setIsMessageOpen(false)} /> : null}
		</>
	);
};

export default AppSidebar;
