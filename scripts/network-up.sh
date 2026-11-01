#!/usr/bin/env bash
# Brings up the Hyperledger Fabric test-network and creates "mychannel".
# Run this BEFORE starting agent.js — the "Failed to connect before the
# deadline on Endorser..." errors happen because nothing is listening on
# localhost:7051 yet.
#
# Usage: bash scripts/network-up.sh [path-to-fabric-samples]
# Defaults to ./fabric-samples inside this project.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_SAMPLES="${1:-$PROJECT_ROOT/fabric-samples}"

if [ ! -d "$FABRIC_SAMPLES/test-network" ]; then
    echo "❌ Could not find $FABRIC_SAMPLES/test-network"
    echo "   If fabric-samples lives somewhere else, pass its path as an argument:"
    echo "   bash scripts/network-up.sh /path/to/fabric-samples"
    exit 1
fi

cd "$FABRIC_SAMPLES/test-network"

echo "🧹 Bringing down any previous network..."
./network.sh down

echo "🚀 Starting network + creating channel 'mychannel' (CA-based identities)..."
./network.sh up createChannel -c mychannel -ca

# Every network-up issues brand-new certificates, so any previously enrolled
# wallet identity is now invalid ("DiscoveryService: access denied").
rm -rf "$PROJECT_ROOT/core/wallet"

echo "✅ Network is up. Peer0.org1 should now be reachable at localhost:7051"
echo "   Next: bash scripts/deploy-chaincode.sh   then   (cd core && node createWallet.js)"
