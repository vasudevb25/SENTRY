/**
 * createWallet.js — imports the test-network's User1@org1 identity into
 * core/wallet as "appUser". Re-run after every network-up.sh, because each
 * fresh network issues new certificates.
 */
const fs = require('fs');
const path = require('path');
const { Wallets } = require('fabric-network');
const config = require('./config');

async function main() {
    const userMsp = path.join(
        config.FABRIC_NETWORK_PATH,
        'test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp'
    );
    const certPath = path.join(userMsp, 'signcerts', 'cert.pem');
    const keyDir = path.join(userMsp, 'keystore');

    if (!fs.existsSync(certPath) || !fs.existsSync(keyDir)) {
        throw new Error(
            `User1 crypto material not found under ${userMsp}. ` +
            `Is the network up (bash scripts/network-up.sh) and FABRIC_NETWORK_PATH correct?`
        );
    }

    const keyFile = fs.readdirSync(keyDir)
        .find(file => file.endsWith('_sk'));

    if (!keyFile) {
        throw new Error('User1 private key not found');
    }

    const certificate = fs.readFileSync(certPath, 'utf8');
    const privateKey = fs.readFileSync(
        path.join(keyDir, keyFile),
        'utf8'
    );

    const wallet = await Wallets.newFileSystemWallet(config.FABRIC_WALLET_PATH);

    // overwrite any stale identity left over from a previous network
    if (await wallet.get(config.FABRIC_IDENTITY)) {
        await wallet.remove(config.FABRIC_IDENTITY);
    }
    await wallet.put(config.FABRIC_IDENTITY, {
        credentials: {
            certificate,
            privateKey
        },
        mspId: 'Org1MSP',
        type: 'X.509'
    });

    console.log(`✅ ${config.FABRIC_IDENTITY} identity imported successfully`);
    console.log(`Wallet: ${config.FABRIC_WALLET_PATH}`);
}

main().catch(error => {
    console.error('❌ Failed to create wallet:', error.message);
    process.exit(1);
});
