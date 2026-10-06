import { afterEach, describe, expect, it, vi } from "vitest";
import { setKillSwitch } from "@/server/admin/killswitch";
import { createKillSwitchStore, DEFAULT_KILL_MESSAGE, KILL_SWITCH_KEY, type SettingsRepo } from "@/server/admin/settings";
import { runTool } from "@/server/mcp/wrapper";
import { ctx, makeDeps, makeUser } from "../mcp/helpers";
import type { AuditEntry } from "@/server/admin/users";

afterEach(() => vi.restoreAllMocks());

function repoWith(value: Record<string, unknown> | null) {
  const store = { value, reads: 0 };
  const repo: SettingsRepo = {
    get: async () => {
      store.reads++;
      return store.value;
    },
    set: async (_k, v) => {
      store.value = v;
    },
  };
  return { repo, store };
}

describe("kill switch store", () => {
  it("is off by default and caches reads for the ttl", async () => {
    let t = 1_000;
    const { repo, store } = repoWith(null);
    const ks = createKillSwitchStore(repo, { ttlMs: 10_000, now: () => t });
    expect(await ks.get()).toEqual({ active: false, message: null });
    store.value = { active: true, message: "down" };
    t += 9_999;
    expect((await ks.get()).active).toBe(false);
    expect(store.reads).toBe(1);
    t += 2;
    expect(await ks.get()).toEqual({ active: true, message: "down" });
    expect(store.reads).toBe(2);
  });

  it("set updates the cache immediately and persists under the kill_switch key", async () => {
    const set = vi.fn(async () => {});
    const ks = createKillSwitchStore({ get: async () => null, set });
    await ks.set({ active: true, message: "m" });
    expect(set).toHaveBeenCalledWith(KILL_SWITCH_KEY, { active: true, message: "m" });
    expect((await ks.get()).active).toBe(true);
  });

  it("does not cache read errors", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ active: true });
    const ks = createKillSwitchStore({ get, set: async () => {} });
    await expect(ks.get()).rejects.toThrow("boom");
    expect((await ks.get()).active).toBe(true);
  });
});

describe("setKillSwitch", () => {
  it("validates, persists and audits", async () => {
    const audits: AuditEntry[] = [];
    const { repo } = repoWith(null);
    const store = createKillSwitchStore(repo);
    const audit = async (e: AuditEntry) => void audits.push(e);
    await setKillSwitch({ store, audit }, "admin@x.com", { active: "on", message: "  maintenance  " });
    expect(await store.get()).toEqual({ active: true, message: "maintenance" });
    expect(audits[0]).toMatchObject({ actor: "admin@x.com", action: "admin.kill_switch.enabled", meta: { after: { active: true, message: "maintenance" } } });
    await setKillSwitch({ store, audit }, "admin@x.com", { active: "off", message: "" });
    expect(audits[1].action).toBe("admin.kill_switch.disabled");
    await expect(setKillSwitch({ store, audit }, "a", { active: "maybe", message: "" })).rejects.toThrow();
    await expect(setKillSwitch({ store, audit }, "a", { active: "on", message: "x".repeat(501) })).rejects.toThrow();
    expect(audits).toHaveLength(2);
  });
});

describe("runTool honours the kill switch", () => {
  const text = (r: { content: unknown }) => (r.content as { text: string }[])[0].text;

  it("blocks every call with the custom message, without running the handler", async () => {
    const { deps, usage } = makeDeps(makeUser(), { killSwitch: async () => ({ active: true, message: "Back at 5pm." }) });
    const handler = vi.fn();
    const res = await runTool("t", ctx, handler, deps);
    expect(res.isError).toBe(true);
    expect(text(res)).toBe("Back at 5pm.");
    expect(handler).not.toHaveBeenCalled();
    expect(usage[0]).toMatchObject({ ok: false, errorCode: "plan_blocked" });
  });

  it("uses a default message", async () => {
    const { deps } = makeDeps(makeUser(), { killSwitch: async () => ({ active: true, message: null }) });
    expect(text(await runTool("t", ctx, vi.fn(), deps))).toBe(DEFAULT_KILL_MESSAGE);
  });

  it("runs normally when off", async () => {
    const { deps } = makeDeps(makeUser(), { killSwitch: async () => ({ active: false, message: null }) });
    const res = await runTool("t", ctx, async () => ({ text: "ok" }), deps);
    expect(res.isError).toBeUndefined();
    expect(text(res)).toBe("ok");
  });

  it("fails open when the lookup throws, logging the error name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = makeDeps(makeUser(), {
      killSwitch: async () => {
        throw new TypeError("connection string postgres://secret");
      },
    });
    const res = await runTool("t", ctx, async () => ({ text: "ok" }), deps);
    expect(text(res)).toBe("ok");
    expect(spy).toHaveBeenCalledWith("[mcp] kill switch lookup failed: TypeError");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
  });
});
