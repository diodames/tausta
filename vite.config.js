import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  fetchYahooMetrics,
  fetchYahooChart,
  fetchPeerCompare,
  fetchStreetData,
  fetchOutlook,
  searchYahooSymbols,
  writeSentimentSummary,
} from "./api/_lib/yahoo.js";

function apiRoutes(apiKey) {
  return {
    name: "api-routes",
    configureServer(server) {
      // GET /api/sentiment/:ticker — news + social chatter with AI TL;DR
      server.middlewares.use("/api/sentiment", async (req, res) => {
        const ticker = decodeURIComponent(
          (req.url || "/").split("?")[0].replace(/^\//, "")
        ).trim();
        res.setHeader("Content-Type", "application/json");
        if (!ticker) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "Missing ticker" } }));
          return;
        }
        try {
          const data = await fetchStreetData(ticker);
          const summary = await writeSentimentSummary(apiKey, ticker, data)
            .catch(() => ({ tldrSections: null, headlineSentiments: [] }));
          res.end(JSON.stringify({
            tldrSections: summary.tldrSections,
            tldrAvailable: Boolean(apiKey),
            news: data.news.slice(0, 5).map(({ title, publisher, link, time }, i) => ({
              title, publisher, link, time,
              sentiment: summary.headlineSentiments[i] || null,
            })),
            stocktwits: data.stocktwits
              ? { total: data.stocktwits.total, bullish: data.stocktwits.bullish, bearish: data.stocktwits.bearish }
              : null,
          }));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      // GET /api/chart/:ticker?range=1d — price history from Yahoo Finance
      server.middlewares.use("/api/chart", async (req, res) => {
        const [pathPart, queryPart] = (req.url || "/").split("?");
        const ticker = decodeURIComponent(pathPart.replace(/^\//, "")).trim();
        const range = new URLSearchParams(queryPart).get("range") || "1d";
        res.setHeader("Content-Type", "application/json");
        if (!ticker) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "Missing ticker" } }));
          return;
        }
        try {
          const chart = await fetchYahooChart(ticker, range);
          res.end(JSON.stringify(chart));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      // GET /api/peers/:ticker?range=1mo — normalized performance vs top peers + S&P 500
      server.middlewares.use("/api/peers", async (req, res) => {
        const [pathPart, queryPart] = (req.url || "/").split("?");
        const ticker = decodeURIComponent(pathPart.replace(/^\//, "")).trim();
        const range = new URLSearchParams(queryPart).get("range") || "1mo";
        res.setHeader("Content-Type", "application/json");
        if (!ticker) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "Missing ticker" } }));
          return;
        }
        try {
          const data = await fetchPeerCompare(ticker, range);
          res.end(JSON.stringify(data));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      // GET /api/search/:query — resolve a company name or partial ticker to symbols
      server.middlewares.use("/api/search", async (req, res) => {
        const query = decodeURIComponent(
          (req.url || "/").split("?")[0].replace(/^\//, "")
        ).trim();
        res.setHeader("Content-Type", "application/json");
        if (!query) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "Missing query" } }));
          return;
        }
        try {
          const results = await searchYahooSymbols(query);
          res.end(JSON.stringify(results));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      // GET /api/metrics/:ticker — live metrics from Yahoo Finance
      server.middlewares.use("/api/metrics", async (req, res) => {
        const ticker = decodeURIComponent(
          (req.url || "/").split("?")[0].replace(/^\//, "")
        ).trim();
        res.setHeader("Content-Type", "application/json");
        if (!ticker) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "Missing ticker" } }));
          return;
        }
        try {
          const metrics = await fetchYahooMetrics(ticker);
          res.end(JSON.stringify(metrics));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      // GET /api/outlook/:ticker — data-driven forward outlook for stock + sector
      server.middlewares.use("/api/outlook", async (req, res) => {
        const ticker = decodeURIComponent(
          (req.url || "/").split("?")[0].replace(/^\//, "")
        ).trim();
        res.setHeader("Content-Type", "application/json");
        if (!ticker) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: "Missing ticker" } }));
          return;
        }
        try {
          const data = await fetchOutlook(ticker, apiKey);
          res.end(JSON.stringify(data));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      // POST /api/messages — Anthropic proxy (used for the opinion paragraph)
      server.middlewares.use("/api/messages", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: {
              message: "ANTHROPIC_API_KEY is not set. Add it to a .env file in the project root and restart the dev server.",
            },
          }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          try {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body,
            });
            const text = await response.text();
            res.statusCode = response.status;
            res.setHeader("Content-Type", "application/json");
            res.end(text);
          } catch (err) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: { message: err.message } }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), apiRoutes(env.ANTHROPIC_API_KEY)],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
