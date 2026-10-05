#!/usr/bin/env bash
# Guards from MDP's lessons. Run in CI before every deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. No SQL function defined in two different migrations (MDP's September booking break:
#    a reused function name silently replaced the booking function).
dups=$(grep -hoiE 'create (or replace )?function public\.[a-z_0-9]+' supabase/migrations/*.sql \
  | sed -E 's/.*public\.//I' | sort | uniq -d || true)
if [ -n "$dups" ]; then
  # allowed only if every definition is in the SAME file (overloads); otherwise fail
  for f in $dups; do
    n=$(grep -liE "function public\.$f\(" supabase/migrations/*.sql | wc -l)
    if [ "$n" -gt 1 ]; then echo "✗ function public.$f is defined in $n migrations — rename it or edit the original"; exit 1; fi
  done
fi
echo "✓ no function defined in two migrations"

# 2. Every client-callable function the app uses exists in the migrations.
missing=0
for fn in $(grep -rhoE "rpc(<[^>]+>)?\('[a-z_]+'" web/app web/components web/lib | sed -E "s/.*'([a-z_]+)'/\1/" | sort -u); do
  grep -qiE "function public\.$fn\(" supabase/migrations/*.sql || { echo "✗ app calls rpc('$fn') but no migration defines it"; missing=1; }
done
[ $missing -eq 0 ] && echo "✓ every rpc() the app calls exists"
exit $missing
