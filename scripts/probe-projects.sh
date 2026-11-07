#!/usr/bin/env bash
# Probes the Projects v2 REST endpoints that github-rest uses, and prints a markdown table
# with the HTTP code of each call. Run it in Claude's cloud to see what its GitHub proxy lets
# through. Writes go to a test project that needs a number field named `Probe`; the script
# puts every value back as it was and removes the item it added.
#
# Usage: scripts/probe-projects.sh <owner> <project-n> <repo> <issue-n> <pr-n> [<archived-item-id>]
# Example: scripts/probe-projects.sh ramon-sg 4 ramon-sg/github-rest 6 5 296675777
set -uo pipefail

if [ $# -lt 5 ]; then
  sed -n '2,8p' "$0"
  exit 2
fi
owner=$1 project=$2 repo=$3 issue=$4 pr=$5 archived=${6:-}

kind=users
[ "$(gh api "users/$owner" --jq .type 2>/dev/null)" = "Organization" ] && kind=orgs
base="$kind/$owner/projectsV2/$project"

out=$(mktemp)
trap 'rm -f "$out"' EXIT
status=0
headers=""
body=""

# call METHOD PATH [JSON]: leaves the HTTP code in $status (0 = no response), the headers in
# $headers and the body in $body.
call() {
  local method=$1 path=$2 json=${3:-}
  if [ -n "$json" ]; then
    printf '%s' "$json" | gh api -i --method "$method" "$path" --input - >"$out" 2>/dev/null
  else
    gh api -i --method "$method" "$path" >"$out" 2>/dev/null
  fi
  status=$(head -1 "$out" | awk '{print $2}')
  status=${status:-0}
  headers=$(sed -n '1,/^\r\{0,1\}$/p' "$out")
  body=$(sed '1,/^\r\{0,1\}$/d' "$out")
}

row() { printf '| %s | `%s` | %s | %s |\n' "$1" "$2" "$status" "$3"; }

echo "| # | endpoint | HTTP | note |"
echo "|---|---|---|---|"

call GET "$base/fields"
field=$(printf '%s' "$body" | jq -r '[.[]? | select(.name=="Probe" and .data_type=="number") | .id][0] // empty' 2>/dev/null)
row 1 "GET $base/fields" "${field:+Probe field id $field}"
if [ -z "$field" ]; then
  echo "probe: the project has no number field named Probe (or fields failed)." >&2
  exit 1
fi

call GET "$base/items?fields[]=$field&per_page=100"
count=$(printf '%s' "$body" | jq 'length' 2>/dev/null)
before=$(printf '%s' "$body" | jq -r --arg r "$repo" --argjson n "$issue" \
  '[.[]? | select(.content.number==$n and (.content.repository_url|endswith("/repos/"+$r))) | .id][0] // empty' 2>/dev/null)
link=$(printf '%s' "$headers" | grep -i '^link:' | tr -d '\r')
row 2 "GET $base/items?fields[]=…" "${count:-?} items${link:+; has Link}"

owner_repo=${repo%%/*} name=${repo#*/}
call POST "$base/items" "{\"type\":\"Issue\",\"owner\":\"$owner_repo\",\"repo\":\"$name\",\"number\":$issue}"
item=$(printf '%s' "$body" | jq -r '.id // empty' 2>/dev/null)
row 4 "POST $base/items" "item ${item:-?}${before:+, was already there}"
[ -z "$item" ] && item=$before

if [ -n "$item" ]; then
  call GET "$base/items/$item?fields[]=$field"
  old=$(printf '%s' "$body" | jq -c '.fields[]? | select(.id=='"$field"') | .value' 2>/dev/null)
  old=${old:-null}
  row 3 "GET $base/items/{id}" "Probe was $old"

  call PATCH "$base/items/$item" "{\"fields\":[{\"id\":$field,\"value\":1}]}"
  row 5 "PATCH $base/items/{id}" "set Probe=1"
  call GET "$base/items/$item?fields[]=$field"
  now=$(printf '%s' "$body" | jq -c '.fields[]? | select(.id=='"$field"') | .value' 2>/dev/null)
  row 5b "GET $base/items/{id}" "Probe reads back $now"
  call PATCH "$base/items/$item" "{\"fields\":[{\"id\":$field,\"value\":$old}]}"
  row 5c "PATCH $base/items/{id}" "restored Probe=$old"

  if [ -z "$before" ]; then
    call DELETE "$base/items/$item"
    row 4b "DELETE $base/items/{id}" "removed the item the probe added"
  fi
fi

call GET "repos/$repo/pulls/$pr/commits"
commits=$(printf '%s' "$body" | jq 'length' 2>/dev/null)
row 6 "GET repos/$repo/pulls/$pr/commits" "${commits:-?} commits"

call GET "$base/items?q=is:archived&per_page=100"
arch=$(printf '%s' "$body" | jq '[.[]? | select(.archived_at != null)] | length' 2>/dev/null)
row 7 "GET $base/items?q=is:archived" "${arch:-?} archived in the answer"

if [ -n "$archived" ]; then
  call GET "$base/items/$archived?fields[]=$field"
  at=$(printf '%s' "$body" | jq -r '.archived_at // "not archived"' 2>/dev/null)
  aold=$(printf '%s' "$body" | jq -c '.fields[]? | select(.id=='"$field"') | .value' 2>/dev/null)
  aold=${aold:-null}
  row 8 "GET $base/items/{archived}" "archived_at $at"
  call PATCH "$base/items/$archived" "{\"fields\":[{\"id\":$field,\"value\":2}]}"
  row 8b "PATCH $base/items/{archived}" "set Probe=2"
  call PATCH "$base/items/$archived" "{\"fields\":[{\"id\":$field,\"value\":$aold}]}"
  row 8c "PATCH $base/items/{archived}" "restored Probe=$aold"
fi

call GET user
scopes=$(printf '%s' "$headers" | grep -i '^x-oauth-scopes:' | cut -d: -f2- | tr -d '\r' | xargs)
row 9 "GET user" "scopes: ${scopes:-(none shown)}"
