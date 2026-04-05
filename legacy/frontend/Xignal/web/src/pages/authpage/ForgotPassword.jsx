import React, { useState } from 'react';
import { Link } from 'react-router';
import logo from '../../assets/logo/xignal/로고세로형_화이트.png';

const ForgotPassword = () => {
	const [userId, setUserId] = useState('');
	const [state, setState] = useState('none'); // none, valid, invalid
	const [selectedType, setSelectedType] = useState('');

	const nextStep = () => {
		if (userId && selectedType) {
			setState('valid');
		} else {
			setState('invalid');
		}
	};

	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8 user-select-none">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">
						Find ID / Password
					</h3>

					<div className="space-y-3.5 px-5 py-6 md:px-7">
						<div className="text-[15px] text-[#fff] md:text-[16px]">
							<p>Please enter the email address you used when registering.</p>
						</div>

						<label htmlFor="email" className="text-[#999]">
							Email
						</label>
						<div className="relative mt-1.5 w-full rounded-sm bg-[#0F0F0F]">
							<input
								type="email"
								id="email"
								className="w-full appearance-none rounded-sm px-3 py-3 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
								value={userId}
								onChange={(e) => {
									setUserId(e.target.value);
								}}
								placeholder="Please enter your email."
							/>
						</div>

						<label htmlFor="idPWfloatingSelect" className="text-[#999]">
							Select Recovery Type
						</label>
						<div className="relative mt-1.5 w-full">
							<select
								id="idPWfloatingSelect"
								className="w-full appearance-none rounded-sm bg-[#0f0f0f] px-4 py-4 text-[16px] text-[#fff] shadow-theme-xs focus:outline-hidden md:text-[18px]"
								aria-label="Select ID or password recovery"
								value={selectedType}
								onChange={(e) => setSelectedType(e.target.value)}
							>
								<option value="">Please select an option</option>
								<option value="id">Find ID</option>
								<option value="password">Reset Password</option>
							</select>
							<span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									strokeWidth={1.5}
									stroke="currentColor"
									className="size-5"
								>
									<path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
								</svg>
							</span>
						</div>

						{state === 'valid' && <p className="my-0 text-center text-[#4EFF9D]">We sent your login information by email.</p>}
						{state === 'invalid' && <p className="my-0 text-center text-[#FF4E4E]">Please enter a valid email and recovery type.</p>}

						<button
							type="button"
							onClick={nextStep}
							className="mt-3 w-full cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] md:text-[18px]"
						>
							Send Email
						</button>

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

export default ForgotPassword;