export type PreviewState = 'ready' | 'current' | 'new-branch' | 'blocked';

export function syncState(localHash: string, remoteHash: string | null, ancestor: boolean): { state: PreviewState; reason: string } {
  if (!remoteHash) return { state: 'new-branch', reason: 'This branch does not exist on GitHub yet.' };
  if (remoteHash === localHash) return { state: 'current', reason: 'GitHub already has this commit.' };
  if (ancestor) return { state: 'ready', reason: 'GitHub can move forward to this NashGit commit.' };
  return { state: 'blocked', reason: 'GitHub has commits that are not in this NashGit branch. Resolve them locally first.' };
}
