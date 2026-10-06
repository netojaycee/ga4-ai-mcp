import { describe, expect, it } from "vitest";
import { inviteEmail, trialEndedEmail, trialEndingEmail, type MailBrand } from "@/server/mail/templates";

const brand: MailBrand = {
  name: `Acme <b>"&</b>`,
  baseUrl: "https://acme.test",
  mcpUrl: "https://acme.test/mcp",
  privacyUrl: "https://acme.test/privacy",
};

describe("templates", () => {
  it("every template includes landing, MCP and privacy URLs in text and html", () => {
    for (const m of [inviteEmail(brand), trialEndingEmail(brand), trialEndedEmail(brand)]) {
      for (const u of [brand.baseUrl, brand.mcpUrl, brand.privacyUrl]) {
        expect(m.text).toContain(u);
        expect(m.html).toContain(u);
      }
    }
  });

  it("escapes the personal note and the brand name in html", () => {
    const m = inviteEmail(brand, { note: `<script>alert(1)</script> & "hi"` });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;hi&quot;");
    expect(m.html).not.toContain("<b>");
    expect(m.html).toContain("Acme &lt;b&gt;");
    expect(m.text).toContain("<script>alert(1)</script>");
  });

  it("omits the note block when empty and keeps subjects single-line", () => {
    expect(inviteEmail(brand, { note: "  " }).text).not.toContain("Personal note");
    const s = trialEndingEmail({ ...brand, name: "A\r\nBcc: x@y.z" }).subject;
    expect(s).not.toMatch(/[\r\n]/);
  });

  it("trial emails state their timing", () => {
    expect(trialEndingEmail(brand).subject).toContain("3 days");
    expect(trialEndedEmail(brand).subject).toContain("ended");
  });
});
