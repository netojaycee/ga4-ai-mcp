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
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:10vh auto;padding:0 1rem;color:#111}
.card{border:1px solid #ddd;border-radius:12px;padding:1.5rem}
button{font:inherit;padding:.6rem 1.2rem;border-radius:8px;border:1px solid #888;background:#fff;cursor:pointer}
button.primary{background:#111;color:#fff;border-color:#111}
.row{display:flex;gap:.75rem;margin-top:1.5rem}
.muted{color:#555;font-size:.9rem}`;

function page(title: string, body: string, status: number, extra: Record<string, string> = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
    title,
  )}</title><style>${STYLE}</style></head><body><div class="card">${body}</div></body></html>`;
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
<p class="muted">Access is read-only. You are signed in as ${escapeHtml(view.email)}. After you choose, you will be sent back to ${escapeHtml(
    view.redirectHost,
  )}.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
<div class="row"><button class="primary" type="submit" name="decision" value="approve">Approve</button><button type="submit" name="decision" value="deny">Deny</button></div></form>`;
  return page("Authorize access", body, 200, extraHeaders);
}
