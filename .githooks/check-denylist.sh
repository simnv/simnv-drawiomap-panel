#!/bin/sh
# Privacy check. Prints file:line of each hit, never the matched text.
# Modes: (default) staged diff | --range <rev-range> | --all (tracked files).
# Private terms: ${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}
# Generic patterns (home paths, MAC addresses, private IPv4 outside privacy-allow.txt) run always.
DENYLIST="${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}"
dir=$(cd "$(dirname "$0")" && pwd)
mode=staged
range=
case "${1:-}" in
  --all) mode=all ;;
  --range)
    mode=range
    range="${2:-}"
    [ -n "$range" ] || { echo "privacy: --range needs a value" >&2; exit 2; }
    ;;
  "") ;;
  *) echo "privacy: unknown argument" >&2; exit 2 ;;
esac

tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

if [ -f "$DENYLIST" ]; then
  grep -v '^[[:space:]]*#' "$DENYLIST" | grep -v '^[[:space:]]*$' > "$tmp/terms"
else
  echo "privacy: private denylist not found, private check skipped"
  : > "$tmp/terms"
fi

generic='/Users/[A-Za-z]|/home/[a-z]|([0-9a-f]{2}:){5}[0-9a-f]{2}'
ipv4='(10\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]+\.[0-9]+'
grep -v '^[[:space:]]*#' "$dir/privacy-allow.txt" | grep -v '^[[:space:]]*$' > "$tmp/allow"

# Emit "file<TAB>line<TAB>text" records.
if [ "$mode" = all ]; then
  # grep -I skips binary files; output is file:line:text.
  git ls-files | grep -vE '^(package-lock\.json|dist/|\.config/)' | xargs grep -InH '' 2>/dev/null |
    awk '{ i = index($0, ":"); f = substr($0, 1, i - 1); r = substr($0, i + 1); j = index(r, ":"); print f "\t" substr(r, 1, j - 1) "\t" substr(r, j + 1) }' > "$tmp/records"
else
  if [ "$mode" = range ]; then
    git diff -U0 --no-color "$range" -- . ':!package-lock.json' ':!dist' ':!.config'
  else
    git diff --cached -U0 --no-color -- . ':!package-lock.json' ':!dist' ':!.config'
  fi | awk '
    /^\+\+\+ / { file = substr($0, 7); next }
    /^@@ /     { split($3, a, ","); n = substr(a[1], 2) + 0; next }
    /^\+/      { print file "\t" n "\t" substr($0, 2); n++ }
  ' > "$tmp/records"
fi

tab=$(printf '\t')
# Bulk greps over the records file keep --all fast. A record is file TAB line TAB text.
lead="^[^${tab}]*${tab}[^${tab}]*${tab}.*"
: > "$tmp/hits"
if [ -s "$tmp/terms" ]; then
  grep -iFf "$tmp/terms" "$tmp/records" | cut -f1,2 | tr '\t' ':' >> "$tmp/hits"
fi
grep -iE "$lead($generic)" "$tmp/records" | cut -f1,2 | tr '\t' ':' >> "$tmp/hits"
# Private IPv4: a candidate line is a hit when one address is outside the allowlist.
grep -E "$lead($ipv4)" "$tmp/records" > "$tmp/ipcand"
while IFS="$tab" read -r file n text; do
  for ip in $(printf '%s\n' "$text" | grep -oE "$ipv4"); do
    if ! printf '%s\n' "$ip" | grep -qEf "$tmp/allow"; then echo "$file:$n" >> "$tmp/hits"; break; fi
  done
done < "$tmp/ipcand"
sort -t: -k1,1 -k2,2n -u "$tmp/hits" -o "$tmp/hits"

if [ -s "$tmp/hits" ]; then
  sed 's/^/privacy: /' "$tmp/hits"
  echo "privacy: terms are in $DENYLIST; fix or rename"
  exit 1
fi
exit 0
