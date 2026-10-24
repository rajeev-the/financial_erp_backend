import mongoose from "mongoose";
const PayHeadAllocationSchema = new mongoose.Schema(
    {
        payheadname: String,
        amount: Number,
        isdeemedpositive: Boolean,
    },
    { _id: false }
);
const EmployeeEntrySchema = new mongoose.Schema(
    {
        employeename: String,
        amount: Number,
        payheadallocations: { type: [PayHeadAllocationSchema], default: [] },
    },
    { _id: false }
);

const CategoryListSchema = new mongoose.Schema(
    {
        category: String,
        employeeentries: { type: [EmployeeEntrySchema], default: [] },
    },
    { _id: false }
);
export default CategoryListSchema;
