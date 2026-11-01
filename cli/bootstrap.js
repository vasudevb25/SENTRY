/**
 * bootstrap.js — brings every dependency of the agent up automatically:
 * prerequisites, npm deps, fabric-samples, the Fabric network, the logstore
 * chaincode, the wallet identity and the HSM keystore. Each step is
 * idempotent: anything already in place is detected and left alone.
 *
 * It drives the existing scripts (scripts/*.sh, core/createWallet.js,
 * core/keygen.js) rather than re-implementing them.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ui = require('./ui');
const { ROOT } = require('./env');

const CORE = path.join(ROOT, 'core');
const STATE_DIR = path.join(ROOT, '.sentry');
const BOOT_LOG = path.join(STATE_DIR, 'bootstrap.log');

const FABRIC_CORE_CONTAINERS = ['orderer.example.com', 'peer0.org1.example.com', 'peer0.org2.example.com'];
const FABRIC_ALL_CONTAINERS = [...FABRIC_CORE_CONTAINERS, 'ca_org1', 'ca_org2', 'ca_orderer'];

function fabricSamplesPath() {
    return process.env.FABRIC_NETWORK_PATH || path.join(ROOT, 'fabric-samples');
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Runs a command, appending all output to .sentry/bootstrap.log. With a
 * label, shows a spinner + elapsed time; on failure, prints the log tail.
 */
function run(cmd, args, { cwd = ROOT, env = process.env, label = null, quiet = false } = {}) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const log = fs.openSync(BOOT_LOG, 'a');
    fs.writeSync(log, `\n===== ${new Date().toISOString()} $ ${cmd} ${args.join(' ')}\n`);

    return new Promise((resolve) => {
        const started = Date.now();
        let tail = '';
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let f = 0;
        const spin = label && process.stdout.isTTY
            ? setInterval(() => {
                const secs = Math.round((Date.now() - started) / 1000);
                process.stdout.write(`\r  ${ui.c.cyan(frames[f++ % frames.length])} ${label} ${ui.c.gray(secs + 's')}   `);
            }, 100)
            : null;

        const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const onData = (d) => {
            fs.writeSync(log, d);
            tail = (tail + d.toString()).slice(-6000);
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', (err) => onData(Buffer.from(String(err) + '\n')));
        child.on('close', (code) => {
            if (spin) {
                clearInterval(spin);
                process.stdout.write('\r\x1b[2K');
            }
            fs.closeSync(log);
            if (code !== 0 && !quiet) {
                ui.fail(`${label || cmd} failed (exit ${code}). Last output:`);
                const lines = tail.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-20);
                lines.forEach((l) => ui.info(l));
                ui.info(`full log: ${BOOT_LOG}`);
            }
            resolve({ code, out: tail });
        });
    });
}

function has(cmd) {
    return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

// ---------------------------------------------------------------- prereqs

function checkPrereqs() {
    const problems = [];
    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major < 16) problems.push(`Node.js ${process.versions.node} is too old — install Node 18+.`);
    for (const bin of ['docker', 'jq', 'curl']) {
        if (!has(bin)) problems.push(`"${bin}" is not installed (sudo apt install -y ${bin === 'docker' ? 'docker.io' : bin}).`);
    }
    if (has('docker')) {
        const r = spawnSync('docker', ['info'], { encoding: 'utf8' });
        if (r.status !== 0) {
            problems.push(
                /permission denied/i.test(r.stderr)
                    ? 'Docker permission denied — run: sudo usermod -aG docker $USER  (then log out/in).'
                    : 'Docker daemon is not running — run: sudo systemctl start docker'
            );
        }
    }
    return problems;
}

async function ensureCoreDeps() {
    if (fs.existsSync(path.join(CORE, 'node_modules', 'fabric-network'))
        && fs.existsSync(path.join(CORE, 'node_modules', 'sqlite3'))) {
        ui.ok('Node dependencies installed');
        return true;
    }
    const r = await run('npm', ['install'], { cwd: CORE, label: 'Installing Node dependencies (core)' });
    if (r.code !== 0) return false;
    ui.ok('Node dependencies installed');
    return true;
}

