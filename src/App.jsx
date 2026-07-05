import { useEffect, useState } from "react";
import { ChartLineIcon, ChevronDownIcon, InfoIcon, MegaphoneIcon, ScaleIcon, SearchIcon, ShieldAlertIcon, TrendingUpIcon, TriangleAlertIcon } from "lucide-react";
import { Area, AreaChart, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ————— Tausta — undervalued stock screener —————
   Design: Yahoo-style dark theme, ledger rows with
   outline-pill verdict tags. Geist / Geist Mono. */

/* ————— Strategy catalogue ————— */
const STRATEGIES = [
  {
    id: "pe_industry", group: "Valuation ratios", name: "P/E vs. industry",
    how: "Compares trailing price-to-earnings against the industry average. A discount to peers can signal undervaluation.",
    pros: "Simple, widely available, comparable across peers.",
    cons: "Earnings can be distorted or cyclical; a low P/E may just reflect weak prospects (value trap).",
    weight: 8,
    score: (d) => {
      if (!isNum(d.pe_ttm) || !isNum(d.industry_avg_pe) || d.pe_ttm <= 0 || d.industry_avg_pe <= 0) return null;
      return lerpScore(d.pe_ttm / d.industry_avg_pe, 0.6, 1.5);
    },
    evaluate: (d) => {
      if (!isNum(d.pe_ttm) || !isNum(d.industry_avg_pe)) return na();
      if (d.pe_ttm <= 0) return verdict("caution", `P/E ${fmt(d.pe_ttm)} — negative earnings, ratio not meaningful`);
      const disc = (d.industry_avg_pe - d.pe_ttm) / d.industry_avg_pe;
      if (disc > 0.15) return verdict("under", `P/E ${fmt(d.pe_ttm)} vs. industry ${fmt(d.industry_avg_pe)} (${pct(disc)} discount)`);
      if (disc > -0.1) return verdict("fair", `P/E ${fmt(d.pe_ttm)} near industry ${fmt(d.industry_avg_pe)}`);
      return verdict("over", `P/E ${fmt(d.pe_ttm)} above industry ${fmt(d.industry_avg_pe)}`);
    },
  },
  {
    id: "forward_pe", group: "Valuation ratios", name: "Forward vs. trailing P/E",
    how: "A forward P/E clearly below trailing implies analysts expect earnings growth that the price may not fully reflect.",
    pros: "Forward-looking; captures expected earnings momentum.",
    cons: "Relies on analyst estimates, which are frequently wrong or optimistic.",
    weight: 6,
    score: (d) => {
      if (!isNum(d.pe_forward) || !isNum(d.pe_ttm) || d.pe_ttm <= 0 || d.pe_forward <= 0) return null;
      return lerpScore(d.pe_forward / d.pe_ttm, 0.75, 1.2);
    },
    evaluate: (d) => {
      if (!isNum(d.pe_forward) || !isNum(d.pe_ttm) || d.pe_ttm <= 0 || d.pe_forward <= 0) return na();
      const drop = (d.pe_ttm - d.pe_forward) / d.pe_ttm;
      if (drop > 0.12) return verdict("under", `Forward ${fmt(d.pe_forward)} vs. trailing ${fmt(d.pe_ttm)} — earnings expected to grow ${pct(drop)}`);
      if (drop > -0.05) return verdict("fair", `Forward ${fmt(d.pe_forward)} ≈ trailing ${fmt(d.pe_ttm)}`);
      return verdict("over", `Forward ${fmt(d.pe_forward)} above trailing ${fmt(d.pe_ttm)} — earnings expected to shrink`);
    },
  },
  {
    id: "pb", group: "Valuation ratios", name: "Price-to-book (P/B)",
    how: "Price against accounting book value. Graham favored P/B under ~1.5; under 1 means paying less than net assets.",
    pros: "Grounded in the balance sheet; useful for banks and asset-heavy firms.",
    cons: "Misses intangibles, so modern tech/service firms look 'expensive' by default; book value can be stale.",
    weight: 5,
    score: (d) => {
      if (!isNum(d.pb) || d.pb <= 0) return null;
      return lerpScore(d.pb, 1.0, 5.0);
    },
    evaluate: (d) => {
      if (!isNum(d.pb)) return na();
      if (d.pb < 1) return verdict("under", `P/B ${fmt(d.pb)} — trading below book value`);
      if (d.pb <= 1.5) return verdict("under", `P/B ${fmt(d.pb)} — within Graham's ≤1.5 zone`);
      if (d.pb <= 3.5) return verdict("fair", `P/B ${fmt(d.pb)}`);
      return verdict("over", `P/B ${fmt(d.pb)} — rich vs. book value`);
    },
  },
  {
    id: "peg", group: "Valuation ratios", name: "PEG ratio",
    how: "P/E divided by expected earnings growth. Under 1 suggests the price under-counts growth (Peter Lynch's rule of thumb).",
    pros: "Adjusts P/E for growth, so fast growers aren't unfairly penalized.",
    cons: "Growth forecasts are guesses; breaks down for low-growth or cyclical firms.",
    weight: 7,
    score: (d) => {
      if (!isNum(d.peg) || d.peg <= 0) return null;
      return lerpScore(d.peg, 0.5, 2.5);
    },
    evaluate: (d) => {
      if (!isNum(d.peg)) return na();
      if (d.peg <= 0) return verdict("caution", `PEG ${fmt(d.peg)} — not meaningful (negative earnings or growth)`);
      if (d.peg < 1) return verdict("under", `PEG ${fmt(d.peg)} — growth looks under-priced`);
      if (d.peg <= 1.6) return verdict("fair", `PEG ${fmt(d.peg)}`);
      return verdict("over", `PEG ${fmt(d.peg)} — paying up for growth`);
    },
  },
  {
    id: "pfcf", group: "Valuation ratios", name: "Price-to-free-cash-flow",
    how: "Price against cash actually generated after capex. Value investors often look for P/FCF under ~15.",
    pros: "Cash is harder to manipulate than earnings.",
    cons: "FCF is lumpy year to year; punishes firms investing heavily for the future.",
    weight: 10,
    score: (d) => {
      if (!isNum(d.p_fcf)) return null;
      if (d.p_fcf <= 0) return 0; // burning cash is information, not missing data
      return lerpScore(d.p_fcf, 10, 40);
    },
    evaluate: (d) => {
      if (!isNum(d.p_fcf)) return na();
      if (d.p_fcf <= 0) return verdict("caution", `P/FCF ${fmt(d.p_fcf)} — negative free cash flow`);
      if (d.p_fcf < 15) return verdict("under", `P/FCF ${fmt(d.p_fcf)} — cheap on cash generation`);
      if (d.p_fcf <= 25) return verdict("fair", `P/FCF ${fmt(d.p_fcf)}`);
      return verdict("over", `P/FCF ${fmt(d.p_fcf)}`);
    },
  },
  {
    id: "ev_ebitda", group: "Valuation ratios", name: "EV / EBITDA",
    how: "Enterprise value over operating cash earnings; capital-structure neutral. Roughly, under ~10 reads cheap for most sectors.",
    pros: "Comparable across firms with different debt loads; standard in M&A.",
    cons: "Ignores capex and working capital; 'cheap' varies a lot by sector.",
    weight: 10,
    score: (d) => {
      if (!isNum(d.ev_ebitda)) return null;
      if (d.ev_ebitda <= 0) return 0;
      return lerpScore(d.ev_ebitda, 6, 20);
    },
    evaluate: (d) => {
      if (!isNum(d.ev_ebitda)) return na();
      if (d.ev_ebitda <= 0) return verdict("caution", `EV/EBITDA ${fmt(d.ev_ebitda)} — negative EBITDA`);
      if (d.ev_ebitda < 10) return verdict("under", `EV/EBITDA ${fmt(d.ev_ebitda)}`);
      if (d.ev_ebitda <= 14) return verdict("fair", `EV/EBITDA ${fmt(d.ev_ebitda)}`);
      return verdict("over", `EV/EBITDA ${fmt(d.ev_ebitda)}`);
    },
  },
  {
    id: "dividend", group: "Valuation ratios", name: "Dividend yield",
    how: "An unusually high yield vs. history can flag a beaten-down price — if the payout is sustainable.",
    pros: "Tangible cash return; yield spikes often mark pessimism lows.",
    cons: "A sky-high yield often precedes a dividend cut — the classic yield trap.",
    weight: 4,
    score: (d) => {
      if (!isNum(d.dividend_yield_pct) || d.dividend_yield_pct === 0) return null; // non-payer: weight redistributes
      // line through anchors 0.5% → 20 and 4% → 100, clamped
      return Math.max(0, Math.min(100, 20 + ((d.dividend_yield_pct - 0.5) * 80) / 3.5));
    },
    evaluate: (d) => {
      if (!isNum(d.dividend_yield_pct)) return na();
      if (d.dividend_yield_pct === 0) return verdict("na", "No dividend paid");
      if (d.dividend_yield_pct > 6) return verdict("caution", `Yield ${fmt(d.dividend_yield_pct)}% — high enough to question sustainability`);
      if (d.dividend_yield_pct >= 3) return verdict("under", `Yield ${fmt(d.dividend_yield_pct)}% — attractive income level`);
      return verdict("fair", `Yield ${fmt(d.dividend_yield_pct)}%`);
    },
  },
  {
    id: "graham", group: "Intrinsic value", name: "Graham Number",
    how: "√(22.5 × EPS × book value per share). Price below this classic ceiling suggests a Graham-style bargain.",
    pros: "Conservative, formulaic, hard to fudge.",
    cons: "Built for 1970s industrials; rejects nearly every asset-light growth company.",
    weight: 8,
    score: (d) => {
      if (!isNum(d.eps_ttm) || !isNum(d.bvps) || !isNum(d.price)) return null;
      if (d.eps_ttm <= 0 || d.bvps <= 0) return null;
      const g = Math.sqrt(22.5 * d.eps_ttm * d.bvps);
      return lerpScore(d.price / g, 0.7, 1.5);
    },
    evaluate: (d) => {
      if (!isNum(d.eps_ttm) || !isNum(d.bvps) || !isNum(d.price)) return na();
      if (d.eps_ttm <= 0 || d.bvps <= 0) return verdict("caution", "Negative EPS or book value — formula not applicable");
      const g = Math.sqrt(22.5 * d.eps_ttm * d.bvps);
      const gap = (g - d.price) / g;
      if (d.price < g) return verdict("under", `Price $${fmt(d.price)} vs. Graham № $${fmt(g)} (${pct(gap)} below)`);
      if (d.price < g * 1.2) return verdict("fair", `Price $${fmt(d.price)} slightly above Graham № $${fmt(g)}`);
      return verdict("over", `Price $${fmt(d.price)} well above Graham № $${fmt(g)}`);
    },
  },
  {
    id: "analyst", group: "Intrinsic value", name: "Analyst fair value gap",
    how: "Compares price with the consensus 12-month analyst target as a proxy for estimated fair value.",
    pros: "Aggregates professional models you don't have to build.",
    cons: "Targets herd together, lag the market, and skew optimistic.",
    weight: 12,
    score: (d) => {
      if (!isNum(d.analyst_target) || !isNum(d.price) || d.price <= 0) return null;
      return lerpScore((d.analyst_target - d.price) / d.price, 0.4, -0.2);
    },
    evaluate: (d) => {
      if (!isNum(d.analyst_target) || !isNum(d.price)) return na();
      const up = (d.analyst_target - d.price) / d.price;
      if (up > 0.15) return verdict("under", `Target $${fmt(d.analyst_target)} implies ${pct(up)} upside`);
      if (up > -0.05) return verdict("fair", `Target $${fmt(d.analyst_target)} ≈ price`);
      return verdict("over", `Target $${fmt(d.analyst_target)} below price (${pct(up)})`);
    },
  },
  {
    id: "week52", group: "Price context", name: "52-week range position",
    how: "Where price sits in its yearly range. The bottom third attracts contrarians and mean-reversion buyers.",
    pros: "Flags pessimism; good timing overlay on fundamental signals.",
    cons: "'Cheap vs. itself' isn't cheap vs. value — falling knives keep falling.",
    weight: 5,
    score: (d) => {
      if (!isNum(d.week52_low) || !isNum(d.week52_high) || !isNum(d.price)) return null;
      const span = d.week52_high - d.week52_low;
      if (span <= 0) return null;
      // contrarian: near the low → 100, near the high → 0
      return lerpScore((d.price - d.week52_low) / span, 0, 1);
    },
    evaluate: (d) => {
      if (!isNum(d.week52_low) || !isNum(d.week52_high) || !isNum(d.price)) return na();
      const span = d.week52_high - d.week52_low;
      if (span <= 0) return na();
      const pos = (d.price - d.week52_low) / span;
      if (pos < 0.33) return verdict("under", `${pct(pos)} up the 52-wk range ($${fmt(d.week52_low)}–$${fmt(d.week52_high)}) — near lows`);
      if (pos < 0.7) return verdict("fair", `${pct(pos)} up the 52-wk range`);
      return verdict("over", `${pct(pos)} up the 52-wk range — near highs`);
    },
  },
  {
    id: "piotroski", group: "Quality & risk", name: "Piotroski F-Score",
    how: "Nine accounting checks (0–9) on profitability, leverage and efficiency. 7+ separates healthy cheap stocks from traps.",
    pros: "Evidence-backed filter against value traps.",
    cons: "Backward-looking; a score alone says nothing about price.",
    weight: 13,
    score: (d) => (isNum(d.piotroski) ? (d.piotroski / 9) * 100 : null),
    evaluate: (d) => {
      if (!isNum(d.piotroski)) return na();
      if (d.piotroski >= 7) return verdict("under", `F-Score ${d.piotroski}/9 — strong fundamentals support the value case`);
      if (d.piotroski >= 4) return verdict("fair", `F-Score ${d.piotroski}/9 — middling quality`);
      return verdict("caution", `F-Score ${d.piotroski}/9 — weak fundamentals, value-trap risk`);
    },
  },
  {
    id: "altman", group: "Quality & risk", name: "Altman Z-Score",
    how: "Bankruptcy-risk composite. Above 3 = safe zone; below 1.8 = distress. A trap detector, not a bargain finder.",
    pros: "Catches balance-sheet rot that cheap ratios hide.",
    cons: "Calibrated for manufacturers; misleading for banks and utilities.",
    weight: 12,
    score: (d) => (isNum(d.altman_z) ? lerpScore(d.altman_z, 3, 1.8) : null),
    evaluate: (d) => {
      if (!isNum(d.altman_z)) return na();
      if (d.altman_z > 3) return verdict("under", `Z-Score ${fmt(d.altman_z)} — safe zone, low distress risk`);
      if (d.altman_z >= 1.8) return verdict("fair", `Z-Score ${fmt(d.altman_z)} — grey zone`);
      return verdict("caution", `Z-Score ${fmt(d.altman_z)} — distress zone, cheapness may be deserved`);
    },
  },
];

const GROUPS = ["Valuation ratios", "Intrinsic value", "Price context", "Quality & risk"];

const VALUATION_SUBCLUSTERS = [
  { label: "Earnings multiples", ids: ["pe_industry", "forward_pe", "peg"] },
  { label: "Asset & cash flow", ids: ["pb", "pfcf", "ev_ebitda"] },
  { label: "Income", ids: ["dividend"] },
];

/* ————— helpers ————— */
function isNum(v) { return typeof v === "number" && isFinite(v); }
function fmt(v) { return isNum(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : "—"; }
function pct(v) { return `${(v * 100).toFixed(0)}%`; }
function moneySymbol(currency) {
  if (!currency || currency === "USD") return "$";
  return `${currency} `;
}
function fmtMoney(v, currency) {
  if (!isNum(v)) return "—";
  const sym = moneySymbol(currency);
  const abs = Math.abs(v);
  const formatted = abs >= 1000
    ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${formatted}`;
}
function rangePlainSummary(d, pos) {
  const { price, week52_low: low, week52_high: high, currency } = d;
  if (pos >= 0.7) {
    return {
      headline: "Today's price is closer to the 52-week high",
      detail: `${fmtMoney(price, currency)} is ${pct((high - price) / high)} below the high · ${pct(pos)} above the low`,
    };
  }
  if (pos < 0.33) {
    return {
      headline: "Today's price is closer to the 52-week low",
      detail: `${fmtMoney(price, currency)} is ${pct((price - low) / low)} above the low · ${pct(pos)} up from the low`,
    };
  }
  return {
    headline: "Today's price is midway between the 52-week low and high",
    detail: `${fmtMoney(price, currency)} sits ${pct(pos)} of the way from low to high`,
  };
}
function verdict(kind, detail) { return { kind, detail }; }
function na() { return { kind: "na", detail: "Data not available for this metric" }; }

function splitDetail(detail) {
  const sep = detail.indexOf(" — ");
  if (sep === -1) return { primary: detail, secondary: null };
  return { primary: detail.slice(0, sep), secondary: detail.slice(sep + 3) };
}

/* linear interpolation: `good` → 100, `bad` → 0, clamped */
function lerpScore(value, good, bad) {
  const t = (value - bad) / (good - bad);
  return Math.max(0, Math.min(100, t * 100));
}

/* ————— composite score ————— */
const SCORE_BANDS = [
  { min: 75, label: "Strong value",  kind: "under" },
  { min: 60, label: "Attractive",    kind: "under" },
  { min: 40, label: "Fair",          kind: "fair" },
  { min: 25, label: "Expensive",     kind: "over" },
  { min: -Infinity, label: "Value trap risk", kind: "caution" },
];

function computeComposite(strategies, d) {
  const scored = strategies
    .map((s) => ({ id: s.id, weight: s.weight, score: s.score(d) }))
    .filter((s) => s.score !== null);
  const totalW = scored.reduce((sum, s) => sum + s.weight, 0);
  if (totalW === 0) return null;

  let value = scored.reduce((sum, s) => sum + s.score * s.weight, 0) / totalW;

  // Guardrail: statistically cheap but distressed companies get capped.
  const distressed =
    (isNum(d.altman_z) && d.altman_z < 1.8) ||
    (isNum(d.piotroski) && d.piotroski <= 2);
  const capped = distressed && value > 50;
  if (capped) value = 50;

  const rounded = Math.round(value);
  const band = SCORE_BANDS.find((b) => rounded >= b.min);
  return { value: rounded, band, capped, counted: scored.length };
}

const KIND_META = {
  under:   { label: "Undervalued", text: "text-under", border: "border-under" },
  fair:    { label: "Fair",        text: "text-fair",  border: "border-fair" },
  over:    { label: "Overvalued",  text: "text-over",  border: "border-over" },
  caution: { label: "Caution",     text: "text-over",  border: "border-over" },
  na:      { label: "No data",     text: "text-muted-foreground", border: "border-border" },
};

function summarizeGroupVerdicts(rows) {
  const counts = {};
  for (const { result } of rows) {
    counts[result.kind] = (counts[result.kind] || 0) + 1;
  }
  const parts = [];
  for (const kind of ["under", "fair", "over", "caution", "na"]) {
    const n = counts[kind];
    if (!n) continue;
    parts.push(`${n} ${KIND_META[kind].label.toLowerCase()}`);
  }
  return parts.join(" · ");
}

/* ————— live data via Yahoo Finance (server endpoint) ————— */
async function fetchMetrics(ticker) {
  const response = await fetch(`/api/metrics/${encodeURIComponent(ticker)}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Metrics request failed (${response.status})`);
  }
  return response.json();
}

async function searchSymbol(query) {
  const response = await fetch(`/api/search/${encodeURIComponent(query)}`);
  if (!response.ok) return null;
  const results = await response.json();
  // prefer tradeable listings; Yahoo already ranks by relevance
  const best = results.find((r) => r.type === "EQUITY" || r.type === "ETF") || results[0];
  return best?.symbol || null;
}

/* Try the input as a ticker first; if Yahoo has no quote for it, treat it as a
   company name ("Tesla", "Microsoft") and resolve it via symbol search. */
async function fetchMetricsSmart(token) {
  try {
    return { ticker: token, data: await fetchMetrics(token) };
  } catch (err) {
    const symbol = (await searchSymbol(token).catch(() => null))?.toUpperCase();
    if (symbol && symbol !== token) {
      return { ticker: symbol, data: await fetchMetrics(symbol) };
    }
    throw err;
  }
}

const OPINION_SECTIONS = [
  { key: "price_context", label: "Price context", icon: ChartLineIcon },
  { key: "strategy_read", label: "Strategy read", icon: ScaleIcon },
  { key: "key_caveat", label: "Key caveat", icon: ShieldAlertIcon },
];

const SENTIMENT_SECTIONS = [
  { key: "sentiment_lean", label: "Overall sentiment", icon: TrendingUpIcon },
  { key: "dominant_narrative", label: "Dominant narrative", icon: MegaphoneIcon },
  { key: "bearish_counterpoint", label: "Bearish counterpoint", icon: ShieldAlertIcon },
];

function hasTldrSections(sections) {
  if (!sections) return false;
  return SENTIMENT_SECTIONS.some((s) => sections[s.key]?.trim());
}

function parseOpinionResponse(text) {
  const empty = { price_context: "", strategy_read: "", key_caveat: "" };
  const trimmed = text.trim();
  if (!trimmed) return empty;

  try {
    const parsed = JSON.parse(trimmed.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const pick = (key) => (typeof parsed[key] === "string" ? parsed[key].trim() : "");
    const sections = {
      price_context: pick("price_context"),
      strategy_read: pick("strategy_read"),
      key_caveat: pick("key_caveat"),
    };
    if (sections.price_context || sections.strategy_read || sections.key_caveat) {
      return sections;
    }
  } catch {
    // fall through to plain-text fallback
  }

  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 3) {
    return {
      price_context: paragraphs[0],
      strategy_read: paragraphs[1],
      key_caveat: paragraphs.slice(2).join(" "),
    };
  }
  if (paragraphs.length === 2) {
    return { price_context: paragraphs[0], strategy_read: paragraphs[1], key_caveat: "" };
  }

  return { price_context: "", strategy_read: trimmed, key_caveat: "" };
}

async function fetchOpinion(ticker, d, results) {
  const lines = results
    .filter((r) => r.result.kind !== "na")
    .map((r) => `- ${r.strat.name}: ${KIND_META[r.result.kind].label} (${r.result.detail})`)
    .join("\n");
  const prompt = `You are a neutral, careful equity analysis writer. Below are current metrics and rule-of-thumb valuation verdicts for ${d.company_name || ticker} (${ticker}), price ${d.currency || "USD"} ${d.price}${d.as_of ? ` as of ${d.as_of}` : ""}, market cap ${d.market_cap || "n/a"}, sector ${d.sector || "n/a"}.

Verdicts from the screening strategies:
${lines}

Respond with ONLY a JSON object (no markdown fences, no prose outside the JSON) with three keys:
- "price_context": 1-2 sentences on where the price stands relative to the 52-week range (${d.week52_low}-${d.week52_high}) and the analyst target (${d.analyst_target}).
- "strategy_read": 1-2 sentences on the overall balance of strategy verdicts and the strongest signals for and against undervaluation.
- "key_caveat": 1 sentence on the most important value-trap risk or caveat given these specific numbers.

Be balanced and factual. Do NOT tell the reader to buy or sell and do not use phrases like "you should". Plain text inside each JSON value only.`;

  const response = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 350,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Opinion request failed (${response.status})`);
  }
  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return parseOpinionResponse(text);
}

