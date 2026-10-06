import { z } from "zod";

const base64Key32 = z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
  message: "must be base64 for exactly 32 bytes",
});

const keyring = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be JSON like {\"1\":\"<base64>\"}" });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string().regex(/^\d+$/), base64Key32))
  .refine((k) => Object.keys(k).length > 0, { message: "must contain at least one key" });

const emailList = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

const schema = z
  .object({
    PUBLIC_BASE_URL: z.url().transform((u) => u.replace(/\/+$/, "")),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    TOKEN_ENC_KEYS: keyring,
    TOKEN_ENC_CURRENT: z.string().regex(/^\d+$/),
    SESSION_SECRET: z.string().min(32),
    ADMIN_EMAILS: emailList,
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    SUPPORT_EMAIL: z.email().optional(),
    BRAND_NAME: z.string().min(1).default("Insights Connector"),
    TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(14),
  })
  .refine((e) => e.TOKEN_ENC_CURRENT in e.TOKEN_ENC_KEYS, {
    path: ["TOKEN_ENC_CURRENT"],
    message: "does not match any version in TOKEN_ENC_KEYS",
  });

export type Env = z.infer<typeof schema>;

/** Tools like `vercel env pull` write KEY="value"; copying that verbatim bakes literal quotes into the value. */
const wrappedInQuotes = (v: string) => /^(["']).*\1$/.test(v.trim());

export function parseEnv(source: Record<string, string | undefined>): Env {
  const quoted = Object.keys(schema.shape).filter((k) => {
    const v = source[k];
    return v !== undefined && wrappedInQuotes(v);
  });
  if (quoted.length) {
    throw new Error(
      `Invalid environment configuration:\n${quoted.map((k) => `  - ${k}: value is wrapped in literal quote characters; remove them`).join("\n")}`,
    );
  }
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report variable names and reasons only, never values.
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated env, parsed on first use so builds without secrets still succeed. */
export function env(): Env {
  return (cached ??= parseEnv(process.env));
}
