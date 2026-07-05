import { fetchOutlook } from "../_lib/yahoo.js";

export default async function handler(req, res) {
  const ticker = (req.query.ticker || "").trim();
  res.setHeader("Content-Type", "application/json");

  if (!ticker) {
    res.status(400).json({ error: { message: "Missing ticker" } });
    return;
  }

  try {
    const data = await fetchOutlook(ticker, process.env.ANTHROPIC_API_KEY);
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
}
