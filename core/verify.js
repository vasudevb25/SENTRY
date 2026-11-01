/**
 * verify.js — verification pipeline for the tamper-evident logging system.
 *
 * Usage:
 *   node verify.js chain           Recompute the local hash chain and check
 *                                  every entry's hash + Ed25519 signature.
 *   node verify.js onchain         Same as above, plus cross-checks every
 *                                  confirmed merkle root against what's
 *                                  actually anchored on Hyperledger Fabric.
 *   node verify.js tamper-demo     Demonstration: silently corrupts one stored
 *                                  log entry (simulating an attacker with DB
 *                                  access), then re-runs the chain check to
 *                                  show it gets caught.
 */

const { sha256 } = require('./hash');
const { buildMerkleRoot } = require('./merkle');
const softhsm = require('./softhsm');
const db = require('./db');

// fabric-network is only required for the 'onchain' command. Loaded lazily so
// 'chain' and 'tamper-demo' still work even before Hyperledger Fabric / the
// fabric-network npm package are set up.
function loadFabric() {
    return require('./fabric');
}

async function verifyChain({ quiet = false } = {}) {
    const rows = await db.getAllLogsDecrypted();
    let prevHash = 'GENESIS';
    let ok = true;
    const problems = [];

    for (const row of rows) {
        if (row.decryptFailed) {
            // The stored ciphertext/auth-tag itself was modified — AES-GCM
            // caught it before we could even recompute the hash chain. This
            // is the strongest possible signal: someone edited the database
            // directly rather than going through the signing pipeline.
            ok = false;
            problems.push({ id: row.id, reason: 'CIPHERTEXT_TAMPERED' });
            prevHash = row.hash; // still stored in plaintext; continue the chain from it
            continue;
        }

        const expectedHash = sha256(prevHash + row.log);

        if (expectedHash !== row.hash) {
            ok = false;
            problems.push({ id: row.id, reason: 'HASH_MISMATCH', expectedHash, storedHash: row.hash });
        } else {
            const sigValid = softhsm.verify(row.hash, row.signature);
            if (!sigValid) {
                ok = false;
                problems.push({ id: row.id, reason: 'BAD_SIGNATURE' });
            }
        }

        prevHash = row.hash; // continue the chain using the STORED hash so we
        // report exactly which single entry broke, rather than cascading
        // every subsequent entry into a false positive.
    }

    if (!quiet) {
        console.log(`Checked ${rows.length} log entries.`);
        if (ok) {
            console.log('✅ Hash chain and signatures are all valid. No tampering detected.');
        } else {
            console.log(`❌ TAMPERING DETECTED in ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'}:`);
            for (const p of problems) {
                console.log(`   - log id ${p.id}: ${p.reason}`);
            }
        }
    }
    return { ok, problems, count: rows.length };
}

/**
 * For every batch: recompute its merkle root from the stored signatures,
 * compare it with the locally recorded root, then with the root actually
 * anchored on Fabric. This is what catches whole rows being deleted or
 * swapped out (including the tail of the log, which the hash chain alone
 * cannot detect), and a local root being rewritten to cover that up.
 */
