import { runTurn } from "./agent.js";
import { listBots, loadSettings } from "./store.js";

const fired = new Set<string>();

function parseClock(schedule: string): { hour: number; minute: number } | null {
  const m = schedule.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function localParts(now: Date, tz: string): { hour: number; minute: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    weekday: "long",
    hour12: false,
    timeZone: tz,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, minute, weekday };
}

function scheduleMatches(schedule: string, now: Date, tz: string): boolean {
  const clock = parseClock(schedule);
  if (!clock) return false;
  const local = localParts(now, tz);
  if (local.hour !== clock.hour || local.minute !== clock.minute) return false;

  const s = schedule.toLowerCase();
  if (s.includes("every day")) return true;
  if (s.includes("weekday")) {
    return !["saturday", "sunday"].includes(local.weekday.toLowerCase());
  }
  const dayMatch = s.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i,
  );
  if (dayMatch) {
    return local.weekday.toLowerCase().startsWith(dayMatch[1].slice(0, 3).toLowerCase());
  }
  return false;
}

function fireKey(botId: string, routineId: string, now: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
  return `${botId}:${routineId}:${fmt.format(now)}`;
}

async function tick(): Promise<void> {
  const settings = await loadSettings();
  if (settings.scheduler !== "on") return;

  const tz = settings.timezone || "UTC";
  const now = new Date();
  const bots = await listBots();

  for (const bot of bots) {
    if (bot.kind === "group") continue;
    for (const routine of bot.routines) {
      if (!routine.enabled) continue;
      if (!scheduleMatches(routine.schedule, now, tz)) continue;
      const key = fireKey(bot.id, routine.id, now, tz);
      if (fired.has(key)) continue;
      fired.add(key);
      await runTurn({
        botId: bot.id,
        userText: `/${routine.name}`,
      }).catch(() => undefined);
    }
  }
}

export function startScheduler(): void {
  void tick();
  setInterval(() => {
    void tick();
  }, 60_000);
}
