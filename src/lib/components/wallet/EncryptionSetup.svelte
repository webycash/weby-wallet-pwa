<script lang="ts">
	import { encryptionType, setEncryptionType, type EncryptionType } from '$lib/stores/settings.svelte';
	import { isWebAuthnAvailable } from '$lib/core/encryption';
	import { Lock, Fingerprint, ShieldOff } from '@lucide/svelte';

	let current = $state<EncryptionType>(encryptionType());
	const webauthnAvailable = isWebAuthnAvailable();

	const options: { value: EncryptionType; label: string; desc: string; icon: any }[] = [
		{ value: 'none', label: 'No encryption', desc: 'Wallet data stored unencrypted', icon: ShieldOff },
		{ value: 'password', label: 'Password', desc: 'Argon2 + AES-256-GCM encryption', icon: Lock },
		...(webauthnAvailable ? [{
			value: 'passkey' as EncryptionType,
			label: 'Passkey',
			desc: 'Face ID / Touch ID / fingerprint',
			icon: Fingerprint
		}] : []),
	];

	const select = (value: EncryptionType) => {
		current = value;
		setEncryptionType(value);
	};
</script>

<div>
	<p class="text-xs font-medium text-muted-foreground mb-2">Encryption</p>
	<div class="grid gap-2">
		{#each options as opt}
			<button onclick={() => select(opt.value)}
				class="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all
					{current === opt.value
						? 'border-primary/40 bg-primary/5'
						: 'border-border hover:border-border hover:bg-muted/20'}">
				<opt.icon
					class="w-4 h-4 shrink-0 {current === opt.value ? 'text-primary' : 'text-muted-foreground'}" />
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium {current === opt.value ? 'text-primary' : 'text-foreground'}">{opt.label}</p>
					<p class="text-[11px] text-muted-foreground">{opt.desc}</p>
				</div>
				{#if current === opt.value}
					<div class="w-2 h-2 rounded-full bg-primary shrink-0"></div>
				{/if}
			</button>
		{/each}
	</div>
</div>
