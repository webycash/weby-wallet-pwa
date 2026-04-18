<script lang="ts">
	import { exportWalletSnapshot, importWalletSnapshot, removeWallet, renameWallet,
		getMnemonic } from '$lib/stores/wallet.svelte';
	import { markBackedUp, encryptionType } from '$lib/stores/settings.svelte';
	import * as Persistence from '$lib/core/persistence';
	import { QrCode, Download, Upload, Trash2, Pencil, Lock, Key } from '@lucide/svelte';

	import Button from '$lib/components/ui/button/button.svelte';
	import EncryptionSetup from './EncryptionSetup.svelte';

	let { activeFamily, activeLabel, onRefresh, onMessage }:
		{ activeFamily: string; activeLabel: string; onRefresh: () => Promise<void>; onMessage: (msg: string, type?: 'success' | 'error') => void } = $props();

	let qrDataUrl = $state('');
	let renameInput = $state('');
	let showRename = $state(false);

	const handleQrExport = async () => {
		const mnemonic = await getMnemonic();
		if (!mnemonic) return;
		const QR = (await import('qrcode')).default;
		qrDataUrl = await QR.toDataURL(mnemonic, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });
	};

	const handleBackup = async () => {
		const snap = await exportWalletSnapshot();
		const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `weby-wallet-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
		markBackedUp();
		onMessage('Backup downloaded');
	};

	const handleImportBackup = async () => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				const snap = JSON.parse(text);
				const r = await importWalletSnapshot(snap);
				if (r.ok) { onMessage('Backup imported'); await onRefresh(); }
				else onMessage(r.error, 'error');
			} catch (e) { onMessage(`Import failed: ${e}`, 'error'); }
		};
		input.click();
	};

	const handleDeleteMaster = async () => {
		if (!confirm('DELETE MASTER WALLET?\n\nThis destroys ALL wallets derived from this master key.\nMake sure you have a backup of your mnemonic.')) return;
		const { deleteEverything } = await import('$lib/core/persistence');
		await deleteEverything();
		const { clearWallet } = await import('$lib/stores/settings.svelte');
		clearWallet();
		setTimeout(() => { window.location.href = window.location.pathname; }, 100);
	};

	const handleDeleteDerived = async () => {
		if (activeLabel === 'main') { onMessage('Cannot delete the main wallet', 'error'); return; }
		if (!confirm(`Delete wallet "${activeLabel}"?`)) return;
		try {
			await removeWallet(activeFamily, activeLabel);
			onMessage(`Wallet "${activeLabel}" deleted`);
			await onRefresh();
		} catch (e) { onMessage(`${e}`, 'error'); }
	};

	const handleRename = async () => {
		if (!renameInput.trim()) return;
		try {
			await renameWallet(activeFamily, activeLabel, renameInput.trim());
			showRename = false;
			renameInput = '';
			onMessage('Wallet renamed');
			await onRefresh();
		} catch (e) { onMessage(`${e}`, 'error'); }
	};

	const sectionClass = 'rounded-xl bg-card overflow-hidden';
	const summaryClass = 'flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted transition-colors text-sm font-semibold';
	const contentClass = 'px-4 pb-4 space-y-3';
	const disabledClass = 'rounded-xl bg-card opacity-40';
</script>

<div class="space-y-2">
	<!-- Selected Wallet (default open) -->
	<details open class={sectionClass}>
		<summary class={summaryClass}>
			<Key class="w-4 h-4 text-primary" />
			<span class="flex-1">Wallet</span>
			<span class="text-xs text-muted-foreground font-normal capitalize">{activeLabel}</span>
		</summary>
		<div class={contentClass}>
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">Label:</span>
				<span class="text-sm font-medium capitalize">{activeLabel}</span>
				<span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{activeFamily}</span>
			</div>
			{#if showRename}
				<div class="flex gap-2">
					<input bind:value={renameInput} placeholder="New label" class="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
					<Button size="sm" onclick={handleRename}>Save</Button>
					<Button size="sm" variant="outline" onclick={() => showRename = false}>Cancel</Button>
				</div>
			{:else}
				<div class="flex gap-2">
					<Button variant="outline" class="flex-1" onclick={() => { renameInput = activeLabel; showRename = true; }}>
						<Pencil class="w-3.5 h-3.5" /> Rename
					</Button>
					{#if activeLabel !== 'main'}
						<Button variant="destructive" class="flex-1" onclick={handleDeleteDerived}>
							<Trash2 class="w-3.5 h-3.5" /> Delete
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</details>

	<!-- Master -->
	<details class={sectionClass}>
		<summary class={summaryClass}>
			<Lock class="w-4 h-4 text-warning" />
			<span class="flex-1">Master</span>
		</summary>
		<div class={contentClass}>
			<EncryptionSetup />
			<div class="flex flex-col gap-2 pt-3 border-t border-border">
				<Button variant="outline" class="w-full justify-start" onclick={handleQrExport}>
					<QrCode class="w-4 h-4" /> Pair QR Code
				</Button>
				<Button variant="outline" class="w-full justify-start" onclick={handleBackup}>
					<Download class="w-4 h-4" /> Backup
				</Button>
				<Button variant="outline" class="w-full justify-start" onclick={handleImportBackup}>
					<Upload class="w-4 h-4" /> Import Backup
				</Button>
			</div>
			{#if qrDataUrl}
				<div class="pt-3 border-t border-border text-center">
					<p class="text-xs text-muted-foreground mb-3">Scan to import wallet</p>
					<div class="inline-block bg-white rounded-2xl p-4"><img src={qrDataUrl} alt="Wallet QR" class="w-48 h-48" /></div>
				</div>
			{/if}
			<div class="pt-3 border-t border-border">
				<Button variant="destructive" class="w-full" onclick={handleDeleteMaster}>
					<Trash2 class="w-4 h-4" /> Delete Master Wallet
				</Button>
			</div>
		</div>
	</details>

	<!-- Webcash -->
	<details class={sectionClass}>
		<summary class={summaryClass}>
			<span class="w-4 h-4 text-success font-bold text-sm leading-4">₩</span>
			<span class="flex-1">Webcash</span>
		</summary>
		<div class={contentClass}>
			<p class="text-sm text-muted-foreground">Webcash wallet settings will appear here as features are added.</p>
		</div>
	</details>

	<!-- Bitcoin (disabled) -->
	<div class={disabledClass}>
		<div class={summaryClass}>
			<span class="w-4 h-4 text-muted-foreground font-bold text-sm leading-4">₿</span>
			<span class="flex-1">Bitcoin</span>
			<span class="text-xs text-muted-foreground">Coming soon</span>
		</div>
	</div>

	<!-- RGB (disabled) -->
	<div class={disabledClass}>
		<div class={summaryClass}>
			<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polygon points="12 2 22 20 2 20" />
				<circle cx="12" cy="14" r="3" />
			</svg>
			<span class="flex-1">RGB</span>
			<span class="text-xs text-muted-foreground">Coming soon</span>
		</div>
	</div>
</div>
