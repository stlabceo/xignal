import React from 'react';
import { useNavigate } from 'react-router';
import logo from '../../assets/logo/xignal/logo-white.png';
import CheckIcon from '../../assets/icon/big-check.png';

const SignUpComplete = () => {
	const navigate = useNavigate();

	return (
		<div className="user-select-none flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="Xignal" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">회원가입 완료</h3>

					<div className="flex flex-col items-center justify-center gap-4 px-5 py-12 md:px-7 md:py-14">
						<img src={CheckIcon} alt="" />
						<p className="text-center text-[16px] text-[#fff] md:text-[18px]">회원가입이 완료되었습니다.</p>
						<button
							type="button"
							onClick={() => {
								navigate('/signin');
							}}
							className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] sm:w-2/4 md:text-[18px]"
						>
							로그인하러 가기
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default SignUpComplete;