/* ————— UI pieces ————— */
function Tag({ kind, label }) {
  const m = KIND_META[kind];
  return <span className={cn("tag", m.text)}>{label || m.label}</span>;
}

function SectionLabel({ children, className }) {
  return (
    <div className={cn("text-xs font-medium text-muted-foreground", className)}>
      {children}
    </div>
  );
}

function PriceContext({ d }) {
  const hasRange = isNum(d.week52_low) && isNum(d.week52_high) && isNum(d.price) && d.week52_high > d.week52_low;
  const pos = hasRange ? Math.min(1, Math.max(0, (d.price - d.week52_low) / (d.week52_high - d.week52_low))) : null;
  const tPos = hasRange && isNum(d.analyst_target)
    ? Math.min(1, Math.max(0, (d.analyst_target - d.week52_low) / (d.week52_high - d.week52_low)))
    : null;
  const chg = d.day_change_pct;
  const stats = [
    ["Market cap", d.market_cap || "—"],
    ["Sector", d.sector || "—"],
    ["P/E (ttm)", fmt(d.pe_ttm)],
    ["EPS (ttm)", isNum(d.eps_ttm) ? fmt(d.eps_ttm) : "—"],
    ["Div. yield", isNum(d.dividend_yield_pct) ? `${fmt(d.dividend_yield_pct)}%` : "—"],
    ["Analyst target", isNum(d.analyst_target) ? fmtMoney(d.analyst_target, d.currency) : "—"],
  ];
  return (
    <div className="border-b bg-background/60 px-4 pt-2 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-4xl font-bold tabular-nums">
          {isNum(d.price) ? fmtMoney(d.price, d.currency) : "—"}
        </span>
        {isNum(chg) && (
          <span className={cn("font-mono text-sm font-medium tabular-nums", chg >= 0 ? "text-under" : "text-over")}>
            {chg >= 0 ? "▲" : "▼"} {fmt(Math.abs(chg))}% today
          </span>
        )}
      </div>

      {hasRange && (() => {
        const summary = rangePlainSummary(d, pos);
        return (
        <div className="mt-4 cursor-default select-none">
          <div className="flex items-center gap-1">
            <SectionLabel className="mb-0">52-week range</SectionLabel>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="What does the 52-week range show?"
                    className="relative cursor-help text-muted-foreground/70 transition-colors hover:text-foreground after:absolute after:-inset-2"
                  >
                    <InfoIcon className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-56 font-sans normal-case tracking-normal">
                  Shows where today&apos;s price falls between the lowest and highest prices over
                  the past year. This is price history, not a valuation verdict.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <p className="m-0 mt-1.5 text-sm text-foreground/90">{summary.headline}</p>
          <p className="m-0 mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            {summary.detail}
          </p>

          <div
            className="relative mt-3 h-2 rounded-full bg-border"
            role="img"
            aria-label={`Price at ${pct(pos)} between 52-week low and high`}
          >
            <div
              className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground"
              style={{ left: `calc(${pos * 100}% - 1px)` }}
            />
            {tPos !== null && (
              <div
                className="absolute -inset-y-1 w-0.5 bg-muted-foreground/70"
                style={{ left: `calc(${tPos * 100}% - 1px)` }}
              />
            )}
          </div>

          <div className="relative mt-2">
            <div className="flex justify-between gap-4 font-mono text-xs tabular-nums">
              <span className="text-muted-foreground">
                <span className="block text-[10px] uppercase tracking-wide">52-wk low</span>
                {fmtMoney(d.week52_low, d.currency)}
              </span>
              <span className="text-right text-muted-foreground">
                <span className="block text-[10px] uppercase tracking-wide">52-wk high</span>
                {fmtMoney(d.week52_high, d.currency)}
              </span>
            </div>
            {tPos !== null && tPos >= 0.14 && tPos <= 0.86 && (
              <div className="relative mt-1 h-4 w-full">
              <span
                className="absolute top-0 inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground"
                style={{ left: `${tPos * 100}%`, transform: `translateX(-${tPos * 100}%)` }}
              >
                target {fmtMoney(d.analyst_target, d.currency)}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="What is the analyst target?"
                        className="relative cursor-help text-muted-foreground/70 transition-colors hover:text-foreground after:absolute after:-inset-2"
                      >
                        <InfoIcon className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-56 font-sans normal-case tracking-normal">
                      Average 12-month price target across the analysts covering this stock — a
                      consensus estimate of fair value, not a guarantee.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      <div className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 py-1.5">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="font-mono text-sm font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————— price chart ————— */
const CHART_RANGES = [
  ["1d", "1D"], ["5d", "5D"], ["1mo", "1M"], ["6mo", "6M"],
  ["ytd", "YTD"], ["1y", "1Y"], ["5y", "5Y"], ["max", "All"],
];

const PEER_COMPARE_RANGES = [
  ["1mo", "1M"], ["6mo", "6M"], ["ytd", "YTD"], ["1y", "1Y"], ["5y", "5Y"],
];

const PEER_SERIES_COLORS = {
  primary: "var(--foreground)",
  peer: ["var(--chart-2)", "var(--chart-3)", "var(--chart-4)"],
  benchmark: "var(--chart-5)",
};

function tickFormatterFor(range) {
  if (range === "1d") return (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (range === "5d") return (t) => new Date(t).toLocaleDateString([], { weekday: "short" });
  if (range === "5y" || range === "max") return (t) => new Date(t).getFullYear();
  return (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

function tooltipLabelFor(range, t) {
  const d = new Date(t);
  if (range === "1d" || range === "5d") {
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function ChartPriceTooltip({ active, payload, range, symbol }) {
  if (!active || !payload?.length) return null;
  const { t, p } = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 font-mono text-xs shadow-md">
      <div className="text-muted-foreground">{tooltipLabelFor(range, t)}</div>
      <div className="mt-0.5 font-medium tabular-nums">{symbol}{fmt(p)}</div>
    </div>
  );
}

function PriceChart({ ticker, currency }) {
  const [range, setRange] = useState("1mo");
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);

  const data = cache[range];

  useEffect(() => {
    if (cache[range]) return;
    let alive = true;
    setError(null);
    fetch(`/api/chart/${encodeURIComponent(ticker)}?range=${range}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Chart request failed (${res.status})`);
        }
        return res.json();
      })
      .then((chart) => { if (alive) setCache((prev) => ({ ...prev, [range]: chart })); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ticker, range, cache]);

  const symbol = currency === "USD" || !currency ? "$" : `${currency} `;
  const points = data?.points || [];
  const baseline = range === "1d" && isNum(data?.previousClose) ? data.previousClose : points[0]?.p;
  const last = points[points.length - 1]?.p;
  const up = isNum(last) && isNum(baseline) ? last >= baseline : true;
  const change = isNum(last) && isNum(baseline) && baseline !== 0 ? (last - baseline) / baseline : null;
  const color = up ? "var(--under)" : "var(--over)";
  const gradId = `vl-chart-${ticker.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {change !== null ? (
          <span className={cn("font-mono text-xs font-medium tabular-nums", up ? "text-under" : "text-over")}>
            {up ? "▲" : "▼"} {pct(Math.abs(change))} {range === "1d" ? "today" : "over period"}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">price history</span>
        )}
        <ToggleGroup
          type="single"
          size="sm"
          spacing={1}
          className="ml-auto"
          value={range}
          onValueChange={(v) => v && setRange(v)}
        >
          {CHART_RANGES.map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="relative h-6 min-w-8 px-2 font-mono text-[11px] text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 data-[state=on]:bg-secondary data-[state=on]:font-medium data-[state=on]:text-foreground"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="mt-3">
        {error ? (
          <div className="flex h-48 items-center justify-center font-mono text-xs text-muted-foreground">
            Couldn't load chart — {error}
          </div>
        ) : !data ? (
          <Skeleton className="h-48 w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-48 items-center justify-center font-mono text-xs text-muted-foreground">
            No price history for this range
          </div>
        ) : (
          <ChartContainer config={{ p: { label: "Price" } }} className="h-48 w-full aspect-auto">
            <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={tickFormatterFor(range)}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              />
              <YAxis
                dataKey="p"
                orientation="right"
                domain={[
                  (dataMin) => Math.min(dataMin, isNum(baseline) ? baseline : dataMin) * 0.998,
                  (dataMax) => Math.max(dataMax, isNum(baseline) ? baseline : dataMax) * 1.002,
                ]}
                tickFormatter={(v) => fmt(v)}
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                content={<ChartPriceTooltip range={range} symbol={symbol} />}
              />
              {range === "1d" && isNum(baseline) && (
                <ReferenceLine y={baseline} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.6} />
              )}
              <Area
                dataKey="p"
                type="linear"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </div>
    </div>
  );
}

function peerSeriesColor(role, peerIndex) {
  if (role === "primary") return PEER_SERIES_COLORS.primary;
  if (role === "benchmark") return PEER_SERIES_COLORS.benchmark;
  return PEER_SERIES_COLORS.peer[peerIndex % PEER_SERIES_COLORS.peer.length];
}

function PeerCompareTooltip({ active, payload, range }) {
  if (!active || !payload?.length) return null;
  const t = payload[0]?.payload?.t;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 font-mono text-xs shadow-md">
      {t != null && (
        <div className="text-muted-foreground">{tooltipLabelFor(range, t)}</div>
      )}
      <div className="mt-1 flex flex-col gap-0.5">
        {payload
          .filter((item) => isNum(item.value))
          .sort((a, b) => b.value - a.value)
          .map((item) => (
            <div key={item.dataKey} className="flex items-center justify-between gap-4 tabular-nums">
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.name}
              </span>
              <span className={cn("font-medium", item.value >= 0 ? "text-under" : "text-over")}>
                {item.value >= 0 ? "+" : ""}{fmt(item.value)}%
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function PeerCompareChart({ ticker, className }) {
  const [range, setRange] = useState("1mo");
  const [cache, setCache] = useState({});
  const [error, setError] = useState(null);

  const data = cache[range];

  useEffect(() => {
    if (cache[range]) return;
    let alive = true;
    setError(null);
    fetch(`/api/peers/${encodeURIComponent(ticker)}?range=${range}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Peer compare request failed (${res.status})`);
        }
        return res.json();
      })
      .then((d) => { if (alive) setCache((prev) => ({ ...prev, [range]: d })); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ticker, range, cache]);

  const chartConfig = Object.fromEntries(
    (data?.series || []).map((s, i) => {
      const peerIdx = (data?.series || [])
        .slice(0, i + 1)
        .filter((x) => x.role === "peer").length - 1;
      return [s.id, {
        label: s.label,
        color: peerSeriesColor(s.role, Math.max(0, peerIdx)),
      }];
    })
  );

  return (
    <div className={cn("border-t border-border px-4 py-3", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1">
          <SectionLabel className="mb-0">Vs. top peers & S&P 500</SectionLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="How is the peer comparison calculated?"
                  className="relative cursor-help text-muted-foreground/70 transition-colors hover:text-foreground after:absolute after:-inset-2"
                >
                  <InfoIcon className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60 font-sans normal-case tracking-normal">
                Indexed return from period start — {ticker.toUpperCase()} vs. three largest related
                peers{data?.peers?.length ? ` (${data.peers.join(", ")})` : ""} and the S&P 500 (SPY).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
        <ToggleGroup
          type="single"
          size="sm"
          spacing={1}
          className="ml-auto"
          value={range}
          onValueChange={(v) => v && setRange(v)}
        >
          {PEER_COMPARE_RANGES.map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="relative h-6 min-w-8 px-2 font-mono text-[11px] text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 data-[state=on]:bg-secondary data-[state=on]:font-medium data-[state=on]:text-foreground"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="mt-2">
        {error ? (
          <div className="flex h-40 items-center justify-center font-mono text-xs text-muted-foreground">
            Couldn't load peer chart — {error}
          </div>
        ) : !data ? (
          <Skeleton className="h-40 w-full" />
        ) : data.points.length === 0 ? (
          <div className="flex h-40 items-center justify-center font-mono text-xs text-muted-foreground">
            No comparison data for this range
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-40 w-full aspect-auto">
              <LineChart data={data.points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={tickFormatterFor(range)}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                />
                <YAxis
                  orientation="right"
                  tickFormatter={(v) => `${v >= 0 ? "+" : ""}${fmt(v)}%`}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                  content={<PeerCompareTooltip range={range} />}
                />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
                {data.series.map((s, i) => {
                  if (s.error) return null;
                  const peerIdx = data.series.slice(0, i + 1).filter((x) => x.role === "peer").length - 1;
                  const color = peerSeriesColor(s.role, Math.max(0, peerIdx));
                  return (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.id}
                      name={s.label}
                      stroke={color}
                      strokeWidth={s.role === "primary" ? 2 : 1.5}
                      strokeDasharray={s.role === "benchmark" ? "5 4" : undefined}
                      dot={false}
                      isAnimationActive={false}
                      activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
                      connectNulls
                    />
                  );
                })}
              </LineChart>
            </ChartContainer>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
              {data.series.filter((s) => !s.error).map((s) => {
                const allIdx = data.series.indexOf(s);
                const peerIdx = data.series.slice(0, allIdx + 1).filter((x) => x.role === "peer").length - 1;
                const color = peerSeriesColor(s.role, Math.max(0, peerIdx));
                const last = [...data.points].reverse().find((row) => isNum(row[s.id]));
                return (
                  <span key={s.id} className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                    <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground">{s.label}</span>
                    {last && (
                      <span className={cn("font-medium", last[s.id] >= 0 ? "text-under" : "text-over")}>
                        {last[s.id] >= 0 ? "+" : ""}{fmt(last[s.id])}%
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ————— street pulse: news + social sentiment ————— */
function timeAgo(t) {
  if (!t) return "";
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* Yahoo aggregates most article links, so map publisher names to their real
   domains for the favicon stack; unknown publishers fall back to the link host. */
const PUBLISHER_DOMAINS = {
  "motley fool": "fool.com",
  "thestreet": "thestreet.com",
  "yahoo finance": "finance.yahoo.com",
  "insider monkey": "insidermonkey.com",
  "investor's business daily": "investors.com",
  "reuters": "reuters.com",
  "bloomberg": "bloomberg.com",
  "barrons.com": "barrons.com",
  "marketwatch": "marketwatch.com",
  "benzinga": "benzinga.com",
  "zacks": "zacks.com",
  "seeking alpha": "seekingalpha.com",
  "stockstory": "stockstory.org",
  "gurufocus.com": "gurufocus.com",
  "the wall street journal": "wsj.com",
  "cnbc": "cnbc.com",
  "business insider": "businessinsider.com",
  "24/7 wall st.": "247wallst.com",
  "simply wall st.": "simplywall.st",
  "investopedia": "investopedia.com",
  "fortune": "fortune.com",
  "forbes": "forbes.com",
};

function stocktwitsMoodMeta(tagged, bullPct) {
  if (tagged === 0) {
    return { label: "No tags", badgeClass: "border border-border bg-secondary text-muted-foreground" };
  }
  if (bullPct >= 60) {
    return { label: "Mostly bullish", badgeClass: "bg-under-soft text-under" };
  }
  if (bullPct <= 40) {
    return { label: "Mostly bearish", badgeClass: "bg-over-soft text-over" };
  }
  return { label: "Mixed", badgeClass: "bg-secondary text-muted-foreground" };
}

function stocktwitsMoodSummary(st, bullPct, tagged) {
  const tagCoverage = tagged / st.total;
  const coveragePct = Math.round(tagCoverage * 100);

  if (tagged === 0) {
    return `None of the ${st.total} recent posts were sentiment-tagged.`;
  }

  const lowSample = tagged < 5 || tagCoverage < 0.25;

  if (st.bearish === 0 && st.bullish > 0) {
    if (lowSample) {
      return `All ${st.bullish} tagged ${st.bullish === 1 ? "post is" : "posts are"} bullish — only ${coveragePct}% of recent posts were tagged`;
    }
    return `All tagged posts are bullish (${st.bullish} of ${tagged} tagged)`;
  }

  if (st.bullish === 0 && st.bearish > 0) {
    if (lowSample) {
      return `All ${st.bearish} tagged ${st.bearish === 1 ? "post is" : "posts are"} bearish — only ${coveragePct}% of recent posts were tagged`;
    }
    return `All tagged posts are bearish (${st.bearish} of ${tagged} tagged)`;
  }

  if (lowSample) {
    return `${bullPct}% of tagged posts are bullish — only ${coveragePct}% of recent posts were tagged`;
  }

  return `${bullPct}% of tagged posts are bullish (${st.bullish} of ${tagged} tagged)`;
}

const OUTLOOK_LEAN_META = {
  bullish: { label: "Leans bullish", badgeClass: "bg-under-soft text-under", dot: "bg-under" },
  bearish: { label: "Leans bearish", badgeClass: "bg-over-soft text-over", dot: "bg-over" },
  mixed: { label: "Mixed signals", badgeClass: "bg-secondary text-muted-foreground", dot: "bg-muted-foreground" },
};

const SIGNAL_LEAN_DOT = {
  bullish: "bg-under",
  bearish: "bg-over",
  neutral: "bg-muted-foreground/40",
};

function OutlookSection({ title, group, narrative }) {
  const meta = OUTLOOK_LEAN_META[group.lean] || OUTLOOK_LEAN_META.mixed;
  if (!group.signals.length) {
    return (
      <div className="rounded-lg bg-muted/30 px-3 py-2.5 ring-1 ring-foreground/5">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel className="mb-0">{title}</SectionLabel>
          <Badge className="h-5 rounded-4xl border border-border bg-secondary px-2 font-mono text-[11px] font-medium text-muted-foreground">
            No data
          </Badge>
        </div>
        <p className="m-0 mt-1.5 text-[11px] text-muted-foreground">Not enough signals to form an outlook.</p>
      </div>
    );
  }

  const bullish = group.signals.filter((s) => s.lean === "bullish").length;
  const bearish = group.signals.filter((s) => s.lean === "bearish").length;
  const neutral = group.signals.length - bullish - bearish;

  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2.5 ring-1 ring-foreground/5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel className="mb-0">{title}</SectionLabel>
        <Badge className={cn("h-5 rounded-4xl px-2 font-mono text-[11px] font-medium tabular-nums", meta.badgeClass)}>
          {meta.label}
        </Badge>
      </div>

      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`${bullish} bullish, ${bearish} bearish, ${neutral} neutral signals`}
      >
        {bullish > 0 && <div className="bg-under" style={{ width: `${(bullish / group.signals.length) * 100}%` }} />}
        {bearish > 0 && <div className="bg-over" style={{ width: `${(bearish / group.signals.length) * 100}%` }} />}
        {neutral > 0 && (
          <div className="bg-muted-foreground/25" style={{ width: `${(neutral / group.signals.length) * 100}%` }} />
        )}
      </div>

      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {group.signals.map((s) => (
          <li key={s.id} className="flex items-baseline gap-2 text-[11px] leading-snug">
            <span className={cn("mt-1 size-2 shrink-0 rounded-full", SIGNAL_LEAN_DOT[s.lean])} aria-hidden />
            <span>
              <span className="font-medium text-foreground/90">{s.label}</span>
              <span className="text-muted-foreground"> · {s.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {narrative && (
        <p className="m-0 mt-2 border-t border-border/60 pt-2 text-[12px] leading-relaxed text-pretty text-foreground/90">
          {narrative}
        </p>
      )}
    </div>
  );
}

function OutlookCard({ ticker }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/outlook/${encodeURIComponent(ticker)}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Outlook request failed (${res.status})`);
        }
        return res.json();
      })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ticker]);

  if (error) return null;

  if (!data) {
    return (
      <div className="border-t border-border px-4 pb-3 pt-3.5">
        <Skeleton className="h-3.5 w-40" />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  const industryTitle = data.industry
    ? data.industry
    : data.sector
      ? `${data.sector}${data.sectorEtf ? ` (${data.sectorEtf})` : ""}`
      : "Industry";

  return (
    <div className="border-t border-border px-4 pb-3 pt-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <SectionLabel>Forward outlook</SectionLabel>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="How is the forward outlook calculated?"
                className="relative cursor-help text-muted-foreground/70 transition-colors hover:text-foreground after:absolute after:-inset-2"
              >
                <InfoIcon className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-60 font-sans normal-case tracking-normal">
              Combines analyst targets, valuation, momentum, quality scores, social mood, peer
              performance, and sector ETF trends. AI narrative (when available) summarizes these
              signals — not a price forecast.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <OutlookSection
          title={data.ticker}
          group={data.outlook.ticker}
          narrative={data.narrative.ticker}
        />
        <OutlookSection
          title={industryTitle}
          group={data.outlook.industry}
          narrative={data.narrative.industry}
        />
      </div>
    </div>
  );
}

function SentimentPanel({ ticker, className }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/sentiment/${encodeURIComponent(ticker)}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Sentiment request failed (${res.status})`);
        }
        return res.json();
      })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [ticker]);

  if (error) return null;

  if (!data) {
    return (
      <div className={cn("flex flex-col gap-2 px-4 py-3", className)}>
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    );
  }

  const st = data.stocktwits;
  const tagged = st ? st.bullish + st.bearish : 0;
  const bullPct = tagged > 0 ? Math.round((st.bullish / tagged) * 100) : null;
  const untagged = st ? st.total - tagged : 0;
  const bullShare = st?.total ? (st.bullish / st.total) * 100 : 0;
  const bearShare = st?.total ? (st.bearish / st.total) * 100 : 0;
  const untaggedShare = st?.total ? (untagged / st.total) * 100 : 0;
  const moodMeta = st && st.total > 0 ? stocktwitsMoodMeta(tagged, bullPct) : null;
  // StockTwits only knows plain US-style symbols (same normalization as the server)
  const stocktwitsUrl = `https://stocktwits.com/symbol/${encodeURIComponent(ticker.split(".")[0])}`;
  const hasSentimentContent = hasTldrSections(data.tldrSections) || st || data.news.length > 0;

  // distinct outlet domains for the favicon stack + total items analyzed
  const domains = [...new Set(
    data.news.map((n) => {
      const known = PUBLISHER_DOMAINS[(n.publisher || "").toLowerCase()];
      if (known) return known;
      try { return new URL(n.link).hostname; } catch { return null; }
    }).filter(Boolean)
  )];
  if (st) domains.push("stocktwits.com");
  const sourceCount = data.news.length + (st ? st.total : 0);

  return (
    <div className={cn("px-4 py-3", className)}>
      {hasSentimentContent && (
        <>
      <SectionLabel className="mb-2">Street pulse — news & social TL;DR</SectionLabel>

      {hasTldrSections(data.tldrSections) ? (
        <div className="flex flex-col gap-3">
          {SENTIMENT_SECTIONS.filter((s) => data.tldrSections[s.key]?.trim()).map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-center gap-1.5">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  <SectionLabel className="mb-0">{s.label}</SectionLabel>
                </div>
                <p className="m-0 text-sm leading-relaxed text-pretty">{data.tldrSections[s.key]}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted-foreground">
          {data.tldrAvailable
            ? "Couldn't generate the AI summary right now — raw signals below."
            : "Add ANTHROPIC_API_KEY to .env to enable the AI-written TL;DR — raw signals below."}
        </p>
      )}

      {(moodMeta || data.news.length > 0) && (
        <SectionLabel className="mb-0 mt-3.5">Market signals</SectionLabel>
      )}

      {moodMeta && (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>StockTwits mood</SectionLabel>
            <span className="inline-flex items-center gap-1">
              <Badge className={cn("h-5 rounded-4xl px-2 font-mono text-[11px] font-medium tabular-nums", moodMeta.badgeClass)}>
                {moodMeta.label}
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How is StockTwits mood calculated?"
                      className="relative cursor-help text-muted-foreground/70 transition-colors hover:text-foreground after:absolute after:-inset-2"
                    >
                      <InfoIcon className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56 font-sans normal-case tracking-normal">
                    The bar shows each post&apos;s share of the last {st.total} messages — bullish,
                    bearish, or untagged. The badge reflects the split among tagged posts only.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </div>

          {tagged > 0 ? (
            <div
              className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-border"
              role="img"
              aria-label={`${st.bullish} bullish, ${st.bearish} bearish, ${untagged} untagged out of ${st.total} recent posts`}
            >
              {bullShare > 0 && <div className="bg-under" style={{ width: `${bullShare}%` }} />}
              {bearShare > 0 && <div className="bg-over" style={{ width: `${bearShare}%` }} />}
              {untaggedShare > 0 && (
                <div className="bg-muted-foreground/25" style={{ width: `${untaggedShare}%` }} />
              )}
            </div>
          ) : (
            <p className="m-0 mt-1.5 text-[11px] text-muted-foreground">
              No sentiment tags in recent posts.
            </p>
          )}

          {tagged > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-under" aria-hidden />
                <a
                  href={stocktwitsUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the StockTwits stream in a new tab"
                  className="text-under underline decoration-under/40 underline-offset-2 hover:decoration-under"
                >
                  {st.bullish} bullish
                </a>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-over" aria-hidden />
                <a
                  href={stocktwitsUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the StockTwits stream in a new tab"
                  className="text-over underline decoration-over/40 underline-offset-2 hover:decoration-over"
                >
                  {st.bearish} bearish
                </a>
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full bg-muted-foreground/25" aria-hidden />
                {untagged} untagged
              </span>
            </div>
          )}

          <p className="m-0 mt-1 text-[11px] text-muted-foreground">
            {stocktwitsMoodSummary(st, bullPct, tagged)} on{" "}
            <a
              href={stocktwitsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
            >
              StockTwits
            </a>
          </p>
        </div>
      )}

      {data.news.length > 0 && (
        <ul className="m-0 mt-3.5 flex list-none flex-col gap-1.5 p-0">
          {data.news.slice(0, 4).map((n) => (
            <li key={n.link} className="flex items-baseline gap-2 text-[13px] leading-snug">
              <span
                aria-hidden
                title={n.sentiment ? `Reads ${n.sentiment} for this stock` : undefined}
                className={cn(
                  "text-[9px]",
                  n.sentiment === "bullish" ? "text-under"
                    : n.sentiment === "bearish" ? "text-over"
                    : n.sentiment === "neutral" ? "text-fair"
                    : "text-muted-foreground"
                )}
              >
                ●
              </span>
              <span>
                <a href={n.link} target="_blank" rel="noreferrer" className="text-foreground hover:text-primary hover:underline">
                  {n.title}
                </a>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {n.publisher}{n.time ? ` · ${timeAgo(n.time)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {sourceCount > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center">
            {domains.slice(0, 5).map((domain, i) => (
              <img
                key={domain}
                src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
                alt=""
                title={domain}
                className={cn("size-4 rounded-full bg-secondary ring-2 ring-card", i > 0 && "-ml-1.5")}
                loading="lazy"
              />
            ))}
          </span>
          <span className="font-medium text-foreground/70">{sourceCount} sources</span>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function VerdictSummaryStrip({ results, composite, strategyCount }) {
  const summary = summarizeGroupVerdicts(results);
  if (!summary && !composite) return null;
  return (
    <div className="border-b bg-muted/20 px-4 py-2.5">
      <p className="m-0 font-mono text-xs tabular-nums text-muted-foreground">
        {summary}
        {composite ? ` · score ${composite.value}/100` : ""}
        {` · ${strategyCount} selected ${strategyCount === 1 ? "strategy" : "strategies"}`}
      </p>
    </div>
  );
}

function AiUnavailableBanner({ visible }) {
  if (!visible) return null;
  return (
    <div className="border-b bg-muted/30 px-4 py-2 text-[12px] text-muted-foreground">
      AI summaries unavailable — showing rule-based verdicts and raw market data.
    </div>
  );
}

function OpinionPanel({ report }) {
  if (report.opinionStatus === "loading") {
    return (
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <Skeleton className="h-3.5 w-24" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3.5 w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </div>
    );
  }
  if (report.opinionStatus === "error" || !report.opinion) return null;

  const sections = OPINION_SECTIONS.filter((s) => report.opinion[s.key]?.trim());
  if (sections.length === 0) return null;

  return (
    <div className="border-b px-4 py-3">
      <SectionLabel className="mb-2 text-primary">Tausta's read</SectionLabel>
      <div className="flex flex-col gap-3">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key}>
              <div className="mb-1 flex flex-col gap-1">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                <SectionLabel className="mb-0">{s.label}</SectionLabel>
              </div>
              <p className="m-0 text-sm leading-relaxed text-pretty">
                {report.opinion[s.key]}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StrategyRow({ strat, result }) {
  const [open, setOpen] = useState(false);
  const m = KIND_META[result.kind];
  const isNa = result.kind === "na";
  const { primary, secondary } = splitDetail(result.detail);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/30"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-2 gap-y-1">
        <span className="text-sm font-medium leading-snug">{strat.name}</span>
        <Tag kind={result.kind} />
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Method notes"
            className="relative -mr-1 text-muted-foreground after:absolute after:-inset-2"
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      {!isNa && (
        <>
          <p className="mt-1 mb-0 font-mono text-[13px] tabular-nums leading-snug">{primary}</p>
          {secondary && (
            <p className="mt-0.5 mb-0 text-[13px] leading-snug text-muted-foreground text-pretty">{secondary}</p>
          )}
        </>
      )}
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[vl-collapse-open_200ms_cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-[vl-collapse-close_150ms_cubic-bezier(0.2,0,0,1)]">
        <div className={cn("mt-2 border-l-2 pl-3 text-[13px] leading-relaxed text-muted-foreground", m.border)}>
          <p className="m-0">{strat.how}</p>
          <p className="m-0 mt-1.5"><strong className="font-semibold text-under">Pro:</strong> {strat.pros}</p>
          <p className="m-0 mt-1"><strong className="font-semibold text-over">Con:</strong> {strat.cons}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CompactStrategyRow({ strat, result }) {
  const [open, setOpen] = useState(false);
  const m = KIND_META[result.kind];
  const isNa = result.kind === "na";
  const { primary } = splitDetail(result.detail);
  const detailText = isNa ? result.detail : primary;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/30"
    >
      <div className={cn(
        "grid items-baseline gap-x-2",
        isNa ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto_auto]",
      )}>
        <span className="min-w-0 truncate text-sm leading-snug">
          <span className="font-medium text-foreground">{strat.name}</span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={cn(
              "text-xs tabular-nums",
              isNa ? "text-muted-foreground" : "font-mono text-muted-foreground",
            )}
            title={detailText}
          >
            {detailText}
          </span>
        </span>
        {!isNa && <Tag kind={result.kind} />}
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Method notes"
            className="relative -mr-1 text-muted-foreground after:absolute after:-inset-2"
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[vl-collapse-open_200ms_cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-[vl-collapse-close_150ms_cubic-bezier(0.2,0,0,1)]">
        <div className={cn("mt-2 border-l-2 pl-3 text-[13px] leading-relaxed text-muted-foreground", m.border)}>
          <p className="m-0">{strat.how}</p>
          <p className="m-0 mt-1.5"><strong className="font-semibold text-under">Pro:</strong> {strat.pros}</p>
          <p className="m-0 mt-1"><strong className="font-semibold text-over">Con:</strong> {strat.cons}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StrategyGroup({ title, rows }) {
  const summary = summarizeGroupVerdicts(rows);
  const useSubclusters = title === "Valuation ratios";
  const Row = useSubclusters ? CompactStrategyRow : StrategyRow;

  const renderRows = (items) =>
    items.map((r) => <Row key={r.strat.id} strat={r.strat} result={r.result} />);

  return (
    <section className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
        {summary && <p className="m-0 text-xs text-muted-foreground">{summary}</p>}
      </div>
      {useSubclusters ? (
        VALUATION_SUBCLUSTERS.map((cluster) => {
          const clusterRows = rows.filter((r) => cluster.ids.includes(r.strat.id));
          if (clusterRows.length === 0) return null;
          return (
            <div key={cluster.label} className="not-first:mt-2">
              <SectionLabel className="mb-1 text-[11px] uppercase tracking-wide">{cluster.label}</SectionLabel>
              <div className="flex flex-col gap-0.5">{renderRows(clusterRows)}</div>
            </div>
          );
        })
      ) : (
        <div className="flex flex-col gap-1">{renderRows(rows)}</div>
      )}
    </section>
  );
}

function TickerReport({ report, selected, index }) {
  if (report.status === "loading") {
    return (
      <Card className="rise mt-6 gap-0 py-0" style={{ animationDelay: `${index * 100}ms` }}>
        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-center gap-3">
            <Spinner className="text-muted-foreground" />
            <span className="font-mono text-sm text-muted-foreground">
              Pulling live figures for {report.ticker}…
            </span>
          </div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      </Card>
    );
  }
  if (report.status === "error") {
    return (
      <Alert variant="destructive" className="rise mt-6 px-5 py-4" style={{ animationDelay: `${index * 100}ms` }}>
        <TriangleAlertIcon />
        <AlertTitle>{report.ticker} — couldn't fetch data</AlertTitle>
        <AlertDescription>
          {report.error}. Check the ticker symbol and run the analysis again.
        </AlertDescription>
      </Alert>
    );
  }

  const d = report.data;
  const active = STRATEGIES.filter((s) => selected.has(s.id));
  const results = active.map((s) => ({ strat: s, result: s.evaluate(d) }));
  const composite = computeComposite(active, d);
  const aiUnavailable = report.opinionStatus === "error"
    || (report.opinionStatus === "done" && !OPINION_SECTIONS.some((s) => report.opinion?.[s.key]?.trim()));

  return (
    <Card className="rise mt-6 gap-0 py-0" style={{ animationDelay: `${index * 100}ms` }}>
      <header className="flex flex-wrap items-baseline gap-4 border-b px-4 pb-3 pt-4">
        <h2 className="font-display m-0 text-lg font-bold">
          {d.company_name || report.ticker}{" "}
          <span className="font-mono text-[13px] font-normal text-muted-foreground">({report.ticker})</span>
        </h2>
        <div className="ml-auto flex items-baseline gap-3 text-right">
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center justify-end gap-2.5">
              {composite && <Tag kind={composite.band.kind} label={composite.band.label} />}
              {composite ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        aria-label="How is the value score calculated?"
                        className={cn(
                          "font-display cursor-help text-2xl font-bold tabular-nums",
                          KIND_META[composite.band.kind].text,
                        )}
                      >
                        {composite.value}
                        <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-64 font-sans normal-case tracking-normal">
                      Weighted average of {composite.counted} selected valuation checks (0 = expensive,
                      100 = cheap). Each check maps its metric to a 0–100 score; missing data is
                      skipped. Higher weights count more toward the total.
                      {composite.capped && (
                        <span className="mt-1 block text-background/80">
                          Capped at 50 — distress signals (weak Z-Score or F-Score).
                        </span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <div className="font-display text-2xl font-bold tabular-nums text-muted-foreground">
                  —
                  <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                </div>
              )}
            </div>
            {composite?.capped && (
              <div className="font-mono text-[11px] text-over">
                capped at 50 — distress signals (weak Z-Score or F-Score)
              </div>
            )}
          </div>
        </div>
      </header>
      <VerdictSummaryStrip results={results} composite={composite} strategyCount={active.length} />
      <AiUnavailableBanner visible={aiUnavailable} />
      <OpinionPanel report={report} />
      <div className="border-b">
        {GROUPS.map((g) => {
          const rows = results.filter((r) => r.strat.group === g);
          if (rows.length === 0) return null;
          return <StrategyGroup key={g} title={g} rows={rows} />;
        })}
      </div>
      <PriceContext d={d} />
      <PriceChart ticker={report.ticker} currency={d.currency} />
      <PeerCompareChart ticker={report.ticker} />
      <SentimentPanel ticker={report.ticker} />
      <OutlookCard ticker={report.ticker} />
    </Card>
  );
}

/* ————— main app ————— */
export default function Tausta() {
  const [tickerInput, setTickerInput] = useState("");
  const [selected, setSelected] = useState(new Set(STRATEGIES.map((s) => s.id)));
  const [reports, setReports] = useState([]);
  const [running, setRunning] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const setGroupSelection = (group, values) => {
    setSelected((prev) => {
      const next = new Set(prev);
      STRATEGIES.filter((s) => s.group === group).forEach((s) => next.delete(s.id));
      values.forEach((id) => next.add(id));
      return next;
    });
  };

  const runAnalysis = async () => {
    // Split on commas/semicolons when present so multi-word company names
    // ("Berkshire Hathaway, Tesla") survive; otherwise split on whitespace.
    const raw = tickerInput.trim();
    const tokens = /[,;]/.test(raw) ? raw.split(/[,;]+/) : raw.split(/\s+/);
    const tickers = [...new Set(
      tokens.map((t) => t.trim().toUpperCase()).filter(Boolean)
    )].slice(0, 3);
    if (tickers.length === 0 || selected.size === 0 || running) return;
    setRunning(true);
    setReports(tickers.map((t) => ({ ticker: t, status: "loading" })));
    const active = STRATEGIES.filter((s) => selected.has(s.id));
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      try {
        const { ticker, data } = await fetchMetricsSmart(t);
        setReports((prev) => prev.map((r) => (r.ticker === t ? { ...r, ticker, status: "done", data, opinionStatus: "loading" } : r)));
        try {
          const results = active.map((s) => ({ strat: s, result: s.evaluate(data) }));
          const opinion = await fetchOpinion(ticker, data, results);
          setReports((prev) => prev.map((r) => (r.ticker === ticker ? { ...r, opinion, opinionStatus: "done" } : r)));
        } catch {
          setReports((prev) => prev.map((r) => (r.ticker === ticker ? { ...r, opinionStatus: "error" } : r)));
        }
      } catch (e) {
        setReports((prev) => prev.map((r) => (r.ticker === t ? { ticker: t, status: "error", error: e.message } : r)));
      }
    }
    setRunning(false);
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-5 pb-20 pt-10">

        <header className="rise border-b pb-4">
          <h1 className="font-display mb-1 mt-0.5 text-3xl font-bold leading-tight">
            Tausta
          </h1>
          <p className="m-0 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Search tickers, pick valuation strategies, and get a tagged verdict per method from live market figures.
          </p>
        </header>

        {/* controls */}
        <div className="mt-5">
          <div className="rise" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center gap-2">
              <InputGroup className="h-8 bg-card">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  id="vl-tickers"
                  aria-label="Tickers"
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runAnalysis()}
                  placeholder="Up to 3 tickers or company names — AAPL, Tesla, PETR4.SA"
                  className="font-mono text-sm uppercase placeholder:normal-case"
                />
              </InputGroup>
              <Button
                className="h-8 px-4 active:scale-[0.96]"
                onClick={runAnalysis}
                disabled={running}
              >
                {running && <Spinner data-icon="inline-start" />}
                {running ? "Analyzing…" : "Analyze"}
              </Button>
            </div>
          </div>

          {/* strategy filters */}
          <div className="rise mt-2" style={{ animationDelay: "200ms" }}>
            <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                  <ChevronDownIcon
                    data-icon="inline-start"
                    className={cn("transition-transform", filtersOpen && "rotate-180")}
                  />
                  Strategies
                  <Badge variant="secondary" className="font-mono tabular-nums">
                    {selected.size}/{STRATEGIES.length}
                  </Badge>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[vl-collapse-open_200ms_cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-[vl-collapse-close_150ms_cubic-bezier(0.2,0,0,1)]">
                <div className="pb-1 pt-2">
                  <div className="flex items-baseline gap-3">
                    <Button
                      variant="link" size="xs" className="relative px-0 after:absolute after:-inset-x-1 after:-inset-y-2"
                      onClick={() => setSelected(new Set(STRATEGIES.map((s) => s.id)))}
                    >
                      select all
                    </Button>
                    <Button
                      variant="link" size="xs" className="relative px-0 text-muted-foreground after:absolute after:-inset-x-1 after:-inset-y-2"
                      onClick={() => setSelected(new Set())}
                    >
                      clear
                    </Button>
                  </div>
                  {GROUPS.map((g) => (
                    <div key={g} className="mt-2.5">
                      <SectionLabel className="mb-1 text-[11px]">{g}</SectionLabel>
                      <ToggleGroup
                        type="multiple"
                        spacing={1}
                        className="flex-wrap"
                        value={STRATEGIES.filter((s) => s.group === g && selected.has(s.id)).map((s) => s.id)}
                        onValueChange={(values) => setGroupSelection(g, values)}
                      >
                        {STRATEGIES.filter((s) => s.group === g).map((s) => (
                          <ToggleGroupItem
                            key={s.id}
                            value={s.id}
                            size="sm"
                            variant="outline"
                            className="h-6 rounded-full bg-card px-2.5 text-xs font-normal text-muted-foreground active:scale-[0.96] data-[state=on]:border-primary/40 data-[state=on]:bg-accent data-[state=on]:font-medium data-[state=on]:text-accent-foreground"
                          >
                            {s.name}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        {/* results */}
        {reports.map((r, i) => <TickerReport key={r.ticker} report={r} selected={selected} index={i} />)}

        <Separator className="mt-8" />
        <footer className="pt-4 text-[11px] leading-relaxed text-muted-foreground/80">
          Figures are pulled live from Yahoo Finance and may be delayed, approximate,
          or occasionally wrong — verify anything important against your broker or the company's filings.
          Signals are rule-of-thumb screens, not intrinsic-value proofs: a stock failing every test can still be
          a great buy, and one passing every test can be a value trap. Educational tool only, not financial advice.
        </footer>
      </div>
    </div>
  );
}
