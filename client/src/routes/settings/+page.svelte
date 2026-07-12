<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api, ApiError, type Settings } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';

	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import LockIcon from '@lucide/svelte/icons/lock';
	import ServerIcon from '@lucide/svelte/icons/server';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import UserIcon from '@lucide/svelte/icons/user';

	let settings = $state<Settings | null>(null);
	let loading = $state(true);

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let saving = $state(false);

	onMount(async () => {
		try {
			settings = await api.settings.get();
		} catch {
			/* ignore */
		} finally {
			loading = false;
		}
	});

	const passwordsMatch = $derived(newPassword === confirmPassword);
	const canSave = $derived(
		currentPassword.length > 0 &&
			newPassword.length >= 8 &&
			passwordsMatch
	);

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		if (saving || !canSave) return;
		saving = true;
		try {
			await api.settings.changePassword(currentPassword, newPassword);
			toast.success('Password updated');
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch (err) {
			if (err instanceof ApiError) toast.error(err.message);
			else toast.error('Could not change password');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Settings · NashGit</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
		<p class="mt-1 text-sm text-muted-foreground">Manage your account and view server info</p>
	</div>

	<!-- Server info -->
	<Card class="border-border/60">
		<CardHeader class="flex flex-row items-center gap-2">
			<ServerIcon class="size-4 text-muted-foreground" />
			<CardTitle class="text-base">Server</CardTitle>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="space-y-2">
					{#each Array(3) as _}
						<div class="h-5 w-64 animate-pulse rounded bg-muted/40"></div>
					{/each}
				</div>
			{:else if settings}
				<dl class="space-y-3 text-sm">
					<div class="flex items-center justify-between gap-4">
						<dt class="flex items-center gap-2 text-muted-foreground">
							<UserIcon class="size-3.5" />
							Admin username
						</dt>
						<dd class="font-mono">{settings.admin.username}</dd>
					</div>
					<Separator />
					<div class="flex items-center justify-between gap-4">
						<dt class="flex items-center gap-2 text-muted-foreground">
							<HardDriveIcon class="size-3.5" />
							Data directory
						</dt>
						<dd class="font-mono text-xs">{settings.dataDir}</dd>
					</div>
					<Separator />
					<div class="flex items-center justify-between gap-4">
						<dt class="flex items-center gap-2 text-muted-foreground">
							<ServerIcon class="size-3.5" />
							Public URL
						</dt>
						<dd class="font-mono text-xs">{settings.publicUrl ?? 'auto (from request host)'}</dd>
					</div>
				</dl>
			{/if}
		</CardContent>
	</Card>

	<!-- Change password -->
	<Card class="border-border/60">
		<CardHeader class="flex flex-row items-center gap-2">
			<LockIcon class="size-4 text-muted-foreground" />
			<CardTitle class="text-base">Change password</CardTitle>
		</CardHeader>
		<CardContent>
			<form onsubmit={changePassword} class="max-w-md space-y-4">
				<div class="space-y-2">
					<Label for="cur">Current password</Label>
					<Input
						id="cur"
						type="password"
						bind:value={currentPassword}
						autocomplete="current-password"
						placeholder="••••••••"
						required
					/>
				</div>
				<Separator />
				<div class="space-y-2">
					<Label for="new">New password</Label>
					<Input
						id="new"
						type="password"
						bind:value={newPassword}
						autocomplete="new-password"
						placeholder="At least 8 characters"
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="confirm">Confirm new password</Label>
					<Input
						id="confirm"
						type="password"
						bind:value={confirmPassword}
						autocomplete="new-password"
						placeholder="Re-enter the new password"
						required
					/>
					{#if confirmPassword && !passwordsMatch}
						<p class="text-xs text-destructive">Passwords do not match</p>
					{/if}
				</div>
				<div class="flex justify-end pt-1">
					<Button type="submit" disabled={saving || !canSave}>
						{#if saving}
							<Loader2Icon class="size-4 animate-spin" />
							Saving…
						{:else}
							Update password
						{/if}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
