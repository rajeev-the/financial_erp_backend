const fieldExclusions = {
  user: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  company: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  costcenter: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at -alter_id -master_id -company_id",
  group: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  godown: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  ledger: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at -company_id -alter_id -appropriate_for -excise_alloc_type -master_id",
  payable: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  receivable: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  stock: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  voucher: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  stockitem: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  stockgroup: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
  currency: "-__v -is_deleted -deleted_at -deleted_by -updated_at -created_at",
};

export default fieldExclusions;
