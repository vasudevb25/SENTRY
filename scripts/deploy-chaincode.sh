#!/usr/bin/env bash
# Deploys the "logstore" chaincode (chaincode/logstore) onto the running
# test-network. Run network-up.sh first.
#
# Usage: bash scripts/deploy-chaincode.sh [path-to-fabric-samples] [path-to-chaincode]
# Defaults to ./fabric-samples and ./chaincode/logstore inside this project.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_SAMPLES="${1:-$PROJECT_ROOT/fabric-samples}"
CHAINCODE_DIR="${2:-$PROJECT_ROOT/chaincode/logstore}"

if [ ! -d "$FABRIC_SAMPLES/test-network" ]; then
    echo "❌ Could not find $FABRIC_SAMPLES/test-network"
    exit 1
fi
if [ ! -d "$CHAINCODE_DIR" ]; then
    echo "❌ Could not find chaincode at $CHAINCODE_DIR"
    echo "   bash scripts/deploy-chaincode.sh /path/to/fabric-samples /path/to/chaincode/logstore"
    exit 1
fi

# network.sh is run from inside test-network, so relative paths would resolve
# against the wrong directory ("Path to chaincode does not exist").
FABRIC_SAMPLES="$(cd "$FABRIC_SAMPLES" && pwd)"
CHAINCODE_DIR="$(cd "$CHAINCODE_DIR" && pwd)"

echo "📦 Installing chaincode node dependencies..."
(cd "$CHAINCODE_DIR" && npm install)

cd "$FABRIC_SAMPLES/test-network"

echo "🚀 Deploying chaincode 'logstore'..."
if ! ./network.sh deployCC -ccn logstore -ccp "$CHAINCODE_DIR" -ccl javascript; then
    echo "❌ Chaincode deployment failed — see output above."
    exit 1
fi

echo "✅ Chaincode deployed. You can now run the agent."
