import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { authMvp } from '../../services/authMvp';
import AuthGoogleButton from './AuthGoogleButton';
import AuthLayout, { AuthDivider, AuthField, AuthMessage, PrimaryAuthButton } from './AuthLayout';

const RegisterSuccess = ({ email, mailResult, onResend, resendState }) => (
	<AuthLayout title="인증 메일을 보냈습니다" asideText="이미 인증했나요?" asideLinkText="로그인" asideLinkTo="/login">
		<div className="space-y-5">
			<div className="rounded-[14px] bg-[#F8FAFC] p-5 text-[15px] leading-7 text-[#334155]">
				<p className="font-semibold text-[#0F172A]">{email}</p>
				<p>메일함에서 인증 링크를 눌러 계정을 활성화해 주세요.</p>
				{mailResult?.sent === false && (
					<p className="mt-3 text-[#DC2626]">
						계정은 생성되었지만 인증 메일 발송 확인이 필요합니다. 재발송 버튼을 사용할 수 있습니다.
					</p>
				)}
			</div>
			<AuthMessage tone={resendState.ok ? 'success' : 'error'}>{resendState.message}</AuthMessage>
			<div className="grid gap-3 sm:grid-cols-2">
				<PrimaryAuthButton type="button" onClick={onResend} disabled={resendState.loading}>
					{resendState.loading ? '보내는 중...' : '인증 메일 다시 보내기'}
				</PrimaryAuthButton>
				<Link
					to="/login"
					className="flex h-12 items-center justify-center rounded-xl border border-[#CBD5E1] text-[15px] font-bold text-[#0F172A]"
				>
					로그인으로 이동
				</Link>
			</div>
		</div>
	</AuthLayout>
);

const RegisterPage = () => {
	const [form, setForm] = useState({ email: '', password: '' });
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [success, setSuccess] = useState(null);
	const [resendState, setResendState] = useState({ loading: false, ok: false, message: '' });

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
		setSuccess({
			email: result.user?.email || form.email,
			mailResult: result.email
		});
	};

	const resend = async () => {
		setResendState({ loading: true, ok: false, message: '' });
		const result = await authMvp.resendVerification({ email: success?.email });
		if (result?.ok) {
			setResendState({ loading: false, ok: true, message: '인증 메일 재발송 요청이 완료되었습니다.' });
			return;
		}
		setResendState({
			loading: false,
			ok: false,
			message: result?.messageKo || '인증 메일 재발송 중 오류가 발생했습니다.'
		});
	};

	if (success) {
		return (
			<RegisterSuccess
				email={success.email}
				mailResult={success.mailResult}
				onResend={resend}
				resendState={resendState}
			/>
		);
	}

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
