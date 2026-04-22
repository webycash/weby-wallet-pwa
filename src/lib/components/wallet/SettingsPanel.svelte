<script lang="ts">
	import { removeWallet, renameWallet, setActive, getMnemonic, exportMasterBackup,
		isRoaming, importRoamingFromFile, importRoamingFromSecret,
		exportWebcasaFile } from '$lib/stores/wallet.svelte';
	import { markBackedUp, encryptionType } from '$lib/stores/settings.svelte';
	import * as Persistence from '$lib/core/persistence';
	import { QrCode, Download, Trash2, Pencil, Lock, Key, Upload, FileDown, FileUp, KeyRound, Copy } from '@lucide/svelte';

	let fileInputEl = $state<HTMLInputElement | null>(null);

	import Button from '$lib/components/ui/button/button.svelte';
	import EncryptionSetup from './EncryptionSetup.svelte';

	import type AppDialog from './AppDialog.svelte';
	let { activeFamily, activeLabel, isRoamingWallet, onRefresh, onMessage, appDialog, section }:
		{ activeFamily: string; activeLabel: string; isRoamingWallet: boolean; onRefresh: () => Promise<void>; onMessage: (msg: string, type?: 'success' | 'error') => void; appDialog?: ReturnType<typeof AppDialog>; section?: 'wallet' | 'master' | 'webcash' | null } = $props();

	const showSection = (s: string) => !section || section === s;

	let qrDataUrl = $state('');
	let renameInput = $state('');
	let showRename = $state(false);
	let mnemonicWords = $state('');

	const handleShowMnemonic = async () => {
		if (mnemonicWords) { mnemonicWords = ''; return; }
		const m = await getMnemonic();
		if (m) mnemonicWords = m;
		else onMessage('No mnemonic found', 'error');
	};

	const handleCopyMnemonic = async () => {
		await navigator.clipboard.writeText(mnemonicWords);
		onMessage('Mnemonic copied');
	};

	const handleQrExport = async () => {
		const mnemonic = await getMnemonic();
		if (!mnemonic) return;
		const QR = (await import('qrcode')).default;
		qrDataUrl = await QR.toDataURL(mnemonic, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });
	};

	const handleBackup = async () => {
		try {
			const backupJson = await exportMasterBackup();
			const blob = new Blob([backupJson], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `weby-master-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			markBackedUp();
			onMessage('Master backup downloaded');
		} catch (e) { onMessage(`Backup failed: ${e}`, 'error'); }
	};

	const handleDeleteMaster = async () => {
		const ok = await appDialog?.confirm('Delete Master Wallet', {
			description: 'This destroys ALL wallets derived from this master key. Make sure you have a backup of your mnemonic.',
			confirmLabel: 'Delete Everything',
			danger: true,
		});
		if (!ok) return;
		try {
			const { deleteEverything } = await import('$lib/core/persistence');
			await deleteEverything();
			localStorage.clear();
			setTimeout(() => { window.location.href = window.location.pathname; }, 200);
		} catch (e) {
			onMessage(`Delete failed: ${e}`, 'error');
		}
	};

	const handleDeleteDerived = async () => {
		if (activeLabel === 'main') { onMessage('Cannot delete the main wallet', 'error'); return; }
		const ok = await appDialog?.confirm(`Delete "${activeLabel}"`, {
			description: 'This wallet and its data will be removed.',
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!ok) return;
		try {
			const deleted = activeLabel;
			await removeWallet(activeFamily, activeLabel);
			await setActive(activeFamily, 'main');
			onMessage(`Wallet "${deleted}" deleted`);
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

	// ── Roaming import state ───────────────────────────────────────
	let importFile = $state<File | null>(null);
	let importLabel = $state('');
	let importPassword = $state('');
	let importShowPassword = $state(false);
	let importLoading = $state(false);
	let importSecretHex = $state('');
	let importSecretLabel = $state('');
	let importSecretLoading = $state(false);
	let showSecretImport = $state(false);

	const nextRoamingLabel = (): string => {
		const network = Persistence.getActive(Persistence.getActive('production').family ? 'production' : 'testnet').family;
		const registry = Persistence.getRegistry('production').concat(Persistence.getRegistry('testnet'));
		let n = 1;
		while (registry.some(e => e.label === `imported-${n}`)) n++;
		return `imported-${n}`;
	};

	const handleFileImport = async () => {
		if (!importFile) return;
		const label = importLabel.trim() || nextRoamingLabel();
		importLoading = true;
		const r = await importRoamingFromFile(importFile, label, importPassword || undefined);
		importLoading = false;
		if (r.ok) {
			onMessage(`Roaming wallet "${label}" imported`);
			importFile = null; importLabel = ''; importPassword = ''; importShowPassword = false;
			await onRefresh();
		} else onMessage(r.error, 'error');
	};

	const handleSecretImport = async () => {
		const label = importSecretLabel.trim() || nextRoamingLabel();
		importSecretLoading = true;
		const r = await importRoamingFromSecret(importSecretHex.trim(), label);
		importSecretLoading = false;
		if (r.ok) {
			onMessage(`Roaming wallet "${label}" imported and recovered`);
			importSecretHex = ''; importSecretLabel = '';
			await onRefresh();
		} else onMessage(r.error, 'error');
	};

	const handleExportWebcasa = async () => {
		try {
			await exportWebcasaFile();
			onMessage('Wallet exported as .webcash');
		} catch (e) { onMessage(`Export failed: ${e}`, 'error'); }
	};

	const isDetail = !!section;
	const sectionClass = 'rounded-2xl bg-card overflow-hidden';
	const summaryClass = 'flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none hover:bg-muted/40 transition-all duration-200 text-[13px] font-semibold';
	const contentClass = isDetail ? 'space-y-3' : 'px-4 pb-4 space-y-3';
	const disabledClass = 'rounded-2xl bg-card opacity-30';
</script>

{#snippet walletContent()}
	<div class={contentClass}>
		<div class="flex items-center gap-2">
			<span class="text-sm text-muted-foreground">Label:</span>
			<span class="text-sm font-medium capitalize">{activeLabel}</span>
			<span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{activeFamily}</span>
			{#if isRoamingWallet}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-semibold">Roaming</span>
			{/if}
		</div>
		{#if showRename}
			<div class="flex gap-2">
				<input bind:value={renameInput} placeholder="New label" class="flex-1 rounded-lg bg-muted/50 px-3 py-1.5 text-sm" />
				<Button size="sm" onclick={handleRename}>Save</Button>
				<Button size="sm" variant="outline" onclick={() => showRename = false}>Cancel</Button>
			</div>
		{:else}
			<div class="flex gap-2">
				<Button variant="outline" class="flex-1" onclick={() => { renameInput = activeLabel; showRename = true; }}>
					<Pencil class="w-3.5 h-3.5" /> Rename
				</Button>
				<Button variant="outline" class="flex-1" onclick={handleExportWebcasa}>
					<Download class="w-3.5 h-3.5" /> Export
				</Button>
				{#if activeLabel !== 'main'}
					<Button variant="destructive" class="flex-1" onclick={handleDeleteDerived}>
						<Trash2 class="w-3.5 h-3.5" /> Delete
					</Button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet masterContent()}
	<div class={contentClass}>
		<EncryptionSetup />
		<div class="flex flex-col gap-2 pt-3">
			<Button variant="outline" class="w-full justify-start" onclick={handleShowMnemonic}>
				<KeyRound class="w-4 h-4" /> Export Mnemonic
			</Button>
			<Button variant="outline" class="w-full justify-start" onclick={handleQrExport}>
				<QrCode class="w-4 h-4" /> Pair QR Code
			</Button>
			<Button variant="outline" class="w-full justify-start" onclick={handleBackup}>
				<Download class="w-4 h-4" /> Backup
			</Button>
		</div>
		{#if mnemonicWords}
			<div class="pt-3">
				<p class="text-xs text-muted-foreground mb-2">BIP39/BIP32 Mnemonic (keep secret)</p>
				<div class="rounded-2xl bg-muted/50 p-3 text-sm font-mono leading-relaxed break-words select-all">
					{mnemonicWords}
				</div>
				<Button variant="outline" size="sm" class="w-full mt-2" onclick={handleCopyMnemonic}>
					<Copy class="w-3.5 h-3.5" /> Copy
				</Button>
			</div>
		{/if}
		{#if qrDataUrl}
			<div class="pt-3 text-center">
				<p class="text-xs text-muted-foreground mb-3">Scan to import wallet</p>
				<div class="inline-block bg-white rounded-2xl p-4"><img src={qrDataUrl} alt="Wallet QR" class="w-48 h-48" /></div>
			</div>
		{/if}
		<div class="pt-3">
			<Button variant="destructive" class="w-full" onclick={handleDeleteMaster}>
				<Trash2 class="w-4 h-4" /> Delete Master Wallet
			</Button>
		</div>
	</div>
{/snippet}

{#snippet webcashContent()}
	<div class={contentClass}>
		<p class="text-xs text-muted-foreground">Import a roaming webcash wallet from file or master secret.</p>

		<input type="file" accept=".webcash,.json" bind:this={fileInputEl}
			onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFile = f; }}
			class="hidden" />

		<div class="flex flex-col gap-2">
			<Button variant="outline" class="w-full justify-start" onclick={() => fileInputEl?.click()}>
				<FileUp class="w-4 h-4" />
				{importFile ? importFile.name : 'Import from File'}
			</Button>

			{#if importFile}
				<input bind:value={importLabel} placeholder="Label"
					class="w-full rounded-2xl bg-muted/50 px-3 py-1.5 text-sm" />
				<label class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
					<input type="checkbox" bind:checked={importShowPassword} class="rounded" />
					Encrypted
				</label>
				{#if importShowPassword}
					<input type="password" bind:value={importPassword} placeholder="Password"
						class="w-full rounded-2xl bg-muted/50 px-3 py-1.5 text-sm" />
				{/if}
				<Button variant="outline" class="w-full" onclick={handleFileImport} disabled={importLoading}>
					<Upload class="w-3.5 h-3.5" />
					{importLoading ? 'Importing...' : 'Import'}
				</Button>
			{/if}
		</div>

		<div class="pt-3 flex flex-col gap-2">
			<Button variant="outline" class="w-full justify-start"
				onclick={() => showSecretImport = !showSecretImport}>
				<KeyRound class="w-4 h-4" /> Import from Master Secret
			</Button>

			{#if showSecretImport}
				<input bind:value={importSecretHex} placeholder="64-character hex"
					class="w-full rounded-2xl bg-muted/50 px-3 py-1.5 text-sm font-mono" />
				<input bind:value={importSecretLabel} placeholder="Label"
					class="w-full rounded-2xl bg-muted/50 px-3 py-1.5 text-sm" />
				<Button variant="outline" class="w-full" onclick={handleSecretImport}
					disabled={!importSecretHex.trim() || importSecretLoading}>
					<Upload class="w-3.5 h-3.5" />
					{importSecretLoading ? 'Recovering...' : 'Import'}
				</Button>
			{/if}
		</div>
	</div>
{/snippet}

<!-- Render: detail mode (mobile) = content directly, no accordion -->
{#if isDetail}
	{#if section === 'wallet'}{@render walletContent()}{/if}
	{#if section === 'master'}{@render masterContent()}{/if}
	{#if section === 'webcash'}{@render webcashContent()}{/if}
{:else}
<!-- Render: accordion mode (desktop) -->
<div class="space-y-2">
	<details class={sectionClass}>
		<summary class={summaryClass}>
			<Key class="w-4 h-4 text-muted-foreground" />
			<span class="flex-1">Selected</span>
			<span class="text-xs text-muted-foreground font-normal capitalize">{activeLabel}</span>
		</summary>
		<div class="px-4 pb-4">{@render walletContent()}</div>
	</details>

	<details class={sectionClass}>
		<summary class={summaryClass}>
			<Lock class="w-4 h-4 text-muted-foreground" />
			<span class="flex-1">Master</span>
		</summary>
		<div class="px-4 pb-4">{@render masterContent()}</div>
	</details>

	<details class={sectionClass}>
		<summary class={summaryClass}>
			<span class="w-4 h-4 text-muted-foreground font-bold text-sm leading-4">W</span>
			<span class="flex-1">Webcash</span>
		</summary>
		<div class="px-4 pb-4">{@render webcashContent()}</div>
	</details>

	<div class={disabledClass}>
		<div class={summaryClass}>
			<span class="w-4 h-4 text-muted-foreground font-bold text-sm leading-4">B</span>
			<span class="flex-1">Bitcoin</span>
			<span class="text-xs text-muted-foreground">Coming soon</span>
		</div>
	</div>

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
{/if}
