import type { FormCardPayload, FormField, FormFieldType } from "./types.js";

/**
 * Form schema validation (for model-generated request_form arguments) and
 * submission validation/sanitization.
 *
 * Security contract:
 * - Secret and OTP values are split out of a submission at this boundary.
 *   `displayValues` (persisted to the transcript) and `toolValues` (handed
 *   back to the model) only ever contain { provided: true, last4 } markers
 *   for them. Raw secret values travel exclusively in `secrets`, which the
 *   caller must pass straight to the secrets vault and then drop.
 */

export const FORM_LIMITS = {
  maxFields: 12,
  maxOptions: 20,
  titleMax: 80,
  descriptionMax: 300,
  labelMax: 60,
  helpMax: 200,
  textMax: 500,
  textareaMax: 5000,
  defaultMaxLength: 2000,
} as const;

const FIELD_TYPES: ReadonlySet<string> = new Set<FormFieldType>([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "switch",
  "secret",
  "otp",
]);

const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const SECRET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export type FormSchemaResult =
  | { ok: true; payload: FormCardPayload }
  | { ok: false; error: string };

/** Validate and normalize a request_form tool call's arguments into a card payload. */
export function validateFormSchema(raw: unknown): FormSchemaResult {
  const args = (raw ?? {}) as Record<string, unknown>;
  const title = cleanText(args.title, FORM_LIMITS.titleMax);
  if (!title) return { ok: false, error: "form needs a title" };
  const rawFields = Array.isArray(args.fields) ? args.fields : [];
  if (rawFields.length === 0) return { ok: false, error: "form needs at least one field" };
  if (rawFields.length > FORM_LIMITS.maxFields) {
    return { ok: false, error: `form has too many fields (max ${FORM_LIMITS.maxFields})` };
  }

  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const item of rawFields) {
    const f = (item ?? {}) as Record<string, unknown>;
    const name = String(f.name ?? "").trim();
    if (!FIELD_NAME_RE.test(name)) {
      return { ok: false, error: `invalid field name "${name}" (use [a-z][a-z0-9_]*)` };
    }
    if (seen.has(name)) return { ok: false, error: `duplicate field name "${name}"` };
    seen.add(name);
    const type = String(f.type ?? "") as FormFieldType;
    if (!FIELD_TYPES.has(type)) return { ok: false, error: `field "${name}" has unknown type` };
    const label = cleanText(f.label, FORM_LIMITS.labelMax) || name;

    const field: FormField = { name, label, type };
    if (f.required === true) field.required = true;
    const help = cleanText(f.help, FORM_LIMITS.helpMax);
    if (help) field.help = help;
    if (typeof f.default === "string" && f.default) field.default = f.default.slice(0, 200);
    if (typeof f.maxLength === "number" && Number.isFinite(f.maxLength) && f.maxLength > 0) {
      field.maxLength = Math.min(Math.floor(f.maxLength), FORM_LIMITS.textareaMax);
    }

    if (type === "select" || type === "multiselect") {
      const rawOptions = Array.isArray(f.options) ? f.options : [];
      if (rawOptions.length === 0) {
        return { ok: false, error: `field "${name}" needs options` };
      }
      if (rawOptions.length > FORM_LIMITS.maxOptions) {
        return { ok: false, error: `field "${name}" has too many options (max ${FORM_LIMITS.maxOptions})` };
      }
      field.options = rawOptions.map((o) => {
        const opt = (o ?? {}) as Record<string, unknown>;
        return {
          value: cleanText(opt.value, 60),
          label: cleanText(opt.label, 60) || cleanText(opt.value, 60),
        };
      });
      if (field.options.some((o) => !o.value)) {
        return { ok: false, error: `field "${name}" has an option without a value` };
      }
    }

    if (type === "secret") {
      const secretName = String(f.secretName ?? name).trim();
      if (!SECRET_NAME_RE.test(secretName)) {
        return { ok: false, error: `field "${name}" has an invalid secretName` };
      }
      field.secretName = secretName;
    }
    fields.push(field);
  }

  const payload: FormCardPayload = { title, fields };
  const description = cleanText(args.description, FORM_LIMITS.descriptionMax);
  if (description) payload.description = description;
  const submitLabel = cleanText(args.submitLabel, 30);
  if (submitLabel) payload.submitLabel = submitLabel;
  return { ok: true, payload };
}

