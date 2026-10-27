<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { api, formatBytes, relativeTime, type AuditHistoryEntry, type AuditReport, type AuditRule, type AuditSeverity, type AuditState } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import FileWarningIcon from '@lucide/svelte/icons/file-warning';

	const name = $derived(page.params.name ?? '');
	const commit = $derived(page.url.searchParams.get('commit') ?? '');
	const scope = $derived(commit ? 'commit' as const : 'repository' as const);
	let auditState = $state<AuditState>({ running: false, report: null });
	let rules = $state<AuditRule[]>([]);
	let runs = $state<AuditHistoryEntry[]>([]);
	let selectedReport = $state<AuditReport | null>(null);
	let loading = $state(true);
	let starting = $state(false);
	let error = $state('');
	let filter = $state<'all' | AuditSeverity>('all');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let sequence = 0;
	const report = $derived(selectedReport ?? auditState.report);
	const visibleFindings = $derived(report?.findings.filter((item) => filter === 'all' || item.severity === filter) ?? []);
	const ruleById = $derived(Object.fromEntries(rules.map((rule) => [rule.id, rule])) as Record<string, AuditRule>);

	$effect(() => {
		const repoName = name;
		const hash = commit;
		filter = 'all';
		selectedReport = null;
		void refresh(repoName, hash);
		return () => { if (timer) clearTimeout(timer); ++sequence; };
	});

	async function refresh(repoName: string, hash: string) {
		if (timer) clearTimeout(timer);
		const current = ++sequence;
		try {
			const [result, availableRules, history] = await Promise.all([
				api.repos.audit(repoName, hash ? 'commit' : 'repository', hash || undefined),
				rules.length ? Promise.resolve(rules) : api.repos.auditRules(repoName),
				api.repos.auditHistory(repoName, hash ? 'commit' : 'repository', hash || undefined)
			]);
			if (current !== sequence) return;
			auditState = result;
			rules = availableRules;
			runs = history;
			error = '';
			if (result.running) timer = setTimeout(() => refresh(repoName, hash), 2000);
		} catch (cause) {
			if (current === sequence) error = cause instanceof Error ? cause.message : 'Could not load audit';
		} finally {
			if (current === sequence) loading = false;
		}
	}

	async function runAudit() {
		if (starting || auditState.running) return;
		starting = true;
		try {
			selectedReport = null;
			await api.repos.runAudit(name, scope, commit || undefined);
			toast.success('Audit queued');
			await refresh(name, commit);
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'Could not start audit');
		} finally {
			starting = false;
		}
	}

	async function openReport(id: number) {
		try {
			selectedReport = await api.repos.auditReport(name, id);
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'Could not open report');
		}
	}

	function severityClass(severity: AuditSeverity) {
		return severity === 'critical' ? 'text-rose-300 bg-rose-500/15 border-rose-500/30'
			: severity === 'high' ? 'text-orange-300 bg-orange-500/15 border-orange-500/30'
			: severity === 'medium' ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
			: 'text-sky-300 bg-sky-500/15 border-sky-500/30';
	}

	const severities: AuditSeverity[] = ['critical', 'high', 'medium', 'low'];
</script>

<svelte:head><title>Audit · {name} · NashGit</title></svelte:head>

