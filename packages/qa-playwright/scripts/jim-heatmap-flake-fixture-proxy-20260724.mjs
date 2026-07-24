// Fixture proxy used to verify PR fix/heatmap-spec-flake-root-cure-jim-20260724.
// Reproduces the exact divergence that caused CI run 30011454390
// (2026-07-23, main push, headSha 37d7068b) to hard-fail:
// hasProductHeatmapCoverage() (banner/skip gate, apps/web/lib/
// heatmap-product-coverage.ts) only requires symbol+verified-move count
// >= 70 and never looks at freshnessStatus, while industry-heatmap.tsx's
// isUsableTile() additionally requires freshnessStatus !== "missing" —
// two independently-computed gates that can (and did) diverge. This proxy
// passes every request through to real prod verbatim EXCEPT
// /api/v1/market-data/overview (heatmap tiles get freshnessStatus="missing"
// injected) and /api/v1/market/heatmap/kgi-core (blanked, so the intraday
// KGI-tick merge path can't mask the divergence) — banner stays silent
// (coverage gate still sees >=70 valid moves) but the client-side
// tile-rendering gate wipes every tile out.
//
// Usage (see PR body for the full before/after verification transcript):
//   1. node packages/qa-playwright/scripts/jim-heatmap-flake-fixture-proxy-20260724.mjs
//   2. In apps/web: NEXT_PUBLIC_API_BASE_URL=http://localhost:3311 pnpm run build && PORT=3212 pnpm run start
//   3. In packages/qa-playwright: SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... IUF_QA_WEB_BASE_URL=http://localhost:3212 npx playwright test tests/auth.setup.ts --project=setup
//   4. Run tests/jim_home_heatmap_mode_toggle_20260717.spec.ts / tests/jim_home_ledger_rsc_20260714.spec.ts against IUF_QA_WEB_BASE_URL=http://localhost:3212
import http from "node:http";
import https from "node:https";

const UPSTREAM = "https://api.eycvector.com";
const PORT = 3311;

// Synthesize an 80-symbol heatmap (> MIN_PRODUCT_HEATMAP_COVERAGE=70 in
// apps/web/lib/heatmap-product-coverage.ts) so hasProductHeatmapCoverage()
// deterministically passes (banner stays silent) regardless of real prod's
// current representative-feed coverage state — isolates the specific
// divergence from whatever real prod happens to be doing right now. Every
// synthetic tile has a valid close/prevClose move (satisfies
// hasHeatmapVerifiedMove) but freshnessStatus="missing" (fails
// industry-heatmap.tsx's isUsableTile() gate), reproducing the exact
// coverage-gate-passes/render-gate-fails divergence seen in CI run
// 30011454390.
function buildSyntheticHeatmap() {
  const rows = [];
  for (let i = 1; i <= 80; i++) {
    rows.push({
      symbol: `FX${String(i).padStart(4, "0")}`,
      name: `Fixture Co ${i}`,
      sector: "半導體業",
      changePct: 1.23,
      weight: 1,
      source: "fixture",
      last: 100,
      close: 100,
      prevClose: 98.8,
      change: 1.2,
      volume: 1000,
      readiness: "ready",
      freshnessStatus: "missing",
    });
  }
  return rows;
}

function rewriteOverviewBody(bodyText) {
  try {
    const json = JSON.parse(bodyText);
    if (json?.data?.marketContext) {
      json.data.marketContext.heatmap = buildSyntheticHeatmap();
      console.log(`[fixture-proxy] replaced marketContext.heatmap with 80 synthetic freshnessStatus=missing tiles`);
    }
    return JSON.stringify(json);
  } catch (err) {
    console.error("[fixture-proxy] failed to parse/rewrite overview body", err);
    return bodyText;
  }
}

// apps/web/app/page.tsx HeatZonePanel: `hasCore = coreHeatmap.length > 0 &&
// !showKgiFallback && hasRepresentativeFeed`. During real trading hours
// (kgiOffHours=false) showKgiFallback is always false, so if the KGI
// core-heatmap endpoint (/api/v1/market/heatmap/kgi-core) has real data,
// hasCore stays true and displayHeatmap merges in coreHeatmap (which
// buildKgiCoreHeatmap() hardcodes to freshnessStatus:"fresh" — never
// filtered by isUsableTile's freshness check), masking the exact divergence
// this fixture targets. Blank this endpoint too so coreHeatmap.length === 0
// and displayHeatmap falls through to the (synthetic, degraded) `heatmap`
// prop above — reproduces the off-hours code path deterministically without
// needing to wait for real off-hours or fake the server clock.
function rewriteKgiCoreBody(bodyText) {
  try {
    const json = JSON.parse(bodyText);
    if (json?.data) {
      json.data.data = [];
      json.data.tiles = [];
    } else if (json) {
      json.data = [];
      json.tiles = [];
    }
    console.log("[fixture-proxy] blanked kgi-core-heatmap tiles (forces hasCore=false)");
    return JSON.stringify(json);
  } catch (err) {
    console.error("[fixture-proxy] failed to parse/rewrite kgi-core body", err);
    return bodyText;
  }
}

const server = http.createServer((req, res) => {
  const targetUrl = new URL(req.url, UPSTREAM);
  const isOverview = req.url.startsWith("/api/v1/market-data/overview");
  const isKgiCore = req.url.startsWith("/api/v1/market/heatmap/kgi-core");

  const forwardedHeaders = { ...req.headers, host: targetUrl.host };
  // Disable compression so the JSON body can be rewritten as plain text —
  // fixture-only, real prod traffic never goes through this proxy.
  delete forwardedHeaders["accept-encoding"];
  const proxyReq = https.request(
    targetUrl,
    { method: req.method, headers: forwardedHeaders },
    (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (c) => chunks.push(c));
      proxyRes.on("end", () => {
        let body = Buffer.concat(chunks);
        const headers = { ...proxyRes.headers };
        if (isOverview && proxyRes.statusCode === 200) {
          const rewritten = rewriteOverviewBody(body.toString("utf8"));
          body = Buffer.from(rewritten, "utf8");
          headers["content-length"] = Buffer.byteLength(body);
        } else if (isKgiCore && proxyRes.statusCode === 200) {
          const rewritten = rewriteKgiCoreBody(body.toString("utf8"));
          body = Buffer.from(rewritten, "utf8");
          headers["content-length"] = Buffer.byteLength(body);
        }
        res.writeHead(proxyRes.statusCode ?? 200, headers);
        res.end(body);
      });
    },
  );
  proxyReq.on("error", (err) => {
    console.error("[fixture-proxy] upstream error", err);
    res.writeHead(502);
    res.end("upstream error");
  });
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`[fixture-proxy] listening on http://localhost:${PORT} -> ${UPSTREAM} (freshnessStatus=missing injection on /api/v1/market-data/overview)`);
});
