import { Router } from "express";
import { getMenus, createMenu, updateMenu } from "./menu.controller.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const menuRouter = Router();

menuRouter.get("/", asyncHandler(getMenus));
menuRouter.post("/", asyncHandler(createMenu));
menuRouter.put("/:id", asyncHandler(updateMenu));

export default menuRouter;