export type SecretSubmission = {
  /** Vault key. */
  name: string;
  /** Raw value — caller must store it in the vault and never log or echo it. */
  value: string;
  last4: string;
};

export type SubmissionResult =
  | {
      ok: true;
      /** Safe to persist in the transcript (secrets are masked markers). */
      displayValues: Record<string, unknown>;
      /** Safe to hand back to the model as the tool result. */
      toolValues: Record<string, unknown>;
      secrets: SecretSubmission[];
      /** Field names of OTP inputs: provided, but value is discarded by design in v1. */
      otpsProvided: string[];
    }
  | { ok: false; errors: Record<string, string> };

function last4Of(value: string): string {
  return value.slice(-4);
}

/** Validate a user submission against the card schema. Never trust the client. */
export function validateSubmission(
  payload: FormCardPayload,
  rawValues: unknown,
): SubmissionResult {
  const raw = (rawValues ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const displayValues: Record<string, unknown> = {};
  const toolValues: Record<string, unknown> = {};
  const secrets: SecretSubmission[] = [];
  const otpsProvided: string[] = [];

  for (const field of payload.fields) {
    const value = raw[field.name];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (missing) {
      if (field.required) errors[field.name] = "Required";
      continue;
    }

    switch (field.type) {
      case "secret": {
        const v = String(value);
        if (v.length > 1000) {
          errors[field.name] = "Too long";
          break;
        }
        secrets.push({ name: field.secretName ?? field.name, value: v, last4: last4Of(v) });
        const marker = { provided: true, last4: last4Of(v) };
        displayValues[field.name] = marker;
        toolValues[field.name] = {
          provided: true,
          ref: field.secretName ?? field.name,
          last4: last4Of(v),
        };
        break;
      }
      case "otp": {
        // v1: an OTP is never stored and never handed to the model. We only
        // record that one was provided; see DESIGN §6.4.
        otpsProvided.push(field.name);
        const marker = { provided: true };
        displayValues[field.name] = marker;
        toolValues[field.name] = marker;
        break;
      }
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) {
          errors[field.name] = "Must be a number";
          break;
        }
        displayValues[field.name] = n;
        toolValues[field.name] = n;
        break;
      }
      case "switch": {
        const b = value === true || value === "true" || value === 1 || value === "1";
        displayValues[field.name] = b;
        toolValues[field.name] = b;
        break;
      }
      case "date": {
        const v = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
          errors[field.name] = "Must be a date (YYYY-MM-DD)";
          break;
        }
        displayValues[field.name] = v;
        toolValues[field.name] = v;
        break;
      }
      case "select": {
        const v = String(value);
        if (!(field.options ?? []).some((o) => o.value === v)) {
          errors[field.name] = "Not one of the options";
          break;
        }
        displayValues[field.name] = v;
        toolValues[field.name] = v;
        break;
      }
      case "multiselect": {
        const arr = (Array.isArray(value) ? value : [value]).map(String);
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (arr.some((v) => !allowed.has(v))) {
          errors[field.name] = "Contains an unknown option";
          break;
        }
        displayValues[field.name] = arr;
        toolValues[field.name] = arr;
        break;
      }
      default: {
        const max =
          field.maxLength ??
          (field.type === "textarea" ? FORM_LIMITS.textareaMax : FORM_LIMITS.defaultMaxLength);
        const v = String(value).slice(0, max);
        displayValues[field.name] = v;
        toolValues[field.name] = v;
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, displayValues, toolValues, secrets, otpsProvided };
}
