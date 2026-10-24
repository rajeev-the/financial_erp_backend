import mongoose, { Schema, model } from "mongoose";
import timeStampObj from "../../common/timestamps.object.js";
import commonFields from "../../common/commonFields.object.js";

const gstRateDetailSchema = new Schema(
  {
    gst_rate_duty_head: {
      type: String,
      trim: true,
      default: null,
    },
    gst_rate_valuation_type: {
      type: String,
      trim: true,
      default: null,
    },
    gst_rate: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
);

const gstStatewiseDetailSchema = new Schema(
  {
    state_name: {
      type: String,
      trim: true,
      default: null,
    },
    rate_details: {
      type: [gstRateDetailSchema],
      default: [],
    },
  },
  { _id: false },
);

const gstDetailSchema = new Schema(
  {
    taxability: {
      type: String,
      trim: true,
      default: null,
    },
    statewise_details: {
      type: gstStatewiseDetailSchema,
      default: null,
    },
  },
  { _id: false },
);

const ledMailingDetailSchema = new Schema(
  {
    applicable_from: {
      type: Date,
      default: null,
    },
    pincode: {
      type: String,
      trim: true,
      default: null,
    },
    mailing_name: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      default: null,
    },
    country: {
      type: String,
      trim: true,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);

const ledGstRegDetailSchema = new Schema(
  {
    applicable_from: {
      type: Date,
      default: null,
    },
    gst_registration_type: {
      type: String,
      trim: true,
      default: null,
    },
    place_of_supply: {
      type: String,
      trim: true,
      default: null,
    },
    gstin: {
      type: String,
      trim: true,
      default: null,
    },
    is_oth_territory_assessee: {
      type: Boolean,
      default: false,
    },
    consider_purchase_for_export: {
      type: Boolean,
      default: false,
    },
    is_transporter: {
      type: Boolean,
      default: false,
    },
    is_common_party: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const paymentDetailSchema = new Schema(
  {
    ifs_code: {
      type: String,
      trim: true,
      default: null,
    },
    bank_name: {
      type: String,
      trim: true,
      default: null,
    },
    account_number: {
      type: String,
      trim: true,
      default: null,
    },
    payment_favouring: {
      type: String,
      trim: true,
      default: null,
    },
    transaction_name: {
      type: String,
      trim: true,
      default: null,
    },
    set_as_default: {
      type: Boolean,
      default: false,
    },
    default_transaction_type: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);

const hsnDetailSchema = new Schema(
  {
    applicable_from: {
      type: Date,
      default: null,
    },
    src_of_hsn_details: {
      type: String,
      trim: true,
      default: null,
    },
    hsn_code: {
      type: String,
      trim: true,
      default: null,
    },
    hsn_description: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);
const contactDetailSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      default: null,
    },
    phone_number: {
      type: String,
      trim: true,
      default: null,
    },
    country_isd_code: {
      type: String,
      trim: true,
      default: null,
    },
    is_default_whatsapp_num: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);



const LedgerSchema = new mongoose.Schema(
  {
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    group_id:{
      type:Schema.Types.ObjectId,
      ref:"Group"
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    guid: {
      type: String,
      required: true,
    },
    parent: {
      type: String,
      trim: true,
      default: "Primary",
    },
    master_id: {
      type: Number,
      trim: true,
      default: null,
    },
    alter_id: {
      type: Number,
      trim: true,
      default: null,
    },
    party_gstin: {
      type: String,
      trim: true,
      default: null,
    },
    classification: {
      type: String,
      trim: true,
      default: null,
    },
    gst_duty_head: {
      type: String,
      trim: true,
      default: null,
    },

    prior_state_name: {
      type: String,
      trim: true,
      default: null,
    },
    gst_registration_type: {
      type: String,
      trim: true,
      default: null,
    },

    gst_applicable: {
      type: String,
      trim: true,
      default: null,
    },

    gst_appropriate_to: {
      type: String,
      trim: true,
      default: null,
    },
    appropriate_for: {
      type: String,
      trim: true,
      default: null,
    },
    excise_alloc_type: {
      type: String,
      trim: true,
      default: null,
    },
    gst_type_of_supply: {
      type: String,
      trim: true,
      default: null,
    },
    affects_gross_profit: {
      type: Boolean,
      default: false,
    },

    affects_stock: {
      type: Boolean,
      default: false,
    },

    is_revenue: {
      type: Boolean,
      default: false,
    },

    is_bill_wise_on: {
      type: Boolean,
      default: false,
    },

    is_cost_centres_on: {
      type: Boolean,
      default: false,
    },
    income_tax_number: {
      type: String,
      trim: true,
      default: null,
    },
    is_subledger: {
      type: Boolean,
      default: false,
    },
    gst_nature_of_supply: {
      type: String,
      trim: true,
      default: null,
    },
    currency_name: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      default: null,
    },
    website: {
      type: String,
      trim: true,
      default: null,
    },
    narration: {
      type: String,
      trim: true,
      default: null,
    },
    bill_credit_period: {
      type: String,
      trim: true,
      default: null,
    },
    country_of_residence: {
      type: String,
      trim: true,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    ledger_phone: {
      type: String,
      trim: true,
      default: null,
    },
    ledger_contact: {
      type: String,
      trim: true,
      default: null,
    },
    ledger_mobile: {
      type: String,
      trim: true,
      default: null,
    },
    ledger_country_isd_code: {
      type: String,
      trim: true,
      default: null,
    },
    credit_limit: {
      type: Number,
      default: 0,
    },
    gst_details: {
      type: gstDetailSchema,
      default: null,
    },
    led_gst_reg_details: {
      type: ledGstRegDetailSchema,
      default: null,
    },
    payment_details: {
      type: paymentDetailSchema,
      default: null,
    },
    contact_details: {
      type: contactDetailSchema,
      default: null,
    },
    led_mailing_details: {
      type: ledMailingDetailSchema,
      default: null,
    },
    hsn_details: {
      type: hsnDetailSchema,
      default: null,
    },
    synced_at: {
      type: Date,
      default: null,
    },
    ...commonFields,
  },
  {
    timestamps: timeStampObj,
  },
);

const Ledger = model("Ledger", LedgerSchema);
export default Ledger;
