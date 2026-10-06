"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/guard";
import { applyGrants, GrantInputError, revokeGrant } from "@/server/admin/grants";
import { drizzleAudit, drizzleGrantsRepo } from "@/server/admin/repos";

const back = (kind: "msg" | "err", text: string) => `/admin/grants?${kind}=${encodeURIComponent(text)}`;

export async function applyGrantsAction(formData: FormData) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const r = await applyGrants({ repo: drizzleGrantsRepo(), audit: drizzleAudit }, admin.email, {
      emails: formData.get("emails"),
      plan: formData.get("plan"),
      note: formData.get("note"),
    });
    const parts = [
      `${r.updated.length} existing user(s) updated`,
      `${r.pending.length} pre-approved for first sign-in`,
      `${r.alreadyOnPlan.length} already on that plan`,
    ];
    if (r.duplicates) parts.push(`${r.duplicates} duplicate(s) ignored`);
    if (r.invalid.length) parts.push(`${r.invalid.length} invalid skipped: ${r.invalid.slice(0, 5).join(", ")}${r.invalid.length > 5 ? ", ..." : ""}`);
    target = back("msg", parts.join("; ") + ".");
  } catch (e) {
    if (!(e instanceof GrantInputError)) console.error(`[admin] grants failed: ${e instanceof Error ? e.name : typeof e}`);
    target = back("err", e instanceof GrantInputError ? e.message : "Something went wrong. Check the audit log to see what was applied.");
  }
  revalidatePath("/admin/grants");
  redirect(target);
}

export async function revokeGrantAction(formData: FormData) {
  const admin = await requireAdmin();
  let target: string;
  try {
    await revokeGrant({ repo: drizzleGrantsRepo(), audit: drizzleAudit }, admin.email, formData.get("email"));
    target = back("msg", "Pending grant removed.");
  } catch (e) {
    if (!(e instanceof GrantInputError)) console.error(`[admin] grant revoke failed: ${e instanceof Error ? e.name : typeof e}`);
    target = back("err", e instanceof GrantInputError ? e.message : "Could not remove the grant.");
  }
  revalidatePath("/admin/grants");
  redirect(target);
}
