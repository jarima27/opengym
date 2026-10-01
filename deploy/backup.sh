#!/bin/sh
# Tiza's backups: ./data to Cloudflare R2 (any S3 will do) with restic — encrypted before it leaves
# the server, deduplicated, kept as 30 daily and 12 monthly snapshots. It runs as the `backup`
# service of deploy/compose.yml, in the restic image (busybox sh, jq, wget); docs/DEPLOY.md has the
# setup and the restore drill.
#
#   daemon         the service itself: a backup every day at BACKUP_AT, and one at start when R2
#                  has nothing from the last day (a new server, a night the server was down)
#   now            one backup now: snapshot, retention, then a test restore of the essentials
#   snapshots      what R2 holds
#   restore [ID]   a snapshot (default: the newest) into ./restore/<ID>/, checked — never over
#                  ./data, which this container can only read; moving it into place is by hand
#   verify [ID]    restore a snapshot's essentials to a scratch folder and check them
#   health         exit 0 while the newest snapshot is under 26 hours old and the last run
#                  succeeded (the container's healthcheck)
#
# Run them with:  docker compose exec backup sh /backup/backup.sh <command>
#
# Environment (backup.env): RESTIC_REPOSITORY, RESTIC_PASSWORD, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION=auto; optional BACKUP_PING_URL (a healthchecks.io-style
# URL: pinged on success, /start and /fail), KEEP_DAILY, KEEP_MONTHLY. From compose: BACKUP_AT, TZ.
set -eu

HOST=${BACKUP_HOST:-tiza}
SRC=${BACKUP_SOURCE:-/data}
OUT=${RESTORE_DIR:-/restore}
KEEP_DAILY=${KEEP_DAILY:-30}
KEEP_MONTHLY=${KEEP_MONTHLY:-12}
AT=${BACKUP_AT:-03:30}
MAX_AGE=${BACKUP_MAX_AGE:-93600}          # 26 h: a nightly backup plus slack
# What a restore must bring back for the instance to come up as it was: every profile and its
# passkeys (db.json), each one's workouts (state-*.json), the key every session is signed with
# (secret) and the push keys (vapid.json): what `verify` restores and checks each night. A full
# `restore` brings back everything, uploads/ included.

log() { echo "$(date '+%F %T') backup: $*"; }
fail() { log "ERROR: $*"; return 1; }
ping_hc() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  wget -q -T 15 -O /dev/null "${BACKUP_PING_URL%/}$1" 2>/dev/null || log "could not reach BACKUP_PING_URL"
}

# Seconds since the newest snapshot, or nothing when there is none. restic writes times like
# 2026-10-01T03:30:02.123456789+02:00; jq's fromdateiso8601 wants whole seconds in UTC.
newest_age() {
  restic snapshots --host "$HOST" --json --no-lock | jq -r '
    def epoch: capture("^(?<d>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:[0-9]{2})$")
      | (.d + "Z" | fromdateiso8601)
        - (if .z == "Z" then 0
           else ((.z[1:3] | tonumber) * 3600 + (.z[4:6] | tonumber) * 60) * (if .z[0:1] == "+" then 1 else -1 end)
           end);
    if length == 0 then empty else (now - (map(.time | epoch) | max) | floor) end'
}

# Seconds from now until the next BACKUP_AT (HH:MM, the container's TZ).
seconds_until() {
  now=$(date +%s)
  t=$(date -d "$1" +%s) || { fail "BACKUP_AT=$1 is not a time (HH:MM)"; return 1; }
  [ "$t" -gt "$now" ] || t=$((t + 86400))
  echo $((t - now))
}

ensure_repo() {
  rc=0; restic cat config --no-lock >/dev/null 2>&1 || rc=$?
  case $rc in
    0) return 0 ;;
    10) log "no repository at $RESTIC_REPOSITORY yet — creating it"
        # restic refuses to init over an existing repository, whatever made it look absent.
        restic init ;;
    12) fail "RESTIC_PASSWORD does not open the repository at $RESTIC_REPOSITORY" ;;
    *) fail "cannot reach the repository at $RESTIC_REPOSITORY (restic exit $rc) — check backup.env" ;;
  esac
}

