const $ = (id) => document.getElementById(id);

const faces = (color) => `
<svg viewBox="0 0 64 64" class="face">
  <circle class="head" cx="32" cy="32" r="32" fill="${color}"/>
  <g class="eyes">
    <ellipse class="eye" cx="24" cy="28" rx="4.2" ry="5" fill="#111"/>
    <ellipse class="eye" cx="40" cy="28" rx="4.2" ry="5" fill="#111"/>
  </g>
  <path class="mouth" d="M24 42c4 4 12 4 16 0" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const defaultCfg = {
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
let setPane = "models";
let query = "";
let sending = false;
let lastTool = "";
let saveTimer = 0;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function avatarEl(bot) {
  if (!bot) return `<div class="avatar idle">${faces("#8e8e93")}</div>`;
  if (bot.kind === "group") {
    const colors = bot.memberColors?.length ? bot.memberColors : [bot.color];
    return `<div class="stack">${colors.map((c) => `<div class="avatar idle">${faces(c)}</div>`).join("")}</div>`;
  }
  return `<div class="avatar ${statusClass(bot.status)}">${faces(bot.color)}</div>`;
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
        <div class="preview-line">${esc(b.preview || "")}</div>
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
  const named = bots
    .filter((b) => b.kind !== "group")
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
  for (const b of named) {
    const re = new RegExp(`@${b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    html = html.replace(re, `<span class="mention">@${esc(b.name)}</span>`);
  }
  html = html.replace(/\n/g, "<br>");
  return html.replace(/\u0000F(\d+)\u0000/g, (_, i) => fences[Number(i)]);
}

function renderMessage(m, fresh) {
  const enter = fresh ? " fresh" : "";
  if (m.role === "tool") return "";
  const kind = m.kind || "text";
  if (kind === "handoff") return `<div class="handoff${enter}">${esc(m.content)}</div>`;
  if (kind === "routine") return `<div class="routine-chip${enter}">${esc(m.content)}</div>`;
  if (kind === "system") return `<div class="sys${enter}">${esc(m.content)}</div>`;
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
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
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
  return `<div class="msg bot${enter}"><div class="bubble">${bubbleHtml(m.content)}</div></div>`;
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
      saveCfg();
      renderSettings();
    };
  });
}

function renderSettings() {
  const titles = {
    models: "Models",
    harness: "Harness",
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
      <div class="warn-line">Official Grok Bot picks the model for you. This build has no bundled quota — bring any OpenAI-compatible API.</div>
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
    body.innerHTML = `
      <div class="field">
        <label>Workspace</label>
        <input id="f-ws" value="${esc(cfg.workspace)}" />
        <div class="hint">Analogue of official /workspace. Every Bot shares this folder — not one disk per Bot.</div>
      </div>
      <div class="field">
        <label>Memory directory</label>
        <input id="f-mem" value="${esc(cfg.memoryDir)}" />
        <div class="hint">One subdirectory per Bot id. Memory is bound to the role, not a single session.</div>
      </div>
      <div class="field">
        <label>DeepSeek Harness profile</label>
        <div class="seg">
          <button data-seg="dshProfile" data-val="headless">headless</button>
          <button data-seg="dshProfile" data-val="web">web</button>
          <button data-seg="dshProfile" data-val="sdk">sdk</button>
        </div>
        <div class="hint">v0.1 uses the built-in OpenAI-compatible loop. dsh can be wired later; this UI is not the dsh Web UI.</div>
      </div>
    `;
    bindFields({ "f-ws": "workspace", "f-mem": "memoryDir" });
    bindSeg("dshProfile", "dshProfile");
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
    `;
    bindFields({ "f-tz": "timezone" });
    bindSeg("scheduler", "scheduler");
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
        <div class="hint">Official has three options. v0.1 ships Dark only, matching the desktop marketing shots.</div>
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

function openSettings(pane) {
  closeAcctPop();
  setPane = pane || "models";
  $("settings").classList.add("show");
  $("settings").setAttribute("aria-hidden", "false");
  $("modal").classList.remove("show");
  renderSettings();
}

function closeSettings() {
  $("settings").classList.remove("show");
  $("settings").setAttribute("aria-hidden", "true");
}

async function loadRoster() {
  const data = await api("/api/bots");
  bots = data.bots || [];
  if (!selected && bots[0]) selected = bots[0].id;
  if (selected && !bots.some((b) => b.id === selected) && bots[0]) selected = bots[0].id;
  renderRoster();
}

async function loadMessages() {
  if (!selected) return;
  const data = await api(`/api/bots/${encodeURIComponent(selected)}/messages`);
  messages = data.messages || [];
  renderChat();
}

async function selectBot(id) {
  selected = id;
  sending = false;
  renderRoster();
  await loadMessages();
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
    if (bot && (bot.status === "thinking" || bot.status === "working")) {
      bot.status = "idle";
      bot.action = "Idle";
    }
    renderRoster();
    renderChat();
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
  $("newBtn").addEventListener("click", () => $("modal").classList.add("show"));
  $("setBtn").addEventListener("click", () => {
    closeAcctPop();
    openSettings("models");
  });
  $("acctBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAcctPop();
  });
  $("acctPop").addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-acct]");
    if (!item) return;
    const act = item.dataset.acct;
    if (act === "settings") {
      closeAcctPop();
      openSettings("models");
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
  document.addEventListener("click", () => closeAcctPop());
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
  $("cancelNew").addEventListener("click", () => $("modal").classList.remove("show"));
  $("saveNew").addEventListener("click", async () => {
    try {
      const bot = await api("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name: $("nName").value,
          title: $("nTitle").value,
          description: $("nDesc").value,
        }),
      });
      $("modal").classList.remove("show");
      await loadRoster();
      await selectBot(bot.id);
    } catch (err) {
      toast(err.message);
    }
  });
  $("thread").addEventListener("click", async (e) => {
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
          <span class="avatar tiny">${faces(b.color)}</span>
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
      openSettings("models");
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      $("modal").classList.add("show");
    }
    if (e.key === "Escape") {
      if (acctPopOpen()) {
        closeAcctPop();
        return;
      }
      closeSettings();
      $("modal").classList.remove("show");
      $("picker")?.classList.remove("show");
    }
  });
}

async function boot() {
  bindUi();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if ($("acctSetKbd")) $("acctSetKbd").textContent = mac ? "⌘," : "Ctrl+,";
  applyChrome();
  try {
    cfg = Object.assign({}, defaultCfg, await api("/api/settings"));
  } catch {
    cfg = { ...defaultCfg };
  }
  renderAccount();
  await loadRoster();
  await loadMessages();
}

boot().catch((err) => toast(err.message));
