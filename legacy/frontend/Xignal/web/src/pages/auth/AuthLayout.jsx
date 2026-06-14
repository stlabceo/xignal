import { Link } from 'react-router';

const AuthLayout = ({ title, asideText, asideLinkText, asideLinkTo, children }) => (
	<div className="min-h-screen bg-white px-6 py-10 text-[#0F172A]">
		<div className="mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-[560px] flex-col justify-center">
			<div className="mb-10">
				<p className="mb-3 text-[13px] font-semibold tracking-[0.18em] text-[#2563EB]">QUANTU</p>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h1 className="text-[32px] font-bold leading-tight text-[#0F172A]">{title}</h1>
					</div>
					<p className="text-[14px] text-[#64748B]">
						{asideText}{' '}
						<Link to={asideLinkTo} className="font-semibold text-[#2563EB]">
							{asideLinkText}
						</Link>
					</p>
				</div>
			</div>
			{children}
		</div>
	</div>
);

export const AuthDivider = () => (
	<div className="flex items-center gap-4 py-5">
		<div className="h-px flex-1 bg-[#E2E8F0]" />
		<span className="text-[13px] font-medium text-[#94A3B8]">또는</span>
		<div className="h-px flex-1 bg-[#E2E8F0]" />
	</div>
);

export const AuthField = ({ label, ...props }) => (
	<label className="block">
		<span className="mb-2 block text-[14px] font-semibold text-[#334155]">{label}</span>
		<input
			{...props}
			className="h-[58px] w-full rounded-[14px] border border-transparent bg-[#F8FAFC] px-4 text-[16px] text-[#0F172A] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#DBEAFE]"
		/>
	</label>
);

export const AuthMessage = ({ tone = 'error', children }) => {
	if (!children) return null;
	const color = tone === 'success' ? 'text-[#16A34A]' : 'text-[#DC2626]';
	return <p className={`text-[14px] font-medium ${color}`}>{children}</p>;
};

export const PrimaryAuthButton = ({ children, ...props }) => (
	<button
		{...props}
		className="h-12 w-full rounded-xl bg-[#2563EB] text-[15px] font-bold text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
	>
		{children}
	</button>
);

export default AuthLayout;
