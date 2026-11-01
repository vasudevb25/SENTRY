#!/usr/bin/env node
/**
 * sentry — single entry point for the tamper-evident logging system.
 *
 *   ./sentry                start everything (Fabric, chaincode, keys, agent, dashboard)
 *   ./sentry verify         full verification (hash chain + signatures + on-chain roots)
 *   ./sentry tamper-demo    the original CLI tamper demonstration
 *   ./sentry status         health of every component
 *   ./sentry reset          archive logs.db and start the next run with a clean chain
 *   ./sentry stop           tear down the Fabric network (wipes the ledger)
 *
 * The underlying pieces (core/agent.js, core/verify.js, scripts/*.sh, ...)
 * are unchanged and can still be run by hand exactly as in the README.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ui = require('./ui');
const env = require('./env');

const VERSION = require('../package.json').version;
const { c } = ui;

// ------------------------------------------------------------------ args

function parseArgs(argv) {
    const opts = { cmd: 'start', port: 8787, host: '127.0.0.1', open: true, sudo: true, fresh: false, collector: false, yes: false };
    const rest = [...argv];
    if (rest[0] && !rest[0].startsWith('-')) opts.cmd = rest.shift();
    while (rest.length) {
        const a = rest.shift();
        if (a === '--port' || a === '-p') opts.port = parseInt(rest.shift(), 10);
        else if (a === '--host') opts.host = rest.shift();
        else if (a === '--no-open') opts.open = false;
        else if (a === '--no-sudo') opts.sudo = false;
        else if (a === '--fresh') opts.fresh = true;
        else if (a === '--collector') opts.collector = true;
        else if (a === '--yes' || a === '-y') opts.yes = true;
        else if (a === '--help' || a === '-h') opts.cmd = 'help';
        else if (a === '--version' || a === '-v') opts.cmd = 'version';
        else {
            ui.fail(`Unknown option: ${a}`);
            opts.cmd = 'help';
        }
    }
    return opts;
}

function help() {
    console.log(`
  ${c.bold('USAGE')}   ./sentry ${c.gray('[command] [options]')}

  ${c.bold('COMMANDS')}
    ${c.cyan('start')}          ${c.gray('(default)')} bring everything up and open the live dashboard
    ${c.cyan('verify')}         verify hash chain, signatures, encryption and on-chain roots
    ${c.cyan('tamper-demo')}    corrupt the newest entry and show it being detected (CLI)
    ${c.cyan('status')}         show the state of every component
    ${c.cyan('reset')}          archive logs.db so the next run starts a clean chain
    ${c.cyan('stop')}           tear down the Hyperledger Fabric network (wipes the ledger)

  ${c.bold('OPTIONS')} ${c.gray('(start)')}
    --port, -p <n>   dashboard port              ${c.gray('default 8787')}
    --host <addr>    dashboard bind address      ${c.gray('default 127.0.0.1 (local only)')}
    --no-open        don't open the browser
    --no-sudo        run the agent as your user  ${c.gray('(only your own journal, no audit.log)')}
    --fresh          rebuild the Fabric network from scratch
    --collector      also start the Python UDP syslog collector on :5514
    -y, --yes        don't ask for confirmation  ${c.gray('(stop / reset)')}
`);
}

function confirm(question) {
    if (!process.stdin.isTTY) return Promise.resolve(false);
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(`  ${c.yellow('?')} ${question} ${c.gray('[y/N]')} `, (a) => {
        rl.close();
        resolve(/^y(es)?$/i.test(a.trim()));
    }));
}

// ------------------------------------------------------------------ passphrase

/** Ensures HSM_PASSPHRASE is set and (if a keystore exists) correct. */
async function ensurePassphrase(bootstrap) {
    const hasKeystore = bootstrap.keystoreExists();
    if (!process.env.HSM_PASSPHRASE) {
        if (hasKeystore) {
            process.env.HSM_PASSPHRASE = await env.promptHidden(`  ${c.cyan('🔑')} HSM passphrase: `);
        } else {
            ui.step('No signing key yet — choose a passphrase to protect it (there is no recovery if lost).');
            const a = await env.promptHidden(`  ${c.cyan('🔑')} New HSM passphrase: `);
            const b = await env.promptHidden(`  ${c.cyan('🔑')} Confirm passphrase: `);
            if (!a || a !== b) throw new Error(a ? 'Passphrases do not match.' : 'Passphrase cannot be empty.');
            process.env.HSM_PASSPHRASE = a;
        }
        if (!fs.existsSync(env.SET_ENV)) {
            env.saveSetEnv(process.env.HSM_PASSPHRASE);
            ui.info(`saved to scripts/set-env.sh (owner-only) — loaded automatically next time`);
        }
    }
    if (hasKeystore) {
        try {
            require(path.join(bootstrap.CORE, 'softhsm')).getDataEncryptionKey();
        } catch (e) {
            throw new Error('Wrong HSM passphrase for the existing keystore (core/keystore/hsm-keystore.json).');
        }
    }
    ui.ok('HSM passphrase loaded');
}