<div class="space-y-6">
	<header class="space-y-4">
		<a href="/repos/{name}{commit ? `?commit=${commit}` : ''}" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon class="size-4" /> {name}</a>
		<div class="flex flex-wrap items-end justify-between gap-4">
			<div class="min-w-0"><div class="flex items-center gap-3"><ScanSearchIcon class="size-8 text-primary" /><h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Repository audit</h1></div><p class="mt-2 max-w-3xl text-sm text-muted-foreground">Deterministic checks for exposed credentials, risky commands, duplicate content, and tracked noise. Findings point to locations without copying sensitive values.</p></div>
			<Button onclick={runAudit} disabled={starting || auditState.running}>{#if starting || auditState.running}<Loader2Icon class="size-4 animate-spin" /> {auditState.running ? 'Auditing…' : 'Queuing…'}{:else}<ScanSearchIcon class="size-4" /> Run audit{/if}</Button>
		</div>
	</header>

	<div class="flex flex-wrap items-center gap-2 border-b border-border pb-3 text-sm">
		<a href="/repos/{name}/audit" class="rounded-md px-3 py-2 {scope === 'repository' ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}"><ShieldCheckIcon class="mr-1 inline size-4" /> Current repository</a>
		{#if commit}<span class="rounded-md bg-primary/15 px-3 py-2 font-medium text-primary"><GitCommitHorizontalIcon class="mr-1 inline size-4" /> Commit {commit.slice(0, 12)}</span>{/if}
		<span class="ml-auto text-xs text-muted-foreground">Automatic after Git pushes · manual runs available</span>
	</div>

	{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</div>{/if}
	{#if loading}<div class="h-80 animate-pulse rounded-xl bg-muted"></div>
	{:else if !report}
		<div class="rounded-xl border border-dashed border-border bg-card p-8 md:p-12"><ScanSearchIcon class="size-9 text-primary" /><h2 class="mt-4 text-xl font-semibold">No audit report yet</h2><p class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Run the first scan to get a measured inventory and actionable findings. Future Git pushes will queue scans automatically.</p><Button class="mt-5" onclick={runAudit} disabled={starting || auditState.running}>{auditState.running ? 'Auditing…' : 'Run audit'}</Button></div>
	{:else}
		<section class="overflow-hidden rounded-xl border border-border bg-card" aria-label="Audit report">
			<div class="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 md:p-6">
				<div class="flex items-start gap-3">{#if report.status === 'complete' && report.metrics.bySeverity.critical + report.metrics.bySeverity.high === 0}<ShieldCheckIcon class="mt-0.5 size-6 text-emerald-300" />{:else}<ShieldAlertIcon class="mt-0.5 size-6 text-primary" />{/if}<div><h2 class="text-xl font-semibold">{report.status === 'failed' ? 'Audit failed' : report.metrics.findings === 0 ? 'No matches in scanned files' : `${report.metrics.findings} findings`}</h2><p class="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{report.summary}</p></div></div>
				<div class="text-right text-xs text-muted-foreground"><p>{report.source === 'push' ? 'Automatic scan' : 'Manual scan'} · {relativeTime(report.finishedAt)}</p><p class="mt-1 font-mono">{report.revision.slice(0, 12)} · {report.durationMs} ms · rules v{report.rulebookVersion ?? 1}</p>{#if selectedReport}<button onclick={() => (selectedReport = null)} class="mt-2 text-primary hover:underline">Back to latest</button>{/if}</div>
			</div>
			<div class="grid grid-cols-2 gap-x-5 gap-y-4 border-b border-border px-5 py-5 sm:grid-cols-4 md:px-6">
				<div><p class="text-xs text-muted-foreground">Files considered</p><p class="mt-1 text-2xl font-semibold tabular-nums">{report.metrics.consideredFiles}</p></div>
				<div><p class="text-xs text-muted-foreground">Text files scanned</p><p class="mt-1 text-2xl font-semibold tabular-nums">{report.metrics.scannedFiles}</p></div>
				<div><p class="text-xs text-muted-foreground">Bytes inspected</p><p class="mt-1 text-2xl font-semibold">{formatBytes(report.metrics.bytesScanned)}</p></div>
				<div><p class="text-xs text-muted-foreground">Exact duplicate groups</p><p class="mt-1 text-2xl font-semibold tabular-nums">{report.metrics.duplicateGroups}</p></div>
			</div>
			<div class="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-4">
				{#each severities as severity}<button onclick={() => (filter = filter === severity ? 'all' : severity)} aria-pressed={filter === severity} class="px-5 py-4 text-left transition-colors hover:bg-muted/50 {filter === severity ? 'bg-muted/60' : ''}"><span class="block text-xs capitalize text-muted-foreground">{severity}</span><span class="mt-1 block text-xl font-semibold tabular-nums {severityClass(severity).split(' ')[0]}">{report.metrics.bySeverity[severity]}</span></button>{/each}
			</div>
			<div class="flex flex-wrap items-center gap-2 px-5 py-3 text-xs text-muted-foreground md:px-6"><span class="rounded border px-2 py-0.5 {report.status === 'complete' ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300'}">{report.status === 'complete' ? 'Scan complete' : report.status === 'partial' ? 'Partial coverage' : 'Failed'}</span><span>{report.metrics.binaryFiles} binary · {report.metrics.skippedFiles} skipped · {report.metrics.trackedFiles} tracked at revision</span>{#if filter !== 'all'}<button onclick={() => (filter = 'all')} class="ml-auto text-primary hover:underline">Clear filter</button>{/if}</div>
		</section>
		{#if auditState.running}<p class="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">A new audit is running. The report above is the previous completed run.</p>{/if}
		{#if report.skipped?.length}<details class="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><summary class="cursor-pointer text-sm font-medium text-amber-200">Inspect {report.metrics.skippedFiles} skipped files and scan limits</summary><p class="mt-2 text-xs leading-5 text-muted-foreground">Content scanning stops at {formatBytes(report.limits.maxBlobBytes)} per file, {formatBytes(report.limits.maxContentBytes)} total, and {report.limits.maxFiles} files. Paths and exact duplicates are still checked. At most 50 skipped paths are listed.</p><div class="mt-3 max-h-56 divide-y divide-border overflow-y-auto">{#each report.skipped as item}<div class="flex flex-wrap justify-between gap-2 py-2 text-xs"><span class="break-all font-mono">{item.path}</span><span class="shrink-0 text-muted-foreground">{item.reason} · {formatBytes(item.bytes)}</span></div>{/each}</div></details>{/if}

		<section aria-labelledby="findings-title">
			<div class="mb-3 flex items-center justify-between gap-3"><h2 id="findings-title" class="text-lg font-semibold">Diagnostics <span class="font-mono text-sm text-muted-foreground">{visibleFindings.length}</span></h2><span class="text-xs text-muted-foreground">Matched file contents are never included</span></div>
			{#if visibleFindings.length === 0}<div class="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{filter === 'all' ? 'No findings for the files this scan covered.' : `No ${filter} findings in this report.`}</div>
			{:else}<div class="overflow-hidden rounded-xl border border-border bg-card">
				{#each visibleFindings as item, index (`${item.ruleId}:${item.path}:${item.line ?? 0}:${index}`)}
					<div class="grid gap-2 border-b border-border p-4 last:border-b-0 lg:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-5">
						<div><span class="inline-block rounded border px-2 py-0.5 text-[11px] font-medium capitalize {severityClass(item.severity)}">{item.severity}</span><p class="mt-2 font-mono text-xs text-muted-foreground">{item.ruleId}</p></div>
						<div class="min-w-0"><p class="text-sm font-semibold">{item.title}</p><p class="mt-1 break-all font-mono text-xs text-muted-foreground">{item.path}{item.line ? `:${item.line}` : ''}</p>{#if item.relatedPaths?.length}<p class="mt-1 break-all text-xs text-muted-foreground">Also: {item.relatedPaths.join(', ')}</p>{/if}{#if report.scope === 'commit' && item.path !== '@commit-message' && !item.path.includes('[redacted')}<a href="/repos/{name}?commit={report.revision}&file={encodeURIComponent(item.path)}" class="mt-2 inline-block text-xs text-primary hover:underline">Open changed file →</a>{/if}</div>
						<p class="text-sm leading-6 text-muted-foreground">{ruleById[item.ruleId]?.action ?? 'Review this finding.'}</p>
					</div>
				{/each}
			</div>{/if}
		</section>
		{#if runs.length > 1}<section aria-labelledby="history-title"><h2 id="history-title" class="mb-3 text-lg font-semibold">Recent reports <span class="font-mono text-sm text-muted-foreground">{runs.length}</span></h2><div class="overflow-hidden rounded-xl border border-border bg-card">{#each runs as run (run.id)}<button onclick={() => openReport(run.id)} class="grid w-full gap-2 border-b border-border px-4 py-3 text-left text-xs hover:bg-muted/40 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] sm:items-center"><span class="font-mono">{run.revision.slice(0, 12)} <span class="ml-2 text-muted-foreground">{run.source === 'push' ? 'push' : 'manual'}</span></span><span class="text-muted-foreground">{relativeTime(run.createdAt)}</span><span class="font-medium {run.status === 'complete' ? 'text-emerald-300' : 'text-amber-300'}">{run.status}</span><span class="font-mono">{run.findings} findings</span></button>{/each}</div></section>{/if}
	{/if}

	<section class="border-t border-border pt-5" aria-labelledby="rulebook-title"><div class="flex items-center gap-2"><FileWarningIcon class="size-4 text-primary" /><h2 id="rulebook-title" class="text-lg font-semibold">Rulebook</h2><span class="font-mono text-xs text-muted-foreground">{rules.length} checks</span></div><p class="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Pattern matches are review prompts, not proof of a vulnerability. The scanner reads Git objects only; it does not execute project code or contact external services. It does not cover untracked files, every historical commit, or files beyond its size limits.</p><div class="mt-4 grid gap-x-6 md:grid-cols-2">{#each rules as rule (rule.id)}<div class="border-t border-border py-3"><div class="flex items-center justify-between gap-2"><p class="text-sm font-medium"><span class="mr-2 font-mono text-xs text-primary">{rule.id}</span>{rule.title}</p><span class="text-xs capitalize text-muted-foreground">{rule.severity}</span></div><p class="mt-1 text-xs leading-5 text-muted-foreground">{rule.why}</p></div>{/each}</div></section>
</div>
