import { Router } from "express";
import { asyncHandler } from "../../../utils/response.js";
import { getExpenseCalculation } from "./expense.js";
import { getExpenseGroupLedger } from "./expense.controller.js";

const ExpenseRouter = Router();

ExpenseRouter.get("/cal/:companyId", asyncHandler(getExpenseCalculation));


ExpenseRouter.get("/party/:companyId", asyncHandler(getExpenseGroupLedger));


export default ExpenseRouter;