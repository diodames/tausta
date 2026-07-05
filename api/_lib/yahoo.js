import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function humanizeMarketCap(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];
  for (const [div, suffix] of units) {
    if (n >= div) return `${(n / div).toFixed(1)}${suffix}`;
  }
  return String(n);
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/* ————— quality scores from annual fundamentals ————— */

function computePiotroski(cur, prev) {
  const ratio = (a, b) => (num(a) !== null && num(b) !== null && b !== 0 ? a / b : null);
  // Long-term debt is often absent for debt-free companies; treat as 0 when the
  // balance sheet is otherwise present.
  const ltd = (y) => (num(y.totalAssets) !== null ? num(y.longTermDebt) ?? 0 : null);
  const shares = (y) => num(y.ordinarySharesNumber) ?? num(y.shareIssued);

  const roaCur = ratio(cur.netIncome, cur.totalAssets);
  const roaPrev = ratio(prev.netIncome, prev.totalAssets);
  const levCur = ratio(ltd(cur), cur.totalAssets);
  const levPrev = ratio(ltd(prev), prev.totalAssets);
  const crCur = ratio(cur.currentAssets, cur.currentLiabilities);
  const crPrev = ratio(prev.currentAssets, prev.currentLiabilities);
  const gmCur = ratio(cur.grossProfit, cur.totalRevenue);
  const gmPrev = ratio(prev.grossProfit, prev.totalRevenue);
  const atCur = ratio(cur.totalRevenue, cur.totalAssets);
  const atPrev = ratio(prev.totalRevenue, prev.totalAssets);

  const checks = [
    roaCur !== null ? roaCur > 0 : null,
    num(cur.operatingCashFlow) !== null ? cur.operatingCashFlow > 0 : null,
    roaCur !== null && roaPrev !== null ? roaCur > roaPrev : null,
    num(cur.operatingCashFlow) !== null && num(cur.netIncome) !== null
      ? cur.operatingCashFlow > cur.netIncome : null,
    levCur !== null && levPrev !== null ? levCur <= levPrev : null,
    crCur !== null && crPrev !== null ? crCur > crPrev : null,
    shares(cur) !== null && shares(prev) !== null ? shares(cur) <= shares(prev) : null,
    gmCur !== null && gmPrev !== null ? gmCur > gmPrev : null,
    atCur !== null && atPrev !== null ? atCur > atPrev : null,
  ];

  const available = checks.filter((c) => c !== null);
  if (available.length < 6) return null; // too little data for a meaningful score
  const passed = available.filter(Boolean).length;
  return Math.round((passed / available.length) * 9);
}

function computeAltmanZ(cur, marketCap) {
  const ta = num(cur.totalAssets);
  const wc = num(cur.workingCapital) ??
    (num(cur.currentAssets) !== null && num(cur.currentLiabilities) !== null
      ? cur.currentAssets - cur.currentLiabilities : null);
  const re = num(cur.retainedEarnings);
  const ebit = num(cur.EBIT);
  const tl = num(cur.totalLiabilitiesNetMinorityInterest);
  const rev = num(cur.totalRevenue);
  if ([ta, wc, re, ebit, tl, rev, num(marketCap)].some((v) => v === null) || ta === 0 || tl === 0) {
    return null;
  }
  return (
    1.2 * (wc / ta) +
    1.4 * (re / ta) +
    3.3 * (ebit / ta) +
    0.6 * (marketCap / tl) +
    1.0 * (rev / ta)
  );
}

