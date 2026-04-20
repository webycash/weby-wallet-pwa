<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import Button from '$lib/components/ui/button/button.svelte';

	type DialogState = {
		open: boolean;
		title: string;
		description: string;
		inputLabel?: string;
		inputPlaceholder?: string;
		inputValue: string;
		confirmLabel: string;
		cancelLabel: string;
		danger: boolean;
		resolve: ((value: string | boolean | null) => void) | null;
	};

	let state = $state<DialogState>({
		open: false,
		title: '',
		description: '',
		inputValue: '',
		confirmLabel: 'OK',
		cancelLabel: 'Cancel',
		danger: false,
		resolve: null,
	});

	const close = (result: string | boolean | null) => {
		state.open = false;
		state.resolve?.(result);
		state.resolve = null;
	};

	export const prompt = (title: string, opts: { description?: string; placeholder?: string; label?: string } = {}): Promise<string | null> => {
		return new Promise((resolve) => {
			state = {
				open: true,
				title,
				description: opts.description ?? '',
				inputLabel: opts.label,
				inputPlaceholder: opts.placeholder ?? '',
				inputValue: '',
				confirmLabel: 'Create',
				cancelLabel: 'Cancel',
				danger: false,
				resolve: (v) => resolve(typeof v === 'string' ? v : null),
			};
		});
	};

	export const confirm = (title: string, opts: { description?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> => {
		return new Promise((resolve) => {
			state = {
				open: true,
				title,
				description: opts.description ?? '',
				inputValue: '',
				confirmLabel: opts.confirmLabel ?? 'Confirm',
				cancelLabel: 'Cancel',
				danger: opts.danger ?? false,
				resolve: (v) => resolve(v === true),
			};
		});
	};
</script>

<Dialog.Root bind:open={state.open} onOpenChange={(o) => { if (!o) close(null); }}>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content class="max-w-sm">
			<Dialog.Header>
				<Dialog.Title>{state.title}</Dialog.Title>
				{#if state.description}
					<Dialog.Description>{state.description}</Dialog.Description>
				{/if}
			</Dialog.Header>

			{#if state.inputLabel !== undefined}
				<form onsubmit={(e) => { e.preventDefault(); if (state.inputValue.trim()) close(state.inputValue.trim()); }}
					class="mt-2">
					{#if state.inputLabel}
						<label class="text-xs font-medium text-muted-foreground mb-1.5 block">{state.inputLabel}</label>
					{/if}
					<input
						type="text"
						bind:value={state.inputValue}
						placeholder={state.inputPlaceholder}
						class="w-full rounded-xl border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
						autofocus
					/>
				</form>
			{/if}

			<Dialog.Footer class="mt-4 flex gap-2">
				<Button variant="outline" class="flex-1" onclick={() => close(state.inputLabel !== undefined ? null : false)}>
					{state.cancelLabel}
				</Button>
				<Button
					class="flex-1 {state.danger ? 'bg-danger hover:bg-danger/90 text-danger-foreground' : ''}"
					onclick={() => {
						if (state.inputLabel !== undefined) {
							if (state.inputValue.trim()) close(state.inputValue.trim());
						} else {
							close(true);
						}
					}}
					disabled={state.inputLabel !== undefined && !state.inputValue.trim()}
				>
					{state.confirmLabel}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
