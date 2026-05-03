import React, { useState } from 'react';
import { Link } from 'react-router';
import logo from '../../assets/logo/xignal/logo-white.png';

const ForgotPassword = () => {
	const [email, setEmail] = useState('');
	const [state, setState] = useState('none');
	const [selectedType, setSelectedType] = useState('');

	const nextStep = () => {
		if (email && selectedType) {
			setState('valid');
			return;
		}

		setState('invalid');
	};

	return (
		<div className="user-select-none flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="Xignal" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">아이디 / 비밀번호 찾기</h3>

					<div className="space-y-3.5 px-5 py-6 md:px-7">
						<div className="text-[15px] text-[#fff] md:text-[16px]">
							<p>회원가입에 사용한 이메일과 찾을 항목을 선택해 주세요.</p>
						</div>

						<label htmlFor="email" className="text-[#999]">
							이메일
						</label>
						<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
							<input
								type="email"
								id="email"
								className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
								value={email}
								onChange={(event) => {
									setEmail(event.target.value);
									setState('none');
								}}
								placeholder="이메일을 입력해 주세요"
							/>
						</div>

						<label htmlFor="idPWfloatingSelect" className="text-[#999]">
							찾기 유형
						</label>
						<div className="relative mt-1.5 w-full">
							<select
								id="idPWfloatingSelect"
								className="w-full appearance-none rounded-sm bg-[#0f0f0f] px-4 py-4 text-[16px] text-[#fff] shadow-theme-xs focus:outline-none md:text-[18px]"
								aria-label="아이디 또는 비밀번호 찾기 유형 선택"
								value={selectedType}
								onChange={(event) => {
									setSelectedType(event.target.value);
									setState('none');
								}}
							>
								<option value="">선택해 주세요</option>
								<option value="id">아이디 찾기</option>
								<option value="password">비밀번호 찾기</option>
							</select>
							<span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5">
									<path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
								</svg>
							</span>
						</div>

						{state === 'valid' && <p className="my-0 text-center text-[#4EFF9D]">입력한 이메일로 안내를 발송했습니다.</p>}
						{state === 'invalid' && <p className="my-0 text-center text-[#FF4E4E]">이메일과 찾기 유형을 다시 확인해 주세요.</p>}

						<button type="button" onClick={nextStep} className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] md:text-[18px]">
							이메일 보내기
						</button>

						<ul className="py-3 text-[16px] text-[#828282] md:text-[18px]">
							<li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<span>로그인 화면으로 돌아가기</span>
								<Link to="/signin" className="font-semibold text-[#fff] underline">
									돌아가기
								</Link>
							</li>
						</ul>
					</div>
				</div>
			</div>
		</div>
	);
};

export default ForgotPassword;
