<script lang="ts">
	import { onMount } from 'svelte';
	import { api, formatBytes, relativeTime, type Repo } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table/index.js';

	import PlusIcon from '@lucide/svelte/icons/plus';
	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';

	let repos = $state<Repo[]>([]);
	let loading = $state(true);
	let query = $state('');

	onMount(async () => {
		try {
			repos = await api.repos.list();
		} finally {
			loading = false;
		}
	});

	const filtered = $derived(
		query.trim()
			? repos.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
			: repos
	);
</script>

<svelte:head><title>Repositories · NashGit</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Repositories</h1>
			<p class="mt-1 text-sm text-muted-foreground">{repos.length} backup target{repos.length === 1 ? '' : 's'}</p>
		</div>
		<Button href="/repos/new">
			<PlusIcon class="size-4" />
			New repository
		</Button>
	</div>

	<!-- Search -->
	<div class="relative max-w-sm">
		<SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
		<input
			bind:value={query}
			placeholder="Filter repositories…"
			class="h-9 w-full rounded-lg border border-input bg-input/30 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-input/50"
		/>
	</div>

	{#if loading}
		<div class="space-y-2">
			{#each Array(4) as _}
				<div class="h-14 animate-pulse rounded-lg bg-muted/40"></div>
			{/each}
		</div>
	{:else if filtered.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<FolderGit2Icon class="size-6 text-muted-foreground" />
			</div>
			<div>
				<p class="font-medium">{query ? 'No matching repositories' : 'No repositories yet'}</p>
				<p class="mt-1 text-sm text-muted-foreground">
					{query ? 'Try a different search term' : 'Create your first backup repository to get started'}
				</p>
			</div>
			{#if !query}
				<Button href="/repos/new" variant="secondary" size="sm">
					<PlusIcon class="size-4" />
					New repository
				</Button>
			{/if}
		</div>
	{:else}
		<div class="overflow-hidden rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow class="hover:bg-transparent">
						<TableHead class="w-[40%]">Name</TableHead>
						<TableHead>Branches</TableHead>
						<TableHead>Size</TableHead>
						<TableHead>Last push</TableHead>
						<TableHead class="text-right">Clone URL</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each filtered as repo (repo.name)}
						<TableRow class="group">
							<TableCell>
								<a href="/repos/{repo.name}" class="flex items-center gap-3">
									<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
										<FolderGit2Icon class="size-4" />
									</div>
									<div class="min-w-0">
										<p class="truncate font-mono text-sm font-medium hover:text-primary">{repo.name}</p>
										{#if repo.description}
											<p class="truncate text-xs text-muted-foreground">{repo.description}</p>
										{/if}
									</div>
								</a>
							</TableCell>
							<TableCell>
								<span class="flex items-center gap-1.5 text-sm text-muted-foreground">
									<GitBranchIcon class="size-3.5" />
									{repo.branches}
								</span>
							</TableCell>
							<TableCell class="text-sm text-muted-foreground">{formatBytes(repo.sizeBytes)}</TableCell>
							<TableCell>
								<Badge variant="secondary" class="text-xs">{relativeTime(repo.last_push_at)}</Badge>
							</TableCell>
							<TableCell class="text-right">
								<code class="hidden font-mono text-xs text-muted-foreground lg:inline-block">
									{repo.clone_url.length > 40 ? repo.clone_url.slice(0, 37) + '…' : repo.clone_url}
								</code>
								<a href="/repos/{repo.name}" class="ml-2 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
									open →
								</a>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</div>
	{/if}
</div>
