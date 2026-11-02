#!/bin/sh
# Tests for check-denylist.sh and pre-push. Builds throwaway repos; uses synthetic terms only.
# Run: npm run test:hooks
hooks=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d) || { echo "test-denylist: mktemp failed" >&2; exit 1; }
trap 'rm -rf "$root"' EXIT
fails=0
n=0

ok() { n=$((n + 1)); echo "ok $n - $1"; }
bad() { n=$((n + 1)); fails=$((fails + 1)); echo "not ok $n - $1"; [ -f "${out:-}" ] && sed 's/^/   | /' "$out"; }
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
printf 'refs/heads/x %s refs/heads/x %s\n' "$c2" "$zero" | sh "$hooks/pre-push" origin url > "$out" 2>&1; rc=$?
check "b: new branch push blocked" test $rc -ne 0
check "b: commit:file:line reported" has "privacy: $c1:a.txt:1"
out="$root/b2.out"
printf 'refs/heads/x %s refs/heads/x %s\n' "$c2" "$c0" | sh "$hooks/pre-push" origin url > "$out" 2>&1; rc=$?
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
out="$root/h.out"; env SIMNV_PANEL_DENYLIST="$root/none" sh "$hooks/check-denylist.sh" > "$out" 2>&1; rc=$?
check "h: generic patterns block without private file" test $rc -eq 1
check "h: home path line" has "privacy: g.txt:1"
check "h: mac line" has "privacy: g.txt:2"

# The scan prints only file and line, never the content (staged and --all)
newrepo w
printf 'leakword SYNTHTERM\n' > w.txt
git add w.txt
out="$root/w.out"; hook > "$out" 2>&1
check "w: staged prints file and line" has "privacy: w.txt:1"
check "w: staged prints no content" lacks leakword
git commit -qm w
out="$root/w2.out"; hook --all > "$out" 2>&1
check "w: --all prints file and line" has "privacy: w.txt:1"
check "w: --all prints no content" lacks leakword
out="$root/w3.out"; hook --worker w.txt > "$out" 2>&1; rc=$?
check "w: the old worker argument is refused" test $rc -eq 2

# Literal pathspec name is still scanned
newrepo p
printf 'SYNTHTERM\n' > ':(exclude)*'
GIT_LITERAL_PATHSPECS=1 git add -- ':(exclude)*'
out="$root/p.out"; hook > "$out" 2>&1; rc=$?
check "p: pathspec-like name blocked" test $rc -eq 1
check "p: pathspec-like name reported" has "privacy: :(exclude)*:1"

# Newline in a file name: exit 2, name not printed
newrepo n
printf 'SYNTHTERM\n' > "$(printf 'nl\nname.txt')"
git add -A
out="$root/n.out"; hook > "$out" 2>&1; rc=$?
check "n: newline name exits 2" test $rc -eq 2
check "n: name not printed" lacks "name.txt"

# Right boundary: five-octet text is not an address, a sentence-end dot is
newrepo i
q1=10.99
printf 'v %s.1.1.2 end\nsee %s.1.1.\n' "$q1" "$q1" > b.txt
git add b.txt
out="$root/i.out"; hook > "$out" 2>&1; rc=$?
check "i: five octets not flagged" lacks "privacy: b.txt:1"
check "i: trailing dot flagged" has "privacy: b.txt:2"

# Push to remote X scans only commits X lacks; commits only on remote Y are scanned for X
newrepo r
printf 'SYNTHTERM\n' > y.txt
git add y.txt
git commit -qm onlyy
cy=$(git rev-parse --short HEAD)
git update-ref refs/remotes/y/main HEAD
printf 'clean\n' > z.txt
git add z.txt
git commit -qm next
head=$(git rev-parse HEAD)
out="$root/r1.out"
printf 'refs/heads/b %s refs/heads/b %s\n' "$head" "$zero" | sh "$hooks/pre-push" x url > "$out" 2>&1; rc=$?
check "r: push to x scans commit present only on y" test $rc -ne 0
check "r: reports that commit" has "privacy: $cy:y.txt:1"
out="$root/r2.out"
printf 'refs/heads/b %s refs/heads/b %s\n' "$head" "$zero" | sh "$hooks/pre-push" y url > "$out" 2>&1; rc=$?
check "r: push to y skips commits y already has" test $rc -eq 0

