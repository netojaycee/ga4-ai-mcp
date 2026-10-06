import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appSettings } from "@/server/db/schema";

export const KILL_SWITCH_KEY = "kill_switch";
export const DEFAULT_KILL_MESSAGE = "The service is temporarily paused.";
export const KILL_SWITCH_CACHE_MS = 10_000;

export interface KillSwitchState {
  active: boolean;
  message: string | null;
}

export interface SettingsRepo {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
}

export function drizzleSettingsRepo(): SettingsRepo {
  return {
    async get(key) {
      const [r] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
      return r?.v ?? null;
    },
    async set(key, value) {
      await db()
        .insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    },
  };
}

function toState(v: Record<string, unknown> | null): KillSwitchState {
  const message = typeof v?.message === "string" && v.message.trim() ? v.message.trim().slice(0, 500) : null;
  return { active: v?.active === true, message };
}

export interface KillSwitchStore {
  get(): Promise<KillSwitchState>;
  set(state: KillSwitchState): Promise<void>;
  invalidate(): void;
}

/** Reads through a short in-memory cache. Read errors propagate (callers decide to fail open) and are not cached. */
export function createKillSwitchStore(
  repo: SettingsRepo,
  opts: { ttlMs?: number; now?: () => number } = {},
): KillSwitchStore {
  const ttl = opts.ttlMs ?? KILL_SWITCH_CACHE_MS;
  const now = opts.now ?? Date.now;
  let cached: { state: KillSwitchState; at: number } | null = null;
  return {
    async get() {
      if (cached && now() - cached.at < ttl) return cached.state;
      const state = toState(await repo.get(KILL_SWITCH_KEY));
      cached = { state, at: now() };
      return state;
    },
    async set(state) {
      await repo.set(KILL_SWITCH_KEY, { active: state.active, message: state.message });
      cached = { state, at: now() };
    },
    invalidate() {
      cached = null;
    },
  };
}

let shared: KillSwitchStore | null = null;
/** Process-wide store (per serverless instance). */
export function killSwitchStore(): KillSwitchStore {
  return (shared ??= createKillSwitchStore(drizzleSettingsRepo()));
}

export const getKillSwitch = () => killSwitchStore().get();
