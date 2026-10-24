import dotenv from "dotenv";
import { seedMenus } from "./src/modules/pages/menu.seed.js";
dotenv.config();

console.log("Step 1: dotenv loaded");

try {
  const dbModule = await import("./src/config/db.js");
  console.log("Step 2: db.js imported");

  const connectDB = dbModule.default;
  await connectDB();
  console.log("Step 3: connected to DB");

  const result = await seedMenus();
  console.log("Seed result:", JSON.stringify(result, null, 2));

  process.exit(0);
} catch (error) {
  console.error("ERROR:", error);
  process.exit(1);
}
