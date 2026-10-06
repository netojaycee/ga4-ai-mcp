import { z } from "zod";
import { ToolError } from "@/server/errors";
import type { GoogleAuth } from "./auth";
import { capLimit, googleJson, type CallOptions } from "./http";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

export const GA4_DEFAULT_LIMIT = 100;
export const GA4_MAX_LIMIT = 10_000;

// ---------------------------------------------------------------- input schemas

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** YYYY-MM-DD (a real calendar date) or GA4's relative forms: today, yesterday, NdaysAgo. */
export const ga4DateSchema = z
  .string()
  .refine(
    (s) => /^(today|yesterday|\d{1,4}daysAgo)$/.test(s) || (/^\d{4}-\d{2}-\d{2}$/.test(s) && isRealDate(s)),
    { message: "Use YYYY-MM-DD, 'today', 'yesterday' or 'NdaysAgo' (e.g. '7daysAgo')" },
  )
  .describe("YYYY-MM-DD, 'today', 'yesterday' or 'NdaysAgo' (e.g. '28daysAgo')");

export const propertySchema = z
  .string()
  .regex(/^(properties\/)?\d+$/, "Use the numeric GA4 property id, e.g. '123456789' or 'properties/123456789'")
  .describe("GA4 property id from ga4_list_properties, e.g. '123456789'");

export const dateRangeSchema = z
  .object({ startDate: ga4DateSchema, endDate: ga4DateSchema, name: z.string().max(60).optional() })
  .refine((r) => !(isIso(r.startDate) && isIso(r.endDate)) || r.startDate <= r.endDate, {
    message: "startDate must not be after endDate",
  });

function isIso(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const fieldName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_:]*$/, "Use a GA4 API name such as 'country' or 'activeUsers'");

const dimensionFilterSchema = z.union([
  z.object({
    field: fieldName.describe("Dimension API name"),
    operator: z.enum(["equals", "contains", "begins_with", "ends_with", "regex"]),
    value: z.string().max(500),
    caseSensitive: z.boolean().default(false),
    not: z.boolean().default(false).describe("Negate the condition"),
  }),
  z.object({
    field: fieldName.describe("Dimension API name"),
    operator: z.literal("in_list"),
    value: z.array(z.string().max(500)).min(1).max(100),
    caseSensitive: z.boolean().default(false),
    not: z.boolean().default(false).describe("Negate the condition"),
  }),
]);

const metricFilterSchema = z.object({
  field: fieldName.describe("Metric API name"),
  operator: z.enum(["equals", "gt", "gte", "lt", "lte"]),
  value: z.number(),
  not: z.boolean().default(false),
});

