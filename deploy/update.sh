#!/usr/bin/env bash
# Update the running app to the latest commit on GitHub. Run on the VPS:
#   ~/sl-karta/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only --quiet
commit=$(git rev-parse --short HEAD)
deployed=$(cat .deployed 2>/dev/null || true)
echo "code: ${deployed:-none} -> $commit"
if [ "$commit" = "$deployed" ] && [ "$(docker compose ps -q app)" ]; then
  echo "already up to date"
  exit 0
fi

# Build first while the old container keeps serving, then swap (a few seconds of restart).
docker compose build --quiet app
docker compose up -d --remove-orphans

# Wait until the new container reports healthy.
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)
  [ "$status" = "healthy" ] && break
  sleep 2
done
echo "app: ${status:-unknown}"
[ "$status" = "healthy" ] && echo "$commit" > .deployed

# Remove old image layers so the disk doesn't fill up over many deploys.
docker image prune -f >/dev/null
[ "$status" = "healthy" ]
