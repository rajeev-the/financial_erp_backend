import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Voucher from "../src/modules/tally/voucher/voucher.schema.js";
import Ledger from "../src/modules/tally/ledger/ledger.schema.js";

async function inspectUnmatched() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://tally_dev:DDS7g8oPuxe02thT@ac-brjyzxv-shard-00-00.mx2rlka.mongodb.net:27017,ac-brjyzxv-shard-00-01.mx2rlka.mongodb.net:27017,ac-brjyzxv-shard-00-02.mx2rlka.mongodb.net:27017/tally-dev?ssl=true&replicaSet=atlas-1nx87n-shard-0&authSource=admin&appName=Cluster0";

  await mongoose.connect(mongoUri);

  const unmatchedVouchers = await Voucher.find(
    {
      party_ledger_id: null,
      party_ledger_name: { $exists: true, $ne: null, $ne: "" },
    },
    { _id: 1, vchtype: 1, party_ledger_name: 1, company_id: 1 },
  )
    .lean()
    .limit(30);

  console.log("Sample unmatched vouchers count total:", await Voucher.countDocuments({
    party_ledger_id: null,
    party_ledger_name: { $exists: true, $ne: null, $ne: "" },
  }));

  // Group by party_ledger_name to see unique names and counts
  const nameCounts = await Voucher.aggregate([
    {
      $match: {
        party_ledger_id: null,
      },
    },
    {
      $group: {
        _id: "$party_ledger_name",
        vchtypes: { $addToSet: "$vchtype" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  console.log("Party ledger name breakdown for vouchers where party_ledger_id is null:");
  console.log(JSON.stringify(nameCounts, null, 2));

  if (nameCounts.length > 0 && nameCounts[0]._id) {
    const topName = nameCounts[0]._id;
    const similar = await Ledger.find(
      { name: new RegExp(topName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 5), "i") },
      { _id: 1, name: 1, company_id: 1 },
    ).lean();
    console.log(`Similar ledgers for '${topName}':`, similar);
  }

  await mongoose.disconnect();
}

inspectUnmatched();