async function ensureFabricSamples() {
    const fsPath = fabricSamplesPath();
    if (fs.existsSync(path.join(fsPath, 'test-network', 'network.sh')) && fs.existsSync(path.join(fsPath, 'bin', 'peer'))) {
        ui.ok(`Hyperledger Fabric found ${ui.c.gray(fsPath)}`);
        return true;
    }
    ui.step('Hyperledger Fabric not found — downloading (one-time, a few minutes)...');
    const script = path.join(STATE_DIR, 'install-fabric.sh');
    fs.mkdirSync(STATE_DIR, { recursive: true });
    let r = await run('curl', ['-sSL', '-o', script,
        'https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh'],
        { label: 'Fetching install-fabric.sh' });
    if (r.code !== 0) return false;
    r = await run('bash', [script, 'docker', 'samples', 'binary'], { cwd: path.dirname(fsPath), label: 'Downloading Fabric samples, binaries and images' });
    if (r.code !== 0) return false;
    ui.ok('Hyperledger Fabric installed');
    return true;
}

// ---------------------------------------------------------------- fabric

/** name -> 'running' | 'stopped' | 'missing' for each Fabric container. */
function containerStates() {
    const r = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}|{{.State}}'], { encoding: 'utf8' });
    const states = {};
    for (const line of (r.stdout || '').split('\n')) {
        const [name, state] = line.split('|');
        if (name) states[name] = state === 'running' ? 'running' : 'stopped';
    }
    const out = {};
    for (const n of FABRIC_ALL_CONTAINERS) out[n] = states[n] || 'missing';
    return out;
}

/** Environment for the `peer` CLI acting as Org1's admin against peer0.org1. */
function peerEnv() {
    const fsPath = fabricSamplesPath();
    const org = path.join(fsPath, 'test-network/organizations/peerOrganizations/org1.example.com');
    return {
        ...process.env,
        PATH: path.join(fsPath, 'bin') + ':' + process.env.PATH,
        FABRIC_CFG_PATH: path.join(fsPath, 'config'),
        CORE_PEER_TLS_ENABLED: 'true',
        CORE_PEER_LOCALMSPID: 'Org1MSP',
        CORE_PEER_TLS_ROOTCERT_FILE: path.join(org, 'tlsca/tlsca.org1.example.com-cert.pem'),
        CORE_PEER_MSPCONFIGPATH: path.join(org, 'users/Admin@org1.example.com/msp'),
        CORE_PEER_ADDRESS: 'localhost:7051',
    };
}

function chaincodeCommitted() {
    const channel = process.env.FABRIC_CHANNEL || 'mychannel';
    const cc = process.env.FABRIC_CHAINCODE || 'logstore';
    const r = spawnSync('peer', ['lifecycle', 'chaincode', 'querycommitted', '-C', channel, '-n', cc],
        { env: peerEnv(), encoding: 'utf8', timeout: 20000 });
    return r.status === 0;
}

/** Ledger height + current block hash, or null if the peer is unreachable. */
function blockInfo() {
    return new Promise((resolve) => {
        const channel = process.env.FABRIC_CHANNEL || 'mychannel';
        const child = spawn('peer', ['channel', 'getinfo', '-c', channel], { env: peerEnv() });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        const t = setTimeout(() => child.kill(), 10000);
        child.on('error', () => resolve(null));
        child.on('close', () => {
            clearTimeout(t);
            const m = out.match(/Blockchain info:\s*(\{.*\})/);
            if (!m) return resolve(null);
            try {
                const j = JSON.parse(m[1]);
                resolve({
                    height: j.height,
                    currentBlockHash: Buffer.from(j.currentBlockHash || '', 'base64').toString('hex'),
                    previousBlockHash: Buffer.from(j.previousBlockHash || '', 'base64').toString('hex'),
                });
            } catch (e) {
                resolve(null);
            }
        });
    });
}

async function waitForChaincode(tries, delayMs) {
    for (let i = 0; i < tries; i++) {
        if (chaincodeCommitted()) return true;
        await sleep(delayMs);
    }
    return false;
}

async function networkUp() {
    const r = await run('bash', [path.join(ROOT, 'scripts/network-up.sh'), fabricSamplesPath()],
        { label: 'Starting Hyperledger Fabric network (orderer, 2 peers, 3 CAs)' });
    return r.code === 0;
}

async function deployChaincode() {
    const r = await run('bash', [path.join(ROOT, 'scripts/deploy-chaincode.sh'), fabricSamplesPath(), path.join(ROOT, 'chaincode/logstore')],
        { label: 'Deploying logstore chaincode (first time takes ~1-2 min)' });
    return r.code === 0;
}

