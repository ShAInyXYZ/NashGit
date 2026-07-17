# NashGit over Tailscale — setup and hardening

This guide takes you from "NashGit on my LAN" to "NashGit reachable from all my
devices, anywhere, with no public exposure" — and then locks the setup down.

Estimated time: **15 minutes**.

---

## 1. Install Tailscale

**On the NAS:**

| Platform | How |
|---|---|
| Synology | Package Center → search "Tailscale" → Install |
| QNAP | App Center → Tailscale |
| Unraid | Community Apps → Tailscale plugin |
| TrueNAS SCALE | Apps → Tailscale |
| Plain Linux | `curl -fsSL https://tailscale.com/install.sh \| sh` |

**On every device you push/pull from** (laptop, desktop, phone):
[tailscale.com/download](https://tailscale.com/download) — Windows, macOS,
Linux, iOS, Android.

Log **all** devices into the same Tailscale account. The free personal plan
(100 devices) is more than enough.

---

## 2. Verify connectivity

On the NAS:

```bash
tailscale status        # should show your devices
tailscale ip -4         # e.g. 100.64.1.10
```

On your laptop:

```bash
tailscale status
ping nas                # the NAS machine name
```

If `ping` resolves the short name, MagicDNS is working (it's on by default for
most tailnets; check **DNS** in the [admin console](https://login.tailscale.com/admin/dns)).

---

## 3. Point git at the tailnet name

Everything works exactly as on the LAN — only the host changes:

```bash
# Web UI (from any of your devices, anywhere in the world)
http://nas:3000

# Git remote
git remote add nas http://nas:3000/git/my-project.git
git push nas main
# Username: anything
# Password: your deploy token (ngt_...)
```

Done. At this point you already have working remote access. The rest of this
document is **hardening** — do it once.

---

## 4. Hardening checklist

### 4.1 Enable HTTPS inside the tailnet (recommended)

Tailscale issues real certificates for your nodes. This gets you
`https://nas.tail1234.ts.net` with a browser-trusted cert — and NashGit's
session cookie automatically flips to `Secure`.

**One-time setup** (admin console): open
[DNS → HTTPS Certificates](https://login.tailscale.com/admin/dns) and enable
them for your tailnet.

**On the NAS:**

```bash
# Proxy NashGit with automatic TLS on port 443
sudo tailscale serve --bg --set-path / http://localhost:3000

# Verify
sudo tailscale serve status
```

Now use `https://nas.tail1234.ts.net` everywhere — for the UI and for git remotes:

```bash
git remote set-url nas https://nas.tail1234.ts.net/git/my-project.git
```

> **Also update NashGit's config**: set `NASHGIT_PUBLIC_URL=https://nas.tail1234.ts.net`
> in your `.env` so the clone URLs shown in the UI use the right base.

### 4.2 Lock down the NAS with Tailscale ACLs

Default tailnet ACLs let any of your devices reach any port on any other
device. Tighten it so only port 3000 is reachable on the NAS:

Admin console → [Access Controls](https://login.tailscale.com/admin/acls):

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["autogroup:member"],
      "dst": ["nas:*"]
    },
    {
      "action": "accept",
      "src": ["autogroup:member"],
      "dst": ["*:22"]
    }
  ]
}
```

Adjust to taste — the goal is: NashGit's port open, everything else closed
unless you need it. (The exact host selector depends on how you tag the node;
the admin console suggests valid values as you type.)

### 4.3 Disable key expiry on the NAS only

Tailscale nodes re-authenticate periodically by default. For a headless server,
disable key expiry **for the NAS only** (keep it for your laptop/phone):

Admin console → Machines → your NAS → ⋯ → **Disable key expiry**.

### 4.4 Keep Tailscale Funnel OFF unless you need it

`tailscale funnel` exposes NashGit to the **public internet**. You don't need
it for personal remote access. Verify it's off:

```bash
tailscale funnel status   # should show nothing
```

If you ever enable it intentionally (CI runners, etc.), treat it as public
hosting: HTTPS only, strong admin password, rotate deploy tokens regularly.

### 4.5 Rotate deploy tokens

Tokens grant push/pull to every repo. Good hygiene:

- One token per machine (name them: `laptop`, `work-pc`, `phone`)
- Revoke immediately if a device is lost (`Tokens` page → delete)
- Rotate every few months — create new, update the remote, delete old

### 4.6 Stop listening on the LAN (optional, strictest)

If you want NashGit reachable **only** via Tailscale — not even on your home
LAN — bind it to the tailnet interface. In `docker-compose.yml`:

```yaml
ports:
  - "100.64.1.10:3000:3000"   # your NAS's Tailscale IP
```

(Then `tailscale serve` keeps working because it connects to localhost via the
host network — if you use this binding, point serve at the tailnet IP instead,
or keep a `127.0.0.1:3000:3000` mapping for serve and drop the LAN one.)

### 4.7 Backups still matter

Tailscale changes nothing about backups: `./data` on the NAS is your backup.
Keep your snapshot/rsync routine. See the Security section of the README.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `http://nas:3000` doesn't resolve | Enable MagicDNS in admin console → DNS |
| Browser says "certificate invalid" | You're on plain `http://`; set up `tailscale serve` (§4.1) |
| git asks for a password you never set | The password is your **deploy token** (`ngt_...`), not the admin password |
| Works at home, fails on cellular | Device's Tailscale is off — check the app |
| Can't reach NAS after months away | Key expiry hit — re-auth the NAS (`sudo tailscale up`), then disable key expiry (§4.3) |

---

## 6. What NashGit guarantees here

- **Admin UI** — bcrypt password, httpOnly JWT, rate-limited login, `Secure`
  cookie over HTTPS.
- **Git transport** — deploy-token Basic auth, bcrypt-verified, rate-limited,
  prefix-indexed lookup.
- **Network** — Tailscale's WireGuard mesh: encrypted end to end, zero open
  router ports, zero public exposure.

Each layer is independent; a failure of one does not expose the others.
