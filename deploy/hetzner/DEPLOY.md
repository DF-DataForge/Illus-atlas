# Hetzner Ubuntu deployment

This guide prepares a single-host, non-Docker deployment of
[DF-DataForge/Illus-atlas](https://github.com/DF-DataForge/Illus-atlas) at
`/opt/illus-atlas`, with Node.js 24 LTS, systemd, Nginx, and HTTPS. It is a
deployment recipe, not evidence that the application or these instructions
have been tested on an Ubuntu 26.04 host. The operator is responsible for
reviewing and executing the steps; this repository does not install software
on or deploy to a remote machine.

## Deployment choices and limits

- The backend listens only on `127.0.0.1:5000`; Nginx serves the UI and exposes
  only `GET`/`HEAD /api/sales-points` and `GET`/`HEAD /api/health`. All other
  `/api` paths, regardless of letter case (including Odoo configuration/admin
  and BESS routes), are denied at the public proxy.
- Live sales points use the backend-only `ODOO_URL`, `ODOO_DATABASE`,
  `ODOO_USERNAME`, and `ODOO_PASSWORD` settings. The verkooppunt label/filter
  is fixed by the application; there is no deployment setting for changing it.
- `DATABASE_URL` is optional and is only for the legacy BESS/database API; it
  is not required by the public map. Do not provision or initialize that
  database unless you explicitly intend to enable BESS. `SESSION_SECRET` is
  currently unused.
- No data export, import, or schema migration runs automatically. If you
  explicitly enable the legacy BESS/database API, provision its database and
  review/plan schema setup separately; do not run `npm run db:push` without
  reviewing the schema changes and backing up the database.
- Secrets belong only in `/etc/illus-atlas.env`, never in Git, the browser, or
  the Nginx configuration. Do not put credentials in a clone URL.

`PUBLIC_SITE_URL` is a non-secret build-time setting, not a runtime secret:
pass the canonical public origin directly to the production build command.
`/etc/illus-atlas.env` is runtime-only; do not put `PUBLIC_SITE_URL` there.
The `https://atlas.example.com` value used below is a placeholder; replace it
with the actual HTTPS origin before building. If it is omitted, social image
URLs remain relative (the app does not substitute a Replit domain).

## 1. Prepare the Hetzner host and network

Create an Ubuntu 26.04 server and a Hetzner Cloud Firewall. Allow inbound TCP
22 (or your actual SSH port), 80, and 443 only. Do not expose port 5000.
Permit outbound DNS and HTTPS for package repositories, Odoo, and the
geocoding provider. Add DNS `A` records for `atlas.example.com` pointing at
the server's IPv4 address. Add an `AAAA` record only after IPv6 is configured
on the server, in the Hetzner firewall, and in the Nginx site.

Connect over SSH and update the OS:

```sh
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

Reconnect after the reboot. If UFW is used, allow SSH **before** enabling it;
replace/add the rule for your actual SSH port if it is not the default:

```sh
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status verbose
sudo ufw enable
```

Keep the Hetzner Cloud Firewall and host firewall rules aligned. Never enable a
firewall until you have confirmed its SSH rule preserves your current access.

## 2. Install Node.js 24 from the signed NodeSource APT repository

NodeSource's current Debian/Ubuntu instructions use a repository keyring and
APT `Signed-By` configuration with the `nodistro` suite. The commands below
follow that signed-repository setup for Node.js 24.x; see the official
[NodeSource distributions documentation](https://github.com/nodesource/distributions)
and [NodeSource 24.x setup](https://deb.nodesource.com/setup_24.x). The
NodeSource setup currently supports `amd64` and `arm64`; check its current
requirements for the target OS/architecture.

```sh
sudo apt install -y ca-certificates curl gnupg
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
sudo chmod 0644 /usr/share/keyrings/nodesource.gpg

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64|arm64) ;;
  *) echo "NodeSource setup does not list this architecture: $ARCH" >&2; exit 1 ;;
esac
printf 'Types: deb\nURIs: https://deb.nodesource.com/node_24.x\nSuites: nodistro\nComponents: main\nArchitectures: %s\nSigned-By: /usr/share/keyrings/nodesource.gpg\n' "$ARCH" \
  | sudo tee /etc/apt/sources.list.d/nodesource.sources >/dev/null

sudo apt update
apt-cache policy nodejs
sudo apt install -y nodejs git nginx certbot
command -v node
node --version
node -p 'process.execPath'
npm --version
```

Review `apt-cache policy nodejs` to confirm the candidate comes from
`deb.nodesource.com`. `command -v node` and `process.execPath` should resolve
to `/usr/bin/node`, as the supplied systemd unit expects.

## 3. Create the service account and clone the application

Create a locked, unprivileged service account with a home outside `/home`.
systemd's `ProtectHome=true` can then protect normal user homes without hiding
the service account's home:

```sh
sudo useradd --system --user-group \
  --home-dir /var/lib/illus-atlas --create-home \
  --shell /usr/sbin/nologin illus-atlas