/**
 * Makes sure the network is running and the chaincode is committed.
 * Prefers restarting stopped containers (keeps the existing ledger, so
 * previously anchored roots stay verifiable) over recreating from scratch.
 * Returns { ok, recreated }.
 */
async function ensureFabric({ fresh = false } = {}) {
    let recreated = false;
    let restarted = false;
    const states = containerStates();
    const coreStates = FABRIC_CORE_CONTAINERS.map((n) => states[n]);

    if (fresh) {
        ui.step('Fresh network requested');
    } else if (coreStates.every((s) => s === 'running')) {
        ui.ok('Fabric network running');
    } else if (coreStates.every((s) => s !== 'missing')) {
        restarted = true;
        ui.step('Fabric containers are stopped — restarting them (ledger preserved)...');
        const stopped = FABRIC_ALL_CONTAINERS.filter((n) => states[n] === 'stopped');
        await run('docker', ['start', ...stopped], { label: 'Restarting Fabric containers', quiet: true });
    }

    if (!fresh && containerStates()[FABRIC_CORE_CONTAINERS[1]] === 'running') {
        if (await waitForChaincode(restarted ? 8 : 1, 2500)) {
            ui.ok('logstore chaincode committed on channel');
            return { ok: true, recreated };
        }
        // network is up but the chaincode isn't there yet: try deploying onto it
        if (await deployChaincode()) {
            ui.ok('logstore chaincode deployed');
            return { ok: true, recreated };
        }
        ui.warn('Deploy onto the existing network failed — rebuilding the network from scratch');
    }

    if (!(await networkUp())) return { ok: false, recreated };
    recreated = true;
    ui.ok('Fabric network created (channel: mychannel)');
    if (!(await deployChaincode())) return { ok: false, recreated };
    ui.ok('logstore chaincode deployed');
    return { ok: true, recreated };
}

// ---------------------------------------------------------------- identity / keys / db

async function ensureWallet() {
    // always re-import: cheap, and it can never be stale against the current network
    const r = await run(process.execPath, ['createWallet.js'], { cwd: CORE, label: 'Enrolling Fabric identity' });
    if (r.code !== 0) return false;
    ui.ok('Fabric identity enrolled (appUser)');
    return true;
}

function keystoreExists() {
    return fs.existsSync(path.join(CORE, 'keystore', 'hsm-keystore.json'));
}

async function ensureKeys() {
    if (keystoreExists()) {
        ui.ok('HSM keystore present');
        return true;
    }
    const r = await run(process.execPath, ['keygen.js'], { cwd: CORE, label: 'Generating Ed25519 signing key (software HSM)' });
    if (r.code !== 0) return false;
    ui.ok('HSM keystore created — Ed25519 key wrapped with your passphrase');
    return true;
}

function dbPath() {
    return process.env.DB_PATH || path.join(CORE, 'logs.db');
}

/**
 * A freshly created network has an empty ledger, so roots recorded in an
 * existing logs.db could never be cross-checked again. Archive it instead
 * of letting every old batch show up as MISSING_ON_CHAIN.
 */
function archiveDbForNewLedger() {
    const db = dbPath();
    if (!fs.existsSync(db)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = db.replace(/\.db$/, '') + `_archive_${stamp}.db`;
    fs.renameSync(db, dest);
    return dest;
}

/** A logs.db left root-owned by an earlier `sudo node agent.js` run. */
function ensureDbWritable() {
    const db = dbPath();
    if (!fs.existsSync(db)) return true;
    try {
        fs.accessSync(db, fs.constants.R_OK | fs.constants.W_OK);
        return true;
    } catch (e) {
        const user = require('os').userInfo().username;
        ui.step(`logs.db is not writable by ${user} — fixing ownership (sudo)...`);
        const r = spawnSync('sudo', ['chown', `${user}:`, db], { stdio: 'inherit' });
        return r.status === 0;
    }
}

module.exports = {
    CORE,
    STATE_DIR,
    BOOT_LOG,
    FABRIC_ALL_CONTAINERS,
    fabricSamplesPath,
    run,
    has,
    checkPrereqs,
    ensureCoreDeps,
    ensureFabricSamples,
    containerStates,
    chaincodeCommitted,
    blockInfo,
    ensureFabric,
    ensureWallet,
    keystoreExists,
    ensureKeys,
    dbPath,
    archiveDbForNewLedger,
    ensureDbWritable,
};
