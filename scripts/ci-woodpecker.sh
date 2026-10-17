#!/usr/bin/env bash
# Runs the Woodpecker workflows of .woodpecker/ on the local docker with woodpecker-cli exec (docker backend).
# Usage: npm run ci:woodpecker                          (lint, then all workflows: build, e2e for each Grafana version)
#        npm run ci:woodpecker -- .woodpecker/build.yaml (one workflow without depends_on)
# woodpecker-cli exec runs the workflows one after the other. It does not run a workflow alone when its depends_on
# workflow is not in the same run ("all filtered out"), so e2e.yaml runs only with the directory.
# The steps write node_modules, dist/ and .drawio/ in the workspace. So this script copies the files of the working
# tree (tracked and untracked, without ignored files) to a new $WP_DIR/repo and runs the workflows there.
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

step "woodpecker-cli lint"
cli lint .woodpecker

step "woodpecker-cli exec $target"
cli exec --repo-path "$work/repo" --pipeline-event push "$target"
step "ci:woodpecker OK"
