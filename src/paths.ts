import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = join(ROOT, "public");
export const SEED_BOTS_DIR = join(ROOT, "data", "bots");

export function homeDir(): string {
  return process.env.OPENGROKBOT_HOME ?? join(homedir(), ".opengrokbot");
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export async function ensureHome(): Promise<string> {
  const home = homeDir();
  await mkdir(join(home, "bots"), { recursive: true });
  await mkdir(join(home, "transcripts"), { recursive: true });
  await mkdir(join(home, "memory"), { recursive: true });
  await mkdir(join(home, "workspace"), { recursive: true });
  return home;
}
