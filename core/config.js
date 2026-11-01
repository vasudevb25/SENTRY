/**
 * config.js — central configuration. Override any of these with environment
 * variables (see scripts/set-env.sh.example) instead of editing this file directly.
 */

const path = require('path');

const FABRIC_NETWORK_PATH =
    process.env.FABRIC_NETWORK_PATH || path.resolve(__dirname, '../fabric-samples');

module.exports = {
    // --- Batching (Adaptive Merkle Batching) ---
    BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '20', 10),
    BATCH_TIME_MS: parseInt(process.env.BATCH_TIME_MS || '5000', 10),
    FLUSH_CHECK_INTERVAL_MS: parseInt(process.env.FLUSH_CHECK_INTERVAL_MS || '2000', 10),

    // --- Local storage ---
    DB_PATH: process.env.DB_PATH || path.join(__dirname, 'logs.db'),

    // --- Log sources ---
    ENABLE_JOURNALD: process.env.ENABLE_JOURNALD !== 'false',
    WATCH_FILES: (process.env.WATCH_FILES || '/var/log/syslog,/var/log/auth.log,/var/log/audit/audit.log')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    FILE_POLL_INTERVAL_MS: parseInt(process.env.FILE_POLL_INTERVAL_MS || '1000', 10),

    // --- Hyperledger Fabric ---
    // fabric-samples lives INSIDE this project (see README section 3):
    //   <project>/core            <- this folder
    //   <project>/fabric-samples  <- test-network
    // Override with FABRIC_NETWORK_PATH if yours lives elsewhere.
    FABRIC_NETWORK_PATH: FABRIC_NETWORK_PATH,
    FABRIC_CCP_PATH:
        process.env.FABRIC_CCP_PATH ||
        path.resolve(
            FABRIC_NETWORK_PATH,
            'test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json'
        ),
    FABRIC_WALLET_PATH: process.env.FABRIC_WALLET_PATH || path.join(__dirname, 'wallet'),
    FABRIC_IDENTITY: process.env.FABRIC_IDENTITY || 'appUser',
    FABRIC_CHANNEL: process.env.FABRIC_CHANNEL || 'mychannel',
    FABRIC_CHAINCODE: process.env.FABRIC_CHAINCODE || 'logstore',
    FABRIC_CONNECT_TIMEOUT_MS: parseInt(process.env.FABRIC_CONNECT_TIMEOUT_MS || '10000', 10),
    FABRIC_DISCOVERY_AS_LOCALHOST: process.env.FABRIC_DISCOVERY_AS_LOCALHOST !== 'false',

    // How often (ms) the agent retries any merkle roots that failed to anchor
    // on-chain (e.g. because the peer was down). Nothing is ever silently
    // dropped — see pending_roots table in db.js.
    RETRY_INTERVAL_MS: parseInt(process.env.RETRY_INTERVAL_MS || '15000', 10),
};
