<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api, ApiError, relativeTime, type Token, type CreatedToken } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table/index.js';

	import PlusIcon from '@lucide/svelte/icons/plus';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';

	let tokens = $state<Token[]>([]);
	let loading = $state(true);
	let newName = $state('');
	let creating = $state(false);
	let reveal = $state<CreatedToken | null>(null);
	let copiedNew = $state(false);

	onMount(load);

	async function load() {
		loading = true;
		try {
			tokens = await api.tokens.list();
		} finally {
			loading = false;
		}
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (creating || !newName.trim()) return;
		creating = true;
		try {
			const created = await api.tokens.create(newName.trim());
			reveal = created;
			newName = '';
			await load();
			toast.success('Token created');
		} catch (err) {
			if (err instanceof ApiError) toast.error(err.message);
			else toast.error('Could not create token');
		} finally {
			creating = false;
		}
	}

	async function remove(id: number, name: string) {
		try {
			await api.tokens.remove(id);
			await load();
			toast.success(`Token “${name}” revoked`);
		} catch (err) {
			if (err instanceof ApiError) toast.error(err.message);
			else toast.error('Could not revoke token');
		}
	}

	async function copyNewToken() {
		if (!reveal) return;
		try {
			await navigator.clipboard.writeText(reveal.token);
			copiedNew = true;
			setTimeout(() => (copiedNew = false), 2000);
		} catch {
			toast.error('Could not copy');
		}
	}
</script>

<svelte:head><title>Tokens · NashGit</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Deploy tokens</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Tokens authenticate git push/pull — use any username and the token as the password
		</p>
	</div>

	<!-- Create form -->
	<Card class="border-border/60">
		<CardHeader>
			<CardTitle class="text-base">Create token</CardTitle>
			<CardDescription>Generate a new deploy token for git authentication</CardDescription>
		</CardHeader>
		<CardContent>
			<form onsubmit={create} class="flex flex-wrap items-end gap-3">
				<div class="flex-1 space-y-2">
					<Label for="tname">Token name</Label>
					<Input
						id="tname"
						bind:value={newName}
						placeholder="e.g. laptop, ci-runner, work-pc"
						autocomplete="off"
						required
					/>
				</div>
				<Button type="submit" disabled={creating || !newName.trim()}>
					{#if creating}
						<Loader2Icon class="size-4 animate-spin" />
						Generating…
					{:else}
						<PlusIcon class="size-4" />
						Generate
					{/if}
				</Button>
			</form>
		</CardContent>
	</Card>

	<!-- Token list -->
	{#if loading}
		<div class="space-y-2">
			{#each Array(2) as _}
				<div class="h-16 animate-pulse rounded-lg bg-muted/40"></div>
			{/each}
		</div>
	{:else if tokens.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<KeyRoundIcon class="size-6 text-muted-foreground" />
			</div>
			<div>
				<p class="font-medium">No tokens yet</p>
				<p class="mt-1 text-sm text-muted-foreground">Create a token to start pushing to your repositories</p>
			</div>
		</div>
	{:else}
		<div class="overflow-hidden rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow class="hover:bg-transparent">
						<TableHead>Name</TableHead>
						<TableHead>Prefix</TableHead>
						<TableHead>Last used</TableHead>
						<TableHead>Created</TableHead>
						<TableHead class="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each tokens as t (t.id)}
						<TableRow>
							<TableCell class="font-medium">{t.name}</TableCell>
							<TableCell>
								<code class="font-mono text-xs text-muted-foreground">{t.prefix}…</code>
							</TableCell>
							<TableCell>
								<Badge variant="secondary" class="text-xs">{relativeTime(t.last_used_at)}</Badge>
							</TableCell>
							<TableCell class="text-xs text-muted-foreground">{relativeTime(t.created_at)}</TableCell>
							<TableCell class="text-right">
								<Button
									variant="ghost"
									size="icon-sm"
									onclick={() => remove(t.id, t.name)}
									aria-label={`Revoke ${t.name}`}
									class="text-muted-foreground hover:text-destructive"
								>
									<Trash2Icon class="size-4" />
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</div>
	{/if}
</div>

<!-- Reveal-once modal -->
{#if reveal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
		<Card class="w-full max-w-lg border-primary/30">
			<CardHeader>
				<div class="flex items-center gap-2">
					<ShieldCheckIcon class="size-5 text-primary" />
					<CardTitle class="text-base">Token created</CardTitle>
				</div>
				<CardDescription>
					Copy this token now — you will not be able to see it again.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-stretch gap-2">
					<div class="flex flex-1 items-center rounded-lg border border-input bg-input/30 px-3 py-2.5">
						<code class="flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-primary">
							{reveal.token}
						</code>
					</div>
					<Button onclick={copyNewToken} variant="secondary">
						{#if copiedNew}
							<CheckIcon class="size-4 text-primary" />
						{:else}
							<CopyIcon class="size-4" />
						{/if}
					</Button>
				</div>

				<div class="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
					<div class="mb-1.5 flex items-center gap-1.5 font-medium">
						<TriangleAlertIcon class="size-3.5 text-primary" />
						How to use it
					</div>
					<p class="text-xs text-muted-foreground">
						When git asks for a password during push/pull, paste this token.
						The username can be anything. Example:
					</p>
					<pre class="mt-2 overflow-x-auto rounded-md bg-background px-2.5 py-1.5 font-mono text-xs">git clone http://nas.local/git/repo.git
# Username: x
# Password: {reveal.token.slice(0, 12)}…</pre>
				</div>

				<div class="flex justify-end">
					<Button onclick={() => { reveal = null; copiedNew = false; }}>
						I've saved it
					</Button>
				</div>
			</CardContent>
		</Card>
	</div>
{/if}
