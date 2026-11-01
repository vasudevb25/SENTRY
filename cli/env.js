/**
 * env.js — loads scripts/set-env.sh into process.env (so the user never has
 * to `source` it by hand) and prompts for HSM_PASSPHRASE when it is missing.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const SET_ENV = path.join(ROOT, 'scripts', 'set-env.sh');

/**
 * Parses `export KEY=value` lines. Later lines win, like `source` would.
 * Variables already exported in the shell take precedence over the file.
 */
function loadSetEnv() {
    if (!fs.existsSync(SET_ENV)) return false;
    const fromFile = {};
    for (const raw of fs.readFileSync(SET_ENV, 'utf8').split('\n')) {
        const m = raw.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        val = val.replace(/\$\{?HOME\}?/g, process.env.HOME || '');
        fromFile[m[1]] = val;
    }
    for (const [k, v] of Object.entries(fromFile)) {
        if (process.env[k] === undefined) process.env[k] = v;
    }
    return true;
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question) {
    return new Promise((resolve, reject) => {
        if (!process.stdin.isTTY) {
            reject(new Error('HSM_PASSPHRASE is not set and there is no terminal to prompt on.'));
            return;
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl._writeToOutput = (s) => {
            if (s.includes(question)) rl.output.write(s);
            else rl.output.write('');
        };
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
    });
}

/** Writes a fresh, owner-only scripts/set-env.sh holding the passphrase. */
function saveSetEnv(passphrase) {
    const body = [
        '# Created by ./sentry — loaded automatically on every run.',
        '# Keep this passphrase: there is no recovery if you lose it.',
        `export HSM_PASSPHRASE="${passphrase.replace(/(["\\$`])/g, '\\$1')}"`,
        '',
    ].join('\n');
    fs.writeFileSync(SET_ENV, body, { mode: 0o600 });
}

module.exports = { ROOT, SET_ENV, loadSetEnv, promptHidden, saveSetEnv };
