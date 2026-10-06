"use server";

import { requireAdmin } from "@/server/admin/guard";
import { drizzleInviteDeps, sendInvites, type InviteOutcome } from "@/server/mail/invites";

export type InviteState = InviteOutcome | null;

export async function sendInvitesAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const recipients = formData.get("emails");
  const note = formData.get("note");
  if (typeof recipients !== "string" || typeof note !== "string") return { ok: false, error: "Invalid form submission." };
  return sendInvites(drizzleInviteDeps(), { actor: admin.email, recipients, note });
}
