#!/usr/bin/env bash
# Tears down the Hyperledger Fabric test-network and removes all containers/volumes.
# Usage: bash scripts/network-down.sh [path-to-fabric-samples]
# Defaults to ./fabric-samples inside this project.

set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_SAMPLES="${1:-$PROJECT_ROOT/fabric-samples}"
cd "$FABRIC_SAMPLES/test-network"
./network.sh down
echo "✅ Network down."
