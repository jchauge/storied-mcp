# Storied Collection Venues — remote MCP server

Read-only MCP server (Streamable HTTP, stateless, JSON responses) serving Storied Collection venue data
live from the Google Sheet `1voQY3AHxjEasFCy3L2T1i1JsdzaD52AZnieFhASRLsM`, tab `Properties`. 5-minute cache
(`CACHE_TTL_SECONDS`); if a refresh fails, the last good data keeps being served.

Endpoint: `POST /mcp`  (`GET /` = health check)

## Tools
- `search_venues`: query, country, min_sleeps, max_price + max_price_currency (GBP/EUR, no conversion), max_minimum_nights, helipad, ev_charging, guest_house, sort_by
- `get_venue`: fuzzy, accent-insensitive name lookup, with suggestions when nothing matches
- `list_countries`: countries with venue counts and currencies

Every price comes back with its currency. Values are never converted. Parsing rules: "3,000"→3000, "100+"→100 (the original text is kept in `sleeps_display`),
"1600s"→1600, "On request"/blank→null. Blank Yes/No cells → null (unknown), and boolean filters leave those venues out.

## Data source (pick one)
1. **Public sheet** (default): share the sheet as *Anyone with the link can view*. The server reads the gviz CSV endpoint.
2. **Service account**: set `GOOGLE_SERVICE_ACCOUNT_JSON` to the key JSON and share the sheet (Viewer) with the service account's email.
3. `LOCAL_CSV=path.csv`: local file, for testing only.

## Run / test
    npm install && npm run build
    npm start                                  # reads the public sheet; or LOCAL_CSV=your.csv
    npm test                                   # SDK client end-to-end calls
    npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/list

## Deploy (free options)
- **Render / Railway / Fly.io**: any Node host. Run `npm run build && npm start`; `PORT` is respected.
- **Google Cloud Run**: `gcloud run deploy --source .` (free tier). Lets you use a service account without a key file.
- Cloudflare Workers would need a port to the Workers runtime (no Express). The data logic in `src/data.ts` carries over.
