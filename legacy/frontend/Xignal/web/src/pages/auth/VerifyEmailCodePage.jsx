import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authMvp } from '../../services/authMvp';
import AuthLayout, { AuthField, AuthMessage, PrimaryAuthButton } from './AuthLayout';

const onlySixDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 6);

const VerifyEmailCodePage = () => {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const email = useMemo(() => {
		const queryEmail = searchParams.get('email');
		return queryEmail || sessionStorage.getItem('pendingEmailVerification') || '';
	}, [searchParams]);
	const [code, setCode] = useState('');
	const [message, setMessage] = useState('');
	const [messageTone, setMessageTone] = useState('error');
	const [submitting, setSubmitting] = useState(false);
	const [resending, setResending] = useState(false);

	const updateCode = (event) => {
		setCode(onlySixDigits(event.target.value));
		setMessage('');
	};

	const submitCode = async (event) => {
		event.preventDefault();
		if (!email) {
			setMessage('인증할 이메일을 확인할 수 없습니다. 회원가입을 다시 진행해 주세요.');
			return;
		}
		if (!/^\d{6}$/.test(code.trim())) {
			setMessage('6자리 인증번호를 입력해 주세요.');
			return;
		}

		setSubmitting(true);
		setMessage('');
		const result = await authMvp.verifyEmailCode({ email, code: code.trim() });
		setSubmitting(false);
		if (!result?.ok) {
			setMessageTone('error');
			setMessage(result?.messageKo || '인증번호를 확인해 주세요.');
			return;
		}

		sessionStorage.removeItem('pendingEmailVerification');
		setMessageTone('success');
		setMessage('이메일 인증이 완료되었습니다. 로그인해 주세요.');
		window.setTimeout(() => navigate('/login'), 700);
	};

	const resendCode = async () => {
		if (!email) {
			setMessageTone('error');
			setMessage('인증할 이메일을 확인할 수 없습니다. 회원가입을 다시 진행해 주세요.');
			return;
		}
		setResending(true);
		setMessage('');
		const result = await authMvp.resendVerificationCode({ email });
		setResending(false);
		if (!result?.ok) {
			setMessageTone('error');
			setMessage(result?.messageKo || '인증번호 다시 보내기 중 오류가 발생했습니다.');
			return;
		}
		setMessageTone('success');
		setMessage('인증번호를 다시 보냈습니다. 메일함을 확인해 주세요.');
	};

	return (
		<AuthLayout title="이메일 인증" asideText="이미 인증하셨나요?" asideLinkText="로그인" asideLinkTo="/login">
			<div className="space-y-5">
				<div className="rounded-[14px] bg-[#F8FAFC] p-5 text-[15px] leading-7 text-[#334155]">
					<p>입력하신 이메일로 인증번호를 보냈습니다.</p>
					<p>메일함에서 6자리 인증번호를 확인하세요.</p>
				</div>
				<form className="space-y-4" onSubmit={submitCode}>
					<AuthField label="E-mail" type="email" value={email} readOnly />
					<AuthField
						label="인증번호"
						inputMode="numeric"
						pattern="[0-9]{6}"
						maxLength={6}
						placeholder="6자리 숫자"
						value={code}
						onChange={updateCode}
						autoComplete="one-time-code"
					/>
					<AuthMessage tone={messageTone}>{message}</AuthMessage>
					<PrimaryAuthButton type="submit" disabled={submitting}>
						{submitting ? '인증 중...' : '인증하기'}
					</PrimaryAuthButton>
				</form>
				<div className="flex flex-col gap-3 text-center text-[14px] text-[#64748B] sm:flex-row sm:items-center sm:justify-between">
					<span>인증번호를 받지 못하셨나요?</span>
					<button type="button" className="font-semibold text-[#2563EB]" onClick={resendCode} disabled={resending}>
						{resending ? '보내는 중...' : '다시 보내기'}
					</button>
				</div>
				<Link to="/register" className="block text-center text-[14px] font-semibold text-[#2563EB]">
					이메일을 다시 입력하기
				</Link>
			</div>
		</AuthLayout>
	);
};

export default VerifyEmailCodePage;
