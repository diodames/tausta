import { useCallback, useEffect, useRef, useState } from "react";
import { BadgePercentIcon, Building2Icon, ChartLineIcon, ChevronDownIcon, CoinsIcon, CompassIcon, GraduationCapIcon, InfoIcon, LandmarkIcon, LayersIcon, MegaphoneIcon, ScaleIcon, SearchIcon, ShieldAlertIcon, SlidersHorizontalIcon, TrendingUpIcon, TriangleAlertIcon } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const STORAGE_RECENT = "tausta-recent-searches";
const STORAGE_DEMO_SEEN = "tausta-demo-seen";
const STORAGE_STRATEGIES = "tausta-strategies";
const MAX_RECENT_SEARCHES = 5;

const STARTER_PRESETS = [
  {
    id: "demo",
    icon: GraduationCapIcon,
    label: "See how it works",
    tickers: ["BRK.B"],
    hint: "Classic value case — most strategies fire",
  },
  {
    id: "contrast",
    icon: LayersIcon,
    label: "Value · growth · turnaround",
    tickers: ["BRK.B", "NVDA", "INTC"],
    hint: "Three profiles side by side",
  },
  {
    id: "megacap",
    icon: Building2Icon,
    label: "Megacap trio",
    tickers: ["AAPL", "MSFT", "GOOGL"],
    hint: "Same sector — different value scores",
  },
  {
    id: "trap",
    icon: BadgePercentIcon,
    label: "Cheap or trap?",
    tickers: ["INTC", "F", "T"],
    hint: "Low ratios — quality checks still matter",
  },
  {
    id: "dividend",
    icon: CoinsIcon,
    label: "Dividend income",
    tickers: ["KO", "JNJ", "PG"],
    hint: "Yield & payout sustainability",
  },
  {
    id: "growth",
    icon: TrendingUpIcon,
    label: "Growth stress-test",
    tickers: ["NVDA", "META", "AMZN"],
    hint: "Rich P/E — any value case left?",
  },
  {
    id: "banks",
    icon: LandmarkIcon,
    label: "Banks & balance sheets",
    tickers: ["JPM", "BAC", "WFC"],
    hint: "P/B and quality scores matter here",
  },
  {
    id: "global",
    icon: CompassIcon,
    label: "Global ADRs",
    tickers: ["TSM", "ASML", "NVO"],
    hint: "Same strategies, different markets",
  },
];

const QUICK_TICKERS = ["AAPL", "MSFT", "KO", "INTC"];

function parseTickerInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const tokens = /[,;]/.test(trimmed) ? trimmed.split(/[,;]+/) : trimmed.split(/\s+/);
  return [...new Set(tokens.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 3);
}

function loadRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_RECENT) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry === "string" && entry.trim())
      .slice(0, MAX_RECENT_SEARCHES)
      .map((entry) => parseTickerInput(entry.replace(/,/g, " ")));
  } catch {
    return [];
  }
}

function saveRecentSearch(tickers) {
  const label = tickers.join(", ");
  const prev = loadRecentSearches().map((t) => t.join(", "));
  const next = [label, ...prev.filter((e) => e !== label)].slice(0, MAX_RECENT_SEARCHES);
  try {
    localStorage.setItem(STORAGE_RECENT, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next.map((entry) => parseTickerInput(entry.replace(/,/g, " ")));
}

function loadSelectedStrategies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_STRATEGIES) || "null");
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((id) => STRATEGIES.some((s) => s.id === id))) {
      return new Set(parsed);
    }
  } catch {
    // ignore
  }
  return new Set(STRATEGIES.map((s) => s.id));
}

