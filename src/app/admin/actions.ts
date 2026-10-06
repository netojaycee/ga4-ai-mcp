"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/guard";
import { drizzleAudit } from "@/server/admin/repos";
import { setKillSwitch } from "@/server/admin/killswitch";
import { killSwitchStore } from "@/server/admin/settings";

export async function killSwitchAction(formData: FormData) {
  const admin = await requireAdmin();
  let msg: string;
  try {
    const r = await setKillSwitch(
      { store: killSwitchStore(), audit: drizzleAudit },
      admin.email,
      { active: formData.get("active"), message: formData.get("message") },
    );
    msg = r.active ? "Kill switch ON: all tool calls are blocked." : "Kill switch off.";
  } catch (e) {
    console.error(`[admin] kill switch update failed: ${e instanceof Error ? e.name : typeof e}`);
    redirect(`/admin?err=${encodeURIComponent("Could not update the kill switch.")}`);
  }
  revalidatePath("/admin");
  redirect(`/admin?msg=${encodeURIComponent(msg)}`);
}
