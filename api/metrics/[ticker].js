import { fetchYahooMetrics } from "../_lib/yahoo.js";

export default async function handler(req, res) {
  const ticker = (req.query.ticker || "").trim();
  res.setHeader("Content-Type", "application/json");

  if (!ticker) {
    res.status(400).json({ error: { message: "Missing ticker" } });
    return;
  }

  try {
    const metrics = await fetchYahooMetrics(ticker);
    res.status(200).json(metrics);
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
}
