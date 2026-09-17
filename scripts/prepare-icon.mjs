import { execSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const iconPng = join(buildDir, "icon.png");
const iconSvg = join(root, "docs", "icon.svg");

await mkdir(buildDir, { recursive: true });

try {
  await access(iconPng);
  console.log(`Using existing ${iconPng}`);
  process.exit(0);
} catch {
  // generate below
}

try {
  execSync(`qlmanage -t -s 512 -o "${buildDir}" "${iconSvg}"`, { stdio: "pipe" });
  execSync(`mv "${join(buildDir, "icon.svg.png")}" "${iconPng}"`);
  console.log(`Generated ${iconPng} from docs/icon.svg`);
} catch (err) {
  console.warn("Could not generate build/icon.png from docs/icon.svg; electron-builder will use its default icon.");
  console.warn(err instanceof Error ? err.message : String(err));
}
