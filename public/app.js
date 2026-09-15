const $ = (id) => document.getElementById(id);

const FACE_IDS = ["smile", "calm", "grin", "sleepy", "wink", "wide", "glasses", "dots"];
const SHAPE_IDS = ["circle", "oval", "squircle", "pill", "triangle", "hexagon", "cloud", "teardrop"];
const SHAPE_LABELS = {
  circle: "Circle",
  oval: "Oval",
  squircle: "Rounded square",
  pill: "Pill",
  triangle: "Triangle",
  hexagon: "Hexagon",
  cloud: "Cloud",
  teardrop: "Teardrop",
};
const BOT_COLORS = [
  "#5EC8B5",
  "#F5A54A",
  "#4A6FA5",
  "#8B6CF7",
  "#3D8BFF",
  "#E07A3D",
  "#E8B86D",
  "#6BA368",
  "#D46A8A",
  "#C9A227",
  "#5B8C7A",
  "#C47A5A",
];

function asFace(id) {
  return FACE_IDS.includes(id) ? id : "smile";
}

function asShape(id) {
  return SHAPE_IDS.includes(id) ? id : "circle";
}

const PARALLEL_EYE_SHAPES = new Set(["triangle", "hexagon", "cloud"]);

/** Per-shape face inset: scale + anchor so features stay inside the silhouette. */
function featureTransform(shape) {
  switch (asShape(shape)) {
    case "triangle":
      return "translate(32 32) scale(0.62) translate(-32 -28)";
    case "hexagon":
      return "translate(32 35) scale(0.74) translate(-32 -31)";
    case "cloud":
      return "translate(34 30) scale(0.72) translate(-32 -28)";
    case "teardrop":
      return "translate(32 34) scale(0.82) translate(-32 -30)";
    case "pill":
      return "translate(32 32) scale(0.84) translate(-32 -30)";
    case "oval":
      return "translate(32 32) scale(0.9) translate(-32 -29)";
    default:
      return "";
  }
}

function featureTransformAttr(shape) {
  const t = featureTransform(shape);
  return t ? ` transform="${t}"` : "";
}

function shapePath(shape) {
  switch (asShape(shape)) {
    case "oval":
      return "M28 9 C46 7 58 17 56 31 C58 47 44 57 28 55 C12 53 6 39 9 25 C7 13 16 10 28 9 Z";
    case "squircle":
      return "M24 11 H40 Q52 11 52 23 V41 Q52 53 40 53 H24 Q12 53 12 41 V23 Q12 11 24 11 Z";
    case "pill":
      return "M8 18 H56 A14 14 0 0 1 56 46 H8 A14 14 0 0 1 8 18 Z";
    case "triangle":
      return "M32 8 C38 8 53 46 54 51 C54 55 10 55 10 51 C10 46 26 8 32 8 Z";
    case "hexagon":
      return "M32 8 L51 19 Q54 21 54 25 V39 Q54 43 51 45 L32 56 L13 45 Q10 43 10 39 V25 Q10 21 13 19 Z";
    case "cloud":
      return "M12 38 C6 38 4 32 8 27 C6 20 14 16 22 18 C24 10 34 8 42 14 C50 12 58 18 56 26 C61 30 58 40 49 42 C44 49 32 51 22 49 C16 51 12 45 12 38 Z";
    case "teardrop":
      return "M32 7 C32 7 54 32 54 42 C54 56 44 58 32 58 C20 58 10 56 10 42 C10 32 32 7 32 7 Z";
    default:
      return "";
  }
}

const CUTE_MOUTH =
  '<path class="mouth" d="M21 40c6 8 16 8 22 0" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round"/>';

function cuteEyes(shape) {
  const id = asShape(shape);
  const y = PARALLEL_EYE_SHAPES.has(id) ? 24 : 27;
  const tilt = PARALLEL_EYE_SHAPES.has(id) ? 14 : 10;
  return `<g class="eyes">
    <ellipse class="eye" cx="24" cy="${y}" rx="4" ry="5.4" fill="#111" transform="rotate(-${tilt} 24 ${y})"/>
    <ellipse class="eye" cx="40" cy="${y}" rx="4" ry="5.4" fill="#111" transform="rotate(${tilt} 40 ${y})"/>
  </g>`;
}

function parallelEyes() {
  return `<g class="eyes">
    <ellipse class="eye" cx="24" cy="28" rx="3.8" ry="5.2" fill="#111" transform="rotate(-16 24 28)"/>
    <ellipse class="eye" cx="40" cy="28" rx="3.8" ry="5.2" fill="#111" transform="rotate(-16 40 28)"/>
  </g>`;
}

function waitingEyes() {
  return `<g class="eyes">
    <rect class="eye" x="19" y="27" width="10" height="2.8" rx="1.4" fill="#111" transform="rotate(-6 24 28)"/>
    <rect class="eye" x="35" y="27" width="10" height="2.8" rx="1.4" fill="#111" transform="rotate(-6 40 28)"/>
  </g>`;
}

function doneEyes() {
  return `<g class="eyes">
    <ellipse class="eye" cx="24" cy="28" rx="3.2" ry="4.8" fill="#111"/>
    <ellipse class="eye" cx="40" cy="28" rx="3.2" ry="4.8" fill="#111"/>
  </g>`;
}

