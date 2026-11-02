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
# grep per rule.
#
# Fail closed. POSIX sh has no pipefail, and a failed redirection skips a function call without
# an error. So:
#  - No step is a pipeline. Each step is one command that reads one temp file and writes one.
#  - The "step" function does all redirections itself, inside a group. It writes a status file
#    from inside the group. If the shell cannot open a file, the group does not run, the status
#    file keeps its start value, and step stops the scan (exit 2).
#  - Every other redirected command, and every loop with a redirection, has "|| fail" outside it.
#  - The scan exits 0 or 1 only after the completion marker exists. No marker means exit 2.
# shellcheck disable=SC2016 # awk programs are in single quotes on purpose
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

# step IN OUT MAX COMMAND [ARGS...]: run COMMAND with stdin from IN and stdout to OUT.
# MAX is the highest exit status that is not an error: 0 for most tools, 1 for grep (1 = no match).
# Stderr is dropped first, so no tool or open error can print a file name or content. The group writes the status to "$tmp/rc".
# The start value "x" stays if the shell cannot open IN or OUT, because then the group never runs.
step() {
  step_in=$1
  step_out=$2
  step_max=$3
  shift 3
  echo x > "$tmp/rc" || fail "scan failed"
  { "$@"; echo "$?" > "$tmp/rc"; } 2> /dev/null < "$step_in" > "$step_out"
  read -r step_rc < "$tmp/rc" || fail "scan failed"
  case "$step_rc" in
    0) ;;
    1) [ "$step_max" -ge 1 ] || fail "scan failed" ;;
    *) fail "scan failed" ;;
  esac
  # The output must exist as a file before any later step reads it.
  [ -f "$step_out" ] || fail "scan failed"
}

# Create an empty temp file, so that a later step can rely on it.
touch_new() { : > "$1" || fail "scan failed"; }

touch_new "$tmp/terms"
if [ -e "$DENYLIST" ]; then
  if [ ! -f "$DENYLIST" ] || [ ! -r "$DENYLIST" ]; then
    fail "private denylist is not readable"
  fi
  step "$DENYLIST" "$tmp/terms.1" 1 grep -v '^[[:space:]]*#'
  step "$tmp/terms.1" "$tmp/terms" 1 grep -v '^[[:space:]]*$'
else
  echo "privacy: private denylist not found, private check skipped"
fi

GENERIC='/Users/[A-Za-z]|/home/[a-z]|([0-9a-f]{2}:){5}[0-9a-f]{2}'
IPV4='(10\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}'
step "$dir/privacy-allow.txt" "$tmp/allow.1" 1 grep -v '^[[:space:]]*#'
step "$tmp/allow.1" "$tmp/allow" 1 grep -v '^[[:space:]]*$'

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
    short=$(git rev-parse --short "$full") || exit 2
    prefix="$short:"
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
[ -f "$tmp/names" ] || fail "git failed"

# A name with a newline or a tab would break the record format. Refuse it; the name is not printed.
step "$tmp/names" "$tmp/names.all" 0 tr -d '\000'
step "$tmp/names" "$tmp/names.plain" 0 tr -d '\000\n\t'
cmp -s "$tmp/names.all" "$tmp/names.plain"
cmp_rc=$?
[ "$cmp_rc" -le 1 ] || fail "scan failed"
[ "$cmp_rc" -eq 0 ] || fail "unsupported filename (newline/tab) - rename it"

# Step 1: write the records. "$tmp/rec" holds "file<TAB>line<TAB>text" for each scanned line.
touch_new "$tmp/rec"
if [ -s "$tmp/names" ]; then
  # The names are safe now (no newline, no tab), so one name per line is a valid list.
  step "$tmp/names" "$tmp/names.nl" 0 tr '\000' '\n'
  if [ "$mode" = all ]; then
    # Regular files only. Other entries (for example a submodule directory) are skipped.
    while IFS= read -r f; do
      if [ -f "$f" ]; then printf '%s\000' "$f" || exit 2; fi
    done < "$tmp/names.nl" > "$tmp/files" || fail "scan failed"
    [ -f "$tmp/files" ] || fail "scan failed"
    if [ -s "$tmp/files" ]; then
      # -I skips binary files. --null ends the file name with a zero byte, so a colon in a name is safe.
      # The pattern comes first, so a name that starts with a dash is safe. Status 1 means no line.
      xargs -0 sh -c 'grep -I -n -H --null -e "" -- "$@" 2> /dev/null; [ $? -le 1 ]' sh < "$tmp/files" > "$tmp/grep.out" \
        || fail "scan failed"
      # The zero byte becomes a tab. A tab never occurs in a name.
      step "$tmp/grep.out" "$tmp/grep.tab" 0 tr '\000' '\t'
      step "$tmp/grep.tab" "$tmp/rec" 0 awk '{
        j = index($0, "\t")
        f = substr($0, 1, j - 1)
        r = substr($0, j + 1)
        k = index(r, ":")
        print f "\t" substr(r, 1, k - 1) "\t" substr(r, k + 1)
      }'
    fi
  else
    # One diff for the whole commit. The names above list the same files in the same order.
    # shellcheck disable=SC2086
    git -c core.quotePath=false diff -U0 --no-color --no-ext-diff --no-renames --src-prefix=a/ --dst-prefix=b/ \
      --diff-filter=ACMR $ARGS -- > "$tmp/diff" 2> /dev/null || fail "git failed"
    [ -f "$tmp/diff" ] || fail "git failed"
    # Count the lines of each hunk from its @@ header, so file content is never read as a header.
    # The Nth "diff --git" header belongs to the Nth name. A count or name mismatch is an error.
    step "$tmp/diff" "$tmp/rec" 0 awk -v names="$tmp/names.nl" '
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
    '
  fi
