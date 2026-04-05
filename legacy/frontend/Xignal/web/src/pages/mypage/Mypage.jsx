import React from 'react';
import HeaderComponent from '../../components/header/HeaderComponent';
import { useAuthStore } from '../../store/authState';

const Mypage = () => {
	const { userInfo, setIsLoggedIn } = useAuthStore();

	const signout = () => {
		setIsLoggedIn(false);
	};

	return (
		<>
			<HeaderComponent />
			<div className="inner-container">
				<div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
					<h3 className="text-[22px] font-medium text-white sm:text-xl">My Page</h3>
					<div>
						<button
							className="cursor-pointer rounded-md border border-red-600 px-3 py-2 text-sm text-red-500"
							onClick={signout}
						>
							Log Out
						</button>
					</div>
				</div>

				<div className="rounded-md bg-white p-4 shadow sm:p-6">
					<div className="flex flex-col gap-1 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:gap-4">
						<p className="w-full text-sm font-medium text-slate-500 sm:w-[210px]">User ID</p>
						<p className="w-full break-all text-black">{userInfo.loginId}</p>
					</div>
					<div className="flex flex-col gap-1 pt-4 sm:flex-row sm:items-center sm:gap-4">
						<p className="w-full text-sm font-medium text-slate-500 sm:w-[210px]">Nickname</p>
						<p className="w-full break-all text-black">{userInfo.loginId}</p>
					</div>
				</div>
			</div>
		</>
	);
};

export default Mypage;