# Batching: many files in one commit keep their own file and line numbers
newrepo m
i=0
while [ $i -lt 60 ]; do
  printf 'l1\nl2\n' > "f$i.txt"
  i=$((i + 1))
done
printf 'l1\nl2\nSYNTHTERM\n' > f7.txt
printf 'SYNTHTERM\nl2\nl3\nSYNTHTERM\n' > f41.txt
git add -A
git commit -qm many
out="$root/m1.out"; hook --commit HEAD > "$out" 2>&1; rc=$?
check "m: many files blocked" test $rc -eq 1
check "m: file 7 line 3" has ":f7.txt:3"
check "m: file 41 line 1" has ":f41.txt:1"
check "m: file 41 line 4" has ":f41.txt:4"
check "m: exactly three hit lines" test "$(grep -c '^privacy: [0-9a-f]*:' "$out")" -eq 3
out="$root/m2.out"; hook --all > "$out" 2>&1; rc=$?
check "m: --all many files blocked" test $rc -eq 1
check "m: --all file 7 line 3" has "privacy: f7.txt:3"
check "m: --all exactly three hit lines" test "$(grep -c '^privacy: f' "$out")" -eq 3

# Binary files, mode-only changes, empty files and added lines that look like headers sit between text files
newrepo k
printf 'x\n' > a1.txt
printf 'x\n' > c1.sh
git add -A
git commit -qm k0
printf 'SYNTHTERM\n' > a1.txt
printf 'bin\000SYNTHTERM\000\n' > b1.bin
chmod +x c1.sh
: > d1.empty
printf 'diff --git a/e1.txt b/e1.txt\n@@ -1 +1 @@\n--- a/e1.txt\n+++ b/e1.txt\nSYNTHTERM\n' > e1.txt
printf 'no newline SYNTHTERM' > f1.txt
printf 'clean\n' > g1.txt
git add -A
out="$root/k1.out"; hook > "$out" 2>&1; rc=$?
check "k: staged blocked" test $rc -eq 1
check "k: text file before the binary file" has "privacy: a1.txt:1"
check "k: binary file not reported" lacks "b1.bin"
check "k: mode-only file not reported" lacks "c1.sh"
check "k: empty file not reported" lacks "d1.empty"
check "k: header-like lines are content" has "privacy: e1.txt:5"
check "k: header-like lines give no other hit" test "$(grep -c '^privacy: e1.txt' "$out")" -eq 1
check "k: file without final newline" has "privacy: f1.txt:1"
check "k: clean file after them not reported" lacks "g1.txt"
git commit -qm k1
out="$root/k2.out"; hook --all > "$out" 2>&1; rc=$?
check "k: --all blocked" test $rc -eq 1
check "k: --all skips the binary file" lacks "b1.bin"
check "k: --all text hits" has "privacy: e1.txt:5"

# Names that git quotes in a diff header, and non-ASCII names
newrepo q
printf 'x\n' > a0.txt
printf 'SYNTHTERM\n' > 'q"uote.txt'
printf 'SYNTHTERM\n' > 'back\slash.txt'
printf 'SYNTHTERM\n' > 'ünï cödé.txt'
printf 'SYNTHTERM\n' > 'zz.txt'
git add -A
out="$root/q1.out"; hook > "$out" 2>&1; rc=$?
check "q: staged blocked" test $rc -eq 1
check "q: double quote name" has 'privacy: q"uote.txt:1'
check "q: backslash name" has 'privacy: back\slash.txt:1'
check "q: unicode name" has 'privacy: ünï cödé.txt:1'
check "q: name after them" has "privacy: zz.txt:1"
git commit -qm q
out="$root/q2.out"; hook --commit HEAD > "$out" 2>&1; rc=$?
check "q: --commit blocked" test $rc -eq 1
check "q: --commit unicode name" has 'ünï cödé.txt:1'
out="$root/q3.out"; hook --all > "$out" 2>&1; rc=$?
check "q: --all unicode name" has 'privacy: ünï cödé.txt:1'
check "q: --all backslash name" has 'privacy: back\slash.txt:1'

