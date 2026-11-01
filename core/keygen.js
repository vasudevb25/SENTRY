/**
 * keygen.js — run this ONCE before the first time you start agent.js
 *
 *   export HSM_PASSPHRASE="choose-a-strong-passphrase"
 *   node keygen.js
 *
 * Creates core/keystore/hsm-keystore.json containing:
 *   - your Ed25519 public key (plaintext, safe to share)
 *   - your Ed25519 private key (encrypted with your passphrase, AES-256-GCM)
 *   - a derived database-encryption key (also passphrase-protected)
 *
 * You must export the same HSM_PASSPHRASE every time you run agent.js,
 * verify.js, or any other script that signs or reads logs. There is no
 * recovery if you lose the passphrase — that's the point of an HSM model.
 */

const softhsm = require('./softhsm');

const passphrase = process.env.HSM_PASSPHRASE;

if (!passphrase) {
    console.error('❌ Set HSM_PASSPHRASE first, e.g.:');
    console.error('   export HSM_PASSPHRASE="choose-a-strong-passphrase"');
    process.exit(1);
}

if (softhsm.keystoreExists()) {
    console.error(`❌ Keystore already exists at ${softhsm.KEYSTORE_PATH}`);
    console.error('   Delete it manually first if you really want to regenerate keys');
    console.error('   (this will invalidate verification of any logs already signed).');
    process.exit(1);
}

const { publicKey } = softhsm.generateAndStoreKeypair(passphrase);

console.log('✅ Software HSM keystore created:', softhsm.KEYSTORE_PATH);
console.log('\nPublic key (safe to share / publish for external verification):\n');
console.log(publicKey);
