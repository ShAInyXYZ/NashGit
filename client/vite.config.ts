import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const apiPort = loadEnv(mode, '.', 'NASHGIT_').NASHGIT_DEV_API_PORT ?? '3000';
	return {
	server: {
		host: '127.0.0.1',
		proxy: {
			'/api': `http://127.0.0.1:${apiPort}`,
			'^/git(?:/|$)': `http://127.0.0.1:${apiPort}`
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: false
			}),
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	]
}});
