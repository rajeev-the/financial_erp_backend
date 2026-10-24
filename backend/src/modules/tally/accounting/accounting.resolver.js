import Group from "../group/group.schema.js";
import Ledger from "../ledger/ledger.schema.js";
import LedgerEntry from "../voucher/ledgerentry.schema.js";
import InventoryEntry from "../voucher/inventoryentry.schema.js";
import Voucher from "../voucher/voucher.schema.js";


//aggregate function
export const resolveAccountingData = async ({
  companyId,
  groupNames,
  fromDate,
  toDate,
}) => {
  // Normalize requested group names
  const normalizedGroupNames = groupNames.map((name) =>
    name.trim().toLowerCase()
  );

  // --------------------------------------------------
  // Voucher date filter
  // --------------------------------------------------

  const voucherMatch = {
    $expr: {
      $and: [
        {
          $ne: ["$is_cancelled", true],
        },
        {
          $ne: ["$is_deleted", true],
        },
        {
          $ne: ["$is_active", false],
        },
      ],
    },
  };

  const normFromDate = fromDate
    ? fromDate instanceof Date
      ? fromDate
      : new Date(fromDate)
    : null;
  const normToDate = toDate
    ? toDate instanceof Date
      ? toDate
      : new Date(toDate)
    : null;
  const validFromDate =
    normFromDate && !isNaN(normFromDate.getTime()) ? normFromDate : null;
  const validToDate =
    normToDate && !isNaN(normToDate.getTime()) ? normToDate : null;

  // --------------------------------------------------
  // AGGREGATION
  // --------------------------------------------------

  const result = await Group.aggregate([
    // ==================================================
    // 1. Find requested root groups
    // ==================================================

    {
      $match: {
        company_id: companyId,
        is_deleted: { $ne: true },

        // Case-insensitive matching
        $expr: {
          $in: [
            {
              $toLower: {
                $trim: {
                  input: "$name",
                },
              },
            },
            normalizedGroupNames,
          ],
        },
      },
    },

    // ==================================================
    // 2. Recursively find ALL child groups
    // ==================================================

    {
      $graphLookup: {
        from: "groups",

        startWith: {
          $trim: {
            input: "$name",
          },
        },

        connectFromField: "name",
        connectToField: "parent",

        as: "childGroups",

        restrictSearchWithMatch: {
          company_id: companyId,
          is_deleted: { $ne: true },
        },
      },
    },

    // ==================================================
    // 3. Create one array containing:
    //
    //    root groups + child groups
    // ==================================================

    {
      $project: {
        rootGroup: {
          _id: "$_id",
          name: "$name",
          parent: "$parent",
        },

        childGroups: {
          $map: {
            input: "$childGroups",
            as: "group",
            in: {
              _id: "$$group._id",
              name: "$$group.name",
              parent: "$$group.parent",
            },
          },
        },
      },
    },

    {
      $group: {
        _id: null,

        groups: {
          $push: "$rootGroup",
        },

        childGroups: {
          $push: "$childGroups",
        },
      },
    },

    // ==================================================
    // 4. Flatten childGroups
    // ==================================================

    {
      $project: {
        groups: {
          $setUnion: [
            "$groups",
            {
              $reduce: {
                input: "$childGroups",
                initialValue: [],
                in: {
                  $concatArrays: [
                    "$$value",
                    "$$this",
                  ],
                },
              },
            },
          ],
        },
      },
    },

    // ==================================================
    // 5. Get ledgers belonging to these groups
    // ==================================================

    {
      $lookup: {
        from: "ledgers",

        let: {
          groupIds: "$groups._id",
        },

        pipeline: [
          {
            $match: {
              company_id: companyId,
              is_deleted: { $ne: true },

              $expr: {
                $in: ["$group_id", "$$groupIds"],
              },
            },
          },

          {
            $project: {
              _id: 1,
              name: 1,
              group_id: 1,
              parent: 1,
            },
          },
        ],

        as: "ledgers",
      },
    },

    // ==================================================
    // 6. Get LedgerEntry + InventoryEntry
    // ==================================================

    {
      $lookup: {
        from: "ledgerentries",

        let: {
          ledgerIds: "$ledgers._id",
        },

        pipeline: [
          {
            $match: {
              company_id: companyId,
              is_deleted: { $ne: true },

              $expr: {
                $in: ["$ledger_id", "$$ledgerIds"],
              },
            },
          },

          {
            $project: {
              _id: 1,
              voucher_id: 1,
              ledger_id: 1,
              amount: 1,
              is_deemed_positive: 1,
              entry_type: 1,

            },
          },
        ],

        as: "ledgerEntries",
      },
    },

    // ==================================================
    // 7. Get InventoryEntry
    // ==================================================

    {
      $lookup: {
        from: "inventoryentries",

        let: {
          ledgerIds: "$ledgers._id",
        },

        pipeline: [
          {
            $match: {
              company_id: companyId,
              is_deleted: { $ne: true },

              $expr: {
                $in: [
                  "$accounting_ledger_id",
                  "$$ledgerIds",
                ],
              },
            },
          },

          {
            $project: {
              _id: 1,
              voucher_id: 1,

              ledger_id: "$accounting_ledger_id",

              amount: {
                $cond: [
                  {
                    $ne: [
                      "$accounting_amount",
                      null,
                    ],
                  },
                  "$accounting_amount",
                  {
                    $ifNull: [
                      "$amount",
                      0,
                    ],
                  },
                ],
              },

              is_deemed_positive: {
                $cond: [
                  {
                    $ne: [
                      "$accounting_isdeemedpositive",
                      null,
                    ],
                  },
                  "$accounting_isdeemedpositive",
                  "$is_deemed_positive",
                ],
              },

              entry_type: {
                $literal: "INVENTORY",
              },
            },
          },
        ],

        as: "inventoryEntries",
      },
    },

    // ==================================================
    // 8. Combine both types of entries
    // ==================================================

    {
      $project: {
        groups: 1,
        ledgers: 1,

        entries: {
          $concatArrays: [
            "$ledgerEntries",
            "$inventoryEntries",
          ],
        },
      },
    },

    // ==================================================
    // 9. Get unique voucher IDs
    // ==================================================

    {
      $project: {
        groups: 1,
        ledgers: 1,
        entries: 1,

        voucherIds: {
          $setUnion: [
            "$entries.voucher_id",
            [],
          ],
        },
      },
    },

    // ==================================================
    // 10. Get valid vouchers
    // ==================================================

    {
      $lookup: {
        from: "vouchers",

        let: {
          voucherIds: "$voucherIds",
        },

        pipeline: [
          {
            $match: {
              company_id: companyId,
              is_cancelled: { $ne: true },
              is_deleted: { $ne: true },
              is_active: { $ne: false },

              $expr: {
                $and: [
                  {
                    $in: [
                      "$_id",
                      "$$voucherIds",
                    ],
                  },

                  ...(validFromDate && validToDate
                    ? [
                        {
                          $gte: [
                            "$date",
                            validFromDate,
                          ],
                        },
                        {
                          $lte: [
                            "$date",
                            validToDate,
                          ],
                        },
                      ]
                    : validFromDate
                    ? [
                        {
                          $gte: [
                            "$date",
                            validFromDate,
                          ],
                        },
                      ]
                    : validToDate
                    ? [
                        {
                          $lte: [
                            "$date",
                            validToDate,
                          ],
                        },
                      ]
                    : []),
                ],
              },
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
            $project: {
              _id: 1,
              voucher_number: 1,
              date: 1,
              amount: 1,
              narration: 1,
              vchtype: 1,
              party_ledger_id: 1,
              party_ledger_name: {
                $ifNull: [
                  { $arrayElemAt: ["$party_ledger.name", 0] },
                  null,
                ],
              },
            },
          },

          {
            $sort: {
              date: -1,
            },
          },
        ],

        as: "vouchers",
      },
    },

    // ==================================================
    // 11. Keep only entries belonging to valid vouchers & calculate ledger amounts
    // ==================================================

    {
      $project: {
        groups: 1,
        vouchers: 1,

        entries: {
          $map: {
            input: {
              $filter: {
                input: "$entries",
                as: "entry",
                cond: {
                  $in: ["$$entry.voucher_id", "$vouchers._id"],
                },
              },
            },
            as: "validEntry",
            in: {
              $let: {
                vars: {
                  matchedLedger: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$ledgers",
                          as: "l",
                          cond: {
                            $eq: ["$$l._id", "$$validEntry.ledger_id"],
                          },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: {
                  _id: "$$validEntry._id",
                  voucher_id: "$$validEntry.voucher_id",
                  ledger_id: "$$validEntry.ledger_id",
                  ledger_name: {
                    $ifNull: ["$$matchedLedger.name", "Unknown"],
                  },
                  amount: "$$validEntry.amount",
                  is_deemed_positive: "$$validEntry.is_deemed_positive",
                  entry_type: "$$validEntry.entry_type",
                },
              },
            },
          },
        },

        ledgers: {
          $map: {
            input: "$ledgers",
            as: "ledger",
            in: {
              $let: {
                vars: {
                  ledgerEntries: {
                    $filter: {
                      input: "$entries",
                      as: "entry",
                      cond: {
                        $and: [
                          { $eq: ["$$entry.ledger_id", "$$ledger._id"] },
                          { $in: ["$$entry.voucher_id", "$vouchers._id"] },
                        ],
                      },
                    },
                  },
                },
                in: {
                  _id: "$$ledger._id",
                  name: "$$ledger.name",
                  group_id: "$$ledger.group_id",
                  parent: "$$ledger.parent",
                  amount: {
                    $round: [
                      {
                        $abs: {
                          $reduce: {
                            input: "$$ledgerEntries",
                            initialValue: 0,
                            in: {
                              $add: [
                                "$$value",
                                {
                                  $toDouble: {
                                    $ifNull: ["$$this.amount", 0],
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                      2,
                    ],
                  },
                  net: {
                    $round: [
                      {
                        $reduce: {
                          input: "$$ledgerEntries",
                          initialValue: 0,
                          in: {
                            $add: [
                              "$$value",
                              {
                                $toDouble: {
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

    // ==================================================
    // 12. Final result
    // ==================================================

    {
      $project: {
        _id: 0,
        groups: 1,
        ledgers: 1,
        vouchers: 1,
        entries: 1,
      },
    },
  ]);

  // aggregate() always returns an array
  return (
    result[0] || {
      groups: [],
      ledgers: [],
      vouchers: [],
      entries: [],
    }
  );
};

