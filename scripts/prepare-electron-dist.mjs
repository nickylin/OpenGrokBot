import { access, mkdir, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { homedir, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronVersion = "41.3.0";
const distDir = join(root, ".cache", "electron-dist");
const electronBinary = join(distDir, "Electron.app", "Contents", "MacOS", "Electron");

try {
  await access(electronBinary);
  console.log(`Using existing Electron dist at ${distDir}`);
  process.exit(0);
} catch {
  // extract below
}

if (platform() !== "darwin") {
  console.warn("prepare-electron-dist: skipped (macOS only)");
  process.exit(0);
}

const zipName = `electron-v${electronVersion}-darwin-${arch() === "arm64" ? "arm64" : "x64"}.zip`;
const cacheRoot = join(homedir(), "Library", "Caches", "electron");
let zipPath = null;

for (const hashDir of await readdir(cacheRoot, { withFileTypes: true })) {
  if (!hashDir.isDirectory()) continue;
  const candidate = join(cacheRoot, hashDir.name, zipName);
  try {
    await access(candidate);
    zipPath = candidate;
    break;
  } catch {
    // try next cache bucket
  }
}

if (!zipPath) {
  console.warn(
    `prepare-electron-dist: ${zipName} not found in ${cacheRoot}; electron-builder will download Electron`,
  );
  process.exit(0);
}

await mkdir(distDir, { recursive: true });
execSync(`unzip -q -o "${zipPath}" -d "${distDir}"`, { stdio: "inherit" });
console.log(`Extracted ${zipName} to ${distDir}`);
