import { describe, expect, it, vi } from "vitest";
import {
  MAX_NOTE_LENGTH,
  MAX_RECIPIENTS_PER_ADMIN_PER_HOUR,
  MAX_RECIPIENTS_PER_SEND,
  parseRecipients,
  sendInvites,
  type InviteDeps,
} from "@/server/mail/invites";
import type { SendResult } from "@/server/mail/resend";

const brand = { name: "B", baseUrl: "https://b.test", mcpUrl: "https://b.test/mcp", privacyUrl: "https://b.test/privacy" };

function deps(over: { results?: SendResult[]; used?: number; countRecent?: InviteDeps["countRecent"] } = {}) {
  const audit: unknown[] = [];
  const results = [...(over.results ?? [])];
  const d: InviteDeps = {
    brand,
    now: () => new Date("2026-10-06T12:00:00Z"),
    send: async () => results.shift() ?? { ok: true, id: "1" },
    countRecent: over.countRecent ?? (async () => over.used ?? 0),
    audit: async (r) => void audit.push(r),
  };
  return { d, audit };
}

describe("parseRecipients", () => {
  it("splits on commas and newlines, lowercases, dedupes, flags invalid", () => {
    const p = parseRecipients("A@x.com, b@x.com\nnot-an-email\r\na@x.com;c@x.co,  ,<x>@y.com");
    expect(p.valid).toEqual(["a@x.com", "b@x.com", "c@x.co"]);
    expect(p.invalid).toEqual(["not-an-email", "<x>@y.com"]);
    expect(p.duplicates).toBe(1);
  });
});

describe("sendInvites", () => {
  it("validates input", async () => {
    const { d } = deps();
    expect((await sendInvites(d, { actor: "a", recipients: "", note: "" })).ok).toBe(false);
    expect((await sendInvites(d, { actor: "a", recipients: "bad", note: "" })).ok).toBe(false);
    expect((await sendInvites(d, { actor: "a", recipients: "a@x.com", note: "x".repeat(MAX_NOTE_LENGTH + 1) })).ok).toBe(false);
    const many = Array.from({ length: MAX_RECIPIENTS_PER_SEND + 1 }, (_, i) => `u${i}@x.com`).join(",");
    expect(await sendInvites(d, { actor: "a", recipients: many, note: "" })).toMatchObject({ ok: false });
  });

  it("sends, reports per recipient and audits result only (no body)", async () => {
    const { d, audit } = deps({ results: [{ ok: true, id: "1" }, { ok: false, reason: "rejected", status: 422 }] });
    const out = await sendInvites(d, { actor: "admin@x.com", recipients: "a@x.com,b@x.com", note: "SECRET NOTE" });
    expect(out).toMatchObject({
      ok: true,
      results: [
        { email: "a@x.com", status: "sent" },
        { email: "b@x.com", status: "failed", detail: "rejected" },
      ],
    });
    expect(audit).toEqual([
      { actor: "admin@x.com", action: "admin.invite.sent", target: "a@x.com", meta: { result: "sent" } },
      { actor: "admin@x.com", action: "admin.invite.sent", target: "b@x.com", meta: { result: "failed", reason: "rejected", status: 422 } },
    ]);
    expect(JSON.stringify(audit)).not.toContain("SECRET NOTE");
  });

  it("enforces the per-admin hourly cap using the last hour of audit rows", async () => {
    const countRecent = vi.fn(async () => MAX_RECIPIENTS_PER_ADMIN_PER_HOUR);
    const { d } = deps({ countRecent });
    expect(await sendInvites(d, { actor: "a", recipients: "a@x.com", note: "" })).toMatchObject({ ok: false });
    expect(countRecent).toHaveBeenCalledWith("a", new Date("2026-10-06T11:00:00Z"));
  });

  it("skips recipients beyond the remaining cap", async () => {
    const { d, audit } = deps({ used: MAX_RECIPIENTS_PER_ADMIN_PER_HOUR - 1 });
    const out = await sendInvites(d, { actor: "a", recipients: "a@x.com,b@x.com", note: "" });
    expect(out).toMatchObject({ ok: true, results: [{ status: "sent" }, { status: "skipped" }] });
    expect(audit).toHaveLength(1);
  });

  it("stops after a rate-limit error", async () => {
    const { d } = deps({ results: [{ ok: false, reason: "rate_limited", status: 429 }] });
    const out = await sendInvites(d, { actor: "a", recipients: "a@x.com,b@x.com", note: "" });
    expect(out).toMatchObject({ ok: true, results: [{ status: "failed" }, { status: "skipped" }] });
  });
});
