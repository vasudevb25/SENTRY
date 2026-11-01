const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const { sha256 } = require('./hash');
const { buildMerkleRoot } = require('./merkle');
const softhsm = require('./softhsm');
const db = require('./db');
const fabric = require('./fabric');

let prevHash = 'GENESIS';
let buffer = []; // array of { id, hash, signature } for the current batch
let lastFlush = Date.now();
let flushing = false;
let retrying = false;
let processingQueue = Promise.resolve();

/**
 * Returns a function that accepts raw stream chunks and emits complete lines.
 * A chunk can end mid-line; without this, one log line would be split into
 * two separately hashed "entries".
 */
function lineSplitter(onLine) {
    let partial = '';
    return (chunk) => {
        const lines = (partial + chunk).split('\n');
        partial = lines.pop();
        lines.forEach(onLine);
    };
}

function queueLog(log) {
    processingQueue = processingQueue
        .then(() => processLog(log))
        .catch(err => {
            console.error('⚠️ Log processing error:', err.message);
        });

    return processingQueue;
}
async function initializeChain() {
    prevHash = await db.getLastHash();
    console.log('🔗 Hash chain initialized from:', prevHash === 'GENESIS'
        ? 'GENESIS'
        : prevHash.slice(0, 16) + '...');
}
// --- SIGN ---
// Real Ed25519 signing via the simulated software HSM (softhsm.js).
// The original version signed with sha256("PRIVATE_KEY_" + data) — a hardcoded
// string, not a private key at all, and trivially forgeable by anyone who
// read this file. That defeated the entire "prove the log is safe" goal.
function sign(hash) {
    return softhsm.sign(hash);
}

// --- PROCESS LOG ---
async function processLog(log) {
    try {
        if (!log.trim()) return;

        const thisPrevHash = prevHash;
        const hash = sha256(thisPrevHash + log);
        const signature = sign(hash);

        const id = await db.storeLog({
            log,
            prevHash: thisPrevHash,
            hash,
            signature
        });

        prevHash = hash;
        buffer.push({ id, hash, signature });

    } catch (err) {
        console.error('⚠️ Process error:', err.message);
    }
}

// --- FLUSH ---
// Computes a merkle root over the current batch's signed hashes and anchors
// it on Hyperledger Fabric. Unlike the original code, the batch is only
// considered "done" once Fabric confirms it — if the peer is unreachable the
// root is kept in the pending_roots table (see db.js) and retried later by
// retryPendingRoots(), instead of being silently discarded.
async function flush() {
    if (flushing || retrying || buffer.length === 0) return;
    flushing = true;

    const batch = buffer;
    buffer = [];
    lastFlush = Date.now();

    const root = buildMerkleRoot(batch.map((b) => b.signature));
    console.log('🌳 Merkle Root:', root, `(batch of ${batch.length})`);

    let rootId;
    try {
        rootId = await db.recordPendingRoot(root);
        await db.assignRoot(batch.map((b) => b.id), rootId);
    } catch (err) {
        console.error('⚠️  Failed to persist pending root locally:', err.message);
        flushing = false;
        return;
    }

    try {
        const { txId, assetId } = await fabric.submitToBlockchain(root);
        await db.markRootConfirmed(rootId, txId, assetId);
        console.log('🔗 Anchored on Fabric. txId:', txId);
    } catch (err) {
        console.error('❌ Blockchain error (will retry):', err.message);
        // root stays 'pending' in the DB — retryPendingRoots() will pick it up
    }

    flushing = false;
}

// --- RETRY LOOP for roots that failed to anchor ---
async function retryPendingRoots() {
    // a root being anchored by flush() right now is still 'pending' in the DB;
    // retrying it concurrently would anchor the same batch twice
    if (flushing || retrying) return;
    retrying = true;
    try {
        await retryPendingRootsInner();
    } finally {
        retrying = false;
    }
}

