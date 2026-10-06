export const ui = {
  input:
    "rounded border border-neutral-400 bg-transparent px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-neutral-600",
  button:
    "rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300",
  danger:
    "rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600",
  card: "rounded border border-neutral-300 p-4 dark:border-neutral-700",
  th: "px-3 py-2 text-left font-semibold",
  td: "px-3 py-2 align-top",
  link: "underline focus-visible:outline-2 focus-visible:outline-blue-600",
  muted: "text-neutral-600 dark:text-neutral-400",
  notice:
    "rounded border border-green-700 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100",
  error: "rounded border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100",
} as const;

export const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "–");
export const fmtDateTime = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never");
