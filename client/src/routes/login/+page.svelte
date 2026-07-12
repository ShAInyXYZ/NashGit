<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { api, ApiError } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import favicon from '$lib/assets/favicon.svg';

	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import LogInIcon from '@lucide/svelte/icons/log-in';

	let username = $state('admin');
	let password = $state('');
	let loading = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (loading) return;
		loading = true;
		try {
			await api.auth.login(username.trim(), password);
			toast.success('Welcome back');
			await goto('/');
		} catch (err) {
			if (err instanceof ApiError) {
				toast.error(err.message);
			} else {
				toast.error('Could not reach the server');
			}
		} finally {
			loading = false;
		}
	}
</script>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
	<!-- ambient cherry glow -->
	<div
		class="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
		style="background: radial-gradient(circle, hsl(348 70% 51%) 0%, transparent 70%);"
	></div>

	<div class="relative w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<img src={favicon} alt="NashGit" class="size-14" />
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">NashGit</h1>
				<p class="mt-1 text-sm text-muted-foreground">Sign in to manage your git backups</p>
			</div>
		</div>

		<Card class="border-border/60 shadow-xl shadow-black/20">
			<CardHeader class="space-y-1">
				<CardTitle class="text-lg">Admin login</CardTitle>
				<CardDescription>Enter your credentials to continue</CardDescription>
			</CardHeader>
			<CardContent>
				<form onsubmit={submit} class="space-y-4">
					<div class="space-y-2">
						<Label for="username">Username</Label>
						<Input
							id="username"
							bind:value={username}
							autocomplete="username"
							placeholder="admin"
							required
						/>
					</div>
					<div class="space-y-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							type="password"
							bind:value={password}
							autocomplete="current-password"
							placeholder="••••••••"
							required
						/>
					</div>
					<Button type="submit" class="w-full" disabled={loading}>
						{#if loading}
							<Loader2Icon class="size-4 animate-spin" />
							Signing in…
						{:else}
							<LogInIcon class="size-4" />
							Sign in
						{/if}
					</Button>
				</form>
			</CardContent>
		</Card>

		<p class="mt-6 text-center text-xs text-muted-foreground">
			Deploy tokens are managed after signing in.
		</p>
	</div>
</div>
