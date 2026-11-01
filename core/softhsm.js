/**
 * softhsm.js — simulated software HSM (no TPM / no physical SoftHSM2 token required)
 *
 * This is what your progress report calls "Simulated secure signing mechanisms
 * (SoftHSM-style)". It does NOT talk to a real PKCS#11 token — it recreates the
 * important security property of an HSM in software:
 *   - the real private key is never stored on disk in plaintext
 *   - the real private key only ever exists in memory, for the instant it's needed
 *   - all signing happens behind sign()/verify(), so callers never touch the key
 *
 * Keys live in core/keystore/hsm-keystore.json (created by keygen.js).
 * The private key inside that file is wrapped (encrypted) with AES-256-GCM using
 * a key derived from a passphrase via scrypt. Set the passphrase with the
 * HSM_PASSPHRASE environment variable before starting agent.js / verify.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYSTORE_DIR = path.join(__dirname, 'keystore');
const KEYSTORE_PATH = path.join(KEYSTORE_DIR, 'hsm-keystore.json');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function getPassphrase() {
    const pass = process.env.HSM_PASSPHRASE;
    if (!pass) {
        throw new Error(
            'HSM_PASSPHRASE environment variable is not set. ' +
            'Run: export HSM_PASSPHRASE="your-passphrase" before starting this process.'
        );
    }
    return pass;
}

function deriveKey(passphrase, saltB64, purpose) {
    const salt = Buffer.concat([Buffer.from(saltB64, 'base64'), Buffer.from(':' + purpose)]);
    return crypto.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
}

function aesEncrypt(plaintextBuf, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: ciphertext.toString('base64'),
    };
}

function aesDecrypt(payload, key) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(payload.data, 'base64')),
        decipher.final(),
    ]);
}

function keystoreExists() {
    return fs.existsSync(KEYSTORE_PATH);
}

/**
 * One-time setup. Called by keygen.js. Generates a fresh Ed25519 keypair and
 * writes an encrypted keystore. Refuses to overwrite an existing keystore
 * unless force=true, so you don't accidentally invalidate your chain of custody.
 */
function generateAndStoreKeypair(passphrase, force = false) {
    if (keystoreExists() && !force) {
        throw new Error(`Keystore already exists at ${KEYSTORE_PATH}. Pass force=true to overwrite.`);
    }
    fs.mkdirSync(KEYSTORE_DIR, { recursive: true });

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const signingSalt = crypto.randomBytes(16).toString('base64');
    const dekSalt = crypto.randomBytes(16).toString('base64');

    const signingKey = deriveKey(passphrase, signingSalt, 'signing-key-wrap');
    const wrappedPrivateKey = aesEncrypt(Buffer.from(privateKey, 'utf8'), signingKey);

    // A separate derived key used by db.js to encrypt log contents at rest.
    // Kept in the same keystore so there's a single passphrase to manage,
    // but derived with an independent salt + purpose string (key separation).
    const dek = deriveKey(passphrase, dekSalt, 'db-encryption-key');

    const keystore = {
        version: 1,
        createdAt: new Date().toISOString(),
        publicKey,
        signingSalt,
        wrappedPrivateKey,
        dekSalt,
        // sanity check value so verify() can confirm the passphrase is correct
        // without ever decrypting/exposing the private key
        passphraseCheck: aesEncrypt(Buffer.from('ok'), dek),
    };

    fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystore, null, 2), { mode: 0o600 });
    return { publicKey };
}

function loadKeystore() {
    if (!keystoreExists()) {
        throw new Error(
            `No HSM keystore found at ${KEYSTORE_PATH}. Run "node keygen.js" first.`
        );
    }
    return JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf8'));
}

let _cachedPublicKey = null;

/** Returns the PEM public key (safe to log/share; used for verification). */
function getPublicKey() {
    if (_cachedPublicKey) return _cachedPublicKey;
    const ks = loadKeystore();
    _cachedPublicKey = ks.publicKey;
    return _cachedPublicKey;
}

/**
 * Signs `data` (string or Buffer) with the Ed25519 private key.
 * The private key is decrypted into memory only for the duration of this call.
 * Returns a base64 signature.
 */
function sign(data) {
    const ks = loadKeystore();
    const passphrase = getPassphrase();
    const signingKey = deriveKey(passphrase, ks.signingSalt, 'signing-key-wrap');

    let privateKeyPem;
    try {
        privateKeyPem = aesDecrypt(ks.wrappedPrivateKey, signingKey).toString('utf8');
    } catch (e) {
        throw new Error('Failed to unwrap HSM private key — wrong HSM_PASSPHRASE?');
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const signature = crypto.sign(null, buf, privateKeyPem);

    // best-effort scrub of the plaintext key material from the JS string/heap
    privateKeyPem = null;

    return signature.toString('base64');
}

/** Verifies a base64 signature against `data` using the stored public key. */
function verify(data, signatureB64, publicKeyPem = null) {
    const pub = publicKeyPem || getPublicKey();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    return crypto.verify(null, buf, pub, Buffer.from(signatureB64, 'base64'));
}

/** Returns the DB data-encryption-key (DEK) for db.js, and checks the passphrase is right. */
function getDataEncryptionKey() {
    const ks = loadKeystore();
    const passphrase = getPassphrase();
    const dek = deriveKey(passphrase, ks.dekSalt, 'db-encryption-key');
    try {
        const check = aesDecrypt(ks.passphraseCheck, dek).toString('utf8');
        if (check !== 'ok') throw new Error('bad');
    } catch (e) {
        throw new Error('Failed to derive DB encryption key — wrong HSM_PASSPHRASE?');
    }
    return dek;
}

module.exports = {
    KEYSTORE_PATH,
    keystoreExists,
    generateAndStoreKeypair,
    getPublicKey,
    sign,
    verify,
    getDataEncryptionKey,
};
