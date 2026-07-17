# Remote access — push and pull from anywhere

NashGit serves plain HTTP on your LAN. To reach it when you're away from home,
don't forward a port on your router — put NashGit on a private overlay network
instead. [Tailscale](https://tailscale.com) is the recommended option: free for
personal use, no router changes, encrypted end to end, and NashGit needs no
configuration changes at all.

> NashGit already has its own auth layers — the admin login for the web UI and
> deploy tokens for git operations. Tailscale adds the network layer: your NAS
> simply becomes reachable from your other devices, wherever they are.

---

## Option A — Tailscale (recommended)

### 1. Install Tailscale on the NAS

- **Synology / QNAP / TrueNAS / Unraid**: install the Tailscale package from the
  NAS package/app store.
- **Generic Linux**: `curl -fsSL https://tailscale.com/install.sh | sh`
- Or run it as a container alongside NashGit.

### 2. Install Tailscale on your other devices

Laptop, phone, work machine — anything you push from. Log them all into the same
Tailscale account (or share the node).

### 3. Use the tailnet name

Every device gets a stable name like `nas.tail1234.ts.net` (enable
[MagicDNS](https://tailscale.com/kb/1081/magicdns) in the admin console). Then,
from anywhere:

```bash
# Web UI
http://nas:3000

# Git remote — same deploy token as the password, exactly as on the LAN
git remote add nas http://nas:3000/git/my-project.git
git push nas main
```

Nothing else changes: same UI, same tokens, same URLs — only reachable from
*your* devices, never the public internet.

### Optional: HTTPS inside the tailnet

Tailscale can issue a real certificate for your node:

```bash
sudo tailscale cert nas.tail1234.ts.net
# or proxy the app with automatic TLS:
sudo tailscale serve --bg --set-path / http://localhost:3000
```

Then reach NashGit at `https://nas.tail1234.ts.net` — valid certificate, no
self-signed warnings, and the admin session cookie's `Secure` flag activates
automatically.

---

## Option B — Tailscale Funnel (public HTTPS)

If you need access from machines that can't join your tailnet (a CI runner, a
borrowed laptop), Funnel exposes NashGit to the public internet through
Tailscale's ingress with a valid certificate:

```bash
sudo tailscale funnel --bg --set-path / http://localhost:3000
```

> [!CAUTION]
> Funnel makes NashGit reachable by **anyone on the internet**. The deploy-token
> auth and rate limiting still protect you, but you're now relying on them alone.
> Prefer Option A; use Funnel only if you genuinely need it, and rotate tokens
> if you stop.

---

## Option C — Your own reverse proxy / VPN

Anything that gets HTTP to the NAS works:

- **WireGuard** to your home network (many routers support it natively)
- **Cloudflare Tunnel** (`cloudflared`) for public HTTPS without port forwarding
- **nginx / Caddy / Traefik** with a real domain and Let's Encrypt — set
  `NASHGIT_PUBLIC_URL=https://git.example.com` so clone URLs in the UI match

Whichever you choose, git clients just see an HTTP(S) remote; tokens work the
same way through all of them.

---

## Quick comparison

| Option | Public internet | TLS | Setup effort | Best for |
|---|---|---|---|---|
| Tailscale (A) | No — your devices only | optional (`tailscale serve`) | low | daily remote push/pull |
| Tailscale Funnel (B) | Yes | yes, automatic | low | CI runners, one-off machines |
| WireGuard / router VPN | No | no | medium | already have a VPN |
| Cloudflare Tunnel | Yes | yes, automatic | medium | want a public domain, no VPS |
| Reverse proxy + domain | Yes | yes, Let's Encrypt | medium | permanent public hostname |
