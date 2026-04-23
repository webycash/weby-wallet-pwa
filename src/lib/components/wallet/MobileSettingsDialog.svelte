<script lang="ts">
	import { X } from '@lucide/svelte';
	import { getMobileSettingsSection, closeSettingsSection } from '$lib/stores/navigation.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import type AppDialog from './AppDialog.svelte';

	let { activeFamily, activeLabel, isRoamingWallet, onRefresh, onMessage, appDialog }: {
		activeFamily: string;
		activeLabel: string;
		isRoamingWallet: boolean;
		onRefresh: () => Promise<void>;
		onMessage: (msg: string, type?: 'success' | 'error') => void;
		appDialog?: ReturnType<typeof AppDialog>;
	} = $props();

	const rawSection = $derived(getMobileSettingsSection());
	const section = $derived(
		rawSection === 'wallet' || rawSection === 'master' || rawSection === 'webcash'
			? rawSection : null
	);
	const sectionTitle = $derived(
		section === 'wallet' ? 'Selected Wallet'
		: section === 'master' ? 'Master Key'
		: section === 'webcash' ? 'Webcash Import'
		: ''
	);
</script>

{#if section}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 bg-background/60 backdrop-blur-md" onclick={closeSettingsSection}></div>
	<div class="fixed top-14 left-4 right-4 bottom-4 z-50 bg-background rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-in"
		role="dialog" aria-modal="true" aria-label={sectionTitle}>
		<div class="flex items-center justify-between px-6 py-5">
			<h2 class="text-[15px] font-semibold">{sectionTitle}</h2>
			<button onclick={closeSettingsSection}
				class="flex items-center justify-center w-11 h-11 rounded-full bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
				aria-label="Close">
				<X class="w-5 h-5" />
			</button>
		</div>
		<div class="flex-1 overflow-y-auto px-4 pb-4">
			<SettingsPanel {activeFamily} {activeLabel} {isRoamingWallet} {onRefresh} {onMessage} {appDialog} {section} />
		</div>
	</div>
{/if}
