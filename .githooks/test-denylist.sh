#!/bin/sh
# Tests for check-denylist.sh and pre-push. Builds throwaway repos; uses synthetic terms only.
# Run: npm run test:hooks
hooks=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d 2> /dev/null) || { root="$hooks/../.claude-tmp"; mkdir -p "$root"; }
trap 'rm -rf "$root"' EXIT
fails=0
n=0

ok() { n=$((n + 1)); echo "ok $n - $1"; }
bad() { n=$((n + 1)); fails=$((fails + 1)); echo "not ok $n - $1"; }
check() { # description, command...
  d=$1; shift
  if "$@"; then ok "$d"; else bad "$d"; fi
}

# Synthetic denylist in a path that contains a marker, to prove the path is never printed.
mkdir -p "$root/SYNTHMARK"
printf '# comment\n\nSYNTHTERM\n' > "$root/SYNTHMARK/denylist"
SIMNV_PANEL_DENYLIST="$root/SYNTHMARK/denylist"
export SIMNV_PANEL_DENYLIST
export SIMNV_PANEL_SKIP_PUSH_TESTS=1

newrepo() {
  r="$root/repo-$1"
  mkdir -p "$r"
  cd "$r" || exit 2
  git init -q .
  git config user.email t@example.invalid
  git config user.name t
  git config commit.gpgsign false
  printf 'base\n' > base.txt
  git add base.txt
  git commit -qm base
}

hook() { sh "$hooks/check-denylist.sh" "$@"; }
has() { grep -qF -- "$1" "$out"; }
lacks() { ! grep -qF -- "$1" "$out"; }

# (a) content that looks like a diff header is not a header
newrepo a
printf 'ok\n++ leakword\n@@ -1 +9 @@\nSYNTHTERM\n' > f.txt
git add f.txt
out="$root/a.out"; hook > "$out" 2>&1; rc=$?
check "a: hit blocks" test $rc -eq 1
check "a: correct file:line" has "privacy: f.txt:4"
check "a: only one hit line" test "$(grep -c '^privacy: f.txt' "$out")" -eq 1
check "a: no content in output" lacks leakword

# (b) term added then removed in a later commit: pre-push blocks with commit:file:line
newrepo b
c0=$(git rev-parse HEAD)
printf 'SYNTHTERM\n' > a.txt
git add a.txt
git commit -qm add
c1=$(git rev-parse --short HEAD)
printf 'clean\n' > a.txt
git add a.txt
git commit -qm remove
c2=$(git rev-parse HEAD)
zero=0000000000000000000000000000000000000000
out="$root/b1.out"
printf 'refs/heads/x %s refs/heads/x %s\n' "$c2" "$zero" | sh "$hooks/pre-push" > "$out" 2>&1; rc=$?
check "b: new branch push blocked" test $rc -ne 0
check "b: commit:file:line reported" has "privacy: $c1:a.txt:1"
out="$root/b2.out"
printf 'refs/heads/x %s refs/heads/x %s\n' "$c2" "$c0" | sh "$hooks/pre-push" > "$out" 2>&1; rc=$?
check "b: update push blocked" test $rc -ne 0
check "b: update reports commit:file:line" has "privacy: $c1:a.txt:1"
check "b: no term in output" lacks SYNTHTERM

# (c) invalid range
newrepo c
out="$root/c.out"; hook --range nosuchrev..alsonosuch > "$out" 2>&1; rc=$?
check "c: invalid range exits non-zero" test $rc -ne 0
out="$root/c2.out"; hook --commit nosuchrev > "$out" 2>&1; rc=$?
check "c: invalid commit exits non-zero" test $rc -ne 0

# (d) odd file names, staged and --all
newrepo d
printf 'SYNTHTERM\n' > "sp ace.txt"
printf 'SYNTHTERM\n' > "q'uote.txt"
printf 'SYNTHTERM\n' > ./-dash.txt
git add -- "sp ace.txt" "q'uote.txt" ./-dash.txt
out="$root/d1.out"; hook > "$out" 2>&1; rc=$?
check "d: staged blocked" test $rc -eq 1
check "d: staged space name" has "privacy: sp ace.txt:1"
check "d: staged quote name" has "privacy: q'uote.txt:1"
check "d: staged dash name" has "privacy: -dash.txt:1"
git commit -qm odd
out="$root/d2.out"; hook --all > "$out" 2>&1; rc=$?
check "d: --all blocked" test $rc -eq 1
check "d: --all space name" has "privacy: sp ace.txt:1"
check "d: --all quote name" has "privacy: q'uote.txt:1"
check "d: --all dash name" has "privacy: -dash.txt:1"

# (e) the denylist path never appears
check "e: no path marker in staged output" lacks SYNTHMARK
check "e: no path marker in --all output" sh -c "! grep -qF SYNTHMARK '$root/d2.out'"
check "e: no path marker in hit output (a)" sh -c "! grep -qF SYNTHMARK '$root/a.out'"

# (f) IPv4 boundaries and (g) mixed demo and real address
newrepo f
# Addresses are built from parts, so this file holds no literal address for the privacy scan to find.
p1=10.99
p2=110.99
dm=10.10.0
printf 'x %s.1.1 y\n%s.1.1\nok %s.5\nmix %s.5 and %s.1.2\n%s.1.3 start\nv 10.0.2.2 host\n' "$p2" "$p1" "$dm" "$dm" "$p1" "$p1" > ip.txt
git add ip.txt
out="$root/f.out"; hook > "$out" 2>&1; rc=$?
check "f: blocked" test $rc -eq 1
check "f: 110.99.1.1 not flagged" lacks "privacy: ip.txt:1"
check "f: private address flagged" has "privacy: ip.txt:2"
check "f: demo address alone not flagged" lacks "privacy: ip.txt:3"
check "g: demo plus real on one line flagged" has "privacy: ip.txt:4"
check "f: address at line start flagged" has "privacy: ip.txt:5"
check "f: 10.0.2.2 allowed" lacks "privacy: ip.txt:6"

# Generic patterns without a private file
newrepo h
h1=/Users
h2=aa:bb:cc:dd:ee
printf 'p %s/someone/x\nm %s:ff\n' "$h1" "$h2" > g.txt
git add g.txt
out="$root/h.out"; SIMNV_PANEL_DENYLIST="$root/none" hook > "$out" 2>&1; rc=$?
check "h: generic patterns block without private file" test $rc -eq 1
check "h: home path line" has "privacy: g.txt:1"
check "h: mac line" has "privacy: g.txt:2"

echo "$n checks, $fails failed"
[ "$fails" -eq 0 ]