async function fetchQualityScores(ticker, marketCap) {
  const rows = await yahooFinance.fundamentalsTimeSeries(ticker, {
    period1: new Date(Date.now() - 3 * 366 * 86400e3),
    period2: new Date(),
    type: "annual",
    module: "all",
  });
  const years = (rows || [])
    .filter((r) => num(r.totalAssets) !== null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (years.length === 0) return { piotroski: null, altman_z: null };

  const cur = years[years.length - 1];
  const prev = years.length > 1 ? years[years.length - 2] : null;
  return {
    piotroski: prev ? computePiotroski(cur, prev) : null,
    altman_z: computeAltmanZ(cur, marketCap),
  };
}

export async function fetchYahooMetrics(ticker) {
  const [q, s] = await Promise.all([
    yahooFinance.quote(ticker),
    yahooFinance
      .quoteSummary(ticker, {
        modules: ["assetProfile", "defaultKeyStatistics", "financialData"],
      })
      .catch(() => ({})),
  ]);
  if (!q || num(q.regularMarketPrice) === null) {
    throw new Error(`No quote data found for "${ticker}"`);
  }

  const stats = s.defaultKeyStatistics || {};
  const fin = s.financialData || {};
  const mcap = num(q.marketCap);
  const fcf = num(fin.freeCashflow);
  const ev = num(stats.enterpriseValue);
  const ebitda = num(fin.ebitda);
  const quality = await fetchQualityScores(ticker, mcap).catch(() => ({
    piotroski: null,
    altman_z: null,
  }));

  return {
    company_name: q.longName || q.shortName || ticker,
    currency: q.currency || null,
    price: num(q.regularMarketPrice),
    day_change_pct: num(q.regularMarketChangePercent),
    market_cap: humanizeMarketCap(mcap),
    sector: s.assetProfile?.sector || null,
    industry: s.assetProfile?.industry || null,
    eps_ttm: num(q.epsTrailingTwelveMonths),
    bvps: num(q.bookValue),
    pe_ttm: num(q.trailingPE),
    pe_forward: num(q.forwardPE),
    industry_avg_pe: null,
    pb: num(q.priceToBook),
    peg: num(stats.pegRatio),
    p_fcf: mcap && fcf && fcf !== 0 ? mcap / fcf : null,
    ev_ebitda: ev && ebitda && ebitda !== 0 ? ev / ebitda : null,
    dividend_yield_pct: num(q.dividendYield),
    analyst_target: num(fin.targetMeanPrice),
    week52_low: num(q.fiftyTwoWeekLow),
    week52_high: num(q.fiftyTwoWeekHigh),
    piotroski: quality.piotroski,
    altman_z: quality.altman_z,
    as_of: q.regularMarketTime
      ? new Date(q.regularMarketTime).toISOString().slice(0, 10)
      : null,
  };
}

const CHART_RANGES = {
  "1d":  { days: 5,    interval: "5m" },
  "5d":  { days: 12,   interval: "30m" },
  "1mo": { days: 31,   interval: "1h" },
  "6mo": { days: 183,  interval: "1d" },
  "ytd": { interval: "1d" },
  "1y":  { days: 366,  interval: "1d" },
  "5y":  { days: 1830, interval: "1wk" },
  "max": { interval: "1mo" },
};

export async function fetchYahooChart(ticker, range) {
  const cfg = CHART_RANGES[range] || CHART_RANGES["1d"];
  let period1;
  if (range === "ytd") period1 = new Date(new Date().getFullYear(), 0, 1);
  else if (range === "max") period1 = new Date("1970-01-01");
  else period1 = new Date(Date.now() - cfg.days * 86400e3);

  const r = await yahooFinance.chart(ticker, { period1, interval: cfg.interval });
  let quotes = (r.quotes || []).filter((q) => typeof q.close === "number");
  let previousClose = r.meta?.previousClose ?? r.meta?.chartPreviousClose ?? null;

  if (range === "1d") {
    const regular = r.meta?.currentTradingPeriod?.regular;
    if (regular?.start) {
      const start = new Date(regular.start).getTime();
      const end = regular.end ? new Date(regular.end).getTime() : Infinity;
      const before = quotes.filter((q) => new Date(q.date).getTime() < start);
      if (before.length) previousClose = before[before.length - 1].close;
      quotes = quotes.filter((q) => {
        const t = new Date(q.date).getTime();
        return t >= start && t <= end;
      });
    }
  } else if (range === "5d") {
    const dayOf = (q) => new Date(q.date).toISOString().slice(0, 10);
    const days = [...new Set(quotes.map(dayOf))].slice(-5);
    quotes = quotes.filter((q) => days.includes(dayOf(q)));
  }

  return {
    currency: r.meta?.currency || null,
    previousClose,
    points: quotes.map((q) => ({ t: new Date(q.date).getTime(), p: q.close })),
  };
}

const BENCHMARK_SYMBOL = "SPY";

function chartTimeKey(t, range) {
  if (range === "1d" || range === "5d") return t;
  return new Date(t).toISOString().slice(0, 10);
}

function normalizeChartToMap(points, range) {
  const valid = points.filter((p) => num(p.p) !== null);
  if (!valid.length) return new Map();
  const base = valid[0].p;
  const map = new Map();
  for (const { t, p } of valid) {
    map.set(chartTimeKey(t, range), { t, v: ((p / base) - 1) * 100 });
  }
  return map;
}

function buildIndustrySearchQueries(industryName, industryKey) {
  const queries = new Set();
  if (industryName) queries.add(industryName);
  if (industryKey) {
    queries.add(industryKey.replace(/-/g, " "));
    for (const part of industryKey.split("-")) {
      if (part.length >= 5) queries.add(part);
    }
  }
  if (industryName) {
    for (const part of industryName.split(/\s*-\s*|\s+/)) {
      if (part.length >= 5) queries.add(part);
    }
  }
  return [...queries];
}

async function resolveIndustryPeers(ticker, limit = 3) {
  const upper = ticker.toUpperCase();
  const targetProfile = await yahooFinance
    .quoteSummary(ticker, { modules: ["assetProfile"] })
    .catch(() => null);
  const industryKey = targetProfile?.assetProfile?.industryKey;
  const sectorKey = targetProfile?.assetProfile?.sectorKey;
  const industryName = targetProfile?.assetProfile?.industry;
  if (!industryKey) return { peers: [], industry: industryName || null };

  const profileCache = new Map();
  const getProfile = async (sym) => {
    const s = sym.toUpperCase();
    if (!profileCache.has(s)) {
      const p = await yahooFinance
        .quoteSummary(s, { modules: ["assetProfile"] })
        .catch(() => null);
      profileCache.set(s, p?.assetProfile ?? null);
    }
    return profileCache.get(s);
  };

  const seen = new Set([upper]);
  const candidates = [];
  const add = (symbol, marketCap = 0) => {
    const sym = symbol?.toUpperCase();
    if (!sym || seen.has(sym)) return;
    seen.add(sym);
    candidates.push({ symbol: sym, marketCap: num(marketCap) ?? 0 });
  };

  const searchQueries = buildIndustrySearchQueries(industryName, industryKey);
  const [rec, ...searchResults] = await Promise.all([
    yahooFinance.recommendationsBySymbol(ticker).catch(() => null),
    ...searchQueries.map((query) =>
      yahooFinance.search(query, { quotesCount: 50, newsCount: 0 }).catch(() => null)
    ),
  ]);

  const hop1 = (rec?.recommendedSymbols || []).map((r) => r.symbol).filter(Boolean);
  hop1.forEach((s) => add(s));
  for (const searchRes of searchResults) {
    for (const q of searchRes?.quotes || []) {
      if (q.quoteType === "EQUITY") add(q.symbol);
    }
  }

  const hop1Profiles = await Promise.all(hop1.map(getProfile));
  const expandSeeds = new Set();
  for (let i = 0; i < hop1.length; i++) {
    const p = hop1Profiles[i];
    if (!p) continue;
    if (p.industryKey === industryKey || p.sectorKey === sectorKey) {
      expandSeeds.add(hop1[i].toUpperCase());
    }
  }

  const hop2Recs = await Promise.all(
    [...expandSeeds].slice(0, 6).map((s) =>
      yahooFinance.recommendationsBySymbol(s).catch(() => null)
    )
  );
  for (const r of hop2Recs) {
    for (const x of r?.recommendedSymbols || []) add(x.symbol);
  }

  async function matchPeers(list, maxSymbols = list.length) {
    const matched = [];
    for (let i = 0; i < Math.min(list.length, maxSymbols) && matched.length < limit; i += 15) {
      const batch = list.slice(i, i + 15);
      const [profiles, quotes] = await Promise.all([
        Promise.all(batch.map(({ symbol }) => getProfile(symbol))),
        yahooFinance.quote(batch.map((b) => b.symbol)).catch(() => []),
      ]);
      const quoteList = Array.isArray(quotes) ? quotes : [quotes];
      const mcapMap = Object.fromEntries(
        quoteList
          .filter((q) => q?.symbol)
          .map((q) => [q.symbol.toUpperCase(), q.marketCap])
      );
      for (let j = 0; j < batch.length; j++) {
        if (profiles[j]?.industryKey !== industryKey) continue;
        const sym = batch[j].symbol;
        matched.push({
          symbol: sym,
          marketCap: num(mcapMap[sym]) ?? batch[j].marketCap ?? 0,
        });
      }
    }
    return matched.sort((a, b) => b.marketCap - a.marketCap);
  }

  let matched = await matchPeers(candidates);
  if (matched.length < limit) {
    const scr = await yahooFinance.screener("most_actives", { count: 250 });
    const fallback = (scr.quotes || [])
      .filter((q) => q.symbol?.toUpperCase() !== upper)
      .map((q) => ({
        symbol: q.symbol.toUpperCase(),
        marketCap: num(q.marketCap) ?? 0,
      }));
    const extra = await matchPeers(fallback, 100);
    const merged = new Map();
    for (const m of [...matched, ...extra]) merged.set(m.symbol, m);
    matched = [...merged.values()].sort((a, b) => b.marketCap - a.marketCap);
  }

  return {
    industry: industryName || null,
    peers: matched.slice(0, limit).map((m) => m.symbol),
  };
}

export async function fetchPeerCompare(ticker, range) {
  const { peers: peerSymbols, industry } = await resolveIndustryPeers(ticker, 3);

  const seriesMeta = [
    { id: ticker.toUpperCase(), role: "primary", label: ticker.toUpperCase() },
    ...peerSymbols.map((s) => ({ id: s, role: "peer", label: s })),
    { id: BENCHMARK_SYMBOL, role: "benchmark", label: "S&P 500" },
  ];

  const chartResults = await Promise.all(
    seriesMeta.map(async (meta) => {
      try {
        const chart = await fetchYahooChart(meta.id, range);
        return { ...meta, points: chart.points, error: null };
      } catch (err) {
        return { ...meta, points: [], error: err.message };
      }
    })
  );

  const primary = chartResults.find((s) => s.role === "primary");
  if (!primary?.points?.length) {
    throw new Error(`No chart data for "${ticker}"`);
  }

  const keyed = chartResults.map((s) => ({
    ...s,
    map: normalizeChartToMap(s.points, range),
  }));

  const primaryKeyed = keyed.find((s) => s.role === "primary");
  const keys = [...new Set(primary.points.map((p) => chartTimeKey(p.t, range)))].sort();

  const points = keys.map((key) => {
    const row = {
      t: primaryKeyed.map.get(key)?.t
        ?? primary.points.find((p) => chartTimeKey(p.t, range) === key)?.t,
    };
    for (const s of keyed) {
      const hit = s.map.get(key);
      if (hit) row[s.id] = hit.v;
    }
    return row;
  });

  return {
    range,
    industry,
    peers: peerSymbols,
    series: chartResults.map(({ id, role, label, error }) => ({ id, role, label, error })),
    points,
  };
}

export async function searchYahooSymbols(query) {
  const r = await yahooFinance.search(query, { quotesCount: 6, newsCount: 0 });
  return (r.quotes || [])
    .filter((q) => q.symbol)
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || null,
      exchange: q.exchDisp || null,
      type: q.quoteType || null,
    }));
}

