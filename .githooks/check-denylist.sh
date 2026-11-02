#!/bin/sh
# Privacy check. Prints file:line of each hit, never the matched text or the denylist path.
# Modes: (default) staged diff | --range <rev-range> | --commit <sha> | --all (tracked files).
# Private terms: ${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}, matched in every file.
# Generic patterns (home paths, MAC addresses, private IPv4 outside privacy-allow.txt) also run,
# except on the root package-lock.json.
# Exit codes: 0 clean, 1 hit, 2 error (for example a git failure, an invalid range or an unsupported file name).
#
# The scan runs once per call, not once per file. Step 1 writes one record per scanned line
# ("file<TAB>line<TAB>text") for all files. Step 2 matches the whole record file with one
# grep per rule. Every tool that can fail is checked, so an internal error blocks (exit 2).
set +x
# A file name is never a git pathspec pattern.
GIT_LITERAL_PATHSPECS=1
export GIT_LITERAL_PATHSPECS

DENYLIST="${SIMNV_PANEL_DENYLIST:-$HOME/.config/simnv-drawiomap-panel/denylist}"
dir=$(cd "$(dirname "$0")" && pwd)
tab=$(printf '\t')

fail() { echo "privacy: $1" >&2; exit 2; }

mode=staged
range=
sha=
case "${1:-}" in
  --all) mode=all ;;
  --range)
    mode=range
    range="${2:-}"
    [ -n "$range" ] || fail "--range needs a value"
    ;;
  --commit)
    mode=commit
    sha="${2:-}"
    [ -n "$sha" ] || fail "--commit needs a value"
    ;;
  "") ;;
  *) fail "unknown argument" ;;
esac

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT

: > "$tmp/terms"
if [ -e "$DENYLIST" ]; then
  if [ ! -f "$DENYLIST" ] || [ ! -r "$DENYLIST" ]; then
    fail "private denylist is not readable"
  fi
  grep -v '^[[:space:]]*#' < "$DENYLIST" 2> /dev/null | grep -v '^[[:space:]]*$' > "$tmp/terms"
else
  echo "privacy: private denylist not found, private check skipped"
fi

GENERIC='/Users/[A-Za-z]|/home/[a-z]|([0-9a-f]{2}:){5}[0-9a-f]{2}'
IPV4='(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}'
grep -v '^[[:space:]]*#' < "$dir/privacy-allow.txt" | grep -v '^[[:space:]]*$' > "$tmp/allow"

prefix=
case "$mode" in
  staged)
    ARGS="--cached"
    ;;
  range)
    ARGS="$range"
    # shellcheck disable=SC2086
    git rev-list -n1 $range -- > /dev/null 2>&1 || fail "invalid range"
    ;;
  commit)
    git rev-parse --verify -q "$sha^{commit}" > /dev/null 2>&1 || fail "invalid commit"
    full=$(git rev-parse "$sha^{commit}") || exit 2
    prefix="$(git rev-parse --short "$full"):"
    base=$(git rev-parse --verify -q "$full^" 2> /dev/null) || base=4b825dc642cb6eb9a060e54bf8d69288fbee4904
    ARGS="$base $full"
    ;;
esac

if [ "$mode" = all ]; then
  git ls-files -z > "$tmp/names" || fail "git failed"
else
  # shellcheck disable=SC2086
  git diff $ARGS --name-only -z --diff-filter=ACMR --no-renames -- > "$tmp/names" || fail "git failed"
fi

# A name with a newline or a tab would break the record format. Refuse it; the name is not printed.
all_bytes=$(tr -d '\000' < "$tmp/names" | wc -c)
plain_bytes=$(tr -d '\000\n\t' < "$tmp/names" | wc -c)
if [ "$all_bytes" -ne "$plain_bytes" ]; then
  fail "unsupported filename (newline/tab) - rename it"
fi

