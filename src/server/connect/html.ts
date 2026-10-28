import { PAGE_STYLE } from "@/server/oauth/html";

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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(o.title)}</title><style>${PAGE_STYLE}</style></head><body><div class="wrap"><main class="card"><h1>${escapeHtml(o.title)}</h1>${o.bodyHtml}</main></div></body></html>`;
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  for (const c of o.setCookies ?? []) headers.append("set-cookie", c);
  return new Response(html, { status: o.status ?? 200, headers });
}

export function redirect(location: string, setCookies: string[] = [], status = 302): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status, headers });
}
