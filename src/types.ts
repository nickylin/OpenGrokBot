export type BotKind = "bot" | "group";
export type BotStatus = "idle" | "thinking" | "working" | "waiting" | "blocked" | "done";
export type LocalExec = "ask" | "always" | "never";
export type Appearance = "system" | "light" | "dark";
export type DshProfile = "headless" | "web" | "sdk";
export type SchedulerMode = "on" | "off";
export type OnOff = "on" | "off";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type HarnessId = "openai-compatible" | "ollama" | "codex" | "cursor" | "dsh";

export type Settings = {
  harness: HarnessId;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  subagentModel: string;
  reviewModel: string;
  workspace: string;
  memoryDir: string;
  dshProfile: DshProfile;
  browserProfile: string;
  localExec: LocalExec;
  timezone: string;
  scheduler: SchedulerMode;
  appearance: Appearance;
  autoReview: OnOff;
  requireSend: OnOff;
  profileName: string;
  profileColor: string;
  notifications: OnOff;
  openAtLogin: boolean;
};

export type Routine = {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
};

export type Bot = {
  id: string;
  name: string;
  title: string;
  color: string;
  face?: string;
  shape?: string;
  description: string;
  kind: BotKind;
  members?: string[];
  routerId?: string;
  routines: Routine[];
};

export type ApprovalDecision = "allow" | "always" | "deny";

export type FormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "switch"
  | "secret"
  | "otp";

export type FormFieldOption = {
  value: string;
  label: string;
};

export type FormField = {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: FormFieldOption[];
  default?: string;
  help?: string;
  maxLength?: number;
  /** Only for type "secret": key under which the value is stored in the local secrets vault. */
  secretName?: string;
};

/** JSON payload stored in ChatMessage.content for kind === "form" messages. */
export type FormCardPayload = {
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
  /**
   * Filled in after submit. Contains ONLY non-secret values; secret and otp
   * fields appear as { provided: true, last4 } markers — never the raw value.
   */
  values?: Record<string, unknown>;
};

export type FormStatus = "pending" | "submitted" | "cancelled" | "expired";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolName?: string;
  kind?: "text" | "handoff" | "routine" | "approval" | "system" | "form";
  fromBotId?: string;
  routineName?: string;
  decision?: ApprovalDecision;
  /** Only for kind === "form". */
  formStatus?: FormStatus;
};

export type AgentEvent =
  | { type: "status"; botId: string; status: BotStatus; action: string }
  | { type: "message"; botId: string; message: ChatMessage }
  | { type: "delta"; botId: string; text: string; fromBotId?: string }
  | { type: "stream_clear"; botId: string }
  | { type: "tool"; botId: string; name: string; input: string; output: string }
  | { type: "error"; botId: string; error: string }
  | { type: "done"; botId: string };

export function assertNever(value: never, label: string): never {
  throw new Error(`unhandled ${label}: ${String(value)}`);
}