sudo install -d -m 0755 /opt
```

Run the clone as your normal deployment/login account (not with `sudo`) so Git
uses that account's existing SSH-agent or credential-helper authentication.
If the repository is private, first set up that account's Git authentication
using your normal approved method. Do not put a token or password in the
remote URL.

```sh
DEPLOY_USER="$(id -un)"
sudo install -d -o "$DEPLOY_USER" -g illus-atlas -m 2750 /opt/illus-atlas
umask 0027
git clone https://github.com/DF-DataForge/Illus-atlas.git /opt/illus-atlas
```

The set-group-ID application directory gives its contents the
`illus-atlas` group; the restrictive umask keeps the checkout private to the
deployment account and service group. The service account only needs
read/traverse access to application code; it must not own or be able to modify
the deployed code. Keep the deployment account as the owner so it can update
the Git checkout with its own existing Git authentication.

## 4. Configure backend secrets

Create the root-owned, mode-0600 EnvironmentFile. systemd reads this file as
the system manager before dropping privileges to `illus-atlas`, so the service
account does not need read access to the file:

```sh
sudo install -o root -g root -m 0600 /dev/null /etc/illus-atlas.env
sudoedit /etc/illus-atlas.env
```

Put only backend settings in the file. For example, enter the actual values
privately in the editor; this template intentionally contains no credentials:

```ini
ODOO_URL=
ODOO_DATABASE=
ODOO_USERNAME=
ODOO_PASSWORD=
# Optional only when explicitly enabling the legacy BESS/database API:
# DATABASE_URL=
# SESSION_SECRET is currently unused.
```

Use systemd EnvironmentFile syntax (not shell commands); quote values if they
contain whitespace or special characters. Do not add `VITE_` credentials or
public sales-label configuration. Verify permissions after editing:

```sh
sudo chown root:root /etc/illus-atlas.env
sudo chmod 0600 /etc/illus-atlas.env
sudo stat -c '%U:%G %a %n' /etc/illus-atlas.env
```

## 5. Install, build, and start the systemd service

Install production dependencies **including dev dependencies** for TypeScript
checking, tests, and the build. Run these commands as the deployment account
from the clone; do not set npm's production/omit-dev configuration before
building:

```sh
cd /opt/illus-atlas
umask 0027
npm ci --include=dev
npm run check
npm test
PUBLIC_SITE_URL=https://atlas.example.com npm run build
npm prune --omit=dev
```

Install the supplied service unit, then start it:

```sh
sudo install -o root -g root -m 0644 \
  /opt/illus-atlas/deploy/hetzner/illus-atlas.service \
  /etc/systemd/system/illus-atlas.service
sudo systemctl daemon-reload
sudo systemctl enable --now illus-atlas
sudo systemctl status illus-atlas --no-pager
```

The unit starts `/usr/bin/node /opt/illus-atlas/dist/index.cjs` directly.
`NODE_ENV`, `HOST`, `PORT`, and the persistent geocoding cache path are set by
the unit. `CacheDirectory=illus-atlas` gives the service write access to
`/var/cache/illus-atlas`; `ProtectSystem=strict` and the unprivileged account
keep application code read-only at runtime. The application must honor `HOST`
and `GEOCODING_CACHE_FILE` for these settings to take effect.

Check the local listener and health endpoint before configuring the public
proxy:

```sh
sudo ss -ltnp | grep ':5000'
curl -fsS http://127.0.0.1:5000/api/health
```

The listener should be `127.0.0.1:5000`, not a public interface.

## 6. Obtain a certificate and install the Nginx proxy

The example Nginx site references a certificate, so first install a temporary
HTTP-only ACME challenge site. Replace `atlas.example.com` if you use another
domain, and make sure its DNS already points to this server:

```sh
sudo install -d -o root -g root -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
sudo tee /etc/nginx/sites-available/illus-atlas-bootstrap >/dev/null <<'NGINX'
server {
    listen 80;
    server_name atlas.example.com;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 404; }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/illus-atlas-bootstrap \
  /etc/nginx/sites-enabled/illus-atlas
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  -d atlas.example.com
```

After certificate issuance, install the full proxy example and disable the
temporary site/default site. Inspect existing Nginx sites before removing any
symlink that may serve other applications:

```sh
sudo install -o root -g root -m 0644 \
  /opt/illus-atlas/deploy/hetzner/nginx-atlas.example.conf \
  /etc/nginx/sites-available/illus-atlas
sudo ln -sfn /etc/nginx/sites-available/illus-atlas \
  /etc/nginx/sites-enabled/illus-atlas
