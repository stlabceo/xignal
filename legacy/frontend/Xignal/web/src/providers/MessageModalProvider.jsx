import { createContext, useCallback, useContext, useState } from 'react';
import { DefaultModal } from '../components/modal/DefaultModal';

const MessageModalContext = createContext(null);

export const MessageModalProvider = ({ children }) => {
	const [modalProps, setModalProps] = useState(null);
	const [isOpen, setIsOpen] = useState(false);

	const showMessage = useCallback((options) => {
		setModalProps(options);
		setIsOpen(true);
	}, []);

	const handleClose = () => {
		setIsOpen(false);
		setTimeout(() => setModalProps(null), 200);
	};

	const handleConfirm = () => {
		modalProps?.onConfirm?.();
		handleClose();
	};

	const handleCancel = () => {
		modalProps?.onCancel?.();
		handleClose();
	};

	return (
		<MessageModalContext.Provider value={{ showMessage }}>
			{children}
			<DefaultModal
				isOpen={isOpen}
				onClose={handleClose}
				showCloseButton={false}
				className="w-[92vw] max-w-[520px] p-5 md:p-8"
			>
				{modalProps && (
					<div className="text-center">
						<p className="break-words text-[16px] leading-6 text-[#fff] md:text-lg">
							{modalProps.message}
						</p>

						<div className="mt-7 flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
							{modalProps.onCancel && (
								<button
									onClick={handleCancel}
									type="button"
									className="w-full rounded border border-[#00ad85] py-2 text-[#00ad85] cursor-pointer sm:w-[150px]"
								>
									{modalProps.cancelText || '취소'}
								</button>
							)}

							<button
								onClick={handleConfirm}
								type="button"
								className={`${
									modalProps.danger ? 'bg-red-600' : 'bg-[#0033b2]'
								} w-full rounded py-2 text-white cursor-pointer sm:w-[150px]`}
							>
								{modalProps.confirmText || '확인'}
							</button>
						</div>
					</div>
				)}
			</DefaultModal>
		</MessageModalContext.Provider>
	);
};

export const useMessageModalContext = () => {
	const context = useContext(MessageModalContext);
	if (!context) throw new Error('useMessageModalContext must be used within MessageModalProvider');
	return context;
};
