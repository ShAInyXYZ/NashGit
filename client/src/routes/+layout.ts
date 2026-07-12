import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api';

export const prerender = false;
export const ssr = false; // SPA — auth state is client-side only

export const load = async ({ url }: { url: URL }) => {
	// Public paths that don't require an admin session.
	const publicPaths = ['/login'];
	const isPublic = publicPaths.some((p) => url.pathname === p);

	let me: { authenticated: boolean; username?: string };
	try {
		me = await api.auth.me();
	} catch {
		me = { authenticated: false };
	}

	if (!me.authenticated && !isPublic) {
		throw redirect(303, '/login');
	}
	if (me.authenticated && url.pathname === '/login') {
		throw redirect(303, '/');
	}

	return { username: me.username ?? null };
};
