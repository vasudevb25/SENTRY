/**
 * attacks.js — live attack simulations for demos. Each one tampers with
 * logs.db the way a real intruder with database access could, WITHOUT going
 * through the agent (so nothing gets legitimately re-signed). The point is to
 * show each defence layer catching a different kind of attack:
 *
 *   modify  edit a row's stored ciphertext         -> AES-GCM auth fails
 *   forge   insider with the DB key rewrites a log  -> Ed25519 signature fails
 *           and recomputes its hash                    + chain breaks at next row
 *   delete  remove a row that was already sealed    -> chain breaks + merkle
 *           into an anchored batch                     root no longer matches ledger
 */

const crypto = require('crypto');
const path = require('path');

const CORE = path.resolve(__dirname, '..', 'core');
const db = require(path.join(CORE, 'db'));
const softhsm = require(path.join(CORE, 'softhsm'));
const { sha256 } = require(path.join(CORE, 'hash'));

const all = (sql, params = []) =>
    new Promise((res, rej) => db.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const run = (sql, params = []) =>
    new Promise((res, rej) => db.db.run(sql, params, function (e) { return e ? rej(e) : res(this.changes); }));

function pick(rows) {
    return rows[Math.floor(Math.random() * rows.length)];
}

/** Recent rows that still decrypt (i.e. not already tampered with). */
async function intactRecent(where = '1=1', limit = 40) {
    const rows = await all(`SELECT * FROM logs WHERE ${where} ORDER BY id DESC LIMIT ?`, [limit]);
    return rows.filter((r) => !db.decryptLog(r).decryptFailed);
}

async function modify() {
    const rows = await intactRecent();
    if (rows.length === 0) throw new Error('No intact log entries to attack yet — generate some logs first.');
    const target = pick(rows);
    await run(`UPDATE logs SET log_ciphertext = ? WHERE id = ?`,
        [Buffer.from('attacker was here; nothing to see').toString('base64'), target.id]);
    return {
        type: 'modify',
        id: target.id,
        title: 'Ciphertext modified',
        detail: `Overwrote the encrypted body of log #${target.id} directly in logs.db.`,
        expect: 'CIPHERTEXT_TAMPERED (AES-256-GCM authentication tag no longer matches)',
    };
}

async function forge() {
    // needs a following row so the broken link is visible too
    const rows = await intactRecent(`id < (SELECT MAX(id) FROM logs)`);
    if (rows.length === 0) throw new Error('Need at least two intact log entries — generate some logs first.');
    const target = pick(rows);
    const original = db.decryptLog(target).log;
    const forged = 'Accepted password for root from 10.0.0.66 port 4444 ssh2 [FORGED]';

    // the insider holds the DB encryption key, so the new ciphertext is valid…
    const dek = softhsm.getDataEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const ct = Buffer.concat([cipher.update(forged, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // …and recomputes the hash, but cannot produce a signature without the HSM key
    const newHash = sha256(target.prev_hash + forged);

    await run(`UPDATE logs SET log_iv=?, log_tag=?, log_ciphertext=?, hash=? WHERE id=?`,
        [iv.toString('base64'), tag.toString('base64'), ct.toString('base64'), newHash, target.id]);
    return {
        type: 'forge',
        id: target.id,
        title: 'Insider forgery',
        detail: `Rewrote log #${target.id} ("${String(original).slice(0, 60)}…") to a fake root login, re-encrypted it and recomputed its hash.`,
        expect: `BAD_SIGNATURE on #${target.id} + HASH_MISMATCH on the next entry`,
    };
}

async function remove() {
    const rows = await all(
        `SELECT l.id FROM logs l JOIN pending_roots p ON p.id = l.root_id
         WHERE p.status = 'confirmed' ORDER BY l.id DESC LIMIT 40`
    );
    if (rows.length === 0) throw new Error('No log entries sealed on-chain yet — wait for an "Anchored" batch first.');
    const target = pick(rows);
    await run(`DELETE FROM logs WHERE id = ?`, [target.id]);
    return {
        type: 'delete',
        id: target.id,
        title: 'Evidence deleted',
        detail: `Deleted log #${target.id} — an entry already sealed in a batch anchored on Hyperledger Fabric.`,
        expect: 'HASH_MISMATCH on the following entry + LOCAL_ROOT_MISMATCH against the ledger',
    };
}

const ATTACKS = { modify, forge, delete: remove };

async function runAttack(type) {
    const fn = ATTACKS[type];
    if (!fn) throw new Error(`Unknown attack "${type}"`);
    return fn();
}

module.exports = { runAttack, ATTACK_TYPES: Object.keys(ATTACKS) };
