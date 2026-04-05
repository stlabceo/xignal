import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/authState';
import { useNavigate } from 'react-router';
import { auth } from '../../services/auth';
import { Link } from 'react-router';
import logo from '../../assets/logo/xignal/로고세로형_화이트.png';
import idIcon from '../../assets/icon/id.png';
import pwIcon from '../../assets/icon/pw.png';

const DevQuickLogin = ({ onLogin, onLogin2 }) => {
	const [pos, setPos] = useState({ x: 20, y: 20 });
	const dragRef = useRef(null);

	useEffect(() => {
		const onMove = (e) => {
			if (!dragRef.current) return;
			setPos({
				x: Math.max(0, window.innerWidth - e.clientX - dragRef.current.offsetX),
				y: Math.max(0, window.innerHeight - e.clientY - dragRef.current.offsetY),
			});
		};
		const onUp = () => {
			dragRef.current = null;
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	const onMouseDown = (e) => {
		const rect = e.currentTarget.parentElement.getBoundingClientRect();
		dragRef.current = {
			offsetX: window.innerWidth - e.clientX - (window.innerWidth - rect.right),
			offsetY: window.innerHeight - e.clientY - (window.innerHeight - rect.bottom),
		};
	};

	return (
		<div
			style={{ position: 'fixed', right: pos.x, bottom: pos.y, zIndex: 9999 }}
			className="flex items-center gap-1 rounded-lg bg-black/50 px-2 py-1.5 text-xs text-white/70 backdrop-blur select-none"
		>
			<span onMouseDown={onMouseDown} className="cursor-move px-1">⠿</span>
			<button onClick={onLogin} className="cursor-pointer hover:text-white">
				DEV Login
			</button>
			<span className="text-white/30">|</span>
			<button onClick={onLogin2} className="cursor-pointer hover:text-white">
				DEV Login 2
			</button>
		</div>
	);
};

const SignIn = () => {
	const navigate = useNavigate();
	const { setIsLoggedIn } = useAuthStore();
	const [userId, setUserId] = useState('');
	const [password, setPassword] = useState('');
	const [loginErr, setLoginErr] = useState(false);

	const signIn = useCallback(() => {
		const body = {
			userId,
			password
		};
		auth.login(body, (res) => {
			if (res) {
				setIsLoggedIn(true);
				navigate('/');
			} else {
				setLoginErr(true);
			}
		});
	}, [userId, password]);

	const quickSignIn = useCallback(() => {
		setUserId('test1');
		setPassword('zx2356');
		auth.login({ userId: 'test1', password: 'zx2356' }, (res) => {
			if (res) {
				setIsLoggedIn(true);
				navigate('/');
			} else {
				setLoginErr(true);
			}
		});
	}, []);

	const quickSignIn2 = useCallback(() => {
		setUserId('tmdtka1');
		setPassword('!supersw1');
		auth.login({ userId: 'tmdtka1', password: '!supersw1' }, (res) => {
			if (res) {
				setIsLoggedIn(true);
				navigate('/');
			} else {
				setLoginErr(true);
			}
		});
	}, []);

	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-[#0F0F0F] bg-center bg-cover bg-no-repeat px-4 py-8 user-select-none">
			<div className="flex w-full max-w-[523px] flex-col items-center gap-8 md:gap-10">
				<img src={logo} alt="" className="w-[120px] md:w-[144px]" />

				<div className="flex w-full flex-col rounded-md bg-[#1b1b1b] shadow-2xl shadow-black">
					<h3 className="border-b border-[#494949] py-3 text-center text-[20px] font-medium text-[#fff] md:text-[22px]">Sign In</h3>
					<div className="space-y-3.5 px-5 py-6 md:px-7">
						<div className="relative w-full rounded-sm bg-[#0F0F0F]">
							<div className="absolute left-3 top-1/2 -translate-y-1/2">
								<img src={idIcon} alt="" />
							</div>
							<input
								type="text"
								className="w-full appearance-none rounded-sm px-3 py-3 pl-11 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
								value={userId}
								onChange={(e) => {
									setUserId(e.target.value);
								}}
								placeholder="Please enter your ID."
							/>
						</div>

						<div className="relative w-full rounded-sm bg-[#0F0F0F]">
							<div className="absolute left-3 top-1/2 -translate-y-1/2">
								<img src={pwIcon} alt="" />
							</div>
							<input
								type="password"
								className="w-full appearance-none rounded-sm px-3 py-3 pl-11 text-[16px] text-[#fff] shadow-theme-xs placeholder:text-[#828282] focus:outline-hidden md:text-[18px]"
								value={password}
								onChange={(e) => {
									setPassword(e.target.value);
								}}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										signIn();
									}
								}}
								placeholder="Please enter your password."
							/>
						</div>

						{loginErr && <p className="my-0 text-center text-[#FF4E4E]">Invalid login credentials.</p>}

						<div className="flex flex-col">
							<button
								type="button"
								onClick={signIn}
								className="mt-3 cursor-pointer rounded-sm bg-[#ccc] py-3 text-[16px] font-bold text-[#000] md:text-[18px]"
							>
								Sign In
							</button>
							<Link
								to="/signup"
								className="mt-3 rounded-sm border border-[#ccc] bg-[#0f0f0f] py-3 text-center text-[16px] font-semibold text-[#ccc] cursor-pointer md:text-[18px]"
							>
								Sign Up
							</Link>
						</div>

						<ul className="py-3 text-[16px] text-[#828282] md:text-[18px]">
							<li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<span>Forgot your login information?</span>
								<Link to="/forgot-password" className="font-semibold text-[#fff] underline">
									Find ID / Password
								</Link>
							</li>
						</ul>
					</div>
				</div>
			</div>
			{import.meta.env.DEV && <DevQuickLogin onLogin={quickSignIn} onLogin2={quickSignIn2} />}
		</div>
	);
};

export default SignIn;