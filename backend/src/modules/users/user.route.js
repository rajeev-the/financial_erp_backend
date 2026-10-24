import { Router } from "express";
import {
  userSignUp,
  getUser,
  createUser,
  getUsersByCompanyId,
} from "./user.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../utils/response.js";

const userRouter = Router();

userRouter.post("/", authenticate, asyncHandler(createUser));
userRouter.post("/signup", asyncHandler(userSignUp));
userRouter.get(
  "/:companyId",
  authenticate,
  asyncHandler(getUsersByCompanyId),
);
userRouter.get("/:id", authenticate, asyncHandler(getUser));

export default userRouter;


