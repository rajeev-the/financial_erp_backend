import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Voucher from "../src/modules/tally/voucher/voucher.schema.js";
import Ledger from "../src/modules/tally/ledger/ledger.schema.js";

async function backfillPartyLedgerId() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://tally_dev:DDS7g8oPuxe02thT@ac-brjyzxv-shard-00-00.mx2rlka.mongodb.net:27017,ac-brjyzxv-shard-00-01.mx2rlka.mongodb.net:27017,ac-brjyzxv-shard-00-02.mx2rlka.mongodb.net:27017/tally-dev?ssl=true&replicaSet=atlas-1nx87n-shard-0&authSource=admin&appName=Cluster0";

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected successfully.");

  try {
    // Count vouchers with a valid party_ledger_name but missing party_ledger_id
    const unlinkedCount = await Voucher.countDocuments({
      party_ledger_id: null,
      party_ledger_name: { $nin: [null, ""] },
    });
    console.log(`Found ${unlinkedCount} vouchers with party_ledger_name missing party_ledger_id.`);

    if (unlinkedCount === 0) {
      console.log("All vouchers with a party ledger name already have party_ledger_id populated!");
      await mongoose.disconnect();
      return;
    }

    // Fetch all Ledgers
    const ledgers = await Ledger.find(
      { is_deleted: { $ne: true } },
      { _id: 1, company_id: 1, name: 1 },
    ).lean();

    console.log(`Fetched ${ledgers.length} Ledger documents.`);

    // Build lookup map: `${company_id}_${name.toLowerCase()}` -> _id
    const map = new Map();
    for (const l of ledgers) {
      if (l.company_id && l.name) {
        const key = `${l.company_id}_${l.name.trim().toLowerCase()}`;
        map.set(key, l._id);
      }
    }

    // Process vouchers in batches
    const batchSize = 1000;
    let processed = 0;
    let updated = 0;

    const cursor = Voucher.find(
      {
        party_ledger_id: null,
        party_ledger_name: { $nin: [null, ""] },
      },
      { _id: 1, company_id: 1, party_ledger_name: 1 },
    )
      .lean()
      .cursor();

    let bulkOps = [];

    for await (const voucher of cursor) {
      processed++;
      if (voucher.company_id && voucher.party_ledger_name) {
        const key = `${voucher.company_id}_${voucher.party_ledger_name.trim().toLowerCase()}`;
        const matchedLedgerId = map.get(key);
        if (matchedLedgerId) {
          bulkOps.push({
            updateOne: {
              filter: { _id: voucher._id },
              update: { $set: { party_ledger_id: matchedLedgerId } },
            },
          });
        }
      }

      if (bulkOps.length >= batchSize) {
        const res = await Voucher.bulkWrite(bulkOps, { ordered: false });
        updated += res.modifiedCount;
        bulkOps = [];
        console.log(`Processed ${processed} vouchers (${updated} updated)...`);
      }
    }

    if (bulkOps.length > 0) {
      const res = await Voucher.bulkWrite(bulkOps, { ordered: false });
      updated += res.modifiedCount;
    }

    console.log(
      `=== Party Ledger Backfill Completed ===\nTotal scanned: ${processed}\nTotal updated: ${updated}\nUnmatched: ${
        processed - updated
      }`,
    );
  } catch (error) {
    console.error("Error during party ledger backfill:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

backfillPartyLedgerId();
