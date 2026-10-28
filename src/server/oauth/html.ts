export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** No framing, no scripts, no external loads. form-action is deliberately unset: Chrome applies it to redirects. */
export const HTML_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // not "no-referrer": that makes browsers send `Origin: null` on the consent form POST
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export const PAGE_STYLE = `:root{--bg:#f6f7fb;--fg:#14161c;--surface:#fff;--line:#e4e7ef;--muted:#586174;--accent:#4f46e5;--accent-h:#4338ca;--soft:#eceeff;--danger:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--fg:#e9ebf1;--surface:#131620;--line:#242938;--muted:#9aa3b5;--accent:#6366f1;--accent-h:#7b7ff5;--soft:#1d2040;--danger:#f87171}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:1.25rem}
.wrap{width:100%;max-width:30rem}
.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;margin:0 0 1rem .25rem}
.brand i{width:1.6rem;height:1.6rem;border-radius:.45rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:inline-block}
.card{background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:1.75rem;box-shadow:0 1px 2px rgb(16 24 40/.05),0 12px 32px rgb(16 24 40/.06)}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .75rem;letter-spacing:-.01em}
p{margin:.6rem 0}
a{color:var(--accent)}
.muted{color:var(--muted);font-size:.9rem}
.pill{display:inline-block;padding:.1rem .6rem;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:600;font-size:.85rem;word-break:break-all}
.row{display:flex;gap:.75rem;margin-top:1.5rem}
.row button{flex:1}
button,a.btn{font:inherit;font-weight:600;padding:.7rem 1.2rem;border-radius:.75rem;border:1px solid var(--line);background:var(--surface);color:var(--fg);cursor:pointer;text-decoration:none;display:inline-block;text-align:center}
button:hover,a.btn:hover{border-color:var(--accent)}
button.primary,a.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.primary:hover{background:var(--accent-h)}
button.link{all:unset;color:var(--accent);cursor:pointer;text-decoration:underline;font-weight:600}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (max-width:30rem){.row{flex-direction:column-reverse}}`;

function page(title: string, body: string, status: number, extra: Record<string, string> = {}, brandName?: string): Response {
  const head = brandName ? `<div class="brand"><i></i>${escapeHtml(brandName)}</div>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(
    title,
  )}</title><style>${PAGE_STYLE}</style></head><body><div class="wrap">${head}<div class="card">${body}</div></div></body></html>`;
  return new Response(html, { status, headers: { ...HTML_HEADERS, ...extra } });
}

export function errorPage(message: string, status = 400): Response {
  return page("Authorization error", `<h1>Cannot continue</h1><p>${escapeHtml(message)}</p>`, status);
}

export interface ConsentView {
  brandName: string;
  clientName: string;
  redirectHost: string;
  email: string;
  fields: Record<string, string>;
  csrf: string;
}

export function consentPage(view: ConsentView, extraHeaders: Record<string, string>): Response {
  const hidden = Object.entries(view.fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  const body = `<h1>Authorize access</h1>
<p><strong>${escapeHtml(view.clientName)}</strong> wants to read your Google Analytics and Search Console data via ${escapeHtml(
    view.brandName,
  )}.</p>
<p class="muted">This application registered itself automatically, and the name above is chosen by the application, not verified by us. Only approve if you just started connecting it yourself.</p>
<p class="muted">Access is read-only. You are signed in as <span class="pill">${escapeHtml(view.email)}</span>. After you choose, you will be sent back to ${escapeHtml(
    view.redirectHost,
  )}.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
<div class="row"><button class="primary" type="submit" name="decision" value="approve">Approve</button><button type="submit" name="decision" value="deny">Deny</button></div>
<p class="muted">Not ${escapeHtml(view.email)}? <button type="submit" class="link" name="decision" value="switch">Switch account</button></p></form>`;
  return page("Authorize access", body, 200, extraHeaders, view.brandName);
}
