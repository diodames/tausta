import { fetchStreetData, writeSentimentTldr } from "../_lib/yahoo.js";

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
    const tldr = await writeSentimentTldr(apiKey, ticker, data).catch(() => null);
    res.status(200).json({
      tldr,
      tldrAvailable: Boolean(apiKey),
      news: data.news.slice(0, 5).map(({ title, publisher, link, time }) => ({ title, publisher, link, time })),
      stocktwits: data.stocktwits
        ? { total: data.stocktwits.total, bullish: data.stocktwits.bullish, bearish: data.stocktwits.bearish }
        : null,
    });
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
}
