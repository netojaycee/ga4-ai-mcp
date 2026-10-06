import { createGoogleClient, parseIdToken, REQUIRED_SCOPES, type GoogleClient, type GoogleTokens } from "@/server/connect/google";
import type { ConnectDeps } from "@/server/connect/flow";
import type { AccountView, ConnectRepository, UpsertConnectionInput, UpsertUserInput } from "@/server/connect/repository";

export const SECRET = "s".repeat(40);
export const CLIENT_ID = "client-id.apps.googleusercontent.com";
export const BASE = "https://insights.example.com";
export const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

export function idToken(claims: Record<string, unknown> = {}): string {
  const body = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(NOW / 1000) + 3600,
    sub: "sub-1",
    email: "a@example.com",
    name: "Ann",
    ...claims,
  };
  return `h.${Buffer.from(JSON.stringify(body)).toString("base64url")}.sig`;
}

export class FakeRepo implements ConnectRepository {
  users = new Map<string, { id: string; googleSub: string; email: string; name: string | null; plan: string; trialEndsAt: Date | null; lastSeenAt: Date }>();
  connections = new Map<string, UpsertConnectionInput>();
  tokens: { userId: string; revokedAt: Date | null }[] = [];
  audits: { actor: string; action: string; target?: string; meta?: Record<string, unknown> }[] = [];
  private n = 0;

  async upsertUser(i: UpsertUserInput) {
    const existing = [...this.users.values()].find((u) => u.googleSub === i.googleSub);
    if (existing) {
      Object.assign(existing, { email: i.email, name: i.name, lastSeenAt: i.now });
      return { id: existing.id, email: existing.email, created: false };
    }
    const id = `user-${++this.n}`;
    this.users.set(id, { id, googleSub: i.googleSub, email: i.email, name: i.name, plan: i.newUser.plan, trialEndsAt: i.newUser.trialEndsAt, lastSeenAt: i.now });
    return { id, email: i.email, created: true };
  }
  async upsertConnection(i: UpsertConnectionInput) {
    this.connections.set(i.userId, i);
  }
  async getAccount(userId: string): Promise<AccountView | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const c = this.connections.get(userId);
    return { userId, email: u.email, plan: u.plan as AccountView["plan"], trialEndsAt: u.trialEndsAt, googleEmail: c?.googleEmail ?? null, connectionStatus: c ? "active" : null };
  }
  async getConnectionTokenEnc(userId: string) {
    return this.connections.get(userId)?.refreshTokenEnc ?? null;
  }
  async deleteConnection(userId: string) {
    this.connections.delete(userId);
  }
  async revokeOAuthTokens(userId: string, now: Date) {
    let n = 0;
    for (const t of this.tokens) {
      if (t.userId === userId && !t.revokedAt) {
        t.revokedAt = now;
        n++;
      }
    }
    return n;
  }
  async deleteUser(userId: string) {
    this.users.delete(userId);
    this.connections.delete(userId);
    this.tokens = this.tokens.filter((t) => t.userId !== userId);
  }
  grants = new Map<string, { plan: string; appliedAt: Date | null }>();
  async findPendingGrant(email: string) {
    const g = this.grants.get(email);
    return g && !g.appliedAt ? { plan: g.plan as AccountView["plan"] } : null;
  }
  async markGrantApplied(email: string, now: Date) {
    const g = this.grants.get(email);
    if (g) g.appliedAt = now;
  }
  async audit(e: { actor: string; action: string; target?: string; meta?: Record<string, unknown> }) {
    this.audits.push(e);
  }
}

export class FakeGoogle implements GoogleClient {
  tokens: GoogleTokens = {
    idToken: idToken(),
    refreshToken: "refresh-secret",
    scope: ["openid", "email", "profile", ...REQUIRED_SCOPES].join(" "),
  };
  revoked: string[] = [];
  exchanged: { code: string; redirectUri: string; codeVerifier: string }[] = [];
  private real = createGoogleClient({ clientId: CLIENT_ID, clientSecret: "x", now: () => NOW });
  authUrl = this.real.authUrl;
  verifyIdToken = (t: string) => parseIdToken(t, CLIENT_ID, Math.floor(NOW / 1000));
  async exchangeCode(p: { code: string; redirectUri: string; codeVerifier: string }) {
    this.exchanged.push(p);
    return this.tokens;
  }
  async revoke(token: string) {
    this.revoked.push(token);
    return true;
  }
}

export function makeDeps(repo = new FakeRepo(), google = new FakeGoogle(), over: Partial<ConnectDeps> = {}): ConnectDeps {
  return {
    google,
    repo,
    baseUrl: BASE,
    sessionSecret: SECRET,
    trialDays: 14,
    encrypt: (p) => ({ payload: `v1.enc(${p})`, keyVersion: 1 }),
    now: () => NOW,
    secure: true,
    ...over,
  };
}

/** Runs handleStart and returns the state cookie header value plus the state sent to Google. */
export function cookieFrom(res: Response, name: string): string {
  const c = res.headers.getSetCookie().find((h) => h.startsWith(`${name}=`));
  if (!c) throw new Error(`no ${name} cookie`);
  return c.split(";")[0];
}
