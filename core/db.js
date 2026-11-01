const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const config = require('./config');
const softhsm = require('./softhsm');

const db = new sqlite3.Database(config.DB_PATH);
// the agent and the dashboard/verifier may hold the file open at the same
// time; wait for a lock instead of failing with SQLITE_BUSY
db.configure('busyTimeout', 5000);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT,
            log_iv TEXT,
            log_tag TEXT,
            log_ciphertext TEXT,
            prev_hash TEXT,
            hash TEXT,
            signature TEXT,
            root_id INTEGER
        )
    `);

    // A merkle root that has been computed but not yet (or not successfully)
    // anchored on Hyperledger Fabric. The original bug in this file cleared
    // the in-memory buffer unconditionally on flush, even when the blockchain
    // submission failed — silently losing the anchor for that batch. Now every
    // root is durably recorded here first, and only marked 'confirmed' once
    // Fabric accepts it. Nothing is lost if the peer is temporarily down.
    db.run(`
        CREATE TABLE IF NOT EXISTS pending_roots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root TEXT,
            created_at TEXT,
            status TEXT DEFAULT 'pending',
            tx_id TEXT,
            confirmed_at TEXT,
            asset_id TEXT
        )
    `);

    // databases created before asset_id existed — ignore "duplicate column"
    db.run(`ALTER TABLE pending_roots ADD COLUMN asset_id TEXT`, () => {});
});

let _dek = null;
function dek() {
    if (!_dek) _dek = softhsm.getDataEncryptionKey();
    return _dek;
}

function encryptLog(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek(), iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
}

/**
 * Decrypts one stored row. If the ciphertext or auth tag was modified after
 * the fact (e.g. an attacker editing the DB file directly), AES-GCM's
 * authentication check fails here — that's a second, independent tamper
 * signal on top of the hash chain. We surface it via `decryptFailed` rather
 * than throwing, so a single corrupted row doesn't crash verification of
 * everything else.
 */
function decryptLog(row) {
    // Resolved outside the try: a wrong HSM_PASSPHRASE must surface as an
    // error, not be misreported as every single row having been tampered with.
    const key = dek();
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.log_iv, 'base64'));
        decipher.setAuthTag(Buffer.from(row.log_tag, 'base64'));
        const plain = Buffer.concat([
            decipher.update(Buffer.from(row.log_ciphertext, 'base64')),
            decipher.final(),
        ]);
        return { log: plain.toString('utf8'), decryptFailed: false };
    } catch (err) {
        return { log: null, decryptFailed: true };
    }
}

/** Stores one hash-chained, signed, encrypted-at-rest log entry. */
function storeLog({ log, prevHash, hash, signature }) {
    return new Promise((resolve, reject) => {
        const enc = encryptLog(log);

        db.run(
            `INSERT INTO logs
             (ts, log_iv, log_tag, log_ciphertext, prev_hash, hash, signature)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                new Date().toISOString(),
                enc.iv,
                enc.tag,
                enc.ciphertext,
                prevHash,
                hash,
                signature
            ],
            function (err) {
                if (err) {
                    console.error('⚠️ storeLog error:', err.message);
                    reject(err);
                    return;
                }

                resolve(this.lastID);
            }
        );
    });
}

/** Records a merkle root as pending anchoring on Fabric. Returns its local id. */
function recordPendingRoot(root) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO pending_roots (root, created_at, status) VALUES (?, ?, 'pending')`,
            [root, new Date().toISOString()],
            function (err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

function markRootConfirmed(id, txId, assetId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE pending_roots SET status='confirmed', tx_id=?, asset_id=?, confirmed_at=? WHERE id=?`,
            [txId, assetId, new Date().toISOString(), id],
            (err) => (err ? reject(err) : resolve())
        );
    });
}

/** Links a batch of log rows to the merkle root that covers them. */
function assignRoot(logIds, rootId) {
    return new Promise((resolve, reject) => {
        if (logIds.length === 0) return resolve();
        const placeholders = logIds.map(() => '?').join(',');
        db.run(
            `UPDATE logs SET root_id=? WHERE id IN (${placeholders})`,
            [rootId, ...logIds],
            (err) => (err ? reject(err) : resolve())
        );
    });
}

/** All roots, pending or confirmed, in creation order — used by verify.js. */
function getAllRoots() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM pending_roots ORDER BY id ASC`, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function markRootFailed(id) {
    db.run(`UPDATE pending_roots SET status='pending' WHERE id=?`, [id]);
}

/** All roots still waiting to be anchored (e.g. peer was down when first tried). */
function getPendingRoots() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM pending_roots WHERE status='pending' ORDER BY id ASC`, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

/** All logs in insertion order, decrypted, for chain verification. */
function getAllLogsDecrypted() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM logs ORDER BY id ASC`, [], (err, rows) => {
            if (err) return reject(err);
            resolve(
                rows.map((row) => {
                    const { log, decryptFailed } = decryptLog(row);
                    return {
                        id: row.id,
                        ts: row.ts,
                        log,
                        decryptFailed,
                        prevHash: row.prev_hash,
                        hash: row.hash,
                        signature: row.signature,
                        rootId: row.root_id,
                    };
                })
            );
        });
    });
}
function getLastHash() {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT hash FROM logs ORDER BY id DESC LIMIT 1`,
            [],
            (err, row) => {
                if (err) return reject(err);
                resolve(row ? row.hash : 'GENESIS');
            }
        );
    });
}
module.exports = {
    db,
    decryptLog,
    storeLog,
    recordPendingRoot,
    markRootConfirmed,
    markRootFailed,
    assignRoot,
    getAllRoots,
    getPendingRoots,
    getAllLogsDecrypted,
    getLastHash,
};
