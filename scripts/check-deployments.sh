#!/usr/bin/env bash
# Guards the two deployments against each other.
#
#   1. DEMO build   (NEXT_PUBLIC_DEMO_MODE=true): the output must contain NO country-specific
#      text (Uganda, UGX, Kampala, wellcash.ug, ...). Source maps are off for this build, so the
#      original source can't leak them either.
#   2. DEFAULT build (variable unset): must still contain the Uganda text, i.e. the real
#      system behaves exactly as before.
#
# Usage:  npm run check:deployments        (takes a couple of minutes: two production builds)
# Needs DATABASE_URL to be set to anything valid-looking; the builds don't query the database.
set -euo pipefail

: "${DATABASE_URL:=postgresql://check:check@localhost:5432/check}"
: "${SESSION_SECRET:=check-only}"
export DATABASE_URL SESSION_SECRET NEXT_TELEMETRY_DISABLED=1

FORBIDDEN='Uganda|uganda|UGX|Kampala|shilling|wellcash\.ug|en-UG|Nakato|Mukasa'
DEMO_DIST=".check-demo-build"
UG_DIST=".check-uganda-build"
trap 'rm -rf "$DEMO_DIST" "$UG_DIST"' EXIT
rm -rf "$DEMO_DIST" "$UG_DIST"

echo "== Building the DEMO deployment =="
DIST_DIR="$DEMO_DIST" NEXT_PUBLIC_DEMO_MODE=true npx next build > /dev/null
leaks=$(grep -rIlE "$FORBIDDEN" "$DEMO_DIST/static" "$DEMO_DIST/server" 2>/dev/null || true)
if [ -n "$leaks" ]; then
  echo "FAIL: country-specific text found in the demo build:"
  echo "$leaks"
  exit 1
fi
echo "OK: demo build is free of country-specific text."

echo "== Building the DEFAULT (Uganda) deployment =="
DIST_DIR="$UG_DIST" npx next build > /dev/null
for expected in "UGX" "Every shilling tracked" "yourname@wellcash.ug"; do
  if ! grep -rIlq "$expected" "$UG_DIST/static" 2>/dev/null; then
    echo "FAIL: the Uganda build no longer contains \"$expected\" — its behaviour changed."
    exit 1
  fi
done
echo "OK: the Uganda build still behaves as before."