async function retryPendingRootsInner() {
    let pending;
    try {
        pending = await db.getPendingRoots();
    } catch (err) {
        console.error('⚠️  Failed to read pending_roots:', err.message);
        return;
    }
    if (pending.length === 0) return;

    console.log(`⏳ Retrying ${pending.length} unanchored root(s)...`);
    for (const row of pending) {
        try {
            const { txId, assetId } = await fabric.submitToBlockchain(row.root);
            await db.markRootConfirmed(row.id, txId, assetId);
            console.log('🔗 Anchored on retry:', row.root, 'txId:', txId);
        } catch (err) {
            console.error(`❌ Retry failed for root ${row.root.slice(0, 12)}...:`, err.message);
            // leave as pending, will try again next interval
        }
    }
}

// --- WATCH JOURNAL ---
function watchJournal() {
    if (!config.ENABLE_JOURNALD) return;
    // -n 0: only follow NEW entries; without it journalctl first replays the
    // last 10 historical lines into the chain on every agent start
    const proc = spawn('journalctl', ['-f', '-n', '0', '-o', 'short']);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', lineSplitter(queueLog));

    proc.stderr.on('data', (data) => {
        console.error('⚠️  journalctl stderr:', data.toString().trim());
    });

    proc.on('error', (err) => {
        console.error('⚠️  journalctl could not start (is it installed / are you root?):', err.message);
    });

    console.log('📡 journald connected');
}

// --- WATCH FILE (for syslog, auth.log, audit.log, etc.) ---
function watchFile(file) {
    let position = 0;
    let warnedMissing = false;
    const onChunk = lineSplitter(queueLog);

    // seed position at current EOF so we only process NEW lines from now on,
    // instead of replaying the entire historical file as one giant batch
    try {
        position = fs.statSync(file).size;
    } catch (e) {
        // file may not exist yet; position stays 0 and we'll pick it up once it appears
    }

    setInterval(() => {
        try {
            const stat = fs.statSync(file);
            if (stat.size < position) {
                // file was rotated/truncated — start over from the beginning
                position = 0;
            }
            if (stat.size === position) return; // nothing new

            const fd = fs.openSync(file, 'r');
            const length = stat.size - position;
            const bufChunk = Buffer.alloc(length);
            fs.readSync(fd, bufChunk, 0, length, position);
            fs.closeSync(fd);
            position = stat.size;

            onChunk(bufChunk.toString('utf-8'));
            warnedMissing = false;
        } catch (e) {
            // Surface real problems (permissions, etc.) instead of the original
            // silent `catch (e) {}`, which hid why logs stopped flowing.
            if (!warnedMissing) {
                console.error(`⚠️  watchFile(${file}):`, e.code === 'ENOENT' ? 'file not found (yet)' : e.message);
                warnedMissing = true;
            }
        }
    }, config.FILE_POLL_INTERVAL_MS);

    console.log('📡 watching:', file);
}

let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n🛑 Shutting down — flushing remaining logs...');
    await processingQueue; // logs still being hashed/stored must make the final batch
    while (flushing || retrying) {
        await new Promise((r) => setTimeout(r, 100));
    }
    await flush();
    await fabric.disconnect();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- START ALL SOURCES ---
if (!softhsm.keystoreExists()) {
    console.error('❌ No HSM keystore found. Run: node keygen.js   (after export HSM_PASSPHRASE=...)');
    process.exit(1);
}
if (!process.env.HSM_PASSPHRASE) {
    console.error('❌ HSM_PASSPHRASE is not set. Run: export HSM_PASSPHRASE="your-passphrase"');
    process.exit(1);
}
try {
    // fail fast on a wrong passphrase instead of erroring on every log line
    softhsm.getDataEncryptionKey();
    softhsm.sign('startup-check');
} catch (err) {
    console.error('❌', err.message);
    process.exit(1);
}

(async () => {
    try {
        await initializeChain();

        watchJournal();
        config.WATCH_FILES.forEach(watchFile);

        console.log('🚀 Agent running (FULL LOG MODE)...');

        setInterval(async () => {
            if (
                buffer.length >= config.BATCH_SIZE ||
                Date.now() - lastFlush > config.BATCH_TIME_MS
            ) {
                await flush();
            }
        }, config.FLUSH_CHECK_INTERVAL_MS);

        setInterval(retryPendingRoots, config.RETRY_INTERVAL_MS);

    } catch (err) {
        console.error('❌ Failed to initialize agent:', err);
        process.exit(1);
    }
})();

