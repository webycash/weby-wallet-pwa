<script lang="ts">
	// Generic rail-action form — the DashboardView visual language generalised to
	// data. A value-moving rail op (Send / Issue / Transfer / Redeem) is exactly
	// its input fields + a submit; this renders them from a `fields` data array
	// and surfaces the {@link RailOutcome} honestly:
	//
	//   * pending → a clean "via extro-node (pending)" banner (NOT a fake success).
	//   * error   → the real error message.
	//   * ok      → a caller-formatted success line.
	//
	// Pure presentational shell: it owns local field state + busy flag only; the
	// dispatch is the caller's `onSubmit`, which returns the outcome to render.
	import { untrack, type Component } from 'svelte';
	import Loader from '$lib/components/ui/Loader.svelte';
	import type { RailOutcome } from '$lib/extro/rail';

	export interface RailField {
		readonly key: string;
		readonly label: string;
		readonly placeholder?: string;
		/** `text` (default), `number`, or `select`. Values pass through as strings. */
		readonly type?: 'text' | 'number' | 'select';
		readonly mono?: boolean;
		/** Options for a `select` field (`value` is what onSubmit receives). */
		readonly options?: readonly { readonly value: string; readonly label: string }[];
	}

	let {
		icon,
		title,
		fields,
		submitLabel,
		onSubmit,
		formatOk
	}: {
		icon: Component;
		title: string;
		fields: readonly RailField[];
		submitLabel: string;
		/** Dispatch the rail op with the entered values; return its outcome. */
		onSubmit: (values: Record<string, string>) => Promise<RailOutcome<unknown>>;
		/** Render the success body for an `ok` outcome. */
		formatOk: (value: unknown) => string;
	} = $props();

	const Icon = $derived(icon);
	// Seed select fields with their first option so the field is never empty.
	// `fields` is a fixed prop for a form instance; capturing its initial value here
	// is intentional.
	const seedValues = (fs: readonly RailField[]): Record<string, string> => {
		const seed: Record<string, string> = {};
		for (const f of fs) if (f.type === 'select' && f.options?.length) seed[f.key] = f.options[0].value;
		return seed;
	};
	let values = $state<Record<string, string>>(untrack(() => seedValues(fields)));
	let busy = $state(false);
	let result = $state<RailOutcome<unknown> | null>(null);

	const canSubmit = $derived(fields.every((f) => (values[f.key] ?? '').trim().length > 0));

	const submit = async () => {
		if (busy || !canSubmit) return;
		busy = true;
		result = null;
		try {
			result = await onSubmit({ ...values });
		} finally {
			busy = false;
		}
	};
</script>

<div class="animate-fade-in max-w-sm mx-auto w-full pt-4 space-y-3">
	<div class="flex items-center justify-center gap-2 text-muted-foreground">
		<Icon class="w-[18px] h-[18px]" />
		<p class="text-[15px] font-medium text-foreground">{title}</p>
	</div>

	{#each fields as field (field.key)}
		{#if field.type === 'select'}
			<select
				bind:value={values[field.key]}
				aria-label={field.label}
				class="w-full rounded-full border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
				disabled={busy}>
				{#each field.options ?? [] as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		{:else}
			<input
				type={field.type === 'number' ? 'number' : 'text'}
				bind:value={values[field.key]}
				placeholder={field.placeholder ?? field.label}
				aria-label={field.label}
				class="w-full rounded-full border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all {field.mono ? 'font-mono' : ''}"
				spellcheck="false"
				autocomplete="off"
				disabled={busy}
			/>
		{/if}
	{/each}

	<button
		onclick={submit}
		disabled={busy || !canSubmit}
		class="w-full h-14 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2 text-[15px] font-medium transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100">
		{#if busy}<Loader />{:else}{submitLabel}{/if}
	</button>

	{#if result?.state === 'ok'}
		<div class="rounded-3xl bg-primary/5 px-5 py-5 text-center">
			<p class="text-[13px] text-foreground break-all leading-relaxed tabular-nums">{formatOk(result.value)}</p>
		</div>
	{:else if result?.state === 'pending'}
		<div class="rounded-3xl bg-muted/40 px-6 py-8 text-center">
			<p class="text-[13px] text-muted-foreground leading-relaxed mb-4">
				This operation is wired to extro-node but not yet live in this build — it is native-only until the rail pkg lands.
			</p>
			<span class="inline-block rounded-full bg-background px-4 py-1.5 text-[11px] font-medium text-muted-foreground tracking-wide">
				via extro-node · pending
			</span>
		</div>
	{:else if result?.state === 'error'}
		<div class="rounded-3xl bg-destructive/5 px-6 py-6 text-center">
			<p class="text-[13px] text-destructive leading-relaxed break-all">{result.message}</p>
		</div>
	{/if}
</div>
