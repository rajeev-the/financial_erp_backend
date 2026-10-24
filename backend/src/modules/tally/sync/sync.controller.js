import Company from "../../companies/company.schema.js";
import Group from "../group/group.schema.js";
import Ledger from "../ledger/ledger.schema.js";
import VoucherType from "../voucher/voucherType.schema.js";
import Voucher from "../voucher/voucher.schema.js";
import LedgerEntry from "../voucher/ledgerentry.schema.js";
import InventoryEntry from "../voucher/inventoryentry.schema.js";
import StockItem from "../stock/stock.schema.js";
import CompanyBills from "../bills/bills.schema.js";
import StockGroup from "../stock/stockgroup.schema.js";
import Godown from "../godown/godown.schema.js";
import Unit from "../unit/unit.schema.js";
import CostCenter from "../costcenter/costcenter.schema.js";
import LedgerBalanceDetails from "../ledger/ledgerBalanceDetails.schema.js";
import mongoose from "mongoose";
import SalesRegister from "../sales/salesRegister.schema.js";
import PurchaseRegister from "../purchase/purchaseRegister.schema.js";
import SalesAccount from "../sales/salesAccount.schema.js";
import PurchaseAccount from "../purchase/purchaseAccount.schema.js";
import TrialBalance from "../trialBalance/trialBalance.schema.js";
import Receivable from "../receivables/receivable.schema.js";
import Payable from "../payables/payable.schema.js";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import {
  toBool,
  clean,
  normalizeYesNo,
  normalizeNullable,
  normalizeGstApplicable,
  cleanNumber,
  toArray,
  classifyLedger,
  parseTallyDate,
} from "./format.helper.js";


const saveCompanyToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0 || !data[0]) return [];
    const normalizedData = data[0];
    company.tally_company_name = clean(normalizedData.name) || "";
    company.tally_company_guid = clean(normalizedData.guid) || "";

    if (normalizedData.startingfrom) {
      
      company.financial_year_from = parseTallyDate(normalizedData.startingfrom);
    }
    console.log("financial_year_from", company.financial_year_from);
    console.log("data", data)
    if (normalizedData.endingat) {
      company.financial_year_to = parseTallyDate(normalizedData.endingat);
    }
    if (normalizedData.booksfrom) {
      company.books_begin_from = parseTallyDate(normalizedData.booksfrom);
    }
    if (normalizedData.lastvoucherdate) {
      company.last_voucher_date = parseTallyDate(
        normalizedData.lastvoucherdate,
      );
    }

    if (Array.isArray(normalizedData.statistics)) {
      company.statistics = normalizedData.statistics.map((s) => ({
        name: clean(s.name) || "",
        direct: clean(s.direct) || "0",
        cancelled: clean(s.cancelled) || "",
      }));
    }

    company.last_sync_at = new Date();

    await company.save();
    return company;
  } catch (error) {
    console.error("Error saving company to db:", error);
    throw error;
  }
};
const normalizeGroupData = (item, company) => {
  if (!item || !company?._id) return null;
  return {
    company_id: company._id,
    guid: clean(item.guid) || null,
    name: clean(item.name) || "",
    parent: clean(item.parent) || "",
    alter_id: item.alterid ? Number(item.alterid) : null,
    master_id: item.masterid ? Number(item.masterid) : null,
    is_deemed_positive: toBool(item.isdeemedpositive),
    affects_stock: toBool(item.affectsstock),
    last_sync_at: new Date(),
  };
};
const saveGroupToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || !data.length) return [];

    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = data
      .map((item) => normalizeGroupData(item, company))
      .filter((item) => item !== null && item.guid);

    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: { guid: item.guid, company_id: company._id },
        update: { $set: item },
        upsert: true,
      },
    }));

    const result = await Group.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving group to db:", error);
    throw error;
  }
};
const normalizeGstDetails = (gstDetails) => {
  if (!gstDetails || typeof gstDetails !== "object") return null;

  const taxability = normalizeNullable(gstDetails.taxability);
  const statewiseRaw = gstDetails.statewisedetails;

  let statewise_details = null;
  if (statewiseRaw && typeof statewiseRaw === "object") {
    const rawStateObj = Array.isArray(statewiseRaw)
      ? statewiseRaw[0]
      : statewiseRaw;
    if (rawStateObj && typeof rawStateObj === "object") {
      const stateName = normalizeNullable(rawStateObj.statename);
      const rateDetailsRaw = toArray(rawStateObj.ratedetails);
      const rate_details = rateDetailsRaw
        .filter(Boolean)
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          return {
            gst_rate_duty_head: normalizeNullable(r.gstratedutyhead),
            gst_rate_valuation_type: normalizeNullable(
              r.gstratevaluationtype,
            ),
            gst_rate: cleanNumber(r.gstrate),
          };
        })
        .filter((r) => r && r.gst_rate_duty_head !== null);

      if (stateName || rate_details.length > 0) {
        statewise_details = {
          state_name: stateName,
          rate_details,
        };
      }
    }
  }

  const result = {
    taxability,
    statewise_details,
  };

  if (!result.taxability && !result.statewise_details) return null;
  return result;
};
const extractAddressString = (addrInput) => {
  if (!addrInput) return null;

  if (typeof addrInput === "string") {
    return clean(addrInput);
  }

  if (Array.isArray(addrInput)) {
    const parts = addrInput
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") return clean(item);
        if (typeof item === "object") {
          if (item.address) return extractAddressString(item.address);
          return null;
        }
        return clean(item);
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  if (typeof addrInput === "object") {
    if (addrInput.address) {
      return extractAddressString(addrInput.address);
    }
  }

  return null;
};
const normalizeLedMailingDetails = (mailingDetails) => {
  if (!mailingDetails || typeof mailingDetails !== "object") return null;

  const raw = Array.isArray(mailingDetails)
    ? mailingDetails[0]
    : mailingDetails;

  if (!raw || typeof raw !== "object") return null;

  const rawAddrStr = extractAddressString(raw.address);
  const addressVal = normalizeNullable(rawAddrStr);

  const doc = {
    applicable_from: raw.applicablefrom || raw.applicable_from
      ? parseTallyDate(raw.applicablefrom || raw.applicable_from)
      : null,
    pincode: normalizeNullable(raw.pincode),
    mailing_name: normalizeNullable(raw.mailingname || raw.mailing_name),
    state: normalizeNullable(raw.state),
    country: normalizeNullable(raw.country),
    address: addressVal,
  };

  if (
    !doc.applicable_from &&
    !doc.pincode &&
    !doc.mailing_name &&
    !doc.state &&
    !doc.country &&
    !doc.address
  ) {
    return null;
  }
  return doc;
};
const normalizeLedGstRegDetails = (gstRegDetails) => {
  if (!gstRegDetails || typeof gstRegDetails !== "object") return null;

  const raw = Array.isArray(gstRegDetails)
    ? gstRegDetails[0]
    : gstRegDetails;

  if (!raw || typeof raw !== "object") return null;

  const doc = {
    applicable_from: raw.applicablefrom || raw.applicable_from
      ? parseTallyDate(raw.applicablefrom || raw.applicable_from)
      : null,
    gst_registration_type: normalizeNullable(
      raw.gstregistrationtype || raw.gst_registration_type,
    ),
    place_of_supply: normalizeNullable(
      raw.placeofsupply || raw.place_of_supply,
    ),
    gstin: normalizeNullable(raw.gstin),
    is_oth_territory_assessee: toBool(
      raw.isothterritoryassessee ?? raw.is_oth_territory_assessee,
    ),
    consider_purchase_for_export: toBool(
      raw.considerpurchaseforexport ?? raw.consider_purchase_for_export,
    ),
    is_transporter: toBool(raw.istransporter ?? raw.is_transporter),
    is_common_party: toBool(raw.iscommonparty ?? raw.is_common_party),
  };

  if (
    !doc.applicable_from &&
    !doc.gst_registration_type &&
    !doc.place_of_supply &&
    !doc.gstin &&
    !doc.is_oth_territory_assessee &&
    !doc.consider_purchase_for_export &&
    !doc.is_transporter &&
    !doc.is_common_party
  ) {
    return null;
  }
  return doc;
};
const normalizePaymentDetails = (paymentDetails) => {
  if (!paymentDetails || typeof paymentDetails !== "object") return null;

  const raw = Array.isArray(paymentDetails)
    ? paymentDetails.find(
        (p) => toBool(p?.setasdefault ?? p?.set_as_default),
      ) || paymentDetails[0]
    : paymentDetails;

  if (!raw || typeof raw !== "object") return null;

  const ifsCode = normalizeNullable(
    raw.ifscode || raw.ifs_code || raw.ifsc_code,
  );
  const bankName = normalizeNullable(raw.bankname || raw.bank_name);
  const accountNumber = normalizeNullable(
    raw.accountnumber || raw.account_number,
  );
  const paymentFavouring = normalizeNullable(
    raw.paymentfavouring || raw.payment_favouring,
  );
  const transactionName = normalizeNullable(
    raw.transactionname || raw.transaction_name,
  );
  const setAsDefault = toBool(raw.setasdefault ?? raw.set_as_default);
  const defaultTransactionType = normalizeNullable(
    raw.defaulttransactiontype || raw.default_transaction_type,
  );

  const doc = {
    ifs_code: ifsCode,
    bank_name: bankName,
    account_number: accountNumber,
    payment_favouring: paymentFavouring,
    transaction_name: transactionName,
    set_as_default: setAsDefault,
    default_transaction_type: defaultTransactionType,
  };

  if (
    !doc.ifs_code &&
    !doc.bank_name &&
    !doc.account_number &&
    !doc.payment_favouring &&
    !doc.transaction_name &&
    !doc.default_transaction_type
  ) {
    return null;
  }
  return doc;
};
const normalizeContactDetails = (contactDetails) => {
  if (!contactDetails || typeof contactDetails !== "object") return null;

  const raw = Array.isArray(contactDetails)
    ? contactDetails[0]
    : contactDetails;

  if (!raw || typeof raw !== "object") return null;

  const doc = {
    name: normalizeNullable(raw.name),
    phone_number: normalizeNullable(
      raw.phonenumber || raw.phone_number || raw.phoneno,
    ),
    country_isd_code: normalizeNullable(
      raw.countryisdcode || raw.country_isd_code,
    ),
    is_default_whatsapp_num: toBool(
      raw.isdefaultwhatsappnum ?? raw.is_default_whatsapp_num,
    ),
  };

  if (
    !doc.name &&
    !doc.phone_number &&
    !doc.country_isd_code &&
    !doc.is_default_whatsapp_num
  ) {
    return null;
  }
  return doc;
};
const normalizeBalanceDetails = (balanceDetails) => {
  if (!balanceDetails) return [];
  const list = toArray(balanceDetails);
  return list
    .filter(Boolean)
    .map((b) => {
      if (!b || typeof b !== "object") return null;

      const fromDate = b.from_date || b.fromdate || b.fromDate;
      const toDate = b.to_date || b.todate || b.toDate;

      return {
        from_date: fromDate ? parseTallyDate(fromDate) : null,
        to_date: toDate ? parseTallyDate(toDate) : null,
        opening_balance: cleanNumber(
          b.opening_balance ?? b.openingbalance ?? b.openingBalance,
        ),
        closing_balance: cleanNumber(
          b.closing_balance ?? b.closingbalance ?? b.closingBalance,
        ),
        is_deemed_positive: toBool(
          b.is_deemed_positive ?? b.isdeemedpositive ?? b.isDeemedPositive,
        ),
      };
    })
    .filter((b) => b !== null);
};
const normalizeHsnDetails = (hsnDetails) => {
  if (!hsnDetails || typeof hsnDetails !== "object") return null;

  const doc = {
    applicable_from: hsnDetails.applicablefrom
      ? parseTallyDate(hsnDetails.applicablefrom)
      : null,
    src_of_hsn_details: normalizeNullable(hsnDetails.srcofhsndetails),
    hsn_code: normalizeNullable(hsnDetails.hsncode),
    hsn_description: normalizeNullable(hsnDetails.hsndescription),
  };

  if (
    !doc.applicable_from &&
    !doc.src_of_hsn_details &&
    !doc.hsn_code &&
    !doc.hsn_description
  ) {
    return null;
  }
  return doc;
};
const normalizeLedgerData = (item, company, year) => {
  try {
    if (!item || !company?._id) return null;
    let name = item?.name;
    if (Array.isArray(name)) {
      name = name[0];
    }
    name = clean(name);
    const guid = clean(item?.guid);
    const parent = clean(item?.parent) || "Primary";

    if (!guid) return null;

    const isRevenue = toBool(item?.isrevenue ?? item?.is_revenue);
    const isDeemedPositive = toBool(
      item?.isdeemedpositive ?? item?.is_deemed_positive,
    );
    const affectsGrossProfit = toBool(
      item?.affectsgrossprofit ?? item?.affects_gross_profit,
    );

    const classification = classifyLedger(
      isRevenue,
      isDeemedPositive,
      affectsGrossProfit,
    );

    const doc = {
      company_id: company._id,
      name: name || "",
      guid,
      parent,

      alter_id: clean(item?.alterid ?? item?.alter_id)
        ? Number(clean(item?.alterid ?? item?.alter_id))
        : null,
      master_id: clean(item?.masterid ?? item?.master_id)
        ? Number(clean(item?.masterid ?? item?.master_id))
        : null,

      party_gstin: normalizeNullable(item?.partygstin ?? item?.party_gstin),
      gst_duty_head: normalizeNullable(
        item?.gstdutyhead ?? item?.gst_duty_head,
      ),
      prior_state_name: normalizeNullable(
        item?.priorstatename ?? item?.prior_state_name,
      ),
      gst_registration_type: normalizeNullable(
        item?.gstregistrationtype ?? item?.gst_registration_type,
      ),
      gst_applicable:
        item?.gstapplicable || item?.gst_applicable
          ? normalizeGstApplicable(
              clean(item.gstapplicable || item.gst_applicable),
            )
          : null,
      gst_appropriate_to: normalizeNullable(
        item?.gstappropriateto ?? item?.gst_appropriate_to,
      ),
      appropriate_for: normalizeNullable(
        item?.appropriatefor ?? item?.appropriate_for,
      ),
      excise_alloc_type: normalizeNullable(
        item?.excisealloctype ?? item?.excise_alloc_type,
      ),
      gst_type_of_supply: normalizeNullable(
        item?.gsttypeofsupply ?? item?.gst_type_of_supply,
      ),
      gst_nature_of_supply: normalizeNullable(
        item?.gstnatureofsupply ?? item?.gst_nature_of_supply,
      ),
      income_tax_number: normalizeNullable(
        item?.incometaxnumber ?? item?.income_tax_number,
      ),

      currency_name: normalizeNullable(
        item?.currencyname ?? item?.currency_name,
      ),
      email: normalizeNullable(item?.email),
      website: normalizeNullable(item?.website),
      narration: normalizeNullable(item?.narration),
      bill_credit_period: normalizeNullable(
        item?.billcreditperiod ?? item?.bill_credit_period,
      ),
      country_of_residence: normalizeNullable(
        item?.countryofresidence ?? item?.country_of_residence,
      ),
      description: normalizeNullable(item?.description),
      ledger_phone: normalizeNullable(
        item?.ledgerphone ?? item?.ledger_phone,
      ),
      ledger_contact: normalizeNullable(
        item?.ledgercontact ?? item?.ledger_contact,
      ),
      ledger_mobile: normalizeNullable(
        item?.ledgermobile ?? item?.ledger_mobile,
      ),
      ledger_country_isd_code: normalizeNullable(
        item?.ledgercountryisdcode ?? item?.ledger_country_isd_code,
      ),
      credit_limit: cleanNumber(item?.creditlimit ?? item?.credit_limit),

      is_revenue: isRevenue,
      affects_gross_profit: affectsGrossProfit,
      affects_stock: toBool(item?.affectsstock ?? item?.affects_stock),
      is_bill_wise_on: toBool(item?.isbillwiseon ?? item?.is_bill_wise_on),
      is_cost_centres_on: toBool(
        item?.iscostcentreson ?? item?.is_cost_centres_on,
      ),
      is_subledger: toBool(item?.issubledger ?? item?.is_subledger),


      gst_details: normalizeGstDetails(item?.gstdetails || item?.gst_details),
      led_gst_reg_details: normalizeLedGstRegDetails(
        item?.ledgstregdetails || item?.led_gst_reg_details,
      ),
      payment_details: normalizePaymentDetails(
        item?.paymentdetails || item?.payment_details,
      ),
      contact_details: normalizeContactDetails(
        item?.contactdetails || item?.contact_details,
      ),
      led_mailing_details: normalizeLedMailingDetails(
        item?.ledmailingdetails || item?.led_mailing_details,
      ),
      hsn_details: normalizeHsnDetails(item?.hsndetails || item?.hsn_details),

      classification,
      synced_at: new Date(),
    };

    // Remove empty/null/undefined fields except essential identifiers
    Object.keys(doc).forEach((key) => {
      if (
        key !== "parent" &&
        key !== "name" &&
        key !== "guid" &&
        (doc[key] === null ||
          doc[key] === undefined ||
          doc[key] === "" ||
          doc[key] === "Not Applicable" ||
          doc[key] === "&#4; Not Applicable")
      ) {
        delete doc[key];
      }
    });

    return doc;
  } catch (error) {
    console.error("normalizeLedgerData error:", error);
    return null;
  }
};
const saveLedgerToDb = async ({ data, company }) => {
  try {
    if (!company) {
      throw new Error("Company not found");
    }

    let items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.data)) {
        items = data.data;
      } else if (data.data && typeof data.data === "object") {
        items = [data.data];
      } else {
        items = [data];
      }
    }

    if (!items.length) return [];

    // Fetch all groups for this company to resolve group_id from ledger parent
    const groupDocs = await Group.find(
      { company_id: company._id },
      { _id: 1, name: 1 },
    ).lean();
    const groupNameToId = {};
    for (const g of groupDocs) {
      groupNameToId[g.name] = g._id;
    }

    const normalizedData = items
      .map((item) => normalizeLedgerData(item, company))
      .filter((item) => item !== null && item.guid);

    if (!normalizedData.length) return [];

    // Set group_id by matching ledger parent to group name
    for (const doc of normalizedData) {
      doc.group_id = groupNameToId[doc.parent] ?? null;
    }

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: { guid: item.guid, company_id: company._id },
        update: { $set: item },
        upsert: true,
      },
    }));

    const result = await Ledger.bulkWrite(bulkOps, {
      ordered: false,
    });

    // Save balance details to the new collection
    // Build guid→_id map for all ledgers in this batch
    const guids = normalizedData.map((d) => d.guid).filter(Boolean);
    const ledgerDocs = await Ledger.find(
      { company_id: company._id, guid: { $in: guids } },
      { _id: 1, guid: 1 },
    ).lean();

    const guidToLedgerId = {};
    for (const ld of ledgerDocs) {
      guidToLedgerId[ld.guid] = ld._id;
    }

    const balanceEntriesToInsert = [];
    const ledgerIdsWithBalance = [];

    for (const item of items) {
      if (!item) continue;
      const guid = clean(item.guid);
      if (!guid) continue;
      const ledger_id = guidToLedgerId[guid];
      if (!ledger_id) continue;

      const balanceDetails = normalizeBalanceDetails(
        item.balance_details || item.balancedetails,
      );
      if (balanceDetails.length > 0) {
        ledgerIdsWithBalance.push(ledger_id);
        for (const bd of balanceDetails) {
          balanceEntriesToInsert.push({
            ...bd,
            ledger_id,
            company_id: company._id,
          });
        }
      }
    }

    if (ledgerIdsWithBalance.length > 0) {
      await LedgerBalanceDetails.deleteMany({
        ledger_id: { $in: ledgerIdsWithBalance },
      });
      if (balanceEntriesToInsert.length > 0) {
        await LedgerBalanceDetails.insertMany(balanceEntriesToInsert, {
          ordered: false,
        });
      }
    }

    return result;
  } catch (error) {
    console.error("Error saving ledger to db:", error);
    throw error;
  }
};
const saveVoucherTypeToDb = async ({ data, company, req }) => {
  try {
    if (!Array.isArray(data) || !data.length) return [];

    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = data
      .map((item) => {
        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }
        return {
          company_id: company._id,
          name: clean(name),
          guid: clean(item?.guid),
          parent: clean(item?.parent),
          synced_at: new Date(),
        };
      })
      .filter((item) => item.guid);

    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          guid: item.guid,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await VoucherType.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving voucher type to db:", error);
    throw error;
  }
};
const normalizeLedgerEnteries = (ledgerentries = []) => {
  return toArray(ledgerentries)
    .filter((l) => l)
    .map((l) => {
      try {
        const rawName = l?.ledgername || l?.name || l?.ledger_name;
        const rawGuid =
          l?.ledger_guid ||
          l?.ledgerguid ||
          l?.ledgerGuid ||
          l?.LEDGER_GUID ||
          l?.["ledger_guid"];

        const item = {
          _ledger_name: clean(rawName),
          ledger_guid: clean(rawGuid) || null,
          amount: cleanNumber(l?.amount),
          is_deemed_positive: toBool(l?.isdeemedpositive || l?.is_deemed_positive),
        };
        // Remove empty fields (keep ledger_guid if present)
        Object.keys(item).forEach((key) => {
          if (
            item[key] === null ||
            item[key] === undefined ||
            item[key] === ""
          ) {
            delete item[key];
          }
        });
        return item;
      } catch (error) {
        console.error("Error normalizing ledger entry:", error);
        return null;
      }
    })
    .filter(Boolean);
};
const normalizeInventoryEnteries = (inventoryentries = []) => {
  if (!inventoryentries) return [];
  const entries = toArray(inventoryentries);
  return entries
    .filter((i) => i && i.stockitemname)
    .map((i) => {
      try {
        let accLedgerName = null;
        let accLedgerGuid = null;
        let accAmount = null;
        let accDeemedPositive = false;

        const alloc = Array.isArray(i.accountingallocations)
          ? i.accountingallocations[0]
          : i.accountingallocations ||
            (Array.isArray(i["accountingallocations.list"])
              ? i["accountingallocations.list"][0]
              : i["accountingallocations.list"]);

        if (alloc) {
          accLedgerName = clean(alloc.ledgername || alloc.ledger_name || alloc.name);
          accLedgerGuid = clean(
            alloc?.ledger_guid ||
              alloc?.ledgerguid ||
              alloc?.ledgerGuid ||
              alloc?.LEDGER_GUID ||
              alloc?.["ledger_guid"],
          );
          accAmount = cleanNumber(alloc.amount);
          accDeemedPositive = toBool(alloc.isdeemedpositive || alloc.is_deemed_positive);
        }
        const item = {
          stock_item_name: clean(i.stockitemname) || "",
          quantity: clean(i.qty),
          rate: clean(i.rate),
          amount: cleanNumber(i.amount),
          accounting_ledger_name: accLedgerName,
          accounting_ledger_guid: accLedgerGuid,
          accounting_amount: accAmount,
          accounting_isdeemedpositive: accDeemedPositive,
        };

        // Remove empty fields
        Object.keys(item).forEach((key) => {
          if (
            item[key] === null ||
            item[key] === undefined ||
            item[key] === ""
          ) {
            delete item[key];
          }
        });

        return item;
      } catch (error) {
        console.error("Error normalizing inventory entry:", error);
        return null;
      }
    })
    .filter(Boolean);
};
const normalizeVoucherData = ({
  data,
  company_id,
  voucherTypeNameToId = {},
  ledgerNameToId = {},
  ledgerGuidToId = {},
}) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    console.log(data[0])
    return data
      .filter((v) => v && v.guid)
      .map((v) => {
        try {
          let parsedDate = null;
          if (v.date) {
            parsedDate = parseTallyDate(v.date);
          }

          let referenceDate = null;
          if (v.referencedate) {
            referenceDate = parseTallyDate(v.referencedate);
          }

          const vchtypeName = clean(v.vchtype) || "";
          const resolvedVchTypeId =
            voucherTypeNameToId[vchtypeName] ??
            voucherTypeNameToId[vchtypeName.toLowerCase()] ??
            null;

          const partyGuid = clean(v.partyledgerguid || v.party_ledger_guid || v.partyLedgerGuid) || null;
          const partyName = clean(v.partyledgername) || null;
          const resolvedPartyLedgerId =
            (partyGuid ? (ledgerGuidToId[partyGuid] ?? ledgerGuidToId[partyGuid.toLowerCase()]) : null) ??
            (partyName
              ? (ledgerNameToId[partyName] ??
                 ledgerNameToId[partyName.toLowerCase()] ??
                 null)
              : null);

          const doc = {
            company_id,
            guid: String(v.guid || "").trim(),
            date: parsedDate,
            vchtype: vchtypeName,
            voucher_type_id: resolvedVchTypeId,
            voucher_number: clean(v.vouchernumber) || "",
            master_id: clean(v.masterid) ? Number(v.masterid) : null,
            alter_id: clean(v.alterid) ? Number(v.alterid) : null,
            narration: clean(v.narration) || "",
            is_optional: toBool(v.isoptional),
            is_cancelled: toBool(v.iscancelled),
            party_gstin: clean(v.partygstin) || null,
            party_ledger_id: resolvedPartyLedgerId,
            place_of_supply: clean(v.placeofsupply) || null,
            reference_date: referenceDate,
            reference_number: clean(v.reference) || null,
            last_sync_at: new Date(),
          };

          // Remove fields that do not have data
          Object.keys(doc).forEach((key) => {
            if (
              doc[key] === null ||
              doc[key] === undefined ||
              doc[key] === "" ||
              doc[key] === "Not Applicable" ||
              doc[key] === "&#4; Not Applicable"
            ) {
              delete doc[key];
            }
          });

          return {
            updateOne: {
              filter: { company_id, guid: doc.guid },
              update: {
                $set: doc,
              },
              upsert: true,
            },
          };
        } catch (itemError) {
          console.error("Error normalizing individual voucher:", itemError, v);
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    console.error("normalizeVoucherData error:", error);
    throw error;
  }
};
const saveVoucherToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];

    if (!company) {
      throw new Error("Company not found");
    }

    const company_id = company._id;

    // Fetch all voucher types for this company to resolve voucher_type_id from vchtype
    const voucherTypeDocs = await VoucherType.find(
      { company_id, is_deleted: { $ne: true } },
      { _id: 1, name: 1 },
    ).lean();

    const voucherTypeNameToId = {};
    for (const vt of voucherTypeDocs) {
      if (vt.name) {
        voucherTypeNameToId[vt.name.trim().toLowerCase()] = vt._id;
        voucherTypeNameToId[vt.name.trim()] = vt._id;
      }
    }

    // Build ledger name→_id and guid→_id maps from the DB for all ledgers (party + entries) in this batch
    const allLedgerNames = new Set();
    const allLedgerGuids = new Set();

    for (const v of data) {
      const partyName = clean(v?.partyledgername);
      if (partyName) allLedgerNames.add(partyName);

      const partyGuid = clean(v?.partyledgerguid || v?.party_ledger_guid || v?.partyLedgerGuid);
      if (partyGuid) allLedgerGuids.add(partyGuid);

      const rawEntries = toArray(
        v?.ledgerentries ||
          v?.allledgerentries ||
          v?.["allledgerentries.list"] ||
          v?.["ledgerentries.list"],
      );
      for (const l of rawEntries) {
        const rawName = clean(l?.ledgername || l?.name || l?.ledger_name);
        if (rawName) allLedgerNames.add(rawName);

        const rawGuid = clean(
          l?.ledger_guid ||
            l?.ledgerguid ||
            l?.ledgerGuid ||
            l?.LEDGER_GUID ||
            l?.["ledger_guid"],
        );
        if (rawGuid) allLedgerGuids.add(rawGuid);
      }

      const rawInventory = toArray(
        v?.inventoryentries ||
          v?.allinventoryentries ||
          v?.["allinventoryentries.list"] ||
          v?.["inventoryentries.list"],
      );
      for (const inv of rawInventory) {
        const alloc = Array.isArray(inv?.accountingallocations)
          ? inv?.accountingallocations[0]
          : inv?.accountingallocations ||
            (Array.isArray(inv?.["accountingallocations.list"])
              ? inv?.["accountingallocations.list"][0]
              : inv?.["accountingallocations.list"]);
        const accLedger = clean(
          alloc?.ledgername || alloc?.ledger_name || alloc?.name,
        );
        if (accLedger) allLedgerNames.add(accLedger);

        const accGuid = clean(
          alloc?.ledger_guid ||
            alloc?.ledgerguid ||
            alloc?.ledgerGuid ||
            alloc?.LEDGER_GUID ||
            alloc?.["ledger_guid"],
        );
        if (accGuid) allLedgerGuids.add(accGuid);
      }
    }

    const ledgerNameToId = {};
    const ledgerGuidToId = {};
    const ledgerIdToGuid = {};

    // 1. Resolve ledgers by GUID (fast & exact)
    if (allLedgerGuids.size > 0) {
      const guidList = [...allLedgerGuids];
      const ledgerDocsByGuid = await Ledger.find(
        {
          company_id,
          guid: { $in: guidList },
          is_deleted: { $ne: true },
        },
        { _id: 1, name: 1, guid: 1 },
      ).lean();

      for (const ld of ledgerDocsByGuid) {
        if (ld.guid) {
          const g = ld.guid.trim();
          ledgerGuidToId[g] = ld._id;
          ledgerGuidToId[g.toLowerCase()] = ld._id;
        }
        if (ld._id && ld.guid) {
          ledgerIdToGuid[String(ld._id)] = ld.guid.trim();
        }
        if (ld.name) {
          ledgerNameToId[ld.name.trim().toLowerCase()] = ld._id;
          ledgerNameToId[ld.name] = ld._id;
        }
      }
    }

    // 2. Resolve ledgers by name (fallback or for party ledgers)
    if (allLedgerNames.size > 0) {
      const nameList = [...allLedgerNames];
      const ledgerDocs = await Ledger.find(
        {
          company_id,
          name: {
            $in: nameList.map(
              (n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
            ),
          },
        },
        { _id: 1, name: 1, guid: 1 },
      ).lean();

      for (const ld of ledgerDocs) {
        if (ld.name) {
          ledgerNameToId[ld.name.trim().toLowerCase()] = ld._id;
          ledgerNameToId[ld.name] = ld._id;
        }
        if (ld.guid) {
          const g = ld.guid.trim();
          ledgerGuidToId[g] = ld._id;
          ledgerGuidToId[g.toLowerCase()] = ld._id;
        }
        if (ld._id && ld.guid) {
          ledgerIdToGuid[String(ld._id)] = ld.guid.trim();
        }
      }
    }

    const bulkOps = normalizeVoucherData({
      data,
      company_id,
      voucherTypeNameToId,
      ledgerNameToId,
      ledgerGuidToId,
    });
    if (bulkOps.length === 0) return [];

    const result = await Voucher.bulkWrite(bulkOps, {
      ordered: false,
    });

    // Build a guid→_id map so we can link entries to their vouchers
    const guids = data
      .filter((v) => v && v.guid)
      .map((v) => String(v.guid).trim());

    const voucherDocs = await Voucher.find(
      { company_id, guid: { $in: guids } },
      { _id: 1, guid: 1 },
    ).lean();

    const guidToId = {};
    for (const vd of voucherDocs) {
      guidToId[vd.guid] = vd._id;
    }

    // Collect entries per voucher
    const ledgerEntriesToInsert = [];
    const inventoryEntriesToInsert = [];
    const voucherIdsWithEntries = [];

    for (const v of data) {
      if (!v || !v.guid) continue;
      const voucher_id = guidToId[String(v.guid).trim()];
      if (!voucher_id) continue;

      voucherIdsWithEntries.push(voucher_id);

      const rawLedgerEntries =
        v.ledgerentries ||
        v.allledgerentries ||
        v["allledgerentries.list"] ||
        v["ledgerentries.list"];
      const ledgerEntries = normalizeLedgerEnteries(rawLedgerEntries);

      for (const entry of ledgerEntries) {
        const lookupKey = entry._ledger_name
          ? entry._ledger_name.trim().toLowerCase()
          : "";

        // Priority 1: Map ledger_id via entry.ledger_guid / entry.ledgerGuid
        const guidKey = entry.ledger_guid ? String(entry.ledger_guid).trim() : null;
        const ledger_id =
          (guidKey
            ? (ledgerGuidToId[guidKey] ?? ledgerGuidToId[guidKey.toLowerCase()])
            : null) ||
          ledgerNameToId[lookupKey] ||
          ledgerNameToId[entry._ledger_name] ||
          null;

        // Save ledger_guid (from incoming entry or resolved from matched ledger)
        const savedLedgerGuid =
          guidKey ||
          (ledger_id ? ledgerIdToGuid[String(ledger_id)] : null) ||
          null;

        const { _ledger_name, ...entryData } = entry;
        ledgerEntriesToInsert.push({
          ...entryData,
          voucher_id,
          company_id,
          ledger_id,
          ledger_guid: savedLedgerGuid,
        });
      }

      const rawInventoryEntries =
        v.inventoryentries ||
        v.allinventoryentries ||
        v["allinventoryentries.list"] ||
        v["inventoryentries.list"];
      const inventoryEntries = normalizeInventoryEnteries(rawInventoryEntries);
      for (const entry of inventoryEntries) {
        const lookupKey = entry.accounting_ledger_name
          ? entry.accounting_ledger_name.trim().toLowerCase()
          : "";
        const allocGuidKey = entry.accounting_ledger_guid
          ? String(entry.accounting_ledger_guid).trim()
          : null;
        const accounting_ledger_id =
          (allocGuidKey
            ? (ledgerGuidToId[allocGuidKey] ?? ledgerGuidToId[allocGuidKey.toLowerCase()])
            : null) ||
          ledgerNameToId[lookupKey] ||
          ledgerNameToId[entry.accounting_ledger_name] ||
          null;

        const { accounting_ledger_guid, ...cleanEntry } = entry;
        const entryDoc = {
          ...cleanEntry,
          voucher_id,
          company_id,
        };
        if (accounting_ledger_id) {
          entryDoc.accounting_ledger_id = accounting_ledger_id;
        }

        inventoryEntriesToInsert.push(entryDoc);
      }
    }

    if (voucherIdsWithEntries.length > 0) {
      // Delete existing entries for these vouchers before re-inserting
      await Promise.all([
        LedgerEntry.deleteMany({ voucher_id: { $in: voucherIdsWithEntries } }),
        InventoryEntry.deleteMany({ voucher_id: { $in: voucherIdsWithEntries } }),
      ]);

      // Insert fresh entries
      const insertOps = [];
      if (ledgerEntriesToInsert.length > 0) {
        insertOps.push(LedgerEntry.insertMany(ledgerEntriesToInsert, { ordered: false }));
      }
      if (inventoryEntriesToInsert.length > 0) {
        insertOps.push(InventoryEntry.insertMany(inventoryEntriesToInsert, { ordered: false }));
      }
      if (insertOps.length > 0) await Promise.all(insertOps);
    }

    return result;
  } catch (error) {
    console.error("Error saving voucher to db:", error);
    throw error;
  }
};
const normalizeStockData = ({ data, company_id }) => {
  try {
    const dataList = toArray(data);
    if (!dataList.length) return [];

    return dataList
      .map((item) => {
        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }

        const doc = {
          name: clean(name) || "",
          guid: clean(item?.guid) || "",
          company_id,
          master_id: clean(item?.masterid),
          alter_id: clean(item?.alterid),
          parent: clean(item?.parent),
          category: clean(item?.category),
          gst_applicable: clean(item?.gstapplicable),
          gst_type_of_supply: clean(item?.gsttypeofsupply),
          base_unit: clean(item?.baseunits) || clean(item?.baseunit),
          opening_balance: clean(item?.openingbalance),
          opening_value: cleanNumber(item?.openingvalue),
          opening_quantity: null,
          opening_rate: clean(item?.openingrate),
        };

        // Remove fields that do not have data
        Object.keys(doc).forEach((key) => {
          if (
            doc[key] === null ||
            doc[key] === undefined ||
            doc[key] === "" ||
            doc[key] === "Not Applicable" ||
            doc[key] === "&#4; Not Applicable"
          ) {
            delete doc[key];
          }
        });
        return doc;
      })
      .filter((item) => item.guid);
  } catch (error) {
    console.error("normalizeStockData error:", error);
    return [];
  }
};
const saveStockToDb = async ({ data, company }) => {
  try {
    const dataList = toArray(data);
    if (dataList.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeStockData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          guid: item.guid,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await StockItem.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving stock to db:", error);
    throw error;
  }
};
const normalizeBillsData = ({ data, company_id }) => {
  try {
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => {
        let bDate = null;
        if (item?.billdate) {
          bDate = parseTallyDate(item.billdate);
        }

        let cDate = null;
        if (item?.clearedon) {
          cDate = parseTallyDate(item.clearedon);
        }

        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }

        const doc = {
          company_id,
          name: clean(name) || "",
          bill_date: bDate,
          cleared_on: cDate,
          parent: clean(item?.parent) || "",
          is_advance: toBool(item?.isadvance),
          is_tds_refundable: toBool(item?.istdsref),
          bill_id: clean(item?.billid) || "",
          closing_balance: cleanNumber(item?.closingbalance),
          opening_balance: cleanNumber(item?.openingbalance),
          base_closing_balance: cleanNumber(item?.baseclosing),
          final_balance: cleanNumber(item?.finalbalance),
        };

        Object.keys(doc).forEach((key) => {
          if (
            doc[key] === null ||
            doc[key] === undefined ||
            doc[key] === "" ||
            doc[key] === "Not Applicable" ||
            doc[key] === "&#4; Not Applicable"
          ) {
            delete doc[key];
          }
        });
        return doc;
      })
      .filter((item) => item.bill_id);
  } catch (error) {
    console.error("normalizeBillsData error:", error);
    return [];
  }
};
const saveBillsToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeBillsData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          bill_id: item.bill_id,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await CompanyBills.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving bills to db:", error);
    throw error;
  }
};
const normalizeStockGroupData = ({ data, company_id }) => {
  try {
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => {
        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }

        const doc = {
          company_id,
          name: clean(name) || "",
          guid: clean(item?.guid) || "",
          parent: clean(item?.parent) || null,
          is_addable: toBool(item?.isaddable),
          alter_id: clean(item?.alterid) ? Number(clean(item?.alterid)) : null,
          master_id: clean(item?.masterid)
            ? Number(clean(item?.masterid))
            : null,
        };

        Object.keys(doc).forEach((key) => {
          if (
            doc[key] === null ||
            doc[key] === undefined ||
            doc[key] === "" ||
            doc[key] === "Not Applicable" ||
            doc[key] === "&#4; Not Applicable"
          ) {
            delete doc[key];
          }
        });
        return doc;
      })
      .filter((item) => item.guid);
  } catch (error) {
    console.error("normalizeStockGroupData error:", error);
    return [];
  }
};
const saveStockGroupToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeStockGroupData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          guid: item.guid,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await StockGroup.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving stock groups to db:", error);
    throw error;
  }
};
const normalizeGodownData = ({ data, company_id }) => {
  try {
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => {
        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }

        const doc = {
          company_id,
          name: clean(name) || "",
          guid: clean(item?.guid) || "",
          parent: clean(item?.parent) || null,
          has_no_space: toBool(item?.hasnospace),
          alter_id: clean(item?.alterid) ? Number(clean(item?.alterid)) : null,
          master_id: clean(item?.masterid)
            ? Number(clean(item?.masterid))
            : null,
        };

        Object.keys(doc).forEach((key) => {
          if (
            doc[key] === null ||
            doc[key] === undefined ||
            doc[key] === "" ||
            doc[key] === "Not Applicable" ||
            doc[key] === "&#4; Not Applicable"
          ) {
            delete doc[key];
          }
        });
        return doc;
      })
      .filter((item) => item.guid);
  } catch (error) {
    console.error("normalizeGodownData error:", error);
    return [];
  }
};
const saveGodownToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeGodownData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          guid: item.guid,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await Godown.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving godowns to db:", error);
    throw error;
  }
};
const normalizeUnitData = ({ data, company_id }) => {
  try {
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => {
        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }

        const doc = {
          company_id,
          name: clean(name) || "",
          guid: clean(item?.guid) || "",
          original_name: clean(item?.originalname) || null,
          is_simple_unit: toBool(item?.issimpleunit),
          alter_id: clean(item?.alterid) ? Number(clean(item?.alterid)) : null,
          master_id: clean(item?.masterid)
            ? Number(clean(item?.masterid))
            : null,
          conversion: clean(item?.conversion)
            ? Number(clean(item?.conversion))
            : 0,
          decimal_places: clean(item?.decimalplaces)
            ? Number(clean(item?.decimalplaces))
            : 0,
        };

        Object.keys(doc).forEach((key) => {
          if (
            doc[key] === null ||
            doc[key] === undefined ||
            doc[key] === "" ||
            doc[key] === "Not Applicable" ||
            doc[key] === "&#4; Not Applicable"
          ) {
            delete doc[key];
          }
        });
        return doc;
      })
      .filter((item) => item.guid);
  } catch (error) {
    console.error("normalizeUnitData error:", error);
    return [];
  }
};
const saveUnitToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeUnitData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          guid: item.guid,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await Unit.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving units to db:", error);
    throw error;
  }
};
const normalizeCostCenterData = ({ data, company_id }) => {
  try {
    const dataList = toArray(data);
    if (!dataList.length) return [];

    return dataList
      .map((item) => {
        let name = item?.name;
        if (Array.isArray(name)) {
          name = name[0];
        }

        const doc = {
          company_id,
          name: clean(name) || "",
          guid: clean(item?.guid) || "",
          parent: clean(item?.parent) || null,
          category: clean(item?.category) || null,
          alter_id: clean(item?.alterid) ? Number(clean(item?.alterid)) : null,
          master_id: clean(item?.masterid)
            ? Number(clean(item?.masterid))
            : null,
        };

        Object.keys(doc).forEach((key) => {
          if (
            doc[key] === null ||
            doc[key] === undefined ||
            doc[key] === "" ||
            doc[key] === "Not Applicable" ||
            doc[key] === "&#4; Not Applicable"
          ) {
            delete doc[key];
          }
        });
        return doc;
      })
      .filter((item) => item.guid);
  } catch (error) {
    console.error("normalizeCostCenterData error:", error);
    return [];
  }
};
const saveCostCenterToDb = async ({ data, company }) => {
  try {
    const dataList = toArray(data);
    if (dataList.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeCostCenterData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) return [];

    const bulkOps = normalizedData.map((item) => ({
      updateOne: {
        filter: {
          guid: item.guid,
          company_id: item.company_id,
        },
        update: {
          $set: item,
        },
        upsert: true,
      },
    }));

    const result = await CostCenter.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving cost centers to db:", error);
    throw error;
  }
};
const saveSalesRegisterToDb = async ({ data, company }) => {
  try {
    if (!company) {
      throw new Error("Company not found");
    }

    // Upsert the entire data array for the company
    const result = await SalesRegister.findOneAndUpdate(
      { company_id: company._id },
      {
        $set: {
          company_id: company._id,
          data: Array.isArray(data) ? data : [],
        },
      },
      { upsert: true, new: true },
    );
    return result;
  } catch (error) {
    console.error("Error saving sales register to db:", error);
    throw error;
  }
};
const savePurchaseRegisterToDb = async ({ data, company }) => {
  try {
    if (!company) {
      throw new Error("Company not found");
    }

    // Upsert the entire data array for the company
    const result = await PurchaseRegister.findOneAndUpdate(
      { company_id: company._id },
      {
        $set: {
          company_id: company._id,
          data: Array.isArray(data) ? data : [],
        },
      },
      { upsert: true, new: true },
    );
    return result;
  } catch (error) {
    console.error("Error saving purchase register to db:", error);
    throw error;
  }
};
const saveSalesAccountToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const bulkOps = data
      .filter((item) => item.accountName)
      .map((item) => {
        let pFrom = null;
        if (item.period_from) {
          pFrom = parseTallyDate(item.period_from);
        }

        let pTo = null;
        if (item.period_to) {
          pTo = parseTallyDate(item.period_to);
        }

        return {
          updateOne: {
            filter: {
              accountName: item.accountName,
              company_id: company._id,
              period_from: pFrom,
              period_to: pTo,
            },
            update: {
              $set: {
                company_id: company._id,
                accountName: item.accountName,
                closingDebitAmount: Number(item.closingDebitAmount) || 0,
                closingCreditAmount: Number(item.closingCreditAmount) || 0,
                period_from: pFrom,
                period_to: pTo,
              },
            },
            upsert: true,
          },
        };
      });

    if (!bulkOps.length) return [];

    const result = await SalesAccount.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving sales account to db:", error);
    throw error;
  }
};
const savePurchaseAccountToDb = async ({ data, company }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const bulkOps = data
      .filter((item) => item.accountName)
      .map((item) => {
        let pFrom = null;
        if (item.period_from) {
          pFrom = parseTallyDate(item.period_from);
        }

        let pTo = null;
        if (item.period_to) {
          pTo = parseTallyDate(item.period_to);
        }

        return {
          updateOne: {
            filter: {
              accountName: item.accountName,
              company_id: company._id,
              period_from: pFrom,
              period_to: pTo,
            },
            update: {
              $set: {
                company_id: company._id,
                accountName: item.accountName,
                closingDebitAmount: Number(item.closingDebitAmount) || 0,
                closingCreditAmount: Number(item.closingCreditAmount) || 0,
                period_from: pFrom,
                period_to: pTo,
              },
            },
            upsert: true,
          },
        };
      });

    if (!bulkOps.length) return [];

    const result = await PurchaseAccount.bulkWrite(bulkOps, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving purchase account to db:", error);
    throw error;
  }
};
const saveTrialBalanceToDb = async ({ data, company, timeline }) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (!company) {
      throw new Error("Company not found");
    }

    const effectiveTimeline = timeline  || "all";
    const allDocs = [];
    const distinctPeriods = [];
    const seenPeriods = new Set();

    for (const periodEntry of data) {
      let pFrom = null;
      if (periodEntry.period_from) {
        pFrom = parseTallyDate(periodEntry.period_from);
      }
      let pTo = null;
      if (periodEntry.period_to) {
        pTo = parseTallyDate(periodEntry.period_to);
      }

      const periodKey = `${pFrom ? pFrom.getTime() : "null"}_${pTo ? pTo.getTime() : "null"}`;
      if (!seenPeriods.has(periodKey)) {
        seenPeriods.add(periodKey);
        distinctPeriods.push({ period_from: pFrom, period_to: pTo });
      }

      const rawInner = periodEntry.data;
      let groups = [];
      const innerData = rawInner?.data;
      if (innerData?.dspaccbody?.dspaccline) {
        const lines = innerData.dspaccbody.dspaccline;
        groups = Array.isArray(lines) ? lines : [lines];
      } else if (Array.isArray(innerData)) {
        groups = innerData;
      } else if (innerData?.dspaccname) {
        groups = [innerData];
      }
      for (const item of groups) {
        if (
          !item?.dspaccname?.dspdispname ||
          item.dspaccname.dspdispname.trim() === ""
        )
          continue;

        const groupName = item.dspaccname.dspdispname.trim();

        // Parse group-level amounts from dspaccinfo
        let closingDebitAmount = 0;
        let closingCreditAmount = 0;
        const infoArr = Array.isArray(item.dspaccinfo)
          ? item.dspaccinfo
          : item.dspaccinfo
            ? [item.dspaccinfo]
            : [];
        for (const info of infoArr) {
          if (info.dspcldramt?.dspcldramta) {
            closingDebitAmount += Number(info.dspcldramt.dspcldramta) || 0;
          }
          if (info.dspclcramt?.dspclcramta) {
            closingCreditAmount += Number(info.dspclcramt.dspclcramta) || 0;
          }
        }

        // Parse child account lines from grpexplosion
        const accounts = [];
        const lines = item.grpexplosion?.dspaccline;
        if (lines) {
          const lineArr = Array.isArray(lines) ? lines : [lines];
          for (const line of lineArr) {
            if (!line?.dspaccname?.dspdispname) continue;
            let childDebit = 0;
            let childCredit = 0;
            const childInfoArr = Array.isArray(line.dspaccinfo)
              ? line.dspaccinfo
              : line.dspaccinfo
                ? [line.dspaccinfo]
                : [];
            for (const ci of childInfoArr) {
              if (ci.dspcldramt?.dspcldramta) {
                childDebit += Number(ci.dspcldramt.dspcldramta) || 0;
              }
              if (ci.dspclcramt?.dspclcramta) {
                childCredit += Number(ci.dspclcramt.dspclcramta) || 0;
              }
            }
            accounts.push({
              accountName: line.dspaccname.dspdispname.trim(),
              closingDebitAmount: childDebit,
              closingCreditAmount: childCredit,
            });
          }
        }

        allDocs.push({
          company_id: company._id,
          groupName,
          closingDebitAmount,
          closingCreditAmount,
          accounts,
          period_from: pFrom,
          period_to: pTo,
          timeline: effectiveTimeline,
        });
      }
    }

    if (!allDocs.length) return [];

    // Delete existing documents based on timeline
    if (effectiveTimeline === "all") {
      // Replace all trial balance data for this company with timeline "all"
      await TrialBalance.deleteMany({
        company_id: company._id,
        timeline: "all",
      });
    } else {
      // For "year", delete existing docs matching company_id, timeline "year", and each matching period
      for (const period of distinctPeriods) {
        await TrialBalance.deleteMany({
          company_id: company._id,
          timeline: "year",
          period_from: period.period_from,
          period_to: period.period_to,
        });
      }
    }

    const result = await TrialBalance.insertMany(allDocs, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving trial balance to db:", error);
    throw error;
  }
};
const normalizeReceivablesData = ({ data, company_id }) => {
  try {
    const rawItems = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : [];

    if (!rawItems.length) return [];

    return rawItems
      .map((item) => {
        let bDate = null;
        const rawBillDate = item?.billDate || item?.bill_date || item?.billdate;
        if (rawBillDate) {
          bDate = parseTallyDate(rawBillDate);
        }

        let bDue = null;
        const rawBillDue = item?.billDue || item?.bill_due || item?.billdue;
        if (rawBillDue) {
          bDue = parseTallyDate(rawBillDue);
        }

        const partyName =
          clean(item?.partyName || item?.party_name || item?.partyname) || "";
        const billRef =
          clean(item?.billRef || item?.bill_ref || item?.billref) || "";
        const closingAmount = cleanNumber(
          item?.closingAmount ?? item?.closing_amount ?? item?.closingamount,
        );
        const overdueDays = cleanNumber(
          item?.overdueDays ?? item?.overdue_days ?? item?.overduedays,
        );

        const doc = {
          company_id,
          party_name: partyName,
          bill_ref: billRef,
          bill_date: bDate,
          bill_due: bDue,
          closing_amount: closingAmount,
          overdue_days: overdueDays,
          last_sync_at: new Date(),
        };

        return doc;
      })
      .filter((item) => item.party_name && (item.bill_ref || item.bill_date));
  } catch (error) {
    console.error("normalizeReceivablesData error:", error);
    return [];
  }
};
const saveReceivablesToDb = async ({ data, company }) => {
  try {
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizeReceivablesData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) {
      await Receivable.deleteMany({ company_id: company._id });
      return [];
    }

    await Receivable.deleteMany({ company_id: company._id });
    const result = await Receivable.insertMany(normalizedData, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving receivables to db:", error);
    throw error;
  }
};
const normalizePayablesData = ({ data, company_id }) => {
  try {
    const rawItems = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : [];

    if (!rawItems.length) return [];

    return rawItems
      .map((item) => {
        let bDate = null;
        const rawBillDate = item?.billDate || item?.bill_date || item?.billdate;
        if (rawBillDate) {
          bDate = parseTallyDate(rawBillDate);
        }

        let bDue = null;
        const rawBillDue = item?.billDue || item?.bill_due || item?.billdue;
        if (rawBillDue) {
          bDue = parseTallyDate(rawBillDue);
        }

        const partyName =
          clean(item?.partyName || item?.party_name || item?.partyname) || "";
        const billRef =
          clean(item?.billRef || item?.bill_ref || item?.billref) || "";
        const closingAmount = cleanNumber(
          item?.closingAmount ?? item?.closing_amount ?? item?.closingamount,
        );
        const overdueDays = cleanNumber(
          item?.overdueDays ?? item?.overdue_days ?? item?.overduedays,
        );

        const doc = {
          company_id,
          party_name: partyName,
          bill_ref: billRef,
          bill_date: bDate,
          bill_due: bDue,
          closing_amount: closingAmount,
          overdue_days: overdueDays,
          last_sync_at: new Date(),
        };

        return doc;
      })
      .filter((item) => item.party_name && (item.bill_ref || item.bill_date));
  } catch (error) {
    console.error("normalizePayablesData error:", error);
    return [];
  }
};
const savePayablesToDb = async ({ data, company }) => {
  try {
    if (!company) {
      throw new Error("Company not found");
    }

    const normalizedData = normalizePayablesData({
      data,
      company_id: company._id,
    });
    if (!normalizedData.length) {
      await Payable.deleteMany({ company_id: company._id });
      return [];
    }

    await Payable.deleteMany({ company_id: company._id });
    const result = await Payable.insertMany(normalizedData, {
      ordered: false,
    });
    return result;
  } catch (error) {
    console.error("Error saving payables to db:", error);
    throw error;
  }
};
const methodHandlerHelper = {
  company: async (args) => await saveCompanyToDb(args),
  group: async (args) => await saveGroupToDb(args),
  ledger: async (args) => await saveLedgerToDb(args),
  voucher_type: async (args) => await saveVoucherTypeToDb(args),
  voucher: async (args) => await saveVoucherToDb(args),
  stock: async (args) => await saveStockToDb(args),
  bills: async (args) => await saveBillsToDb(args),
  stockgroup: async (args) => await saveStockGroupToDb(args),
  godown: async (args) => await saveGodownToDb(args),
  unit: async (args) => await saveUnitToDb(args),
  costcenter: async (args) => await saveCostCenterToDb(args),
  sales_register: async (args) => await saveSalesRegisterToDb(args),
  purchase_register: async (args) => await savePurchaseRegisterToDb(args),
  sales_account: async (args) => await saveSalesAccountToDb(args),
  purchase_account: async (args) => await savePurchaseAccountToDb(args),
  trial_balance: async (args) => await saveTrialBalanceToDb(args),
  receivables: async (args) => await saveReceivablesToDb(args),
  receivable: async (args) => await saveReceivablesToDb(args),
  payables: async (args) => await savePayablesToDb(args),
  payable: async (args) => await savePayablesToDb(args),
};
const saveToDbController = async (req, res, next) => {
  try {
    const { type } = req.headers;
    const { data, company_id, from, to, timeline } = req.body;
    if (!type) {
      throw ApiError.badRequest("type header is required");
    }
    const methodHandler = methodHandlerHelper[type];
    if (!methodHandler) {
      throw ApiError.badRequest("Invalid method handler");
    }
    if (!company_id || !mongoose.Types.ObjectId.isValid(company_id)) {
      throw ApiError.badRequest("Valid company_id is required");
    }
    const company = await Company.findById(company_id);
    if (!company) {
      throw ApiError.notFound("Company not found");
    }
    await methodHandler({
      data,
      company,
      from,
      to,
      timeline,
      req,
    });
    return ok(res, null, "Data synced successfully");
  } catch (error) {
    if (error.message?.includes("timeout") || error.code === "ETIMEDOUT") {
      return next(
        new ApiError(
          504,
          "Request timeout - Data sync took too long. Please try again with smaller batches.",
          "TIMEOUT_ERROR",
        ),
      );
    }
    next(error);
  }
};

export default saveToDbController;
