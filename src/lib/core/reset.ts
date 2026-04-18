// Wallet reset — delegates to persistence layer.

import { deleteEverything } from './persistence';

export const resetWallet = async (): Promise<void> => {
	await deleteEverything();
};
