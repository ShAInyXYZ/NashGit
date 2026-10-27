import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { getRepo } from '../git/repos.js';
import { availableGitHubRepos, createPrivateGitHubRepo, getLink, githubAccount, githubEnabled, githubRepo,
  listLinks, preview, removeLink, saveLink, syncToGitHub } from '../github/service.js';

export const githubRouter = Router();
githubRouter.use(requireAdmin);

githubRouter.get('/status', asyncHandler(async (_req, res) => {
  if (!githubEnabled()) {
    res.json({ enabled: false, connected: false, account: null,
      message: 'GitHub sync uses the GitHub CLI login on the local development machine. It is not configured on this server.' });
    return;
  }
  try {
    const account = await githubAccount();
    res.json({ enabled: true, connected: true, account });
  } catch {
    res.json({ enabled: true, connected: false, account: null,
      message: 'GitHub is unavailable. Run gh auth login on this machine, then refresh.' });
  }
}));

githubRouter.use((_req, res, next) => {
  if (!githubEnabled()) {
    res.status(503).json({ error: 'GitHub sync is available on the local NashGit development server only.' });
    return;
  }
  next();
});

function githubError(res: any, error: unknown, action: string): void {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Enter a GitHub repository') || message.startsWith('Link this') ||
    message.startsWith('Use letters') || message.startsWith('Description must') ||
    message.startsWith('This GitHub repository is already') ||
    message.startsWith('The connected') || message.startsWith('This GitHub repository') ||
    message.startsWith('NashGit branch') || message.startsWith('A GitHub sync') ||
    message.startsWith('The branches changed') || message.startsWith('GitHub has commits') ||
    message.startsWith('Confirm that')) {
    res.status(409).json({ error: message });
  } else {
    res.status(502).json({ error: `${action} failed. Check the GitHub CLI login and network connection on this machine.` });
  }
}

githubRouter.get('/available', asyncHandler(async (_req, res) => {
  try {
    const { login } = await githubAccount();
    res.json(await availableGitHubRepos(login));
  } catch (error) { githubError(res, error, 'Loading GitHub repositories'); }
}));

githubRouter.get('/links', (_req, res) => res.json(listLinks()));

githubRouter.post('/repos/:name/create-private', asyncHandler(async (req, res) => {
  const repo = await getRepo(req.params.name);
  if (!repo) { res.status(404).json({ error: 'NashGit repository not found' }); return; }
  if (!repo.defaultBranch) { res.status(409).json({ error: 'Push a branch to NashGit before creating its GitHub destination' }); return; }
  if (getLink(repo.name)) { res.status(409).json({ error: 'Remove the existing GitHub link first' }); return; }
  const name = req.body?.name;
  const description = req.body?.description;
  if (typeof name !== 'string' || typeof description !== 'string') {
    res.status(400).json({ error: 'Name and description are required' }); return;
  }
  try {
    const created = await createPrivateGitHubRepo(name.trim(), description.trim());
    saveLink(repo.name, created.nameWithOwner);
    res.status(201).json({ repo: created, link: getLink(repo.name) });
  } catch (error) { githubError(res, error, 'Creating the private GitHub repository'); }
}));

githubRouter.put('/links/:name', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) { res.status(404).json({ error: 'NashGit repository not found' }); return; }
  const fullName = req.body?.githubRepo;
  if (typeof fullName !== 'string') { res.status(400).json({ error: 'Choose a GitHub repository' }); return; }
  try {
    const remote = await githubRepo(fullName.trim());
    if (!remote.canPush) { res.status(403).json({ error: 'This account cannot push to that GitHub repository' }); return; }
    if (remote.isArchived) { res.status(409).json({ error: 'This GitHub repository is archived' }); return; }
    saveLink(req.params.name, remote.nameWithOwner);
    res.json(getLink(req.params.name));
  } catch (error) { githubError(res, error, 'Linking the repository'); }
}));

githubRouter.delete('/links/:name', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) { res.status(404).json({ error: 'NashGit repository not found' }); return; }
  removeLink(req.params.name);
  res.json({ ok: true });
}));

githubRouter.get('/repos/:name/preview', asyncHandler(async (req, res) => {
  const repo = await getRepo(req.params.name);
  if (!repo) { res.status(404).json({ error: 'NashGit repository not found' }); return; }
  if (!repo.defaultBranch) { res.status(409).json({ error: 'Push a branch to NashGit before syncing' }); return; }
  try { res.json(await preview(repo.name, repo.defaultBranch)); }
  catch (error) { githubError(res, error, 'Checking branches'); }
}));

githubRouter.post('/repos/:name/sync', asyncHandler(async (req, res) => {
  const repo = await getRepo(req.params.name);
  if (!repo) { res.status(404).json({ error: 'NashGit repository not found' }); return; }
  if (!repo.defaultBranch) { res.status(409).json({ error: 'Push a branch to NashGit before syncing' }); return; }
  const { expectedLocal, expectedRemote, acknowledgePublic } = req.body ?? {};
  if (typeof expectedLocal !== 'string' || !/^[0-9a-f]{40,64}$/.test(expectedLocal) ||
    (expectedRemote !== null && (typeof expectedRemote !== 'string' || !/^[0-9a-f]{40,64}$/.test(expectedRemote))) ||
    typeof acknowledgePublic !== 'boolean') {
    res.status(400).json({ error: 'Refresh the GitHub preview before syncing' }); return;
  }
  try { res.json(await syncToGitHub(repo.name, repo.defaultBranch, expectedLocal, expectedRemote, acknowledgePublic)); }
  catch (error) { githubError(res, error, 'GitHub sync'); }
}));