# Deleted file and rename (each commit is scanned on its own)
newrepo d2
printf 'SYNTHTERM\n' > gone.txt
printf 'SYNTHTERM\nkeep\n' > old.txt
printf 'ok\n' > other.txt
git add -A
git commit -qm d0
c1=$(git rev-parse --short HEAD)
git rm -q gone.txt
printf 'ok2\n' > other.txt
git add -A
git commit -qm del
out="$root/d3.out"; hook --commit HEAD > "$out" 2>&1; rc=$?
check "d2: a deleted file does not block its commit" test $rc -eq 0
out="$root/d4.out"; hook --commit "$c1" > "$out" 2>&1; rc=$?
check "d2: the commit that added the term blocks" test $rc -eq 1
check "d2: reports the deleted file with the commit" has "privacy: $c1:gone.txt:1"
git mv old.txt new.txt
git commit -qm mv
out="$root/d5.out"; hook --commit HEAD > "$out" 2>&1; rc=$?
check "d2: a rename is scanned as an added file" test $rc -eq 1
check "d2: reports the new name" has ":new.txt:1"
check "d2: does not report the old name" lacks "old.txt"
git mv new.txt other2.txt
out="$root/d6.out"; hook > "$out" 2>&1; rc=$?
check "d2: a staged rename is scanned as an added file" test $rc -eq 1
check "d2: staged reports the new name" has "privacy: other2.txt:1"
git reset -q --hard

# Term added in the second of three commits and removed in the third: pre-push blocks on the second one
newrepo t3
c0=$(git rev-parse HEAD)
printf 'one\n' > x1.txt
git add -A; git commit -qm t1
printf 'SYNTHTERM\n' > x2.txt
git add -A; git commit -qm t2
c2=$(git rev-parse --short HEAD)
git rm -q x2.txt
git commit -qm t3
head=$(git rev-parse HEAD)
out="$root/t3.out"
printf 'refs/heads/x %s refs/heads/x %s\n' "$head" "$c0" | sh "$hooks/pre-push" origin url > "$out" 2>&1; rc=$?
check "t3: push blocked although the last commit is clean" test $rc -ne 0
check "t3: reports the middle commit" has "privacy: $c2:x2.txt:1"
check "t3: net range diff is clean (why per-commit scanning matters)" sh -c "sh '$hooks/check-denylist.sh' --range '$c0..$head' > /dev/null 2>&1"

# package-lock.json: only the root file skips the generic patterns; the private terms apply to it
newrepo l
mkdir sub
h1=/Users
printf 'p %s/someone/x\n' "$h1" > package-lock.json
printf 'p %s/someone/x\n' "$h1" > sub/package-lock.json
git add -A
out="$root/l1.out"; hook > "$out" 2>&1; rc=$?
check "l: nested lock file is scanned" has "privacy: sub/package-lock.json:1"
check "l: root lock file skips generic patterns" lacks "privacy: package-lock.json:1"
printf 'SYNTHTERM\n' > package-lock.json
git add -A
out="$root/l2.out"; hook > "$out" 2>&1; rc=$?
check "l: root lock file is scanned for private terms" has "privacy: package-lock.json:1"

# Address tokens: one bad address on a line with allowed ones, across several files
newrepo ip
p1=10.99
dm=10.10.0
printf 'a %s.5 b %s.5\n' "$dm" "$dm" > ip1.txt
printf 'a %s.5 b %s.1.2 c\nnone\n%s.1.2,\n' "$dm" "$p1" "$p1" > ip2.txt
printf 'ver 1.2.3.4.5\n.%s.1.9\n' "$p1" > ip3.txt
git add -A
out="$root/ip.out"; hook > "$out" 2>&1; rc=$?
check "ip: blocked" test $rc -eq 1
check "ip: allowed addresses alone are clean" lacks "privacy: ip1.txt"
check "ip: bad address among allowed ones" has "privacy: ip2.txt:1"
check "ip: clean line between them" lacks "privacy: ip2.txt:2"
check "ip: address before a comma" has "privacy: ip2.txt:3"
check "ip: leading dot is not an address" lacks "privacy: ip3.txt"

