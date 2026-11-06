import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { SEED_SKILLS_DIR, ensureHome, homeDir } from "./paths.js";
import type { SkillDef } from "./types.js";

/**
 * Skills library: reusable instruction sets stored as markdown files with
 * YAML frontmatter in ~/.opengrokbot/skills/<id>.md. Shared by all Bots.
 * The user invokes one by typing /<id> in chat; the model can also pull
 * one in mid-turn with the skill_read tool when a task matches its
 * description (descriptions are listed in the system prompt).
 */

export const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function skillsDir(): string {
  return join(homeDir(), "skills");
}

export function slugifySkillId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseSkillFile(id: string, raw: string): SkillDef | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  let meta: Record<string, unknown> = {};
  try {
    meta = (parse(m[1]) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : id;
  const description = typeof meta.description === "string" ? meta.description.trim() : "";
  return { id, name, description, body: m[2].trim() };
}

export async function seedSkillsIfNeeded(): Promise<void> {
  await ensureHome();
  const dir = skillsDir();
  const existing = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  if (existing.length > 0) return;
  if (!existsSync(SEED_SKILLS_DIR)) return;
  const seeds = (await readdir(SEED_SKILLS_DIR)).filter((f) => f.endsWith(".md"));
  for (const file of seeds) {
    await copyFile(join(SEED_SKILLS_DIR, file), join(dir, file));
  }
}

export async function listSkills(): Promise<SkillDef[]> {
  await seedSkillsIfNeeded();
  const dir = skillsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const out: SkillDef[] = [];
  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    if (!SKILL_ID_RE.test(id)) continue;
    try {
      const skill = parseSkillFile(id, await readFile(join(dir, file), "utf8"));
      if (skill) out.push(skill);
    } catch {
      /* unreadable file: skip */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(idOrName: string): Promise<SkillDef | undefined> {
  const key = idOrName.toLowerCase();
  const all = await listSkills();
  return all.find((s) => s.id.toLowerCase() === key || s.name.toLowerCase() === key);
}

export async function saveSkill(input: {
  id?: string;
  name: string;
  description?: string;
  body: string;
}): Promise<SkillDef> {
  await ensureHome();
  const name = input.name.trim();
  if (!name) throw new Error("Skill name is required");
  const id = (input.id?.trim() || slugifySkillId(name)).toLowerCase();
  if (!SKILL_ID_RE.test(id)) {
    throw new Error("Skill id must be lowercase letters, digits and dashes");
  }
  const skill: SkillDef = {
    id,
    name,
    description: (input.description ?? "").trim(),
    body: input.body.trim(),
  };
  const front = stringify({ name: skill.name, description: skill.description }).trimEnd();
  await mkdir(skillsDir(), { recursive: true });
  await writeFile(join(skillsDir(), `${id}.md`), `---\n${front}\n---\n\n${skill.body}\n`, "utf8");
  return skill;
}

export async function deleteSkill(id: string): Promise<boolean> {
  if (!SKILL_ID_RE.test(id)) return false;
  const p = join(skillsDir(), `${id}.md`);
  if (!existsSync(p)) return false;
  await unlink(p);
  return true;
}
