import { useMessageModalContext } from '../providers/MessageModalProvider.jsx';

export const useMessageModal = () => {
	const { showMessage } = useMessageModalContext();
	return showMessage;
};
