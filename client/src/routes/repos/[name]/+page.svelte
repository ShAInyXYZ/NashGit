<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import {
		api, ApiError, formatBytes, relativeTime, freshness, FRESHNESS_LABEL,
		type Repo, type PushLogEntry, type BranchRef, type CommitSummary,
		type CommitDetail, type FileDiff, type CommitNote
	} from '$lib/api';
	import FreshnessCherry from '$lib/components/FreshnessCherry.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';

	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
	import GitCompareArrowsIcon from '@lucide/svelte/icons/git-compare-arrows';

	const name = $derived(page.params.name);
	let repo = $state<Repo | null>(null);
	let pushLog = $state<PushLogEntry[]>([]);
	let branches = $state<BranchRef[]>([]);
	let branch = $state('');
	let commits = $state<CommitSummary[]>([]);
	let hasMore = $state(false);
	let nextOffset = $state(0);
	let selectedHash = $state('');
	let detail = $state<CommitDetail | null>(null);
	let selectedFile = $state('');
	let diff = $state<FileDiff | null>(null);
	let notes = $state<CommitNote[]>([]);
	let noteDraft = $state('');
	let search = $state('');
	let hideMeta = $state(true);
	let loading = $state(true);
	let loadingHistory = $state(false);
	let loadingMore = $state(false);
	let loadingDetail = $state(false);
	let loadingDiff = $state(false);
	let savingNote = $state(false);
	let copied = $state(false);
	let confirmDelete = $state(false);
	let deleting = $state(false);
	let verifying = $state(false);
	let loadError = $state('');
	let detailSequence = 0;
	let diffSequence = 0;

	const filteredCommits = $derived(
		search.trim()
			? commits.filter((commit) => `${commit.subject} ${commit.body} ${commit.author} ${commit.hash}`.toLowerCase().includes(search.trim().toLowerCase()))
			: commits
	);
	const diffRows = $derived(buildDiffRows(diff?.patch ?? ''));
	const visibleFiles = $derived(detail?.files.filter((file) => !hideMeta || !file.path.endsWith('.meta')) ?? []);
	const selectedFileInfo = $derived(detail?.files.find((file) => file.path === selectedFile));
	const selectedIsImage = $derived(/\.(png|jpe?g|webp|gif)$/i.test(selectedFile));

	onMount(load);

	async function load() {
		if (!name) return;
		loading = true;
		loadError = '';
		try {
			const requestedBranch = page.url.searchParams.get('branch') ?? undefined;
			const requestedCommit = page.url.searchParams.get('commit');
			const [repository, activity, history] = await Promise.all([
				api.repos.get(name), api.repos.log(name), api.repos.commits(name, requestedBranch)
			]);
			repo = repository;
			pushLog = activity;
			branches = history.branches;
			branch = history.branch ?? '';
			commits = history.commits;
			hasMore = history.hasMore;
			nextOffset = history.nextOffset;
			if (requestedCommit && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(requestedCommit)) await selectCommit(requestedCommit);
			else if (commits[0]) await selectCommit(commits[0].hash);
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) {
				await goto('/repos');
				return;
			}
			loadError = error instanceof Error ? error.message : 'Could not load repository';
		} finally {
			loading = false;
		}
	}

	async function changeBranch(nextBranch: string) {
		if (!repo || nextBranch === branch) return;
		loadingHistory = true;
		++detailSequence;
		++diffSequence;
		search = '';
		detail = null;
		diff = null;
		selectedHash = '';
		try {
			const history = await api.repos.commits(repo.name, nextBranch);
			branch = history.branch ?? '';
			branches = history.branches;
			commits = history.commits;
			hasMore = history.hasMore;
			nextOffset = history.nextOffset;
			if (commits[0]) await selectCommit(commits[0].hash);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not load branch');
		} finally {
			loadingHistory = false;
		}
	}

	async function loadMore() {
		if (!repo || !branch || !hasMore || loadingMore) return;
		loadingMore = true;
		try {
			const history = await api.repos.commits(repo.name, branch, nextOffset);
			commits = [...commits, ...history.commits];
			hasMore = history.hasMore;
			nextOffset = history.nextOffset;
		} catch {
			toast.error('Could not load older commits');
		} finally {
			loadingMore = false;
		}
	}

	async function selectCommit(hash: string) {
		if (!repo) return;
		const requestedFile = page.url.searchParams.get('commit') === hash ? page.url.searchParams.get('file') : null;
		const sequence = ++detailSequence;
		++diffSequence;
		selectedHash = hash;
		const url = new URL(window.location.href);
		url.searchParams.set('commit', hash);
		if (!requestedFile) url.searchParams.delete('file');
		if (branch) url.searchParams.set('branch', branch);
		replaceState(url, page.state);
		noteDraft = '';
		selectedFile = '';
		detail = null;
		diff = null;
		notes = [];
		loadingDetail = true;
		try {
			const [commit, commitNotes] = await Promise.all([
				api.repos.commit(repo.name, hash), api.repos.notes(repo.name, hash)
			]);
			if (sequence !== detailSequence) return;
			detail = commit;
			notes = commitNotes;
			const firstFile = commit.files.find((file) => file.path === requestedFile)
				?? commit.files.find((file) => !file.path.endsWith('.meta')) ?? commit.files[0];
			if (firstFile) await selectFile(firstFile.path);
		} catch (error) {
			if (sequence === detailSequence) toast.error(error instanceof Error ? error.message : 'Could not load commit');
		} finally {
			if (sequence === detailSequence) loadingDetail = false;
		}
	}

	async function selectFile(path: string) {
		if (!repo || !selectedHash) return;
		const url = new URL(window.location.href);
		url.searchParams.set('file', path);
		replaceState(url, page.state);
		const sequence = ++diffSequence;
		selectedFile = path;
		diff = null;
		loadingDiff = true;
		try {
			const result = await api.repos.diff(repo.name, selectedHash, path);
			if (sequence === diffSequence) diff = result;
		} catch (error) {
			if (sequence === diffSequence) toast.error(error instanceof Error ? error.message : 'Could not load file diff');
		} finally {
			if (sequence === diffSequence) loadingDiff = false;
		}
	}

	async function addNote(event: SubmitEvent) {
		event.preventDefault();
		if (!repo || !selectedHash || !noteDraft.trim() || savingNote) return;
		savingNote = true;
		try {
			const note = await api.repos.addNote(repo.name, selectedHash, noteDraft.trim());
			notes = [...notes, note];
			noteDraft = '';
			toast.success('Note added');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not add note');
		} finally {
			savingNote = false;
		}
	}

	async function removeNote(id: number) {
		if (!repo || !selectedHash) return;
		try {
			await api.repos.removeNote(repo.name, selectedHash, id);
			notes = notes.filter((note) => note.id !== id);
		} catch {
			toast.error('Could not remove note');
		}
	}

	async function copyUrl() {
		if (!repo) return;
		try {
			await navigator.clipboard.writeText(repo.clone_url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
			toast.success('Clone URL copied');
		} catch {
			toast.error('Could not copy URL');
		}
	}

	async function copyCommitLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			toast.success('Commit link copied');
		} catch {
			toast.error('Could not copy commit link');
		}
	}

	async function verify() {
		if (!repo || verifying) return;
		verifying = true;
		try {
			const result = await api.repos.verify(repo.name);
			repo.last_check_at = result.checkedAt;
			repo.last_check_ok = result.ok ? 1 : 0;
			if (result.ok) toast.success('Backup integrity verified');
			else toast.error('Integrity check found issues', { description: result.output.slice(0, 200) });
		} catch {
			toast.error('Verification failed');
		} finally {
			verifying = false;
		}
	}

	async function remove() {
		if (!repo || deleting) return;
		deleting = true;
		try {
			await api.repos.remove(repo.name);
			toast.success(`Repository “${repo.name}” moved to trash`);
			await goto('/repos');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not move repository to trash');
		} finally {
			deleting = false;
			confirmDelete = false;
		}
	}

	function diffClass(line: string) {
		if (line.startsWith('@@')) return 'bg-sky-400/10 text-sky-300';
		if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'text-muted-foreground';
		if (line.startsWith('+')) return 'bg-emerald-400/10 text-emerald-200';
		if (line.startsWith('-')) return 'bg-rose-400/10 text-rose-200';
		return 'text-foreground/75';
	}

	function buildDiffRows(patch: string): { line: string; oldNo: number | null; newNo: number | null }[] {
		if (!patch) return [];
		let oldNo = 0;
		let newNo = 0;
		let inHunk = false;
		return patch.replace(/\n$/, '').split('\n').map((line) => {
			const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunk) {
				inHunk = true;
				oldNo = Number(hunk[1]);
				newNo = Number(hunk[2]);
				return { line, oldNo: null, newNo: null };
			}
			if (!inHunk) return { line, oldNo: null, newNo: null };
			if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('\\')) return { line, oldNo: null, newNo: null };
			if (line.startsWith('+')) return { line, oldNo: null, newNo: newNo++ };
			if (line.startsWith('-')) return { line, oldNo: oldNo++, newNo: null };
			return { line, oldNo: oldNo++, newNo: newNo++ };
		});
	}