# Fail closed: a broken tool or an unreadable file blocks with exit 2
newrepo fc
printf 'clean\n' > fc.txt
git add fc.txt
mkdir -p "$root/shim"
printf '#!/bin/sh\nexit 1\n' > "$root/shim/awk"
chmod +x "$root/shim/awk"
out="$root/fc1.out"; env PATH="$root/shim:$PATH" sh "$hooks/check-denylist.sh" > "$out" 2>&1; rc=$?
check "fc: a failing awk blocks a clean staged change" test $rc -eq 2
git commit -qm fc
out="$root/fc2.out"; env PATH="$root/shim:$PATH" sh "$hooks/check-denylist.sh" --all > "$out" 2>&1; rc=$?
check "fc: a failing awk blocks a clean --all scan" test $rc -eq 2
if [ "$(id -u)" -ne 0 ]; then
  chmod 000 fc.txt
  out="$root/fc3.out"; hook --all > "$out" 2>&1; rc=$?
  chmod 644 fc.txt
  check "fc: an unreadable file blocks --all" test $rc -eq 2
fi
rm -f "$root/shim/awk"
printf '#!/bin/sh\nexit 1\n' > "$root/shim/xargs"
chmod +x "$root/shim/xargs"
out="$root/fc4.out"; env PATH="$root/shim:$PATH" sh "$hooks/check-denylist.sh" --all > "$out" 2>&1; rc=$?
check "fc: a failing xargs blocks --all" test $rc -eq 2

# Fault injection: fail ONE call of one tool at a time (exit 3, no output). The next stage of the scan
# still runs and succeeds on empty input. Every such fault must end the scan with exit 2.
# POSIX sh has no pipefail, so a failed left-hand stage of a pipeline would pass silently.
sweep_tools="tr cut sort paste wc cmp grep awk"
shimdir="$root/sweepshim"
counts="$root/sweepcounts"
mkdir -p "$shimdir"
for t in $sweep_tools; do
  real=$(command -v "$t")
  cat > "$shimdir/$t" <<SHIM
#!/bin/sh
c="\$SHIM_COUNTS/$t"
n=\$(cat "\$c" 2> /dev/null || echo 0)
n=\$((n + 1))
echo "\$n" > "\$c"
[ "\${FAIL_AT:-}" = "$t:\$n" ] && exit 3
exec $real "\$@"
SHIM
  chmod +x "$shimdir/$t"
done

faulty() { # fail-spec, hook arguments...
  spec=$1; shift
  rm -rf "$counts"; mkdir -p "$counts"
  FAIL_AT="$spec" SHIM_COUNTS="$counts" PATH="$shimdir:$PATH" sh "$hooks/check-denylist.sh" "$@"
}

sweep() { # description, expected normal exit code, hook arguments...
  desc=$1; want=$2; shift 2
  out="$root/sweep.out"
  faulty none "$@" > "$out" 2>&1; rc=$?
  check "sweep $desc: normal run exits $want (got $rc)" test $rc -eq "$want"
  rm -rf "$counts.base"; cp -R "$counts" "$counts.base"
  bad="$root/sweep.bad"; : > "$bad"
  covered=yes
  for t in $sweep_tools; do
    total=$(cat "$counts.base/$t" 2> /dev/null || echo 0)
    [ "$total" -gt 0 ] || covered="no ($t)"
    k=1
    while [ "$k" -le "$total" ]; do
      faulty "$t:$k" "$@" > "$out" 2>&1; rc=$?
      [ $rc -eq 2 ] || echo "$t call $k exit $rc" >> "$bad"
      grep -qF leakword "$out" && echo "$t call $k leaked content" >> "$bad"
      k=$((k + 1))
    done
  done
  check "sweep $desc: every tool is called" test "$covered" = yes
  out="$bad"
  check "sweep $desc: every single failed call exits 2" test ! -s "$bad"
}

newrepo sw
h1=/Users
p1=10.99
dm=10.10.0
printf 'leakword SYNTHTERM\np %s/someone/x\nip %s.5 and %s.1.2\nok\n' "$h1" "$dm" "$p1" > sw.txt
printf 'p %s/someone/y\n' "$h1" > package-lock.json
git add -A
sweep "staged" 1
git commit -qm sw
sweep "--commit" 1 --commit HEAD
sweep "--all" 1 --all

# Fault injection: a temp file that the shell cannot open. A mktemp shim makes a dangling symlink for
# one temp file name. The shell then fails to open that file before any tool runs. This is a different
# failure from a tool that exits non-zero. Every file that a mode uses must end the scan with exit 2.
real_mktemp=$(command -v mktemp)
mkdir -p "$root/mkshim"
cat > "$root/mkshim/mktemp" <<SHIM
#!/bin/sh
t=\$($real_mktemp "\$@") || exit 2
[ -n "\${FAULT_TARGET:-}" ] && { ln -s "\$t/no-such-dir/x" "\$t/\$FAULT_TARGET" || exit 2; }
printf '%s\n' "\$t"
SHIM
chmod +x "$root/mkshim/mktemp"

