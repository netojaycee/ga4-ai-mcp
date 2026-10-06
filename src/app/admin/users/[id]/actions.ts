"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/guard";
import { userActionDeps } from "@/server/admin/deps";
import {
  AdminActionError,
  changeNotes,
  changePlan,
  changeTrial,
  disconnectGoogle,
  revokeSessions,
  suspendUser,
  unsuspendUser,
  type UserActionDeps,
} from "@/server/admin/users";

type Run = (d: UserActionDeps, actor: string) => Promise<string>;

async function perform(userId: unknown, run: Run): Promise<never> {
  const admin = await requireAdmin();
  const id = typeof userId === "string" ? userId : "";
  let outcome: { ok: true; msg: string } | { ok: false; msg: string };
  try {
    outcome = { ok: true, msg: await run(userActionDeps(), admin.email) };
  } catch (e) {
    if (!(e instanceof AdminActionError)) {
      console.error(`[admin] action failed: ${e instanceof Error ? e.name : typeof e}`);
    }
    outcome = { ok: false, msg: e instanceof AdminActionError ? e.message : "Something went wrong. Nothing was changed, or only partly: check the audit log." };
  }
  revalidatePath(`/admin/users/${id}`);
  revalidatePath("/admin");
  redirect(`/admin/users/${encodeURIComponent(id)}?${outcome.ok ? "msg" : "err"}=${encodeURIComponent(outcome.msg)}`);
}

const field = (f: FormData, k: string) => f.get(k) ?? undefined;

export async function updatePlanAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    await changePlan(d, actor, { userId: field(formData, "userId"), plan: field(formData, "plan") });
    return "Plan updated.";
  });
}

export async function updateTrialAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    await changeTrial(d, actor, {
      userId: field(formData, "userId"),
      trial: { mode: field(formData, "mode"), days: field(formData, "days"), date: field(formData, "date") },
    });
    return "Trial end updated.";
  });
}

export async function updateNotesAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    await changeNotes(d, actor, { userId: field(formData, "userId"), notes: field(formData, "notes") });
    return "Notes saved.";
  });
}

export async function revokeSessionsAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    const n = await revokeSessions(d, actor, { userId: field(formData, "userId"), confirm: field(formData, "confirm") });
    return `Revoked ${n} token${n === 1 ? "" : "s"}.`;
  });
}

export async function disconnectGoogleAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    const r = await disconnectGoogle(d, actor, { userId: field(formData, "userId"), confirm: field(formData, "confirm") });
    return `Google disconnected (${r.googleRevoked ? "revoked at Google" : "could not revoke at Google; the stored token was deleted"}); ${r.revokedTokens} token(s) revoked.`;
  });
}

export async function suspendAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    await suspendUser(d, actor, { userId: field(formData, "userId"), confirm: field(formData, "confirm") });
    return "User suspended and sessions revoked.";
  });
}

export async function unsuspendAction(formData: FormData) {
  return perform(field(formData, "userId"), async (d, actor) => {
    await unsuspendUser(d, actor, { userId: field(formData, "userId") });
    return "User unsuspended.";
  });
}
