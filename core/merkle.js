const { sha256 } = require('./hash');

function buildMerkleRoot(hashes) {
    if (hashes.length === 0) return null;
    if (hashes.length === 1) return sha256(hashes[0]);

    let level = hashes.slice();
    while (level.length > 1) {
        let temp = [];
        for (let i = 0; i < level.length; i += 2) {
            if (i + 1 < level.length) {
                temp.push(sha256(level[i] + level[i + 1]));
            } else {
                // odd node out: duplicate it rather than passing it through
                // unhashed, so a single-item batch's "root" isn't just the
                // raw leaf hash (which the old code did for hashes.length===1,
                // and which is a well-known merkle-tree implementation pitfall).
                temp.push(sha256(level[i] + level[i]));
            }
        }
        level = temp;
    }
    return level[0];
}

module.exports = { buildMerkleRoot };
