import React from 'react';
import { DefaultModal } from '../DefaultModal';
import { useAuthStore } from '../../../store/authState';
import { auth } from '../../../services/auth';

const MypageModal = ({ isOpen, onClose, className }) => {
	const { userInfo, setIsLoggedIn, setIsAdminSession, isAdminSession } = useAuthStore();

	const signout = () => {
		auth.logout();
		setIsLoggedIn(false);
		setIsAdminSession(false);
		window.location.href = isAdminSession ? '/ops-signin' : '/signin';
	};

	return (
		<DefaultModal
			isOpen={isOpen}
			onClose={onClose}
			className={`w-[92vw] max-w-[720px] p-5 md:p-8 ${className}`}
		>
			<h2 className="mb-6 mt-1 text-[20px] font-semibold text-white md:mb-8 md:text-xl">
				My Profile
			</h2>

			<div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-5">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-300 text-white md:h-10 md:w-10">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						strokeWidth={1.5}
						stroke="currentColor"
						className="size-8 md:size-8"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
						/>
					</svg>
				</div>

				<div className="w-full rounded-lg bg-white p-4 shadow sm:p-5">
					<div className="flex flex-col gap-1 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:gap-4">
						<p className="w-full text-sm font-medium text-slate-500 sm:w-[180px]">User ID</p>
						<p className="w-full break-all text-black">{userInfo.loginId}</p>
					</div>

					<div className="flex flex-col gap-1 pt-4 sm:flex-row sm:items-center sm:gap-4">
						<p className="w-full text-sm font-medium text-slate-500 sm:w-[180px]">Nickname</p>
						<p className="w-full break-all text-black">{userInfo.loginId}</p>
					</div>
				</div>
			</div>

			<div className="mt-8 flex justify-end md:mt-10">
				<button
					className="cursor-pointer rounded-md border border-red-600 px-3 py-2 text-[12px] text-red-600"
					onClick={signout}
				>
					Log Out
				</button>
			</div>
		</DefaultModal>
	);
};

export default MypageModal;
