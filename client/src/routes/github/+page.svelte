<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { api, relativeTime, shortHash, type GitHubLink, type GitHubPreview, type GitHubRepo, type GitHubStatus, type Repo } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import GitCompareArrowsIcon from '@lucide/svelte/icons/git-compare-arrows';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import LockKeyholeIcon from '@lucide/svelte/icons/lock-keyhole';
	import Globe2Icon from '@lucide/svelte/icons/globe-2';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import UnplugIcon from '@lucide/svelte/icons/unplug';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';

	let status = $state<GitHubStatus | null>(null);
	let repos = $state<Repo[]>([]);
	let links = $state<GitHubLink[]>([]);
	let available = $state<GitHubRepo[]>([]);
	let selected = $state('');
	let targetRepo = $state('');
	let preview = $state<GitHubPreview | null>(null);
	let previewError = $state('');
	let pageError = $state('');
	let query = $state('');
	let loading = $state(true);
	let checking = $state(false);
	let linking = $state(false);
	let syncing = $state(false);
	let acknowledgePublic = $state(false);
	let showCreate = $state(false);
	let createName = $state('');
	let createDescription = $state('');
	let creating = $state(false);

	const chosen = $derived(repos.find((repo) => repo.name === selected) ?? null);
	const chosenLink = $derived(links.find((link) => link.repoName === selected) ?? null);
	const filtered = $derived(repos.filter((repo) => repo.name.toLowerCase().includes(query.trim().toLowerCase())));
	const linkedCount = $derived(links.filter((link) => repos.some((repo) => repo.name === link.repoName)).length);
	const suggestions = $derived(available.filter((item) => item.canPush && !item.isArchived &&
		(!targetRepo || item.nameWithOwner.toLowerCase().includes(targetRepo.toLowerCase()))).slice(0, 5));

	async function load() {
		loading = true;
		pageError = '';
		try {
			status = await api.github.status();
			if (!status.enabled) return;
			[repos, links] = await Promise.all([api.repos.list(), api.github.links()]);
			if (status.connected) {
				try { available = await api.github.available(); }
				catch { available = []; }
			}
			const requested = page.url.searchParams.get('repo');
			if (requested && repos.some((repo) => repo.name === requested)) selected = requested;
			else if (!repos.some((repo) => repo.name === selected)) selected = repos[0]?.name ?? '';
			await selectRepo(selected);
		} catch (cause) {
			pageError = cause instanceof Error ? cause.message : 'Could not load GitHub connection';
		} finally { loading = false; }
	}

	async function selectRepo(name: string) {
		selected = name;
		preview = null;
		previewError = '';
		acknowledgePublic = false;
		showCreate = false;
		createName = name;
		createDescription = repos.find((repo) => repo.name === name)?.description ?? '';
		const link = links.find((item) => item.repoName === name);
		const match = available.find((item) => item.nameWithOwner.split('/')[1]?.toLowerCase() === name.toLowerCase() && item.canPush && !item.isArchived);
		targetRepo = link?.githubRepo ?? match?.nameWithOwner ?? '';
		if (link && status?.connected) await refreshPreview(name);
	}

	async function refreshPreview(name = selected) {
		checking = true;
		preview = null;
		previewError = '';
		try { const result = await api.github.preview(name); if (selected === name) preview = result; }
		catch (cause) { if (selected === name) previewError = cause instanceof Error ? cause.message : 'Could not compare branches'; }
		finally { if (selected === name) checking = false; }
	}

	async function linkRepo() {
		if (!selected || !targetRepo.trim()) return;
		linking = true;
		try {
			const link = await api.github.link(selected, targetRepo.trim());
			links = [...links.filter((item) => item.repoName !== selected), link];
			targetRepo = link.githubRepo;
			toast.success(`Linked ${selected} to ${link.githubRepo}`);
			await refreshPreview();
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not link repository'); }
		finally { linking = false; }
	}

	async function unlinkRepo() {
		if (!selected) return;
		try {
			await api.github.unlink(selected);
			links = links.filter((item) => item.repoName !== selected);
			preview = null;
			previewError = '';
			toast.success('GitHub link removed');
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not remove link'); }
	}

	async function createRepo() {
		if (!selected || !createName.trim()) return;
		creating = true;
		try {
			const result = await api.github.createPrivate(selected, createName.trim(), createDescription.trim());
			links = [...links.filter((item) => item.repoName !== selected), result.link];
			available = [result.repo, ...available];
			targetRepo = result.repo.nameWithOwner;
			showCreate = false;
			toast.success(`Private GitHub repository ${result.repo.nameWithOwner} created`);
			await refreshPreview();
		} catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Could not create GitHub repository'); }
		finally { creating = false; }
	}

	async function syncRepo() {
		if (!preview || !selected || !['ready', 'new-branch'].includes(preview.state)) return;
		syncing = true;
		try {
			preview = await api.github.sync(selected, preview.localHash, preview.remoteHash, acknowledgePublic);
			links = await api.github.links();
			toast.success(`${selected} is up to date on GitHub`);
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'GitHub sync failed');
			await refreshPreview();
		} finally { syncing = false; }
	}

	onMount(load);
</script>

<svelte:head><title>Github · NashGit</title></svelte:head>

<div class="space-y-7">
	<header class="flex flex-wrap items-end justify-between gap-5">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Github</h1>
			<p class="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Choose which NashGit backups also live on GitHub. Review each branch before sending it.</p>
		</div>
		<button onclick={load} disabled={loading || syncing} class="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"><RefreshCwIcon class={loading ? 'size-4 animate-spin' : 'size-4'} /> Refresh</button>
	</header>

	{#if pageError}
		<div role="alert" class="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><CircleAlertIcon class="mt-0.5 size-5 shrink-0 text-amber-300" /><div><p class="font-medium">GitHub connection is unavailable</p><p class="mt-1 text-muted-foreground">{pageError}</p></div></div>
	{:else}
		<section class="grid gap-4 border-y border-border py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" aria-label="GitHub connection">
			<div class="flex min-w-0 items-center gap-4">
				<div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background"><GitCompareArrowsIcon class="size-6" /></div>
				<div class="min-w-0">
					<p class="font-semibold">{loading ? 'Checking GitHub…' : status && !status.enabled ? 'Local GitHub connection' : status?.connected ? `Connected as @${status.account?.login}` : 'Connect this machine to GitHub'}</p>
					<p class="mt-0.5 text-xs leading-5 text-muted-foreground">{status?.connected ? `${linkedCount} of ${repos.length} NashGit repositories linked` : 'NashGit uses the GitHub CLI login on the machine running its server.'}</p>
				</div>
			</div>
			{#if status?.connected}<span class="inline-flex items-center gap-1.5 text-xs text-emerald-300"><CircleCheckIcon class="size-4" /> Account ready</span>{:else if !loading}<span class="inline-flex items-center gap-1.5 text-xs text-amber-300"><CircleAlertIcon class="size-4" /> {status?.enabled ? 'Login needed' : 'Local only'}</span>{/if}
		</section>

		{#if !loading && status && !status.enabled}
			<section class="max-w-2xl rounded-xl border border-border bg-card p-5"><h2 class="text-lg font-semibold">Local GitHub connection</h2><p class="mt-2 text-sm leading-6 text-muted-foreground">{status.message}</p><p class="mt-3 text-sm leading-6 text-muted-foreground">Open the local NashGit development app to link repositories and preview syncs. The NAS cannot read a visitor's computer credentials.</p></section>
		{:else if !loading && !status?.connected}
			<section class="max-w-2xl rounded-xl border border-border bg-card p-5">
				<h2 class="text-lg font-semibold">Use your existing GitHub login</h2>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">Run this on the same machine as the local NashGit server, then refresh this page. Your token stays with GitHub CLI and is never entered into NashGit.</p>
				<code class="mt-4 block rounded-lg bg-background px-4 py-3 font-mono text-sm text-foreground">gh auth login -h github.com</code>
				<p class="mt-3 text-xs text-muted-foreground">{status?.message ?? 'The connection could not be checked.'}</p>
			</section>
		{:else if loading}
			<div class="grid gap-5 lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.15fr)]"><div class="h-80 animate-pulse rounded-xl bg-muted/50"></div><div class="h-80 animate-pulse rounded-xl bg-muted/50"></div></div>
		{:else if repos.length === 0}
			<div class="rounded-xl border border-dashed border-border px-6 py-12"><h2 class="text-lg font-semibold">No NashGit repositories yet</h2><p class="mt-1 text-sm text-muted-foreground">Create a backup repository first. It will appear here when you are ready to link GitHub.</p><Button href="/repos/new" class="mt-5">Create repository</Button></div>
		{:else}
			<div class="grid min-h-[31rem] gap-6 lg:grid-cols-[minmax(16rem,0.83fr)_minmax(0,1.17fr)]">
				<section class="min-w-0" aria-labelledby="local-repos-heading">
					<div class="mb-3 flex items-center justify-between gap-3"><h2 id="local-repos-heading" class="text-lg font-semibold">Your repositories</h2><span class="text-xs tabular-nums text-muted-foreground">{linkedCount} linked</span></div>
					<label class="relative mb-3 block"><SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span class="sr-only">Find a repository</span><input bind:value={query} placeholder="Find a repository" class="h-10 w-full rounded-lg border border-input bg-input/30 pl-9 pr-3 text-sm outline-none focus:border-ring" /></label>
					<div class="overflow-hidden rounded-xl border border-border bg-card">
						{#each filtered as repo (repo.name)}
							{@const link = links.find((item) => item.repoName === repo.name)}
							<button onclick={() => selectRepo(repo.name)} aria-current={selected === repo.name ? 'true' : undefined} class="flex w-full min-w-0 items-center gap-3 border-b border-border px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/50 {selected === repo.name ? 'bg-primary/10' : ''}">
								<span class="flex size-9 shrink-0 items-center justify-center rounded-lg {link ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}"><Link2Icon class="size-4" /></span>
								<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{repo.name}</span><span class="mt-0.5 block truncate text-xs text-muted-foreground">{link?.githubRepo ?? repo.latestCommit?.subject ?? 'No commits yet'}</span></span>
								{#if link}<span class="size-2 shrink-0 rounded-full bg-emerald-400" title="Linked"></span>{/if}
							</button>
						{:else}<p class="px-4 py-8 text-center text-sm text-muted-foreground">No matching repositories</p>{/each}
					</div>
				</section>

				<section class="min-w-0" aria-labelledby="sync-heading">
					<div class="mb-3 flex items-center justify-between gap-3"><h2 id="sync-heading" class="text-lg font-semibold">GitHub sync</h2>{#if chosen}<a href="/repos/{chosen.name}" class="text-xs text-primary hover:underline">View NashGit repo →</a>{/if}</div>
					<div class="overflow-hidden rounded-xl border border-border bg-card">
						<div class="border-b border-border p-5">
							<div class="flex flex-wrap items-center gap-3 text-sm"><span class="font-semibold">{chosen?.name}</span><ArrowRightIcon class="size-4 text-primary" /><span class="font-semibold">{chosenLink?.githubRepo ?? 'Choose a GitHub repository'}</span></div>
							<p class="mt-2 text-xs leading-5 text-muted-foreground">NashGit remains your private backup. This connection updates one matching branch on GitHub when you choose to push.</p>
						</div>

						{#if !chosenLink}
							<div class="p-5"><h3 class="font-semibold">Link a GitHub repository</h3><p class="mt-1 text-sm text-muted-foreground">Choose an existing destination. Names that match your NashGit repo are suggested.</p>
								<label for="github-target" class="mt-5 block text-xs font-medium text-muted-foreground">GitHub owner / repository</label>
								<input id="github-target" list="github-repos" bind:value={targetRepo} placeholder="owner/repository" autocomplete="off" class="mt-2 h-10 w-full rounded-lg border border-input bg-input/30 px-3 text-sm outline-none focus:border-ring" />
								<datalist id="github-repos">{#each available.filter((item) => item.canPush && !item.isArchived) as item (item.nameWithOwner)}<option value={item.nameWithOwner}></option>{/each}</datalist>
								{#if suggestions.length}<div class="mt-3 overflow-hidden rounded-lg border border-border"><p class="border-b border-border px-3 py-2 text-xs text-muted-foreground">Suggested destinations</p>{#each suggestions as item (item.nameWithOwner)}<button onclick={() => (targetRepo = item.nameWithOwner)} class="flex w-full items-center justify-between gap-2 border-b border-border/70 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted/50"><span class="min-w-0 truncate">{item.nameWithOwner}</span><span class="shrink-0 text-muted-foreground">{item.isPrivate ? 'Private' : 'Public'}</span></button>{/each}</div>{/if}
								<p class="mt-2 text-xs text-muted-foreground">Only repositories you can push to can be linked. This does not change either repository yet.</p>
								{#if (chosen?.audit_summary?.highRisk ?? 0) > 0}<a href="/repos/{chosen?.name}/audit" class="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-300 hover:underline"><CircleAlertIcon class="size-3.5" /> {chosen?.audit_summary?.highRisk} high risk audit findings to review</a>{/if}
								<Button onclick={linkRepo} disabled={!targetRepo.trim() || linking || !chosen?.latestCommit} class="mt-5"><Link2Icon class="size-4" /> {linking ? 'Checking…' : 'Link repository'}</Button>
								<div class="mt-6 border-t border-border pt-5"><button onclick={() => (showCreate = !showCreate)} class="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><PlusIcon class="size-4" /> Create a private GitHub repository</button>
									{#if showCreate}<div class="mt-4 space-y-3"><p class="text-xs leading-5 text-muted-foreground">This creates an empty private repository in @{status?.account?.login}. You can review the branch before pushing it.</p><label class="block text-xs text-muted-foreground" for="github-new-name">Repository name</label><input id="github-new-name" bind:value={createName} maxlength="100" class="h-10 w-full rounded-lg border border-input bg-input/30 px-3 text-sm outline-none focus:border-ring" /><label class="block text-xs text-muted-foreground" for="github-new-description">Description</label><input id="github-new-description" bind:value={createDescription} maxlength="300" class="h-10 w-full rounded-lg border border-input bg-input/30 px-3 text-sm outline-none focus:border-ring" /><Button onclick={createRepo} disabled={creating || !createName.trim() || !chosen?.latestCommit} variant="secondary"><LockKeyholeIcon class="size-4" /> {creating ? 'Creating…' : 'Create private repository'}</Button></div>{/if}
								</div>
								{#if !chosen?.latestCommit}<p class="mt-3 text-xs text-amber-300">Push a commit to NashGit first.</p>{/if}
							</div>
						{:else}
							<div class="space-y-5 p-5">
								<div class="flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-2 text-sm"><GitCompareArrowsIcon class="size-4" /><span class="font-medium">{chosenLink.githubRepo}</span></div><button onclick={() => refreshPreview()} disabled={checking || syncing} class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"><RefreshCwIcon class={checking ? 'size-3.5 animate-spin' : 'size-3.5'} /> Check again</button></div>
								{#if checking}<div class="h-32 animate-pulse rounded-lg bg-muted/50"></div>
								{:else if previewError}<div role="alert" class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><p class="font-medium text-amber-300">Could not check this link</p><p class="mt-1 text-muted-foreground">{previewError}</p></div>
								{:else if preview}
									<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground"><span class="inline-flex items-center gap-1.5">{#if preview.github.isPrivate}<LockKeyholeIcon class="size-3.5" /> Private{:else}<Globe2Icon class="size-3.5" /> Public{/if}</span><span>Branch <strong class="font-mono font-medium text-foreground">{preview.branch}</strong></span><a href={preview.github.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-primary hover:underline">Open on GitHub <ArrowUpRightIcon class="size-3" /></a></div>
									<div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg bg-background p-4"><div class="min-w-0"><p class="text-xs text-muted-foreground">On NashGit</p><p class="mt-1 truncate font-mono text-sm font-semibold" title={preview.localHash}>{shortHash(preview.localHash)}</p></div><ArrowRightIcon class="size-5 text-primary" /><div class="min-w-0 text-right"><p class="text-xs text-muted-foreground">On GitHub</p><p class="mt-1 truncate font-mono text-sm font-semibold" title={preview.remoteHash ?? 'No branch'}>{preview.remoteHash ? shortHash(preview.remoteHash) : 'No branch yet'}</p></div></div>
									<div class="flex items-start gap-2.5 text-sm {preview.state === 'blocked' ? 'text-amber-300' : preview.state === 'current' ? 'text-emerald-300' : 'text-foreground'}">{#if preview.state === 'blocked'}<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />{:else}<CircleCheckIcon class="mt-0.5 size-4 shrink-0" />{/if}<span>{preview.reason}</span></div>
									{#if !preview.github.isPrivate && ['ready', 'new-branch'].includes(preview.state)}<label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5"><input type="checkbox" bind:checked={acknowledgePublic} class="mt-1 accent-primary" /><span>This GitHub repository is public. I want to send this branch there.</span></label>{/if}
									{#if ['ready', 'new-branch'].includes(preview.state)}<Button onclick={syncRepo} disabled={syncing || (!preview.github.isPrivate && !acknowledgePublic)} class="w-full sm:w-auto"><ArrowUpRightIcon class="size-4" /> {syncing ? 'Pushing…' : 'Push this branch to GitHub'}</Button>{/if}
								{/if}
								<div class="border-t border-border pt-4"><p class="text-xs text-muted-foreground">{chosenLink.lastSyncedAt ? `Last synced ${relativeTime(chosenLink.lastSyncedAt)} · ${shortHash(chosenLink.lastSyncedHash)}` : 'This link has not synced yet.'}</p><button onclick={unlinkRepo} disabled={syncing} class="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"><UnplugIcon class="size-3.5" /> Remove link</button></div>
							</div>
						{/if}
					</div>
				</section>
			</div>
		{/if}
	{/if}
</div>