async function verifyOnChain({ quiet = false } = {}) {
    const chainResult = await verifyChain({ quiet });
    const log = quiet ? () => {} : console.log;
    const fabric = loadFabric();

    log('\nCross-checking merkle roots against Hyperledger Fabric...');
    const [rows, roots] = await Promise.all([db.getAllLogsDecrypted(), db.getAllRoots()]);

    const byRoot = new Map();
    let unbatched = 0;
    for (const row of rows) {
        if (row.rootId == null) { unbatched++; continue; }
        if (!byRoot.has(row.rootId)) byRoot.set(row.rootId, []);
        byRoot.get(row.rootId).push(row.signature);
    }

    const problems = [];
    let verified = 0;
    let pending = 0;
    let fabricReachable = true;

    for (const r of roots) {
        const sigs = byRoot.get(r.id) || [];
        const recomputed = buildMerkleRoot(sigs);
        if (recomputed !== r.root) {
            problems.push(`root #${r.id}: LOCAL_ROOT_MISMATCH (log rows in this batch were deleted, added or altered)`);
            continue;
        }
        if (r.status !== 'confirmed') { pending++; continue; }
        if (!r.asset_id) {
            // anchored by an older agent version that didn't record the asset id
            pending++;
            continue;
        }
        if (!fabricReachable) continue;
        try {
            const asset = await fabric.readFromBlockchain(r.asset_id);
            if (asset.rootHash !== r.root) {
                problems.push(`root #${r.id}: ONCHAIN_MISMATCH (local root differs from ledger asset ${r.asset_id})`);
            } else {
                verified++;
            }
        } catch (err) {
            if (/does not exist/.test(err.message)) {
                problems.push(`root #${r.id}: MISSING_ON_CHAIN (asset ${r.asset_id} not found)`);
            } else {
                fabricReachable = false;
                log('❌ Could not reach Hyperledger Fabric:', err.message);
                log('   (Local hash-chain verification above is still valid — this only affects');
                log('    the on-chain cross-check.)');
            }
        }
    }

    if (fabricReachable) {
        log(`✅ ${verified} batch root(s) match what is anchored on Fabric.`);
    }
    if (pending > 0) {
        log(`⚠️  ${pending} batch root(s) not (yet) anchored / no asset id — cannot cross-check.`);
    }
    if (unbatched > 0) {
        log(`⚠️  ${unbatched} log entr${unbatched === 1 ? 'y has' : 'ies have'} no batch root (agent stopped before flushing).`);
    }
    if (problems.length > 0) {
        log(`❌ ON-CHAIN TAMPERING DETECTED in ${problems.length} batch(es):`);
        problems.forEach((p) => log('   - ' + p));
    }

    return {
        ...chainResult,
        ok: chainResult.ok && problems.length === 0,
        onchainProblems: problems,
        rootsVerified: verified,
        rootsPending: pending,
        unbatched,
        fabricReachable,
    };
}

/**
 * Demonstration only. Simulates an attacker who has direct database access
 * tampering with a stored log line after the fact — WITHOUT going through
 * agent.js (so it can't re-sign anything). Then re-runs verification to show
 * the tamper is caught. Safe to run repeatedly; picks the most recent row.
 */
async function tamperDemo() {
    const rows = await db.getAllLogsDecrypted();
    if (rows.length === 0) {
        console.log('No log entries yet — start agent.js first and let it capture a few logs.');
        return;
    }

    const target = rows[rows.length - 1];
    console.log(`Before tampering — verifying ${rows.length} entries:`);
    await verifyChain();

    console.log(`\n🕵️  Simulating an attacker directly editing log id ${target.id} in the database...`);
    await new Promise((resolve, reject) => {
        db.db.run(
            `UPDATE logs SET log_ciphertext = ? WHERE id = ?`,
            [Buffer.from('this row was tampered with').toString('base64'), target.id],
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log('\nAfter tampering — verifying again:');
    await verifyChain();
}

async function main() {
    const cmd = process.argv[2] || 'chain';
    try {
        softhsm.getDataEncryptionKey(); // fail fast on a missing keystore / wrong passphrase
        if (cmd === 'chain') {
            await verifyChain();
        } else if (cmd === 'onchain') {
            await verifyOnChain();
        } else if (cmd === 'tamper-demo') {
            await tamperDemo();
        } else {
            console.log('Usage: node verify.js [chain|onchain|tamper-demo]');
        }
    } catch (err) {
        console.error('Error:', err.message);
        process.exitCode = 1;
    } finally {
        try {
            await loadFabric().disconnect();
        } catch (e) {
            // fabric-network not installed / never connected — nothing to do
        }
        process.exit(process.exitCode || 0);
    }
}

if (require.main === module) {
    main();
}

module.exports = { verifyChain, verifyOnChain, tamperDemo };