function saveSelectedStrategies(selected) {
  try {
    localStorage.setItem(STORAGE_STRATEGIES, JSON.stringify([...selected]));
  } catch {
    // ignore quota / private mode
  }
}

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
function rangeVsExpectedSummary(d) {
  if (!isNum(d.analyst_target) || !isNum(d.price) || d.price <= 0) return null;
  const upside = (d.analyst_target - d.price) / d.price;
  const targetStr = fmtMoney(d.analyst_target, d.currency);
  if (upside > 0.05) {
    return { line: `${pct(upside)} below expected price (${targetStr})`, below: true, upside };
  }
  if (upside < -0.05) {
    return { line: `${pct(Math.abs(upside))} above expected price (${targetStr})`, below: false, upside };
  }
  return { line: `Near expected price (${targetStr})`, below: null, upside };
}
function rangeTrackAriaLabel(pos, expectedSummary) {
  let label = `Today at ${pct(pos)} of 52-week range`;
  if (!expectedSummary) return label;
  if (expectedSummary.below === true) {
    return `${label}; ${pct(expectedSummary.upside)} below expected price`;
  }
  if (expectedSummary.below === false) {
    return `${label}; ${pct(Math.abs(expectedSummary.upside))} above expected price`;
  }
  return `${label}; near expected price`;
}
/** Center a 2px track tick on `fraction` along the bar (0 = low, 1 = high). */
function rangeTrackTickStyle(fraction) {
  return { left: `calc(${fraction * 100}% - 1px)` };
}
/** Center an 8px dot label on `fraction`, or pin to bar edge when off-range. */
function rangeMarkerLabelStyle(fraction, edge = "center") {
  if (edge === "high") return { left: "calc(100% - 4px)" };
  if (edge === "low") return { left: "4px", transform: "translateX(-50%)" };
  return { left: `${fraction * 100}%`, transform: "translateX(-50%)" };
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

function reportComposite(report, selected) {
  if (report.status !== "done" || !report.data) return null;
  const active = STRATEGIES.filter((s) => selected.has(s.id));
  return computeComposite(active, report.data);
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
  { key: "sentiment_lean", label: "Sentiment", icon: TrendingUpIcon },
  { key: "dominant_narrative", label: "Narrative", icon: MegaphoneIcon },
  { key: "bearish_counterpoint", label: "Bearish", icon: ShieldAlertIcon },
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

const OPINION_EMPHASIS_PATTERNS = {
  all: [
    /\$[\d,]+(?:\.\d+)?/g,
    /\d+(?:\.\d+)?%/g,
    /\b\d+\s+of\s+\d+\b/gi,
    /\b(?:lower|upper)\s+quartile\b/gi,
    /\b(?:Altman Z-Score|Piotroski F-Score|Graham Number|EV\/EBITDA|Z-Score|F-Score)\s*(?:of\s*)?[\d.]+(?:\/\d+)?/gi,
  ],
  strategy_read: [
    /\b(?:undervalued|overvalued|fair value|potential cheapness)\b/gi,
    /\b(?:Graham Number|EV\/EBITDA|dividend yield|analyst target(?:\s+gap)?|P\/FCF|P\/B|P\/E)\b/gi,
  ],
  key_caveat: [
    /\b(?:financial stress|value[- ]trap|distress|heavily leveraged|negative (?:free )?cash flow|rational pricing)[^,;.]*/gi,
  ],
};

function mergeEmphasisRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function emphasizeOpinionText(text, sectionKey) {
  if (!text) return text;
  const patterns = [
    ...OPINION_EMPHASIS_PATTERNS.all,
    ...(OPINION_EMPHASIS_PATTERNS[sectionKey] || []),
  ];
  const ranges = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match = re.exec(text);
    while (match) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      match = re.exec(text);
    }
  }
  const merged = mergeEmphasisRanges(ranges);
  if (merged.length === 0) return text;

  const parts = [];
  let pos = 0;
  merged.forEach((r, i) => {
    if (pos < r.start) parts.push(text.slice(pos, r.start));
    parts.push(
      <strong key={`${sectionKey}-${r.start}-${i}`} className="font-semibold text-foreground">
        {text.slice(r.start, r.end)}
      </strong>,
    );
    pos = r.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
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

function PriceContext({ d, hidePrice = false }) {
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
      {!hidePrice && (
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
      )}

      {hasRange && (() => {
        const summary = rangePlainSummary(d, pos);
        const expectedSummary = rangeVsExpectedSummary(d);
        const hasTarget = isNum(d.analyst_target);
        const rawTPos = hasTarget
          ? (d.analyst_target - d.week52_low) / (d.week52_high - d.week52_low)
          : null;
        const targetInRange = hasTarget && rawTPos >= 0 && rawTPos <= 1;
        const targetAboveHigh = hasTarget && rawTPos > 1;
        const targetBelowLow = hasTarget && rawTPos < 0;
        const labelsClose = targetInRange && tPos !== null && Math.abs(pos - tPos) < 0.12;

        return (
        <div className={cn("cursor-default select-none", hidePrice ? "mt-0" : "mt-4")}>
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
                <TooltipContent className="max-w-60 font-sans normal-case tracking-normal">
                  The Today marker shows the current price between the past year&apos;s low and high.
                  Expected is the consensus analyst target — compare the two to see upside or downside
                  vs expectations. Price history only, not a valuation verdict.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <p className="m-0 mt-1.5 text-sm text-foreground/90">{summary.headline}</p>
          <p className="m-0 mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            {summary.detail}
            {expectedSummary && ` · ${expectedSummary.line}`}
          </p>

          <div
            className="relative mt-3 h-2 rounded-full bg-border"
            role="img"
            aria-label={rangeTrackAriaLabel(pos, expectedSummary)}
          >
            <div
              className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground"
              style={rangeTrackTickStyle(pos)}
            />
            {targetInRange && tPos !== null && (
              <div
                className="absolute -inset-y-1 w-0.5 rounded-full bg-muted-foreground/70"
                style={rangeTrackTickStyle(tPos)}
              />
            )}
            {hasTarget && targetAboveHigh && (
              <div
                className="absolute -inset-y-1 w-0.5 rounded-full bg-muted-foreground/70"
                style={{ left: "calc(100% - 1px)" }}
              />
            )}
            {hasTarget && targetBelowLow && (
              <div
                className="absolute -inset-y-1 w-0.5 rounded-full bg-muted-foreground/70"
                style={{ left: 0 }}
              />
            )}
          </div>

          <div className={cn("relative mt-2 font-mono text-xs tabular-nums", labelsClose ? "min-h-3" : "min-h-5")}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="absolute top-0 flex cursor-default flex-col items-center gap-0.5 whitespace-nowrap"
                    style={rangeMarkerLabelStyle(pos)}
                  >
                    <span className="size-2 shrink-0 rounded-full bg-foreground" aria-hidden />
                    {!labelsClose && <span>Today</span>}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="font-mono tabular-nums">
                  Today · {fmtMoney(d.price, d.currency)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {hasTarget && (
              <span
                className="absolute top-0 flex flex-col items-center gap-0.5 whitespace-nowrap text-muted-foreground"
                style={rangeMarkerLabelStyle(
                  tPos ?? 0,
                  targetInRange ? "center" : targetAboveHigh ? "high" : "low",
                )}
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="size-2 shrink-0 cursor-default rounded-full bg-muted-foreground/70" aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent className="font-mono tabular-nums">
                      Expected · {fmtMoney(d.analyst_target, d.currency)}
                      {(targetAboveHigh || targetBelowLow) && (
                        <span className="mt-1 block text-background/80">
                          {targetAboveHigh
                            ? "Above the 52-week high — pinned to bar end"
                            : "Below the 52-week low — pinned to bar start"}
                        </span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {!labelsClose && (
                  <span className="inline-flex items-center gap-1">
                    Expected
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="What is the expected price?"
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
                )}
              </span>
            )}
          </div>

          {(targetAboveHigh || targetBelowLow) && (
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              {targetAboveHigh
                ? "Expected price sits above the 52-week high"
                : "Expected price sits below the 52-week low"}
            </p>
          )}

          <div className="mt-2 flex justify-between gap-4 font-mono text-xs tabular-nums text-muted-foreground">
            <span>
              <span className="text-[10px] uppercase tracking-wide">52-wk low</span>
              {" "}{fmtMoney(d.week52_low, d.currency)}
            </span>
            <span className="text-right">
              <span className="text-[10px] uppercase tracking-wide">52-wk high</span>
              {" "}{fmtMoney(d.week52_high, d.currency)}
            </span>
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

function PriceChart({ ticker, currency, className }) {
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
    <div className={cn("border-b px-4 py-3", className)}>
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
          <SectionLabel className="mb-0">Vs. industry peers & S&P 500</SectionLabel>
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
                Indexed return from period start — {ticker.toUpperCase()} vs. up to three largest
                {data?.industry ? ` ${data.industry}` : " industry"} peers
                {data?.peers?.length ? ` (${data.peers.join(", ")})` : ""} and the S&P 500 (SPY).
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
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {SENTIMENT_SECTIONS.filter((s) => data.tldrSections[s.key]?.trim()).map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex items-start gap-2 text-[13px] leading-snug">
                <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                <p className="m-0 min-w-0 text-pretty">
                  <span className="font-medium text-muted-foreground">{s.label}</span>
                  <span className="text-muted-foreground"> · </span>
                  {data.tldrSections[s.key]}
                </p>
              </li>
            );
          })}
        </ul>
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

function ReportHeader({ report, d, composite }) {
  const chg = d.day_change_pct;
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b px-4 pb-3 pt-4">
      <div className="min-w-0 flex-1">
        <h2 className="font-display m-0 text-lg font-bold">
          {d.company_name || report.ticker}{" "}
          <span className="font-mono text-[13px] font-normal text-muted-foreground">({report.ticker})</span>
        </h2>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-2xl font-bold tabular-nums">
            {isNum(d.price) ? fmtMoney(d.price, d.currency) : "—"}
          </span>
          {isNum(chg) && (
            <span className={cn("font-mono text-sm font-medium tabular-nums", chg >= 0 ? "text-under" : "text-over")}>
              {chg >= 0 ? "▲" : "▼"} {fmt(Math.abs(chg))}% today
            </span>
          )}
        </div>
      </div>
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
  );
}

function StrategyBreakdown({ results, strategyCount }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeGroupVerdicts(results);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        >
          <ChevronDownIcon
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
          <span className="text-sm font-medium">Strategy breakdown</span>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {strategyCount}/{STRATEGIES.length}
          </Badge>
          {summary && (
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
              {summary}
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[vl-collapse-open_200ms_cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-[vl-collapse-close_150ms_cubic-bezier(0.2,0,0,1)]">
        {summary && (
          <p className="m-0 border-t border-border px-4 py-2 font-mono text-xs tabular-nums text-muted-foreground sm:hidden">
            {summary}
          </p>
        )}
        <div className="border-t border-border">
          {GROUPS.map((g) => {
            const rows = results.filter((r) => r.strat.group === g);
            if (rows.length === 0) return null;
            return <StrategyGroup key={g} title={g} rows={rows} />;
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MarketContextSection({ ticker }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        >
          <ChevronDownIcon
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
          <span className="text-sm font-medium">Market context</span>
          <span className="text-xs text-muted-foreground">News, sentiment & outlook</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[vl-collapse-open_200ms_cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-[vl-collapse-close_150ms_cubic-bezier(0.2,0,0,1)]">
        <SentimentPanel ticker={ticker} className="border-t border-border" />
        <OutlookCard ticker={ticker} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function TickerTabs({ reports, selected, active, onChange }) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      className="rise mt-6 flex-wrap"
      value={active}
      onValueChange={(v) => v && onChange(v)}
    >
      {reports.map((r) => {
        const composite = reportComposite(r, selected);
        return (
          <ToggleGroupItem
            key={r.ticker}
            value={r.ticker}
            className="relative h-8 gap-1.5 rounded-full px-3 font-mono text-xs tabular-nums data-[state=on]:bg-secondary data-[state=on]:font-medium data-[state=on]:text-foreground"
          >
            {r.ticker}
            {r.status === "loading" && <Spinner className="size-3" />}
            {composite && (
              <span className={cn("font-medium tabular-nums", KIND_META[composite.band.kind].text)}>
                {composite.value}
              </span>
            )}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
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
            <div key={s.key} className="flex items-start gap-2">
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <SectionLabel className="mb-1">{s.label}</SectionLabel>
                <p className="m-0 text-sm leading-relaxed text-pretty text-foreground/90">
                  {emphasizeOpinionText(report.opinion[s.key], s.key)}
                </p>
              </div>
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

function TickerReport({ report, selected, index, className }) {
  if (report.status === "loading") {
    return (
      <Card className={cn("rise mt-6 gap-0 py-0", className)} style={{ animationDelay: `${index * 100}ms` }}>
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
      <Alert variant="destructive" className={cn("rise mt-6 px-5 py-4", className)} style={{ animationDelay: `${index * 100}ms` }}>
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
    <Card className={cn("rise mt-6 gap-0 py-0", className)} style={{ animationDelay: `${index * 100}ms` }}>
      <ReportHeader report={report} d={d} composite={composite} />
      <AiUnavailableBanner visible={aiUnavailable} />
      <PriceContext d={d} hidePrice />
      <OpinionPanel report={report} />
      <div className="border-b lg:grid lg:grid-cols-2">
        <PriceChart
          ticker={report.ticker}
          currency={d.currency}
          className="lg:border-r lg:border-border"
        />
        <PeerCompareChart ticker={report.ticker} className="border-t border-border lg:border-t-0" />
      </div>
      <MarketContextSection ticker={report.ticker} />
      <StrategyBreakdown results={results} strategyCount={active.length} />
    </Card>
  );
}

/* ————— main app ————— */
function RecentSearchChips({ recentSearches, running, onAnalyze, className, showLabel }) {
  if (recentSearches.length === 0) return null;
  return (
    <div className={className}>
      {showLabel && <SectionLabel className="mb-1.5">Recent</SectionLabel>}
      <div className="flex flex-wrap gap-1.5">
        {recentSearches.map((tickers) => (
          <Button
            key={tickers.join(",")}
            type="button"
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() => onAnalyze(tickers)}
            className="h-7 rounded-full bg-card px-2.5 font-mono text-xs tabular-nums active:scale-[0.96]"
          >
            {tickers.join(", ")}
          </Button>
        ))}
      </div>
    </div>
  );
}

function StarterPanel({ running, recentSearches, onAnalyze }) {
  return (
    <div className="rise mt-8" style={{ animationDelay: "300ms" }}>
      <SectionLabel className="mb-1">Get started</SectionLabel>
      <p className="m-0 text-sm text-pretty text-muted-foreground">
        Pick a pack below — value, growth, dividends, banks, traps, or global ADRs.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTER_PRESETS.map((preset) => {
          const Icon = preset.icon;
          return (
          <button
            key={preset.id}
            type="button"
            disabled={running}
            onClick={() => onAnalyze(preset.tickers)}
            className={cn(
              "group flex min-w-0 flex-col items-start gap-1 rounded-xl bg-card px-3.5 py-2.5 text-left",
              "ring-1 ring-foreground/10 transition-[box-shadow,ring-color] hover:ring-foreground/20",
              "active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted/50 ring-1 ring-foreground/10 transition-colors group-hover:bg-muted/80">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            </span>
            <span className="text-sm font-medium">{preset.label}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {preset.tickers.join(" · ")}
            </span>
            <span className="text-[11px] text-muted-foreground/80">{preset.hint}</span>
          </button>
          );
        })}
      </div>

      {recentSearches.length === 0 && (
        <div className="mt-4">
          <SectionLabel className="mb-1.5">Popular</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TICKERS.map((ticker) => (
              <Button
                key={ticker}
                type="button"
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() => onAnalyze([ticker])}
                className="h-7 rounded-full bg-card px-2.5 font-mono text-xs tabular-nums active:scale-[0.96]"
              >
                {ticker}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyPicker({ selected, onToggle, onSelectAll, onClear }) {
  const allSelected = selected.size === STRATEGIES.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={allSelected ? "icon-sm" : "sm"}
          className={cn("relative ml-auto shrink-0 text-muted-foreground", !allSelected && "gap-1")}
          aria-label={`Strategies — ${selected.size} of ${STRATEGIES.length} selected`}
        >
          {allSelected ? (
            <>
              <SlidersHorizontalIcon />
              <Badge variant="secondary" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 font-mono text-[10px] tabular-nums">
                {STRATEGIES.length}
              </Badge>
            </>
          ) : (
            <>
              <ChevronDownIcon data-icon="inline-start" />
              Strategies
              <Badge variant="secondary" className="font-mono tabular-nums">
                {selected.size}/{STRATEGIES.length}
              </Badge>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-baseline gap-3 px-1.5 py-1">
          <Button
            type="button"
            variant="link"
            size="xs"
            className="relative px-0 after:absolute after:-inset-x-1 after:-inset-y-2"
            onClick={onSelectAll}
          >
            select all
          </Button>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="relative px-0 text-muted-foreground after:absolute after:-inset-x-1 after:-inset-y-2"
            onClick={onClear}
          >
            clear
          </Button>
        </div>
        <DropdownMenuSeparator />
        {GROUPS.map((g, i) => (
          <DropdownMenuGroup key={g}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{g}</DropdownMenuLabel>
            {STRATEGIES.filter((s) => s.group === g).map((s) => (
              <DropdownMenuCheckboxItem
                key={s.id}
                checked={selected.has(s.id)}
                onCheckedChange={(checked) => onToggle(s.id, checked === true)}
                onSelect={(e) => e.preventDefault()}
              >
                {s.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Tausta() {
  const [tickerInput, setTickerInput] = useState("");
  const [selected, setSelected] = useState(() => loadSelectedStrategies());
  const [reports, setReports] = useState([]);
  const [running, setRunning] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => loadRecentSearches());
  const [activeTicker, setActiveTicker] = useState(null);
  const demoStarted = useRef(false);

  useEffect(() => {
    saveSelectedStrategies(selected);
  }, [selected]);

  useEffect(() => {
    if (reports.length === 0) {
      setActiveTicker(null);
      return;
    }
    if (!activeTicker || !reports.some((r) => r.ticker === activeTicker)) {
      setActiveTicker(reports[0].ticker);
    }
  }, [reports, activeTicker]);

  const toggleStrategy = (id, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const analyzeTickers = useCallback(async (tickers) => {
    if (tickers.length === 0 || selected.size === 0 || running) return;
    setTickerInput(tickers.join(", "));
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
    setRecentSearches(saveRecentSearch(tickers));
    setRunning(false);
  }, [selected, running]);

  useEffect(() => {
    if (demoStarted.current) return;
    demoStarted.current = true;
    let runDemo = false;
    try {
      runDemo = !localStorage.getItem(STORAGE_DEMO_SEEN);
      if (runDemo) localStorage.setItem(STORAGE_DEMO_SEEN, "1");
    } catch {
      runDemo = false;
    }
    if (runDemo) analyzeTickers(["BRK.B"]);
  }, [analyzeTickers]);

  const runAnalysis = () => analyzeTickers(parseTickerInput(tickerInput));

  const goHome = useCallback(() => {
    setTickerInput("");
    setReports([]);
    setActiveTicker(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const activeReport = reports.find((r) => r.ticker === activeTicker) ?? reports[0];
  const reportCardClass = reports.length > 1 ? "mt-3" : undefined;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-5 pb-20">

        <div className="sticky top-0 z-40 -mx-5 border-b border-border bg-background/95 px-5 pt-10 pb-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
          <header className="rise">
            <h1 className="font-display mb-1 mt-0.5 text-3xl font-bold leading-tight">
              <button
                type="button"
                onClick={goHome}
                aria-label="Back to home"
                className="cursor-pointer rounded-sm text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Tausta
              </button>
            </h1>
            <p className="m-0 max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground">
              Search tickers, pick strategies, get tagged verdicts from live figures.
            </p>
          </header>

          {/* controls */}
          <div className="rise mt-5" style={{ animationDelay: "100ms" }}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <InputGroup className="h-8 min-w-0 flex-1 bg-card">
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
                className="h-8 shrink-0 px-4 active:scale-[0.96]"
                onClick={runAnalysis}
                disabled={running}
              >
                {running && <Spinner data-icon="inline-start" />}
                {running ? "Analyzing…" : "Analyze"}
              </Button>
              <StrategyPicker
                selected={selected}
                onToggle={toggleStrategy}
                onSelectAll={() => setSelected(new Set(STRATEGIES.map((s) => s.id)))}
                onClear={() => setSelected(new Set())}
              />
            </div>
            <RecentSearchChips
              recentSearches={recentSearches}
              running={running}
              onAnalyze={analyzeTickers}
              className="mt-2"
            />
          </div>
        </div>

        {/* results */}
        {reports.length === 0 && !running && (
          <StarterPanel
            running={running}
            recentSearches={recentSearches}
            onAnalyze={analyzeTickers}
          />
        )}
        {reports.length > 1 && (
          <TickerTabs
            reports={reports}
            selected={selected}
            active={activeTicker}
            onChange={setActiveTicker}
          />
        )}
        {activeReport && (
          <TickerReport
            key={activeReport.ticker}
            report={activeReport}
            selected={selected}
            index={0}
            className={reportCardClass}
          />
        )}

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
