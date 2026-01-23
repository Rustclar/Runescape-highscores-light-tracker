import { spawnSync } from "node:child_process";

const result = spawnSync(
  "streamdeck link \"com.rustin.rs3.leveltracker2.0.sdPlugin\"",
  { shell: true, encoding: "utf8" }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (
  output.includes("Plugin already installed") ||
  output.includes("Another plugin with this UUID is already installed")
) {
  console.warn("Plugin already linked; continuing.");
  process.exit(0);
}

process.exit(result.status ?? 1);
