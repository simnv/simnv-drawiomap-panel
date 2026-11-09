#!/usr/bin/env bash
# The CI status of one commit on GitHub Actions and on Woodpecker (the Forgejo mirror).
#
#   scripts/ci-status.sh [--wait] [--logs] [<commit>]    (npm run ci:status -- ...)
#
# <commit> is HEAD when not given. --wait polls every 30 s (at most 60 min) until no run is pending.
# --logs prints the last 60 lines of each failed Woodpecker step.
# Exit status: 0 all runs succeeded, 1 a run failed, 2 a run is pending (also when --wait ends after 60 min),
# 3 a setup or API error (no Woodpecker settings, gh not logged in, an HTTP error).
#
# GitHub uses the gh CLI. Woodpecker needs WOODPECKER_SERVER and WOODPECKER_TOKEN in the gitignored .env
# (or in the environment). Only these keys and WOODPECKER_REPO are read from .env; nothing is exported.
# The Woodpecker repository is the path of the git remote "forgejo" (WOODPECKER_REPO=owner/name overrides it).
# The mirror syncs every 10 minutes, so a new commit is "pending" on Woodpecker until the sync.
set -uo pipefail

wait=0
logs=0
ref=HEAD
for arg in "$@"; do
  case "$arg" in
    --wait) wait=1 ;;
    --logs) logs=1 ;;
    -*) echo "ci-status: unknown option $arg" >&2; exit 3 ;;
    *) ref=$arg ;;
  esac
done

root=$(git rev-parse --show-toplevel) || exit 3
sha=$(git rev-parse --verify "$ref^{commit}") || { echo "ci-status: unknown commit $ref" >&2; exit 3; }
# Read only the Woodpecker keys from .env. A value set in the environment wins.
if [ -f "$root/.env" ]; then
  while IFS='=' read -r key value || [ -n "$key" ]; do
    key=${key#export }
    value=${value%$'\r'}
    case "$key" in
      WOODPECKER_SERVER | WOODPECKER_TOKEN | WOODPECKER_REPO)
        value=${value%\"}; value=${value#\"}; value=${value%\'}; value=${value#\'}
        [ -n "${!key:-}" ] || printf -v "$key" '%s' "$value"
        ;;
    esac
  done < "$root/.env"
fi
repo=${WOODPECKER_REPO:-$(git remote get-url forgejo 2> /dev/null | sed -E 's#^.*[:/]([^/]+/[^/]+)$#\1#; s#\.git$##')}

# The header comes from a builtin printf through a pipe, so the token is not in the argv of curl (ps shows argv).
wp() {
  printf 'Authorization: Bearer %s\n' "$WOODPECKER_TOKEN" | curl -sf --max-time 30 -H @- "$WOODPECKER_SERVER/api$1"
}

# Prints one line for each GitHub run and returns 0 (all succeeded), 1 (a failure), 2 (pending) or 3 (error).
github() {
  local runs
  runs=$(gh run list --commit "$sha" --json name,status,conclusion,url 2> /dev/null) || {
    echo "github: gh run list failed (run gh auth status)"
    return 3
  }
  if [ "$(jq length <<< "$runs")" = 0 ]; then
    echo "github: no run yet"
    return 2
  fi
  jq -r '.[] | "github: \(.name): \(if .status == "completed" then .conclusion else .status end)  \(.url)"' <<< "$runs"
  jq -e 'any(.[]; .status == "completed" and (.conclusion | IN("success", "skipped", "neutral") | not))' <<< "$runs" > /dev/null && return 1
  jq -e 'any(.[]; .status != "completed")' <<< "$runs" > /dev/null && return 2
  return 0
}

# Prints the Woodpecker pipeline of the commit and returns 0, 1, 2 or 3 as github() does.
woodpecker() {
  if [ -z "${WOODPECKER_SERVER:-}" ] || [ -z "${WOODPECKER_TOKEN:-}" ] || [ -z "$repo" ]; then
    echo "woodpecker: not configured (set WOODPECKER_SERVER and WOODPECKER_TOKEN in .env, and add the git remote forgejo)"
    return 3
  fi
  local id page list pipeline="" number status details
  id=$(wp "/repos/lookup/$repo" | jq -er .id) || { echo "woodpecker: repository lookup failed"; return 3; }
  # Newest first, 50 for each page. Look at the last 200 pipelines.
  for page in 1 2 3 4; do
    list=$(wp "/repos/$id/pipelines?page=$page&perPage=50") || { echo "woodpecker: pipeline list failed"; return 3; }
    pipeline=$(jq -c --arg sha "$sha" '[.[] | select(.commit == $sha)] | max_by(.number) // empty' <<< "$list") \
      || { echo "woodpecker: unexpected pipeline list"; return 3; }
    [ -n "$pipeline" ] && break
    [ "$(jq length <<< "$list")" -lt 50 ] && break
  done
  if [ -z "$pipeline" ]; then
    echo "woodpecker: no pipeline yet (the mirror syncs every 10 minutes)"
    return 2
  fi
  number=$(jq -r .number <<< "$pipeline")
  status=$(jq -r .status <<< "$pipeline")
  echo "woodpecker: pipeline $number ($(jq -r .event <<< "$pipeline")): $status"
  case "$status" in
    success) return 0 ;;
    created | pending | running | blocked) return 2 ;;
  esac
  details=$(wp "/repos/$id/pipelines/$number") || { echo "woodpecker: pipeline details failed"; return 1; }
  # The detached services (grafana*, metrics-gen) always end with exit 137 at teardown: that is not a failure.
  jq -r '.workflows[].children[] | select(.state == "failure" and .exit_code != 137) | "\(.id) \(.name) \(.exit_code)"' <<< "$details" \
    | while read -r step name code; do
      echo "woodpecker:   failed step $name (exit $code)"
      if [ "$logs" = 1 ]; then
        wp "/repos/$id/logs/$number/$step" | jq -r 'sort_by(.line) | .[].data | @base64d' | sed -E $'s/\x1b\\[[0-9;]*m//g' | tail -n 60 | sed 's/^/    /'
      fi
    done
  return 1
}

echo "commit $sha"
deadline=$((SECONDS + 3600))
errors=0
while :; do
  out=$(github)
  gh_status=$?
  out="$out"$'\n'$(woodpecker)
  wp_status=$?
  if [ "$gh_status" = 3 ] || [ "$wp_status" = 3 ]; then result=3
  elif [ "$gh_status" = 1 ] || [ "$wp_status" = 1 ]; then result=1
  elif [ "$gh_status" = 2 ] || [ "$wp_status" = 2 ]; then result=2
  else result=0; fi
  # With --wait, retry an error 3 times (a timeout, a 5xx, a network blip) before the script stops.
  if [ "$result" = 3 ] && [ "$wait" = 1 ] && [ "$errors" -lt 3 ] && [ "$SECONDS" -lt "$deadline" ]; then
    errors=$((errors + 1))
    echo "ci-status: error, poll again in 30 s ($errors of 3)" >&2
    sleep 30
    continue
  fi
  [ "$result" = 3 ] || errors=0
  if [ "$result" != 2 ] || [ "$wait" = 0 ] || [ "$SECONDS" -ge "$deadline" ]; then
    echo "$out"
    exit "$result"
  fi
  sleep 30
done
