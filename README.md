# SENTRY — Tamper-Evident Log Integrity

> a tool by **SedentryRisk**

Real-time OS log capture → SHA-256 hash chaining → Ed25519 signing (software
HSM) → AES-256-GCM encrypted storage → Merkle batching → Hyperledger Fabric
anchoring → continuous tamper detection, with a live command-center dashboard.

---

## ⚡ Quick start — one command

```bash
./sentry
```

That's it. On first run it asks for an HSM passphrase (saved to
`scripts/set-env.sh`, owner-only) and your sudo password (so the agent can read
the full system journal and `audit.log`). Then it automatically:

1. checks Node, Docker, jq and curl, and installs npm dependencies if missing
2. downloads Hyperledger Fabric into `./fabric-samples` if it isn't there
3. starts the Fabric network, or restarts stopped containers and keeps the ledger
4. deploys the `logstore` chaincode if it isn't committed
5. enrolls the Fabric identity and generates the Ed25519 signing key
6. starts the capture agent and the **dashboard at http://127.0.0.1:8787**
   (opened in your browser)

Press **Ctrl+C** to stop. The agent seals and anchors its final batch first.
Fabric keeps running so the next start takes seconds.

| Command | What it does |
|---|---|
| `./sentry` | start everything + dashboard (same as `./sentry start`) |
| `./sentry verify` | full verification: hash chain, signatures, AES-GCM, on-chain roots |
| `./sentry tamper-demo` | the CLI tamper demonstration |
| `./sentry status` | state of every container, the chaincode, keys and evidence store |
| `./sentry reset` | archive `logs.db` so the next run starts a clean chain |
| `./sentry stop` | tear down the Fabric network (wipes the ledger) |

Start options: `--port <n>`, `--host <addr>` (default `127.0.0.1`; the page shows
decrypted logs, so it is local-only unless you change this), `--no-open`,
`--no-sudo`, `--fresh` (rebuild Fabric from scratch), `--collector` (also run the
Python UDP collector). Run `./sentry --help` for all of them.

### The dashboard

| Panel | Shows |
|---|---|
| Evidence Pipeline | each log animating through capture → hash → sign → encrypt → Merkle → Fabric |
| Live Hash Chain | the latest blocks and their `prev → hash` links; a broken link turns red |
| Integrity Monitor | re-verifies everything every 5 s (on-chain every 45 s); goes red the moment anything is altered |
| Evidence Stream | decrypted log feed with sealed / queued / tampered state |
| Sealed Batches | Merkle roots and their Fabric transaction IDs |
| Attack Lab | one-click attacks (modify, insider forgery, delete evidence), each caught by a different defence layer; plus "generate log events" |
| Blockchain Network | live Fabric topology, ledger height, head block hash |
| Ingest Rate | logs per second over the last 2 minutes |
| Agent Console | the agent's live output |

**Demo script:** click *Generate 5 log events* → watch them flow and get anchored
→ click an attack in the Attack Lab → the dashboard flags the exact entry and the
defence layer that caught it, within milliseconds.

> Attacks really modify `logs.db`. Run `./sentry reset` (with Sentry stopped)
> for a clean chain before the next presentation.

### Project layout

```
sentry                   one-command launcher
cli/                     orchestrator: bootstrap, banner, commands
dashboard/               real-time dashboard (node:http + SSE, no extra deps)
  server.js  attacks.js  public/{index.html, style.css, app.js}
core/                    the engine (unchanged workflow; usable standalone)
  agent.js  verify.js  softhsm.js  db.js  fabric.js  merkle.js  hash.js ...
chaincode/logstore/      Fabric smart contract (create/read only, never update)
collector/               optional Python UDP syslog collector
scripts/                 network-up / deploy-chaincode / network-down
```

---

# Manual setup (advanced)

Everything below is what `./sentry` automates. It still works by hand
exactly as before.

This section takes a completely fresh Linux machine from nothing installed to
the full system running and verified.

---

## 1. Prerequisites (fresh machine — run once)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl jq build-essential python3 python3-pip python3-venv
```

`jq` is required — Hyperledger's own network scripts use it internally.

### Docker (Hyperledger Fabric runs as containers)

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**Log out and back in (or reboot) now** — group membership doesn't apply to
your current shell until you do. Then confirm:

```bash
docker run hello-world
docker compose version
```

If `docker compose version` fails: `sudo apt install -y docker-compose-plugin`

### Node.js 18 (via nvm — pinned, known-good version)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
node --version   # should print v18.x
```

