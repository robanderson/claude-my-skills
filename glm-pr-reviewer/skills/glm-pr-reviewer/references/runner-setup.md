# Runner setup (Gitea / Forgejo Actions)

The workflow needs a runner online with the `ubuntu-latest` label. This file
covers installing one — including the TrueNAS SCALE app path — and the
non-obvious failures that cost real time.

## Quick checklist

1. Actions enabled on the instance and on the repo (repo Settings → Actions).
2. A runner registered and showing **Idle/online** in
   `Site Administration → Actions → Runners` (Gitea: `/-/admin/actions/runners`;
   Forgejo: `/admin/actions/runners`).
3. The runner's `ubuntu-latest` label maps to an image with **Node 18+** (the
   `catthehacker/ubuntu:act-latest` or `gitea/runner-images:ubuntu-latest`
   images do).
4. For Docker-executor jobs, the runner can reach a Docker daemon (see below).

## Generating a registration token

- **Gitea:** Admin → Actions → Runners → "Create new Runner" reveals a
  registration token. Reusable. Instance-, org-, or repo-level all work.
- **Forgejo:** Admin → Actions → Runners → "Show registration token". (Newer
  Forgejo marks this "deprecated" in favor of declarative config — see the
  token-format gotcha below.)

## Installing a runner on TrueNAS SCALE (community apps)

Apps → Discover → search "runner":

- **Gitea Act Runner** — fields: Instance URL, Runner Name, Runner Registration
  Token, optional Labels (these are *Docker container metadata* labels, NOT
  runner job labels — leave empty to use act_runner's built-in defaults).
- **Forgejo Runner** — fields: Instance URL, Runner UUID, Runner Registration
  Token, Runner Labels (job labels, e.g. `ubuntu-latest:docker://catthehacker/ubuntu:act-latest`).

Sensible config: Pacific/Auckland or your TZ, 2 CPU / 4 GB, ixVolume storage.

### Instance URL

Use a hostname the runner container can actually reach. A reverse-proxied LAN
name with a valid cert (e.g. `https://git.example.com`) is more reliable than a
raw `https://host:30008` published port whose cert may not match. Verify from a
shell on the host: `curl -sS <url>/api/v1/version` should return JSON with a
valid TLS handshake.

## Gotchas that cause crash-loops (learned the hard way)

### 1. Reused ixVolume with a stale `.runner` (Gitea Act Runner)

TrueNAS reuses an existing ixVolume if the dataset name matches a previous
install. act_runner sees the old `/data/.runner` file, skips registration, and
tries the **old** server address — then crash-loops. Symptom: app shows
"Stopped", no runner appears in the admin list.

Fix: remove the stale registration so it re-registers fresh, then start the app:

```bash
sudo rm -f /mnt/.ix-apps/app_mounts/gitea-act-runner/data/.runner
```

(Or delete the app *including its ixVolume* and reinstall.)

### 2. Forgejo declarative token format

Newer forgejo-runner (v9+/v12) uses a declarative `config.yaml` with
`server.connections.<name>.{url, token, uuid}`. The connection **`token` is the
runner SECRET (40 hex chars), not the UI registration token** (which is
base64-ish with `_`). Passing the registration token yields:

```
invalid `server` settings: connection "..." is invalid: token contains invalid characters
```

Fix: register once to obtain a valid uuid + secret, then put those in the app's
"Runner UUID" and "Runner Registration Token" fields:

```bash
IMG=$(sudo docker inspect ix-forgejo-runner-forgejo-runner-1 --format '{{.Config.Image}}')
sudo mkdir -p /tmp/fjr && sudo chmod 777 /tmp/fjr
sudo docker run --rm -v /tmp/fjr:/data -w /data --entrypoint /bin/forgejo-runner "$IMG" \
  register --no-interactive --instance https://YOUR_FORGEJO \
  --token 'REGISTRATION_TOKEN' --name my-runner \
  --labels 'ubuntu-latest:docker://catthehacker/ubuntu:act-latest'
sudo cat /tmp/fjr/.runner   # copy "uuid" and "token" into the app fields
```

### 3. Docker-executor socket access

`docker://` label jobs need the runner to reach a Docker daemon. The TrueNAS
runner apps mount `/var/run/docker.sock`, but the container runs as uid/gid 568
while the socket is `root:docker` (gid 999), so access is denied. Host group
membership does NOT propagate into a container — grant the apps gid access to
the socket via ACL:

```bash
sudo setfacl -m g:568:rw /var/run/docker.sock
```

This resets on reboot / Docker restart. Make it persistent with a TrueNAS
**Post-Init script** (System → Advanced → Init/Shutdown Scripts):
`setfacl -m g:568:rw /var/run/docker.sock`.

The runner images themselves don't ship the `docker` CLI (they use the Docker
API), so test access with `test -w /var/run/docker.sock` inside the container,
not `docker info`.

## Reading runner logs when the app is stopped

TrueNAS removes the crashed container, so the UI log viewer says "Unable to
retrieve logs of stopped app". To capture a crash, start the app via middleware
and poll for the container:

```bash
sudo bash -c '
midclt call app.start forgejo-runner >/dev/null 2>&1 &
for i in $(seq 1 120); do
  c=$(docker ps -a --format "{{.Names}}" | grep "forgejo-runner-forgejo-runner-1" | head -1)
  if [ -n "$c" ]; then sleep 3; docker logs "$c" 2>&1 | tail -80; exit 0; fi
  sleep 0.25
done'
```
