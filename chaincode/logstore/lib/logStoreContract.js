'use strict';

const { Contract } = require('fabric-contract-api');

/**
 * LogStoreContract — anchors merkle roots (one per batch of signed logs) on
 * the ledger. Each asset is immutable once written: this contract deliberately
 * does NOT expose an UpdateAsset function, because the entire point is that
 * once a batch's root is on-chain, nobody — including your own application —
 * can quietly change it. Rejecting overwrites of an existing id is what
 * actually gives "prove the log is safe" its teeth.
 */
class LogStoreContract extends Contract {

    async InitLedger(ctx) {
        // nothing to seed — the ledger starts empty
        return;
    }

    /**
     * Anchors a new merkle root.
     * @param {string} id unique id for this batch (e.g. "log_<timestamp>_<rand>")
     * @param {string} rootHash the merkle root of the batch's signed log hashes
     * @param {string} timestamp ms since epoch, as a string
     * @param {string} source free-text origin label (e.g. "system")
     * @param {string} status free-text status label (e.g. "valid")
     */
    async CreateAsset(ctx, id, rootHash, timestamp, source, status) {
        const exists = await this.AssetExists(ctx, id);
        if (exists) {
            throw new Error(`Asset ${id} already exists — roots are immutable, refusing overwrite`);
        }

        const asset = {
            docType: 'logRoot',
            id,
            rootHash,
            timestamp,
            source,
            status,
            anchoredBy: ctx.clientIdentity.getID(),
        };

        await ctx.stub.putState(id, Buffer.from(JSON.stringify(asset)));
        return JSON.stringify(asset);
    }

    async ReadAsset(ctx, id) {
        const data = await ctx.stub.getState(id);
        if (!data || data.length === 0) {
            throw new Error(`Asset ${id} does not exist`);
        }
        return data.toString();
    }

    async AssetExists(ctx, id) {
        const data = await ctx.stub.getState(id);
        return data && data.length > 0;
    }

    /** Returns every anchored root — used by verify.js for cross-checking. */
    async GetAllAssets(ctx) {
        const results = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                record = strValue;
            }
            results.push(record);
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(results);
    }
}

module.exports = LogStoreContract;