function officialEyes(shape) {
  const id = asShape(shape);
  if (PARALLEL_EYE_SHAPES.has(id)) {
    return `<g class="eyes">
      <path class="eye" d="M35 22l-6 5" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>
      <path class="eye" d="M43 22l-6 5" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>
    </g>`;
  }
  const shift = id === "pill" ? ' transform="translate(0,1)"' : "";
  return `<g class="eyes"${shift}>
    <path class="eye" d="M21 26l6 4" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>
    <path class="eye" d="M37 30l6-4" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

function officialEyesForState(shape, status) {
  switch (statusClass(status)) {
    case "working":
      return parallelEyes();
    case "waiting":
    case "blocked":
      return waitingEyes();
    case "done":
      return doneEyes();
    case "thinking":
    case "idle":
    default:
      return cuteEyes(shape);
  }
}

function officialMouthForState(status) {
  switch (statusClass(status)) {
    case "waiting":
    case "blocked":
      return `<path class="mouth" d="M27 43h10" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`;
    default:
      return CUTE_MOUTH;
  }
}

function shapePreview(color, shape) {
  const c = cssColor(color);
  const clip = shapeClip(shape, c);
  return `<svg viewBox="0 0 64 64" class="face" aria-hidden="true">
    <defs>${clip.defs}</defs>
    ${shapeBall(shape, c)}
    <g class="features" clip-path="${clip.ref}"${featureTransformAttr(shape)}>${officialEyes(shape)}</g>
  </svg>`;
}

function shapeBall(shape, color) {
  const id = asShape(shape);
  const c = color;
  if (id === "circle") {
    return `<circle class="ball" cx="32" cy="32" r="28" fill="${c}"/>`;
  }
  return `<path class="ball" d="${shapePath(id)}" fill="${c}"/>`;
}

function shapeClip(shape, color) {
  const c = cssColor(color);
  const clipId = `clip-${asShape(shape)}-${c.slice(1)}`;
  const d = shapePath(shape);
  const inner =
    asShape(shape) === "circle"
      ? `<circle cx="32" cy="32" r="28"/>`
      : `<path d="${d}"/>`;
  return { clipId, defs: `<clipPath id="${clipId}">${inner}</clipPath>`, ref: `url(#${clipId})` };
}

function faces(color, face, shape, life) {
  const c = cssColor(color);
  const id = asFace(face);
  let eyes = cuteEyes(shape);
  let mouth = CUTE_MOUTH;
  switch (id) {
    case "calm":
      eyes = `<g class="eyes">
        <rect class="eye" x="20" y="27" width="9" height="2.4" rx="1.2" fill="#111"/>
        <rect class="eye" x="35" y="27" width="9" height="2.4" rx="1.2" fill="#111"/>
      </g>`;
      mouth = `<path class="mouth" d="M27 43h10" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`;
      break;
    case "grin":
      eyes = `<g class="eyes">
        <ellipse class="eye" cx="24" cy="27" rx="4.6" ry="4.2" fill="#111"/>
        <ellipse class="eye" cx="40" cy="27" rx="4.6" ry="4.2" fill="#111"/>
      </g>`;
      mouth = `<path class="mouth" d="M22 40c5 7 15 7 20 0" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>`;
      break;
    case "sleepy":
      eyes = `<g class="eyes">
        <path class="eye" d="M19 29c3-4 8-4 11 0" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>
        <path class="eye" d="M34 29c3-4 8-4 11 0" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>
      </g>`;
      mouth = `<path class="mouth" d="M26 43c3 2 9 2 12 0" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`;
      break;
    case "wink":
      eyes = `<g class="eyes">
        <path class="eye" d="M19 28h11" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round"/>
        <ellipse class="eye" cx="40" cy="28" rx="4.2" ry="5" fill="#111"/>
      </g>`;
      break;
    case "wide":
      eyes = `<g class="eyes">
        <circle class="eye" cx="24" cy="28" r="6" fill="#111"/>
        <circle class="eye" cx="40" cy="28" r="6" fill="#111"/>
        <circle cx="25.5" cy="26.5" r="1.6" fill="#f4f4f5"/>
        <circle cx="41.5" cy="26.5" r="1.6" fill="#f4f4f5"/>
      </g>`;
      mouth = `<ellipse class="mouth" cx="32" cy="44" rx="3.2" ry="2.4" fill="#111"/>`;
      break;
    case "glasses":
      eyes = `<g class="eyes">
        <ellipse class="eye" cx="23" cy="28" rx="3.4" ry="4" fill="#111"/>
        <ellipse class="eye" cx="41" cy="28" rx="3.4" ry="4" fill="#111"/>
        <circle cx="23" cy="28" r="8" fill="none" stroke="#111" stroke-width="2"/>
        <circle cx="41" cy="28" r="8" fill="none" stroke="#111" stroke-width="2"/>
        <path d="M31 28h2" stroke="#111" stroke-width="2" stroke-linecap="round"/>
      </g>`;
      break;
    case "dots":
      eyes = `<g class="eyes">
        <circle class="eye" cx="24" cy="28" r="3.2" fill="#111"/>
        <circle class="eye" cx="40" cy="28" r="3.2" fill="#111"/>
      </g>`;
      mouth = "";
      break;
    case "smile":
      eyes = cuteEyes(shape);
      break;
    default:
      break;
  }
  if (life) {
    const st = statusClass(life);
    if (st !== "idle") {
      eyes = officialEyesForState(shape, st);
      if (st === "waiting" || st === "blocked" || st === "done") {
        mouth = officialMouthForState(st);
      }
    }
  }
  const clip = shapeClip(shape, c);
  return `<svg viewBox="0 0 64 64" class="face" aria-hidden="true">
    <defs>${clip.defs}</defs>
    ${shapeBall(shape, c)}
    <g class="features" clip-path="${clip.ref}"${featureTransformAttr(shape)}>${eyes}${mouth}</g>
  </svg>`;
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const defaultCfg = {
  harness: "openai-compatible",
  provider: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  subagentModel: "deepseek-chat",
  reviewModel: "",
  workspace: "~/.opengrokbot/workspace",
  memoryDir: "~/.opengrokbot/memory",
  dshProfile: "headless",
  browserProfile: "~/.opengrokbot/chrome-profile",
  localExec: "ask",
  timezone: defaultTimezone(),
  scheduler: "on",
  appearance: "dark",
  autoReview: "on",
  requireSend: "on",
  profileName: "You",
  profileColor: "#E8B86D",
};

const PROFILE_COLORS = ["#E8B86D", "#5EC8B5", "#F5A54A", "#4A6FA5", "#8B6CF7", "#3D8BFF", "#E07A3D"];

let bots = [];
let messages = [];
let selected = "";
let computer = "off";
let cfg = { ...defaultCfg };
let setPane = "harness";
let query = "";
let sending = false;
let lastTool = "";
let saveTimer = 0;
let harnesses = [];
let createLook = { color: BOT_COLORS[0], face: "smile", shape: "circle" };
let groupPicks = new Set();

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssColor(c) {
  const s = String(c ?? "");
  return /^#[0-9A-Fa-f]{3,8}$/.test(s) ? s : "#7c5cff";
}

function mentionBots() {
  return bots
    .filter((b) => b.kind !== "group" && b.name)
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
}

function mentionChip(bot, interactive) {
  const name = esc(bot.name);
  const color = cssColor(bot.color);
  const label = esc(`Open ${bot.name}`);
  if (interactive) {
    return `<button type="button" class="mention" data-bot-id="${esc(bot.id)}" aria-label="${label}" style="--mention:${color}">@${name}</button>`;
  }
  return `<span class="mention" style="--mention:${color}">@${name}</span>`;
}

function linkMentions(html, opts = {}) {
  const interactive = opts.interactive !== false;
  const named = mentionBots();
  if (!named.length) return html;
  const chips = [];
  let out = String(html ?? "");
  for (const b of named) {
    const re = new RegExp(`@${escapeRegExp(esc(b.name))}(?![\\w])`, "gi");
    out = out.replace(re, (match, offset, str) => {
      const before = str.slice(0, offset);
      const lastLt = before.lastIndexOf("<");
      const lastGt = before.lastIndexOf(">");
      if (lastLt > lastGt) return match;
      const i = chips.length;
      chips.push(mentionChip(b, interactive));
      return `\u0000M${i}\u0000`;
    });
  }
  return out.replace(/\u0000M(\d+)\u0000/g, (_, i) => chips[Number(i)]);
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let err = res.statusText;
    try {
      const body = await res.json();
      err = body.error || err;
    } catch {
      /* ignore */
    }
    throw new Error(err);
  }
  if (res.status === 204) return null;
  return res.json();
}

function statusClass(status) {
  switch (status) {
    case "thinking":
    case "working":
    case "waiting":
    case "blocked":
    case "done":
      return status;
    default:
      return "idle";
  }
}

function avatarMotionVars(seed) {
  let h = 0;
  for (const ch of String(seed ?? "0")) h = (Math.imul(31, h) + ch.charCodeAt(0)) >>> 0;
  const delay = ((h % 6400) / 1000).toFixed(2);
  const dur = (6.2 + ((h >>> 8) % 4200) / 1000).toFixed(2);
  const mouthDelay = (((h >>> 4) % 5600) / 1000).toFixed(2);
  const mouthDur = (5.2 + ((h >>> 12) % 3400) / 1000).toFixed(2);
  return `--face-delay:${delay}s;--face-dur:${dur}s;--mouth-delay:${mouthDelay}s;--mouth-dur:${mouthDur}s`;
}

function faceShell(color, face, st, seed, shape) {
  const motion = avatarMotionVars(seed);
  const life = st !== "idle" ? st : undefined;
  return `<div class="avatar ${st}" style="${motion}"><div class="head">${faces(color, face, shape, life)}</div></div>`;
}

function avatarEl(bot) {
  if (!bot) return faceShell("#8e8e93", "smile", "idle", "default", "circle");
  const st = statusClass(bot.status);
  if (bot.kind === "group") {
    const members = (bot.members ?? []).map((id) => bots.find((b) => b.id === id)).filter(Boolean);
    const shells = (members.length ? members : [{ id: bot.id, color: bot.color, face: bot.face, shape: bot.shape }]).map(
      (m) =>
        `<div class="avatar ${st}" style="${avatarMotionVars(m.id)}"><div class="head">${faces(m.color, m.face, m.shape, st !== "idle" ? st : undefined)}</div></div>`,
    );
    return `<div class="stack ${st}" style="${avatarMotionVars(bot.id)}">${shells.join("")}</div>`;
  }
  return faceShell(bot.color, bot.face, st, bot.id, bot.shape);
}

function currentBot() {
  return bots.find((b) => b.id === selected) || bots[0];
}

function renderRoster() {
  const q = query.trim().toLowerCase();
  const rows = bots.filter((b) => {
    if (!q) return true;
    return `${b.name} ${b.title} ${b.preview}`.toLowerCase().includes(q);
  });
  $("roster").innerHTML = rows
    .map(
      (b) => `
    <button class="row ${b.id === selected ? "active" : ""}" data-id="${esc(b.id)}" aria-label="${esc(b.name)}${b.action && b.action !== "Idle" ? ` · ${esc(b.action)}` : ""}">
      ${avatarEl(b)}
      <span class="tip" aria-hidden="true">${esc(b.action || "Idle")}</span>
      <div class="meta">
        <div class="name">${esc(b.name)} ${
          b.status === "blocked"
            ? `<span class="attn need"></span>`
            : b.status === "waiting"
              ? `<span class="attn unread"></span>`
              : ""
        }</div>
        <div class="preview-line">${linkMentions(esc(b.preview || ""), { interactive: false })}</div>
      </div>
      <div class="when">${esc(b.time || "")}</div>
    </button>`,
    )
    .join("");
}

function bubbleHtml(text) {
  const fences = [];
  let src = String(text ?? "");
  src = src.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const i = fences.length;
    fences.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000F${i}\u0000`;
  });
  let html = esc(src);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  html = linkMentions(html);
  html = html.replace(/\n/g, "<br>");
  return html.replace(/\u0000F(\d+)\u0000/g, (_, i) => fences[Number(i)]);
}

function looksLikeClientDump(s) {
  const t = String(s ?? "");
  return (
    /try\s*\{\s*!function/.test(t) ||
    /__webpack_require__|webpackBootstrap|webpackJsonp/.test(t) ||
    /\/usr\/local\/Caskroom/.test(t) ||
    /dist-package\/index\.js/.test(t) ||
    (/Harness error:/i.test(t) && t.length > 240) ||
    (t.length > 240 && /index\.js:\d+/.test(t))
  );
}

function systemBubbleText(content) {
  if (looksLikeClientDump(content)) {
    return "This engine couldn’t run that turn. Check Harness, or switch engine.";
  }
  return String(content ?? "");
}

function parseRoutedHandoff(content) {
  const t = String(content ?? "");
  const m = t.match(/^\[(?:Handoff from|from) ([^\]]+)\]\s*([\s\S]*)$/i);
  if (!m) return null;
  return { from: m[1].trim(), body: (m[2] || "").trim() };
}

function renderIncomingHandoff(m, enter) {
  const parsed = parseRoutedHandoff(m.content);
  const fromBot =
    (m.fromBotId && bots.find((b) => b.id === m.fromBotId)) ||
    (parsed && bots.find((b) => b.kind !== "group" && b.name.toLowerCase() === parsed.from.toLowerCase()));
  const fromName = fromBot?.name || parsed?.from || "teammate";
  const body = parsed ? parsed.body : String(m.content ?? "");
  const av = `<span class="handoff-av" aria-hidden="true">${faces(fromBot?.color || "#8e8e93", fromBot?.face, fromBot?.shape)}</span>`;
  const who = fromBot
    ? `<button type="button" class="handoff-who" data-bot-id="${esc(fromBot.id)}" aria-label="${esc(`Open ${fromName}`)}">${esc(fromName)}</button>`
    : `<span class="handoff-who">${esc(fromName)}</span>`;
  return `<div class="handoff-card${enter}">
    ${av}
    <div class="handoff-copy">
      <div class="handoff-kicker">Handoff from ${who}</div>
      ${body ? `<div class="handoff-body">${linkMentions(esc(body))}</div>` : ""}
    </div>
  </div>`;
}

function renderMessage(m, fresh) {
  const enter = fresh ? " fresh" : "";
  if (m.role === "tool") return "";
  const kind = m.kind || "text";
  const routed = parseRoutedHandoff(m.content);
  if (m.role === "user" && (kind === "handoff" || routed)) {
    return renderIncomingHandoff(m, enter);
  }
  if (kind === "handoff") return `<div class="handoff${enter}">${linkMentions(esc(m.content))}</div>`;
  if (kind === "routine") return `<div class="routine-chip${enter}">${linkMentions(esc(m.content))}</div>`;
  if (kind === "system" || looksLikeClientDump(m.content)) {
    return `<div class="sys${enter}">${linkMentions(esc(systemBubbleText(m.content)))}</div>`;
  }
  if (kind === "approval") {
    let title = "Allow this action?";
    let body = m.content;
    try {
      const parsed = JSON.parse(m.content);
      title = parsed.title || title;
      body = parsed.body || body;
    } catch {
      /* plain text */
    }
    const done = Boolean(m.decision);
    const outcome =
      m.decision === "allow"
        ? "Allowed once."
        : m.decision === "always"
          ? "Always allow saved."
          : m.decision === "deny"
            ? "Denied. Nothing ran."
            : "";
    return `<div class="approval${done ? " done" : ""}${enter}" data-id="${esc(m.id)}">
      <h3>${linkMentions(esc(title))}</h3>
      <p>${linkMentions(esc(body))}</p>
      ${done ? `<p class="outcome">${esc(outcome)}</p>` : `<div class="actions">
        <button class="btn primary" data-act="allow">Allow once</button>
        <button class="btn ghost" data-act="always">Always allow</button>
        <button class="btn danger" data-act="deny">Deny</button>
      </div>`}
    </div>`;
  }
  if (m.role === "user") {
    return `<div class="msg user${enter}"><div class="bubble">${bubbleHtml(m.content)}</div></div>`;
  }
  const inGroup = currentBot()?.kind === "group";
  const speaker = m.fromBotId ? bots.find((b) => b.id === m.fromBotId) : null;
  const head =
    inGroup && speaker
      ? `<div class="msg-head"><span class="msg-av">${faces(speaker.color, speaker.face, speaker.shape)}</span><span class="msg-who">${esc(speaker.name)}</span></div>`
      : "";
  return `<div class="msg bot${enter}">${head}<div class="bubble">${bubbleHtml(m.content)}</div></div>`;
}

function renderTyping() {
  if (!sending) return "";
  const b = currentBot();
  const action = b?.action && b.action !== "Idle" ? b.action : "Thinking";
  return `<div class="typing" id="typing">${avatarEl(b)}<span>${esc(action)}</span></div>`;
}

function renderThread(opts = {}) {
  const lastId = messages[messages.length - 1]?.id;
  $("thread").innerHTML =
    messages
      .map((m) => renderMessage(m, Boolean(opts.fresh && m.id === lastId)))
      .join("") + renderTyping();
  $("thread").scrollTop = $("thread").scrollHeight;
}

function wallpaperPeriod() {
  let hour = new Date().getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: cfg.timezone || defaultTimezone(),
    }).formatToParts(new Date());
    hour = Number(parts.find((p) => p.type === "hour")?.value ?? hour);
  } catch {
    /* keep local hour */
  }
  if (hour === 24) hour = 0;
  if (hour < 6 || hour >= 21) return "night";
  if (hour < 10) return "dawn";
  if (hour < 17) return "day";
  return "dusk";
}

function wallpaperCopy(period) {
  switch (period) {
    case "dawn":
      return "Morning wallpaper · Bot’s computer, not yours";
    case "day":
      return "Daylight wallpaper · Bot’s computer, not yours";
    case "dusk":
      return "Evening wallpaper · Bot’s computer, not yours";
    case "night":
      return "Night wallpaper · Bot’s computer, not yours";
    default:
      return "Evening wallpaper · Bot’s computer, not yours";
  }
}

function botsBusy() {
  return bots.some((b) => {
    const s = b.status;
    return s === "thinking" || s === "working" || s === "waiting" || s === "blocked";
  });
}

function applyWallpaper() {
  const period = wallpaperPeriod();
  const screen = $("botScreen");
  const label = $("screenLabel");
  if (screen) screen.dataset.period = period;
  if (label) label.textContent = wallpaperCopy(period);
}

function appearanceMode() {
  const mode = cfg.appearance;
  if (mode === "light" || mode === "dark" || mode === "system") return mode;
  return "dark";
}

function applyAppearance() {
  document.documentElement.dataset.appearance = appearanceMode();
}

function onSystemAppearanceChange() {
  if (appearanceMode() === "system") applyAppearance();
}

function watchSystemAppearance() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", onSystemAppearanceChange);
  else mq.addListener(onSystemAppearanceChange);
}

const EXEC_MODES = {
  ask: { label: "Ask" },
  auto: { label: "Auto" },
  all: { label: "Allow all" },
};

function composerExecMode() {
  if (cfg.localExec === "always" && cfg.requireSend === "off") return "all";
  if (cfg.localExec === "always") return "auto";
  return "ask";
}

function closeExecMenu() {
  $("execWrap")?.classList.remove("open");
  $("execBtn")?.setAttribute("aria-expanded", "false");
  const menu = $("execMenu");
  if (menu) menu.hidden = true;
}

function renderComposerExec() {
  const mode = composerExecMode();
  const btn = $("execBtn");
  if (btn) btn.textContent = EXEC_MODES[mode].label;
  document.querySelectorAll("#execMenu [data-exec]").forEach((el) => {
    const on = el.dataset.exec === mode;
    el.classList.toggle("on", on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  });
}

function setComposerExec(mode) {
  if (mode === "ask") {
    cfg.localExec = "ask";
  } else if (mode === "auto") {
    cfg.localExec = "always";
    cfg.requireSend = "on";
  } else if (mode === "all") {
    cfg.localExec = "always";
    cfg.requireSend = "off";
  } else {
    return;
  }
  saveCfg();
  renderComposerExec();
  closeExecMenu();
  if (setPane === "permissions" && $("settings")?.classList.contains("show")) renderSettings();
}

function syncSendBtn() {
  const btn = $("sendBtn");
  const input = $("input");
  if (!btn || !input) return;
  const ready = Boolean(input.value.trim()) && !sending;
  btn.classList.toggle("ready", ready);
  btn.disabled = !ready;
}

function renderChat(opts = {}) {
  const b = currentBot();
  if (!b) return;
  $("headAv").innerHTML = avatarEl(b);
  $("headName").textContent = b.name;
  $("headSub").textContent = b.title;
  $("elapsed").textContent = b.status && b.status !== "idle" && b.action && b.action !== "Idle" ? b.action : "";
  $("input").placeholder = `Message ${b.name}`;
  $("screenTitle").textContent = `${b.name}’s screen`;
  const routines = b.routines?.length
    ? b.routines
        .map(
          (r) =>
            `<div class="rt"><span class="n">${esc(r.name)}</span><span class="${r.enabled ? "" : "paused"}">${esc(r.enabled ? r.schedule : "Paused")}</span></div>`,
        )
        .join("")
    : `<div class="rt"><span class="n">No routines yet</span><span>Paused</span></div>`;
  $("routines").innerHTML = `<h4>ROUTINES</h4>${routines}`;
  $("compBtn").classList.toggle("active", computer !== "off");
  $("compBtn").classList.toggle("live", botsBusy() || computer !== "off");
  applyWallpaper();
  const desk = $("computer")?.querySelector(".desk");
  if (desk) {
    desk.innerHTML = lastTool
      ? `Last tool<br/>${esc(lastTool)}`
      : `Shared workspace<br/>${esc(cfg.workspace)}`;
  }
  renderThread(opts);
  syncSendBtn();
}

function profileName() {
  return String(cfg.profileName || "You").trim() || "You";
}

function profileColor() {
  return cfg.profileColor || "#E8B86D";
}

function renderAccount() {
  const name = profileName();
  const face = faces(profileColor());
  if ($("acctAv")) $("acctAv").innerHTML = face;
  if ($("acctName")) $("acctName").textContent = name;
  if ($("popAv")) $("popAv").innerHTML = face;
  if ($("popName")) $("popName").textContent = name;
  if ($("acctBtn")) $("acctBtn").title = name;
}

function placeAcctPop() {
  const pop = $("acctPop");
  const btn = $("acctBtn");
  const win = $("app");
  if (!pop || !btn || !win) return;
  const wr = win.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const width = 252;
  let left = br.left - wr.left;
  if (left + width > wr.width - 10) left = wr.width - width - 10;
  if (left < 8) left = 8;
  pop.style.left = `${left}px`;
  pop.style.bottom = `${wr.bottom - br.top + 6}px`;
}

function acctPopOpen() {
  return $("acctPop")?.classList.contains("show");
}

function showAcctMenu() {
  if ($("acctPopMenu")) $("acctPopMenu").hidden = false;
  if ($("acctPopAbout")) $("acctPopAbout").hidden = true;
}

function closeAcctPop() {
  $("acctPop")?.classList.remove("show");
  if ($("acctBtn")) $("acctBtn").setAttribute("aria-expanded", "false");
  showAcctMenu();
}

function openAcctPop() {
  showAcctMenu();
  placeAcctPop();
  $("acctPop").classList.add("show");
  $("acctBtn").setAttribute("aria-expanded", "true");
}

function toggleAcctPop() {
  if (acctPopOpen()) closeAcctPop();
  else openAcctPop();
}

function nextLookDefaults() {
  const usedC = new Set(bots.map((b) => String(b.color || "").toLowerCase()));
  const usedF = new Set(bots.map((b) => asFace(b.face)));
  const usedS = new Set(bots.map((b) => asShape(b.shape)));
  return {
    color: BOT_COLORS.find((c) => !usedC.has(c.toLowerCase())) || BOT_COLORS[bots.length % BOT_COLORS.length],
    face: FACE_IDS.find((f) => !usedF.has(f)) || FACE_IDS[bots.length % FACE_IDS.length],
    shape: SHAPE_IDS.find((s) => !usedS.has(s)) || SHAPE_IDS[bots.length % SHAPE_IDS.length],
  };
}

function closePlusMenu() {
  $("plusMenu")?.setAttribute("hidden", "");
  $("plusWrap")?.classList.remove("open");
  $("newBtn")?.setAttribute("aria-expanded", "false");
}

function plusMenuOpen() {
  return Boolean($("plusWrap")?.classList.contains("open"));
}

function showSheet(id) {
  for (const sid of ["sheetBot", "sheetConvo", "sheetGroup"]) {
    const el = $(sid);
    if (el) el.hidden = sid !== id;
  }
  $("modal").classList.add("show");
}

function closeCreate() {
  $("modal").classList.remove("show");
}

function renderBotLooks() {
  const prev = $("createPreview");
  if (prev) prev.innerHTML = faceShell(createLook.color, createLook.face, "idle", "preview", createLook.shape);
  const sw = $("botSwatches");
  if (sw) {
    sw.innerHTML = BOT_COLORS.map(
      (c) =>
        `<button type="button" class="swatch${c.toLowerCase() === createLook.color.toLowerCase() ? " on" : ""}" data-color="${esc(c)}" style="background:${esc(c)}" aria-label="Color ${c}"></button>`,
    ).join("");
  }
  const sp = $("shapePick");
  if (sp) {
    sp.innerHTML = SHAPE_IDS.map(
      (id) =>
        `<button type="button" class="${id === createLook.shape ? "on" : ""}" data-shape="${id}" aria-label="${esc(SHAPE_LABELS[id] || id)}">
          <span class="look">${shapePreview(createLook.color, id)}</span>
        </button>`,
    ).join("");
  }
  const fp = $("facePick");
  if (fp) {
    fp.innerHTML = FACE_IDS.map(
      (id) =>
        `<button type="button" class="${id === createLook.face ? "on" : ""}" data-face="${id}" aria-label="${id} expression">
          <span class="look">${faces(createLook.color, id, createLook.shape)}</span>
        </button>`,
    ).join("");
  }
}

function openNewBot() {
  closePlusMenu();
  createLook = nextLookDefaults();
  renderBotLooks();
  showSheet("sheetBot");
}

function renderConvoList() {
  const list = $("convoList");
  if (!list) return;
  const rows = bots.filter((b) => b.kind !== "group");
  list.innerHTML = rows
    .map(
      (b) => `<button type="button" class="pick-row" data-id="${esc(b.id)}">
        <span class="look">${faces(b.color, b.face, b.shape)}</span>
        <span><span class="who">${esc(b.name)}</span><span class="job">${esc(b.title)}</span></span>
      </button>`,
    )
    .join("");
}

function openNewConvo() {
  closePlusMenu();
  renderConvoList();
  showSheet("sheetConvo");
}

function renderGroupMembers() {
  const box = $("gMembers");
  if (!box) return;
  const rows = bots.filter((b) => b.kind !== "group");
  box.innerHTML = rows
    .map(
      (b) => `<button type="button" class="${groupPicks.has(b.id) ? "on" : ""}" data-id="${esc(b.id)}">
        <span class="look">${faces(b.color, b.face, b.shape)}</span>
        ${esc(b.name)}
      </button>`,
    )
    .join("");
}

function openNewGroup() {
  closePlusMenu();
  groupPicks = new Set();
  renderGroupMembers();
  showSheet("sheetGroup");
}

function applyChrome() {
  const app = $("app");
  app.classList.toggle("preview", computer === "preview");
  app.classList.toggle("takeover", computer === "takeover");
  $("compBtn").classList.toggle("active", computer !== "off");
  $("compBtn").classList.toggle("live", botsBusy() || computer !== "off");
  applyWallpaper();
  if (acctPopOpen()) placeAcctPop();
}

function saveCfg() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      cfg = await api("/api/settings", { method: "PUT", body: JSON.stringify(cfg) });
    } catch (err) {
      toast(err.message);
    }
  }, 280);
}

function bindFields(map) {
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const write = () => {
      cfg[key] = el.value;
      saveCfg();
    };
    el.addEventListener("input", () => {
      cfg[key] = el.value;
      saveCfg();
      if (key === "profileName") renderAccount();
    });
    el.addEventListener("change", write);
  });
}

function bindSeg(name, key) {
  document.querySelectorAll(`[data-seg="${name}"]`).forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.val === cfg[key]);
    btn.onclick = () => {
      cfg[key] = btn.dataset.val;
      if (key === "provider" && btn.dataset.val === "deepseek") {
        cfg.baseUrl = "https://api.deepseek.com/v1";
        cfg.model = cfg.model || "deepseek-chat";
      }
      if (key === "appearance") applyAppearance();
      if (key === "localExec") renderComposerExec();
      saveCfg();
      renderSettings();
    };
  });
}

function renderSettings() {
  const titles = {
    harness: "Harness",
    models: "Models",
    permissions: "Permissions",
    agent: "Agent",
    approvals: "Approvals",
    appearance: "Appearance",
  };
  $("setTitle").textContent = titles[setPane];
  document.querySelectorAll(".set-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.pane === setPane),
  );
  const body = $("setBody");
  if (setPane === "models") {
    body.innerHTML = `
      ${cfg.harness === "codex" || cfg.harness === "cursor" || cfg.harness === "dsh"
        ? `<p class="set-caption">This page is for HTTP engines. Switch Harness to OpenAI compatible or Ollama to edit Base URL and key.</p>`
        : ""}
      <div class="field">
        <label>Provider</label>
        <div class="seg">
          <button data-seg="provider" data-val="openai-compatible">OpenAI compatible</button>
          <button data-seg="provider" data-val="deepseek">DeepSeek</button>
          <button data-seg="provider" data-val="custom">Custom</button>
        </div>
        <div class="hint">Provider-agnostic. This only fills a default Base URL.</div>
      </div>
      <div class="field">
        <label>Base URL</label>
        <input id="f-baseUrl" value="${esc(cfg.baseUrl)}" placeholder="https://api.deepseek.com/v1" />
        <div class="hint">OpenAI-compatible Chat Completions root. Works with DeepSeek, OpenRouter, local vLLM, or Ollama (/v1).</div>
      </div>
      <div class="field">
        <label>API Key</label>
        <input id="f-apiKey" type="password" value="${esc(cfg.apiKey)}" placeholder="sk-…" autocomplete="off" />
        <div class="hint">Stored only in ~/.opengrokbot/settings.json on this machine. Never put it in a Bot description or chat.</div>
      </div>
      <div class="row2">
        <div class="field">
          <label>Model</label>
          <input id="f-model" value="${esc(cfg.model)}" placeholder="deepseek-chat" />
          <div class="hint">Main Bot chat and tool loop.</div>
        </div>
        <div class="field">
          <label>Subagent model</label>
          <input id="f-sub" value="${esc(cfg.subagentModel)}" placeholder="deepseek-chat" />
          <div class="hint">Handoff subagents. A smaller or faster model is fine.</div>
        </div>
      </div>
      <div class="field">
        <label>Review model <span style="color:var(--muted);font-weight:400">optional</span></label>
        <input id="f-review" value="${esc(cfg.reviewModel)}" placeholder="Leave empty to match Model" />
        <div class="hint">Official Auto Review. v0.1 uses approval cards instead of a second model.</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="testConn">Test connection</button>
        <button class="btn ghost" id="fillDeepseek">Use DeepSeek defaults</button>
      </div>
    `;
    bindFields({
      "f-baseUrl": "baseUrl",
      "f-apiKey": "apiKey",
      "f-model": "model",
      "f-sub": "subagentModel",
      "f-review": "reviewModel",
    });
    bindSeg("provider", "provider");
    $("testConn").onclick = async () => {
      try {
        await api("/api/settings", { method: "PUT", body: JSON.stringify(cfg) });
        const res = await api("/api/settings/test", { method: "POST", body: "{}" });
        toast(res.ok ? `Connected · ${res.model || cfg.model}` : res.error || "Failed");
      } catch (err) {
        toast(err.message);
      }
    };
    $("fillDeepseek").onclick = () => {
      cfg.provider = "deepseek";
      cfg.baseUrl = "https://api.deepseek.com/v1";
      cfg.model = "deepseek-chat";
      cfg.subagentModel = "deepseek-chat";
      saveCfg();
      renderSettings();
      toast("DeepSeek defaults applied");
    };
  }
  if (setPane === "harness") {
    const active = cfg.harness || "openai-compatible";
    const names = {
      "openai-compatible": "OpenAI compatible",
      ollama: "Ollama",
      codex: "Codex",
      cursor: "Cursor",
      dsh: "DeepSeek Harness",
    };
    const blurbs = {
      "openai-compatible": "Any OpenAI-compatible HTTP API.",
      ollama: "Local models on this machine.",
      codex: "Uses the Codex CLI login on this Mac.",
      cursor: "Uses cursor-agent and the login on this Mac.",
      dsh: "DeepSeek’s dsh CLI in the shared workspace.",
    };
    const rows = (harnesses.length ? harnesses : [{
      id: "openai-compatible",
      label: "OpenAI compatible",
      blurb: "",
      ready: true,
      install: { command: "", hint: "" },
    }]).map((h) => {
      const on = h.id === active;
      const missing = !h.ready;
      const ver = String(h.version || "")
        .replace(/^ollama version is /i, "")
        .replace(/^codex-cli /i, "")
        .replace(/^dsh\s+/i, "")
        .trim();
      const meta = missing ? "Install" : on ? "On" : ver;
      const blurb = on ? (blurbs[h.id] || h.blurb || "") : "";
      const install = missing
        ? `<div class="install" data-stop="1">
            <code>${esc(h.install?.command || "")}</code>
            <div class="actions">
              <button type="button" class="btn ghost" data-copy="${esc(h.install?.command || "")}">Copy</button>
            </div>
          </div>`
        : "";
      return `<div class="hrow${on ? " on" : ""}${missing ? " missing" : ""}" data-harness="${esc(h.id)}" role="radio" aria-checked="${on ? "true" : "false"}">
        <span class="hdot" aria-hidden="true"></span>
        <span>
          <span class="name">${esc(names[h.id] || h.label)}</span>
          ${blurb ? `<div class="sub">${esc(blurb)}</div>` : ""}
        </span>
        <span class="meta">${esc(meta)}</span>
        ${install}
      </div>`;
    }).join("");
    body.innerHTML = `
      <p class="set-caption">One engine for every Bot. Local CLIs use the login already on this machine.</p>
      <div class="hlist" role="radiogroup" aria-label="Harness">${rows}</div>
      <div class="field">
        <label>Workspace</label>
        <input id="f-ws" value="${esc(cfg.workspace)}" />
      </div>
      <div class="field">
        <label>Memory</label>
        <input id="f-mem" value="${esc(cfg.memoryDir)}" />
      </div>
      ${
        active === "dsh"
          ? `<div class="field">
        <label>dsh profile</label>
        <div class="seg">
          <button data-seg="dshProfile" data-val="headless">headless</button>
          <button data-seg="dshProfile" data-val="web">web</button>
          <button data-seg="dshProfile" data-val="sdk">sdk</button>
        </div>
      </div>`
          : ""
      }
    `;
    bindFields({ "f-ws": "workspace", "f-mem": "memoryDir" });
    if (active === "dsh") bindSeg("dshProfile", "dshProfile");
    body.querySelectorAll("[data-harness]").forEach((card) => {
      card.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-stop]")) return;
        const id = card.dataset.harness;
        const row = harnesses.find((h) => h.id === id);
        if (row && !row.ready) {
          toast(`${row.label} is not installed`);
          return;
        }
        switchHarness(id);
      });
    });
    body.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(btn.dataset.copy || "");
          toast("Install command copied");
        } catch {
          toast(btn.dataset.copy || "Copy failed");
        }
      });
    });
  }
  if (setPane === "permissions") {
    body.innerHTML = `
      <div class="field">
        <label>Execution on local computer</label>
        <div class="seg">
          <button data-seg="localExec" data-val="ask">Ask every time</button>
          <button data-seg="localExec" data-val="always">Always allow</button>
          <button data-seg="localExec" data-val="never">Never</button>
        </div>
        <div class="hint">Official default is Ask every time. This is riskier here: the agent is on your real computer.</div>
      </div>
      <div class="field">
        <label>Browser profile</label>
        <input id="f-chrome" value="${esc(cfg.browserProfile)}" />
        <div class="hint">Dedicated Chrome user-data-dir. v0.1 does not drive a real browser yet.</div>
      </div>
    `;
    bindFields({ "f-chrome": "browserProfile" });
    bindSeg("localExec", "localExec");
  }
  if (setPane === "agent") {
    body.innerHTML = `
      <div class="field">
        <label>Timezone</label>
        <input id="f-tz" value="${esc(cfg.timezone)}" />
        <div class="hint">Clock for routines. Saved now; the scheduler is not wired in v0.1.</div>
      </div>
      <div class="field">
        <label>Host scheduler</label>
        <div class="seg">
          <button data-seg="scheduler" data-val="on">launchd / login</button>
          <button data-seg="scheduler" data-val="off">Only while app is open</button>
        </div>
        <div class="hint">Official cloud computers keep running with the lid closed. A sleeping laptop still stops. v0.1 does not install launchd.</div>
      </div>
      <div class="field roster-zone">
        <label>Roster</label>
        <div class="hint">Bots, chats, and per-Bot memory live under ~/.opengrokbot/. Model and Harness settings are kept.</div>
        <div class="actions" style="margin-top:10px">
          <button type="button" class="btn ghost" id="clearRoster">Clear roster</button>
          <button type="button" class="btn danger" id="resetRoster">Reset to starter roster</button>
        </div>
      </div>
    `;
    bindFields({ "f-tz": "timezone" });
    bindSeg("scheduler", "scheduler");
    $("clearRoster")?.addEventListener("click", () => void clearRosterAction());
    $("resetRoster")?.addEventListener("click", () => void resetRosterAction());
  }
  if (setPane === "approvals") {
    body.innerHTML = `
      <div class="field">
        <label>Auto Review</label>
        <div class="seg">
          <button data-seg="autoReview" data-val="on">On</button>
          <button data-seg="autoReview" data-val="off">Off</button>
        </div>
        <div class="hint">v0.1 does not call a review model. Shell and send stay behind approval cards.</div>
      </div>
      <div class="field">
        <label>Require approval before sending</label>
        <div class="seg">
          <button data-seg="requireSend" data-val="on">Require</button>
          <button data-seg="requireSend" data-val="off">Allow</button>
        </div>
        <div class="hint">Outbound mail, posts, and payments. Put it in policy instead of hoping the model stops itself.</div>
      </div>
    `;
    bindSeg("autoReview", "autoReview");
    bindSeg("requireSend", "requireSend");
  }
  if (setPane === "appearance") {
    body.innerHTML = `
      <div class="field">
        <label>Display name</label>
        <input id="f-profile" value="${esc(profileName())}" maxlength="40" />
        <div class="hint">You, lower-left. Official Grok Bot uses a Cursor account; here this is the operator on this machine.</div>
      </div>
      <div class="field">
        <label>Avatar</label>
        <div class="swatches">
          ${PROFILE_COLORS.map(
            (c) =>
              `<button type="button" class="swatch${c === profileColor() ? " on" : ""}" data-color="${esc(c)}" style="background:${esc(c)}" aria-label="Avatar color"></button>`,
          ).join("")}
        </div>
      </div>
      <div class="field">
        <label>Appearance</label>
        <div class="seg">
          <button data-seg="appearance" data-val="system">Follow System</button>
          <button data-seg="appearance" data-val="light">Light</button>
          <button data-seg="appearance" data-val="dark">Dark</button>
        </div>
      </div>
    `;
    bindFields({ "f-profile": "profileName" });
    bindSeg("appearance", "appearance");
    body.querySelectorAll(".swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        cfg.profileColor = btn.dataset.color;
        saveCfg();
        renderAccount();
        renderSettings();
      });
    });
  }
}

async function refreshHarnesses() {
  const data = await api("/api/harnesses");
  harnesses = data.harnesses || [];
  if (data.active) cfg.harness = data.active;
}

async function switchHarness(id) {
  try {
    const data = await api("/api/harnesses/switch", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    if (data.settings) cfg = { ...cfg, ...data.settings };
    cfg.harness = data.active || id;
    toast(`Using ${harnesses.find((h) => h.id === id)?.label || id}`);
    await refreshHarnesses();
    renderSettings();
    renderAccount();
  } catch (err) {
    toast(err.message || "Could not switch harness");
    try {
      await refreshHarnesses();
      renderSettings();
    } catch {
      /* ignore */
    }
  }
}

async function openSettings(pane) {
  closeAcctPop();
  closeExecMenu();
  setPane = pane || "harness";
  $("settings").classList.add("show");
  $("settings").setAttribute("aria-hidden", "false");
  $("modal").classList.remove("show");
  try {
    await refreshHarnesses();
  } catch {
    harnesses = [];
  }
  renderSettings();
}

function closeSettings() {
  $("settings").classList.remove("show");
  $("settings").setAttribute("aria-hidden", "true");
}

async function loadRoster() {
  const data = await api("/api/bots");
  bots = data.bots || [];
  if (!bots.length) {
    selected = "";
    messages = [];
    renderRoster();
    renderEmptyChat();
    return;
  }
  if (!selected && bots[0]) selected = bots[0].id;
  if (selected && !bots.some((b) => b.id === selected) && bots[0]) selected = bots[0].id;
  renderRoster();
  if (selected) await loadMessages();
  else renderEmptyChat();
}

function renderEmptyChat() {
  $("headAv").innerHTML = "";
  $("headName").textContent = "No Bots yet";
  $("headSub").textContent = "Press + to build your roster";
  $("elapsed").textContent = "";
  $("input").placeholder = "Create a Bot first";
  $("thread").innerHTML =
    `<div class="sys">Your roster is empty. Use + to create Bots, or Settings → Agent → Reset to starter roster.</div>`;
  $("routines").innerHTML = `<h4>ROUTINES</h4><div class="rt"><span class="n">No Bots</span><span>—</span></div>`;
  syncSendBtn();
}

async function loadMessages() {
  if (!selected) return;
  const data = await api(`/api/bots/${encodeURIComponent(selected)}/messages`);
  messages = data.messages || [];
  renderChat();
}

async function selectBot(id) {
  if (!id) {
    selected = "";
    messages = [];
    renderRoster();
    renderEmptyChat();
    return;
  }
  selected = id;
  sending = false;
  renderRoster();
  await loadMessages();
}

async function clearRosterAction() {
  if (
    !confirm(
      "Clear the entire roster?\n\nThis deletes all Bots, chat history, and per-Bot memory on this machine. Your model and Harness settings stay.",
    )
  ) {
    return;
  }
  try {
    await api("/api/roster/clear", { method: "POST", body: "{}" });
    closeSettings();
    await loadRoster();
    toast("Roster cleared");
  } catch (err) {
    toast(err.message);
  }
}

async function resetRosterAction() {
  if (
    !confirm(
      "Reset to the starter roster?\n\nChief, Sales, Inbox, and the other demo Bots come back with fresh chats. Your custom Bots and their memory are removed.",
    )
  ) {
    return;
  }
  try {
    const data = await api("/api/roster/reset", { method: "POST", body: "{}" });
    bots = data.bots || [];
    selected = bots[0]?.id || "";
    closeSettings();
    await loadRoster();
    if (selected) await selectBot(selected);
    toast("Starter roster restored");
  } catch (err) {
    toast(err.message);
  }
}

function applyEvent(event) {
  if (!event || !event.type) return;
  if (event.type === "status") {
    const bot = bots.find((b) => b.id === event.botId);
    if (bot) {
      bot.status = event.status;
      bot.action = event.action;
      renderRoster();
      if (event.botId === selected) renderChat();
    }
    return;
  }
  if (event.type === "tool") {
    lastTool = event.name;
    if (event.botId === selected) renderChat();
    return;
  }
  if (event.type === "message") {
    if (event.botId !== selected) return;
    if (event.message.role === "user" && sending) {
      const already = messages.some((m) => m.role === "user" && m.content === event.message.content);
      if (already) return;
    }
    messages.push(event.message);
    renderThread({ fresh: true });
    return;
  }
  if (event.type === "error") {
    if (event.botId === selected) toast(event.error);
    return;
  }
  if (event.type === "done") {
    sending = false;
    const bot = bots.find((b) => b.id === event.botId);
    if (bot && (bot.status === "thinking" || bot.status === "working" || bot.status === "waiting")) {
      bot.status = "done";
      bot.action = "Idle";
      renderRoster();
      if (event.botId === selected) renderChat();
      window.setTimeout(() => {
        if (bot.status === "done") {
          bot.status = "idle";
          renderRoster();
          if (event.botId === selected) renderChat();
        }
      }, 1400);
    } else {
      renderRoster();
      if (event.botId === selected) renderChat();
    }
    syncSendBtn();
    loadRoster().catch(() => undefined);
  }
}

async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* ignore malformed */
      }
    }
  }
}

async function sendMessage(text) {
  const bot = currentBot();
  if (!bot || sending) return;
  sending = true;
  syncSendBtn();
  messages.push({
    id: "local-" + Date.now(),
    role: "user",
    content: text,
    createdAt: new Date().toISOString(),
    kind: "text",
  });
  bot.status = "thinking";
  bot.action = "Thinking";
  bot.preview = text.slice(0, 72);
  bot.time = "Now";
  renderRoster();
  renderChat({ fresh: true });
  try {
    const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(await res.text());
    await readSSE(res, applyEvent);
  } catch (err) {
    toast(err.message || "Send failed");
    sending = false;
    renderChat();
    syncSendBtn();
  }
}

function bindUi() {
  $("roster").addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    selectBot(row.dataset.id);
  });
  $("search").addEventListener("input", (e) => {
    query = e.target.value;
    renderRoster();
  });
  $("compBtn").addEventListener("click", () => {
    computer = computer === "off" ? "preview" : "off";
    applyChrome();
    renderChat();
  });
  $("openScreen").addEventListener("click", () => {
    computer = "takeover";
    applyChrome();
  });
  $("handBack").addEventListener("click", () => {
    computer = "preview";
    applyChrome();
  });
  $("newBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeAcctPop();
    closeExecMenu();
    if (plusMenuOpen()) {
      closePlusMenu();
      return;
    }
    $("plusWrap")?.classList.add("open");
    $("plusMenu")?.removeAttribute("hidden");
    $("newBtn")?.setAttribute("aria-expanded", "true");
  });
  $("plusMenu")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-create]");
    if (!item) return;
    const kind = item.dataset.create;
    if (kind === "bot") openNewBot();
    else if (kind === "convo") openNewConvo();
    else if (kind === "group") openNewGroup();
  });
  $("setBtn").addEventListener("click", () => {
    closeAcctPop();
    closePlusMenu();
    openSettings("harness");
  });
  $("acctBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeExecMenu();
    closePlusMenu();
    toggleAcctPop();
  });
  $("acctPop").addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-acct]");
    if (!item) return;
    const act = item.dataset.acct;
    if (act === "settings") {
      closeAcctPop();
      openSettings("harness");
      return;
    }
    if (act === "appearance") {
      closeAcctPop();
      openSettings("appearance");
      return;
    }
    if (act === "about") {
      $("acctPopMenu").hidden = true;
      $("acctPopAbout").hidden = false;
      return;
    }
    if (act === "back") {
      showAcctMenu();
    }
  });
  document.addEventListener("click", () => {
    closeAcctPop();
    closeExecMenu();
    closePlusMenu();
  });
  window.addEventListener("resize", () => {
    if (acctPopOpen()) placeAcctPop();
  });
  $("closeSet").addEventListener("click", closeSettings);
  document.querySelector(".set-nav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setPane = b.dataset.pane;
    renderSettings();
  });
  $("settings").addEventListener("click", (e) => {
    if (e.target.id === "settings") closeSettings();
  });
  $("cancelNew").addEventListener("click", closeCreate);
  $("cancelConvo")?.addEventListener("click", closeCreate);
  $("cancelGroup")?.addEventListener("click", closeCreate);
  $("botSwatches")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-color]");
    if (!btn) return;
    createLook.color = btn.dataset.color;
    renderBotLooks();
  });
  $("shapePick")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-shape]");
    if (!btn) return;
    createLook.shape = asShape(btn.dataset.shape);
    renderBotLooks();
  });
  $("facePick")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-face]");
    if (!btn) return;
    createLook.face = asFace(btn.dataset.face);
    renderBotLooks();
  });
  $("convoList")?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    closeCreate();
    selectBot(row.dataset.id);
  });
  $("gMembers")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-id]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (groupPicks.has(id)) groupPicks.delete(id);
    else {
      if (groupPicks.size >= 6) {
        toast("Groups cap at six Bots.");
        return;
      }
      groupPicks.add(id);
    }
    renderGroupMembers();
  });
  $("saveNew").addEventListener("click", async () => {
    try {
      const bot = await api("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name: $("nName").value,
          title: $("nTitle").value,
          description: $("nDesc").value,
          color: createLook.color,
          face: createLook.face,
          shape: createLook.shape,
        }),
      });
      closeCreate();
      await loadRoster();
      await selectBot(bot.id);
    } catch (err) {
      toast(err.message);
    }
  });
  $("saveGroup")?.addEventListener("click", async () => {
    try {
      const name = ($("gName")?.value || "").trim() || "Group";
      const bot = await api("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name,
          title: `Group · ${groupPicks.size} Bots`,
          description: "Group thread. @ a name or let the router hand off with message_bot.",
          kind: "group",
          members: [...groupPicks],
        }),
      });
      closeCreate();
      await loadRoster();
      await selectBot(bot.id);
    } catch (err) {
      toast(err.message);
    }
  });
  $("thread").addEventListener("click", async (e) => {
    const jump = e.target.closest("button[data-bot-id]");
    if (jump) {
      e.preventDefault();
      const id = jump.dataset.botId;
      if (id) selectBot(id);
      return;
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn || !selected) return;
    const box = btn.closest(".approval");
    if (!box || box.classList.contains("done") || box.dataset.busy) return;
    box.dataset.busy = "1";
    try {
      await api(`/api/bots/${encodeURIComponent(selected)}/approvals`, {
        method: "POST",
        body: JSON.stringify({ decision: btn.dataset.act, messageId: box.dataset.id }),
      });
      await loadMessages();
      await loadRoster();
    } catch (err) {
      delete box.dataset.busy;
      toast(err.message);
    }
  });
  const picker = $("picker");
  let pickerItems = [];
  let pickerIndex = 0;

  function hidePicker() {
    picker.classList.remove("show");
    picker.innerHTML = "";
    pickerItems = [];
    pickerIndex = 0;
  }

  function activeToken(el) {
    const v = el.value;
    const caret = el.selectionStart ?? v.length;
    const left = v.slice(0, caret);
    const at = left.match(/(^|[\s])@([^\s@]*)$/);
    if (at) return { kind: "bot", start: left.lastIndexOf("@"), query: at[2], caret };
    const slash = left.match(/(^|[\s])\/([^\s]*)$/);
    if (slash) return { kind: "skill", start: left.lastIndexOf("/"), query: slash[2], caret };
    return null;
  }

  function paintPicker() {
    [...picker.querySelectorAll("button")].forEach((btn, i) => {
      btn.classList.toggle("active", i === pickerIndex);
    });
  }

  function showBotPicker(query) {
    const q = query.toLowerCase();
    pickerItems = bots.filter((b) => {
      if (b.kind === "group") return false;
      if (b.id === selected) return false;
      if (!q) return true;
      return `${b.name} ${b.title}`.toLowerCase().includes(q);
    });
    if (!pickerItems.length) {
      hidePicker();
      return;
    }
    pickerIndex = Math.min(pickerIndex, pickerItems.length - 1);
    picker.innerHTML = pickerItems
      .map(
        (b, i) => `<button type="button" data-name="${esc(b.name)}" class="${i === pickerIndex ? "active" : ""}">
          <span class="avatar tiny">${faces(b.color, b.face, b.shape)}</span>
          <span><span class="who">${esc(b.name)}</span><div class="job">${esc(b.title)}</div></span>
        </button>`,
      )
      .join("");
    picker.classList.add("show");
  }

  function showSkillPicker(query) {
    const q = query.toLowerCase();
    pickerItems = (currentBot()?.routines || []).filter((r) => !q || r.name.toLowerCase().includes(q));
    if (!pickerItems.length) {
      hidePicker();
      return;
    }
    pickerIndex = Math.min(pickerIndex, pickerItems.length - 1);
    picker.innerHTML = pickerItems
      .map(
        (r, i) =>
          `<button type="button" data-name="${esc(r.name)}" data-skill="1" class="${i === pickerIndex ? "active" : ""}"><span class="who">/${esc(r.name)}</span></button>`,
      )
      .join("");
    picker.classList.add("show");
  }

  function insertPick(name, skill) {
    const el = $("input");
    const ctx = activeToken(el);
    if (!ctx) return;
    const prefix = skill ? `/${name} ` : `@${name} `;
    el.value = el.value.slice(0, ctx.start) + prefix + el.value.slice(ctx.caret);
    hidePicker();
    el.focus();
    syncSendBtn();
  }

  function refreshPicker() {
    const ctx = activeToken($("input"));
    if (!ctx) {
      hidePicker();
      return;
    }
    if (ctx.kind === "bot") showBotPicker(ctx.query);
    else showSkillPicker(ctx.query);
  }

  $("input").addEventListener("input", () => {
    refreshPicker();
    syncSendBtn();
  });
  $("input").addEventListener("click", refreshPicker);
  picker.addEventListener("mousedown", (e) => e.preventDefault());
  picker.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    insertPick(b.dataset.name, Boolean(b.dataset.skill));
  });

  let composing = false;
  $("input").addEventListener("compositionstart", () => {
    composing = true;
  });
  $("input").addEventListener("compositionend", () => {
    composing = false;
    refreshPicker();
  });

  $("input").addEventListener("keydown", (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    const open = picker.classList.contains("show") && pickerItems.length;
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      pickerIndex = (pickerIndex + 1) % pickerItems.length;
      paintPicker();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      pickerIndex = (pickerIndex - 1 + pickerItems.length) % pickerItems.length;
      paintPicker();
      return;
    }
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      const item = pickerItems[pickerIndex];
      insertPick(item.name, Boolean(item.schedule));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hidePicker();
    }
  });

  $("execBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeAcctPop();
    const wrap = $("execWrap");
    const open = wrap?.classList.contains("open");
    if (open) {
      closeExecMenu();
      return;
    }
    wrap.classList.add("open");
    $("execBtn").setAttribute("aria-expanded", "true");
    $("execMenu").hidden = false;
  });
  $("execMenu").addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-exec]");
    if (!item) return;
    setComposerExec(item.dataset.exec);
  });

  $("composerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (composing) return;
    if (picker.classList.contains("show") && pickerItems.length) return;
    const t = $("input").value.trim();
    if (!t || sending) return;
    $("input").value = "";
    hidePicker();
    syncSendBtn();
    sendMessage(t);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      openSettings("harness");
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      closeAcctPop();
      closeExecMenu();
      if (plusMenuOpen()) closePlusMenu();
      else $("newBtn")?.click();
    }
    if (e.key === "Escape") {
      if (plusMenuOpen()) {
        closePlusMenu();
        return;
      }
      if (acctPopOpen()) {
        closeAcctPop();
        return;
      }
      if ($("execWrap")?.classList.contains("open")) {
        closeExecMenu();
        return;
      }
      closeSettings();
      closeCreate();
      $("picker")?.classList.remove("show");
    }
  });
}

async function boot() {
  bindUi();
  watchSystemAppearance();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if ($("acctSetKbd")) $("acctSetKbd").textContent = mac ? "⌘," : "Ctrl+,";
  applyChrome();
  try {
    cfg = Object.assign({}, defaultCfg, await api("/api/settings"));
  } catch {
    cfg = { ...defaultCfg };
  }
  applyAppearance();
  renderComposerExec();
  renderAccount();
  await loadRoster();
  await loadMessages();
}

boot().catch((err) => toast(err.message));
