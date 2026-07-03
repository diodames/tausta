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

  return {
    company_name: q.longName || q.shortName || ticker,
    currency: q.currency || null,
    price: num(q.regularMarketPrice),
    day_change_pct: num(q.regularMarketChangePercent),
    market_cap: humanizeMarketCap(mcap),
    sector: s.assetProfile?.sector || null,
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
    piotroski: null,
    altman_z: null,
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

export async function writeSentimentTldr(apiKey, ticker, { news, stocktwits }) {
  if (!apiKey) return null;
  if (news.length === 0 && !stocktwits) return null;

  const headlines = news.map((n) => `- ${n.title} (${n.publisher})`).join("\n");
  const posts = stocktwits
    ? stocktwits.sample.map((p) => `- ${p.sentiment ? `[${p.sentiment}] ` : ""}${p.text.replace(/\s+/g, " ")}`).join("\n")
    : "(none available)";
  const counts = stocktwits
    ? `Of the last ${stocktwits.total} StockTwits posts, ${stocktwits.bullish} were tagged Bullish and ${stocktwits.bearish} Bearish by their authors.`
    : "";

  const prompt = `You are summarizing current market chatter about the stock ${ticker} for an educational screening tool.

Recent news headlines:
${headlines || "(none available)"}

Recent StockTwits posts (social media):
${posts}

${counts}

Write a TL;DR of 2-4 sentences covering: (1) the overall sentiment lean right now (bullish, bearish, or mixed) across news and social posts; (2) the dominant narrative or catalyst people are talking about; (3) the most notable concern or bearish counterpoint. Plain prose only, no markdown, no bullet points, no investment advice, do not use the phrase "you should".`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return text || null;
}