// ------------------------------------------------------------------ agent

/** Env var names the agent cares about, forwarded through sudo. */
const AGENT_ENV = [
    'HSM_PASSPHRASE', 'FABRIC_NETWORK_PATH', 'FABRIC_CCP_PATH', 'FABRIC_WALLET_PATH', 'FABRIC_IDENTITY',
    'FABRIC_CHANNEL', 'FABRIC_CHAINCODE', 'FABRIC_CONNECT_TIMEOUT_MS', 'FABRIC_DISCOVERY_AS_LOCALHOST',
    'DB_PATH', 'WATCH_FILES', 'ENABLE_JOURNALD', 'FILE_POLL_INTERVAL_MS', 'BATCH_SIZE', 'BATCH_TIME_MS',
    'FLUSH_CHECK_INTERVAL_MS', 'RETRY_INTERVAL_MS',
];

function colorAgentLine(line) {
    if (/❌|🚨|error/i.test(line)) return c.red(line);
    if (/⚠️|warn/i.test(line)) return c.yellow(line);
    if (/🔗|Anchored/.test(line)) return c.cyan(line);
    if (/🌳/.test(line)) return c.green(line);
    return line;
}

function pipeLines(stream, onLine) {
    let partial = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
        const lines = (partial + chunk).split(/\r?\n/);
        partial = lines.pop();
        lines.forEach(onLine);
    });
    stream.on('end', () => partial && onLine(partial));
}

function openBrowser(url) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
        spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    } catch (e) { /* no browser available — the URL is printed anyway */ }
}

// ------------------------------------------------------------------ commands

