import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

export const SHEET_ID = process.env.SHEET_ID ?? "1voQY3AHxjEasFCy3L2T1i1JsdzaD52AZnieFhASRLsM";
export const SHEET_TAB = process.env.SHEET_TAB ?? "Properties";
const TTL = Number(process.env.CACHE_TTL_SECONDS ?? 300) * 1000;

export interface Venue {
  country: string; name: string; originally_built: string; built_year: number | null;
  currency: string; price_from: number | null; price_from_display: string;
  rooms_in_main_house: number | null; sleeps: number | null; sleeps_display: string;
  guest_house: string; has_guest_house: boolean | null; minimum_nights: number | null;
  helipad: boolean | null; ev_charging: boolean | null;
}

/** "3,000" -> 3000, "100+" -> 100, "1600s" -> 1600, "On request"/"" -> null */
export function num(s: string | undefined): number | null {
  const m = (s ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function yesNo(s?: string): boolean | null {
  const v = (s ?? "").trim().toLowerCase();
  return v === "yes" ? true : v === "no" ? false : null;
}

export function rowsToVenues(rows: string[][]): Venue[] {
  const [header, ...body] = rows;
  const idx = (h: string) => header.findIndex((x) => x.trim().toLowerCase() === h.toLowerCase());
  const col = (r: string[], h: string) => (r[idx(h)] ?? "").trim();
  return body.filter((r) => col(r, "Property")).map((r) => {
    const gh = col(r, "Guest House");
    return {
      country: col(r, "Country"), name: col(r, "Property"),
      originally_built: col(r, "Originally Built"), built_year: num(col(r, "Originally Built")),
      currency: col(r, "Currency"), price_from: num(col(r, "Pricing From")),
      price_from_display: col(r, "Pricing From") || "Not listed",
      rooms_in_main_house: num(col(r, "Rooms in Main House")),
      sleeps: num(col(r, "Sleeps")), sleeps_display: col(r, "Sleeps"),
      guest_house: gh || "Unknown",
      has_guest_house: gh === "" ? null : gh.toLowerCase() === "none" ? false : true,
      minimum_nights: num(col(r, "Minimum Nights")),
      helipad: yesNo(col(r, "Helipad")), ev_charging: yesNo(col(r, "Electric Car Charge")),
    };
  });
}

async function fetchRows(): Promise<string[][]> {
  if (process.env.LOCAL_CSV) return parse(readFileSync(process.env.LOCAL_CSV, "utf8"), { relax_column_count: true });
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const sa = JSON.parse(saJson);
    const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB)}`;
    const res = await jwt.request<{ values: string[][] }>({ url });
    return res.data.values;
  }
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("csv"))
    throw new Error(`Sheet not publicly readable (HTTP ${res.status}). Share it as 'Anyone with the link can view' or set GOOGLE_SERVICE_ACCOUNT_JSON.`);
  return parse(await res.text(), { relax_column_count: true });
}

let cache: { at: number; venues: Venue[] } | null = null;
export async function getVenues(): Promise<Venue[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.venues;
  try {
    cache = { at: Date.now(), venues: rowsToVenues(await fetchRows()) };
  } catch (e) {
    if (cache) return cache.venues; // serve stale on error
    throw e;
  }
  return cache.venues;
}
