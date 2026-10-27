<script lang="ts">
	import { onMount } from 'svelte';
	import { api, formatBytes, relativeTime, freshness, type Repo, type CommitDetail } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import FreshnessCherry from '$lib/components/FreshnessCherry.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';

	let repos = $state<Repo[]>([]);
	let loading = $state(true);
	let error = $state('');
	let latestChange = $state<CommitDetail | null>(null);
	let latestRepoName = $state('');

	onMount(async () => {
		try {
			repos = await api.repos.list();
			const newest = [...repos].filter((repo) => repo.latestCommit).sort((a, b) => (b.latestCommit?.authoredAt ?? '').localeCompare(a.latestCommit?.authoredAt ?? ''))[0];
			if (newest?.latestCommit) {
				latestRepoName = newest.name;
				try { latestChange = await api.repos.commit(newest.name, newest.latestCommit.hash); } catch { /* activity list remains available */ }
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load repositories';
		} finally {
			loading = false;
		}
	});

	const ordered = $derived([...repos].sort((a, b) => (b.last_push_at ?? b.latestCommit?.authoredAt ?? '').localeCompare(a.last_push_at ?? a.latestCommit?.authoredAt ?? '')));
	const totalSize = $derived(repos.reduce((sum, repo) => sum + repo.sizeBytes, 0));
	const needsAttention = $derived(repos.filter((repo) => (repo.audit_summary?.highRisk ?? 0) > 0 || repo.audit_summary?.status === 'failed' || repo.last_check_ok !== 1 || ['stale', 'withered', 'unknown'].includes(freshness(repo.last_push_at))));
	const lastPush = $derived(repos.map((repo) => repo.last_push_at).filter((value): value is string => !!value).sort().at(-1) ?? null);
</script>

<svelte:head><title>Dashboard · NashGit</title></svelte:head>

<div class="space-y-7">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Your backups</h1>
			<p class="mt-1 text-sm text-muted-foreground">See what reached your NAS and what needs a check.</p>
		</div>
		<Button href="/repos/new"><PlusIcon class="size-4" /> New repository</Button>
	</header>

	{#if error}
		<div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</div>
	{:else}
		<div class="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-5 sm:grid-cols-4" aria-label="Backup overview">
			<div><p class="text-xs text-muted-foreground">Repositories</p><p class="mt-1 text-2xl font-semibold tabular-nums">{loading ? '—' : repos.length}</p></div>
			<div><p class="text-xs text-muted-foreground">Last push</p><p class="mt-1 text-xl font-semibold">{loading ? '—' : relativeTime(lastPush)}</p></div>
			<div><p class="text-xs text-muted-foreground">Need attention</p><p class="mt-1 text-2xl font-semibold tabular-nums {needsAttention.length ? 'text-primary' : 'text-emerald-300'}">{loading ? '—' : needsAttention.length}</p></div>
			<div><p class="text-xs text-muted-foreground">Stored Git data</p><p class="mt-1 text-xl font-semibold">{loading ? '—' : formatBytes(totalSize)}</p></div>
		</div>

		<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
			<section class="min-w-0" aria-labelledby="activity-title">
				<div class="mb-3 flex items-center justify-between gap-3"><h2 id="activity-title" class="text-lg font-semibold">Repository activity</h2><a href="/repos" class="inline-flex items-center gap-1 text-sm text-primary hover:underline">All repositories <ArrowRightIcon class="size-4" /></a></div>
				{#if loading}
					<div class="space-y-1">{#each Array(4) as _}<div class="h-20 animate-pulse rounded-lg bg-muted"></div>{/each}</div>
				{:else if ordered.length === 0}
					<div class="rounded-xl border border-dashed border-border p-8"><GitCommitHorizontalIcon class="size-7 text-primary" /><h3 class="mt-3 text-lg font-semibold">No backups yet</h3><p class="mt-1 text-sm text-muted-foreground">Create a repository, add a deploy token, and push your first commit.</p><Button href="/repos/new" class="mt-4">Create repository</Button></div>
				{:else}
					<div class="overflow-hidden rounded-xl border border-border bg-card">
						{#each ordered as repo (repo.name)}
							<a href="/repos/{repo.name}" class="group grid gap-2 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/40 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1.4fr)_auto] sm:items-center">
								<div class="flex min-w-0 items-center gap-2"><FreshnessCherry state={freshness(repo.last_push_at)} size={16} /><span class="truncate font-mono text-sm font-semibold group-hover:text-primary">{repo.name}</span></div>
								<div class="min-w-0"><p class="truncate text-sm">{repo.latestCommit?.subject ?? 'No commits yet'}</p><p class="mt-0.5 truncate text-xs text-muted-foreground">{repo.latestCommit ? `${repo.latestCommit.author} · ${repo.latestCommit.hash.slice(0, 7)}` : repo.description}</p></div>
								<div class="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">{#if repo.audit_summary}<span class="rounded px-1.5 py-0.5 {repo.audit_summary.highRisk ? 'bg-orange-500/15 text-orange-300' : 'bg-muted text-muted-foreground'}">{repo.audit_summary.highRisk ? `${repo.audit_summary.highRisk} high risk` : `${repo.audit_summary.findings} findings`}</span>{/if}<span>{relativeTime(repo.last_push_at)}</span><ArrowRightIcon class="size-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" /></div>
							</a>
						{/each}
					</div>
					{#if latestChange}
						<div class="mt-6 border-t border-border pt-5">
							<div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-base font-semibold">Latest change</h3><a href="/repos/{latestRepoName}?commit={latestChange.hash}" class="text-xs text-primary hover:underline">Inspect commit →</a></div>
							<p class="mt-2 text-sm font-medium">{latestChange.subject}</p>
							<p class="mt-1 text-xs text-muted-foreground"><span class="font-mono">{latestRepoName}</span> · {latestChange.author} · {relativeTime(latestChange.authoredAt)}</p>
							<div class="mt-4 overflow-hidden rounded-lg border border-border bg-card">
								{#each latestChange.files.filter((file) => !file.path.endsWith('.meta')).slice(0, 6) as file (file.path)}
									<div class="flex min-w-0 items-center gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0"><span class="w-4 shrink-0 font-mono font-semibold {file.status === 'A' ? 'text-emerald-300' : file.status === 'D' ? 'text-rose-300' : 'text-primary'}">{file.status}</span><span class="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span><span class="shrink-0 font-mono text-emerald-300">{file.additions === null ? 'binary' : `+${file.additions}`}</span>{#if file.deletions !== null}<span class="shrink-0 font-mono text-rose-300">−{file.deletions}</span>{/if}</div>
								{/each}
								{#if latestChange.files.length > 6}<a href="/repos/{latestRepoName}?commit={latestChange.hash}" class="block px-3 py-2 text-xs text-primary hover:bg-muted/50">See all {latestChange.files.length} changed files</a>{/if}
							</div>
						</div>
					{/if}
				{/if}
			</section>

			<aside aria-labelledby="attention-title">
				<h2 id="attention-title" class="mb-3 text-lg font-semibold">Needs attention</h2>
				<div class="rounded-xl border border-border bg-card p-4">
					{#if loading}<div class="h-20 animate-pulse rounded bg-muted"></div>
					{:else if needsAttention.length === 0}<div class="flex items-start gap-3"><ShieldCheckIcon class="mt-0.5 size-5 shrink-0 text-emerald-300" /><div><p class="text-sm font-medium">Everything is checked</p><p class="mt-1 text-xs leading-5 text-muted-foreground">Every repository has a recent push and a successful integrity check.</p></div></div>
					{:else}<div class="divide-y divide-border">
						{#each needsAttention.slice(0, 8) as repo (repo.name)}
							<a href="/repos/{repo.name}" class="flex items-start gap-3 py-3 first:pt-0 last:pb-0 hover:text-primary"><ShieldAlertIcon class="mt-0.5 size-4 shrink-0 text-primary" /><span class="min-w-0"><span class="block truncate font-mono text-xs font-semibold">{repo.name}</span><span class="mt-1 block text-xs text-muted-foreground">{repo.audit_summary?.highRisk ? `${repo.audit_summary.highRisk} high risk audit findings` : repo.audit_summary?.status === 'failed' ? 'Audit failed' : repo.last_check_ok === 0 ? 'Integrity issue' : repo.last_check_ok === null ? 'Not verified' : 'Push is getting old'} · {relativeTime(repo.last_push_at)}</span></span></a>
						{/each}
						{#if needsAttention.length > 8}<a href="/repos" class="block pt-3 text-xs text-primary">See all {needsAttention.length} repositories</a>{/if}
					</div>{/if}
				</div>
				<div class="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><HardDriveIcon class="size-4" /> Back up NashGit’s data volume separately.</div>
			</aside>
		</div>
	{/if}
</div>
