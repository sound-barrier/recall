#!/usr/bin/env bash
# Tear down the Prometheus + Grafana stack.
#
# Usage:
#   stack-down.sh             — stop and remove containers; leave podman VM running
#   stack-down.sh --machine   — also stop the podman VM to free host resources
#
# Container volumes (prometheus_data, grafana_data) are NOT removed —
# next stack-up.sh will resume with all history intact. To wipe Prometheus
# history specifically, use prometheus-clear.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# podman-compose reads docker-compose.yml from the cwd, which lives at the
# repo root — two levels up from scripts/stack/, not one.
cd "$SCRIPT_DIR/../.."

podman-compose down

if [[ "${1:-}" == "--machine" ]]; then
  echo "→ stopping podman machine"
  podman machine stop
fi

echo "Stack is down."
