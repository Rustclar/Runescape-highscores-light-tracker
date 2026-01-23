import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pluginDir = path.join(root, "com.rustin.rs3.leveltracker2.0.sdPlugin");
const distDir = path.join(root, "dist");

const binPath = path.join(pluginDir, "bin", "plugin.js");
if (fs.existsSync(binPath)) {
  fs.rmSync(binPath);
}

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
