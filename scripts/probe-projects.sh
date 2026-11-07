#!/usr/bin/env bash
# Probes the Projects v2 REST endpoints that github-rest uses, and prints a markdown table
# with the HTTP code of each call. Run it in Claude's cloud to see what its GitHub proxy lets
# through. Writes go to a test project that needs a number field named `Probe`; the script
# puts every value back as it was and removes the item it added, also when it is stopped
# halfway (Ctrl-C or a kill). Needs gh and jq.
#
# Usage: scripts/probe-projects.sh <owner> <project-n> <repo> <issue-n> <pr-n> [<archived-item-id>]
# Example: scripts/probe-projects.sh ramon-sg 4 ramon-sg/github-rest 6 5 296675777
set -uo pipefail

if [ $# -lt 5 ]; then
  sed -n '2,9p' "$0"
  exit 2
fi
owner=$1 project=$2 repo=$3 issue=$4 pr=$5 archived=${6:-}

for tool in gh jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "probe: needs $tool in the PATH." >&2
    exit 2
  fi
done

kind=users
[ "$(gh api "users/$owner" --jq .type 2>/dev/null)" = "Organization" ] && kind=orgs
base="$kind/$owner/projectsV2/$project"

out=$(mktemp)
status=0
headers=""
body=""

# What to undo if the script stops halfway (Ctrl-C, a kill): a field value to put back
# ("<item> <json value>", one per line) and an item the probe added.
undo_values=""
undo_item=""

# cleanup: puts back what the probe changed and was not restored yet, then removes the temp file.
cleanup() {
  local line item value
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    item=${line%% *} value=${line#* }
    printf '{"fields":[{"id":%s,"value":%s}]}' "$field" "$value" |
      gh api --method PATCH "$base/items/$item" --input - >/dev/null 2>&1 &&
      echo "probe: put Probe=$value back on item $item." >&2
  done <<<"$undo_values"
  if [ -n "$undo_item" ]; then
    gh api --method DELETE "$base/items/$undo_item" >/dev/null 2>&1 &&
      echo "probe: removed item $undo_item, which the probe added." >&2
  fi
  rm -f "$out"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

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
  if [ "$status" = 200 ]; then
    echo "probe: the project has no number field named Probe." >&2
  else
    echo "probe: could not read the fields (HTTP $status): $(printf '%s' "$body" | head -c 300)" >&2
  fi
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
post_message=$(printf '%s' "$body" | jq -r '.message // empty' 2>/dev/null)
row 4 "POST $base/items" "item ${item:-?}${before:+, was already there}${post_message:+; $post_message}"
[ -n "$item" ] && [ -z "$before" ] && undo_item=$item
[ -z "$item" ] && item=$before

if [ -n "$item" ]; then
  call GET "$base/items/$item?fields[]=$field"
  old=$(printf '%s' "$body" | jq -c '.fields[]? | select(.id=='"$field"') | .value' 2>/dev/null)
  old=${old:-null}
  row 3 "GET $base/items/{id}" "Probe was $old"

  undo_values="$item $old"
  call PATCH "$base/items/$item" "{\"fields\":[{\"id\":$field,\"value\":1}]}"
  row 5 "PATCH $base/items/{id}" "set Probe=1"
  call GET "$base/items/$item?fields[]=$field"
  now=$(printf '%s' "$body" | jq -c '.fields[]? | select(.id=='"$field"') | .value' 2>/dev/null)
  row 5b "GET $base/items/{id}" "Probe reads back $now"
  call PATCH "$base/items/$item" "{\"fields\":[{\"id\":$field,\"value\":$old}]}"
  row 5c "PATCH $base/items/{id}" "restored Probe=$old"
  undo_values=""

  if [ -n "$undo_item" ]; then
    call DELETE "$base/items/$item"
    row 4b "DELETE $base/items/{id}" "removed the item the probe added"
    undo_item=""
  fi
else
  # The issue is in the project but not in the first page of items, or it is archived: the
  # POST answers 422 without an id. Say so instead of leaving rows out.
  status="-"
  row 3/5 "GET/PATCH $base/items/{id}" "skipped: no item id (the issue is archived, or past the first 100 items)"
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
  undo_values="$archived $aold"
  call PATCH "$base/items/$archived" "{\"fields\":[{\"id\":$field,\"value\":2}]}"
  row 8b "PATCH $base/items/{archived}" "set Probe=2"
  call PATCH "$base/items/$archived" "{\"fields\":[{\"id\":$field,\"value\":$aold}]}"
  row 8c "PATCH $base/items/{archived}" "restored Probe=$aold"
  undo_values=""
fi

call GET user
scopes=$(printf '%s' "$headers" | grep -i '^x-oauth-scopes:' | cut -d: -f2- | tr -d '\r' | xargs)
row 9 "GET user" "scopes: ${scopes:-(none shown)}"