export async function fetchStreetData(ticker) {
  const stSymbol = ticker.split(".")[0];
  const [newsRes, stRes] = await Promise.allSettled([
    yahooFinance.search(ticker, { newsCount: 10, quotesCount: 0 }),
    fetch(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(stSymbol)}.json`)
      .then((r) => (r.ok ? r.json() : null)),
  ]);

  const news = newsRes.status === "fulfilled"
    ? (newsRes.value.news || []).map((n) => ({
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        time: n.providerPublishTime ? new Date(n.providerPublishTime).getTime() : null,
      }))
    : [];

  let stocktwits = null;
  const messages = stRes.status === "fulfilled" ? stRes.value?.messages : null;
  if (messages?.length) {
    const tagged = (kind) => messages.filter((m) => m.entities?.sentiment?.basic === kind).length;
    stocktwits = {
      total: messages.length,
      bullish: tagged("Bullish"),
      bearish: tagged("Bearish"),
      sample: messages.slice(0, 15).map((m) => ({
        text: String(m.body || "").slice(0, 240),
        sentiment: m.entities?.sentiment?.basic || null,
      })),
    };
  }

  return { news, stocktwits };
}

function emptyTldrSections() {
  return { sentiment_lean: "", dominant_narrative: "", bearish_counterpoint: "" };
}

function compactTldrLine(text, maxLen = 110) {
  if (!text?.trim()) return "";
  let s = text.trim()
    .replace(/^The most notable bearish concern is\s+/i, "")
    .replace(/^The dominant narrative (centers on|focuses on|is)\s+/i, "")
    .replace(/^The overall sentiment (lean|is)\s+/i, "")
    .replace(/^Sentiment leans?\s+/i, "")
    .replace(/^with a majority of\s+/i, "");
  if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);

  const first = s.match(/^[^.!?]+[.!?]/)?.[0]?.trim() || s;
  if (first.length <= maxLen) return first;
  const clipped = first.slice(0, maxLen - 1).replace(/\s+\S*$/, "");
  return `${clipped}…`;
}

function compactTldrSections(sections) {
  if (!sections) return sections;
  return {
    sentiment_lean: compactTldrLine(sections.sentiment_lean),
    dominant_narrative: compactTldrLine(sections.dominant_narrative),
    bearish_counterpoint: compactTldrLine(sections.bearish_counterpoint),
  };
}

function parseTldrSections(text) {
  const empty = emptyTldrSections();
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const pick = (key) => (typeof parsed[key] === "string" ? parsed[key].trim() : "");
    if (typeof parsed.tldr === "string" && parsed.tldr.trim()) {
      const paragraphs = parsed.tldr.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      if (paragraphs.length >= 3) {
        return compactTldrSections({
          sentiment_lean: paragraphs[0],
          dominant_narrative: paragraphs[1],
          bearish_counterpoint: paragraphs.slice(2).join(" "),
        });
      }
      if (paragraphs.length === 2) {
        return compactTldrSections({
          sentiment_lean: paragraphs[0],
          dominant_narrative: paragraphs[1],
          bearish_counterpoint: "",
        });
      }
      return compactTldrSections({ ...empty, sentiment_lean: parsed.tldr.trim() });
    }
    const sections = {
      sentiment_lean: pick("sentiment_lean"),
      dominant_narrative: pick("dominant_narrative"),
      bearish_counterpoint: pick("bearish_counterpoint"),
    };
    if (sections.sentiment_lean || sections.dominant_narrative || sections.bearish_counterpoint) {
      return compactTldrSections(sections);
    }
    return null;
  } catch {
    // fall through to plain-text fallback
  }

  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 3) {
    return compactTldrSections({
      sentiment_lean: paragraphs[0],
      dominant_narrative: paragraphs[1],
      bearish_counterpoint: paragraphs.slice(2).join(" "),
    });
  }
  if (paragraphs.length === 2) {
    return compactTldrSections({
      sentiment_lean: paragraphs[0],
      dominant_narrative: paragraphs[1],
      bearish_counterpoint: "",
    });
  }
  return compactTldrSections({ ...empty, sentiment_lean: trimmed });
}

export async function writeSentimentSummary(apiKey, ticker, { news, stocktwits }) {
  const empty = { tldrSections: null, headlineSentiments: [] };
  if (!apiKey) return empty;
  if (news.length === 0 && !stocktwits) return empty;

  const posts = stocktwits
    ? stocktwits.sample.map((p) => `- ${p.sentiment ? `[${p.sentiment}] ` : ""}${p.text.replace(/\s+/g, " ")}`).join("\n")
    : "(none available)";
  const counts = stocktwits
    ? `Of the last ${stocktwits.total} StockTwits posts, ${stocktwits.bullish} were tagged Bullish and ${stocktwits.bearish} Bearish by their authors.`
    : "";

  const prompt = `You are summarizing current market chatter about the stock ${ticker} for an educational screening tool.

Recent news headlines (numbered, in order):
${news.map((n, i) => `${i + 1}. ${n.title} (${n.publisher})`).join("\n") || "(none available)"}

Recent StockTwits posts (social media):
${posts}

${counts}

Respond with ONLY a JSON object (no markdown fences, no prose outside the JSON) with four keys:
- "sentiment_lean": ONE short sentence (max ~18 words) on overall lean — bullish, bearish, or mixed.
- "dominant_narrative": ONE short sentence (max ~18 words) on the main catalyst or story.
- "bearish_counterpoint": ONE short sentence (max ~18 words) on the top concern.
- "headline_sentiments": an array with exactly one entry per numbered headline above, in the same order, each being "bullish", "bearish", or "neutral" — how that headline reads for ${ticker} specifically.

Style: telegraphic, no filler openers ("Sentiment leans…", "The dominant narrative…", "The most notable concern…"). Lead with the fact. Plain text only. No investment advice; do not use "you should".`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 280,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) return empty;
  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const valid = new Set(["bullish", "bearish", "neutral"]);
    const tldrSections = parseTldrSections(text);
    return {
      tldrSections,
      headlineSentiments: Array.isArray(parsed.headline_sentiments)
        ? parsed.headline_sentiments.map((s) => (valid.has(s) ? s : "neutral"))
        : [],
    };
  } catch {
    const tldrSections = parseTldrSections(text);
    return { tldrSections, headlineSentiments: [] };
  }
}

const SECTOR_ETF = {
  "Basic Materials": "XLB",
  "Communication Services": "XLC",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  "Energy": "XLE",
  "Financial Services": "XLF",
  "Healthcare": "XLV",
  "Industrials": "XLI",
  "Real Estate": "XLRE",
  "Technology": "XLK",
  "Utilities": "XLU",
};

async function chartTotalReturn(symbol, range = "1mo") {
  try {
    const chart = await fetchYahooChart(symbol, range);
    const pts = (chart.points || []).filter((p) => num(p.p) !== null);
    if (pts.length < 2) return null;
    return ((pts[pts.length - 1].p / pts[0].p) - 1) * 100;
  } catch {
    return null;
  }
}

function leanFromScore(score) {
  if (score > 0.25) return "bullish";
  if (score < -0.25) return "bearish";
  return "mixed";
}

function scoreSignalGroup(signals) {
  if (!signals.length) return { lean: "mixed", score: 0, signals: [] };
  const weights = { bullish: 1, neutral: 0, bearish: -1 };
  let total = 0;
  let wSum = 0;
  for (const s of signals) {
    total += weights[s.lean] * s.weight;
    wSum += s.weight;
  }
  const score = wSum ? total / wSum : 0;
  return { lean: leanFromScore(score), score, signals };
}

function buildOutlookSignals(ticker, metrics, peerData, streetData, sectorReturn, spyReturn) {
  const tickerSignals = [];
  const industrySignals = [];
  const sym = ticker.toUpperCase();

  if (num(metrics.analyst_target) !== null && num(metrics.price) !== null && metrics.price > 0) {
    const upside = ((metrics.analyst_target - metrics.price) / metrics.price) * 100;
    tickerSignals.push({
      id: "analyst_upside",
      label: "Analyst target",
      lean: upside > 5 ? "bullish" : upside < -5 ? "bearish" : "neutral",
      detail: `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}% vs current price`,
      weight: 2,
    });
  }

  if (num(metrics.pe_forward) !== null && num(metrics.pe_ttm) !== null && metrics.pe_ttm > 0) {
    const ratio = metrics.pe_forward / metrics.pe_ttm;
    tickerSignals.push({
      id: "earnings_growth",
      label: "Forward vs trailing P/E",
      lean: ratio < 0.9 ? "bullish" : ratio > 1.1 ? "bearish" : "neutral",
      detail: `${metrics.pe_forward.toFixed(1)} fwd vs ${metrics.pe_ttm.toFixed(1)} trailing`,
      weight: 1.5,
    });
  }

  if (num(metrics.week52_low) !== null && num(metrics.week52_high) !== null
    && num(metrics.price) !== null && metrics.week52_high > metrics.week52_low) {
    const pos = (metrics.price - metrics.week52_low) / (metrics.week52_high - metrics.week52_low);
    tickerSignals.push({
      id: "range_position",
      label: "52-week range",
      lean: pos < 0.35 ? "bullish" : pos > 0.75 ? "bearish" : "neutral",
      detail: `${Math.round(pos * 100)}% up the range`,
      weight: 1,
    });
  }

  const lastPoint = peerData?.points?.length ? peerData.points[peerData.points.length - 1] : null;
  if (lastPoint && lastPoint[sym] != null && lastPoint[BENCHMARK_SYMBOL] != null) {
    const rel = lastPoint[sym] - lastPoint[BENCHMARK_SYMBOL];
    tickerSignals.push({
      id: "momentum_1mo",
      label: "1-mo vs S&P 500",
      lean: rel > 2 ? "bullish" : rel < -2 ? "bearish" : "neutral",
      detail: `${rel >= 0 ? "+" : ""}${rel.toFixed(1)}% relative`,
      weight: 1.25,
    });
  }

  const st = streetData?.stocktwits;
  if (st) {
    const tagged = st.bullish + st.bearish;
    if (tagged > 0) {
      const bullPct = (st.bullish / tagged) * 100;
      tickerSignals.push({
        id: "social_mood",
        label: "StockTwits mood",
        lean: bullPct >= 60 ? "bullish" : bullPct <= 40 ? "bearish" : "neutral",
        detail: `${Math.round(bullPct)}% bullish among tagged posts`,
        weight: 0.75,
      });
    }
  }

  if (num(metrics.piotroski) !== null) {
    tickerSignals.push({
      id: "piotroski",
      label: "Piotroski F-Score",
      lean: metrics.piotroski >= 7 ? "bullish" : metrics.piotroski <= 3 ? "bearish" : "neutral",
      detail: `${metrics.piotroski}/9`,
      weight: 1,
    });
  }

  if (num(metrics.altman_z) !== null) {
    tickerSignals.push({
      id: "altman_z",
      label: "Altman Z-Score",
      lean: metrics.altman_z >= 2.99 ? "bullish" : metrics.altman_z < 1.81 ? "bearish" : "neutral",
      detail: metrics.altman_z.toFixed(2),
      weight: 1.25,
    });
  }

  const peers = (peerData?.series || []).filter((s) => s.role === "peer");
  if (lastPoint && peers.length) {
    const peerRets = peers.map((p) => lastPoint[p.id]).filter((v) => v != null);
    if (peerRets.length && lastPoint[BENCHMARK_SYMBOL] != null) {
      const avgPeer = peerRets.reduce((a, b) => a + b, 0) / peerRets.length;
      const rel = avgPeer - lastPoint[BENCHMARK_SYMBOL];
      industrySignals.push({
        id: "peer_basket",
        label: "Peer group vs S&P 500",
        lean: rel > 1 ? "bullish" : rel < -1 ? "bearish" : "neutral",
        detail: `${rel >= 0 ? "+" : ""}${rel.toFixed(1)}% avg peer relative (1 mo)`,
        weight: 2,
      });
    }
  }

  if (sectorReturn != null && spyReturn != null) {
    const rel = sectorReturn - spyReturn;
    industrySignals.push({
      id: "sector_etf",
      label: `${metrics.sector || "Sector"} ETF vs S&P 500`,
      lean: rel > 1 ? "bullish" : rel < -1 ? "bearish" : "neutral",
      detail: `${rel >= 0 ? "+" : ""}${rel.toFixed(1)}% sector relative (1 mo)`,
      weight: 2,
    });
  }

  if (num(metrics.pe_ttm) !== null && peers.length && lastPoint) {
    // Peer momentum breadth: how many peers beat SPY this month
    const spyRet = lastPoint[BENCHMARK_SYMBOL];
    if (spyRet != null) {
      const beating = peers.filter((p) => lastPoint[p.id] != null && lastPoint[p.id] > spyRet).length;
      const breadth = beating / peers.length;
      industrySignals.push({
        id: "peer_breadth",
        label: "Peers beating market",
        lean: breadth >= 0.67 ? "bullish" : breadth <= 0.33 ? "bearish" : "neutral",
        detail: `${beating} of ${peers.length} peers ahead of S&P 500 (1 mo)`,
        weight: 1,
      });
    }
  }

  return {
    ticker: scoreSignalGroup(tickerSignals),
    industry: scoreSignalGroup(industrySignals),
  };
}

export async function writeOutlookNarrative(apiKey, ticker, metrics, outlook) {
  const empty = { ticker: "", industry: "" };
  if (!apiKey) return empty;

  const fmtGroup = (label, group) => {
    const lines = group.signals.map((s) => `- ${s.label}: ${s.lean} (${s.detail})`).join("\n");
    return `${label} (overall lean: ${group.lean}, score ${group.score.toFixed(2)}):\n${lines || "(no signals)"}`;
  };

  const prompt = `You are a neutral equity analyst writing a brief forward-looking read for an educational screening tool. Base your outlook ONLY on the quantitative signals below — do not invent facts or cite news not listed here.

Company: ${metrics.company_name || ticker} (${ticker})
Sector: ${metrics.sector || "unknown"}
Industry: ${metrics.industry || "unknown"}
Price: ${metrics.currency || "USD"} ${metrics.price}${metrics.as_of ? ` as of ${metrics.as_of}` : ""}

${fmtGroup("Stock outlook signals", outlook.ticker)}

${fmtGroup("Industry/sector outlook signals", outlook.industry)}

Respond with ONLY a JSON object (no markdown fences) with two keys:
- "ticker": 2 sentences on the likely near-term direction for ${ticker} based on these signals. Mention the strongest bullish and bearish inputs.
- "industry": 2 sentences on the near-term outlook for the ${metrics.sector || "broader"} sector/industry based on these signals.

Be balanced, cite specific signals, and do NOT give buy/sell advice or use "you should". Plain text inside each JSON value only.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 350,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) return empty;
  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return {
      ticker: typeof parsed.ticker === "string" ? parsed.ticker.trim() : "",
      industry: typeof parsed.industry === "string" ? parsed.industry.trim() : "",
    };
  } catch {
    return empty;
  }
}

export async function fetchOutlook(ticker, apiKey) {
  const [metrics, peerData, streetData] = await Promise.all([
    fetchYahooMetrics(ticker),
    fetchPeerCompare(ticker, "1mo"),
    fetchStreetData(ticker),
  ]);

  const etfSymbol = metrics.sector ? SECTOR_ETF[metrics.sector] : null;
  const [sectorReturn, spyReturn] = etfSymbol
    ? await Promise.all([chartTotalReturn(etfSymbol, "1mo"), chartTotalReturn(BENCHMARK_SYMBOL, "1mo")])
    : [null, null];

  const outlook = buildOutlookSignals(ticker, metrics, peerData, streetData, sectorReturn, spyReturn);
  const narrative = await writeOutlookNarrative(apiKey, ticker, metrics, outlook).catch(() => ({
    ticker: "",
    industry: "",
  }));

  return {
    ticker: ticker.toUpperCase(),
    sector: metrics.sector,
    industry: metrics.industry,
    sectorEtf: etfSymbol,
    outlookAvailable: Boolean(apiKey),
    outlook,
    narrative,
  };
}
