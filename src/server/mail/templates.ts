import type { EmailMessage } from "./resend";

export interface MailBrand {
  name: string;
  baseUrl: string;
  mcpUrl: string;
  privacyUrl: string;
}

export type RenderedEmail = Pick<EmailMessage, "subject" | "text" | "html">;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Header values must not carry line breaks (subject injection). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function howToConnect(b: MailBrand): string[] {
  return [
    `1. Add a custom MCP connector in your AI assistant (ChatGPT, Claude, Cursor, ...) using this server URL: ${b.mcpUrl}`,
    "2. Sign in with Google when asked and approve read-only access to Google Analytics 4 and Search Console.",
    "3. Ask your assistant about your traffic, pages or search queries.",
  ];
}

function layout(b: MailBrand, paragraphs: string[], opts: { note?: string; steps?: boolean }): string {
  const parts = paragraphs.map((t) => `<p>${escapeHtml(t)}</p>`);
  if (opts.note) {
    parts.push(
      `<blockquote style="margin:1em 0;padding-left:1em;border-left:3px solid #ccc;white-space:pre-wrap">${escapeHtml(opts.note)}</blockquote>`,
    );
  }
  if (opts.steps) {
    parts.push(
      "<p>How to connect:</p>",
      "<ol>",
      `<li>Add a custom MCP connector in your AI assistant (ChatGPT, Claude, Cursor, ...) using this server URL: <code>${escapeHtml(b.mcpUrl)}</code></li>`,
      "<li>Sign in with Google when asked and approve read-only access to Google Analytics 4 and Search Console.</li>",
      "<li>Ask your assistant about your traffic, pages or search queries.</li>",
      "</ol>",
    );
  }
  parts.push(
    `<p>Website: <a href="${escapeHtml(b.baseUrl)}">${escapeHtml(b.baseUrl)}</a><br>Server URL: <code>${escapeHtml(b.mcpUrl)}</code><br>Privacy: <a href="${escapeHtml(b.privacyUrl)}">${escapeHtml(b.privacyUrl)}</a></p>`,
  );
  return `<div style="font-family:system-ui,sans-serif;line-height:1.5;max-width:36rem">${parts.join("\n")}</div>`;
}

const textFooter = (b: MailBrand) => ["", `Website: ${b.baseUrl}`, `Server URL: ${b.mcpUrl}`, `Privacy: ${b.privacyUrl}`];

export function inviteEmail(b: MailBrand, opts: { note?: string } = {}): RenderedEmail {
  const note = opts.note?.trim() || undefined;
  const intro = `You have been invited to try ${b.name}. It connects your AI assistant to your Google Analytics 4 and Search Console data (read-only).`;
  const text = [
    intro,
    ...(note ? ["", "Personal note:", note] : []),
    "",
    "How to connect:",
    ...howToConnect(b),
    ...textFooter(b),
  ].join("\n");
  return {
    subject: oneLine(`You are invited to ${b.name}`),
    text,
    html: layout(b, [intro], { note, steps: true }),
  };
}

export function trialEndingEmail(b: MailBrand): RenderedEmail {
  const intro = `Your ${b.name} trial ends in about 3 days. After that your AI assistant will no longer be able to read your Google Analytics 4 and Search Console data through ${b.name}.`;
  const more = "Reply to this email or visit the website if you would like to keep access.";
  return {
    subject: oneLine(`Your ${b.name} trial ends in 3 days`),
    text: [intro, more, "", "Your connector URL stays the same:", howToConnect(b)[0], ...textFooter(b)].join("\n"),
    html: layout(b, [intro, more], {}),
  };
}

export function trialEndedEmail(b: MailBrand): RenderedEmail {
  const intro = `Your ${b.name} trial has ended, so tool calls from your AI assistant are paused.`;
  const more = "If you would like to continue, reply to this email or visit the website and we will help you get set up again.";
  return {
    subject: oneLine(`Your ${b.name} trial has ended`),
    text: [intro, more, "", "Connector URL (unchanged):", howToConnect(b)[0], ...textFooter(b)].join("\n"),
    html: layout(b, [intro, more], {}),
  };
}
