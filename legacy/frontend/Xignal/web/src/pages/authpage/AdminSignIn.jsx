import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuthStore } from '../../store/authState';
import { auth } from '../../services/auth';
import logo from '../../assets/logo/xignal/logo-white.png';
import idIcon from '../../assets/icon/id.png';
import pwIcon from '../../assets/icon/pw.png';

const AdminSignIn = () => {
	const navigate = useNavigate();
	const { setIsLoggedIn, setIsAdminSession, setUserInfo } = useAuthStore();
	const [userId, setUserId] = useState('');
	const [password, setPassword] = useState('');
	const [errorMessage, setErrorMessage] = useState('');

	const signIn = useCallback(() => {
		setErrorMessage('');
		auth.adminLogin({ userId, password }, (res) => {
			if (res?.ok) {
				setIsLoggedIn(true);
				setIsAdminSession(true);
				setUserInfo({
					loginId: res.profile?.mem_id || userId,
					username: res.profile?.mem_name || '',
					grade: res.profile?.grade ?? null,
					livePrice: res.profile?.live_price,
					paperPrice: res.profile?.price
				});
				navigate('/ops-console');
				return;
			}

			setIsLoggedIn(false);
			setIsAdminSession(false);
			setErrorMessage(res?.message || '관리자 로그인에 실패했습니다.');
		});
	}, [navigate, password, setIsAdminSession, setIsLoggedIn, setUserInfo, userId]);

	return (
		<div className="user-select-none flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="Xignal" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">관리자 로그인</h3>
					<div className="space-y-3.5 px-5 py-6 md:px-7">
						<div className="relative w-full rounded-sm bg-[#0F0F0F]">
							<div className="absolute left-3 top-1/2 -translate-y-1/2">
								<img src={idIcon} alt="" />
							</div>
							<input
								type="text"
								className="w-full appearance-none rounded-sm px-3 py-3 pl-11 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
								value={userId}
								onChange={(event) => {
									setUserId(event.target.value);
									setErrorMessage('');
								}}
								placeholder="관리자 ID를 입력해 주세요"
							/>
						</div>

						<div className="relative w-full rounded-sm bg-[#0F0F0F]">
							<div className="absolute left-3 top-1/2 -translate-y-1/2">
								<img src={pwIcon} alt="" />
							</div>
							<input
								type="password"
								className="w-full appearance-none rounded-sm px-3 py-3 pl-11 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
								value={password}
								onChange={(event) => {
									setPassword(event.target.value);
									setErrorMessage('');
								}}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										signIn();
									}
								}}
								placeholder="관리자 비밀번호를 입력해 주세요"
							/>
						</div>

						{errorMessage ? <p className="my-0 text-center text-[#FF4E4E]">{errorMessage}</p> : null}

						<div className="flex flex-col gap-3">
							<button type="button" onClick={signIn} className="cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] md:text-[18px]">
								관리자 로그인
							</button>
							<Link to="/signin" className="cursor-pointer rounded-sm border border-[#ccc] bg-[#0f0f0f] py-3 text-center text-[16px] font-semibold text-[#ccc] md:text-[18px]">
								사용자 로그인으로 돌아가기
							</Link>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default AdminSignIn;
