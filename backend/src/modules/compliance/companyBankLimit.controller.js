import CompanyBankLimit from "./companyBankLimit.schema.js";

export const getCompanyBankLimits = async (req, res) => {
  const companyId =
    req.query.company_id ||
    req.query.companyId ||
    req.query.company_uuid ||
    req.body?.company_id ||
    req.body?.companyId;

  const query = companyId ? { company_id: String(companyId) } : {};
  const bankLimits = await CompanyBankLimit.find(query).sort({
    monthlyBillingDueDate: 1,
    createdAt: -1,
  });

  return res.status(200).json({
    success: true,
    data: bankLimits.map((doc) => doc.toJSON()),
  });
};

export const createCompanyBankLimit = async (req, res) => {
  const companyId =
    req.body.company_id ||
    req.body.companyId ||
    req.query.company_id ||
    req.query.companyId;

  const tenantId = req.body.tenant_id || req.query.tenant_id || null;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "company_id is required",
    });
  }

  const newBankLimit = new CompanyBankLimit({
    company_id: String(companyId),
    tenant_id: tenantId ? String(tenantId) : null,
    bankName: req.body.bankName,
    cardNumber: req.body.cardNumber || "",
    userName: req.body.userName,
    dateOfJoining: req.body.dateOfJoining ? new Date(req.body.dateOfJoining) : null,
    yearlyLimit: req.body.yearlyLimit != null ? Number(req.body.yearlyLimit) : 0,
    usedLimit: req.body.usedLimit != null ? Number(req.body.usedLimit) : 0,
    balanceLimit: req.body.balanceLimit != null ? Number(req.body.balanceLimit) : 0,
    monthlyBillingDueDate: req.body.monthlyBillingDueDate
      ? new Date(req.body.monthlyBillingDueDate)
      : null,
    monthlyBillingStatus: req.body.monthlyBillingStatus || "Pending",
    cardStatus: req.body.cardStatus || "Active",
    monthlyBreakdown: req.body.monthlyBreakdown || [],
  });

  await newBankLimit.save();

  return res.status(201).json({
    success: true,
    message: "Company bank limit created successfully",
    data: newBankLimit.toJSON(),
  });
};

export const updateCompanyBankLimit = async (req, res) => {
  const id = req.body.id || req.body._id || req.params.id;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Bank limit ID is required",
    });
  }

  const updateData = { ...req.body };
  delete updateData.id;
  delete updateData._id;

  if (updateData.dateOfJoining) {
    updateData.dateOfJoining = new Date(updateData.dateOfJoining);
  }
  if (updateData.monthlyBillingDueDate) {
    updateData.monthlyBillingDueDate = new Date(updateData.monthlyBillingDueDate);
  }
  if (updateData.yearlyLimit != null) {
    updateData.yearlyLimit = Number(updateData.yearlyLimit);
  }
  if (updateData.usedLimit != null) {
    updateData.usedLimit = Number(updateData.usedLimit);
  }
  if (updateData.balanceLimit != null) {
    updateData.balanceLimit = Number(updateData.balanceLimit);
  }

  const updated = await CompanyBankLimit.findByIdAndUpdate(id, updateData, {
    new: true,
  });

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: "Bank limit record not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Company bank limit updated successfully",
    data: updated.toJSON(),
  });
};

export const deleteCompanyBankLimit = async (req, res) => {
  const id = req.body.id || req.query.id || req.params.id;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Bank limit ID is required",
    });
  }

  await CompanyBankLimit.findByIdAndDelete(id);

  return res.status(200).json({
    success: true,
    message: "Company bank limit deleted successfully",
  });
};

export const deleteAllCompanyBankLimits = async (req, res) => {
  const companyId =
    req.body.company_id ||
    req.body.companyId ||
    req.query.company_id ||
    req.query.companyId;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: "company_id is required",
    });
  }

  await CompanyBankLimit.deleteMany({ company_id: String(companyId) });

  return res.status(200).json({
    success: true,
    message: "All company bank limits deleted successfully",
  });
};