async function cmdStart(opts) {
    ui.banner(VERSION);
    const bootstrap = require('./bootstrap');
    process.env.FABRIC_NETWORK_PATH = bootstrap.fabricSamplesPath();
    process.env.FABRIC_WALLET_PATH = process.env.FABRIC_WALLET_PATH || path.join(bootstrap.CORE, 'wallet');

    ui.section('PREFLIGHT');
    const problems = bootstrap.checkPrereqs();
    if (problems.length) {
        problems.forEach((p) => ui.fail(p));
        process.exit(1);
    }
    ui.ok(`Node ${process.versions.node} · Docker · jq · curl`);
    if (!(await bootstrap.ensureCoreDeps())) process.exit(1);
    if (!(await bootstrap.ensureFabricSamples())) process.exit(1);
    await ensurePassphrase(bootstrap);

    ui.section('BLOCKCHAIN  ' + c.gray('Hyperledger Fabric'));
    const fab = await bootstrap.ensureFabric({ fresh: opts.fresh });
    if (!fab.ok) {
        ui.fail('Could not bring up Hyperledger Fabric.');
        process.exit(1);
    }
    if (fab.recreated) {
        const archived = bootstrap.archiveDbForNewLedger();
        if (archived) ui.warn(`New ledger → previous logs.db archived as ${path.basename(archived)}`);
    }
    if (!(await bootstrap.ensureWallet())) process.exit(1);

    ui.section('CRYPTO  ' + c.gray('software HSM'));
    if (!(await bootstrap.ensureKeys())) process.exit(1);
    if (!bootstrap.ensureDbWritable()) {
        ui.fail('logs.db is not writable — fix with: sudo chown $USER core/logs.db');
        process.exit(1);
    }
    ui.ok('Encrypted evidence store ready ' + c.gray(path.relative(env.ROOT, bootstrap.dbPath())));

    ui.section('LAUNCH');
    // root lets the agent read the whole system journal and /var/log/audit
    let useSudo = opts.sudo && process.getuid && process.getuid() !== 0;
    if (useSudo) {
        ui.step('Root access lets the agent read the full system journal and audit.log');
        const r = spawnSync('sudo', ['-v', '-p', `  ${c.cyan('🔐')} sudo password for %u: `], { stdio: 'inherit' });
        if (r.status !== 0) {
            ui.warn('No sudo — continuing as your user (your own journal only).');
            useSudo = false;
        }
    }

    // the dashboard opens logs.db (creating it as the current user) BEFORE a
    // root agent touches it, so the file never ends up root-owned
    const { createDashboard } = require('../dashboard/server');
    const dash = createDashboard({ port: opts.port, host: opts.host, version: VERSION });
    let url;
    try {
        url = await dash.start();
    } catch (e) {
        ui.fail(e.code === 'EADDRINUSE' ? `Port ${opts.port} is busy — try: ./sentry --port ${opts.port + 1}` : e.message);
        process.exit(1);
    }
    ui.ok(`Dashboard online ${c.bold(c.neon(url))}`);

    let agent = null;
    let collector = null;
    let stopping = false;
    let restarts = 0;
    let onAgentReady = null;

    function startAgent() {
        const coreDir = bootstrap.CORE;
        const args = useSudo
            ? ['-n', `--preserve-env=${AGENT_ENV.filter((k) => process.env[k] !== undefined).join(',')}`, process.execPath, 'agent.js']
            : ['agent.js'];
        const bin = useSudo ? 'sudo' : process.execPath;
        agent = spawn(bin, args, { cwd: coreDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        dash.setAgent({ state: 'running', sudo: useSudo, pid: agent.pid });
        const onLine = (line) => {
            if (!line.trim()) return;
            console.log(c.gray('  [agent] ') + colorAgentLine(line));
            dash.pushConsole(line, 'agent');
            if (onAgentReady && /Agent running/.test(line)) onAgentReady();
        };
        pipeLines(agent.stdout, onLine);
        pipeLines(agent.stderr, onLine);
        agent.on('exit', (code, signal) => {
            dash.setAgent({ state: 'stopped', pid: null });
            if (stopping) return;
            const why = `agent exited (${signal || 'code ' + code})`;
            dash.pushConsole('❌ ' + why, 'sentry');
            if (restarts++ < 5) {
                ui.warn(`${why} — restarting in 3s (${restarts}/5)`);
                setTimeout(startAgent, 3000);
            } else {
                ui.fail(`${why} — giving up after 5 restarts. Dashboard stays up; Ctrl+C to quit.`);
            }
        });
    }

    // announce "live" only once the agent is actually following its sources;
    // events logged before journalctl attaches would otherwise be missed
    await new Promise((resolve) => {
        const t = setTimeout(resolve, 8000);
        onAgentReady = () => { clearTimeout(t); setTimeout(resolve, 500); };
        startAgent();
    });
    onAgentReady = null;
    ui.ok(`Agent running ${c.gray(useSudo ? '(root: full system journal + audit.log)' : '(user mode)')}`);

    if (opts.collector) {
        const py = path.join(env.ROOT, 'collector', '.venv', 'bin', 'python');
        if (fs.existsSync(py)) {
            collector = spawn(py, ['-u', 'collector.py'], { cwd: path.join(env.ROOT, 'collector'), stdio: ['ignore', 'pipe', 'pipe'] });
            const onLine = (l) => { if (l.trim()) { console.log(c.gray('  [collector] ') + l); dash.pushConsole(l, 'collector'); } };
            pipeLines(collector.stdout, onLine);
            pipeLines(collector.stderr, onLine);
            ui.ok('UDP syslog collector listening on 127.0.0.1:5514');
        } else {
            ui.warn('collector/.venv not found — skipping collector (see README section 9)');
        }
    }

    const bar = c.gray('  ' + '━'.repeat(60));
    console.log('\n' + bar);
    console.log(`   ${c.green('●')} ${c.bold('SENTRY IS LIVE')}`);
    console.log(`   Dashboard   ${c.bold(c.neon(url))}`);
    console.log(`   Stop        ${c.bold('Ctrl+C')} ${c.gray('(Fabric keeps running for a fast restart)')}`);
    console.log(bar + '\n');

    if (opts.open) openBrowser(url);

    async function shutdown() {
        if (stopping) return;
        stopping = true;
        console.log('\n' + c.yellow('  🛑 Stopping Sentry — sealing the final batch...'));
        if (collector) collector.kill('SIGINT');
        if (agent && agent.exitCode === null) {
            // with sudo, the terminal's Ctrl+C already reaches the agent via
            // sudo's signal relay; this covers SIGTERM / non-tty cases
            try { agent.kill('SIGINT'); } catch (e) { /* EPERM on a root child is fine */ }
            await new Promise((resolve) => {
                const t = setTimeout(resolve, 20000);
                agent.once('exit', () => { clearTimeout(t); resolve(); });
            });
        }
        await dash.stop();
        console.log(c.green('  ✔ Stopped.') + c.gray('  Tear down Fabric with: ./sentry stop'));
        process.exit(0);
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

async function runCore(script, args) {
    const bootstrap = require('./bootstrap');
    process.env.FABRIC_NETWORK_PATH = bootstrap.fabricSamplesPath();
    await ensurePassphrase(bootstrap);
    if (!bootstrap.ensureDbWritable()) process.exit(1);
    const r = spawnSync(process.execPath, [script, ...args], { cwd: bootstrap.CORE, stdio: 'inherit', env: process.env });
    process.exit(r.status || 0);
}

async function cmdStatus() {
    const bootstrap = require('./bootstrap');
    process.env.FABRIC_NETWORK_PATH = bootstrap.fabricSamplesPath();
    ui.section('SENTRY STATUS');
    const st = bootstrap.containerStates();
    for (const [name, s] of Object.entries(st)) {
        const mark = s === 'running' ? c.green('● running') : s === 'stopped' ? c.yellow('○ stopped') : c.red('✖ missing');
        console.log(`    ${name.padEnd(26)} ${mark}`);
    }
    const cc = st['peer0.org1.example.com'] === 'running' && bootstrap.chaincodeCommitted();
    console.log(`    ${'chaincode logstore'.padEnd(26)} ${cc ? c.green('● committed') : c.red('✖ not committed')}`);
    const info = await bootstrap.blockInfo();
    if (info) console.log(`    ${'ledger height'.padEnd(26)} ${c.cyan(info.height)}`);
    console.log(`    ${'HSM keystore'.padEnd(26)} ${bootstrap.keystoreExists() ? c.green('● present') : c.yellow('○ not created')}`);
    console.log(`    ${'wallet identity'.padEnd(26)} ${fs.existsSync(path.join(bootstrap.CORE, 'wallet', 'appUser.id')) ? c.green('● enrolled') : c.yellow('○ not enrolled')}`);
    const dbFile = bootstrap.dbPath();
    if (fs.existsSync(dbFile)) {
        const sqlite3 = require(path.join(bootstrap.CORE, 'node_modules', 'sqlite3'));
        const d = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY);
        await new Promise((res) => d.get(
            `SELECT (SELECT COUNT(*) FROM logs) n, (SELECT COUNT(*) FROM pending_roots WHERE status='confirmed') c, (SELECT COUNT(*) FROM pending_roots WHERE status='pending') p`,
            (e, r) => {
                if (r) console.log(`    ${'evidence store'.padEnd(26)} ${c.cyan(r.n)} logs · ${c.cyan(r.c)} batches anchored · ${r.p ? c.yellow(r.p + ' pending') : '0 pending'}`);
                d.close(); res();
            }));
    } else {
        console.log(`    ${'evidence store'.padEnd(26)} ${c.gray('empty (no logs.db yet)')}`);
    }
    console.log();
}

async function cmdReset(opts) {
    const bootstrap = require('./bootstrap');
    const dbFile = bootstrap.dbPath();
    if (!fs.existsSync(dbFile)) return ui.ok('Nothing to reset — no logs.db yet.');
    if (!opts.yes && !(await confirm('Archive logs.db and start a fresh hash chain? (stop Sentry first)'))) return;
    const dest = bootstrap.archiveDbForNewLedger();
    ui.ok(`Archived to ${path.relative(env.ROOT, dest)}`);
}

async function cmdStop(opts) {
    const bootstrap = require('./bootstrap');
    if (!opts.yes && !(await confirm('Tear down Fabric? The ledger is wiped; existing logs.db roots can no longer be cross-checked on-chain.'))) return;
    const r = await bootstrap.run('bash', [path.join(env.ROOT, 'scripts/network-down.sh'), bootstrap.fabricSamplesPath()], { label: 'Stopping Hyperledger Fabric' });
    if (r.code === 0) ui.ok('Fabric network down. Next ./sentry run creates a fresh ledger (logs.db will be archived).');
}

// ------------------------------------------------------------------ main

(async () => {
    const opts = parseArgs(process.argv.slice(2));
    env.loadSetEnv();
    try {
        switch (opts.cmd) {
            case 'start': return await cmdStart(opts);
            case 'verify': ui.banner(VERSION); return await runCore('verify.js', ['onchain']);
            case 'tamper-demo': ui.banner(VERSION); return await runCore('verify.js', ['tamper-demo']);
            case 'status': ui.banner(VERSION); return await cmdStatus();
            case 'reset': return await cmdReset(opts);
            case 'stop': return await cmdStop(opts);
            case 'version': return console.log(VERSION);
            case 'help': ui.banner(VERSION); return help();
            default:
                ui.fail(`Unknown command: ${opts.cmd}`);
                help();
                process.exit(1);
        }
    } catch (e) {
        ui.fail(e.message);
        process.exit(1);
    }
})();
