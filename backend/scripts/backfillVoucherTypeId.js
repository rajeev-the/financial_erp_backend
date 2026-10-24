import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Voucher from "../src/modules/tally/voucher/voucher.schema.js";
import VoucherType from "../src/modules/tally/voucher/voucherType.schema.js";

async function backfillVoucherTypeId() {
  const mongoUri ="mongodb://tally_dev:DDS7g8oPuxe02thT@ac-brjyzxv-shard-00-00.mx2rlka.mongodb.net:27017,ac-brjyzxv-shard-00-01.mx2rlka.mongodb.net:27017,ac-brjyzxv-shard-00-02.mx2rlka.mongodb.net:27017/tally-dev?ssl=true&replicaSet=atlas-1nx87n-shard-0&authSource=admin&appName=Cluster0"
  if (!mongoUri) {
    console.error("MONGO_URI is not defined in environment.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected successfully.");

  try {
    // Count vouchers missing voucher_type_id
    const unlinkedCount = await Voucher.countDocuments({
      voucher_type_id: null,
      vchtype: { $exists: true, $ne: "" },
    });
    console.log(`Found ${unlinkedCount} vouchers missing voucher_type_id.`);

    if (unlinkedCount === 0) {
      console.log("No vouchers need backfilling.");
      await mongoose.disconnect();
      return;
    }

    // Fetch all voucher types
    const voucherTypes = await VoucherType.find(
      { is_deleted: { $ne: true } },
      { _id: 1, company_id: 1, name: 1 },
    ).lean();

    console.log(`Fetched ${voucherTypes.length} VoucherType documents.`);

    // Build lookup map: `${company_id}_${name.toLowerCase()}` -> _id
    const map = new Map();
    for (const vt of voucherTypes) {
      if (vt.company_id && vt.name) {
        const key = `${vt.company_id}_${vt.name.trim().toLowerCase()}`;
        map.set(key, vt._id);
      }
    }

    // Process vouchers in batches
    const batchSize = 1000;
    let processed = 0;
    let updated = 0;

    const cursor = Voucher.find(
      {
        voucher_type_id: null,
        vchtype: { $exists: true, $ne: "" },
      },
      { _id: 1, company_id: 1, vchtype: 1 },
    )
      .lean()
      .cursor();

    let bulkOps = [];

    for await (const voucher of cursor) {
      processed++;
      if (voucher.company_id && voucher.vchtype) {
        const key = `${voucher.company_id}_${voucher.vchtype.trim().toLowerCase()}`;
        const matchedTypeId = map.get(key);
        if (matchedTypeId) {
          bulkOps.push({
            updateOne: {
              filter: { _id: voucher._id },
              update: { $set: { voucher_type_id: matchedTypeId } },
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
      `=== Backfill Completed ===\nTotal scanned: ${processed}\nTotal updated: ${updated}\nUnmatched: ${
        processed - updated
      }`,
    );
  } catch (error) {
    console.error("Error during backfill:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

backfillVoucherTypeId();