Node 18 LTS is what `fabric-network` (the Fabric SDK this project uses) is
built and tested against — using a different version is where most
hard-to-diagnose connection errors come from.

---

## 2. Clone the repo and install dependencies

```bash
cd ~
git clone <YOUR_GITHUB_REPO_URL> tamper-evident-logging-prototype
cd tamper-evident-logging-prototype

cd core && npm install && cd ..
cd chaincode/logstore && npm install && cd ../..

cd collector
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..
```

---

## 3. Get Hyperledger Fabric

This project keeps `fabric-samples` **inside** the project folder (one
folder, nothing scattered across your filesystem). It's gitignored — you
still need to download it once per machine, it just lives right here:

```bash
cd ~/tamper-evident-logging-prototype
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary
rm install-fabric.sh
```

This creates `~/tamper-evident-logging-prototype/fabric-samples/`.

---

## 4. Configure your environment

```bash
cd ~/tamper-evident-logging-prototype
cp scripts/set-env.sh.example scripts/set-env.sh
nano scripts/set-env.sh
```

Set your own passphrase (keep it — there's no recovery if you lose it). The
Fabric paths are optional: they default to `./fabric-samples` inside this
project, so you only need them if `fabric-samples` lives elsewhere:

```bash
export HSM_PASSPHRASE="choose-a-strong-passphrase"
export FABRIC_NETWORK_PATH=/home/<you>/tamper-evident-logging-prototype/fabric-samples
export FABRIC_CCP_PATH=/home/<you>/tamper-evident-logging-prototype/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json
```

Replace `<you>` with your actual username (check with `whoami`). Save with
`Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

---

## 5. First-time setup: network, chaincode, wallet, keys

Every one of these steps only needs to be repeated if you tear the network
down and back up again (see the Troubleshooting section for why).

```bash
cd ~/tamper-evident-logging-prototype

# start Fabric and create the channel (also clears the now-stale wallet)
bash scripts/network-up.sh

# deploy the chaincode
bash scripts/deploy-chaincode.sh
```

Wait for `✅ Chaincode deployed. You can now run the agent.` before moving on.

```bash
# enroll Fabric identities into the wallet
cd core
source ../scripts/set-env.sh
node createWallet.js
```

Expect: `✅ appUser identity imported successfully`

```bash
# generate the software-HSM signing key (one-time only, skip if it already exists)
source ../scripts/set-env.sh
if [ ! -f keystore/hsm-keystore.json ]; then
    node keygen.js
fi
```

---

## 6. Run the full system (two terminals)

### Terminal 1 — start the agent

```bash
cd ~/tamper-evident-logging-prototype/core
source ../scripts/set-env.sh

sudo -E env \
  HSM_PASSPHRASE="$HSM_PASSPHRASE" \
  FABRIC_NETWORK_PATH="$FABRIC_NETWORK_PATH" \
  FABRIC_CCP_PATH="$FABRIC_CCP_PATH" \
  FABRIC_WALLET_PATH="$(pwd)/wallet" \
  FABRIC_IDENTITY=appUser \
  FABRIC_CHANNEL=mychannel \
  FABRIC_CHAINCODE=logstore \
  node agent.js
```

**Expected output:**
```
🔗 Hash chain initialized from: GENESIS
📡 journald connected
📡 watching: /var/log/syslog
📡 watching: /var/log/auth.log
📡 watching: /var/log/audit/audit.log
🚀 Agent running (FULL LOG MODE)...
🌳 Merkle Root: 5dd2b93564c3ef36d896d29c8a54d80efab2adc892f192b41eaa002828cf9529 (batch of 10)
🔗 Connected to Hyperledger Fabric channel: mychannel
🔗 Anchored on Fabric. txId: 21fe632fc94d62e4350d78d8086a903c382fe532e7e02107f2b55ec9ec6f68d7
```

Leave it running. **Only press Ctrl+C after you see at least one "Anchored on
Fabric" line.**

### Terminal 2 — generate test logs, then verify

```bash
cd ~/tamper-evident-logging-prototype/core
source ../scripts/set-env.sh

logger "Tamper Demo Test 1"
logger "Tamper Demo Test 2"
logger "Tamper Demo Test 3"
logger "Tamper Demo Test 4"
logger "Tamper Demo Test 5"

sleep 10
```

Now go back to Terminal 1, press **Ctrl+C** to stop the agent, then in
Terminal 2:

```bash
sudo chown "$USER:$USER" logs.db

node verify.js chain
node verify.js onchain
node verify.js tamper-demo
```

**Expected output (on a clean/fresh database):**
```
$ node verify.js chain
Checked 5 log entries.
✅ Hash chain and signatures are all valid. No tampering detected.

$ node verify.js onchain
Checked 5 log entries.
✅ Hash chain and signatures are all valid. No tampering detected.
Cross-checking merkle roots against Hyperledger Fabric...
🔗 Connected to Hyperledger Fabric channel: mychannel
✅ 1 batch root(s) match what is anchored on Fabric.

$ node verify.js tamper-demo
Before tampering — verifying 5 entries:
Checked 5 log entries.
✅ Hash chain and signatures are all valid. No tampering detected.

🕵️  Simulating an attacker directly editing log id 5 in the database...

After tampering — verifying again:
Checked 5 log entries.
❌ TAMPERING DETECTED in 1 entry:
   - log id 5: CIPHERTEXT_TAMPERED
```

`onchain` recomputes every batch's merkle root from the stored signatures
and compares it with the root anchored on the ledger, so deleting whole rows
(which `chain` alone cannot see at the tail of the log) is reported as
`LOCAL_ROOT_MISMATCH`, and a rewritten local root as `ONCHAIN_MISMATCH`.

That final block is the actual proof of the system: it correctly reports
**zero** tampering on untouched data, and correctly catches **exactly one**
tampered row after `tamper-demo` deliberately corrupts it.

---

## 7. Resetting for a clean demo run

`tamper-demo` deliberately corrupts a row in `logs.db` every time you run
it — that's intentional, it's how it proves detection works. If you run it
more than once against the same database, old corrupted rows stay flagged
on every future `verify.js chain` call too (correctly — they're still
tampered). Before a demo you want clean, wipe the database:

```bash
cd ~/tamper-evident-logging-prototype/core
rm -f logs.db logs_broken_demo.db logs_debug_backup.db
```

Then repeat Section 6 from scratch. You do **not** need to redo Section 5
(network/chaincode/wallet/keys) unless you also tore the network down.

---

## 8. Troubleshooting

**Log entries appear twice / more entries than expected**
On distros that run both journald and rsyslog, every message lands in the
journal *and* `/var/log/syslog`, and the agent captures both. Pick one source,
e.g. `WATCH_FILES=/var/log/auth.log` or `ENABLE_JOURNALD=false`. (On distros
without rsyslog files, such as Parrot/Kali defaults, the agent just warns
`file not found (yet)` and uses journald.)

**`DiscoveryService: mychannel error: access denied`, repeating forever**
Your wallet has stale identities from a previous network. `network-up.sh`
tears down and rebuilds Fabric from scratch every time — new certificates,
new identities — so any wallet enrolled against the *old* network is now
invalid. Fix:
```bash
cd ~/tamper-evident-logging-prototype/core
rm -rf wallet/*
node createWallet.js
```

**`cd: /path/to/fabric-samples/test-network: No such file or directory`**
A script was pointed at a `fabric-samples` path that doesn't match where it
actually lives. Check `scripts/set-env.sh` and the arguments you passed to
`network-up.sh` / `deploy-chaincode.sh` all point at the same location.

**`chaincode install failed ... timeout expired while executing transaction`**
Docker ran out of resources mid-install. Check `docker stats` in another
terminal while deploying; close other heavy applications and retry
`deploy-chaincode.sh`.

**`Failed to connect before the deadline ... peer0.org1.example.com`**
Nothing is listening yet — the Fabric network isn't up. Run
`bash scripts/network-up.sh ./fabric-samples` and wait for it to fully
finish before starting the agent.

**`agent.js` can't see `HSM_PASSPHRASE` even though you exported it**
Plain `sudo` strips your exported environment variables. Always use
`sudo -E env HSM_PASSPHRASE="$HSM_PASSPHRASE" ... node agent.js` as shown in
Section 6, not just `sudo node agent.js`.

**`verify.js tamper-demo` errors out / database locked**
The agent must be fully stopped (Ctrl+C, wait for "Shutting down" to finish)
before running any `verify.js` command — two processes holding `logs.db`
open at once can lock or race each other.

---

## 9. Optional: the Python collector

A secondary UDP syslog collector with its own independent hash chain and
RSA-PSS signing, not required for the main demo above.

```bash
cd ~/tamper-evident-logging-prototype/collector
source .venv/bin/activate
python3 collector.py
```

Send it a test message from another terminal:
```bash
logger --udp --server 127.0.0.1 --port 5514 "test message"
```

No Kafka broker needed — it falls back to writing `evidence_fallback.jsonl`
in that folder if none is running.