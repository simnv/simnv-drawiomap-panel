#!/usr/bin/env bash
# Runs the Woodpecker workflows of .woodpecker/ on the local docker with woodpecker-cli exec (docker backend).
# Usage: npm run ci:woodpecker                          (lint, then the workflow .woodpecker/ci.yaml)
#        npm run ci:woodpecker -- .woodpecker/ci.yaml   (one workflow file)
# The workflow builds once and runs the e2e tests on both Grafana versions with that build.
# The steps write node_modules, dist/ and .drawio/ in the workspace. So this script copies the files of the working
# tree (tracked and untracked, without ignored files) to a new $WP_DIR/repo, with a new git repository of one commit,
# and runs the workflows there.
# woodpecker-cli runs in a container with the docker socket and makes bind mounts of $WP_DIR/repo: this path must
# be the same in the container and on the docker host (Docker Desktop and OrbStack share the home folder).
set -euo pipefail
cd "$(dirname "$0")/.."
cli_image=${WP_CLI_IMAGE:-woodpeckerci/woodpecker-cli:v3}
work=${WP_DIR:-$HOME/.cache/wp-ci}
target=${1:-.woodpecker}
step() { printf '\n=== %s\n' "$*"; }

cli() {
  docker run --rm -u 0 -v /var/run/docker.sock:/var/run/docker.sock -v "$work/repo:$work/repo" -w "$work/repo" \
    "$cli_image" "$@"
}

step "copy the working tree to $work/repo"
rm -rf "$work/repo"
mkdir -p "$work/repo"
git ls-files -co --exclude-standard -z | rsync -a --from0 --files-from=- ./ "$work/repo/"
# The step "privacy" runs git ls-files, so the copy needs a repository. One commit of the copied files is enough.
git -C "$work/repo" init -q
git -C "$work/repo" add -A
git -C "$work/repo" -c user.name=ci -c user.email=ci@localhost -c commit.gpgsign=false commit -q -m "ci:woodpecker copy"

step "woodpecker-cli lint"
cli lint .woodpecker

step "woodpecker-cli exec $target"
cli exec --repo-path "$work/repo" --pipeline-event push "$target"
step "ci:woodpecker OK"
