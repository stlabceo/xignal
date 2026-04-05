import { Outlet } from 'react-router';
import { useState } from 'react';
import AppSidebar from './AppSidebar';
import AppFooter from './AppFooter';

const LayoutContent = () => {
	const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(false);

	return (
		<div className="min-h-screen bg-[#0F0F0F] text-white">
			<AppSidebar
				isDesktopSidebarOpen={isDesktopSidebarOpen}
				setIsDesktopSidebarOpen={setIsDesktopSidebarOpen}
			/>

			<div
				className={`min-h-screen transition-all duration-300 ${
					isDesktopSidebarOpen ? 'md:pl-[304px]' : 'md:pl-[96px]'
				}`}
			>
				<div className="flex min-h-screen flex-col">
					<div className="flex-1 pt-[72px] md:pt-0">
						<Outlet />
					</div>
					<AppFooter />
				</div>
			</div>
		</div>
	);
};

const AppLayout = () => {
	return <LayoutContent />;
};

export default AppLayout;