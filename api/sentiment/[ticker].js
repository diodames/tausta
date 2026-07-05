import { fetchStreetData, writeSentimentSummary } from "../_lib/yahoo.js";

export default async function handler(req, res) {
  const ticker = (req.query.ticker || "").trim();
  res.setHeader("Content-Type", "application/json");

  if (!ticker) {
    res.status(400).json({ error: { message: "Missing ticker" } });
    return;
  }

  try {
    const data = await fetchStreetData(ticker);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const summary = await writeSentimentSummary(apiKey, ticker, data)
      .catch(() => ({ tldrSections: null, headlineSentiments: [] }));
    res.status(200).json({
      tldrSections: summary.tldrSections,
      tldrAvailable: Boolean(apiKey),
      news: data.news.slice(0, 5).map(({ title, publisher, link, time }, i) => ({
        title, publisher, link, time,
        sentiment: summary.headlineSentiments[i] || null,
      })),
      stocktwits: data.stocktwits
        ? { total: data.stocktwits.total, bullish: data.stocktwits.bullish, bearish: data.stocktwits.bearish }
        : null,
    });
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
}
