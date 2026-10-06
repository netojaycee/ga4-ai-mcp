import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createFetchTokenClient,
  getGoogleAuth,
  InvalidGrantError,
  type AccessTokenCache,
  type ConnectionRow,
  type ConnectionStore,
  type SecretCodec,
  type TokenClient,
} from "@/server/google/auth";
import { decrypt, encrypt, payloadVersion } from "@/server/security/crypto";

const keys = { "1": randomBytes(32).toString("base64"), "2": randomBytes(32).toString("base64") };
const codec = (current: string): SecretCodec => ({
  decrypt: (p) => decrypt(p, keys),
  encrypt: (t) => encrypt(t, keys, current),
  needsReencryption: (p) => payloadVersion(p) !== current,
  versionOf: (p) => Number(payloadVersion(p)),
});

function setup(
  opts: { row?: Partial<ConnectionRow> | null; current?: string; refresh?: TokenClient["refresh"]; stored?: string } = {},
) {
  const stored = opts.stored ?? encrypt("refresh-token-1", keys, "1");
  const row: ConnectionRow | undefined =
    opts.row === null ? undefined : { id: "c1", refreshTokenEnc: stored, status: "active", ...opts.row };
  const store: ConnectionStore = {
    findByUserId: vi.fn(async () => row),
    markRefreshed: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
  };
  const map = new Map<string, { token: string; expiresAt: number }>();
  const cache: AccessTokenCache = {
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k),
  };
  const refresh = vi.fn(opts.refresh ?? (async () => ({ accessToken: "at-1", expiresInSec: 3600 })));
  let now = 1_000_000;
  return {
    store,
    refresh,
    advance: (ms: number) => (now += ms),
    auth: () =>
      getGoogleAuth("u1", { store, tokens: { refresh }, codec: codec(opts.current ?? "1"), cache, now: () => now }),
  };
}

describe("getGoogleAuth", () => {
  it("throws auth_required when there is no connection", async () => {
    await expect(setup({ row: null }).auth()).rejects.toMatchObject({ code: "auth_required" });
  });

  it("throws reconnect_required for revoked or errored connections", async () => {
    await expect(setup({ row: { status: "revoked" } }).auth()).rejects.toMatchObject({ code: "reconnect_required" });
    await expect(setup({ row: { status: "error" } }).auth()).rejects.toMatchObject({ code: "reconnect_required" });
  });

  it("decrypts the stored token, refreshes, and records last_refresh_at", async () => {
    const s = setup();
    const auth = await s.auth();
    expect(await auth.getAccessToken()).toBe("at-1");
    expect(s.refresh).toHaveBeenCalledWith("refresh-token-1");
    expect(s.store.markRefreshed).toHaveBeenCalledWith("c1", { at: expect.any(Date) });
  });

  it("caches the access token until shortly before expiry, then refreshes again", async () => {
    const s = setup();
    const auth = await s.auth();
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.advance(3600_000 - 30_000);
    await auth.getAccessToken();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("re-encrypts with the current key when the stored version is old", async () => {
    const s = setup({ current: "2" });
    const auth = await s.auth();
    await auth.getAccessToken();
    const update = vi.mocked(s.store.markRefreshed).mock.calls[0][1];
    expect(update.encKeyVersion).toBe(2);
    expect(update.refreshTokenEnc && payloadVersion(update.refreshTokenEnc)).toBe("2");
    expect(decrypt(update.refreshTokenEnc!, keys)).toBe("refresh-token-1");
  });

  it("does not re-encrypt when already on the current key", async () => {
    const s = setup({ current: "1" });
    await (await s.auth()).getAccessToken();
    expect(vi.mocked(s.store.markRefreshed).mock.calls[0][1].refreshTokenEnc).toBeUndefined();
  });

  it("marks the connection as error and requires reconnect on invalid_grant", async () => {
    const s = setup({
      refresh: async () => {
        throw new InvalidGrantError();
      },
    });
    const auth = await s.auth();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "reconnect_required" });
    expect(s.store.markError).toHaveBeenCalledWith("c1");
  });

  it("treats other refresh failures as transient upstream errors without marking error", async () => {
    const s = setup({
      refresh: async () => {
        throw new Error("boom");
      },
    });
    const auth = await s.auth();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "upstream_error" });
    expect(s.store.markError).not.toHaveBeenCalled();
  });

  it("requires reconnect when the stored token cannot be decrypted", async () => {
    const other = { "1": randomBytes(32).toString("base64") };
    const s = setup({ stored: encrypt("x", other, "1") });
    await expect(s.auth()).rejects.toMatchObject({ code: "reconnect_required" });
  });
});

describe("createFetchTokenClient", () => {
  const testEnv = {
    PUBLIC_BASE_URL: "https://x.test",
    DATABASE_URL: "postgres://x",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
    TOKEN_ENC_KEYS: JSON.stringify(keys),
    TOKEN_ENC_CURRENT: "1",
    SESSION_SECRET: "s".repeat(32),
  };
  const withEnv = async (fn: () => Promise<void>) => {
    const saved = { ...process.env };
    Object.assign(process.env, testEnv);
    try {
      await fn();
    } finally {
      process.env = saved;
    }
  };

  it("posts a refresh_token grant and parses the response", () =>
    withEnv(async () => {
      let sent = "";
      const f = (async (_u: string, init: RequestInit) => {
        sent = String(init.body);
        return new Response(JSON.stringify({ access_token: "a", expires_in: 3599 }));
      }) as unknown as typeof fetch;
      const r = await createFetchTokenClient(f).refresh("rt");
      expect(r).toEqual({ accessToken: "a", expiresInSec: 3599 });
      expect(sent).toContain("grant_type=refresh_token");
      expect(sent).toContain("refresh_token=rt");
    }));

  it("maps invalid_grant to InvalidGrantError", () =>
    withEnv(async () => {
      const f = (async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
      await expect(createFetchTokenClient(f).refresh("rt")).rejects.toBeInstanceOf(InvalidGrantError);
    }));

  it("keeps the secret and response out of other error messages", () =>
    withEnv(async () => {
      const f = (async () =>
        new Response(JSON.stringify({ error: "server_error", detail: "csecret" }), {
          status: 500,
        })) as unknown as typeof fetch;
      const err = await createFetchTokenClient(f)
        .refresh("rt")
        .catch((e: Error) => e);
      expect((err as Error).message).not.toContain("csecret");
      expect((err as Error).message).not.toContain("server_error");
    }));
});
