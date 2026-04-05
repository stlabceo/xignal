import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { auth } from '../../services/auth';
import { Link } from 'react-router';
import logo from '../../assets/logo/xignal/로고세로형_화이트.png';

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
	};

	const nextStep = useCallback(() => {
		switch (step) {
			case 1: {
				if (!name || !email) {
					setStepOneErr(true);
					setErrMsg('Please enter the required information.');
					return;
				}
				const body = {
					username: name,
					email: email
				};
				init();
				auth.registerEmail(body, (res) => {
					if (res.status === 200) {
						setStep(step + 1);
					} else {
						if (res.param === 'username') setNameError(true);
						if (res.param === 'email') setEmailError(true);
						setErrMsg(res.msg);
					}
				});
				break;
			}
			case 2: {
				const body2 = {
					memberid: userId,
					password: password,
					password2: passwordCheck
				};
				init();
				auth.registerId(body2, (res) => {
					if (res.status === 200) {
						setStep(step + 1);
					} else {
						if (res.param === 'password') setPasswordError(true);
						if (res.param === 'password2') setPasswordError(true);
						if (res.param === 'memberid') setUserIdError(true);
						setErrMsg(res.msg);
					}
				});
				break;
			}
			default:
				return;
		}
	}, [step, name, email, userId, password, passwordCheck]);

	const codeCheck = () => {
		const body = { recom: code };
		auth.registerCode(body, (res) => {
			if (res.status === 200) {
				setCodeState('valid');
			} else {
				if (res.param === 'recom') setCodeState('invalid');
			}
		});
	};

	const userRegister = () => {
		const body = {
			memberid: userId,
			username: name,
			mobile: null,
			password,
			email: email,
			recom: code
		};
		auth.registerFin(body, (res) => {
			if (res.status === 200) {
				navigate('/signup/complete');
			}
		});
	};

	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8 user-select-none">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">Sign Up</h3>

					<div className="space-y-3.5 px-5 py-6 md:px-7">
						<ul className="mb-4 flex gap-2.5">
							<li className={`flex h-7.5 w-7.5 items-center justify-center rounded-full font-semibold ${step === 1 ? 'bg-[#999]' : 'border border-[#999] bg-[#0f0f0f] text-[#999]'}`}>1</li>
							<li className={`flex h-7.5 w-7.5 items-center justify-center rounded-full font-semibold ${step === 2 ? 'bg-[#999]' : 'border border-[#999] bg-[#0f0f0f] text-[#999]'}`}>2</li>
							<li className={`flex h-7.5 w-7.5 items-center justify-center rounded-full font-semibold ${step === 3 ? 'bg-[#999]' : 'border border-[#999] bg-[#0f0f0f] text-[#999]'}`}>3</li>
						</ul>

						{step === 1 && (
							<>
								<label htmlFor="name" className="text-[#999]">Name</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="text"
										id="name"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="Please enter your name."
									/>
								</div>

								<label htmlFor="email" className="text-[#999]">Email</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="email"
										id="email"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="Please enter your email."
									/>
								</div>

								<div className="text-[15px] text-[#fff] md:text-[16px]">
									<p>Your email is required if you forget your ID or password.</p>
								</div>

								{stepOneErr && <p className="my-0 text-center text-[#FF4E4E]">{errMsg}</p>}
							</>
						)}

						{step === 2 && (
							<>
								<label htmlFor="userId" className="text-[#999]">User ID</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="text"
										id="userId"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
										value={userId}
										onChange={(e) => setUserId(e.target.value)}
										placeholder="Please enter your user ID."
									/>
								</div>

								<label htmlFor="password" className="text-[#999]">Password</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="password"
										id="password"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="Please enter your password."
									/>
								</div>

								<label htmlFor="passwordCheck" className="text-[#999]">Confirm Password</label>
								<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
									<input
										type="password"
										id="passwordCheck"
										className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
										value={passwordCheck}
										onChange={(e) => setPasswordCheck(e.target.value)}
										placeholder="Please re-enter your password."
									/>
								</div>

								{(userIdError || passwordError) && <p className="my-0 text-center text-[#FF4E4E]">{errMsg}</p>}
							</>
						)}

						{step === 3 && (
							<>
								<label htmlFor="code" className="text-[#999]">Referral Code</label>
								<div className="flex flex-col gap-3 sm:flex-row sm:gap-5">
									<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
										<input
											type="text"
											id="code"
											className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
											value={code}
											onChange={(e) => setCode(e.target.value)}
											placeholder="Please enter the code."
										/>
									</div>
									<button
										className="mt-1.5 rounded-sm border border-[#ccc] bg-[#0f0f0f] px-4 text-[16px] font-semibold text-[#ccc] cursor-pointer sm:w-44 md:text-[18px]"
										onClick={codeCheck}
									>
										Check Code
									</button>
								</div>

								{codeState === 'valid' && <p className="my-0 text-center text-[#4EFF9D]">The referral code has been verified.</p>}
								{codeState === 'invalid' && <p className="my-0 text-center text-[#FF4E4E]">Invalid code.</p>}
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
									Previous
								</button>
							)}

							{step !== MAX_STEP && (
								<button
									type="button"
									onClick={nextStep}
									className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] md:text-[18px]"
								>
									Next
								</button>
							)}

							{step === 3 && (
								<button
									type="button"
									onClick={userRegister}
									disabled={codeState !== 'valid'}
									className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] disabled:opacity-70 md:text-[18px]"
								>
									Complete Sign Up
								</button>
							)}
						</div>

						<ul className="py-3 text-[16px] text-[#828282] md:text-[18px]">
							<li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<span>Back to sign in</span>
								<Link to="/signin" className="font-semibold text-[#fff] underline">
									Go Back
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