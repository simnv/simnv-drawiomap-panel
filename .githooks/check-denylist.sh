#!/bin/sh
# Privacy check. Prints file:line of each hit, never the matched text or the denylist path.
# Modes: (default) staged diff | --range <rev-range> | --commit <sha> | --all (tracked files).
# Private terms: ${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}, matched in every file.
# Generic patterns (home paths, MAC addresses, private IPv4 outside privacy-allow.txt) also run,
# except on the root package-lock.json.
# Exit codes: 0 clean, 1 hit, 2 error (for example a git failure, an invalid range or an unsupported file name).
set +x
# A file name is never a git pathspec pattern.
GIT_LITERAL_PATHSPECS=1
export GIT_LITERAL_PATHSPECS

DENYLIST="${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}"
dir=$(cd "$(dirname "$0")" && pwd)
self="$dir/check-denylist.sh"
tab=$(printf '\t')

# Worker: scan one file and print "file<TAB>line<TAB>kind" for each hit. It never prints file content.
# All matching happens here. Called through xargs -0. Settings come from the environment.
if [ "${1:-}" = --worker ]; then
  f="${2:-}"
  [ -n "$f" ] || exit 0
  w=$(mktemp -d) || exit 1
  trap 'rm -rf "$w"' EXIT
  if [ "${MODE:-}" = all ]; then
    [ -f "$f" ] || exit 0
    # -I skips binary files. The pattern comes first, so a name that starts with a dash is safe.
    grep -I -n -e '' -- "$f" 2> /dev/null | F="$f" awk '{
      i = index($0, ":")
      print ENVIRON["F"] "\t" substr($0, 1, i - 1) "\t" substr($0, i + 1)
    }' > "$w/rec"
  else
    # shellcheck disable=SC2086
    git -c core.quotePath=false diff -U0 --no-color --no-ext-diff --no-renames $ARGS -- "$f" > "$w/d" 2> /dev/null || exit 1
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
    ' < "$w/d" > "$w/rec"
  fi
  lead="^[^${tab}]*${tab}[^${tab}]*${tab}"
  if [ -s "${TERMS:-}" ]; then
    grep -iFf "$TERMS" "$w/rec" | cut -f1,2 | awk '{ print $0 "\tterm" }'
  fi
  # Generic patterns skip the root package-lock.json only.
  if [ "$f" != package-lock.json ]; then
    if [ -n "${GENERIC:-}" ]; then
      grep -iE "${lead}.*(${GENERIC})" "$w/rec" | cut -f1,2 | awk '{ print $0 "\tgeneric" }'
    fi
    if [ -n "${IPV4:-}" ] && [ -f "${ALLOW:-}" ]; then
      grep -E "${lead}.*(${IPV4})" "$w/rec" > "$w/ipcand"
      # A candidate line is a hit when one address is outside the allowlist.
      while IFS="$tab" read -r file n text; do
        # Split into tokens of digits and dots, drop trailing dots, keep exact addresses, drop allowed ones.
        if printf '%s\n' "$text" | tr -c '0-9.\n' '\n' | sed 's/\.*$//' | grep -xE "$IPV4" | grep -qvEf "$ALLOW"; then
          printf '%s\t%s\tip\n' "$file" "$n"
        fi
      done < "$w/ipcand"
    fi
  fi
  exit 0
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

: > "$tmp/terms"
if [ -e "$DENYLIST" ]; then
  if [ ! -f "$DENYLIST" ] || [ ! -r "$DENYLIST" ]; then
    echo "privacy: private denylist is not readable" >&2
    exit 2
  fi
  grep -v '^[[:space:]]*#' < "$DENYLIST" 2> /dev/null | grep -v '^[[:space:]]*$' > "$tmp/terms"
else
  echo "privacy: private denylist not found, private check skipped"
fi

GENERIC='/Users/[A-Za-z]|/home/[a-z]|([0-9a-f]{2}:){5}[0-9a-f]{2}'
IPV4='(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}'
grep -v '^[[:space:]]*#' < "$dir/privacy-allow.txt" | grep -v '^[[:space:]]*$' > "$tmp/allow"
TERMS="$tmp/terms"
ALLOW="$tmp/allow"

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
    base=$(git rev-parse --verify -q "$full^" 2> /dev/null) || base=4b825dc642cb6eb9a060e54bf8d69288fbee4904
    ARGS="$base $full"
    ;;
esac
export MODE="$mode" ARGS TERMS ALLOW GENERIC IPV4

if [ "$mode" = all ]; then
  git ls-files -z > "$tmp/names" || { echo "privacy: git failed" >&2; exit 2; }
else
  # shellcheck disable=SC2086
  git diff $ARGS --name-only -z --diff-filter=ACMR --no-renames -- > "$tmp/names" || { echo "privacy: git failed" >&2; exit 2; }
fi

# A name with a newline or a tab would break the record format. Refuse it; the name is not printed.
all_bytes=$(tr -d '\000' < "$tmp/names" | wc -c)
plain_bytes=$(tr -d '\000\n\t' < "$tmp/names" | wc -c)
if [ "$all_bytes" -ne "$plain_bytes" ]; then
  echo "privacy: unsupported filename (newline/tab) - rename it" >&2
  exit 2
fi

: > "$tmp/found"
if [ -s "$tmp/names" ]; then
  xargs -0 -n1 sh "$self" --worker < "$tmp/names" > "$tmp/found" 2> /dev/null || { echo "privacy: scan failed" >&2; exit 2; }
fi
cut -f1,2 < "$tmp/found" | tr '\t' ':' | sort -u > "$tmp/hits"

if [ -s "$tmp/hits" ]; then
  sed "s|^|privacy: ${prefix}|" "$tmp/hits"
  echo "privacy: hits found; terms are in the private denylist (SIMNV_PANEL_DENYLIST)"
  exit 1
fi
exit 0
