<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { api, ApiError } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';

	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	let name = $state('');
	let description = $state('');
	let loading = $state(false);

	const valid = $derived(/^[a-z0-9][a-z0-9._-]*$/i.test(name.trim()));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (loading || !valid) return;
		loading = true;
		try {
			const repo = await api.repos.create(name.trim(), description.trim());
			toast.success(`Repository “${repo.name}” created`);
			await goto(`/repos/${repo.name}`);
		} catch (err) {
			if (err instanceof ApiError) toast.error(err.message);
			else toast.error('Could not create repository');
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>New repository · NashGit</title></svelte:head>

<div class="mx-auto max-w-xl space-y-6">
	<div>
		<a href="/repos" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
			<ArrowLeftIcon class="size-3.5" />
			Back to repositories
		</a>
		<h1 class="mt-4 text-2xl font-semibold tracking-tight">New repository</h1>
		<p class="mt-1 text-sm text-muted-foreground">Create a bare git repository to back up to</p>
	</div>

	<Card class="border-border/60">
		<CardHeader>
			<CardTitle class="text-base">Repository details</CardTitle>
			<CardDescription>This will become <code class="font-mono text-primary">/git/&lt;name&gt;.git</code> on the server</CardDescription>
		</CardHeader>
		<CardContent>
			<form onsubmit={submit} class="space-y-5">
				<div class="space-y-2">
					<Label for="name">Name</Label>
					<Input
						id="name"
						bind:value={name}
						placeholder="my-project"
						class="font-mono"
						autocomplete="off"
						required
					/>
					<p class="text-xs text-muted-foreground">
						{#if name && !valid}
							<span class="text-destructive">Letters, numbers, dot, dash, underscore only; no leading dash.</span>
						{:else}
							Used in the clone URL — choose something URL-safe.
						{/if}
					</p>
				</div>

				<div class="space-y-2">
					<Label for="desc">Description <span class="text-muted-foreground">(optional)</span></Label>
					<Input
						id="desc"
						bind:value={description}
						placeholder="What does this repo back up?"
						autocomplete="off"
					/>
				</div>

				{#if name && valid}
					<div class="rounded-lg border border-border/60 bg-muted/30 p-3">
						<p class="mb-1 text-xs font-medium text-muted-foreground">Clone URL preview</p>
						<code class="font-mono text-sm text-primary">/git/{name.trim()}.git</code>
					</div>
				{/if}

				<div class="flex justify-end gap-2 pt-2">
					<Button href="/repos" variant="ghost" type="button">Cancel</Button>
					<Button type="submit" disabled={loading || !valid}>
						{#if loading}
							<Loader2Icon class="size-4 animate-spin" />
							Creating…
						{:else}
							Create repository
						{/if}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
