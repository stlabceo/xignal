import React, { useCallback, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { auth } from '../../services/auth';
import logo from '../../assets/logo/xignal/logo-white.png';

const SignUp = () => {
	const navigate = useNavigate();
	const MAX_STEP = 3;
	const [step, setStep] = useState(1);
	const [name, setName] = useState('');
	const [nameError, setNameError] = useState(false);
	const [email, setEmail] = useState('');
	const [emailError, setEmailError] = useState(false);
	const [stepOneErr, setStepOneErr] = useState(false);
	const [userId, setUserId] = useState('');
	const [userIdError, setUserIdError] = useState(false);
	const [password, setPassword] = useState('');
	const [passwordCheck, setPasswordCheck] = useState('');
	const [passwordError, setPasswordError] = useState(false);
	const [code, setCode] = useState('');
	const [errMsg, setErrMsg] = useState('');
	const [codeState, setCodeState] = useState('none');

	const init = () => {
		setNameError(false);
		setEmailError(false);
		setPasswordError(false);
		setUserIdError(false);
		setStepOneErr(false);
		setErrMsg('');
	};

	const nextStep = useCallback(() => {
		switch (step) {
			case 1: {
				if (!name || !email) {
					setStepOneErr(true);
					setErrMsg('필수 정보를 입력해 주세요.');
					return;
				}

				init();
				auth.registerEmail({ username: name, email }, (res) => {
					if (res.status === 200) {
						setStep(2);
						return;
					}

					if (res.param === 'username') setNameError(true);
					if (res.param === 'email') setEmailError(true);
					setErrMsg(res.msg || '이름 또는 이메일을 다시 확인해 주세요.');
				});
				break;
			}
			case 2: {
				init();
				auth.registerId(
					{
						memberid: userId,
						password,
						password2: passwordCheck
					},
					(res) => {
						if (res.status === 200) {
							setStep(3);
							return;
						}

						if (res.param === 'password' || res.param === 'password2') setPasswordError(true);
						if (res.param === 'memberid') setUserIdError(true);
						setErrMsg(res.msg || '아이디 또는 비밀번호를 다시 확인해 주세요.');
					}
				);
				break;
			}
			default:
				return;
		}
	}, [email, name, password, passwordCheck, step, userId]);

	const codeCheck = () => {
		auth.registerCode({ recom: code }, (res) => {
			if (res.status === 200) {
				setCodeState('valid');
				return;
			}

			if (res.param === 'recom') {
				setCodeState('invalid');
			}
		});
	};

	const userRegister = () => {
		auth.registerFin(
			{
				memberid: userId,
				username: name,
				mobile: null,
				password,
				email,
				recom: code
			},
			(res) => {
				if (res.status === 200) {
					navigate('/signup/complete');
				}
			}
		);
	};

	return (
		<div className="user-select-none flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="Xignal" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">회원가입</h3>

					<div className="space-y-3.5 px-5 py-6 md:px-7">
						<ul className="mb-4 flex gap-2.5">
							<li className={`flex h-7.5 w-7.5 items-center justify-center rounded-full font-semibold ${step === 1 ? 'bg-[#999]' : 'border border-[#999] bg-[#0f0f0f] text-[#999]'}`}>1</li>
							<li className={`flex h-7.5 w-7.5 items-center justify-center rounded-full font-semibold ${step === 2 ? 'bg-[#999]' : 'border border-[#999] bg-[#0f0f0f] text-[#999]'}`}>2</li>
							<li className={`flex h-7.5 w-7.5 items-center justify-center rounded-full font-semibold ${step === 3 ? 'bg-[#999]' : 'border border-[#999] bg-[#0f0f0f] text-[#999]'}`}>3</li>
						</ul>

						{step === 1 && (
							<>
								<label htmlFor="name" className="text-[#999]">
									이름
								</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="text"
										id="name"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder="이름을 입력해 주세요"
									/>
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
										onChange={(event) => setEmail(event.target.value)}
										placeholder="이메일을 입력해 주세요"
									/>
								</div>

								<div className="text-[15px] text-[#fff] md:text-[16px]">
									<p>아이디와 비밀번호를 찾을 때 사용하는 이메일입니다.</p>
								</div>

								{stepOneErr && <p className="my-0 text-center text-[#FF4E4E]">{errMsg}</p>}
								{nameError && !stepOneErr && <p className="my-0 text-center text-[#FF4E4E]">{errMsg}</p>}
								{emailError && !stepOneErr && <p className="my-0 text-center text-[#FF4E4E]">{errMsg}</p>}
							</>
						)}

						{step === 2 && (
							<>
								<label htmlFor="userId" className="text-[#999]">
									아이디
								</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="text"
										id="userId"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
										value={userId}
										onChange={(event) => setUserId(event.target.value)}
										placeholder="사용할 아이디를 입력해 주세요"
									/>
								</div>

								<label htmlFor="password" className="text-[#999]">
									비밀번호
								</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="password"
										id="password"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										placeholder="비밀번호를 입력해 주세요"
									/>
								</div>

								<label htmlFor="passwordCheck" className="text-[#999]">
									비밀번호 확인
								</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="password"
										id="passwordCheck"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
										value={passwordCheck}
										onChange={(event) => setPasswordCheck(event.target.value)}
										placeholder="비밀번호를 한 번 더 입력해 주세요"
									/>
								</div>

								{(userIdError || passwordError) && <p className="my-0 text-center text-[#FF4E4E]">{errMsg}</p>}
							</>
						)}

						{step === 3 && (
							<>
								<label htmlFor="code" className="text-[#999]">
									추천 코드
								</label>
								<div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
									<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
										<input
											type="text"
											id="code"
											className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-none md:text-[18px]"
											value={code}
											onChange={(event) => setCode(event.target.value)}
											placeholder="추천 코드를 입력해 주세요"
										/>
									</div>
									<button className="mt-1.5 cursor-pointer rounded-sm border border-[#ccc] bg-[#0f0f0f] px-4 py-3 text-[16px] font-semibold text-[#ccc] sm:w-44 md:text-[18px]" onClick={codeCheck} type="button">
										코드 확인
									</button>
								</div>

								{codeState === 'valid' && <p className="my-0 text-center text-[#4EFF9D]">추천 코드가 확인되었습니다.</p>}
								{codeState === 'invalid' && <p className="my-0 text-center text-[#FF4E4E]">추천 코드를 다시 확인해 주세요.</p>}
							</>
						)}

						<div className="flex gap-1">
							{step !== 1 && (
								<button
									type="button"
									onClick={() => {
										setStep(step - 1);
										init();
									}}
									className="mt-3 w-full cursor-pointer rounded-sm border border-[#ccc] bg-[#0f0f0f] py-3 text-center text-[16px] font-semibold text-[#ccc] md:text-[18px]"
								>
									이전
								</button>
							)}

							{step !== MAX_STEP && (
								<button type="button" onClick={nextStep} className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] md:text-[18px]">
									다음
								</button>
							)}

							{step === 3 && (
								<button type="button" onClick={userRegister} disabled={codeState !== 'valid'} className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] disabled:opacity-70 md:text-[18px]">
									회원가입 완료
								</button>
							)}
						</div>

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

export default SignUp;
