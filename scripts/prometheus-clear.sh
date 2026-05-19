#!/usr/bin/env bash
# Wipe Prometheus's TSDB volume so the next start begins with empty
# history. Useful when you've accumulated noisy / wrongly-timestamped
# samples while testing and want a clean slate. Grafana is left alone
# (its own state is unaffected — dashboards just show "no data" until
# the next scrape refills the TSDB).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

read -r -p "This will erase ALL Prometheus history. Confirm? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || {
  echo "aborted"
  exit 0
}

# Apply the cred-helper workaround before podman-compose tries to bring
# prometheus back up — `up -d prometheus` triggers an image lookup that
# falls into ~/.docker/config.json's credHelpers, same trap as stack-up.
docker_config_aside

# Tear the stack down so nothing references the prometheus_data volume.
# `down` removes the containers but PRESERVES named volumes (Grafana's
# dashboards/datasource state stays intact). Going through `down` avoids
# the surgical-rm dance that fails when Grafana's depends_on chains keep
# a container "in use".
echo "→ stopping containers"
podman-compose down 2>/dev/null || true

# Resolve the actual volume name. podman-compose prefixes named volumes
# with the project name (typical: `recall_prometheus_data`); look it
# up dynamically in case the project was renamed.
vol=$(podman volume ls --format '{{.Name}}' | grep -E 'prometheus_data$' | head -n1 || true)
if [[ -n "$vol" ]]; then
  echo "→ removing volume $vol"
  podman volume rm --force "$vol"
else
  echo "→ no prometheus_data volume found (already clean)"
fi

# Bring the whole stack back. Grafana resumes from its own (untouched)
# volume; Prometheus starts with an empty TSDB and will repopulate on
# the next scrape of the Wails app.
echo "→ restarting stack"
podman-compose up -d

echo "Prometheus history erased; new container started with an empty TSDB."
