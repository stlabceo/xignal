import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../store/authState';
import { authMvp } from '../../services/authMvp';
import AuthGoogleButton from './AuthGoogleButton';
import AuthLayout, { AuthDivider, AuthField, AuthMessage, PrimaryAuthButton } from './AuthLayout';
import { activateDevSuperLogin, getDevSuperUser, isDevSuperLoginAvailable } from '../../utils/devSuperLogin';

const LoginPage = () => {
	const navigate = useNavigate();
	const { setIsAdminSession, setIsLoggedIn, setUserInfo } = useAuthStore();
	const [form, setForm] = useState({ email: '', password: '' });
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const devSuperLoginAvailable = isDevSuperLoginAvailable();

	const completeLogin = useCallback(
		(user) => {
			setIsLoggedIn(true);
			setIsAdminSession(false);
			setUserInfo({
				loginId: user?.email,
				username: user?.email,
				grade: null
			});
			navigate('/dashboard');
		},
		[navigate, setIsAdminSession, setIsLoggedIn, setUserInfo]
	);

	const updateField = (field) => (event) => {
		setForm((prev) => ({ ...prev, [field]: event.target.value }));
		setError('');
	};

	const submitLogin = async (event) => {
		event.preventDefault();
		setSubmitting(true);
		setError('');
		const result = await authMvp.login(form);
		setSubmitting(false);
		if (!result?.ok) {
			if (result?.code === 'EMAIL_NOT_VERIFIED') {
				const email = form.email.trim().toLowerCase();
				sessionStorage.setItem('pendingEmailVerification', email);
				navigate(`/verify-email-code?email=${encodeURIComponent(email)}`);
				return;
			}
			setError(result?.messageKo || '이메일 또는 비밀번호를 확인해 주세요.');
			return;
		}
		completeLogin(result.user);
	};

	const handleGoogleCredential = useCallback(
		async (credential) => {
			setError('');
			const result = await authMvp.loginGoogle(credential);
			if (!result?.ok) {
				setError(result?.messageKo || 'Google 로그인 처리 중 오류가 발생했습니다.');
				return;
			}
			completeLogin(result.user);
		},
		[completeLogin]
	);

	const completeDevSuperLogin = useCallback(() => {
		if (!activateDevSuperLogin()) return;
		const devUser = getDevSuperUser();
		setIsLoggedIn(true);
		setIsAdminSession(false);
		setUserInfo({
			loginId: devUser.email,
			username: devUser.name,
			grade: 0,
			isDevSuperLogin: true
		});
		navigate('/take-profit-search');
	}, [navigate, setIsAdminSession, setIsLoggedIn, setUserInfo]);

	return (
		<AuthLayout title="로그인" asideText="계정이 없으신가요?" asideLinkText="회원가입" asideLinkTo="/register">
			<div className="space-y-5">
				<AuthGoogleButton onCredential={handleGoogleCredential} onError={setError} />
				<AuthDivider />
				{devSuperLoginAvailable ? (
					<button
						type="button"
						onClick={completeDevSuperLogin}
						className="h-11 w-full rounded-xl border border-[#2563EB] bg-[#EFF6FF] text-sm font-bold text-[#1D4ED8]"
					>
						DEV SUPER LOGIN
					</button>
				) : null}
				<form className="space-y-4" onSubmit={submitLogin}>
					<AuthField label="E-mail" type="email" value={form.email} onChange={updateField('email')} autoComplete="email" />
					<AuthField
						label="PW"
						type="password"
						value={form.password}
						onChange={updateField('password')}
						autoComplete="current-password"
					/>
					<AuthMessage>{error}</AuthMessage>
					<PrimaryAuthButton type="submit" disabled={submitting}>
						{submitting ? '로그인 중...' : '로그인'}
					</PrimaryAuthButton>
				</form>
				<div className="grid gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm">
					<a href="/realtime-data" className="font-bold text-[#2563EB]">
						실시간 데이터 보기
					</a>
					<p className="font-semibold text-[#64748B]">익절 조건 검색은 로그인 후 이용할 수 있습니다.</p>
				</div>
			</div>
		</AuthLayout>
	);
};

export default LoginPage;