sudo rm -f /etc/nginx/sites-enabled/illus-atlas-bootstrap
# Disable the stock default site only if it is enabled and not needed.
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
bash /opt/illus-atlas/deploy/hetzner/check-public-api.sh https://atlas.example.com
```

The example's `server_name` and certificate paths use the placeholder domain;
update all occurrences together if needed. It proxies the UI but allows only
the two read-only API paths described above. Its API response timeout is 60
seconds to accommodate the geocoding enrichment budget plus Odoo latency. It
does not expose port 5000.

Confirm the Certbot renewal timer is enabled, install a deploy hook so Nginx
reloads renewed certificates, and test renewal:

```sh
sudo systemctl enable --now certbot.timer
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' \
  | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx >/dev/null
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
sudo certbot renew --dry-run
```

If IPv6 is fully configured and allowed by the cloud/host firewalls, enable the
commented `[::]` listeners in the Nginx example before reloading and then add
the DNS `AAAA` record. Otherwise leave IPv6 listeners and `AAAA` records off.

## 7. Verify, monitor, and maintain

```sh
bash /opt/illus-atlas/deploy/hetzner/check-public-api.sh https://atlas.example.com
curl -I https://atlas.example.com/
sudo systemctl status illus-atlas --no-pager
sudo journalctl -u illus-atlas -n 100 --no-pager
```

The check script uses only benign requests: it discards every response body,
checks successful health and sales-points GETs, verifies unknown/admin-prefix
paths return 404 in lowercase and mixed/uppercase, and checks that POSTs to
the GET-only endpoints are rejected. Its POST probes never target legacy
configuration, sync, or systems handlers. It requires only Bash and curl
(already used in this guide); run it after TLS/Nginx setup and after every
application update. Nginx serves the UI at `/`. Follow ongoing service output
with `sudo journalctl -u illus-atlas -f`. The geocoding cache persists across
service restarts under `/var/cache/illus-atlas/geocoding.json`; it is a cache,
not application data or a substitute for backups.

## 8. Safe update and rollback

An in-place production build removes/replaces `dist`, and `npm ci`/prune
changes `node_modules`. To avoid serving a mixture of old and new files, use a
maintenance window and stop the service before changing the live checkout.
Record a known-good commit and confirm there are no uncommitted changes before
updating:

```sh
cd /opt/illus-atlas
git status --short
if test -n "$(git status --porcelain)"; then
  echo "Resolve or preserve local changes before updating." >&2
  exit 1
fi
GOOD_COMMIT="$(git rev-parse HEAD)"
printf 'Known-good commit: %s\n' "$GOOD_COMMIT"
printf '%s\n' "$GOOD_COMMIT" > "$HOME/illus-atlas-known-good-commit"
chmod 0600 "$HOME/illus-atlas-known-good-commit"
sudo systemctl stop illus-atlas
```

If `git status --short` is not empty, preserve/review local changes before
continuing; do not discard them. Update only by fast-forwarding the configured
branch, then build and verify **before** starting the service again:

```sh
cd /opt/illus-atlas
git fetch origin
git pull --ff-only
umask 0027
npm ci --include=dev
npm run check
npm test
PUBLIC_SITE_URL=https://atlas.example.com npm run build
npm prune --omit=dev
sudo systemctl start illus-atlas
sudo systemctl status illus-atlas --no-pager
curl -fsS http://127.0.0.1:5000/api/health
bash /opt/illus-atlas/deploy/hetzner/check-public-api.sh https://atlas.example.com
```

If the update fails before start, keep the service stopped, inspect and
preserve any working-tree changes, and return to the exact recorded commit
only after ensuring the checkout is clean. Do not use `git reset --hard` or
blindly overwrite local changes:

```sh
cd /opt/illus-atlas
GOOD_COMMIT="$(cat "$HOME/illus-atlas-known-good-commit")"
git status --short
# Save/resolve any local changes first. Then, if the checkout is clean:
if test -n "$(git status --porcelain)"; then
  echo "Preserve or resolve local changes before rollback." >&2
  exit 1
fi
git switch --detach "$GOOD_COMMIT"
umask 0027
npm ci --include=dev
npm run check
npm test
PUBLIC_SITE_URL=https://atlas.example.com npm run build
npm prune --omit=dev
sudo systemctl start illus-atlas
sudo systemctl status illus-atlas --no-pager
bash /opt/illus-atlas/deploy/hetzner/check-public-api.sh https://atlas.example.com
```

If Git refuses to switch because of local changes, stop and preserve them (for
example, make a reviewed backup or a separate Git worktree) rather than
forcing the checkout. Keep the known-good commit identifier and a database
backup for any separately managed BESS database; application rollback does not
roll back or migrate database contents.