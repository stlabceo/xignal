import { useEffect, useRef, useState } from 'react';

const GOOGLE_CLIENT_ID =
	import.meta.env.VITE_GOOGLE_CLIENT_ID ||
	'318325527196-1h1d65s069ot50qrr3b6mled1a6gtpks.apps.googleusercontent.com';

const loadGoogleScript = () =>
	new Promise((resolve, reject) => {
		if (window.google?.accounts?.id) {
			resolve();
			return;
		}

		const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
		if (existing) {
			existing.addEventListener('load', resolve, { once: true });
			existing.addEventListener('error', reject, { once: true });
			return;
		}

		const script = document.createElement('script');
		script.src = 'https://accounts.google.com/gsi/client';
		script.async = true;
		script.defer = true;
		script.addEventListener('load', resolve, { once: true });
		script.addEventListener('error', reject, { once: true });
		document.head.appendChild(script);
	});

const AuthGoogleButton = ({ onCredential, onError }) => {
	const containerRef = useRef(null);
	const [fallbackVisible, setFallbackVisible] = useState(false);

	useEffect(() => {
		let disposed = false;
		loadGoogleScript()
			.then(() => {
				if (disposed || !containerRef.current || !window.google?.accounts?.id) return;
				window.google.accounts.id.initialize({
					client_id: GOOGLE_CLIENT_ID,
					callback: (response) => {
						if (response?.credential) {
							onCredential(response.credential);
							return;
						}
						onError?.('Google 인증 응답을 확인하지 못했습니다.');
					}
				});
				window.google.accounts.id.renderButton(containerRef.current, {
					theme: 'outline',
					size: 'large',
					width: 520,
					text: 'continue_with',
					shape: 'rectangular',
					logo_alignment: 'left'
				});
			})
			.catch(() => {
				if (!disposed) setFallbackVisible(true);
			});

		return () => {
			disposed = true;
		};
	}, [onCredential, onError]);

	if (fallbackVisible) {
		return (
			<button
				type="button"
				onClick={() => onError?.('Google 버튼을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')}
				className="flex h-12 w-full items-center justify-center rounded-xl border border-[#CBD5E1] bg-white text-[15px] font-semibold text-[#0F172A] transition hover:bg-[#F8FAFC]"
			>
				Google로 계속하기
			</button>
		);
	}

	return <div ref={containerRef} className="flex min-h-12 w-full justify-center" />;
};

export default AuthGoogleButton;
