#!/bin/sh
# Is app.tiza.fit up and set up right? Run from anywhere with curl (your laptop, the server):
#
#   ./check.sh https://app.tiza.fit                 the app, its settings, what Cloudflare lets through
#   ./check.sh https://app.tiza.fit 203.0.113.10    …and that the server's own address has no port open
#
# Prints one line per check and exits non-zero when any of them fails. docs/DEPLOY.md, step 8.
set -u

URL=${1:-https://app.tiza.fit}
URL=${URL%/}
IP=${2:-}
failed=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; failed=1; }
warn() { printf '  warn  %s\n' "$1"; }
get() { curl -sS --max-time 20 "$@" 2>/dev/null; }

echo "Checking $URL"

# 1. The api answers through the whole chain: Cloudflare → tunnel → web → api.
health=$(get "$URL/api/health")
case "$health" in
  *'"ok":true'*) ok "api answers ($health)" ;;
  *) bad "api health: expected {\"ok\":true…}, got: ${health:-nothing}" ;;
esac

# 2. The app itself, with the headers web adds.
headers=$(get -o /dev/null -D - "$URL/")
case "$headers" in
  HTTP/*\ 200*) ok "the app loads" ;;
  *) bad "GET / did not answer 200" ;;
esac
echo "$headers" | grep -qi '^x-frame-options: *deny' && ok "security headers" || bad "X-Frame-Options missing (is this the web container?)"

# 3. The settings the app sees.
config=$(get "$URL/api/config")
echo "$config" | grep -q '"allow_guest"' || bad "/api/config did not answer JSON: ${config:-nothing}"
echo "$config" | grep -q '"dataset":false' && ok "dataset media off (© Gym visual)" || bad "exercise_media.dataset is not false — DATASET_MEDIA=off missing?"
echo "$config" | grep -q '"video":true' && ok "exercise videos on" || warn "exercise videos off (YMOVE_API_KEY not set yet?)"
echo "$config" | grep -q '"billing"' && ok "billing on" || warn "billing off (Stripe/RevenueCat variables not set yet?)"
echo "$config" | grep -q '"social"' && ok "Apple/Google sign-in on: $(echo "$config" | sed -n 's/.*"social":\(\[[^]]*\]\).*/\1/p')" || warn "no Apple/Google sign-in (APPLE_CLIENT_IDS / GOOGLE_CLIENT_IDS)"
echo "$config" | grep -q '"password_login":true' && ok "e-mail sign-in on" || warn "PASSWORD_LOGIN off: the store app's e-mail sign-in will not work"

# 4. The dataset's images and animations are not served.
code=$(get -o /dev/null -w '%{http_code}' "$URL/img/0025.jpg")
[ "$code" = 404 ] && ok "/img/ answers 404" || bad "/img/ answered $code, expected 404"

# 5. Webhooks reach the api instead of a Cloudflare challenge (Bot Fight Mode, WAF): an unsigned
# call must be refused by the api itself (400/401/503), never 403 with cf-mitigated.
for path in /api/billing/webhook /api/billing/revenuecat; do
  h=$(get -o /dev/null -D - -X POST -H 'Content-Type: application/json' --data '{}' "$URL$path")
  code=$(echo "$h" | sed -n '1s/^HTTP\/[0-9.]* \([0-9]*\).*/\1/p')
  if echo "$h" | grep -qi '^cf-mitigated'; then bad "$path is behind a Cloudflare challenge — turn Bot Fight Mode off"; continue; fi
  case "$code" in
    400|401|503) ok "$path reaches the api ($code without a signature)" ;;
    404) warn "$path answers 404 (billing not configured yet)" ;;
    *) bad "$path answered ${code:-nothing}" ;;
  esac
done

# 6. Plain http goes to https.
case "$URL" in
  https://*)
    loc=$(get -o /dev/null -D - "http://${URL#https://}/" | tr -d '\r' | sed -n 's/^[Ll]ocation: *//p')
    case "$loc" in https://*) ok "http redirects to https" ;; *) warn "http is not redirected to https (Cloudflare → SSL/TLS → Edge Certificates → Always Use HTTPS)" ;; esac
    ;;
esac

# 7. The server's own address refuses everything: the tunnel is the only way in.
if [ -n "$IP" ]; then
  for port in ${PORTS:-22 80 443 3000 8080}; do
    # Whether a TCP connection was made at all: curl reports 0 for refused or dropped (the
    # Hetzner firewall), the time it took otherwise.
    t=$(curl -s --connect-timeout 5 -m 3 -o /dev/null -w '%{time_connect}' "telnet://$IP:$port" </dev/null 2>/dev/null)
    case "$t" in
      ''|0|0.000000) ok "port $port closed on $IP" ;;
      *) if [ "$port" = 22 ]; then warn "port 22 (SSH) is open on $IP — fine if only your address may use it"
         else bad "port $port answers on $IP — check the Hetzner firewall"; fi ;;
    esac
  done
fi

[ $failed = 0 ] && echo "All good." || echo "Something needs fixing (FAIL above)."
exit $failed
