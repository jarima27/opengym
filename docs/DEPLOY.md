# Deploying app.tiza.fit

The hosted service runs on one small Hetzner server, with Cloudflare in front and the data backed
up every night to Cloudflare R2. Everything the server runs is in [`deploy/`](../deploy): one
compose file, two scripts and three settings templates. This guide goes from "the accounts exist"
to "it is live and the backups restore".

```
browser / store app ──HTTPS──▶ Cloudflare (app.tiza.fit) ──tunnel──▶ cloudflared ──▶ web ──/api──▶ api
                                                                                             │
                                               R2 bucket ◀──restic, encrypted, nightly── backup ◀─ data/
```

- **No open ports.** `cloudflared` opens the tunnel from inside the server, so the firewall can
  refuse every inbound connection. HTTPS, the certificate and the redirect from `http://` are
  Cloudflare's.
- **The data** is the `data/` folder: accounts, passkeys, everyone's workouts, subscriptions,
  the session key, uploaded photos and videos. It is the only thing that needs backing up; the
  server itself can be rebuilt from this guide in half an hour.
- **Backups**: [restic](https://restic.net) snapshots of `data/` to R2, encrypted on the server
  before they leave it. The newest snapshot of each of the last 30 days and of each of the last 12
  months are kept. Each night's backup is followed by a test restore of the essentials, and once a
  week by a check that reads back a tenth of the stored data.

## What you need

- A **Hetzner Cloud** account.
- A **Cloudflare** account with `tiza.fit` on it (Cloudflare's nameservers set at the registrar),
  and R2 enabled (it asks for a payment method; backups this size start well inside R2's free
  allowance).
- A **released version**: the images `ghcr.io/jarima27/tiza-api` and `tiza-web` with its tag,
  built by the mirror ([RELEASING.md](RELEASING.md)), and the two packages made public in GitHub
  → Packages (or a token to pull them, step 6).
- A **password manager** for three secrets that must outlive the server: the backup password, the
  R2 keys and the tunnel token.

## 1. Cloudflare settings for tiza.fit

In the Cloudflare dashboard, for the `tiza.fit` zone:

1. **SSL/TLS → Edge Certificates → Always Use HTTPS: on.**
2. **Security → Bots → Bot Fight Mode: off.** It challenges requests that do not come from a
   browser, and three kinds of request that must get through do not: Stripe's and RevenueCat's
   webhooks, and the store app's sign-in, which talks to the server over native HTTP. A
   challenged webhook is a subscription that never activates.
3. Leave **Rocket Loader** off (the default). It rewrites the page's scripts.

## 2. The server

1. **Hetzner Console → Security → SSH keys → Add SSH key**: your public key
   (`cat ~/.ssh/id_ed25519.pub`; `ssh-keygen -t ed25519` if you have none).
2. **Firewalls → Create Firewall**, name `tiza`. Inbound rules: only **SSH, TCP 22, source: your
   own IP address** (or no rule at all, and use the console in Hetzner's dashboard instead of
   SSH). No rule for 80 or 443: nothing comes in that way. Outbound: leave it open (the tunnel,
   R2, Stripe, push services).
3. **Servers → Add Server**:
   - Location: an EU one (Nuremberg, Falkenstein or Helsinki).
   - Image: **Ubuntu 24.04**.
   - Type: the smallest shared-vCPU plan with 2 vCPUs and 4 GB (x86 or Arm — the images are
     built for both).
   - Networking: public IPv4 and IPv6.
   - SSH key: yours. Firewall: `tiza`. Name: `tiza-1`.
   Hetzner's own server backups are not needed: the server holds nothing that is not in R2 or in
   this guide.
4. Log in and bring it up to date:

   ```bash
   ssh root@<server IPv4>
   apt update && apt -y full-upgrade
   systemctl status unattended-upgrades --no-pager   # security updates install themselves: "active"
   curl -fsSL https://get.docker.com | sh            # Docker Engine + the compose plugin
   reboot
   ```

5. Fetch the kit of the version you are deploying (the same tag as the images):

   ```bash
   ssh root@<server IPv4>
   mkdir -p /opt/tiza && cd /opt/tiza
   V=1.0.0
   for f in compose.yml backup.sh check.sh .env.example tiza.env.example backup.env.example; do
     curl -fsSLO "https://raw.githubusercontent.com/jarima27/opengym/v$V/deploy/$f"
   done
   chmod +x backup.sh check.sh
   cp .env.example .env && cp tiza.env.example tiza.env && cp backup.env.example backup.env
   chmod 600 .env tiza.env backup.env
   ```

   From here on every command runs in `/opt/tiza`.

## 3. The R2 bucket

1. **R2 → Create bucket**: name `tiza-backups`, **Location: Specify jurisdiction → European
   Union (EU)**. Nothing else to set: no public access, no lifecycle rules (restic deletes what
   the retention policy lets go).
2. **R2 → Manage API tokens → Create API token**: name `tiza-backup`, permission **Object Read &
   Write**, **Specify bucket(s): `tiza-backups`** only, no expiry. Copy the **Access Key ID** and
   the **Secret Access Key** — the secret is shown once — and the **S3 endpoint for the EU
   jurisdiction**, which looks like `https://<account id>.eu.r2.cloudflarestorage.com`.
3. Make the backup password, and save it in the password manager *before* going on — it is the
   only key to the backups, and nobody can recover it:

   ```bash
   openssl rand -base64 32
   ```

4. Fill in `backup.env`:

   ```env
   RESTIC_REPOSITORY=s3:https://<account id>.eu.r2.cloudflarestorage.com/tiza-backups
   AWS_ACCESS_KEY_ID=<Access Key ID>
   AWS_SECRET_ACCESS_KEY=<Secret Access Key>
   AWS_DEFAULT_REGION=auto
   RESTIC_PASSWORD=<the password from 3>
   ```

   The repository is created by the backup service the first time it starts.

5. Optional but worth it: a free check at [healthchecks.io](https://healthchecks.io) (period 1
   day, grace 2 hours), with its ping URL as `BACKUP_PING_URL` in `backup.env`. A night without a
   successful backup then sends you an e-mail.

## 4. The tunnel

1. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, name `tiza`.
2. On the install screen choose **Docker**, and copy the token: the long string after `--token`
   in the command shown. Do not run that command — compose runs cloudflared. Put the token in
   `.env`:

   ```env
   TUNNEL_TOKEN=<the token>
   ```

3. Next, add the route (*Public hostname*; newer dashboards call it a *published application
   route*): subdomain **`app`**, domain **`tiza.fit`**, path
   empty, service type **HTTP**, URL **`web:80`**. Cloudflare creates the DNS record itself.
4. Optional: **Notifications → Add → Tunnel Health Alert** for the `tiza` tunnel, so a tunnel
   that goes down e-mails you.

## 5. The app's settings

1. `.env`: `TIZA_VERSION` is the version you are deploying (`1.0.0`, without the `v`).
   `BACKUP_AT` and `TZ` can stay as they are (03:30, Madrid time).
2. `tiza.env`: the address is already `app.tiza.fit`. Fill in what you have — each block is
   explained in the file and in [SELF_HOSTING.md](SELF_HOSTING.md):
   - Stripe: secret key, the two price ids, and the webhook secret of an endpoint at
     `https://app.tiza.fit/api/billing/webhook` (events in SELF_HOSTING.md → *Charging for
     access*).
   - RevenueCat: webhook at `https://app.tiza.fit/api/billing/revenuecat` with an Authorization
     header of your choosing, the same string in `REVENUECAT_WEBHOOK_AUTH`; the secret API key.
   - Sign in with Apple and Google: the bundle id and the OAuth client ids (and the Apple key for
     revoking tokens).
   - `YMOVE_API_KEY`, and `POSTHOG_KEY` if you use it.
   - `RESEND_API_KEY` and `RESEND_FROM` for the lifecycle emails, once `tiza.fit` is verified in
     Resend (its SPF and DKIM records go in Cloudflare's DNS, plus a DMARC record) — SELF_HOSTING.md
     → *Lifecycle emails*.
   - `STRIPE_TRIAL_DAYS=7` and `TRIAL_DAYS=0` (the 7-day trial with a card, no open trial): the
     trial must match what the website promises (`prices.trialDays` in
     `landing/site.config.json`), and so must the prices in Stripe (7,99 €/month, 39,99 €/year).
   - `STRIPE_EXIT_COUPON`: a Stripe coupon of 10 € off, duration *once*, for the offer made once
     as the paywall after the first plan is closed (39,99 € → 29,99 € the first year). Without
     it, the website makes no second offer.

   Anything left empty is simply off, and can be added later (step 9).

## 6. Start it

If the image packages are private, log the server in to GitHub's registry first, with a token
that has only `read:packages`:

```bash
docker login ghcr.io -u jarima27
```

Then:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

After a minute `api`, `web` and `cloudflared` show **healthy**. `backup` shows healthy once the
first backup is in R2 — it makes one at start, since R2 has nothing yet:

```bash
docker compose logs backup
# backup: no repository at s3:…/tiza-backups yet — creating it
# backup: nothing in R2 from the last day — backing up now
# backup: restore checked: no profiles yet, session key present
# backup: next backup in 5h12m
```

## 7. Make yourself admin

1. Open `https://app.tiza.fit` and create your own account.
2. Find its id (the backup image has `jq`):

   ```bash
   docker compose run --rm --entrypoint jq backup -r '.users[] | "\(.id)  \(.name)"' /data/db.json
   ```

3. Put it in `tiza.env` as `ADMIN_UIDS=<id>` and apply it with `docker compose up -d` (only `up`
   re-reads the settings; `restart` does not).

## 8. Check that everything works

From your own computer (or the server), with the kit's `check.sh` and the server's IPv4:

```bash
./check.sh https://app.tiza.fit <server IPv4>
```

```
Checking https://app.tiza.fit
  ok    api answers ({"ok":true,"users":1})
  ok    the app loads
  ok    security headers
  ok    dataset media off (© Gym visual)
  ok    exercise videos on
  ok    billing on
  ok    Apple/Google sign-in on: ["apple","google"]
  ok    e-mail sign-in on
  ok    /img/ answers 404
  ok    /api/billing/webhook reaches the api (400 without a signature)
  ok    /api/billing/revenuecat reaches the api (401 without a signature)
  ok    http redirects to https
  warn  port 22 (SSH) is open on 203.0.113.10 — fine if only your address may use it
  ok    port 80 closed on 203.0.113.10
  ...
All good.
```

`FAIL` lines need fixing; `warn` lines are things not configured yet. Then, by hand:

- **Passkeys**: in Settings, add a passkey and sign in with it on another device.
- **Push**: turn notifications on in Settings and start and finish a rest timer with the app in
  the background.
- **Stripe**: in the webhook's page, *Send test event* → answered `200`.
- **RevenueCat**: *Send test event* from the webhook's page → answered `200`.
- **The store app**: sign in with Apple, Google and an e-mail.
- **Backups**: `docker compose exec backup sh /backup/backup.sh snapshots` lists at least one.

## 9. Restoring

Three situations, one command. `restore` always writes to `./restore/<snapshot>/`, never over
the live `data/`, which the backup container can only read; moving it into place is by hand.

**See what is there:**

```bash
docker compose exec backup sh /backup/backup.sh snapshots
```

**Get back a file or look at an old state** (an admin deleted the wrong profile yesterday):

```bash
docker compose exec backup sh /backup/backup.sh restore <snapshot id>
ls restore/<snapshot id>/data
```

and copy what you need from there.

**Put a whole snapshot back** (the data is damaged, or a bad update):

```bash
docker compose exec backup sh /backup/backup.sh restore            # the newest; or give an id
docker compose stop
sudo mv data data.before-restore-$(date +%F-%H%M)
sudo mv restore/<snapshot id>/data data
docker compose up -d --force-recreate
./check.sh https://app.tiza.fit
```

Stop and recreate *every* service, the backup included: a container keeps the folder it was
started with, so one left running would go on backing up the folder you just moved away. (The
backup refuses a folder without the session key in it, so that mistake shows up as a failed
backup rather than as empty snapshots.) Everyone stays signed in — the session key comes back
with the data — and anything done between the snapshot and now is lost, except what the phones
still hold and sync again.

**On a new server** (the old one is gone): steps 2 to 5 with the same `backup.env` (from the
password manager) and the same tunnel token. Then restore *before* starting anything:

```bash
docker compose pull
docker compose run --rm backup restore      # a one-off container: restores, checks, exits
sudo rm -rf data && sudo mv restore/<snapshot id>/data data
docker compose up -d
./check.sh https://app.tiza.fit
```

`run --rm backup restore` runs the restore alone; it does not start the nightly schedule. Start
the api only after the data is in place: on an empty `data/` it would make a new session key and
an empty instance — and the backup service, started with it, would file that empty instance in R2
as the day's snapshot. The new server takes over the tunnel; switch the old one off if it still
runs.

**The drill.** Do the "new server" restore once now, before anyone signs up, and then every few
months, on a throwaway server (the smallest, billed by the hour) with the same `backup.env` —
steps 2.1 to 2.5, `TIZA_VERSION` in `.env` and `TUNNEL_TOKEN=unused`:

```bash
docker compose pull api backup
docker compose run --rm backup restore
docker run --rm --network none -v "$PWD/restore/<snapshot id>/data:/data" -e DATA_DIR=/data \
  ghcr.io/jarima27/tiza-api:<version> \
  sh -c 'node server.js >/dev/null 2>&1 & sleep 5; wget -qO- http://127.0.0.1:3000/api/health'
```

The last command boots the real api on the restored data and must answer
`{"ok":true,"users":N}` with production's number of users. It runs with no network on purpose:
the restored data holds everyone's push subscriptions and the keys to send to them, and a second
server sending reminders would reach real phones. For the same reason the drill never starts the
`backup` service (it would write to production's R2) and never `docker compose up`. Delete the
server afterwards.

Between drills, every night's backup restores the essentials of the snapshot it has just made and
checks them (`backup: restore checked: …` in its log), so a backup that would not restore fails
that night, not on the day you need it.

## 10. Day to day

**Updating** to a new release:

```bash
docker compose exec backup sh /backup/backup.sh now     # a fresh snapshot first
sed -i 's/^TIZA_VERSION=.*/TIZA_VERSION=1.0.1/' .env
docker compose pull && docker compose up -d
./check.sh https://app.tiza.fit
```

When a release changes the kit itself (its notes say so), fetch the new `compose.yml` and
`backup.sh` as in step 2.5 before `up -d`. Going back is the same with the previous version.

**Watching it.** `docker compose ps` (all *healthy*), `docker compose logs --tail 100 api`, the
healthchecks.io e-mail if a backup is missed, Cloudflare's tunnel alert. Disk:
`df -h /` — the containers' logs are capped at 30 MB each.

**Secrets.** To change one, edit the file and `docker compose up -d`. A new R2 key: create it,
put it in `backup.env`, `docker compose up -d backup`, then delete the old one in Cloudflare.
The backup password cannot simply be changed in the file: the repository is encrypted with it
(`restic key add` / `restic key remove` inside the backup container, if it ever must).

## When something is wrong

- **Error 1033 or 502 from Cloudflare**: the tunnel is down or cannot reach `web`.
  `docker compose ps` and `docker compose logs cloudflared` — "Registered tunnel connection"
  four times is healthy; "Unauthorized" means a wrong `TUNNEL_TOKEN`. In the tunnel's route the
  URL must be `web:80`, type HTTP.
- **Passkeys fail**: `RP_ID` and `ORIGIN` in `tiza.env` must be exactly `app.tiza.fit` and
  `https://app.tiza.fit`. SELF_HOSTING.md → *Passkeys fail even though RP_ID looks right*.
- **Webhooks fail, or the app cannot sign in**: `check.sh` says whether Cloudflare challenges
  them; Bot Fight Mode off (step 1), and no WAF rule in front of `/api/`.
- **`backup` unhealthy**: `docker compose logs backup`. "RESTIC_PASSWORD does not open the
  repository" — the password in `backup.env` is not the one the backups were made with;
  "cannot reach the repository" — the endpoint, bucket name or keys.
- **`docker compose pull` is denied**: the packages are private; make them public or
  `docker login ghcr.io` (step 6).
