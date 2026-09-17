import { cp, mkdir, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, ".pack", "server");

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

for (const dir of ["dist", "public", "data"]) {
  await cp(join(root, dir), join(stage, dir), { recursive: true });
}

await cp(join(root, "package.json"), join(stage, "package.json"));

// npm yields a flat node_modules tree for electron-builder extraResources copies.
execSync("npm install --omit=dev --ignore-scripts --no-package-lock", {
  cwd: stage,
  stdio: "inherit",
});
console.log(`Staged server bundle at ${stage}`);
