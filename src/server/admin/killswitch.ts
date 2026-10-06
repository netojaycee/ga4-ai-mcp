import { z } from "zod";
import type { KillSwitchState, KillSwitchStore } from "./settings";
import type { AuditFn } from "./users";

const inputSchema = z.object({
  active: z.enum(["on", "off"]),
  message: z
    .string()
    .max(500, "Message is too long (500 characters max).")
    .optional()
    .transform((s) => s?.trim() || null),
});

export async function setKillSwitch(
  d: { store: Pick<KillSwitchStore, "get" | "set">; audit: AuditFn },
  actor: string,
  input: { active: unknown; message: unknown },
): Promise<KillSwitchState> {
  const p = inputSchema.parse({ active: input.active ?? undefined, message: input.message ?? undefined });
  let before: KillSwitchState | null = null;
  try {
    before = await d.store.get();
  } catch {
    before = null;
  }
  const next: KillSwitchState = { active: p.active === "on", message: p.message };
  await d.store.set(next);
  await d.audit({
    actor,
    action: next.active ? "admin.kill_switch.enabled" : "admin.kill_switch.disabled",
    meta: { before, after: next },
  });
  return next;
}
