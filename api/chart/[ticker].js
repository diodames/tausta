import { fetchYahooChart } from "../_lib/yahoo.js";

export default async function handler(req, res) {
  const ticker = (req.query.ticker || "").trim();
  const range = (req.query.range || "1d").trim();
  res.setHeader("Content-Type", "application/json");

  if (!ticker) {
    res.status(400).json({ error: { message: "Missing ticker" } });
    return;
  }

  try {
    const chart = await fetchYahooChart(ticker, range);
    res.status(200).json(chart);
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
}
