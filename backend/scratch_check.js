import { execSync } from "child_process";

try {
  console.log("=== BACKEND GIT STATUS ===");
  console.log(execSync("git status --short", { cwd: "c:/Office/Tally_project/Tally-Connector-Backend/backend" }).toString());
} catch (e) {
  console.log("Backend git error:", e.message);
}

try {
  console.log("=== MOBILE GIT STATUS ===");
  console.log(execSync("git status --short", { cwd: "c:/Office/Tally_project/Tally-Connector-Mobile" }).toString());
} catch (e) {
  console.log("Mobile git error:", e.message);
}
