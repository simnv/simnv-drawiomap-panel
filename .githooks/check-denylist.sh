#!/bin/sh
# Privacy check. Prints file:line of each hit, never the matched text or the denylist path.
# Modes: (default) staged diff | --range <rev-range> | --commit <sha> | --all (tracked files).
# Private terms: ${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}, matched in every file.
# Generic patterns (home paths, MAC addresses, private IPv4 outside privacy-allow.txt) also run,
# except on the root package-lock.json.
# Exit codes: 0 clean, 1 hit, 2 error (for example a git failure or an invalid range).
set +x

DENYLIST="${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}"
dir=$(cd "$(dirname "$0")" && pwd)
self="$dir/check-denylist.sh"

# Worker: print "file<TAB>line<TAB>text" for the added lines of one file. Called through xargs -0.
if [ "${1:-}" = --worker ]; then
  f="${2:-}"
  [ -n "$f" ] || exit 0
  if [ "$MODE" = all ]; then
    [ -f "$f" ] || exit 0
    # -I skips binary files. The pattern comes first, so a name that starts with a dash is safe.
    grep -I -n -e '' -- "$f" 2>/dev/null | F="$f" awk '{
      i = index($0, ":")
      print ENVIRON["F"] "\t" substr($0, 1, i - 1) "\t" substr($0, i + 1)
    }'
    exit 0
  fi
  d=$(mktemp) || exit 1
  # shellcheck disable=SC2086
  git -c core.quotePath=false diff -U0 --no-color --no-ext-diff --no-renames $ARGS -- "$f" > "$d" || { rm -f "$d"; exit 1; }
  # Count the lines of each hunk from its @@ header, so file content is never read as a header.
  F="$f" awk '
    ro > 0 || rn > 0 {
      c = substr($0, 1, 1)
      if (c == "-") ro--
      else if (c == "+") { rn--; print ENVIRON["F"] "\t" n "\t" substr($0, 2); n++ }
      next
    }
    /^@@ / {
      split($2, o, ","); split($3, p, ",")
      ro = (o[2] == "") ? 1 : o[2] + 0
      rn = (p[2] == "") ? 1 : p[2] + 0
      n = substr(p[1], 2) + 0
    }
  ' < "$d"
  rc=$?
  rm -f "$d"
  exit $rc
fi

mode=staged
range=
sha=
case "${1:-}" in
  --all) mode=all ;;
  --range)
    mode=range
    range="${2:-}"
    [ -n "$range" ] || { echo "privacy: --range needs a value" >&2; exit 2; }
    ;;
  --commit)
    mode=commit
    sha="${2:-}"
    [ -n "$sha" ] || { echo "privacy: --commit needs a value" >&2; exit 2; }
    ;;
  "") ;;
  *) echo "privacy: unknown argument" >&2; exit 2 ;;
esac

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT

if [ -f "$DENYLIST" ]; then
  grep -v '^[[:space:]]*#' "$DENYLIST" | grep -v '^[[:space:]]*$' > "$tmp/terms"
else
  echo "privacy: private denylist not found, private check skipped"
  : > "$tmp/terms"
fi

tab=$(printf '\t')
generic='/Users/[A-Za-z]|/home/[a-z]|([0-9a-f]{2}:){5}[0-9a-f]{2}'
ipv4='(10\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]+\.[0-9]+'
ipb="(^|[^0-9.])($ipv4)"
grep -v '^[[:space:]]*#' "$dir/privacy-allow.txt" | grep -v '^[[:space:]]*$' > "$tmp/allow"

prefix=
case "$mode" in
  staged)
    ARGS="--cached"
    ;;
  range)
    ARGS="$range"
    # shellcheck disable=SC2086
    git rev-list -n1 $range -- > /dev/null 2>&1 || { echo "privacy: invalid range" >&2; exit 2; }
    ;;
  commit)
    git rev-parse --verify -q "$sha^{commit}" > /dev/null 2>&1 || { echo "privacy: invalid commit" >&2; exit 2; }
    full=$(git rev-parse "$sha^{commit}") || exit 2
    prefix="$(git rev-parse --short "$full"):"
    base=$(git rev-parse --verify -q "$full^" 2>/dev/null) || base=4b825dc642cb6eb9a060e54bf8d69288fbee4904
    ARGS="$base $full"
    ;;
esac
export MODE="$mode" ARGS

if [ "$mode" = all ]; then
  git ls-files -z > "$tmp/names" || { echo "privacy: git failed" >&2; exit 2; }
else
  # shellcheck disable=SC2086
  git diff $ARGS --name-only -z --diff-filter=ACMR --no-renames -- > "$tmp/names" || { echo "privacy: git failed" >&2; exit 2; }
fi

: > "$tmp/records"
if [ -s "$tmp/names" ]; then
  xargs -0 -n1 sh "$self" --worker < "$tmp/names" > "$tmp/records" || { echo "privacy: scan failed" >&2; exit 2; }
fi

# Bulk greps over the records file keep --all fast. A record is file TAB line TAB text.
lead="^[^${tab}]*${tab}[^${tab}]*${tab}"
: > "$tmp/hits"
if [ -s "$tmp/terms" ]; then
  grep -iFf "$tmp/terms" "$tmp/records" | cut -f1,2 | tr '\t' ':' >> "$tmp/hits"
fi
# Generic patterns skip the root package-lock.json only.
grep -v "^package-lock\.json${tab}" "$tmp/records" > "$tmp/gen" || true
grep -iE "${lead}.*($generic)" "$tmp/gen" | cut -f1,2 | tr '\t' ':' >> "$tmp/hits"
# Private IPv4: a candidate line is a hit when one address is outside the allowlist.
grep -E "${lead}(.*[^0-9.])?($ipv4)" "$tmp/gen" > "$tmp/ipcand" || true
while IFS="$tab" read -r file n text; do
  for ip in $(printf '%s\n' "$text" | grep -oE "$ipb" | sed 's/^[^0-9]//'); do
    if ! printf '%s\n' "$ip" | grep -qEf "$tmp/allow"; then
      echo "$file:$n" >> "$tmp/hits"
      break
    fi
  done
done < "$tmp/ipcand"
sort -u "$tmp/hits" -o "$tmp/hits"

if [ -s "$tmp/hits" ]; then
  sed "s|^|privacy: ${prefix}|" "$tmp/hits"
  echo "privacy: hits found; terms are in the private denylist (SIMNV_PANEL_DENYLIST)"
  exit 1
fi
exit 0
