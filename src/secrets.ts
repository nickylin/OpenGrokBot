import { getSecretValue, listSecretValues } from "./store.js";

/**
 * ${secret:name} placeholder substitution + output masking (v0.4).
 *
 * The contract from the v0.3 design holds: raw secret values exist only in
 * the vault and, briefly, inside a local execution (a shell argv, an MCP
 * server's env). They must never reach the model, the transcript, or the
 * logs. So:
 *
 * - substituteSecrets() runs at the last moment before a local exec, on
 *   this machine only. The model writes the placeholder, never the value.
 * - maskSecrets() runs on every tool result before the model (or the
 *   transcript) sees it, scrubbing any exact secret value that a command
 *   or server echoed back.
 */

export const SECRET_PLACEHOLDER_RE = /\$\{secret:([a-z0-9][a-z0-9._-]{0,79})\}/g;

export const MASK = "•••";

/** Values shorter than this are not masked: too likely to be common words. */
const MIN_MASK_LENGTH = 4;

export function findSecretPlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(SECRET_PLACEHOLDER_RE)) names.add(m[1]);
  return [...names];
}

export type SubstituteResult =
  | { ok: true; text: string; used: string[] }
  | { ok: false; missing: string[] };

/** Replace every ${secret:name} in `text` with its vault value. */
export async function substituteSecrets(text: string): Promise<SubstituteResult> {
  const names = findSecretPlaceholders(text);
  if (names.length === 0) return { ok: true, text, used: [] };
  let out = text;
  const missing: string[] = [];
  for (const name of names) {
    const value = await getSecretValue(name);
    if (value === undefined) {
      missing.push(name);
      continue;
    }
    out = out.split(`\${secret:${name}}`).join(value);
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, text: out, used: names };
}

/** Substitute placeholders inside a record of env values (for MCP spawns). Missing names are dropped with a note. */
export async function substituteSecretsInEnv(
  env: Record<string, string>,
): Promise<{ env: Record<string, string>; missing: string[] }> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, raw] of Object.entries(env)) {
    const res = await substituteSecrets(raw);
    if (res.ok) out[key] = res.text;
    else missing.push(...res.missing.map((n) => `${key}: ${n}`));
  }
  return { env: out, missing };
}

export async function maskSecrets(text: string): Promise<string> {
  if (!text) return text;
  const values = (await listSecretValues())
    .filter((v) => v.length >= MIN_MASK_LENGTH)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const value of values) {
    if (out.includes(value)) out = out.split(value).join(MASK);
  }
  return out;
}
