import { Router } from "express";
import {
  getPendingOutboundSyncController,
  ackOutboundSyncController,
  failOutboundSyncController,
} from "./outboundSync.controller.js";

const outboundSyncRouter = Router();

outboundSyncRouter.get("/pending", getPendingOutboundSyncController);
outboundSyncRouter.post("/ack", ackOutboundSyncController);
outboundSyncRouter.post("/fail", failOutboundSyncController);

export default outboundSyncRouter;
