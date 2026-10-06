export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface PageOptions {
  title: string;
  status?: number;
  /** Trusted HTML (callers escape dynamic values). */
  bodyHtml: string;
  setCookies?: string[];
}

/** Minimal, accessible, dependency-free HTML page for the connect flow outcomes. */
export function htmlPage(o: PageOptions): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(o.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#111}a.btn,button{display:inline-block;padding:.6rem 1rem;border-radius:.4rem;border:1px solid #111;background:#111;color:#fff;font:inherit;text-decoration:none;cursor:pointer}:focus-visible{outline:3px solid #2563eb;outline-offset:2px}</style></head><body><main><h1>${escapeHtml(o.title)}</h1>${o.bodyHtml}</main></body></html>`;
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  for (const c of o.setCookies ?? []) headers.append("set-cookie", c);
  return new Response(html, { status: o.status ?? 200, headers });
}

export function redirect(location: string, setCookies: string[] = [], status = 302): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status, headers });
}
