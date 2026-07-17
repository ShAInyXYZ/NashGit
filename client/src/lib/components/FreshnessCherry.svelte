<script lang="ts">
	import type { Freshness } from '$lib/api';

	interface Props {
		state: Freshness;
		size?: number;
	}

	let { state, size = 16 }: Props = $props();

	// Cherry color per freshness: plump red → deep red → brown → gray.
	const COLORS: Record<Freshness, string> = {
		fresh: 'hsl(348 83% 58%)',
		ripe: '#a31621',
		stale: '#7a5230',
		withered: '#5c5c5c',
		unknown: '#3f3f46'
	};

	let color = $derived(COLORS[state]);
</script>

<svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true">
	<path
		d="M185 245 C210 175 240 125 262 92"
		stroke={color}
		stroke-width="16"
		stroke-linecap="round"
		fill="none"
	/>
	<path
		d="M345 245 C320 175 290 125 268 92"
		stroke={color}
		stroke-width="16"
		stroke-linecap="round"
		fill="none"
	/>
	<ellipse cx="305" cy="102" rx="64" ry="32" transform="rotate(-22 305 102)" fill={color} />
	<circle cx="185" cy="325" r="92" fill={color} />
	<circle cx="345" cy="325" r="92" fill={color} />
</svg>