# Step 1: write the records. "$tmp/rec" holds "file<TAB>line<TAB>text" for each scanned line.
: > "$tmp/rec"
if [ -s "$tmp/names" ]; then
  # The names are safe now (no newline, no tab), so one name per line is a valid list.
  tr '\000' '\n' < "$tmp/names" > "$tmp/names.nl" || fail "scan failed"
  if [ "$mode" = all ]; then
    # Regular files only. Other entries (for example a submodule directory) are skipped.
    while IFS= read -r f; do
      [ -f "$f" ] && printf '%s\000' "$f"
    done < "$tmp/names.nl" > "$tmp/files"
    if [ -s "$tmp/files" ]; then
      # -I skips binary files. --null ends the file name with a zero byte, so a colon in a name is safe.
      # The pattern comes first, so a name that starts with a dash is safe. Status 1 means no line.
      # shellcheck disable=SC2016
      xargs -0 sh -c 'grep -I -n -H --null -e "" -- "$@" 2> /dev/null; [ $? -le 1 ]' sh < "$tmp/files" > "$tmp/grep.out" \
        || fail "scan failed"
      # The zero byte becomes a tab. A tab never occurs in a name.
      tr '\000' '\t' < "$tmp/grep.out" | awk '{
        j = index($0, "\t")
        f = substr($0, 1, j - 1)
        r = substr($0, j + 1)
        k = index(r, ":")
        print f "\t" substr(r, 1, k - 1) "\t" substr(r, k + 1)
      }' > "$tmp/rec" || fail "scan failed"
    fi
  else
    # One diff for the whole commit. The names above list the same files in the same order.
    # shellcheck disable=SC2086
    git -c core.quotePath=false diff -U0 --no-color --no-ext-diff --no-renames --src-prefix=a/ --dst-prefix=b/ \
      --diff-filter=ACMR $ARGS -- > "$tmp/diff" 2> /dev/null || fail "git failed"
    # Count the lines of each hunk from its @@ header, so file content is never read as a header.
    # The Nth "diff --git" header belongs to the Nth name. A count or name mismatch is an error.
    awk -v names="$tmp/names.nl" '
      BEGIN {
        while ((getline line < names) > 0) { total++; nm[total] = line }
        close(names)
      }
      ro > 0 || rn > 0 {
        c = substr($0, 1, 1)
        if (c == "-") ro--
        else if (c == "+") { rn--; print nm[idx] "\t" n "\t" substr($0, 2); n++ }
        next
      }
      /^diff --git / {
        idx++
        if (idx > total) bad = 1
        else if (substr($0, 1, 12) != "diff --git \"" && $0 != "diff --git a/" nm[idx] " b/" nm[idx]) bad = 1
        next
      }
      /^@@ / {
        if (idx < 1 || idx > total) bad = 1
        split($2, o, ","); split($3, p, ",")
        ro = (o[2] == "") ? 1 : o[2] + 0
        rn = (p[2] == "") ? 1 : p[2] + 0
        n = substr(p[1], 2) + 0
      }
      END { if (bad || idx != total || ro > 0 || rn > 0) exit 1 }
    ' < "$tmp/diff" > "$tmp/rec" || fail "scan failed"
  fi
fi

# Step 2: match all records at once. Each grep status is checked: 0 or 1 is fine, more is an error.
: > "$tmp/found"
lead="^[^${tab}]*${tab}[^${tab}]*${tab}"
if [ -s "$tmp/terms" ]; then
  grep -a -iFf "$tmp/terms" "$tmp/rec" > "$tmp/m1"
  [ $? -le 1 ] || fail "scan failed"
  cut -f1,2 < "$tmp/m1" | awk '{ print $0 "\tterm" }' >> "$tmp/found" || fail "scan failed"
fi

# Generic patterns skip the root package-lock.json only.
grep -a -v "^package-lock\\.json${tab}" "$tmp/rec" > "$tmp/rec.gen"
[ $? -le 1 ] || fail "scan failed"
if [ -s "$tmp/rec.gen" ]; then
  grep -a -iE "${lead}.*(${GENERIC})" "$tmp/rec.gen" > "$tmp/m2"
  [ $? -le 1 ] || fail "scan failed"
  cut -f1,2 < "$tmp/m2" | awk '{ print $0 "\tgeneric" }' >> "$tmp/found" || fail "scan failed"

  grep -a -E "${lead}.*(${IPV4})" "$tmp/rec.gen" > "$tmp/ipcand"
  [ $? -le 1 ] || fail "scan failed"
  if [ -s "$tmp/ipcand" ]; then
    # Split each candidate line into tokens of digits and dots (one pass for all lines).
    # A zero-byte text cannot occur here, so the lines of "$tmp/tok" match the lines of "$tmp/ipcand".
    cut -f3- < "$tmp/ipcand" | LC_ALL=C tr -c '0-9.\n' ' ' > "$tmp/tok.raw" || fail "scan failed"
    cut -f1,2 < "$tmp/ipcand" | paste - "$tmp/tok.raw" > "$tmp/ptok" || fail "scan failed"
    # One output line per token: "file<TAB>line<TAB>token". Trailing dots are dropped.
    awk -F'\t' '{
      m = split($3, t, " ")
      for (i = 1; i <= m; i++) {
        s = t[i]
        sub(/\.+$/, "", s)
        if (s != "") print $1 "\t" $2 "\t" s
      }
    }' < "$tmp/ptok" > "$tmp/toklist" || fail "scan failed"
    # Classify each distinct token once: an exact address that no allowlist pattern matches is bad.
    cut -f3 < "$tmp/toklist" | sort -u > "$tmp/uniq" || fail "scan failed"
    grep -a -xE "$IPV4" "$tmp/uniq" > "$tmp/valid"
    [ $? -le 1 ] || fail "scan failed"
    if [ -s "$tmp/valid" ]; then
      grep -a -vEf "$tmp/allow" "$tmp/valid" > "$tmp/bad"
      [ $? -le 1 ] || fail "scan failed"
      if [ -s "$tmp/bad" ]; then
        awk -F'\t' '
          FNR == NR { bad[$0] = 1; next }
          ($3 in bad) && !seen[$1 FS $2]++ { print $1 "\t" $2 "\tip" }
        ' "$tmp/bad" "$tmp/toklist" >> "$tmp/found" || fail "scan failed"
      fi
    fi
  fi
fi

cut -f1,2 < "$tmp/found" | tr '\t' ':' | sort -u > "$tmp/hits" || fail "scan failed"

if [ -s "$tmp/hits" ]; then
  sed "s|^|privacy: ${prefix}|" "$tmp/hits"
  echo "privacy: hits found; terms are in the private denylist (SIMNV_PANEL_DENYLIST)"
  exit 1
fi
exit 0
