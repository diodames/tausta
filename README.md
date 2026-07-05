# Tausta

**Tausta** (*background* in Finnish) is a stock screener that adds context around a ticker — not just a price, but how it scores on classic value rules, where it sits in its range, how peers compare, and what the street is saying.

Search up to three symbols, pick the valuation strategies you care about, and get a tagged verdict per method from live Yahoo Finance figures.

## What it does

Enter a ticker (or company name — e.g. `AAPL`, `Tesla`, `PETR4.SA`) and Tausta builds a report with:

- **12 valuation strategies** — each returns an **under / fair / over / caution** tag with a short explanation
- **Weighted score** — an overall read from the strategies you have selected
- **Price chart** — intraday through multi-year ranges
- **52-week range** — where the current price sits in the band
- **Peer comparison** — normalized performance vs industry peers and the S&P 500
- **Forward outlook** — sector/industry context and key forward metrics
- **Street pulse** — recent headlines, StockTwits mood, and (with an API key) an AI TL;DR
- **Tausta's read** — (with an API key) a short AI summary of price context, strategy read, and key caveats

Compare up to **three tickers** side by side with tabs. Starter packs (value, growth, dividends, banks, etc.) and recent searches make it easy to explore.

### Strategies

| Group | Methods |
| --- | --- |
| Valuation ratios | P/E vs. industry, forward vs. trailing P/E, P/B, PEG, P/FCF, EV/EBITDA, dividend yield |
| Intrinsic value | Graham Number, analyst fair-value gap |
| Price context | 52-week range position |
| Quality & risk | Piotroski F-Score, Altman Z-Score |

Toggle strategies on or off before running an analysis. Your selection is remembered in the browser.

## Run locally

**Requirements:** [Node.js](https://nodejs.org/) 18+ and npm.

```bash
git clone <your-repo-url>
cd stock-screener
npm install
```

### Environment (optional)

Copy the example env file and add an Anthropic key if you want AI summaries:

```bash
cp .env.example .env
```

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

| Feature | Without API key | With API key |
| --- | --- | --- |
| Live metrics & all 12 strategies | Yes | Yes |
| Charts, peers, outlook data | Yes | Yes |
| News & StockTwits counts | Yes | Yes |
| Tausta's read | No | Yes |
| Street pulse AI TL;DR | No | Yes |
| Forward outlook narrative | Data only | Data + AI narrative |

The app runs without a key; AI sections are simply skipped or show data-only fallbacks.

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

In dev, Vite serves the React app and mounts API routes under `/api/*` (metrics, chart, peers, search, sentiment, outlook, and an Anthropic proxy for opinions). Restart the dev server after changing `.env`.

### Production build

```bash
npm run build
npm run preview
```

Preview serves the built app at [http://localhost:4173](http://localhost:4173) by default.

The repo includes a `vercel.json` for [Vercel](https://vercel.com/) deploys. Set `ANTHROPIC_API_KEY` in the project environment variables on Vercel for AI features in production.

## Stack

- React 19 + Vite 6
- Tailwind CSS 4 + shadcn/ui
- Recharts
- [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) for market data

## Disclaimer

Figures are pulled live from Yahoo Finance and may be delayed or approximate. Strategy tags are rule-of-thumb screens, not proof of intrinsic value. **Educational tool only — not financial advice.** Verify anything important with primary sources or a licensed adviser.
