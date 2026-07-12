<script lang="ts">
	import { onMount } from 'svelte';
	import { api, formatBytes, relativeTime, type Repo } from '$lib/api';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';

	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';

	let repos = $state<Repo[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			repos = await api.repos.list();
		} finally {
			loading = false;
		}
	});

	const totalSize = $derived(repos.reduce((sum, r) => sum + r.sizeBytes, 0));
	const recentPushes = $derived(
		repos
			.filter((r) => r.last_push_at)
			.sort((a, b) => (b.last_push_at! > a.last_push_at! ? 1 : -1))
			.slice(0, 5)
	);
</script>

<svelte:head><title>Dashboard · NashGit</title></svelte:head>

<div class="space-y-8">
	<!-- Header -->
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
			<p class="mt-1 text-sm text-muted-foreground">Overview of your backup repositories</p>
		</div>
		<Button href="/repos/new">
			<PlusIcon class="size-4" />
			New repository
		</Button>
	</div>

	<!-- Stat cards -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<Card class="border-border/60">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium text-muted-foreground">Repositories</CardTitle>
				<FolderGit2Icon class="size-4 text-primary" />
			</CardHeader>
			<CardContent>
				<div class="text-3xl font-semibold">{loading ? '—' : repos.length}</div>
				<p class="mt-1 text-xs text-muted-foreground">backup targets on this NAS</p>
			</CardContent>
		</Card>

		<Card class="border-border/60">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium text-muted-foreground">Storage used</CardTitle>
				<HardDriveIcon class="size-4 text-primary" />
			</CardHeader>
			<CardContent>
				<div class="text-3xl font-semibold">{loading ? '—' : formatBytes(totalSize)}</div>
				<p class="mt-1 text-xs text-muted-foreground">across all repositories</p>
			</CardContent>
		</Card>

		<Card class="border-border/60">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium text-muted-foreground">Pushes today</CardTitle>
				<GitCommitHorizontalIcon class="size-4 text-primary" />
			</CardHeader>
			<CardContent>
				<div class="text-3xl font-semibold">
					{loading
						? '—'
						: repos.filter((r) => {
								const d = new Date(r.last_push_at!);
								const now = new Date();
								return r.last_push_at && d.toDateString() === now.toDateString();
							}).length}
				</div>
				<p class="mt-1 text-xs text-muted-foreground">repositories pushed today</p>
			</CardContent>
		</Card>
	</div>

	<!-- Recent activity + quick start -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<Card class="border-border/60">
			<CardHeader class="flex flex-row items-center justify-between">
				<CardTitle class="text-base">Recent pushes</CardTitle>
				<Button href="/repos" variant="ghost" size="sm">
					View all
					<ArrowRightIcon class="size-3.5" />
				</Button>
			</CardHeader>
			<CardContent>
				{#if loading}
					<div class="space-y-3">
						{#each Array(3) as _}
							<div class="h-12 animate-pulse rounded-lg bg-muted/40"></div>
						{/each}
					</div>
				{:else if recentPushes.length === 0}
					<div class="flex flex-col items-center gap-2 py-8 text-center">
						<CalendarClockIcon class="size-8 text-muted-foreground/50" />
						<p class="text-sm text-muted-foreground">No pushes yet</p>
						<p class="text-xs text-muted-foreground/70">Create a repo and push your first commit</p>
					</div>
				{:else}
					<div class="space-y-1">
						{#each recentPushes as repo (repo.name)}
							<a
								href="/repos/{repo.name}"
								class="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
							>
								<div class="flex min-w-0 items-center gap-3">
									<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
										<FolderGit2Icon class="size-4" />
									</div>
									<div class="min-w-0">
										<p class="truncate font-mono text-sm">{repo.name}</p>
										<p class="text-xs text-muted-foreground">{repo.branches} branches</p>
									</div>
								</div>
								<Badge variant="secondary" class="shrink-0 text-xs">
									{relativeTime(repo.last_push_at)}
								</Badge>
							</a>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Quick start card -->
		<Card class="border-border/60 bg-card/50">
			<CardHeader>
				<CardTitle class="text-base">Quick start</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4 text-sm">
				<p class="text-muted-foreground">Back up a local project to this NAS in three steps:</p>
				<ol class="space-y-3">
					<li class="flex gap-3">
						<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">1</span>
						<div>
							<p class="font-medium">Create a repository</p>
							<p class="text-xs text-muted-foreground">and a deploy token for pushing</p>
						</div>
					</li>
					<li class="flex gap-3">
						<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">2</span>
						<div>
							<p class="font-medium">Add the NAS as a remote</p>
							<pre class="mt-1 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">git remote add nas &lt;clone-url&gt;</pre>
						</div>
					</li>
					<li class="flex gap-3">
						<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">3</span>
						<div>
							<p class="font-medium">Push your work</p>
							<pre class="mt-1 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">git push nas main</pre>
						</div>
					</li>
				</ol>
				<div class="flex gap-2 pt-1">
					<Button href="/repos/new" variant="secondary" size="sm">New repo</Button>
					<Button href="/tokens" variant="ghost" size="sm">Create token</Button>
				</div>
			</CardContent>
		</Card>
	</div>
</div>
