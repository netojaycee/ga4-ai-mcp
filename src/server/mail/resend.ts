import { env } from "@/config/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendFailureReason = "not_configured" | "rate_limited" | "rejected" | "server_error" | "timeout" | "network";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: SendFailureReason; status?: number };

export interface MailerConfig {
  apiKey: string | undefined;
  from: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const ENDPOINT = "https://api.resend.com/emails";

/**
 * Plain-fetch Resend client. Never throws and never logs: results carry a reason code only,
 * so neither the API key nor message bodies can leak through errors.
 */
export async function sendWith(config: MailerConfig, message: EmailMessage): Promise<SendResult> {
  if (!config.apiKey || !config.from) return { ok: false, reason: "not_configured" };
  const doFetch = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
      return { ok: true, id: typeof body?.id === "string" ? body.id : null };
    }
    if (res.status === 429) return { ok: false, reason: "rate_limited", status: 429 };
    if (res.status >= 500) return { ok: false, reason: "server_error", status: res.status };
    return { ok: false, reason: "rejected", status: res.status };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return { ok: false, reason: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const e = env();
  return sendWith({ apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM }, message);
}
