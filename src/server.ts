import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getVenues, Venue } from "./data.js";

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function score(q: string, name: string) {
  const a = norm(q), b = norm(name);
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const qt = a.split(" "), bt = b.split(" ");
  const tok = qt.filter((t) => bt.some((x) => x.startsWith(t) || lev(t, x) <= 1)).length / qt.length;
  return Math.max(tok * 0.85, 1 - lev(a, b) / Math.max(a.length, b.length));
}
const out = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const summary = (v: Venue) => ({
  name: v.name, country: v.country, price_from: v.price_from, currency: v.currency,
  price_from_display: `${v.price_from_display}${v.price_from !== null ? " " + v.currency : ""}`,
  sleeps: v.sleeps_display, minimum_nights: v.minimum_nights, helipad: v.helipad, ev_charging: v.ev_charging, guest_house: v.guest_house,
});

function buildServer() {
  const s = new McpServer({ name: "storied-collection-venues", version: "1.0.0" });

  s.registerTool("search_venues", {
    title: "Search Storied Collection venues",
    description: "Search Storied Collection's historic exclusive-use venues (castles, estates, châteaux in Scotland, England, Wales, Ireland, France). All filters are optional and combined with AND. Prices are 'pricing from' per night in the venue's native currency (GBP or EUR) and are NEVER converted — max_price only matches venues priced in the given currency (default: any currency, compared numerically within each venue's own currency; pass max_price_currency to be precise). Venues with price 'On request' are excluded when max_price is set. Boolean filters exclude venues where the value is unknown. Returns a summary list; use get_venue for full details.",
    inputSchema: {
      query: z.string().optional().describe("Free-text match on venue name or country, e.g. 'castle', 'chateau', 'Gordon'"),
      country: z.string().optional().describe("Country name, e.g. Scotland, England, Wales, Ireland, France (case-insensitive)"),
      min_sleeps: z.number().int().optional().describe("Minimum number of guests the venue sleeps"),
      max_price: z.number().optional().describe("Maximum 'pricing from' amount in max_price_currency"),
      max_price_currency: z.enum(["GBP", "EUR"]).optional().describe("Currency of max_price. Only venues priced in this currency are returned. No conversion is performed."),
      max_minimum_nights: z.number().int().optional().describe("Only venues whose minimum stay is at most this many nights"),
      helipad: z.boolean().optional().describe("true = must have a helipad; false = must not"),
      ev_charging: z.boolean().optional().describe("true = must have electric car charging; false = must not"),
      guest_house: z.boolean().optional().describe("true = must have a guest house; false = no guest house"),
      sort_by: z.enum(["price", "sleeps", "name"]).optional().describe("Sort order (price ascending, sleeps descending, name A–Z). Default name."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (a) => {
    let v = await getVenues();
    if (a.query) { const q = norm(a.query); v = v.filter((x) => norm(`${x.name} ${x.country}`).includes(q) || score(a.query!, x.name) > 0.75); }
    if (a.country) v = v.filter((x) => norm(x.country) === norm(a.country!));
    if (a.min_sleeps !== undefined) v = v.filter((x) => x.sleeps !== null && x.sleeps >= a.min_sleeps!);
    if (a.max_price_currency) v = v.filter((x) => x.currency.toUpperCase() === a.max_price_currency);
    if (a.max_price !== undefined) v = v.filter((x) => x.price_from !== null && x.price_from <= a.max_price!);
    if (a.max_minimum_nights !== undefined) v = v.filter((x) => x.minimum_nights !== null && x.minimum_nights <= a.max_minimum_nights!);
    if (a.helipad !== undefined) v = v.filter((x) => x.helipad === a.helipad);
    if (a.ev_charging !== undefined) v = v.filter((x) => x.ev_charging === a.ev_charging);
    if (a.guest_house !== undefined) v = v.filter((x) => x.has_guest_house === a.guest_house);
    const sb = a.sort_by ?? "name";
    v = [...v].sort((x, y) => sb === "price" ? (x.price_from ?? 1e12) - (y.price_from ?? 1e12) : sb === "sleeps" ? (y.sleeps ?? 0) - (x.sleeps ?? 0) : x.name.localeCompare(y.name));
    return out({ count: v.length, note: "Prices are 'from' rates in each venue's own currency; not converted.", venues: v.map(summary) });
  });

  s.registerTool("get_venue", {
    title: "Get venue details",
    description: "Get full details for one Storied Collection venue by name. Matching is fuzzy and accent-insensitive ('chateau challain', 'gilmerton', 'Borthwick'). Returns country, year originally built, pricing-from with its currency (never converted), rooms in main house, sleeps, guest house, minimum nights, helipad and EV charging. If no confident match, returns closest suggestions.",
    inputSchema: { name: z.string().describe("Venue name or part of it") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ name }) => {
    const ranked = (await getVenues()).map((v) => ({ v, s: score(name, v.name) })).sort((a, b) => b.s - a.s);
    if (!ranked.length || ranked[0].s < 0.6) return out({ found: false, suggestions: ranked.slice(0, 5).map((r) => r.v.name) });
    return out({ found: true, match_confidence: Number(ranked[0].s.toFixed(2)), venue: ranked[0].v, other_close_matches: ranked.slice(1, 4).filter((r) => r.s >= 0.6).map((r) => r.v.name) });
  });

  s.registerTool("list_countries", {
    title: "List countries",
    description: "List every country in the Storied Collection portfolio with the number of venues and the pricing currency used there.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const m = new Map<string, { country: string; venue_count: number; currencies: Set<string> }>();
    for (const v of await getVenues()) {
      const e = m.get(v.country) ?? { country: v.country, venue_count: 0, currencies: new Set() };
      e.venue_count++; e.currencies.add(v.currency); m.set(v.country, e);
    }
    const c = [...m.values()].map((e) => ({ ...e, currencies: [...e.currencies] }));
    return out({ total_venues: c.reduce((n, e) => n + e.venue_count, 0), countries: c });
  });
  return s;
}

const app = express();
app.use(express.json());
app.get("/", (_q, r) => { r.json({ name: "storied-collection-venues", mcp_endpoint: "/mcp" }); });
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_q, r) => { r.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null }); });
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Storied MCP listening on :${port}/mcp`));
