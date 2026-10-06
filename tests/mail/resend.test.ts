import { describe, expect, it, vi } from "vitest";
import { sendWith } from "@/server/mail/resend";

const msg = { to: "a@x.com", subject: "s", text: "t", html: "<p>t</p>" };
const KEY = "re_super_secret_key_123";
const cfg = (fetchImpl: typeof fetch) => ({ apiKey: KEY, from: "Brand <hi@x.com>", fetchImpl });
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("sendWith", () => {
  it("returns not_configured without calling fetch when key or from is missing", async () => {
    const f = vi.fn();
    expect(await sendWith({ apiKey: undefined, from: "x", fetchImpl: f }, msg)).toEqual({ ok: false, reason: "not_configured" });
    expect(await sendWith({ apiKey: KEY, from: undefined, fetchImpl: f }, msg)).toEqual({ ok: false, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to Resend with bearer auth and returns the id", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { id: "abc" }));
    expect(await sendWith(cfg(f), msg)).toEqual({ ok: true, id: "abc" });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "Brand <hi@x.com>", to: ["a@x.com"], subject: "s" });
  });

  it("maps 4xx, 429 and 5xx", async () => {
    expect(await sendWith(cfg(async () => res(422)), msg)).toEqual({ ok: false, reason: "rejected", status: 422 });
    expect(await sendWith(cfg(async () => res(429)), msg)).toEqual({ ok: false, reason: "rate_limited", status: 429 });
    expect(await sendWith(cfg(async () => res(503)), msg)).toEqual({ ok: false, reason: "server_error", status: 503 });
  });

  it("maps network errors and timeouts without leaking the key", async () => {
    const net = await sendWith(
      cfg(async () => {
        throw new Error(`boom ${KEY}`);
      }),
      msg,
    );
    expect(net).toEqual({ ok: false, reason: "network" });
    expect(JSON.stringify(net)).not.toContain(KEY);
    const slow = (async (_u: unknown, init: RequestInit) =>
      new Promise((_r, rej) =>
        init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))),
      )) as unknown as typeof fetch;
    expect(await sendWith({ ...cfg(slow), timeoutMs: 10 }, msg)).toEqual({ ok: false, reason: "timeout" });
  });

  it("tolerates a success response with a non-JSON body", async () => {
    expect(await sendWith(cfg(async () => new Response("ok", { status: 200 })), msg)).toEqual({ ok: true, id: null });
  });
});
