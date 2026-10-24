import dotenv from "dotenv";
dotenv.config();
import express from "express";
import connectDB from "./src/config/db.js";
import envConfig from "./src/config/env.js";
import cors from "cors";

// Route imports
import menuRouter from "./src/modules/pages/menu.route.js";
import userRouter from "./src/modules/users/user.route.js";
import permissionsRouter from "./src/modules/pages/permissions.route.js";
import tenantRouter from "./src/modules/tenant/tenant.route.js";
import companyRouter from "./src/modules/companies/company.route.js";
import  authRouter  from "./src/modules/auth/auth.routes.js";
import tallyRouter from "./src/modules/tally/tally.main.route.js";
import ExpenseRouter from "./src/modules/tally/Expense/expenserouter.js";
import dashboardRouter from "./src/modules/dasboard/dasboard.routes.js";
import complianceRouter from "./src/modules/compliance/compliance.routes.js";
import masterRouter from "./src/modules/master/master.route.js";
import erpMainRouter from "./src/modules/erp/erp.main.route.js";

const app = express();
const PORT = envConfig.PORT || 3000;

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "https://tally-dev.aventiq.ai",
  "https://tally.aventiq.ai",
];

// ---- Middleware ----
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use(cors({
  origin: envConfig.CORS_ORIGIN || DEFAULT_CORS_ORIGINS,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));
// ---- Request & Response Console Logger Middleware ----
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusSymbol = status >= 400 ? "❌" : "✅";
    console.log(
      `${statusSymbol} [API LOG] ${method} ${originalUrl} -> Status: ${status} (${duration}ms)`,
    );
  });

  next();
});

// ---- Routes ----
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/menu", menuRouter);
app.use("/api/v1/user", userRouter);
app.use("/api/v1/permissions", permissionsRouter);
app.use("/api/v1/tenant", tenantRouter);
app.use("/api/v1/company", companyRouter);
app.use("/api/v1/tally", tallyRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/dasboard", dashboardRouter); // Mobile app backwards compatibility
app.use("/api/v1/compliance", complianceRouter);
app.use("/api/database/master", masterRouter);
app.use("/api/master", masterRouter);
app.use("/api/v1/erp", erpMainRouter);

// ---- Health check (useful for uptime monitors / load balancers) ----
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ---- 404 handler ----
app.use((req, res) => {
  console.log(`⚠️ [404 NOT FOUND] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: "Route not found" });
});

// ---- Centralized error handler ----
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;

  if (status >= 500) {
    console.error(
      `💥 [API ERROR] ${req.method} ${req.originalUrl}:`,
      err.stack || err,
    );
  } else {
    console.warn(
      `⚠️ [API WARNING] ${req.method} ${req.originalUrl}: ${status} - ${err.message}`,
    );
  }

  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(err.details !== undefined && { details: err.details }),
  });
});

// ---- Server startup ----
const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT,"0.0.0.0", () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start the server:", error.message);
    process.exit(1);
  }
};

startServer();
