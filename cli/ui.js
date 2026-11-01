/**
 * ui.js — terminal output helpers for the sentry CLI: colours, the startup
 * banner, and consistent step / status lines.
 */

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const esc = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const c = {
    bold: esc('1'),
    dim: esc('2'),
    red: esc('31'),
    green: esc('32'),
    yellow: esc('33'),
    blue: esc('34'),
    magenta: esc('35'),
    cyan: esc('36'),
    gray: esc('90'),
    neon: esc('38;5;48'),
    rgb: (r, g, b) => esc(`38;2;${r};${g};${b}`),
};

const LOGO = [
    '▄▄▄▄             ▄▄               ▄▄▄▄             ▄▄    ',
    '██▀██             ██               ██▀██            ██    ',
    '▓▓ ▓▓             ▓▓               ▓▓ ▓▓  ▓▓        ▓▓ ▓▓ ',
    '▓▓ ▓▓             ▓▓   ▄     ▄▄ ▄▄ ▓▓ ▓▓  ▀▀        ▓▓ ▓▓ ',
    '▒▒     ▄▄▄▄ ▄▄▄▄  ▒▒▒▒ ▒▒▄▒▒ ▒▒ ▒▒ ▒▒ ▒▒ ▄▄▄▄  ▄▄▄▄ ▒▒▄▒  ',
    '▀▒▒▒▄ ▒▒ ▒▒ ▒▒ ▒▒ ▒▒   ▒▒ ▒▒ ░░ ░░ ▒▒▒▒   ▒▒  ▒▒ ▒▒ ▒▒ ▒▒ ',
    '   ░░ ░░▄░░ ░░ ░░ ░░   ░░    ░░ ░░ ░░ ░░  ░░  ▀░▄▄  ░░ ░░ ',
    '░░ ░░ ░░ ▄▄ ░░ ░░ ░░   ░░    ██ ██ ░░ ░░  ░░  ▄▄ ░░ ░░ ░░ ',
    '██▄██ ██ ██ ██ ██ ██ █ ██     ▀▀██ ██ ██  ██  ██ ██ ██ ██ ',
    '▀▀▀▀   ▀▀▀▀ ▀▀ ▀▀  ▀▀▀ ▀▀    ▄█ ██ ▀▀ ▀▀ ▀▀▀▀ ▀▀▀▀  ▀▀ ▀▀ ',
    '                             ▀█ ██                        ',
    '                               ▀██',
];

function banner(version) {
    const out = [''];
    LOGO.forEach((line, i) => {
        // green -> cyan gradient, top to bottom
        const t = i / (LOGO.length - 1);
        const col = c.rgb(0, Math.round(255 - 43 * t), Math.round(156 + 99 * t));
        out.push('   ' + c.bold(col(line)));
    });
    out.push('');
    out.push('   ' + c.cyan('T A M P E R - E V I D E N T   L O G   I N T E G R I T Y'));
    out.push('   ' + c.gray('hash chain · ed25519 · aes-256-gcm · merkle · hyperledger fabric'));
    out.push('');
    out.push('   ' + c.gray('──────────────[ ') + c.bold(c.neon('a tool by SedentryRisk')) + c.gray(' ]──────────────') + c.gray(`  v${version}`));
    out.push('');
    console.log(out.join('\n'));
}

function section(title) {
    console.log('\n' + c.cyan('▌') + ' ' + c.bold(title));
}

const step = (msg) => console.log('  ' + c.cyan('›') + ' ' + msg);
const ok = (msg) => console.log('  ' + c.green('✔') + ' ' + msg);
const warn = (msg) => console.log('  ' + c.yellow('▲') + ' ' + msg);
const fail = (msg) => console.log('  ' + c.red('✖') + ' ' + msg);
const info = (msg) => console.log('    ' + c.gray(msg));

module.exports = { c, banner, section, step, ok, warn, fail, info };
