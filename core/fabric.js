const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs');
const config = require('./config');

let gateway = null;
let contract = null;
let connecting = null;

/**
 * Connects once and reuses the same Gateway/contract handle for every
 * submission. The original version opened a brand-new Gateway connection on
 * every single flush() call, which is slow and was masking the fact that
 * failures were silently swallowed. Call this lazily — connect() is a no-op
 * once already connected.
 */
async function connect() {
    if (contract) return contract;
    if (connecting) return connecting; // avoid duplicate concurrent connect attempts

    connecting = (async () => {
        if (!fs.existsSync(config.FABRIC_CCP_PATH)) {
            throw new Error(
                `Connection profile not found at ${config.FABRIC_CCP_PATH}. ` +
                `Is fabric-samples/test-network up? See FABRIC_NETWORK_PATH in config.js.`
            );
        }
        const ccp = JSON.parse(fs.readFileSync(config.FABRIC_CCP_PATH, 'utf8'));

        const wallet = await Wallets.newFileSystemWallet(config.FABRIC_WALLET_PATH);
        const identity = await wallet.get(config.FABRIC_IDENTITY);
        if (!identity) {
            throw new Error(
                `Identity "${config.FABRIC_IDENTITY}" not found in wallet (${config.FABRIC_WALLET_PATH}). ` +
                `Run "node createWallet.js" first.`
            );
        }

        const gw = new Gateway();
        await gw.connect(ccp, {
            wallet,
            identity: config.FABRIC_IDENTITY,
            discovery: { enabled: true, asLocalhost: config.FABRIC_DISCOVERY_AS_LOCALHOST },
            eventHandlerOptions: { commitTimeout: config.FABRIC_CONNECT_TIMEOUT_MS / 1000 },
        });

        const network = await gw.getNetwork(config.FABRIC_CHANNEL);
        const ctr = network.getContract(config.FABRIC_CHAINCODE);

        gateway = gw;
        contract = ctr;
        console.log('🔗 Connected to Hyperledger Fabric channel:', config.FABRIC_CHANNEL);
        return ctr;
    })();

    try {
        return await connecting;
    } finally {
        connecting = null;
    }
}

/** Submits a merkle root as a new asset. Returns the tx id on success, throws on failure. */
async function submitToBlockchain(root) {
    const ctr = await connect();
    const id = 'log_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const txn = ctr.createTransaction('CreateAsset');
    const txId = txn.getTransactionId();
    await txn.submit(id, root, Date.now().toString(), 'system', 'valid');
    return { assetId: id, txId };
}

/** Reads back a previously anchored asset by id — used by verify.js. */
async function readFromBlockchain(assetId) {
    const ctr = await connect();
    const result = await ctr.evaluateTransaction('ReadAsset', assetId);
    return JSON.parse(result.toString());
}

/** Returns all anchored assets — used by verify.js to cross-check local roots. */
async function getAllAssets() {
    const ctr = await connect();
    const result = await ctr.evaluateTransaction('GetAllAssets');
    return JSON.parse(result.toString());
}

async function disconnect() {
    if (gateway) {
        gateway.disconnect();
        gateway = null;
        contract = null;
    }
}

module.exports = { connect, submitToBlockchain, readFromBlockchain, getAllAssets, disconnect };