</script>

<svelte:head><title>{name} · NashGit</title></svelte:head>

{#if loading}
	<div class="space-y-4" aria-label="Loading repository">
		<div class="h-12 w-2/3 animate-pulse rounded-lg bg-muted"></div>
		<div class="h-14 animate-pulse rounded-lg bg-muted"></div>
		<div class="h-[36rem] animate-pulse rounded-xl bg-muted"></div>
	</div>
{:else if loadError}
	<div class="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
		<h1 class="text-xl font-semibold">Could not load repository</h1>
		<p class="mt-2 text-sm text-muted-foreground">{loadError}</p>
		<Button class="mt-4" onclick={load}>Try again</Button>
	</div>
{:else if repo}
	<div class="space-y-5">
		<header class="space-y-4">
			<a href="/repos" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
				<ArrowLeftIcon class="size-4" /> Repositories
			</a>
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div class="min-w-0">
					<h1 class="flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight md:text-4xl">
						<span class="break-all">{repo.name}</span>
						<span title={FRESHNESS_LABEL[freshness(repo.last_push_at)]}>
							<FreshnessCherry state={freshness(repo.last_push_at)} size={24} />
						</span>
					</h1>
					{#if repo.description}<p class="mt-1 text-sm text-muted-foreground">{repo.description}</p>{/if}
				</div>
				<div class="flex items-center gap-2">
					<Button href="/github?repo={encodeURIComponent(repo.name)}" variant="secondary" size="sm"><GitCompareArrowsIcon class="size-4" /> Github</Button>
					<Button href="/repos/{repo.name}/audit" variant="secondary" size="sm"><ScanSearchIcon class="size-4" /> Audit</Button>
					<Button variant="secondary" size="sm" onclick={verify} disabled={verifying}>
						{#if verifying}<Loader2Icon class="size-4 animate-spin" /> Verifying…{:else}<ShieldCheckIcon class="size-4" /> Verify backup{/if}
					</Button>
					<Button variant="ghost" size="sm" onclick={() => (confirmDelete = true)} class="text-muted-foreground hover:text-destructive" aria-label="Move repository to trash">
						<Trash2Icon class="size-4" />
					</Button>
				</div>
			</div>
		</header>

		<div class="grid grid-cols-2 gap-3 border-y border-border py-3 text-sm md:grid-cols-3 xl:grid-cols-6" aria-label="Repository status">
			<div class="flex min-w-0 items-center gap-2"><GitBranchIcon class="size-4 shrink-0 text-primary" /><span class="text-muted-foreground">{repo.branches} branch{repo.branches === 1 ? '' : 'es'}</span></div>
			<div class="flex min-w-0 items-center gap-2"><HardDriveIcon class="size-4 shrink-0 text-primary" /><span class="text-muted-foreground">{formatBytes(repo.sizeBytes)}</span></div>
			<div class="min-w-0 truncate font-mono text-xs text-muted-foreground">HEAD <span class="text-foreground">{repo.defaultBranch ?? '—'}</span></div>
			<div class="text-muted-foreground">Last push <span class="text-foreground">{relativeTime(repo.last_push_at)}</span></div>
			<div class="flex items-center gap-2">
				{#if repo.last_check_ok === 1}<ShieldCheckIcon class="size-4 text-emerald-400" /> <span class="text-emerald-300">Verified {relativeTime(repo.last_check_at)}</span>
				{:else if repo.last_check_ok === 0}<ShieldAlertIcon class="size-4 text-destructive" /> <span class="text-destructive">Integrity issue</span>
				{:else}<ShieldCheckIcon class="size-4 text-muted-foreground" /> <span class="text-muted-foreground">Not verified</span>{/if}
			</div>
			<a href="/repos/{repo.name}/audit" class="flex items-center gap-2 text-xs hover:text-primary"><ScanSearchIcon class="size-4 shrink-0 text-primary" />{#if repo.audit_summary}<span class={repo.audit_summary.highRisk ? 'text-orange-300' : 'text-muted-foreground'}>{repo.audit_summary.highRisk ? `${repo.audit_summary.highRisk} high risk` : `${repo.audit_summary.findings} audit findings`}</span>{:else}<span class="text-muted-foreground">Audit not run</span>{/if}</a>
		</div>

		<section class="grid min-h-[36rem] overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]" aria-label="Commit explorer">
			<aside class="min-w-0 border-b border-border lg:border-b-0 lg:border-r" aria-label="Commit timeline">
				<div class="space-y-3 border-b border-border p-4">
					<div class="flex items-center justify-between gap-3">
						<h2 class="flex items-center gap-2 text-base font-semibold"><HistoryIcon class="size-4 text-primary" /> Commits</h2>
						<span class="font-mono text-xs text-muted-foreground">{commits.length}{hasMore ? '+' : ''}</span>
					</div>
					<label class="block text-xs text-muted-foreground" for="branch-select">Branch</label>
					<select id="branch-select" value={branch} onchange={(event) => changeBranch(event.currentTarget.value)} class="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground focus-visible:border-ring" disabled={loadingHistory || branches.length === 0}>
						{#each branches as item (item.name)}<option value={item.name}>{item.name}</option>{/each}
					</select>
					<div class="relative">
						<SearchIcon class="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
						<input bind:value={search} aria-label="Filter loaded commits" placeholder="Find in loaded commits" class="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus-visible:border-ring" />
					</div>
				</div>
				{#if loadingHistory}
					<div class="p-6 text-sm text-muted-foreground">Loading branch…</div>
				{:else if filteredCommits.length === 0}
					<div class="p-6 text-sm text-muted-foreground">{search ? 'No loaded commits match this filter.' : 'No commits on this branch yet.'}</div>
				{:else}
					<div class="max-h-[22rem] overflow-y-auto lg:max-h-[44rem]">
						{#each filteredCommits as commit (commit.hash)}
							<button onclick={() => selectCommit(commit.hash)} aria-current={selectedHash === commit.hash ? 'true' : undefined} class="group block w-full border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/60 {selectedHash === commit.hash ? 'bg-primary/10' : ''}">
								<span class="block truncate text-sm font-medium text-foreground">{commit.subject || '(no subject)'}</span>
								<span class="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
									<span class="truncate">{commit.author} · {relativeTime(commit.authoredAt)}</span>
									<code class="shrink-0 font-mono text-primary">{commit.hash.slice(0, 7)}</code>
								</span>
							</button>
						{/each}
						{#if hasMore && !search}<button onclick={loadMore} disabled={loadingMore} class="w-full p-3 text-sm text-primary hover:bg-muted/50 disabled:opacity-50">{loadingMore ? 'Loading…' : 'Load older commits'}</button>{/if}
					</div>
				{/if}
			</aside>

			<div class="min-w-0">
				{#if loadingDetail}
					<div class="space-y-4 p-6"><div class="h-7 w-2/3 animate-pulse rounded bg-muted"></div><div class="h-24 animate-pulse rounded bg-muted"></div><div class="h-72 animate-pulse rounded bg-muted"></div></div>
				{:else if detail}
					<div class="border-b border-border p-4 md:p-6">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<h2 class="text-xl font-semibold leading-snug tracking-tight md:text-2xl">{detail.subject || '(no subject)'}</h2>
								<p class="mt-2 text-sm text-muted-foreground"><span class="text-foreground">{detail.author}</span> committed {relativeTime(detail.authoredAt)}</p>
							</div>
						<div class="flex items-center gap-2"><a href="/repos/{repo.name}/audit?commit={detail.hash}" class="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20">Audit commit</a><code class="rounded-md bg-muted px-2 py-1 font-mono text-xs text-primary" title={detail.hash}>{detail.hash.slice(0, 12)}</code><button onclick={copyCommitLink} class="rounded p-1 text-muted-foreground hover:text-primary" aria-label="Copy commit link"><CopyIcon class="size-4" /></button></div>
						</div>
						{#if detail.body}<p class="mt-4 max-w-[75ch] whitespace-pre-wrap text-sm leading-6 text-foreground/85">{detail.body}</p>{/if}
						<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span>{detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed</span>
							<span class="font-mono text-emerald-300">+{detail.additions}</span>
							<span class="font-mono text-rose-300">−{detail.deletions}</span>
							{#if detail.parents.length > 1}<span>Merge commit · showing changes from first parent</span>{/if}
						</div>
					</div>

					<div class="grid min-h-[22rem] border-b border-border 2xl:grid-cols-[17rem_minmax(0,1fr)]">
						<div class="min-w-0 border-b border-border 2xl:border-b-0 2xl:border-r">
							<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs">
								<span class="font-semibold uppercase tracking-wider text-muted-foreground">Changed files · {visibleFiles.length}</span>
								<label class="flex cursor-pointer items-center gap-1.5 text-muted-foreground"><input type="checkbox" bind:checked={hideMeta} class="accent-primary" /> Hide .meta</label>
							</div>
							<div class="max-h-56 overflow-y-auto 2xl:max-h-[37rem]">
								{#each visibleFiles as file (file.path)}
									<button onclick={() => selectFile(file.path)} title={file.path} aria-current={selectedFile === file.path ? 'true' : undefined} class="flex w-full min-w-0 items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60 {selectedFile === file.path ? 'bg-primary/10' : ''}">
										<span class="w-5 shrink-0 font-mono font-semibold {file.status === 'A' ? 'text-emerald-300' : file.status === 'D' ? 'text-rose-300' : 'text-primary'}">{file.status}</span>
										<span class="min-w-0 flex-1 truncate font-mono">{file.path}</span>
									</button>
								{/each}
								{#if visibleFiles.length === 0}<p class="p-4 text-xs text-muted-foreground">{detail.files.length ? 'Only .meta files changed. Turn off the filter to see them.' : 'No file changes in this commit.'}</p>{/if}
							</div>
						</div>
						<div class="min-w-0">
							<div class="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
								<span class="min-w-0 truncate font-mono text-xs" title={selectedFile}>{selectedFile || 'Select a file'}</span>
								{#if selectedFile}<span class="shrink-0 text-xs text-muted-foreground">Diff</span>{/if}
							</div>
							{#if selectedIsImage && selectedFileInfo && repo}
								<div class="grid gap-3 border-b border-border bg-background/50 p-3 sm:grid-cols-2">
									{#if selectedFileInfo.status !== 'A' && detail.parents[0]}
										<div class="min-w-0"><p class="mb-2 text-xs text-muted-foreground">Before</p><a href={api.repos.imageUrl(repo.name, detail.hash, selectedFile, 'before')} target="_blank" rel="noopener noreferrer" aria-label="Open previous image at full size"><img src={api.repos.imageUrl(repo.name, detail.hash, selectedFile, 'before')} alt="Previous version of {selectedFile}" loading="lazy" class="max-h-72 w-full rounded-md border border-border bg-zinc-200 object-contain" /></a></div>
									{/if}
									{#if selectedFileInfo.status !== 'D'}
										<div class="min-w-0"><p class="mb-2 text-xs text-muted-foreground">After</p><a href={api.repos.imageUrl(repo.name, detail.hash, selectedFile, 'after')} target="_blank" rel="noopener noreferrer" aria-label="Open new image at full size"><img src={api.repos.imageUrl(repo.name, detail.hash, selectedFile, 'after')} alt="Version of {selectedFile} in this commit" loading="lazy" class="max-h-72 w-full rounded-md border border-border bg-zinc-200 object-contain" /></a></div>
									{/if}
								</div>
							{/if}
							{#if loadingDiff}<div class="p-6 text-sm text-muted-foreground">Loading diff…</div>
							{:else if diff?.truncated}<div class="p-6 text-sm text-muted-foreground">This diff is too large to display here. Clone the repository to inspect the full file.</div>
							{:else if diffRows.length}
								<div class="max-h-[37rem] overflow-auto bg-background/60 font-mono text-[11px] leading-[1.55] md:text-xs" aria-label="File diff">
									{#each diffRows as row, index (index)}
										<div class="grid min-w-max grid-cols-[2.5rem_2.5rem_minmax(0,1fr)] {diffClass(row.line)}">
											<span class="select-none border-r border-border/40 pr-1 text-right text-muted-foreground/50">{row.oldNo ?? ''}</span>
											<span class="select-none border-r border-border/40 pr-1 text-right text-muted-foreground/50">{row.newNo ?? ''}</span>
											<span class="whitespace-pre px-3">{row.line || ' '}</span>
										</div>
									{/each}
								</div>
							{:else}<div class="p-6 text-sm text-muted-foreground">{selectedFile ? 'No text diff for this file. It may be binary or contain only metadata changes.' : 'Choose a changed file to inspect its diff.'}</div>{/if}
						</div>
					</div>

					<section class="p-4 md:p-6" aria-labelledby="notes-title">
						<div class="flex items-center gap-2"><MessageCircleIcon class="size-4 text-primary" /><h3 id="notes-title" class="text-base font-semibold">Commit notes</h3><span class="text-xs text-muted-foreground">{notes.length}</span></div>
						<p class="mt-1 text-xs text-muted-foreground">Notes are saved in NashGit, alongside the commit’s original message.</p>
						{#if notes.length}
							<div class="mt-4 divide-y divide-border rounded-lg border border-border">
								{#each notes as note (note.id)}
									<div class="p-3">
										<div class="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{note.author} · {relativeTime(note.created_at)}</span><button onclick={() => removeNote(note.id)} aria-label="Delete note" class="rounded p-1 hover:text-destructive"><Trash2Icon class="size-3.5" /></button></div>
										<p class="mt-2 whitespace-pre-wrap text-sm leading-6">{note.body}</p>
									</div>
								{/each}
							</div>
						{:else}<p class="mt-4 text-sm text-muted-foreground">No notes yet. Add context for future you.</p>{/if}
						<form onsubmit={addNote} class="mt-4 flex flex-col items-end gap-2">
							<label for="note-body" class="sr-only">Write a commit note</label>
							<textarea id="note-body" bind:value={noteDraft} maxlength="2000" rows="3" placeholder="What should you remember about this commit?" class="w-full resize-y rounded-lg border border-input bg-background p-3 text-sm placeholder:text-muted-foreground/70"></textarea>
							<Button type="submit" size="sm" disabled={savingNote || !noteDraft.trim()}>{savingNote ? 'Saving…' : 'Add note'}</Button>
						</form>
					</section>
				{:else}<div class="flex min-h-[28rem] flex-col items-center justify-center gap-2 p-8 text-center"><GitCommitHorizontalIcon class="size-8 text-primary" /><h2 class="text-lg font-semibold">No commit selected</h2><p class="text-sm text-muted-foreground">Choose a commit to see its message, files, and changes.</p></div>{/if}
			</div>
		</section>

		<div class="grid gap-3 lg:grid-cols-2">
			<details class="group rounded-xl border border-border bg-card p-4">
				<summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden">Clone repository <ChevronDownIcon class="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
				<div class="mt-4 flex min-w-0 items-stretch gap-2"><code class="min-w-0 flex-1 overflow-x-auto rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs">{repo.clone_url}</code><Button onclick={copyUrl} variant="secondary" size="sm" class="shrink-0">{#if copied}<CheckIcon class="size-4" />{:else}<CopyIcon class="size-4" />{/if}{copied ? 'Copied' : 'Copy'}</Button></div>
				<p class="mt-2 text-xs text-muted-foreground">Use a deploy token as the Git password.</p>
			</details>
			<details class="group rounded-xl border border-border bg-card p-4">
				<summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden">Push activity <span class="ml-auto font-mono text-xs text-muted-foreground">{pushLog.length}</span><ChevronDownIcon class="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
				<div class="mt-3 max-h-56 divide-y divide-border overflow-y-auto text-xs">
					{#each pushLog as entry (entry.id)}<div class="flex flex-wrap items-center justify-between gap-2 py-2"><span class="font-mono text-muted-foreground">{entry.from_hash?.slice(0, 7) ?? 'new'} → {entry.to_hash?.slice(0, 7) ?? 'unknown'}</span><span class="text-muted-foreground">{entry.pushed_by ?? 'unknown'} · {relativeTime(entry.pushed_at)}</span></div>{/each}
					{#if pushLog.length === 0}<p class="py-3 text-muted-foreground">No pushes recorded yet.</p>{/if}
				</div>
			</details>
		</div>
	</div>
{/if}

{#if confirmDelete && repo}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-title" tabindex="-1">
		<Card class="w-full max-w-md border-destructive/30">
			<CardHeader><CardTitle id="delete-title" class="text-base text-destructive">Move repository to trash?</CardTitle></CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm text-muted-foreground"><span class="font-mono text-foreground">{repo.name}</span> will stop accepting pushes. You can restore it from Repositories.</p>
				<div class="flex justify-end gap-2"><Button variant="ghost" onclick={() => (confirmDelete = false)} disabled={deleting}>Cancel</Button><Button variant="destructive" onclick={remove} disabled={deleting}>{deleting ? 'Moving…' : 'Move to trash'}</Button></div>
			</CardContent>
		</Card>
	</div>
{/if}
