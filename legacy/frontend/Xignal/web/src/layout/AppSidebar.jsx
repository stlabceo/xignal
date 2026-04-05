import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import logo from '../assets/logo/logo_xignal.svg';
import MypageModal from '../components/modal/pageModal/MypageModal';
import MessageModal from '../components/modal/pageModal/MessageModal';
import { useNotifyStore } from '../store/notifyStore';
import { useAuthStore } from '../store/authState';

const AppSidebar = ({
	isDesktopSidebarOpen = false,
	setIsDesktopSidebarOpen = () => {}
}) => {
	const location = useLocation();
	const { setIsLoggedIn } = useAuthStore();
	const isNewMsg = useNotifyStore((s) => s.isNewMsg);

	const [isMypageOpen, setIsMypageOpen] = useState(false);
	const [isMessageOpen, setIsMessageOpen] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

	const tradingNavList = useMemo(
		() => [
			{ name: 'Demo', path: '/test' },
			{ name: 'TRADING', path: '/' },
			{ name: 'TRACK Record', path: '/trade-history' },
			{ name: 'Demo TRACK Record', path: '/test/trade-history' }
		],
		[]
	);

	const signout = () => {
		setIsLoggedIn(false);
	};

	const handleDesktopToggle = () => {
		setIsDesktopSidebarOpen((prev) => !prev);
	};

	const handleMobileToggle = () => {
		setIsMobileMenuOpen((prev) => !prev);
	};

	const handleCloseMobile = () => {
		setIsMobileMenuOpen(false);
	};

	const handleLinkClick = () => {
		setIsMobileMenuOpen(false);
	};

	const isActive = (path) => location.pathname === path;

	return (
		<>
			<button
				type="button"
				onClick={handleMobileToggle}
				className="xignal-gnb-mobile-toggle md:hidden fixed top-4 left-4 z-[70] flex h-11 w-11 items-center justify-center rounded-lg border border-[#343434] bg-[#1B1B1B] text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none">
					<path
						d="M4 7H20M4 12H20M4 17H20"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
					/>
				</svg>
			</button>

			{isMobileMenuOpen && (
				<button
					type="button"
					className="md:hidden fixed inset-0 z-[55] bg-black/50"
					onClick={handleCloseMobile}
				/>
			)}

			<aside
				className={`xignal-gnb fixed z-[60] flex flex-col bg-[#1B1B1B] transition-all duration-300 ease-in-out ${
					isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
				} ${isDesktopSidebarOpen ? 'md:w-[272px]' : 'md:w-[64px]'} md:translate-x-0`}
			>
				<div
					className={`border-b border-[#2A2A2A] ${
						isDesktopSidebarOpen ? 'px-5 py-5' : 'px-0 py-5'
					}`}
				>
					<div className={`${isDesktopSidebarOpen ? 'flex items-center justify-between' : 'flex items-center justify-center'}`}>
						<button
							type="button"
							onClick={handleDesktopToggle}
							className="flex items-center justify-center"
						>
							<img src={logo} alt="logo" className="h-[56px] w-[48px]" />
						</button>

						<button
							type="button"
							onClick={handleCloseMobile}
							className="md:hidden flex h-9 w-9 items-center justify-center rounded-md border border-[#343434] text-white"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none">
								<path
									d="M6 6L18 18M18 6L6 18"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
								/>
							</svg>
						</button>
					</div>
				</div>

				{(isDesktopSidebarOpen || isMobileMenuOpen) && (
					<div className="flex-1 overflow-y-auto px-3 py-4">
						<nav>
							<ul className="flex flex-col gap-2">
								{tradingNavList.map((nav) => (
									<li className="w-full" key={nav.path}>
										<Link
											to={nav.path}
											onClick={handleLinkClick}
											className={`xignal-gnb-link relative flex min-h-[52px] w-full items-center rounded-xl px-4 py-3 transition-all ${
												isActive(nav.path)
													? 'bg-[#262626] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
													: 'hover:bg-[#202020]'
											}`}
										>
											<span className="text-left text-[15px] font-medium leading-[1.35] text-white">
												{nav.name}
											</span>
										</Link>
									</li>
								))}

								<li className="w-full">
									<button
										type="button"
										onClick={() => {
											setIsMessageOpen(true);
											setIsMobileMenuOpen(false);
										}}
										className="xignal-gnb-link relative flex min-h-[52px] w-full items-center rounded-xl px-4 py-3 text-left transition-all hover:bg-[#202020]"
									>
										<span className="text-[15px] font-medium text-white">Message</span>
										{isNewMsg && (
											<div className="absolute right-3 top-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] text-black">
												N
											</div>
										)}
									</button>
								</li>

								<li className="w-full">
									<button
										type="button"
										onClick={() => {
											signout();
											setIsMobileMenuOpen(false);
										}}
										className="xignal-gnb-link flex min-h-[52px] w-full items-center rounded-xl px-4 py-3 text-left transition-all hover:bg-[#202020]"
									>
										<span className="text-[15px] font-medium text-white">Logout</span>
									</button>
								</li>
							</ul>
						</nav>
					</div>
				)}
			</aside>

			{isMypageOpen && <MypageModal isOpen={true} onClose={() => setIsMypageOpen(false)} />}
			{isMessageOpen && <MessageModal isOpen={true} onClose={() => setIsMessageOpen(false)} />}
		</>
	);
};

export default AppSidebar;