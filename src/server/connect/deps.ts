import { env } from "@/config/env";
import { decryptSecret, encryptSecret, payloadVersion } from "@/server/security/crypto";
import type { AccountDeps } from "./account";
import type { ConnectDeps } from "./flow";
import { createGoogleClient } from "./google";
import { drizzleConnectRepository } from "./repository";
import { isProduction } from "./signed";

/** Production wiring. Called per request so `env()` is never read at import time. */
export function connectDeps(): ConnectDeps {
  const e = env();
  return {
    google: createGoogleClient({ clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }),
    repo: drizzleConnectRepository(),
    baseUrl: e.PUBLIC_BASE_URL,
    sessionSecret: e.SESSION_SECRET,
    trialDays: e.TRIAL_DAYS,
    encrypt: (plaintext) => {
      const payload = encryptSecret(plaintext);
      return { payload, keyVersion: Number(payloadVersion(payload)) };
    },
    now: () => Date.now(),
    secure: isProduction(),
  };
}

export function accountDeps(): AccountDeps {
  const e = env();
  return {
    google: createGoogleClient({ clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }),
    repo: drizzleConnectRepository(),
    baseUrl: e.PUBLIC_BASE_URL,
    sessionSecret: e.SESSION_SECRET,
    decrypt: decryptSecret,
    now: () => Date.now(),
  };
}