fi

# Step 2: match all records at once. A grep status of 0 or 1 is fine, more is an error.
# Each rule writes its own result file. The files exist before the rules run.
touch_new "$tmp/found.term"
touch_new "$tmp/found.gen"
touch_new "$tmp/found.ip"
lead="^[^${tab}]*${tab}[^${tab}]*${tab}"
if [ -s "$tmp/terms" ]; then
  step "$tmp/rec" "$tmp/m1" 1 grep -a -iFf "$tmp/terms"
  step "$tmp/m1" "$tmp/m1.pos" 0 cut -f1,2
  step "$tmp/m1.pos" "$tmp/found.term" 0 awk '{ print $0 "\tterm" }'
fi

# Generic patterns skip the root package-lock.json only.
step "$tmp/rec" "$tmp/rec.gen" 1 grep -a -v "^package-lock\\.json${tab}"
if [ -s "$tmp/rec.gen" ]; then
  step "$tmp/rec.gen" "$tmp/m2" 1 grep -a -iE "${lead}.*(${GENERIC})"
  step "$tmp/m2" "$tmp/m2.pos" 0 cut -f1,2
  step "$tmp/m2.pos" "$tmp/found.gen" 0 awk '{ print $0 "\tgeneric" }'

  step "$tmp/rec.gen" "$tmp/ipcand" 1 grep -a -E "${lead}.*(${IPV4})"
  if [ -s "$tmp/ipcand" ]; then
    # Split each candidate line into tokens of digits and dots (one pass for all lines).
    step "$tmp/ipcand" "$tmp/text" 0 cut -f3-
    step "$tmp/text" "$tmp/tok.raw" 0 env LC_ALL=C tr -c '0-9.\n' ' '
    step "$tmp/ipcand" "$tmp/pos" 0 cut -f1,2
    # The token file must have one line for each candidate line. A short file would hide addresses.
    step "$tmp/ipcand" "$tmp/n.cand" 0 wc -l
    step "$tmp/tok.raw" "$tmp/n.tok" 0 wc -l
    cmp -s "$tmp/n.cand" "$tmp/n.tok" || fail "scan failed"
    step /dev/null "$tmp/ptok" 0 paste "$tmp/pos" "$tmp/tok.raw"
    # One output line per token: "file<TAB>line<TAB>token". Trailing dots are dropped.
    step "$tmp/ptok" "$tmp/toklist" 0 awk -F'\t' '{
      m = split($3, t, " ")
      for (i = 1; i <= m; i++) {
        s = t[i]
        sub(/\.+$/, "", s)
        if (s != "") print $1 "\t" $2 "\t" s
      }
    }'
    # Classify each distinct token once: an exact address that no allowlist pattern matches is bad.
    step "$tmp/toklist" "$tmp/tokens" 0 cut -f3
    step "$tmp/tokens" "$tmp/uniq" 0 sort -u
    step "$tmp/uniq" "$tmp/valid" 1 grep -a -xE "$IPV4"
    if [ -s "$tmp/valid" ]; then
      step "$tmp/valid" "$tmp/bad" 1 grep -a -vEf "$tmp/allow"
      if [ -s "$tmp/bad" ]; then
        step /dev/null "$tmp/found.ip" 0 awk -F'\t' '
          FNR == NR { bad[$0] = 1; next }
          ($3 in bad) && !seen[$1 FS $2]++ { print $1 "\t" $2 "\tip" }
        ' "$tmp/bad" "$tmp/toklist"
      fi
    fi
  fi
fi

# cut reads all three result files. A missing file is an error.
step /dev/null "$tmp/found.pos" 0 cut -f1,2 "$tmp/found.term" "$tmp/found.gen" "$tmp/found.ip"
step "$tmp/found.pos" "$tmp/found.col" 0 tr '\t' ':'
step "$tmp/found.col" "$tmp/hits" 0 sort -u

# The completion marker. It is the last stage. Without it the scan did not finish.
echo complete > "$tmp/done" || fail "scan failed"
[ -f "$tmp/done" ] && [ -f "$tmp/hits" ] || fail "scan failed"

if [ -s "$tmp/hits" ]; then
  sed "s|^|privacy: ${prefix}|" "$tmp/hits"
  echo "privacy: hits found; terms are in the private denylist (SIMNV_PANEL_DENYLIST)"
  exit 1
fi
exit 0