# Checks a restored copy of $SRC under $1: the files every profile depends on are there and parse.
check_tree() {
  d="$1$SRC"
  states=$(find "$d" -maxdepth 1 -name 'state-*.json' 2>/dev/null | wc -l)
  [ -s "$d/secret" ] || { fail "secret (the session key) missing from the restore"; return 1; }
  if [ ! -f "$d/db.json" ]; then
    # The api writes db.json with the first profile: a new server has none yet, and nothing else.
    [ "$states" = 0 ] || { fail "db.json missing from the restore, but $states workout files are there"; return 1; }
    log "restore checked: no profiles yet, session key present"
    return 0
  fi
  jq -e '.users | type == "array"' "$d/db.json" >/dev/null || { fail "db.json does not parse or has no users"; return 1; }
  for f in "$d"/*.json; do
    jq empty "$f" 2>/dev/null || { fail "$(basename "$f") does not parse"; return 1; }
  done
  users=$(jq '.users | length' "$d/db.json")
  log "restore checked: $users profiles, $states workout files, session key and push keys present"
}

verify() {
  id=${1:-latest}
  tmp=$(mktemp -d /tmp/verify.XXXXXX)
  # Quoted: these are restic's patterns, not the shell's (/data is mounted here, so it would expand).
  if restic restore "$id" --host "$HOST" --target "$tmp" --include "$SRC/*.json" --include "$SRC/secret" >/dev/null \
     && check_tree "$tmp"; then
    rm -rf "$tmp"; return 0
  fi
  rm -rf "$tmp"; fail "test restore of snapshot $id failed"
}

backup_now() {
  ping_hc /start
  # The api writes `secret` on its first start: a folder without one is not Tiza's data — most
  # likely ./data was moved and this container still has the old one (restart it after a restore).
  [ -s "$SRC/secret" ] || { fail "$SRC has no secret — is ./data mounted here? After moving data/, run: docker compose up -d --force-recreate backup"; return 1; }
  ensure_repo || return 1
  # Only stale locks go (a run killed halfway); a live one is left alone.
  restic unlock >/dev/null 2>&1 || true
  # The api writes each file whole and swaps it in with a rename, so a copy taken while it runs
  # is made of complete files. *.tmp is the half of that swap still being written.
  restic backup "$SRC" --host "$HOST" --tag tiza --exclude '*.tmp' --exclude-caches --quiet \
    || { fail "restic backup failed"; return 1; }
  restic forget --host "$HOST" --tag tiza --keep-daily "$KEEP_DAILY" --keep-monthly "$KEEP_MONTHLY" --prune --quiet \
    || { fail "applying retention failed"; return 1; }
  verify latest || return 1
  # Once a week, read back a tenth of the stored data and check the repository's structure.
  if [ "$(date +%u)" = 7 ]; then
    restic check --read-data-subset=10% --quiet || { fail "restic check found a problem"; return 1; }
  fi
  log "done: $(restic snapshots --host "$HOST" --json --no-lock | jq length) snapshots in R2"
  ping_hc ""
}

# The last run's outcome, kept in the cache volume so a restart does not forget a failure.
LAST=${BACKUP_STATE:-/root/.cache/restic/tiza-last-run}
run_logged() {
  if backup_now; then echo "ok $(date '+%F %T')" > "$LAST"; return 0; fi
  echo "failed $(date '+%F %T')" > "$LAST"
  ping_hc /fail
  return 1
}

restore() {
  id=${1:-latest}
  sid=$(restic snapshots --host "$HOST" --json --no-lock "$id" | jq -r '.[0].short_id // empty')
  [ -n "$sid" ] || { fail "no snapshot $id (list them with: snapshots)"; return 1; }
  dest="$OUT/$sid"
  [ ! -e "$dest" ] || { fail "$dest already exists — move it away first"; return 1; }
  log "restoring snapshot $sid into ./restore/$sid …"
  restic restore "$sid" --host "$HOST" --target "$dest" || { fail "restic restore failed"; return 1; }
  check_tree "$dest" || return 1
  cat <<EOF

Restored to ./restore/$sid/data — the live ./data is untouched. To put it in place, from the
folder that holds compose.yml:

  docker compose stop
  sudo mv data data.before-restore-\$(date +%F-%H%M)
  sudo mv restore/$sid/data data
  docker compose up -d --force-recreate
  ./check.sh https://app.tiza.fit

Every service is stopped and recreated, this one included: a container keeps the folder it was
started with, so one left running would go on backing up data.before-restore-….

EOF
}

daemon() {
  trap 'log "stopping"; exit 0' TERM INT
  log "every day at $AT ($TZ), keeping $KEEP_DAILY daily and $KEEP_MONTHLY monthly snapshots"
  seconds_until "$AT" >/dev/null || exit 1
  until ensure_repo; do
    log "trying again in 10 minutes"
    ping_hc /fail
    sleep 600 & wait $!
  done
  age=$(newest_age || true)
  if [ -z "$age" ] || [ "$age" -gt 86400 ]; then
    log "nothing in R2 from the last day — backing up now"
    run_logged || true
  fi
  while :; do
    s=$(seconds_until "$AT")
    log "next backup in $((s / 3600))h$(((s % 3600) / 60))m"
    sleep "$s" & wait $!
    run_logged || true
  done
}

health() {
  if [ -f "$LAST" ] && ! grep -q '^ok' "$LAST"; then echo "last run $(cat "$LAST")"; exit 1; fi
  age=$(newest_age) || exit 1
  [ -n "$age" ] || { echo "no snapshot in the repository"; exit 1; }
  [ "$age" -lt "$MAX_AGE" ] || { echo "newest snapshot is $((age / 3600)) hours old"; exit 1; }
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  daemon) daemon ;;
  now) run_logged ;;
  snapshots) restic snapshots --host "$HOST" ;;
  restore) restore "$@" ;;
  verify) verify "$@" ;;
  health) health ;;
  *) awk 'NR > 1 && !/^#/ { exit } NR > 1 { print }' "$0"; exit 2 ;;
esac
