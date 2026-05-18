#!/usr/bin/env bash
# Bring up the Prometheus + Grafana stack via Podman.
#
# Idempotent: re-running while the stack is already up is a no-op for the
# compose containers (podman-compose up -d skips already-running services).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

# 1. Make sure the Podman VM is up. `podman info` exits non-zero when the
#    daemon socket isn't reachable, which is the cleanest "is it running?"
#    check available without parsing version strings.
if ! podman info >/dev/null 2>&1; then
  echo "→ podman machine not reachable, starting it..."
  if ! podman machine list --format '{{.Name}}' | grep -q .; then
    podman machine init
  fi
  podman machine start
fi

# 1b. Slam the VM's clock to the host's UTC time. Some Podman machine images
#     ship with an unreliable upstream NTP peer (we hit one ~77s off real
#     UTC), which makes Prometheus complain about clock skew and can land
#     match samples at the wrong wall time. Setting the clock once per
#     stack-up keeps things tight without surgery on the VM's chrony
#     config. Drift accumulates over a session (~seconds per hour); just
#     re-run stack-up.sh if the Prometheus UI starts warning again.
echo "→ syncing VM clock to host"
podman machine ssh "sudo date -u -s '$(date -u +%Y-%m-%dT%H:%M:%S)'" >/dev/null 2>&1 \
  || echo "  (couldn't set VM clock — continuing anyway)"

# 2. Work around broken docker-credential-gcloud helpers (shared with
#    prometheus-clear.sh; see scripts/_lib.sh for the rationale).
docker_config_aside

# 3. Compose up.
podman-compose up -d

# 4. Show the running services.
echo
podman ps --filter "label=io.podman.compose.project=recall" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

cat <<MSG

Stack is up:
  Prometheus: http://localhost:9090
  Grafana:    http://localhost:3000  (admin / admin)
MSG
