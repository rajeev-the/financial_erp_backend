import mongoose from "mongoose";
import envConfig from "../../../config/env.js";
import Company from "../../companies/company.schema.js";
import OldVoucher from "../../tally/voucher/voucher.schema.js";
import UnifiedVoucher from "../voucher/voucher.unified.schema.js";

async function checkStatus() {
  await mongoose.connect(envConfig.MONGO_URI);
  console.log("Connected to MongoDB:", mongoose.connection.name);

  const companies = await Company.find({}, { _id: 1, name: 1, tally_company_name: 1 }).lean();
  console.log(`Found ${companies.length} companies:\n`);

  for (const c of companies) {
    const compId = c._id;
    const oldVoucherCount = await OldVoucher.countDocuments({ company_id: compId });
    const unifiedCount = await UnifiedVoucher.countDocuments({ companyId: compId });

    console.log(`- [${c.name || c.tally_company_name}] (${compId}):`);
    console.log(`    Legacy Vouchers: ${oldVoucherCount}`);
    console.log(`    Unified Vouchers: ${unifiedCount}`);
    console.log(`    Status: ${oldVoucherCount === unifiedCount && oldVoucherCount > 0 ? "✅ 100% Synced" : oldVoucherCount === 0 ? "⚪ No Data" : "⚠️ Needs Backfill"}`);
  }

  await mongoose.disconnect();
}

checkStatus().catch(console.error);
