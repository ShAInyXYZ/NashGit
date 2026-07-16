<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { api, ApiError, formatBytes, relativeTime, shortHash, type Repo, type PushLogEntry } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';

	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import HistoryIcon from '@lucide/svelte/icons/history';

	const name = $derived(page.params.name);

	let repo = $state<Repo | null>(null);
	let log = $state<PushLogEntry[]>([]);
	let loading = $state(true);
	let copied = $state(false);
	let confirmDelete = $state(false);
	let deleting = $state(false);

	async function load() {
		if (!name) {
			await goto('/repos');
			return;
		}
		loading = true;
		try {
			[repo, log] = await Promise.all([
				api.repos.get(name),
				api.repos.log(name)
			]);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				toast.error('Repository not found');
				await goto('/repos');
			}
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function copyUrl() {
		if (!repo) return;
		try {
			await navigator.clipboard.writeText(repo.clone_url);
			copied = true;
			toast.success('Clone URL copied');
			setTimeout(() => (copied = false), 2000);
		} catch {
			toast.error('Could not copy');
		}
	}

	async function remove() {
		if (!repo || deleting) return;
		deleting = true;
		try {
			await api.repos.remove(repo.name);
			toast.success(`Repository “${repo.name}” deleted`);
			await goto('/repos');
		} catch (err) {
			if (err instanceof ApiError) toast.error(err.message);
			else toast.error('Could not delete repository');
		} finally {
			deleting = false;
			confirmDelete = false;
		}
	}
</script>

<svelte:head><title>{name} · NashGit</title></svelte:head>

{#if loading}
	<div class="space-y-6">
		<div class="h-7 w-48 animate-pulse rounded bg-muted/40"></div>
		<div class="h-40 animate-pulse rounded-lg bg-muted/40"></div>
		<div class="h-64 animate-pulse rounded-lg bg-muted/40"></div>
	</div>
{:else if repo}
	<div class="space-y-6">
		<!-- Header -->
		<div>
			<a href="/repos" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeftIcon class="size-3.5" />
				Repositories
			</a>
			<div class="mt-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 class="font-mono text-2xl font-semibold tracking-tight">{repo.name}</h1>
					{#if repo.description}
						<p class="mt-1 text-sm text-muted-foreground">{repo.description}</p>
					{/if}
				</div>
				<Button
					variant="destructive"
					size="sm"
					onclick={() => (confirmDelete = true)}
				>
					<Trash2Icon class="size-4" />
					Delete
				</Button>
			</div>
		</div>

		<!-- Stats row -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#each [
				{ label: 'Branches', value: repo.branches, icon: GitBranchIcon },
				{ label: 'Size', value: formatBytes(repo.sizeBytes), icon: HardDriveIcon },
				{ label: 'Default branch', value: repo.defaultBranch ?? '—', mono: true, icon: GitBranchIcon },
				{ label: 'Last push', value: relativeTime(repo.last_push_at), icon: GitCommitHorizontalIcon }
			] as stat (stat.label)}
				<Card class="border-border/60">
					<CardContent class="p-4">
						<div class="flex items-center gap-2 text-xs text-muted-foreground">
							<stat.icon class="size-3.5" />
							{stat.label}
						</div>
						<p class="mt-1.5 text-sm font-medium {stat.mono ? 'font-mono' : ''}">{stat.value}</p>
					</CardContent>
				</Card>
			{/each}
		</div>

		<!-- Clone URL -->
		<Card class="border-border/60">
			<CardHeader>
				<CardTitle class="text-base">Clone URL</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="flex items-stretch gap-2">
					<div class="flex flex-1 items-center rounded-lg border border-input bg-input/30 px-3">
						<code class="flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-foreground">
							{repo.clone_url}
						</code>
					</div>
					<Button onclick={copyUrl} variant="secondary">
						{#if copied}
							<CheckIcon class="size-4 text-primary" />
						{:else}
							<CopyIcon class="size-4" />
						{/if}
						{copied ? 'Copied' : 'Copy'}
					</Button>
				</div>
				<p class="mt-3 text-xs text-muted-foreground">
					Authenticate with a deploy token — use any username and the token as the password.
				</p>
			</CardContent>
		</Card>

		<!-- Push history -->
		<Card class="border-border/60">
			<CardHeader class="flex flex-row items-center gap-2">
				<HistoryIcon class="size-4 text-muted-foreground" />
				<CardTitle class="text-base">Push history</CardTitle>
			</CardHeader>
			<CardContent>
				{#if log.length === 0}
					<div class="flex flex-col items-center gap-2 py-8 text-center">
						<GitCommitHorizontalIcon class="size-8 text-muted-foreground/50" />
						<p class="text-sm text-muted-foreground">No pushes recorded yet</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow class="hover:bg-transparent">
									<TableHead>Commit</TableHead>
									<TableHead>Pushed by</TableHead>
									<TableHead class="text-right">When</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{#each log as entry (entry.id)}
									<TableRow>
										<TableCell>
											<div class="flex items-center gap-2 font-mono text-xs">
												{#if entry.from_hash}
													<span class="text-muted-foreground">{shortHash(entry.from_hash)}</span>
													<span class="text-muted-foreground/50">→</span>
												{/if}
												<span class="text-primary">{shortHash(entry.to_hash)}</span>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant="secondary" class="font-mono text-xs">
												{entry.pushed_by ?? 'unknown'}
											</Badge>
										</TableCell>
										<TableCell class="text-right text-xs text-muted-foreground">
											{relativeTime(entry.pushed_at)}
										</TableCell>
									</TableRow>
								{/each}
							</TableBody>
						</Table>
					</div>
				{/if}
			</CardContent>
		</Card>
	</div>
{/if}

<!-- Delete confirmation -->
{#if confirmDelete && repo}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
		<Card class="w-full max-w-md border-destructive/30">
			<CardHeader>
				<CardTitle class="text-base text-destructive">Delete repository?</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm text-muted-foreground">
					This will permanently delete <span class="font-mono text-foreground">{repo.name}</span>
					and all of its git history from the NAS. This cannot be undone.
				</p>
				<Separator />
				<div class="flex justify-end gap-2">
					<Button variant="ghost" onclick={() => (confirmDelete = false)} disabled={deleting}>
						Cancel
					</Button>
					<Button variant="destructive" onclick={remove} disabled={deleting}>
						{#if deleting}
							<Loader2Icon class="size-4 animate-spin" />
							Deleting…
						{:else}
							<Trash2Icon class="size-4" />
							Delete permanently
						{/if}
					</Button>
				</div>
			</CardContent>
		</Card>
	</div>
{/if}
