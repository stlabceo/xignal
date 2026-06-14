import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../store/authState';
import { authMvp } from '../../services/authMvp';
import AuthGoogleButton from './AuthGoogleButton';
import AuthLayout, { AuthDivider, AuthField, AuthMessage, PrimaryAuthButton } from './AuthLayout';

const LoginPage = () => {
	const navigate = useNavigate();
	const { setIsAdminSession, setIsLoggedIn, setUserInfo } = useAuthStore();
	const [form, setForm] = useState({ email: '', password: '' });
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);

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

	return (
		<AuthLayout title="로그인" asideText="계정이 없으신가요?" asideLinkText="회원가입" asideLinkTo="/register">
			<div className="space-y-5">
				<AuthGoogleButton onCredential={handleGoogleCredential} onError={setError} />
				<AuthDivider />
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
			</div>
		</AuthLayout>
	);
};

export default LoginPage;
