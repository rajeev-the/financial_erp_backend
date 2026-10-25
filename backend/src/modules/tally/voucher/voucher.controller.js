import Voucher from "./voucher.schema.js";
import VoucherType from "./voucherType.schema.js";
import LedgerEntry from "./ledgerentry.schema.js";
import InventoryEntry from "./inventoryentry.schema.js";
import UnifiedVoucher from "../../erp/voucher/voucher.unified.schema.js";
import mongoose from "mongoose";
import { ApiError } from "../../../utils/api-error.js";
import { ok } from "../../../utils/response.js";
import fieldExclusions from "../../common/fieldExclusions.js";
import Ledger from "../ledger/ledger.schema.js";
import Group from "../group/group.schema.js";
import { escapeRegex } from "../../../utils/escape-regex.js";
const getVoucherByLedgerName = async (req, res, next) => {
  try {
    const { ledger_name } = req.params;
    const { company_id, page = 1, limit = 50, from_date, to_date } = req.query;

    if (!ledger_name || !company_id) {
      throw ApiError.badRequest("ledger_name and company_id are required");
    }

    if (!mongoose.Types.ObjectId.isValid(company_id)) {
      throw ApiError.badRequest("Invalid company_id");
    }

    const compId = new mongoose.Types.ObjectId(company_id);

    // Resolve ledger_name or optional ledger_id to ledger _id
    let ledgerDoc = null;
    const queryLedgerId = req.query.ledger_id || req.query.ledgerId;
    if (queryLedgerId && mongoose.Types.ObjectId.isValid(queryLedgerId)) {
      ledgerDoc = await Ledger.findOne(
        { _id: new mongoose.Types.ObjectId(queryLedgerId), company_id: compId },
        { _id: 1, name: 1, parent: 1, classification: 1 },
      ).lean();
    }
    if (!ledgerDoc) {
      ledgerDoc = await Ledger.findOne(
        { name: ledger_name, company_id: compId },
        { _id: 1, name: 1, parent: 1, classification: 1 },
      ).lean();
    }

    if (!ledgerDoc) {
      return ok(
        res,
        { ledger_name, total_count: 0, vouchers: [] },
        "No ledger found with this name",
      );
    }

    const ledgerId = ledgerDoc._id;

    // Find all voucher_ids that have a ledger entry matching this ledger
    const matchingEntries = await LedgerEntry.find(
      { ledger_id: ledgerId, company_id: compId },
      { voucher_id: 1 },
    ).lean();

    const matchingVoucherIds = [
      ...new Set(matchingEntries.map((e) => String(e.voucher_id))),
    ];

    const voucherFilter = {
      _id: {
        $in: matchingVoucherIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
      is_deleted: false,
      company_id: compId,
    };

    if (from_date || to_date) {
      voucherFilter.date = {};
      if (from_date) {
        voucherFilter.date.$gte = new Date(from_date);
      }
      if (to_date) {
        const end = new Date(to_date);
        end.setHours(23, 59, 59, 999);
        voucherFilter.date.$lte = end;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [vouchers, total_count] = await Promise.all([
      Voucher.find(voucherFilter)
        .populate("party_ledger_id", "name")
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Voucher.countDocuments(voucherFilter),
    ]);

    // Collect unique vchtype names and look up parents in bulk
    const voucher_type_names = [...new Set(vouchers.map((v) => v.vchtype))];

    const voucher_type_docs = await VoucherType.find({
      name: { $in: voucher_type_names },
      company_id: compId,
      is_deleted: false,
    })
      .select("_id name parent")
      .lean();

    const voucher_type_map = {};
    const voucher_type_id_map = {};
    for (const vt of voucher_type_docs) {
      voucher_type_map[vt.name] = vt.parent || vt.name;
      voucher_type_id_map[vt.name] = vt._id;
    }

    // Fetch all ledger entries and inventory entries for these vouchers in bulk
    const voucherObjectIds = vouchers.map((v) => v._id);
    const [allLedgerEntries, allInventoryEntries] = await Promise.all([
      LedgerEntry.find({ voucher_id: { $in: voucherObjectIds } }).lean(),
      InventoryEntry.find({ voucher_id: { $in: voucherObjectIds } }).lean(),
    ]);

    // Group entries by voucher_id
    const ledgerEntriesByVoucher = {};
    for (const entry of allLedgerEntries) {
      const key = String(entry.voucher_id);
      if (!ledgerEntriesByVoucher[key]) ledgerEntriesByVoucher[key] = [];
      ledgerEntriesByVoucher[key].push(entry);
    }
    const inventoryEntriesByVoucher = {};
    for (const entry of allInventoryEntries) {
      const key = String(entry.voucher_id);
      if (!inventoryEntriesByVoucher[key]) inventoryEntriesByVoucher[key] = [];
      inventoryEntriesByVoucher[key].push(entry);
    }

    let overall_dr_amount = 0;
    let overall_cr_amount = 0;
    let overall_dr_ledger_amount = 0;
    let overall_cr_ledger_amount = 0;
    let overall_dr_stock_item_amount = 0;
    let overall_cr_stock_item_amount = 0;

    // Transform each voucher into the required shape
    const result = vouchers.map((v) => {
      const vId = String(v._id);
      const ledgerEntries = ledgerEntriesByVoucher[vId] || [];
      const inventoryEntries = inventoryEntriesByVoucher[vId] || [];

      // Sum amounts of all ledger entries EXCEPT the given ledger
      const other_entries_total = ledgerEntries
        .filter((entry) => String(entry.ledger_id) !== String(ledgerId))
        .reduce((sum, entry) => sum + (entry.amount || 0), 0);

      // Positive total = debit, negative = credit
      const dr_ledger_amount =
        other_entries_total > 0 ? other_entries_total : 0;
      const cr_ledger_amount =
        other_entries_total < 0 ? Math.abs(other_entries_total) : 0;

      // Extract inventory entries amount if present
      const filteredInventoryEntries = inventoryEntries.filter(
        (entry) =>
          entry && (entry.stock_item_name || entry.amount !== undefined),
      );

      const stock_raw_amount =
        filteredInventoryEntries.length > 0
          ? filteredInventoryEntries.reduce(
              (sum, e) => sum + (e.amount || 0),
              0,
            )
          : 0;

      const dr_stock_item_amount = stock_raw_amount > 0 ? stock_raw_amount : 0;
      const cr_stock_item_amount =
        stock_raw_amount < 0 ? Math.abs(stock_raw_amount) : 0;

      const voucher_total_dr = dr_ledger_amount + dr_stock_item_amount;
      const voucher_total_cr = cr_ledger_amount + cr_stock_item_amount;

      overall_dr_ledger_amount += dr_ledger_amount;
      overall_cr_ledger_amount += cr_ledger_amount;
      overall_dr_stock_item_amount += dr_stock_item_amount;
      overall_cr_stock_item_amount += cr_stock_item_amount;
      overall_dr_amount += voucher_total_dr;
      overall_cr_amount += voucher_total_cr;

      return {
        _id: v._id,
        date: v.date,
        parent: voucher_type_map[v.vchtype],
        vchtype: v.vchtype,
        voucher_type_id: v.voucher_type_id || voucher_type_id_map[v.vchtype] || null,
        party_ledger_id: v.party_ledger_id?._id || v.party_ledger_id || null,
        party_ledger_name: v.party_ledger_id?.name || null,
        voucher_no: v.voucher_number || null,
        dr_ledger_amount,
        cr_ledger_amount,
        dr_stock_item_amount,
        cr_stock_item_amount,
        total_dr_amount: voucher_total_dr,
        total_cr_amount: voucher_total_cr,
      };
    });

    const total_amount =
      Math.round((overall_dr_amount + overall_cr_amount) * 100) / 100;

    const classification = `${ledgerDoc.classification || ""} ${ledgerDoc.parent || ""}`.toLowerCase();
    let total_net_amount = 0;
    if (
      classification.includes("expense") ||
      classification.includes("asset") ||
      classification.includes("bank")
    ) {
      total_net_amount = overall_dr_amount - overall_cr_amount;
    } else if (
      classification.includes("liability") ||
      classification.includes("income") ||
      classification.includes("payable")
    ) {
      total_net_amount = overall_cr_amount - overall_dr_amount;
    } else {
      total_net_amount = Math.abs(overall_dr_amount - overall_cr_amount);
    }
    total_net_amount = Math.round(total_net_amount * 100) / 100;
    const total_gross_amount =
      Math.round((overall_dr_amount > 0 ? overall_dr_amount : overall_cr_amount) * 100) / 100;

    return ok(
      res,
      {
        ledger_name: ledgerDoc.name || ledger_name,
        ledger_id: ledgerDoc._id,
        classification: ledgerDoc.classification || null,
        parent: ledgerDoc.parent || null,
        total_count,
        total_amount,
        total_gross_amount,
        total_net_amount,
        total_dr_amount: Math.round(overall_dr_amount * 100) / 100,
        total_cr_amount: Math.round(overall_cr_amount * 100) / 100,
        total_dr_ledger_amount:
          Math.round(overall_dr_ledger_amount * 100) / 100,
        total_cr_ledger_amount:
          Math.round(overall_cr_ledger_amount * 100) / 100,
        total_dr_stock_item_amount:
          Math.round(overall_dr_stock_item_amount * 100) / 100,
        total_cr_stock_item_amount:
          Math.round(overall_cr_stock_item_amount * 100) / 100,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(total_count / Number(limit)) || 1,
        vouchers: result,
      },
      "Vouchers by ledger retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};
const classifyTaxType = (entry) => {
  const name = (entry?.ledger_name || "").toLowerCase();
  const parent = (entry?.ledger_parent || "").toLowerCase();
  const combined = `${name} ${parent}`;

  if (/\b(cgst)\b/i.test(combined)) return "cgst";
  if (/\b(sgst|utgst)\b/i.test(combined)) return "sgst";
  if (/\b(igst)\b/i.test(combined)) return "igst";
  if (/\b(tds|tax deducted at source)\b/i.test(combined)) return "tds";
  if (/\b(tcs|tax collected at source)\b/i.test(combined)) return "tcs";
  if (/\b(cess)\b/i.test(combined)) return "cess";

  if (
    parent.includes("duties & taxes") ||
    parent.includes("duties and taxes") ||
    parent.includes("tax") ||
    parent.includes("gst") ||
    /\b(tax|duty|duties|vat)\b/i.test(name)
  ) {
    return "other";
  }
  return null;
};

const isGstOrTaxLedger = (entry) => classifyTaxType(entry) !== null;

const getVoucherById = async (req, res, next) => {
  try {
    const { companyId, id } = req.params;

    if (!id) {
      throw ApiError.badRequest("Voucher ID is required");
    }

    const targetLedgerId =
      req.query?.ledger_id ||
      req.query?.party_ledger_id ||
      req.body?.ledger_id ||
      req.body?.party_ledger_id ||
      null;

    const rawLedgerName =
      req.query?.ledger_name ||
      req.query?.party_name ||
      req.query?.party_ledger_name ||
      req.body?.ledger_name ||
      req.body?.party_name;
    const targetLedgerName =
      typeof rawLedgerName === "string" && rawLedgerName.trim()
        ? rawLedgerName.trim().toLowerCase()
        : null;

    let query;
    if (
      mongoose.Types.ObjectId.isValid(id) &&
      mongoose.Types.ObjectId.isValid(companyId)
    ) {
      query = {
        _id: new mongoose.Types.ObjectId(id),
        company_id: new mongoose.Types.ObjectId(companyId),
        is_deleted: false,
      };
    } else {
      throw ApiError.badRequest(
        "A valid company ID and voucher ID are required",
      );
    }

    let voucher = await Voucher.findOne(query)
      .populate("party_ledger_id", "name parent")
      .select(
        "-exchange_rate -is_active -is_approved -is_deleted -is_posted -is_reserved -alter_id -master_id -company_id -__v -created_at -updated_at",
      )
      .lean();

    if (!voucher) {
      // Fallback to UnifiedVoucher (Phase 4 compatibility)
      const uVoucher = await UnifiedVoucher.findOne({
        _id: query._id,
        companyId: query.company_id,
      }).lean();

      if (!uVoucher) {
        throw ApiError.notFound("Voucher not found");
      }

      const formattedVoucher = {
        _id: uVoucher._id,
        vchtype: uVoucher.voucherType,
        voucher_number: uVoucher.voucherNumber,
        date: new Date(uVoucher.date),
        guid: uVoucher.sync?.tallyGuid || String(uVoucher._id),
        party_ledger_id: uVoucher.party?.ledgerId || null,
        party_ledger_name: uVoucher.party?.name || null,
        narration: uVoucher.narration,
        amount: (uVoucher.summary?.grandTotal || 0) / 100,
      };

      const ledgerentries = (uVoucher.entries || []).map((e) => ({
        _id: new mongoose.Types.ObjectId(),
        voucher_id: uVoucher._id,
        ledger_id: e.ledgerId,
        ledger_name: e.name,
        ledger_parent: null,
        amount: (e.debit || e.credit) / 100,
        is_deemed_positive: (e.debit || 0) > 0,
        is_party_ledger: !!e.isPartyLedger,
        bills_allocation: (e.billAllocations || []).map((b) => ({
          name: b.billName,
          bill_type: b.billType,
          amount: b.amount / 100,
        })),
      }));

      const inventoryentries = (uVoucher.items || []).map((item) => ({
        _id: new mongoose.Types.ObjectId(),
        voucher_id: uVoucher._id,
        stock_item_name: item.name,
        quantity: item.qty ? String(item.qty) : null,
        rate: item.rate ? String(item.rate / 100) : null,
        unit_name: item.unit,
        amount: item.total / 100,
        discount_amount: (item.discount || 0) / 100,
        discount_percentage: item.discountPct || 0,
        godown_name: item.godown || null,
        batch_name: item.batch || null,
        expiry_date: item.expiryDate ? new Date(item.expiryDate) : null,
        manufacturing_date: item.mfgDate ? new Date(item.mfgDate) : null,
        hsn_code: item.hsn || null,
        gst_rate: item.taxRate || 0,
      }));

      return ok(
        res,
        {
          ...formattedVoucher,
          ledgerentries,
          inventoryentries,
        },
        "Voucher retrieved successfully",
      );
    }

    const partyLedgerId = voucher.party_ledger_id?._id || voucher.party_ledger_id || null;
    voucher.party_ledger_name = voucher.party_ledger_id?.name || null;
    voucher.party_ledger_id = partyLedgerId;

    // Fetch related entries from their own collections with populated ledger info
    const [rawLedgerEntries, rawInventoryEntries] = await Promise.all([
      LedgerEntry.find({ voucher_id: voucher._id })
        .populate("ledger_id", "name parent")
        .select("-created_at -updated_at -__v -company_id")
        .lean(),
      InventoryEntry.find({ voucher_id: voucher._id })
        .populate("accounting_ledger_id", "name parent")
        .select("-created_at -updated_at -__v -company_id")
        .lean(),
    ]);

    const ledgerentries = rawLedgerEntries.map((le) => {
      const ledgerObj =
        le.ledger_id && typeof le.ledger_id === "object" ? le.ledger_id : null;
      const ledgerId = ledgerObj ? ledgerObj._id : le.ledger_id;
      const isParty = Boolean(
        le.is_party_ledger ||
          (partyLedgerId && String(ledgerId) === String(partyLedgerId)),
      );

      return {
        _id: le._id,
        voucher_id: le.voucher_id,
        ledger_id: ledgerId,
        ledger_name: ledgerObj?.name || le._ledger_name || null,
        ledger_parent: ledgerObj?.parent || null,
        amount: le.amount,
        ledger_guid: le.ledger_guid || null,
        is_deemed_positive: Boolean(le.is_deemed_positive),
        is_party_ledger: isParty,
        bills_allocation: le.bills_allocation || [],
      };
    });

    const inventoryentries = rawInventoryEntries.map((ie) => {
      const accLedgerObj =
        ie.accounting_ledger_id && typeof ie.accounting_ledger_id === "object"
          ? ie.accounting_ledger_id
          : null;

      return {
        _id: ie._id,
        voucher_id: ie.voucher_id,
        stock_item_name: ie.stock_item_name,
        quantity: ie.quantity || null,
        rate: ie.rate || null,
        unit_name: ie.unit_name || null,
        amount: ie.amount,
        discount_amount: ie.discount_amount ?? null,
        discount_percentage: ie.discount_percentage ?? null,
        godown_name: ie.godown_name || null,
        batch_name: ie.batch_name || null,
        expiry_date: ie.expiry_date || null,
        manufacturing_date: ie.manufacturing_date || null,
        hsn_code: ie.hsn_code || null,
        gst_rate: ie.gst_rate ?? null,
        accounting_ledger_id: accLedgerObj
          ? accLedgerObj._id
          : ie.accounting_ledger_id || null,
        accounting_ledger_name:
          accLedgerObj?.name || ie.accounting_ledger_name || null,
        accounting_ledger_parent: accLedgerObj?.parent || null,
        accounting_amount: ie.accounting_amount ?? null,
        accounting_isdeemedpositive: Boolean(ie.accounting_isdeemedpositive),
      };
    });

    // Check if a specific party was requested (or if specificEntry exists in compound vouchers)
    let specificPartyEntry = null;
    if (targetLedgerId || targetLedgerName) {
      specificPartyEntry = ledgerentries.find((e) => {
        if (targetLedgerId && String(e.ledger_id) === String(targetLedgerId)) {
          return true;
        }
        if (
          targetLedgerName &&
          (e.ledger_name || "").trim().toLowerCase() === targetLedgerName
        ) {
          return true;
        }
        return false;
      });
    }

    let gross = 0;
    if (specificPartyEntry) {
      voucher.party_ledger_name = specificPartyEntry.ledger_name;
      voucher.party_ledger_id = specificPartyEntry.ledger_id;
      gross =
        Math.round(Math.abs(Number(specificPartyEntry.amount) || 0) * 100) / 100;
      ledgerentries.forEach((e) => {
        e.is_party_ledger =
          String(e.ledger_id) === String(specificPartyEntry.ledger_id);
      });
    } else {
      const partyEntry = ledgerentries.find((e) => e.is_party_ledger);
      if (voucher.amount && voucher.amount !== 0) {
        gross = Math.abs(voucher.amount);
      } else if (partyEntry) {
        gross = Math.abs(partyEntry.amount || 0);
      } else {
        const debits = ledgerentries.filter((e) => (e.amount || 0) > 0);
        gross = debits.reduce((sum, e) => sum + Math.abs(e.amount), 0);
      }
      gross = Math.round(gross * 100) / 100;
    }

    const breakdown = {
      cgst: 0,
      sgst: 0,
      igst: 0,
      tds: 0,
      tcs: 0,
      cess: 0,
      other: 0,
    };

    for (const entry of ledgerentries) {
      const taxType = classifyTaxType(entry);
      if (taxType) {
        const amt = Math.abs(Number(entry.amount) || 0);
        breakdown[taxType] =
          Math.round((breakdown[taxType] + amt) * 100) / 100;
      }
    }

    const totalGst =
      Math.round(
        (breakdown.cgst +
          breakdown.sgst +
          breakdown.igst +
          breakdown.cess +
          breakdown.other) *
          100,
      ) / 100;

    const totalTax =
      Math.round(
        (totalGst +
          breakdown.tds +
          breakdown.tcs) *
          100,
      ) / 100;

    // In accounting: Party Payable = Base Expense + GST - TDS
    // Therefore: Base Net Expense = Party Payable - GST + TDS
    const net =
      Math.round(
        (gross - totalGst + breakdown.tds - breakdown.tcs) * 100,
      ) / 100;

    voucher.amount = gross;
    voucher.gross_amount = gross;
    voucher.net_amount = net;
    voucher.tax_amount = totalTax;
    voucher.tax_breakdown = {
      ...breakdown,
      total: totalTax,
    };
    voucher.ledgerentries = ledgerentries;
    voucher.inventoryentries = inventoryentries;

    if (voucher.vchtype) {
      const voucher_type_doc = await VoucherType.findOne({
        name: voucher.vchtype,
        company_id: new mongoose.Types.ObjectId(companyId),
        is_deleted: false,
      })
        .select("_id name parent")
        .lean();

      if (voucher_type_doc) {
        if (!voucher.voucher_type_id) {
          voucher.voucher_type_id = voucher_type_doc._id;
        }
        if (voucher_type_doc.parent) {
          voucher.voucher_type_parent = voucher_type_doc.parent;
        }
      }
    }

    return ok(res, voucher, "Voucher retrieved successfully");
  } catch (error) {
    next(error);
  }
};

export const computeVoucherAmountExpression = {
  $cond: {
    if: {
      $and: [
        { $ne: ["$amount", null] },
        { $ne: ["$amount", 0] },
      ],
    },
    then: { $round: [{ $abs: "$amount" }, 2] },
    else: {
      $let: {
        vars: {
          partyEntries: {
            $filter: {
              input: "$ledgerentries",
              as: "le",
              cond: {
                $or: [
                  { $eq: ["$$le.is_party_ledger", true] },
                  {
                    $and: [
                      { $ne: ["$party_ledger_id", null] },
                      { $eq: ["$$le.ledger_id", "$party_ledger_id"] },
                    ],
                  },
                ],
              },
            },
          },
        },
        in: {
          $cond: {
            if: { $gt: [{ $size: "$$partyEntries" }, 0] },
            then: {
              $round: [
                {
                  $reduce: {
                    input: "$$partyEntries",
                    initialValue: 0,
                    in: {
                      $add: [
                        "$$value",
                        { $abs: { $ifNull: ["$$this.amount", 0] } },
                      ],
                    },
                  },
                },
                2,
              ],
            },
            else: {
              $let: {
                vars: {
                  debitEntries: {
                    $filter: {
                      input: "$ledgerentries",
                      as: "le",
                      cond: { $gt: ["$$le.amount", 0] },
                    },
                  },
                },
                in: {
                  $cond: {
                    if: { $gt: [{ $size: "$$debitEntries" }, 0] },
                    then: {
                      $round: [
                        {
                          $reduce: {
                            input: "$$debitEntries",
                            initialValue: 0,
                            in: {
                              $add: [
                                "$$value",
                                {
                                  $abs: {
                                    $ifNull: ["$$this.amount", 0],
                                  },
                                },
                              ],
                            },
                          },
                        },
                        2,
                      ],
                    },
                    else: {
                      $round: [
                        {
                          $reduce: {
                            input: "$ledgerentries",
                            initialValue: 0,
                            in: {
                              $add: [
                                "$$value",
                                {
                                  $abs: {
                                    $ifNull: ["$$this.amount", 0],
                                  },
                                },
                              ],
                            },
                          },
                        },
                        2,
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const getVoucherByVoucherType = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const {
      voucher_type_parent,
      voucher_type_id,
      party_ledger_id,
      page = 1,
      limit = 50,
      from_date,
      to_date,
      fy,
      targetYear,
    } = req.query;

    const rawCompanyId = companyId;
    if (!rawCompanyId || !mongoose.Types.ObjectId.isValid(rawCompanyId)) {
      throw ApiError.badRequest("A valid company ID is required");
    }

    const compId = new mongoose.Types.ObjectId(rawCompanyId);

    // 1. Fetch matching voucher types for the parent
    let targetVoucherTypes = [];
    const voucher_types_map = new Map();

    if (voucher_type_parent) {
      const voucher_types = await VoucherType.find({
        company_id: compId,
        is_deleted: false,
        parent: voucher_type_parent.trim(),
      })
        .collation({ locale: "en", strength: 2 })
        .select("name parent")
        .lean();

      for (const vt of voucher_types) {
        voucher_types_map.set(vt.name, vt.parent || vt.name);
      }

      const matchedNames = voucher_types.map((vt) => vt.name);
      targetVoucherTypes = [
        ...new Set([...matchedNames, voucher_type_parent.trim()]),
      ];
    } else {
      const allVoucherTypes = await VoucherType.find({
        company_id: compId,
        is_deleted: false,
      })
        .select("name parent")
        .lean();

      for (const vt of allVoucherTypes) {
        voucher_types_map.set(vt.name, vt.parent || vt.name);
      }
    }

    // 2. Build Voucher query
    const voucherFilter = {
      company_id: compId,
      is_deleted: false,
    };

    if (voucher_type_parent && targetVoucherTypes.length > 0) {
      voucherFilter.vchtype = { $in: targetVoucherTypes };
    }

    if (voucher_type_id && mongoose.Types.ObjectId.isValid(voucher_type_id)) {
      voucherFilter.voucher_type_id = new mongoose.Types.ObjectId(voucher_type_id);
    }

    if (party_ledger_id && mongoose.Types.ObjectId.isValid(party_ledger_id)) {
      voucherFilter.party_ledger_id = new mongoose.Types.ObjectId(party_ledger_id);
    }

    if (from_date || to_date) {
      voucherFilter.date = {};
      if (from_date) {
        voucherFilter.date.$gte = new Date(from_date);
      }
      if (to_date) {
        const end = new Date(to_date);
        end.setHours(23, 59, 59, 999);
        voucherFilter.date.$lte = end;
      }
    } else {
      const rawFy = fy || targetYear;
      if (
        rawFy &&
        !["all", "all years", "all_years"].includes(
          String(rawFy).trim().toLowerCase(),
        )
      ) {
        const match = String(rawFy).match(/\b(20\d\d)\b/);
        if (match) {
          const startYear = parseInt(match[1], 10);
          const endYear = startYear + 1;
          voucherFilter.date = {
            $gte: new Date(Date.UTC(startYear, 3, 1, 0, 0, 0)),
            $lte: new Date(Date.UTC(endYear, 2, 31, 23, 59, 59, 999)),
          };
        }
      }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 50);
    const skip = (pageNum - 1) * limitNum;

    // 3. Fetch vouchers & total count with $lookup for entries
    const [vouchers, total_count] = await Promise.all([
      Voucher.aggregate([
        { $match: voucherFilter },
        { $sort: { date: -1 } },
        { $skip: skip },
        { $limit: limitNum },
        {
          $lookup: {
            from: "ledgerentries",
            let: { voucherId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$voucher_id", "$$voucherId"] },
                  is_deleted: { $ne: true },
                },
              },
              {
                $lookup: {
                  from: "ledgers",
                  localField: "ledger_id",
                  foreignField: "_id",
                  as: "ledger",
                },
              },
              {
                $addFields: {
                  ledger_name: {
                    $ifNull: [{ $arrayElemAt: ["$ledger.name", 0] }, null],
                  },
                },
              },
              {
                $project: {
                  ledger: 0,
                  "created_at": 0,
                  "updated_at": 0,
                  "company_id": 0,
                },
              },
            ],
            as: "ledgerentries",
          },
        },
        {
          $lookup: {
            from: "inventoryentries",
            localField: "_id",
            foreignField: "voucher_id",
            as: "inventoryentries",
          },
        },
        {
          $lookup: {
            from: "ledgers",
            localField: "party_ledger_id",
            foreignField: "_id",
            as: "party_ledger",
          },
        },
        {
          $addFields: {
            party_ledger_name: {
              $ifNull: [{ $arrayElemAt: ["$party_ledger.name", 0] }, null],
            },
            amount: computeVoucherAmountExpression,
          },
        },
        {
          $project: {
            exchange_rate: 0,
            is_active: 0,
            is_approved: 0,
            is_deleted: 0,
            is_posted: 0,
            is_reserved: 0,
            alter_id: 0,
            master_id: 0,
            company_id: 0,
            last_sync_at: 0,
            __v: 0,
            party_ledger: 0,
            "ledgerentries.created_at": 0,
            "ledgerentries.updated_at": 0,
            "ledgerentries.company_id": 0,
            "inventoryentries.created_at": 0,
            "inventoryentries.updated_at": 0,
            "inventoryentries.company_id": 0,
          },
        },
      ]),
      Voucher.countDocuments(voucherFilter),
    ]);

    return ok(
      res,
      {
        voucher_type_parent: voucher_type_parent || null,
        total_count,
        count: vouchers.length,
        page: pageNum,
        limit: limitNum,
        total_pages: Math.ceil(total_count / limitNum) || 1,
        vouchers: vouchers,
      },
      "Vouchers by voucher type retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};
const calculateSalesThroughVoucher = async (req, res, next) => {
  try {
    const { companyId: company_id } = req.params;
    if (!company_id || !mongoose.Types.ObjectId.isValid(company_id)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const compId = new mongoose.Types.ObjectId(company_id);
    const { from_date, to_date } = req.query;
    if (!from_date || !to_date) {
      throw ApiError.badRequest("from_date and to_date are required");
    }
    const fromDate = new Date(from_date);
    const toDate = new Date(to_date);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw ApiError.badRequest("Invalid date format for from_date or to_date. Please use YYYY-MM-DD.");
    }
    toDate.setHours(23, 59, 59, 999);

    // Find vouchers by from and to date
    const vouchers = await Voucher.find({
      company_id: compId,
      is_deleted: false,
      is_optional: { $ne: true },
      is_cancelled: { $ne: true },
      date: { $gte: fromDate, $lte: toDate },
    })
      .select("_id date vchtype voucher_type_id voucher_type voucher_number narration party_ledger_id ledgerentries inventoryentries")
      .populate("party_ledger_id", "name")
      .sort({ date: -1 })
      .lean();
    if (!vouchers.length) {
      return ok(
        res,
        {
          count: 0,
          total_count: 0,
          total_dr_amount: 0,
          total_cr_amount: 0,
          vouchers: [],
        },
        "Sales vouchers retrieved successfully",
      );
    }

    const voucherIds = vouchers.map((v) => v._id);

    // Fetch ledger entries, inventory entries, and company groups in parallel
    let [ledgerEntries, inventoryEntries, groups] = await Promise.all([
      LedgerEntry.find({
        voucher_id: { $in: voucherIds },
        company_id: compId,
        is_deleted: { $ne: true },
      })
        .populate("ledger_id")
        .lean(),
      InventoryEntry.find({
        voucher_id: { $in: voucherIds },
        company_id: compId,
        is_deleted: { $ne: true },
      })
        .populate("accounting_ledger_id")
        .lean(),
      Group.find({ company_id: compId, is_deleted: false }).select("name parent").lean(),
    ]);

    // Fallback: If standalone entries are empty for these vouchers, use embedded entries
    if ((!ledgerEntries || ledgerEntries.length === 0) && (!inventoryEntries || inventoryEntries.length === 0)) {
      const companyLedgers = await Ledger.find({ company_id: compId }).lean();
      const ledgerByName = new Map();
      for (const l of companyLedgers) {
        if (l.name) ledgerByName.set(l.name.trim().toLowerCase(), l);
      }

      ledgerEntries = [];
      inventoryEntries = [];
      for (const v of vouchers) {
        if (Array.isArray(v.ledgerentries)) {
          for (const le of v.ledgerentries) {
            const name = (le.ledger_name || le.name || "").trim();
            const ledgerDoc = ledgerByName.get(name.toLowerCase()) || { name, parent: "" };
            ledgerEntries.push({
              voucher_id: v._id,
              ledger_id: ledgerDoc,
              amount: le.amount,
              is_deemed_positive: le.is_deemed_positive,
            });
          }
        }
        if (Array.isArray(v.inventoryentries)) {
          for (const ie of v.inventoryentries) {
            const accName = (ie.accounting_ledger_name || "").trim();
            const ledgerDoc = ledgerByName.get(accName.toLowerCase()) || { name: accName, parent: "" };
            inventoryEntries.push({
              voucher_id: v._id,
              accounting_ledger_id: ledgerDoc,
              accounting_amount: ie.accounting_amount !== undefined ? ie.accounting_amount : ie.amount,
              accounting_isdeemedpositive: ie.accounting_isdeemedpositive,
            });
          }
        }
      }
    }

    // Build hierarchy of all groups rolling up to "Sales Accounts"
    const salesGroupNames = new Set(["sales accounts"]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const g of groups) {
        const nameLower = g.name?.trim().toLowerCase();
        const parentLower = g.parent?.trim().toLowerCase();
        if (parentLower && salesGroupNames.has(parentLower) && !salesGroupNames.has(nameLower)) {
          salesGroupNames.add(nameLower);
          expanded = true;
        }
      }
    }

    let total_dr_amount = 0;
    let total_cr_amount = 0;
    const voucherIdsWithSales = new Set();

    const isSalesLedger = (ledger) => {
      if (!ledger) return false;
      const groupParent = ledger.group_id?.parent?.trim()?.toLowerCase();
      const groupName = ledger.group_id?.name?.trim()?.toLowerCase();
      const ledgerParent = ledger.parent?.trim()?.toLowerCase();
      const ledgerName = ledger.name?.trim()?.toLowerCase();

      return (
        salesGroupNames.has(ledgerParent) ||
        salesGroupNames.has(ledgerName) ||
        (groupParent && salesGroupNames.has(groupParent)) ||
        (groupName && salesGroupNames.has(groupName))
      );
    };

    ledgerEntries.forEach((entry) => {
      const ledger = entry.ledger_id;
      if (!ledger) return;

      if (isSalesLedger(ledger)) {
        voucherIdsWithSales.add(String(entry.voucher_id));
        const amount = Number(entry.amount) || 0;

        if (
          (amount > 0 && !entry.is_deemed_positive) ||
          (amount < 0 && entry.is_deemed_positive)
        ) {
          total_dr_amount += amount;
        } else {
          total_cr_amount += amount;
        }
      }
    });

    inventoryEntries.forEach((entry) => {
      const ledger = entry.accounting_ledger_id;
      if (!ledger) return;

      if (isSalesLedger(ledger)) {
        voucherIdsWithSales.add(String(entry.voucher_id));
        const amount = Number(
          entry.accounting_amount !== undefined && entry.accounting_amount !== null
            ? entry.accounting_amount
            : entry.amount,
        ) || 0;
        const isDeemedPositive =
          entry.accounting_isdeemedpositive !== undefined
            ? entry.accounting_isdeemedpositive
            : entry.is_deemed_positive;

        if (
          (amount > 0 && !isDeemedPositive) ||
          (amount < 0 && isDeemedPositive)
        ) {
          total_dr_amount += amount;
        } else {
          total_cr_amount += amount;
        }
      }
    });

    const filteredVouchers = vouchers
      .filter((v) => voucherIdsWithSales.has(String(v._id)))
      .map((v) => {
        const { ledgerentries, inventoryentries, ...rest } = v;
        return {
          ...rest,
          party_ledger_id: rest.party_ledger_id?._id || rest.party_ledger_id || null,
          party_ledger_name: rest.party_ledger_id?.name || null,
          vchtype: rest.vchtype || rest.voucher_type,
        };
      });

    const roundedDr = Math.round(total_dr_amount * 100) / 100;
    const roundedCr = Math.round(total_cr_amount * 100) / 100;
    const total_amount = Math.round((roundedCr + roundedDr) * 100) / 100;

    return ok(
      res,
      {
        len:vouchers.length,
        count: filteredVouchers.length,
        total_count: filteredVouchers.length,
        total_amount,
        total_dr_amount: roundedDr,
        total_cr_amount: roundedCr,
        vouchers: filteredVouchers,
      },
      "Sales vouchers retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};

const MONTH_NAMES = [
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "January", "February", "March"
];

const buildEmptyMonthsArray = (startYear) => {
  const endYear = startYear + 1;
  return MONTH_NAMES.map((name, idx) => {
    const jsMonth = idx < 9 ? idx + 3 : idx - 9;
    const calYear = idx < 9 ? startYear : endYear;
    return {
      month_index: idx + 1,
      month_name: name,
      month: jsMonth + 1,
      year: calYear,
      month_key: `${calYear}-${String(jsMonth + 1).padStart(2, "0")}`,
      total_sales: 0,
      total_dr_amount: 0,
      total_cr_amount: 0,
      voucher_count: 0,
    };
  });
};

const getFinancialYearInfo = (date) => {
  const d = new Date(date);
  const jsMonth = d.getMonth();
  const calYear = d.getFullYear();
  const startYear = jsMonth >= 3 ? calYear : calYear - 1;
  const endYear = startYear + 1;
  return {
    key: `${startYear}-${endYear}`,
    startYear,
    endYear,
    fromDate: `${startYear}-04-01`,
    toDate: `${endYear}-03-31`,
    monthIndexInFY: jsMonth >= 3 ? jsMonth - 3 : jsMonth + 9,
  };
};

const getSalesSummaryThroughVoucher = async (req, res, next) => {
  try {
    const { companyId: company_id } = req.params;
    if (!company_id || !mongoose.Types.ObjectId.isValid(company_id)) {
      throw ApiError.badRequest("A valid company ID is required");
    }
    const compId = new mongoose.Types.ObjectId(company_id);
    const { timeline, from_date, to_date, year } = req.query;

    const requestedTimeline = timeline ? String(timeline).trim().toLowerCase() : null;
    if (requestedTimeline && requestedTimeline !== "all" && requestedTimeline !== "year") {
      throw ApiError.badRequest("Invalid timeline parameter. Expected 'all' or 'year'.");
    }

    // 1. Resolve company's sales group hierarchy
    const groups = await Group.find({ company_id: compId, is_deleted: false })
      .select("name parent")
      .lean();

    const salesGroupNames = new Set(["sales accounts"]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const g of groups) {
        const nameLower = g.name?.trim().toLowerCase();
        const parentLower = g.parent?.trim().toLowerCase();
        if (parentLower && salesGroupNames.has(parentLower) && !salesGroupNames.has(nameLower)) {
          salesGroupNames.add(nameLower);
          expanded = true;
        }
      }
    }

    const isSalesLedger = (ledger) => {
      if (!ledger) return false;
      const groupParent = ledger.group_id?.parent?.trim()?.toLowerCase();
      const groupName = ledger.group_id?.name?.trim()?.toLowerCase();
      const ledgerParent = ledger.parent?.trim()?.toLowerCase();
      const ledgerName = ledger.name?.trim()?.toLowerCase();

      return (
        salesGroupNames.has(ledgerParent) ||
        salesGroupNames.has(ledgerName) ||
        (groupParent && salesGroupNames.has(groupParent)) ||
        (groupName && salesGroupNames.has(groupName))
      );
    };

    // 2. Build voucher query filter
    const voucherFilter = {
      company_id: compId,
      is_deleted: false,
      is_optional: { $ne: true },
      is_cancelled: { $ne: true },
    };

    let targetStartYear = null;
    if (year) {
      const yrStr = String(year).trim();
      const match = yrStr.match(/^(\d{4})/);
      if (match) {
        targetStartYear = parseInt(match[1], 10);
        voucherFilter.date = {
          $gte: new Date(`${targetStartYear}-04-01`),
          $lte: new Date(`${targetStartYear + 1}-03-31T23:59:59.999Z`),
        };
      }
    } else if (from_date || to_date) {
      voucherFilter.date = {};
      if (from_date) {
        const fromD = new Date(from_date);
        if (isNaN(fromD.getTime())) {
          throw ApiError.badRequest("Invalid from_date format. Expected YYYY-MM-DD.");
        }
        voucherFilter.date.$gte = fromD;
      }
      if (to_date) {
        const toD = new Date(to_date);
        if (isNaN(toD.getTime())) {
          throw ApiError.badRequest("Invalid to_date format. Expected YYYY-MM-DD.");
        }
        toD.setHours(23, 59, 59, 999);
        voucherFilter.date.$lte = toD;
      }
    }

    // 3. Fetch vouchers
    const vouchers = await Voucher.find(voucherFilter)
      .select("_id date vchtype voucher_type_id voucher_type voucher_number narration party_ledger_id ledgerentries inventoryentries")
      .sort({ date: 1 })
      .lean();

    const effectiveTimeline =
      requestedTimeline || (year ? "year" : "all");

    if (!vouchers.length) {
      return ok(
        res,
        {
          company_id,
          timeline: effectiveTimeline,
          total_sales: 0,
          total_dr_amount: 0,
          total_cr_amount: 0,
          total_vouchers: 0,
          ...(effectiveTimeline === "year"
            ? {
                financial_year: targetStartYear ? `${targetStartYear}-${targetStartYear + 1}` : null,
                months: buildEmptyMonthsArray(targetStartYear || new Date().getFullYear()),
              }
            : {
                financial_years_count: 0,
                financial_years: [],
              }),
        },
        "Sales summary retrieved successfully",
      );
    }

    const voucherIds = vouchers.map((v) => v._id);

    // 4. Fetch ledger entries and inventory entries
    let [ledgerEntries, inventoryEntries] = await Promise.all([
      LedgerEntry.find({
        voucher_id: { $in: voucherIds },
        company_id: compId,
        is_deleted: { $ne: true },
      })
        .populate("ledger_id")
        .lean(),
      InventoryEntry.find({
        voucher_id: { $in: voucherIds },
        company_id: compId,
        is_deleted: { $ne: true },
      })
        .populate("accounting_ledger_id")
        .lean(),
    ]);

    // Fallback: If standalone entries are empty for these vouchers, use embedded entries
    if ((!ledgerEntries || ledgerEntries.length === 0) && (!inventoryEntries || inventoryEntries.length === 0)) {
      const companyLedgers = await Ledger.find({ company_id: compId }).lean();
      const ledgerByName = new Map();
      for (const l of companyLedgers) {
        if (l.name) ledgerByName.set(l.name.trim().toLowerCase(), l);
      }

      ledgerEntries = [];
      inventoryEntries = [];
      for (const v of vouchers) {
        if (Array.isArray(v.ledgerentries)) {
          for (const le of v.ledgerentries) {
            const name = (le.ledger_name || le.name || "").trim();
            const ledgerDoc = ledgerByName.get(name.toLowerCase()) || { name, parent: "" };
            ledgerEntries.push({
              voucher_id: v._id,
              ledger_id: ledgerDoc,
              amount: le.amount,
              is_deemed_positive: le.is_deemed_positive,
            });
          }
        }
        if (Array.isArray(v.inventoryentries)) {
          for (const ie of v.inventoryentries) {
            const accName = (ie.accounting_ledger_name || "").trim();
            const ledgerDoc = ledgerByName.get(accName.toLowerCase()) || { name: accName, parent: "" };
            inventoryEntries.push({
              voucher_id: v._id,
              accounting_ledger_id: ledgerDoc,
              accounting_amount: ie.accounting_amount !== undefined ? ie.accounting_amount : ie.amount,
              accounting_isdeemedpositive: ie.accounting_isdeemedpositive,
            });
          }
        }
      }
    }

    // 5. Map entries to vouchers
    const voucherSalesMap = new Map();

    const recordSales = (voucherId, amount, isDeemedPositive) => {
      const vId = String(voucherId);
      if (!voucherSalesMap.has(vId)) {
        voucherSalesMap.set(vId, { dr_amount: 0, cr_amount: 0 });
      }
      const rec = voucherSalesMap.get(vId);
      if ((amount > 0 && !isDeemedPositive) || (amount < 0 && isDeemedPositive)) {
        rec.dr_amount += amount;
      } else {
        rec.cr_amount += amount;
      }
    };

    for (const entry of ledgerEntries) {
      if (isSalesLedger(entry.ledger_id)) {
        recordSales(entry.voucher_id, Number(entry.amount) || 0, entry.is_deemed_positive);
      }
    }

    for (const entry of inventoryEntries) {
      if (isSalesLedger(entry.accounting_ledger_id)) {
        const amt = Number(
          entry.accounting_amount !== undefined && entry.accounting_amount !== null
            ? entry.accounting_amount
            : entry.amount,
        ) || 0;
        const deemed = entry.accounting_isdeemedpositive !== undefined
          ? entry.accounting_isdeemedpositive
          : entry.is_deemed_positive;
        recordSales(entry.voucher_id, amt, deemed);
      }
    }

    // 6. Aggregate by Financial Year and Month
    const fyMap = new Map();
    let grandTotalDr = 0;
    let grandTotalCr = 0;
    let grandTotalVouchers = 0;

    for (const v of vouchers) {
      const vId = String(v._id);
      const salesInfo = voucherSalesMap.get(vId);
      if (!salesInfo) continue;

      const voucherSales = Math.round((salesInfo.dr_amount + salesInfo.cr_amount) * 100) / 100;
      if (voucherSales === 0 && salesInfo.dr_amount === 0 && salesInfo.cr_amount === 0) continue;

      const fyInfo = getFinancialYearInfo(v.date);
      if (!fyMap.has(fyInfo.key)) {
        fyMap.set(fyInfo.key, {
          financial_year: fyInfo.key,
          start_year: fyInfo.startYear,
          end_year: fyInfo.endYear,
          from_date: fyInfo.fromDate,
          to_date: fyInfo.toDate,
          total_sales: 0,
          total_dr_amount: 0,
          total_cr_amount: 0,
          voucher_count: 0,
          months: buildEmptyMonthsArray(fyInfo.startYear),
        });
      }

      const fyRecord = fyMap.get(fyInfo.key);
      fyRecord.total_sales = Math.round((fyRecord.total_sales + voucherSales) * 100) / 100;
      fyRecord.total_dr_amount = Math.round((fyRecord.total_dr_amount + salesInfo.dr_amount) * 100) / 100;
      fyRecord.total_cr_amount = Math.round((fyRecord.total_cr_amount + salesInfo.cr_amount) * 100) / 100;
      fyRecord.voucher_count++;

      // Update month inside this FY
      const monthRecord = fyRecord.months[fyInfo.monthIndexInFY];
      if (monthRecord) {
        monthRecord.total_sales = Math.round((monthRecord.total_sales + voucherSales) * 100) / 100;
        monthRecord.total_dr_amount = Math.round((monthRecord.total_dr_amount + salesInfo.dr_amount) * 100) / 100;
        monthRecord.total_cr_amount = Math.round((monthRecord.total_cr_amount + salesInfo.cr_amount) * 100) / 100;
        monthRecord.voucher_count++;
      }

      grandTotalDr += salesInfo.dr_amount;
      grandTotalCr += salesInfo.cr_amount;
      grandTotalVouchers++;
    }

    const grandTotalSales = Math.round((grandTotalDr + grandTotalCr) * 100) / 100;
    const roundedGrandDr = Math.round(grandTotalDr * 100) / 100;
    const roundedGrandCr = Math.round(grandTotalCr * 100) / 100;

    const sortedFYs = [...fyMap.values()].sort((a, b) => a.start_year - b.start_year);

    // If timeline = "year", return the month data for that financial year
    if (effectiveTimeline === "year") {
      const selectedFY = targetStartYear
        ? sortedFYs.find((f) => f.start_year === targetStartYear)
        : sortedFYs[sortedFYs.length - 1];

      return ok(
        res,
        {
          company_id,
          timeline: "year",
          financial_year: selectedFY?.financial_year || (targetStartYear ? `${targetStartYear}-${targetStartYear + 1}` : null),
          from_date: selectedFY?.from_date || from_date || null,
          to_date: selectedFY?.to_date || to_date || null,
          total_sales: selectedFY?.total_sales || 0,
          total_dr_amount: selectedFY?.total_dr_amount || 0,
          total_cr_amount: selectedFY?.total_cr_amount || 0,
          voucher_count: selectedFY?.voucher_count || 0,
          months: selectedFY?.months || buildEmptyMonthsArray(targetStartYear || new Date().getFullYear()),
        },
        "Yearly sales summary retrieved successfully",
      );
    }

    // Default: timeline = "all" (return every financial year with total)
    return ok(
      res,
      {
        company_id,
        timeline: "all",
        filters: {
          from_date: from_date || null,
          to_date: to_date || null,
        },
        total_sales: grandTotalSales,
        total_dr_amount: roundedGrandDr,
        total_cr_amount: roundedGrandCr,
        total_vouchers: grandTotalVouchers,
        financial_years_count: sortedFYs.length,
        financial_years: sortedFYs.map((fy) => ({
          financial_year: fy.financial_year,
          start_year: fy.start_year,
          end_year: fy.end_year,
          from_date: fy.from_date,
          to_date: fy.to_date,
          total_sales: fy.total_sales,
          total_dr_amount: fy.total_dr_amount,
          total_cr_amount: fy.total_cr_amount,
          voucher_count: fy.voucher_count,
          months: fy.months,
        })),
      },
      "All financial years sales summary retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
};




const getVoucherslist = async (req, res) => {
  try {
    const rawVoucherIds = req.body?.voucher_ids || req.query?.voucher_ids;
    const from_date = req.query?.from_date || req.body?.from_date;
    const to_date = req.query?.to_date || req.body?.to_date;
    const company_id = req.query?.company_id || req.body?.company_id;
    const companyId = req.query?.companyId || req.body?.companyId;
    const limit = req.query?.limit || req.body?.limit;
    const page = req.query?.page || req.body?.page;

    let voucherIds = null;
    if (Array.isArray(rawVoucherIds)) {
      voucherIds = rawVoucherIds;
    } else if (typeof rawVoucherIds === "string") {
      try {
        const parsed = JSON.parse(rawVoucherIds);
        voucherIds = Array.isArray(parsed) ? parsed : [rawVoucherIds];
      } catch {
        voucherIds = rawVoucherIds.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    // If voucher_ids was explicitly provided as an empty array, return empty data immediately
    if (voucherIds !== null && voucherIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    const filter = {
      is_deleted: { $ne: true },
      is_cancelled: { $ne: true },
    };

    const targetCompanyId = company_id || companyId || req.body?.company_id || req.body?.companyId;
    if (targetCompanyId && mongoose.Types.ObjectId.isValid(targetCompanyId)) {
      filter.company_id = new mongoose.Types.ObjectId(targetCompanyId);
    }

    let hasVoucherIds = false;

    const targetLedgerId =
      req.query?.ledger_id ||
      req.query?.party_ledger_id ||
      req.body?.ledger_id ||
      req.body?.party_ledger_id ||
      null;

    const rawLedgerName =
      req.query?.ledger_name ||
      req.query?.party_name ||
      req.query?.party_ledger_name ||
      req.body?.ledger_name ||
      req.body?.party_name ||
      req.body?.party_ledger_name;
    const targetLedgerName =
      typeof rawLedgerName === "string" && rawLedgerName.trim()
        ? rawLedgerName.trim().toLowerCase()
        : null;

    let targetLedgerDoc = null;
    if (targetLedgerId && mongoose.Types.ObjectId.isValid(targetLedgerId)) {
      targetLedgerDoc = await Ledger.findOne({
        _id: new mongoose.Types.ObjectId(targetLedgerId),
        ...(filter.company_id ? { company_id: filter.company_id } : {}),
      }).lean();
    } else if (targetLedgerName) {
      targetLedgerDoc = await Ledger.findOne({
        name: { $regex: new RegExp(`^${escapeRegex(targetLedgerName)}$`, "i") },
        ...(filter.company_id ? { company_id: filter.company_id } : {}),
      }).lean();
    }

    const resolvedLedgerId =
      targetLedgerDoc?._id ||
      (targetLedgerId && mongoose.Types.ObjectId.isValid(targetLedgerId)
        ? new mongoose.Types.ObjectId(targetLedgerId)
        : null);

    if (resolvedLedgerId) {
      const matchingEntries = await LedgerEntry.find(
        {
          ledger_id: resolvedLedgerId,
          ...(filter.company_id ? { company_id: filter.company_id } : {}),
        },
        { voucher_id: 1 },
      ).lean();

      const matchingVoucherIds = [
        ...new Set(matchingEntries.map((e) => String(e.voucher_id))),
      ];

      // If no matching vouchers found for this ledger, return empty response immediately
      if (matchingVoucherIds.length === 0) {
        return res.status(200).json({
          success: true,
          count: 0,
          total_gross_amount: 0,
          total_net_amount: 0,
          total_debit: 0,
          total_credit: 0,
          total_tax_amount: 0,
          total_tax_breakdown: {
            cgst: 0,
            sgst: 0,
            igst: 0,
            tds: 0,
            tcs: 0,
            cess: 0,
            other: 0,
            total: 0,
          },
          data: [],
        });
      }

      if (filter._id && filter._id.$in) {
        const existingIdStrings = new Set(filter._id.$in.map(String));
        const intersected = matchingVoucherIds.filter((id) =>
          existingIdStrings.has(id),
        );
        filter._id = {
          $in: intersected.map((id) => new mongoose.Types.ObjectId(id)),
        };
      } else {
        filter._id = {
          $in: matchingVoucherIds.map((id) => new mongoose.Types.ObjectId(id)),
        };
      }
    }

    if (voucherIds && voucherIds.length > 0 && !resolvedLedgerId) {
      const validObjectIds = voucherIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (validObjectIds.length > 0) {
        filter._id = { $in: validObjectIds };
        hasVoucherIds = true;
      }
    }

    // Only apply date filter if explicit voucher_ids were NOT provided.
    // When voucher_ids are provided, the caller already filtered by date when computing the party list;
    // re-filtering by date here causes timezone boundary truncation (UTC vs IST 23:59:59.999).
    if (!hasVoucherIds && (from_date || to_date)) {
      filter.date = {};
      if (from_date) {
        filter.date.$gte = new Date(from_date);
      }
      if (to_date) {
        const toEnd = new Date(to_date);
        toEnd.setHours(23, 59, 59, 999);
        filter.date.$lte = toEnd;
      }
    }

    const pipeline = [
      { $match: filter },
      { $sort: { date: -1 } },
      {
        $lookup: {
          from: "ledgerentries",
          let: { vId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$voucher_id", "$$vId"] } } },
            {
              $lookup: {
                from: "ledgers",
                localField: "ledger_id",
                foreignField: "_id",
                as: "ledger_info",
              },
            },
            {
              $addFields: {
                ledger_name: { $arrayElemAt: ["$ledger_info.name", 0] },
                ledger_parent: { $arrayElemAt: ["$ledger_info.parent", 0] },
                ledger_classification: {
                  $arrayElemAt: ["$ledger_info.classification", 0],
                },
              },
            },
            {
              $project: { ledger_info: 0 },
            },
          ],
          as: "ledgerentries",
        },
      },
      {
        $lookup: {
          from: "ledgers",
          localField: "party_ledger_id",
          foreignField: "_id",
          as: "party_ledger",
        },
      },
      {
        $addFields: {
          party_ledger_name: {
            $ifNull: [{ $arrayElemAt: ["$party_ledger.name", 0] }, null],
          },
          amount: computeVoucherAmountExpression,
        },
      },
      {
        $project: {
          party_ledger: 0,
        },
      },
    ];

    if (limit && Number(limit) > 0) {
      const pageNum = Math.max(1, Number(page) || 1);
      const limitNum = Number(limit);
      pipeline.push({ $skip: (pageNum - 1) * limitNum });
      pipeline.push({ $limit: limitNum });
    }

    const vouchers = await Voucher.aggregate(pipeline);

    const vouchersWithBifurcation = vouchers.map((v) => {
      let gross = Math.round(Number(v.amount || 0) * 100) / 100;
      let partyName = v.party_ledger_name;
      let partyLedgerId = v.party_ledger_id;

      // Agar specific ledger_id ya party_name pass hua hai (jaise WETHREE ke compound forex journal mein)
      let specificEntry = null;
      if (resolvedLedgerId || targetLedgerName) {
        specificEntry = (v.ledgerentries || []).find((e) => {
          if (resolvedLedgerId && String(e.ledger_id) === String(resolvedLedgerId)) {
            return true;
          }
          if (
            targetLedgerName &&
            (e.ledger_name || "").trim().toLowerCase() === targetLedgerName
          ) {
            return true;
          }
          return false;
        });

        if (specificEntry) {
          gross =
            Math.round(Math.abs(Number(specificEntry.amount) || 0) * 100) / 100;
          partyName = specificEntry.ledger_name || partyName;
          partyLedgerId = specificEntry.ledger_id;
        }
      }

      const breakdown = {
        cgst: 0,
        sgst: 0,
        igst: 0,
        tds: 0,
        tcs: 0,
        cess: 0,
        other: 0,
      };

      for (const entry of v.ledgerentries || []) {
        const taxType = classifyTaxType(entry);
        if (taxType) {
          const amt = Math.abs(Number(entry.amount) || 0);
          breakdown[taxType] =
            Math.round((breakdown[taxType] + amt) * 100) / 100;
        }
      }

      const totalGst =
        Math.round(
          (breakdown.cgst +
            breakdown.sgst +
            breakdown.igst +
            breakdown.cess +
            breakdown.other) *
            100,
        ) / 100;

      const totalTax =
        Math.round(
          (totalGst +
            breakdown.tds +
            breakdown.tcs) *
            100,
        ) / 100;

      // In accounting: Party Payable = Base Expense + GST - TDS
      // Therefore: Base Net Expense = Party Payable - GST + TDS
      const net =
        Math.round(
          (gross - totalGst + breakdown.tds - breakdown.tcs) * 100,
        ) / 100;

      const isDebit = specificEntry
        ? (specificEntry.is_deemed_positive === true ||
           specificEntry.entry_type === "DEBIT" ||
           Number(specificEntry.amount) < 0)
        : null;

      const { ledgerentries, ...rest } = v;

      return {
        ...rest,
        party_ledger_id: partyLedgerId,
        party_ledger_name: partyName,
        amount: gross,
        gross_amount: gross,
        net_amount: net,
        tax_amount: totalTax,
        tax_breakdown: {
          ...breakdown,
          total: totalTax,
        },
        entry_type: isDebit === null ? null : (isDebit ? "Dr" : "Cr"),
        is_debit: isDebit,
      };
    });

    let totalGross = 0;
    let totalNet = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    if (resolvedLedgerId || targetLedgerName) {
      for (const v of vouchers) {
        const matchingEntries = (v.ledgerentries || []).filter((e) => {
          if (resolvedLedgerId && String(e.ledger_id) === String(resolvedLedgerId)) return true;
          if (targetLedgerName && (e.ledger_name || "").trim().toLowerCase() === targetLedgerName) return true;
          return false;
        });

        if (matchingEntries.length > 0) {
          for (const entry of matchingEntries) {
            const amt = Math.abs(Number(entry.amount) || 0);
            if (
              entry.is_deemed_positive === true ||
              entry.entry_type === "DEBIT" ||
              Number(entry.amount) < 0
            ) {
              totalDebit += amt;
            } else {
              totalCredit += amt;
            }
          }
        } else {
          const amt = Math.abs(Number(v.amount) || 0);
          totalDebit += amt;
        }
      }

      totalDebit = Math.round(totalDebit * 100) / 100;
      totalCredit = Math.round(totalCredit * 100) / 100;

      const classification = `${targetLedgerDoc?.classification || ""} ${targetLedgerDoc?.parent || ""}`.toLowerCase();

      if (
        classification.includes("expense") ||
        classification.includes("asset") ||
        classification.includes("bank")
      ) {
        // For Expenses / Assets: Debits increase the balance, Credits reduce it
        totalNet = totalDebit - totalCredit;
      } else if (
        classification.includes("liability") ||
        classification.includes("income") ||
        classification.includes("payable")
      ) {
        // For Liabilities / Incomes: Credits increase the balance, Debits reduce it
        totalNet = totalCredit - totalDebit;
      } else {
        // Fallback if classification is unknown:
        totalNet = Math.abs(totalDebit - totalCredit);
      }

      totalNet = Math.round(totalNet * 100) / 100;
      // totalGross represents the total positive volume (usually total debits for expenses)
      totalGross = totalDebit > 0 ? totalDebit : totalCredit;
      totalGross = Math.round(totalGross * 100) / 100;
    } else {
      totalGross =
        Math.round(
          vouchersWithBifurcation.reduce((sum, v) => sum + v.gross_amount, 0) * 100,
        ) / 100;
      totalNet =
        Math.round(
          vouchersWithBifurcation.reduce((sum, v) => sum + v.net_amount, 0) * 100,
        ) / 100;
    }

    const totalTax =
      Math.round(
        vouchersWithBifurcation.reduce((sum, v) => sum + v.tax_amount, 0) * 100,
      ) / 100;

    const totalTaxBreakdown = {
      cgst:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.cgst,
            0,
          ) * 100,
        ) / 100,
      sgst:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.sgst,
            0,
          ) * 100,
        ) / 100,
      igst:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.igst,
            0,
          ) * 100,
        ) / 100,
      tds:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.tds,
            0,
          ) * 100,
        ) / 100,
      tcs:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.tcs,
            0,
          ) * 100,
        ) / 100,
      cess:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.cess,
            0,
          ) * 100,
        ) / 100,
      other:
        Math.round(
          vouchersWithBifurcation.reduce(
            (sum, v) => sum + v.tax_breakdown.other,
            0,
          ) * 100,
        ) / 100,
      total: totalTax,
    };

    return res.status(200).json({
      success: true,
      count: vouchersWithBifurcation.length,
      total_gross_amount: totalGross,
      total_net_amount: totalNet,
      total_debit: totalDebit,
      total_credit: totalCredit,
      total_tax_amount: totalTax,
      total_tax_breakdown: totalTaxBreakdown,
      data: vouchersWithBifurcation,
    });
  } catch (error) {
    console.error("Error fetching vouchers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export {
  getVoucherByLedgerName,
  getVoucherById,
  getVoucherByVoucherType,
  calculateSalesThroughVoucher,
  getSalesSummaryThroughVoucher,
  getVoucherslist
};