const orderBySchema = z.object({
  field: fieldName.describe("A dimension or metric already listed in the request"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

const shared = {
  property: propertySchema,
  dimensions: z.array(fieldName).max(9).default([]).describe("Dimension API names, e.g. ['country','date']"),
  metrics: z.array(fieldName).min(1).max(10).describe("Metric API names, e.g. ['activeUsers','sessions']"),
  dimensionFilters: z
    .array(dimensionFilterSchema)
    .max(10)
    .optional()
    .describe("Conditions on dimensions, all must match (AND)"),
  metricFilters: z.array(metricFilterSchema).max(10).optional().describe("Conditions on metrics, all must match (AND)"),
  orderBy: z.array(orderBySchema).max(5).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(GA4_MAX_LIMIT)
    .default(GA4_DEFAULT_LIMIT)
    .describe(`Max rows to return (default ${GA4_DEFAULT_LIMIT}, max ${GA4_MAX_LIMIT}; your plan may lower it)`),
};

export const runReportInput = z.object({
  ...shared,
  dateRanges: z.array(dateRangeSchema).min(1).max(4).default([{ startDate: "28daysAgo", endDate: "yesterday" }]),
  offset: z.number().int().min(0).max(1_000_000).default(0).describe("Rows to skip, for paging"),
});
export type RunReportInput = z.input<typeof runReportInput>;

export const runRealtimeReportInput = z.object({
  ...shared,
  minuteRanges: z
    .array(
      z
        .object({ startMinutesAgo: z.number().int().min(0).max(29), endMinutesAgo: z.number().int().min(0).max(29) })
        .refine((r) => r.startMinutesAgo >= r.endMinutesAgo, {
          message: "startMinutesAgo must be >= endMinutesAgo (e.g. 29 and 0 for the last 30 minutes)",
        }),
    )
    .max(2)
    .optional()
    .describe("Defaults to the last 30 minutes"),
});
export type RunRealtimeReportInput = z.input<typeof runRealtimeReportInput>;

export const getMetadataInput = z.object({
  property: propertySchema,
  kind: z.enum(["dimensions", "metrics", "all"]).default("all"),
  search: z.string().max(100).optional().describe("Case-insensitive match on api name, UI name or category"),
  customOnly: z.boolean().default(false).describe("Only custom dimensions/metrics"),
  includeDescriptions: z.boolean().default(false),
});
export type GetMetadataInput = z.input<typeof getMetadataInput>;

export const listPropertiesInput = z.object({});

// ---------------------------------------------------------------- helpers

const propertyName = (p: string) => (p.startsWith("properties/") ? p : `properties/${p}`);

type Obj = Record<string, unknown>;
const str = z.string();
const maybeStr = z.string().optional();

function dimensionExpression(f: z.output<typeof dimensionFilterSchema>): Obj {
  const filter: Obj =
    f.operator === "in_list"
      ? { fieldName: f.field, inListFilter: { values: f.value, caseSensitive: f.caseSensitive } }
      : {
          fieldName: f.field,
          stringFilter: {
            matchType: {
              equals: "EXACT",
              contains: "CONTAINS",
              begins_with: "BEGINS_WITH",
              ends_with: "ENDS_WITH",
              regex: "FULL_REGEXP",
            }[f.operator],
            value: f.value,
            caseSensitive: f.caseSensitive,
          },
        };
  return f.not ? { notExpression: { filter } } : { filter };
}

function metricExpression(f: z.output<typeof metricFilterSchema>): Obj {
  const op = { equals: "EQUAL", gt: "GREATER_THAN", gte: "GREATER_THAN_OR_EQUAL", lt: "LESS_THAN", lte: "LESS_THAN_OR_EQUAL" }[
    f.operator
  ];
  const filter = { fieldName: f.field, numericFilter: { operation: op, value: { doubleValue: f.value } } };
  return f.not ? { notExpression: { filter } } : { filter };
}

const andGroup = (exprs: Obj[]): Obj | undefined =>
  exprs.length === 0 ? undefined : exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };

function buildOrderBys(
  orderBy: z.output<typeof orderBySchema>[] | undefined,
  dimensions: string[],
  metrics: string[],
): Obj[] | undefined {
  if (!orderBy?.length) return undefined;
  return orderBy.map((o) => {
    const desc = o.direction === "desc";
    if (metrics.includes(o.field)) return { metric: { metricName: o.field }, desc };
    if (dimensions.includes(o.field)) return { dimension: { dimensionName: o.field }, desc };
    throw new ToolError(
      "invalid_input",
      `orderBy field '${o.field}' must be one of the requested dimensions or metrics. Add it to the request or order by something else.`,
    );
  });
}

const reportResponse = z
  .object({
    dimensionHeaders: z.array(z.object({ name: str })).default([]),
    metricHeaders: z.array(z.object({ name: str, type: maybeStr })).default([]),
    rows: z.array(z.object({ dimensionValues: z.array(z.object({ value: str })).default([]), metricValues: z.array(z.object({ value: str })).default([]) })).default([]),
    totals: z.array(z.object({ metricValues: z.array(z.object({ value: str })).default([]) })).optional(),
    rowCount: z.number().optional(),
    metadata: z.object({ dataLossFromOtherRow: z.boolean().optional(), samplingMetadatas: z.array(z.unknown()).optional() }).loose().optional(),
  })
  .loose();

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
};

function shapeReport(raw: unknown, effectiveLimit: number, offset: number, extra: Obj) {
  const r = reportResponse.parse(raw);
  const dims = r.dimensionHeaders.map((h) => h.name);
  const mets = r.metricHeaders.map((h) => h.name);
  const rows = r.rows.map((row) => {
    const o: Obj = {};
    dims.forEach((d, i) => (o[d] = row.dimensionValues[i]?.value ?? ""));
    mets.forEach((m, i) => (o[m] = num(row.metricValues[i]?.value ?? "")));
    return o;
  });
  const totals = r.totals?.[0]
    ? Object.fromEntries(mets.map((m, i) => [m, num(r.totals![0].metricValues[i]?.value ?? "")]))
    : undefined;
  const matched = r.rowCount ?? rows.length;
  const truncated = offset + rows.length < matched;
  return {
    ...extra,
    rowCount: matched,
    returned: rows.length,
    limit: effectiveLimit,
    truncated,
    ...(truncated ? { nextOffset: offset + rows.length } : {}),
    ...(r.metadata?.dataLossFromOtherRow ? { dataLossFromOtherRow: true } : {}),
    ...(totals ? { totals } : {}),
    rows,
  };
}

// ---------------------------------------------------------------- operations

export async function runReport(auth: GoogleAuth, rawInput: RunReportInput, opts: CallOptions = {}) {
  const input = runReportInput.parse(rawInput);
  const limit = capLimit(input.limit, GA4_MAX_LIMIT, opts.maxRows);
  const filters = {
    dimensionFilter: andGroup((input.dimensionFilters ?? []).map(dimensionExpression)),
    metricFilter: andGroup((input.metricFilters ?? []).map(metricExpression)),
  };
  const raw = await googleJson(auth, `${DATA_API}/${propertyName(input.property)}:runReport`, {
    method: "POST",
    fetch: opts.fetch,
    body: {
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: input.metrics.map((name) => ({ name })),
      dateRanges: input.dateRanges,
      ...filters,
      orderBys: buildOrderBys(input.orderBy, input.dimensions, input.metrics),
      limit: String(limit),
      offset: String(input.offset),
      metricAggregations: ["TOTAL"],
    },
  });
  return shapeReport(raw, limit, input.offset, { property: propertyName(input.property), dateRanges: input.dateRanges });
}

export async function runRealtimeReport(auth: GoogleAuth, rawInput: RunRealtimeReportInput, opts: CallOptions = {}) {
  const input = runRealtimeReportInput.parse(rawInput);
  const limit = capLimit(input.limit, GA4_MAX_LIMIT, opts.maxRows);
  const raw = await googleJson(auth, `${DATA_API}/${propertyName(input.property)}:runRealtimeReport`, {
    method: "POST",
    fetch: opts.fetch,
    body: {
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: input.metrics.map((name) => ({ name })),
      minuteRanges: input.minuteRanges,
      dimensionFilter: andGroup((input.dimensionFilters ?? []).map(dimensionExpression)),
      metricFilter: andGroup((input.metricFilters ?? []).map(metricExpression)),
      orderBys: buildOrderBys(input.orderBy, input.dimensions, input.metrics),
      limit: String(limit),
      metricAggregations: ["TOTAL"],
    },
  });
  return shapeReport(raw, limit, 0, { property: propertyName(input.property), realtime: true });
}

const metadataResponse = z
  .object({
    dimensions: z.array(z.object({ apiName: str, uiName: maybeStr, description: maybeStr, category: maybeStr, customDefinition: z.boolean().optional() })).default([]),
    metrics: z.array(z.object({ apiName: str, uiName: maybeStr, description: maybeStr, category: maybeStr, type: maybeStr, customDefinition: z.boolean().optional() })).default([]),
  })
  .loose();

export async function getMetadata(auth: GoogleAuth, rawInput: GetMetadataInput, opts: CallOptions = {}) {
  const input = getMetadataInput.parse(rawInput);
  const raw = metadataResponse.parse(
    await googleJson(auth, `${DATA_API}/${propertyName(input.property)}/metadata`, { fetch: opts.fetch }),
  );
  const needle = input.search?.toLowerCase();
  const keep = (x: { apiName: string; uiName?: string; category?: string; customDefinition?: boolean }) =>
    (!input.customOnly || x.customDefinition) &&
    (!needle || [x.apiName, x.uiName, x.category].some((v) => v?.toLowerCase().includes(needle)));
  const shape = (x: { apiName: string; uiName?: string; description?: string; category?: string; type?: string; customDefinition?: boolean }) => ({
    apiName: x.apiName,
    uiName: x.uiName,
    category: x.category,
    ...(x.type ? { type: x.type } : {}),
    ...(x.customDefinition ? { custom: true } : {}),
    ...(input.includeDescriptions && x.description ? { description: x.description.slice(0, 200) } : {}),
  });
  const dimensions = input.kind === "metrics" ? [] : raw.dimensions.filter(keep).map(shape);
  const metrics = input.kind === "dimensions" ? [] : raw.metrics.filter(keep).map(shape);
  return { property: propertyName(input.property), dimensionCount: dimensions.length, metricCount: metrics.length, dimensions, metrics };
}

const summariesResponse = z
  .object({
    accountSummaries: z
      .array(
        z.object({
          account: maybeStr,
          displayName: maybeStr,
          propertySummaries: z.array(z.object({ property: str, displayName: maybeStr, propertyType: maybeStr })).default([]),
        }),
      )
      .default([]),
    nextPageToken: maybeStr,
  })
  .loose();

const MAX_SUMMARY_PAGES = 10;

export async function listProperties(auth: GoogleAuth, opts: CallOptions = {}) {
  const planCap = capLimit(Infinity, Infinity, opts.maxRows);
  const accounts: { account?: string; displayName?: string; properties: { property: string; displayName?: string; propertyType?: string }[] }[] = [];
  let count = 0;
  let truncated = false;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_SUMMARY_PAGES && !truncated; page++) {
    const qs = new URLSearchParams({ pageSize: "200", ...(pageToken ? { pageToken } : {}) });
    const res = summariesResponse.parse(await googleJson(auth, `${ADMIN_API}/accountSummaries?${qs}`, { fetch: opts.fetch }));
    for (const a of res.accountSummaries) {
      const properties = [];
      for (const p of a.propertySummaries) {
        if (count >= planCap) {
          truncated = true;
          break;
        }
        properties.push({ property: p.property, displayName: p.displayName, propertyType: p.propertyType });
        count++;
      }
      accounts.push({ account: a.account, displayName: a.displayName, properties });
    }
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  if (pageToken) truncated = true;
  return { propertyCount: count, truncated, accounts };
}
