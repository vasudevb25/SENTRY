/**
 * server.js — real-time dashboard backend. Zero extra dependencies: plain
 * node:http + Server-Sent Events.
 *
 * It watches the same logs.db the agent writes to (read-mostly; only the
 * attack simulator writes), the Fabric containers, the ledger itself, and the
 * agent's console output, and streams all of it to the browser.
 *
 * Bound to 127.0.0.1 by default: the page shows decrypted logs and can run
 * attack simulations, so it must not be reachable from the network unless
 * the user explicitly asks for it (--host).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CORE = path.resolve(__dirname, '..', 'core');
const PUBLIC = path.join(__dirname, 'public');

const db = require(path.join(CORE, 'db'));
const verify = require(path.join(CORE, 'verify'));
const fabric = require(path.join(CORE, 'fabric'));
const config = require(path.join(CORE, 'config'));
const bootstrap = require('../cli/bootstrap');
const { runAttack } = require('./attacks');

const all = (sql, params = []) =>
    new Promise((res, rej) => db.db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** Splits a journald "short" / syslog / audit line into process + message. */
function parseLine(text) {
    if (text == null) return { proc: '?', msg: '' };
    let m = text.match(/^\w{3}\s+\d+\s+[\d:]+\s+\S+\s+([^:\[\s]+)(?:\[\d+\])?:\s?(.*)$/);
    if (m) return { proc: m[1], msg: m[2] };
    m = text.match(/^\d{4}-\d\d-\d\dT\S+\s+\S+\s+([^:\[\s]+)(?:\[\d+\])?:\s?(.*)$/);
    if (m) return { proc: m[1], msg: m[2] };
    m = text.match(/^type=(\S+)\s+(.*)$/);
    if (m) return { proc: 'audit:' + m[1].toLowerCase(), msg: m[2] };
    return { proc: 'log', msg: text };
}

function createDashboard({ port = 8787, host = '127.0.0.1', version = '1.0.0' } = {}) {
    const clients = new Set();
    const startedAt = Date.now();

    const state = {
        version,
        startedAt,
        agent: { state: 'starting', sudo: false, pid: null },
        stats: { totalLogs: 0, maxId: 0, confirmedRoots: 0, pendingRoots: 0, unbatched: 0, batchSize: config.BATCH_SIZE, batchTimeMs: config.BATCH_TIME_MS },
        throughput: new Array(120).fill(0),
        recentLogs: [],
        roots: [],
        fabric: { containers: {}, height: null, currentBlockHash: null, assets: null, ledger: [], reachable: null, channel: config.FABRIC_CHANNEL, chaincode: config.FABRIC_CHAINCODE },
        integrity: { status: 'unknown', checkedAt: null, count: 0, problems: [], onchain: null, onchainAt: null },
        console: [],
        attacks: [],
        sources: { journald: config.ENABLE_JOURNALD, files: config.WATCH_FILES.map((f) => ({ path: f, exists: fs.existsSync(f) })) },
    };

    let lastLogId = 0;
    let rootsSig = '';
    let knownRoots = new Map(); // id -> status
    let tickCount = 0;

    function send(event, data) {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of clients) res.write(msg);
    }

    // ------------------------------------------------------------ console feed
    function pushConsole(line, source = 'agent') {
        const clean = String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
        if (!clean.trim()) return;
        const entry = { t: Date.now(), source, line: clean };
        state.console.push(entry);
        if (state.console.length > 400) state.console.shift();
        send('console', entry);
    }

    function setAgent(info) {
        Object.assign(state.agent, info);
        send('agent', state.agent);
    }

    // ------------------------------------------------------------ DB polling
    function toEntry(row) {
        const { log, decryptFailed } = db.decryptLog(row);
        const { proc, msg } = parseLine(log);
        return {
            id: row.id,
            ts: row.ts,
            proc: decryptFailed ? '??' : proc,
            msg: decryptFailed ? '[undecryptable ciphertext]' : msg,
            decryptFailed,
            prevHash: row.prev_hash,
            hash: row.hash,
            signature: row.signature,
            rootId: row.root_id,
        };
    }

    async function pollDb() {
        const rows = await all(`SELECT * FROM logs WHERE id > ? ORDER BY id ASC LIMIT 500`, [lastLogId]);
        if (rows.length) {
            lastLogId = rows[rows.length - 1].id;
            const entries = rows.map(toEntry);
            state.recentLogs.push(...entries);
            if (state.recentLogs.length > 150) state.recentLogs.splice(0, state.recentLogs.length - 150);
            send('logs', entries);
        }
        state.throughput.push(rows.length);
        state.throughput.shift();

        const [[counts], rootCounts, [unb]] = await Promise.all([
            all(`SELECT COUNT(*) n, COALESCE(MAX(id),0) maxId FROM logs`),
            all(`SELECT status, COUNT(*) n FROM pending_roots GROUP BY status`),
            all(`SELECT COUNT(*) n FROM logs WHERE root_id IS NULL`),
        ]);
        state.stats.totalLogs = counts.n;
        state.stats.maxId = counts.maxId;
        state.stats.confirmedRoots = (rootCounts.find((r) => r.status === 'confirmed') || {}).n || 0;
        state.stats.pendingRoots = (rootCounts.find((r) => r.status === 'pending') || {}).n || 0;
        state.stats.unbatched = unb.n;

        // assignRoot() happens a moment after a log is stored; refresh rootIds
        // of recent entries so the chain view can show which batch sealed them
        const pendingIds = state.recentLogs.filter((e) => e.rootId == null).map((e) => e.id);
        if (pendingIds.length) {
            const linked = await all(
                `SELECT id, root_id FROM logs WHERE root_id IS NOT NULL AND id IN (${pendingIds.map(() => '?').join(',')})`,
                pendingIds
            );
            if (linked.length) {
                const map = new Map(linked.map((r) => [r.id, r.root_id]));
                state.recentLogs.forEach((e) => { if (map.has(e.id)) e.rootId = map.get(e.id); });
                send('sealed', linked.map((r) => ({ id: r.id, rootId: r.root_id })));
            }
        }

        const roots = await all(
            `SELECT p.*, (SELECT COUNT(*) FROM logs WHERE root_id = p.id) AS n
             FROM pending_roots p ORDER BY p.id DESC LIMIT 40`
        );
        const sig = JSON.stringify(roots.map((r) => [r.id, r.status, r.n]));
        if (sig !== rootsSig) {
            rootsSig = sig;
            for (const r of roots) {
                const prev = knownRoots.get(r.id);
                if (prev === undefined && tickCount > 0) send('pipeline', { stage: 'merkle', rootId: r.id, root: r.root, n: r.n });
                if (prev !== 'confirmed' && r.status === 'confirmed' && tickCount > 0) send('pipeline', { stage: 'anchor', rootId: r.id, txId: r.tx_id });
                knownRoots.set(r.id, r.status);
            }
            state.roots = roots;
            send('roots', roots);
        }
        send('stats', { stats: state.stats, throughputLast: rows.length, uptime: Date.now() - startedAt });
        tickCount++;
    }

    // ------------------------------------------------------------ integrity
    let verifyingLocal = false;
    let verifyingFull = false;

    function problemsFrom(result) {
        const list = result.problems.map((p) => ({ kind: 'entry', id: p.id, reason: p.reason }));
        for (const s of result.onchainProblems || []) {
            const m = s.match(/root #(\d+): (\w+)\s*(?:\((.*)\))?/);
            list.push({ kind: 'root', id: m ? +m[1] : null, reason: m ? m[2] : s, detail: m ? m[3] : '' });
        }
        return list;
    }

    function publishIntegrity(result, full) {
        state.integrity.checkedAt = Date.now();
        state.integrity.count = result.count;
        if (full) {
            state.integrity.onchainAt = Date.now();
            state.integrity.onchain = {
                rootsVerified: result.rootsVerified,
                rootsPending: result.rootsPending,
                unbatched: result.unbatched,
                fabricReachable: result.fabricReachable,
                problems: problemsFrom(result).filter((p) => p.kind === 'root'),
            };
        }
        const entryProblems = problemsFrom(result).filter((p) => p.kind === 'entry');
        const rootProblems = (state.integrity.onchain && state.integrity.onchain.problems) || [];
        state.integrity.problems = [...entryProblems, ...rootProblems];
        const prev = state.integrity.status;
        state.integrity.status = state.integrity.problems.length ? 'tampered' : 'verified';
        send('integrity', state.integrity);
        if (prev !== 'tampered' && state.integrity.status === 'tampered') {
            pushConsole(`🚨 INTEGRITY MONITOR: tampering detected in ${state.integrity.problems.length} place(s)`, 'sentry');
        } else if (prev === 'tampered' && state.integrity.status === 'verified') {
            pushConsole('✅ INTEGRITY MONITOR: all checks passing again', 'sentry');
        }
    }

    async function verifyLocal() {
        if (verifyingLocal || verifyingFull) return;
        verifyingLocal = true;
        try {
            const r = await verify.verifyChain({ quiet: true });
            // keep the last on-chain verdict; it is refreshed by verifyFull()
            publishIntegrity({ ...r, onchainProblems: [] }, false);
        } catch (e) {
            pushConsole('⚠️ integrity check failed: ' + e.message, 'sentry');
        } finally {
            verifyingLocal = false;
        }
    }

    async function verifyFull() {
        while (verifyingLocal) await new Promise((r) => setTimeout(r, 50));
        if (verifyingFull) return state.integrity;
        verifyingFull = true;
        send('verifying', { full: true });
        try {
            const r = await verify.verifyOnChain({ quiet: true });
            publishIntegrity(r, true);
        } catch (e) {
            pushConsole('⚠️ on-chain verification failed: ' + e.message, 'sentry');
        } finally {
            verifyingFull = false;
        }
        return state.integrity;
    }

    // ------------------------------------------------------------ fabric
    let fabricBusy = false;
    async function pollFabric(withLedger) {
        if (fabricBusy) return;
        fabricBusy = true;
        try {
            state.fabric.containers = bootstrap.containerStates();
            const info = await bootstrap.blockInfo();
            if (info) Object.assign(state.fabric, info);
            if (withLedger) {
                try {
                    const assets = await fabric.getAllAssets();
                    const byAsset = new Map(state.roots.filter((r) => r.asset_id).map((r) => [r.asset_id, r.id]));
                    state.fabric.assets = assets.length;
                    state.fabric.ledger = assets
                        .filter((a) => a && a.id)
                        .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
                        .slice(0, 12)
                        .map((a) => ({ id: a.id, rootHash: a.rootHash, timestamp: a.timestamp, localRootId: byAsset.get(a.id) || null }));
                    state.fabric.reachable = true;
                } catch (e) {
                    state.fabric.reachable = false;
                }
            }
            send('fabric', state.fabric);
        } finally {
            fabricBusy = false;
        }
    }

    // ------------------------------------------------------------ http
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `${host}:${port}`]);

    function json(res, code, body) {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
    }

    function readBody(req) {
        return new Promise((resolve) => {
            let b = '';
            req.on('data', (d) => { b += d; if (b.length > 1e4) req.destroy(); });
            req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
        });
    }

    function generateLogs(count) {
        const n = Math.max(1, Math.min(50, Number(count) || 5));
        const msgs = [
            'user login attempt from 192.168.1.%d',
            'sshd: session opened for user analyst',
            'config file /etc/app/settings.yml read',
            'firewall: blocked inbound TCP 10.0.0.%d:445',
            'sudo: analyst : COMMAND=/usr/bin/systemctl status',
            'backup job completed (%d files)',
        ];
        for (let i = 0; i < n; i++) {
            const m = msgs[i % msgs.length].replace('%d', String(Math.floor(Math.random() * 250) + 1));
            spawn('logger', ['-t', 'sentry-demo', m], { stdio: 'ignore' }).on('error', () => {});
        }
        return n;
    }

    async function handle(req, res) {
        // DNS-rebinding guard: only answer requests addressed to us by name
        if (!allowedHosts.has(req.headers.host) && host !== '0.0.0.0') {
            res.writeHead(403); res.end('forbidden'); return;
        }
        const url = new URL(req.url, 'http://x');

        if (req.method === 'POST') {
            // custom header forces a CORS preflight we never approve -> no CSRF
            if (req.headers['x-sentry'] !== '1') { res.writeHead(403); res.end('forbidden'); return; }
            const body = await readBody(req);
            try {
                if (url.pathname === '/api/verify') return json(res, 200, await verifyFull());
                if (url.pathname === '/api/generate') {
                    const n = generateLogs(body.count);
                    pushConsole(`🧪 Generated ${n} demo log event(s) via logger`, 'sentry');
                    return json(res, 200, { generated: n });
                }
                if (url.pathname === '/api/attack') {
                    const result = await runAttack(body.type);
                    result.t = Date.now();
                    state.attacks.unshift(result);
                    state.attacks = state.attacks.slice(0, 20);
                    pushConsole(`🕵️ ATTACK SIMULATION: ${result.title} — ${result.detail}`, 'attacker');
                    send('attack', result);
                    // drop the stale copy so the feed shows the tampered state
                    state.recentLogs = state.recentLogs.filter((e) => e.id !== result.id);
                    const fresh = await all(`SELECT * FROM logs WHERE id = ?`, [result.id]);
                    if (fresh.length) state.recentLogs.push(toEntry(fresh[0]));
                    state.recentLogs.sort((a, b) => a.id - b.id);
                    send('relog', state.recentLogs);
                    const integrity = await verifyFull();
                    return json(res, 200, { attack: result, integrity });
                }
            } catch (e) {
                return json(res, 400, { error: e.message });
            }
            return json(res, 404, { error: 'not found' });
        }

        if (url.pathname === '/api/stream') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
            res.write(`event: snapshot\ndata: ${JSON.stringify({ ...state, uptime: Date.now() - startedAt })}\n\n`);
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
        }
        if (url.pathname === '/api/state') return json(res, 200, state);

        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const full = path.join(PUBLIC, path.normalize(file));
        if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
            res.writeHead(404); res.end('not found'); return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(full).pipe(res);
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch((e) => { try { json(res, 500, { error: e.message }); } catch (_) {} });
    });

    const timers = [];

    async function start() {
        const [[{ m }]] = await Promise.all([all(`SELECT COALESCE(MAX(id),0) m FROM logs`)]);
        lastLogId = Math.max(0, m - 60); // seed the feed with the latest entries
        await pollDb().catch(() => {});
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, resolve);
        });
        const loop = (fn, ms) => timers.push(setInterval(() => fn().catch((e) => pushConsole('⚠️ dashboard: ' + e.message, 'sentry')), ms));
        loop(pollDb, 1000);
        loop(verifyLocal, 5000);
        loop(verifyFull, 45000);
        let fabricTick = 0;
        loop(() => pollFabric(fabricTick++ % 2 === 0), 5000);
        pollFabric(true).catch(() => {});
        setTimeout(() => verifyFull().catch(() => {}), 1500);
        // SSE keep-alive so proxies / browsers don't drop idle streams
        timers.push(setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000));
        return `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    }

    async function stop() {
        timers.forEach(clearInterval);
        for (const c of clients) c.end();
        server.close();
        try { await fabric.disconnect(); } catch (e) { /* not connected */ }
    }

    return { start, stop, pushConsole, setAgent };
}

module.exports = { createDashboard };
