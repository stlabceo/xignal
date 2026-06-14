import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { authMvp } from '../../services/authMvp';
import AuthGoogleButton from './AuthGoogleButton';
import AuthLayout, { AuthDivider, AuthField, AuthMessage, PrimaryAuthButton } from './AuthLayout';

const RegisterPage = () => {
	const navigate = useNavigate();
	const [form, setForm] = useState({ email: '', password: '' });
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const updateField = (field) => (event) => {
		setForm((prev) => ({ ...prev, [field]: event.target.value }));
		setError('');
	};

	const handleGoogleCredential = useCallback(async (credential) => {
		setError('');
		const result = await authMvp.loginGoogle(credential);
		if (!result?.ok) {
			setError(result?.messageKo || 'Google 로그인 처리 중 오류가 발생했습니다.');
		} else {
			window.location.href = '/dashboard';
		}
	}, []);

	const submitRegister = async (event) => {
		event.preventDefault();
		setSubmitting(true);
		setError('');
		const result = await authMvp.register(form);
		setSubmitting(false);
		if (!result?.ok) {
			setError(result?.messageKo || '회원가입 처리 중 오류가 발생했습니다.');
			return;
		}
		const email = result.email || result.user?.email || form.email;
		sessionStorage.setItem('pendingEmailVerification', email);
		navigate(`/verify-email-code?email=${encodeURIComponent(email)}`);
	};

	return (
		<AuthLayout title="회원가입" asideText="이미 계정이 있으신가요?" asideLinkText="로그인" asideLinkTo="/login">
			<div className="space-y-5">
				<AuthGoogleButton onCredential={handleGoogleCredential} onError={setError} />
				<AuthDivider />
				<form className="space-y-4" onSubmit={submitRegister}>
					<AuthField label="E-mail" type="email" value={form.email} onChange={updateField('email')} autoComplete="email" />
					<AuthField
						label="PW"
						type="password"
						value={form.password}
						onChange={updateField('password')}
						autoComplete="new-password"
					/>
					<AuthMessage>{error}</AuthMessage>
					<PrimaryAuthButton type="submit" disabled={submitting}>
						{submitting ? '가입 처리 중...' : '가입하기'}
					</PrimaryAuthButton>
				</form>
				<p className="text-[13px] leading-6 text-[#64748B]">
					가입하면{' '}
					<Link to="/terms" className="font-semibold text-[#2563EB]">
						이용약관
					</Link>{' '}
					및{' '}
					<Link to="/privacy" className="font-semibold text-[#2563EB]">
						개인정보처리방침
					</Link>
					에 동의합니다.
				</p>
			</div>
		</AuthLayout>
	);
};

export default RegisterPage;
