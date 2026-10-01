#!/usr/bin/env bash
set -u

if [[ $# -ne 1 ]]; then
  printf 'Usage: bash %s https://atlas.example.com\n' "$0" >&2
  exit 2
fi

base_url="${1%/}"
if [[ "$base_url" != https://* && "$base_url" != http://* ]]; then
  printf 'Base URL must start with http:// or https://\n' >&2
  exit 2
fi

check_status() {
  local method="$1"
  local path="$2"
  shift 2
  local expected=("$@")
  local actual

  # Always discard bodies; this checker reports only HTTP status codes.
  actual="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 75 --request "$method" "${base_url}${path}")"

  for code in "${expected[@]}"; do
    if [[ "$actual" == "$code" ]]; then
      printf 'PASS %s %s -> %s\n' "$method" "$path" "$actual"
      return 0
    fi
  done

  printf 'FAIL %s %s -> %s (expected %s)\n' \
    "$method" "$path" "$actual" "${expected[*]}" >&2
  return 1
}

failures=0
check_status GET /api/health 200 || failures=$((failures + 1))
check_status GET /api/sales-points 200 || failures=$((failures + 1))

# Unknown probes avoid real admin/config/BESS handlers and have no side effects.
check_status GET /api/__boundary_probe__ 404 || failures=$((failures + 1))
check_status GET /api/odoo/__boundary_probe__ 404 || failures=$((failures + 1))
check_status GET /API/__boundary_probe__ 404 || failures=$((failures + 1))
check_status GET /Api/__boundary_probe__ 404 || failures=$((failures + 1))

# These POSTs target GET-only public endpoints, not any mutating legacy route.
check_status POST /api/health 403 405 || failures=$((failures + 1))
check_status POST /api/sales-points 403 405 || failures=$((failures + 1))
check_status POST /API/__boundary_probe__ 404 || failures=$((failures + 1))

if [[ "$failures" -ne 0 ]]; then
  printf '%s public API check(s) failed.\n' "$failures" >&2
  exit 1
fi

printf 'All public API checks passed.\n'