<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import favicon from '$lib/assets/favicon.svg';

	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import CircleUserIcon from '@lucide/svelte/icons/circle-user';

	let { data, children } = $props<{ data: { username: string | null } }>();
	let mobileOpen = $state(false);

	const nav = [
		{ href: '/', label: 'Dashboard', icon: LayoutDashboardIcon },
		{ href: '/repos', label: 'Repositories', icon: FolderGit2Icon },
		{ href: '/tokens', label: 'Tokens', icon: KeyRoundIcon },
		{ href: '/settings', label: 'Settings', icon: SettingsIcon }
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}

	async function logout() {
		try {
			await api.auth.logout();
		} catch {
			/* ignore */
		}
		toast.success('Signed out');
		await invalidateAll();
		// Hard navigate so the auth guard cleanly redirects.
		window.location.href = '/login';
	}

	const pathname = $derived(page.url.pathname as string);
	const isLogin = $derived(pathname === '/login');
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if isLogin}
	<!-- Login screen is rendered standalone, no chrome. -->
	{@render children()}
	<Toaster />
{:else}
	<div class="flex min-h-screen bg-background text-foreground">
		<!-- Mobile sidebar backdrop -->
		{#if mobileOpen}
			<button
				class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
				onclick={() => (mobileOpen = false)}
				aria-label="Close menu"
			></button>
		{/if}

		<!-- Sidebar -->
		<aside
			class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:translate-x-0"
			class:translate-x-0={mobileOpen}
			class:-translate-x-full={!mobileOpen}
		>
			<div class="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
				<img src={favicon} alt="NashGit" class="size-7" />
				<div class="flex flex-col leading-none">
					<span class="text-base font-semibold tracking-tight">NashGit</span>
					<span class="text-[0.65rem] text-muted-foreground">git backup for NAS</span>
				</div>
			</div>

			<nav class="flex-1 space-y-1 p-3">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
							{isActive(item.href)
							? 'bg-sidebar-accent text-sidebar-accent-foreground'
							: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
					>
						<item.icon class="size-4 shrink-0" />
						{item.label}
					</a>
				{/each}
			</nav>

			<div class="border-t border-sidebar-border p-3">
				<div class="mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground">
					<CircleUserIcon class="size-3.5" />
					<span class="truncate">{data.username ?? 'admin'}</span>
				</div>
				<button
					onclick={logout}
					class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
				>
					<LogOutIcon class="size-4 shrink-0" />
					Sign out
				</button>
			</div>
		</aside>

		<!-- Main content -->
		<div class="flex min-w-0 flex-1 flex-col md:pl-64">
			<!-- Mobile top bar -->
			<header
				class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:hidden"
			>
				<button
					onclick={() => (mobileOpen = true)}
					class="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Open menu"
				>
					<MenuIcon class="size-5" />
				</button>
				<div class="flex items-center gap-2">
					<img src={favicon} alt="" class="size-6" />
					<span class="font-semibold">NashGit</span>
				</div>
			</header>

			<main class="flex-1 overflow-y-auto">
				<div class="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-10">
					{@render children()}
				</div>
			</main>
		</div>
	</div>
	<Toaster />
{/if}