opensweep() { # description, hook arguments...
  desc=$1; shift
  common="rc terms terms.1 allow allow.1 names names.all names.plain names.nl rec found.term found.gen found.ip
    rec.gen m1 m1.pos m2 m2.pos ipcand text tok.raw pos n.cand n.tok ptok toklist tokens uniq valid bad
    found.pos found.col hits done"
  case "$1" in
    --all) only="files grep.out grep.tab" ;;
    *) only="diff" ;;
  esac
  none="$root/open.none"; : > "$none"
  bad="$root/open.bad"; : > "$bad"
  for target in $common $only; do
    FAULT_TARGET=$target PATH="$root/mkshim:$PATH" sh "$hooks/check-denylist.sh" "$@" > "$root/open.out" 2>&1; rc=$?
    [ $rc -eq 2 ] || echo "$target exit $rc" >> "$bad"
    grep -qF leakword "$root/open.out" && echo "$target leaked content" >> "$bad"
    grep -qF SYNTHMARK "$root/open.out" && echo "$target leaked the denylist path" >> "$bad"
  done
  out="$bad"
  check "open $desc: a temp file that cannot be opened exits 2" test ! -s "$bad"
  # A target that this mode never uses must not change the result.
  case "$1" in
    --all) other="diff" ;;
    *) other="files" ;;
  esac
  FAULT_TARGET=$other PATH="$root/mkshim:$PATH" sh "$hooks/check-denylist.sh" "$@" > "$root/open.out" 2>&1; rc=$?
  out="$root/open.out"
  check "open $desc: a temp name the mode does not use is harmless" test $rc -eq 1
}

newrepo op
h1=/Users
p1=10.99
dm=10.10.0
printf 'leakword SYNTHTERM\np %s/someone/x\nip %s.5 and %s.1.2\nok\n' "$h1" "$dm" "$p1" > op.txt
git add -A
opensweep "staged"
git commit -qm op
opensweep "--commit" --commit HEAD
opensweep "--all" --all

# The hooks directory comes from a checked dirname. A failing dirname must not make the scan read
# privacy-allow.txt from the current directory (here a file that allows every address).
newrepo dn
p1=10.99
printf 'ip %s.1.2\n' "$p1" > dn.txt
printf '.*\n' > privacy-allow.txt
git add -A
mkdir -p "$root/dnshim"
printf '#!/bin/sh\nexit 2\n' > "$root/dnshim/dirname"
chmod +x "$root/dnshim/dirname"
mkdir -p "$root/dnshim0"
printf '#!/bin/sh\nexit 0\n' > "$root/dnshim0/dirname"
chmod +x "$root/dnshim0/dirname"
out="$root/dn0.out"; hook > "$out" 2>&1; rc=$?
check "dn: normal staged scan blocks the address" test $rc -eq 1
out="$root/dn1.out"; env PATH="$root/dnshim:$PATH" sh "$hooks/check-denylist.sh" > "$out" 2>&1; rc=$?
check "dn: a failing dirname exits 2 (staged)" test $rc -eq 2
out="$root/dn2.out"; env PATH="$root/dnshim0:$PATH" sh "$hooks/check-denylist.sh" > "$out" 2>&1; rc=$?
check "dn: a dirname with empty output exits 2 (staged)" test $rc -eq 2
git commit -qm dn
out="$root/dn3.out"; env PATH="$root/dnshim:$PATH" sh "$hooks/check-denylist.sh" --all > "$out" 2>&1; rc=$?
check "dn: a failing dirname exits 2 (--all)" test $rc -eq 2
out="$root/dn4.out"; env PATH="$root/dnshim:$PATH" sh "$hooks/check-denylist.sh" --commit HEAD > "$out" 2>&1; rc=$?
check "dn: a failing dirname exits 2 (--commit)" test $rc -eq 2
out="$root/dn5.out"; hook --commit HEAD > "$out" 2>&1; rc=$?
check "dn: normal --commit scan blocks the address" test $rc -eq 1

echo "$n checks, $fails failed"
[ "$fails" -eq 0 ]
