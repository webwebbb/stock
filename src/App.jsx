import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import "./App.css";

const API = "https://stock-api.stockapi-india.workers.dev";

const NIFTY_50 = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK",
  "LT","AXISBANK","ASIANPAINT","MARUTI","SUNPHARMA","TITAN","BAJFINANCE","NESTLEIND","ULTRACEMCO","WIPRO",
  "HCLTECH","ONGC","NTPC","POWERGRID","M&M","TMPV","TATASTEEL","JSWSTEEL","ADANIENT","ADANIPORTS",
  "COALINDIA","BAJAJFINSV","TECHM","INDUSINDBK","HINDALCO","DRREDDY","CIPLA","GRASIM","DIVISLAB","EICHERMOT",
  "BRITANNIA","APOLLOHOSP","HEROMOTOCO","BPCL","TATACONSUM","SBILIFE","HDFCLIFE","BAJAJ-AUTO","SHRIRAMFIN","BANKBARODA",
];

const BANK_NIFTY = [
  "HDFCBANK","ICICIBANK","SBIN","KOTAKBANK","AXISBANK","INDUSINDBK","BANKBARODA","PNB","AUBANK","FEDERALBNK","IDFCFIRSTB","BANDHANBNK",
];

const FINNIFTY = [
  "HDFCBANK","ICICIBANK","SBIN","KOTAKBANK","AXISBANK","INDUSINDBK","BANKBARODA","BAJFINANCE","BAJAJFINSV","SBILIFE",
  "HDFCLIFE","ICICIGI","ICICIPRULI","CHOLAFIN","MUTHOOTFIN","LICHSGFIN","PFC","RECLTD","SHRIRAMFIN","SBICARD",
];

// Index meta — try these symbols for the live index quote
const INDEXES = [
  { id: "nifty50",  label: "Nifty 50",  symbols: NIFTY_50,  indexSymbols: ["^NSEI", "NIFTY50", "NIFTY_50"] },
  { id: "banknifty",label: "Bank Nifty",symbols: BANK_NIFTY, indexSymbols: ["^NSEBANK", "BANKNIFTY", "NIFTY_BANK"] },
  { id: "finnifty", label: "FinNifty",  symbols: FINNIFTY,  indexSymbols: ["NIFTY_FIN_SERVICE.NS", "FINNIFTY", "NIFTY_FIN_SERVICE"] },
];

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null) {
      return typeof v === "object" && "value" in v ? v.value : v;
    }
  }
  return null;
};

const toList = (d) => {
  if (Array.isArray(d)) return d;
  const inner = d?.stocks || d?.data || d?.results;
  if (Array.isArray(inner)) return inner;
  return d && typeof d === "object" ? Object.values(d) : [];
};

const normalize = (s) => ({
  symbol: String(pick(s, ["symbol", "ticker"]) ?? "").replace(/\.(NS|BO)$/, ""),
  name: pick(s, ["name", "shortName", "longName", "company"]),
  price: pick(s, ["price", "currentPrice", "regularMarketPrice", "ltp"]),
  change: pick(s, ["change", "regularMarketChange"]),
  pct: pick(s, ["changePercent", "change_percent", "percentChange", "pChange", "regularMarketChangePercent"]),
  volume: pick(s, ["volume", "regularMarketVolume"]),
  pe: pick(s, ["pe", "peRatio", "trailingPE"]),
  mcap: pick(s, ["marketCap", "market_cap"]),
  sector: pick(s, ["sector"]),
});

const fmt = (n, d = 2) =>
  n === null || n === undefined || isNaN(n)
    ? "—"
    : Number(n).toLocaleString("en-IN", { maximumFractionDigits: d });

const fmtBig = (n) => {
  if (n === null || isNaN(n)) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + " T";
  if (n >= 1e7) return (n / 1e7).toFixed(0) + " Cr";
  return fmt(n, 0);
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function fetchSymbols(symbols) {
  const results = await Promise.all(
    chunk(symbols, 10).map((c) =>
      fetch(`${API}/stock/list?symbols=${encodeURIComponent(c.join(","))}&res=num`)
        .then((r) => r.json())
        .then(toList)
        .catch(() => [])
    )
  );
  return results.flat().map(normalize).filter((s) => s.symbol);
}

async function loadAll(symbols) {
  return fetchSymbols(symbols);
}

async function loadQuotes(symbols) {
  const all = await fetchSymbols(symbols);
  return all.map((s) => ({
    symbol: s.symbol,
    price: s.price,
    change: s.change,
    pct: s.pct,
  }));
}

// Try to fetch the index quote directly; if the API doesn't support index
// symbols, compute an equal-weighted synthetic index from constituents.
async function loadIndexQuote(meta, constituents) {
  for (const sym of meta.indexSymbols) {
    try {
      const raw = await fetch(`${API}/stock/list?symbols=${encodeURIComponent(sym)}&res=num`)
        .then((r) => r.json())
        .then(toList);
      if (raw && raw.length) {
        const n = normalize(raw[0]);
        if (n.price != null) {
          return { value: n.price, change: n.change, pct: n.pct, synthetic: false };
        }
      }
    } catch {
      /* try next */
    }
  }
  // Fallback: average of constituent % changes → synthetic index change
  const withPct = constituents.filter((s) => s.pct != null);
  if (!withPct.length) return { value: null, change: null, pct: null, synthetic: true };
  const avgPct = withPct.reduce((a, s) => a + Number(s.pct), 0) / withPct.length;
  return { value: null, change: null, pct: avgPct, synthetic: true };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("nifty50");
  const [cache, setCache] = useState({});          // tabId -> stocks[]
  const [indexQuotes, setIndexQuotes] = useState({}); // tabId -> {value,change,pct,synthetic}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [updated, setUpdated] = useState(null);
  const [selected, setSelected] = useState(null);
  const [flashing, setFlashing] = useState({});

  const flashTimer = useRef(null);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const activeMeta = INDEXES.find((i) => i.id === activeTab);
  const stocks = cache[activeTab] || [];

  const setTabStocks = (tabId, stocksArr) =>
    setCache((c) => ({ ...c, [tabId]: stocksArr }));

  // Full load for the active tab (initial + manual + 60s)
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const meta = INDEXES.find((i) => i.id === activeTab);
      const data = await loadAll(meta.symbols);
      if (!data.length) throw new Error("No data returned. Check API / CORS.");
      setTabStocks(activeTab, data);

      const idx = await loadIndexQuote(meta, data);
      setIndexQuotes((q) => ({ ...q, [activeTab]: idx }));

      setUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  // Fast 1s quote patch — patches current tab only
  const refreshQuotes = useCallback(async () => {
    const meta = INDEXES.find((i) => i.id === activeTab);
    const current = cacheRef.current[activeTab] || [];
    if (!current.length) return;
    try {
      const quotes = await loadQuotes(meta.symbols);
      if (!quotes.length) return;

      const prev = new Map(current.map((s) => [s.symbol, s.price]));
      const flash = {};

      setTabStocks(
        activeTab,
        current.map((s) => {
          const q = quotes.find((x) => x.symbol === s.symbol);
          if (!q) return s;
          const changed =
            q.price != null &&
            prev.get(s.symbol) != null &&
            Number(q.price) !== Number(prev.get(s.symbol));
          if (changed) {
            flash[s.symbol] = q.pct > 0 ? "up" : q.pct < 0 ? "down" : "up";
          }
          return { ...s, price: q.price ?? s.price, change: q.change ?? s.change, pct: q.pct ?? s.pct };
        })
      );

      if (Object.keys(flash).length) {
        setFlashing((f) => ({ ...f, ...flash }));
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashing({}), 700);
      }

      const idx = await loadIndexQuote(meta, current);
      setIndexQuotes((q) => ({ ...q, [activeTab]: idx }));

      setUpdated(new Date());
    } catch {
      /* silent */
    }
  }, [activeTab]);

  // Reload when tab changes; set up timers
  useEffect(() => {
    setSelected(null);
    setQuery("");
    if (!cacheRef.current[activeTab]) {
      refresh();
    } else {
      setLoading(false);
      refreshQuotes();
    }

    const full = setInterval(refresh, 60000);
    const fast = setInterval(refreshQuotes, 1000);
    return () => {
      clearInterval(full);
      clearInterval(fast);
      clearTimeout(flashTimer.current);
    };
  }, [activeTab, refresh, refreshQuotes]);

  const shown = useMemo(
    () =>
      stocks.filter((s) =>
        (s.symbol + " " + (s.name || "")).toLowerCase().includes(query.toLowerCase())
      ),
    [stocks, query]
  );

  const gainers = stocks.filter((s) => s.pct > 0).length;
  const losers = stocks.filter((s) => s.pct < 0).length;

  return (
    <div className="app">

      {/* ── Index tab bar ─────────────────────────────── */}
      <nav className="indexTabs">
        {INDEXES.map((meta) => {
          const q = indexQuotes[meta.id];
          const dir = q?.pct > 0 ? "up" : q?.pct < 0 ? "down" : "flat";
          return (
            <button
              key={meta.id}
              className={`indexTab ${activeTab === meta.id ? "active" : ""} ${dir}`}
              onClick={() => setActiveTab(meta.id)}
            >
              <span className="indexTab__name">{meta.label}</span>
              <span className="indexTab__value">
                {q?.value != null ? `₹${fmt(q.value)}` : q?.synthetic ? "" : "—"}
              </span>
              <span className={`indexTab__pct ${dir}`}>
                {q?.pct != null
                  ? `${q.pct > 0 ? "▲" : q.pct < 0 ? "▼" : "•"} ${fmt(Math.abs(q.pct))}%`
                  : "—"}
                {q?.synthetic && q?.pct != null ? " (avg)" : ""}
              </span>
            </button>
          );
        })}
      </nav>

      <header className="top">
        <div>
          <h1>{activeMeta.label} Live</h1>
          <p className="sub">
            {updated ? `Updated ${updated.toLocaleTimeString("en-IN")}` : "Loading..."}
            {stocks.length > 0 && (
              <>
                {" · "}
                <span className="up">{gainers} up</span>
                {" · "}
                <span className="down">{losers} down</span>
              </>
            )}
          </p>
        </div>
        <div className="controls">
          <input
            className="search"
            placeholder="Search stock..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <main
        className={`grid ${selected ? "focused" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {loading && !stocks.length
          ? activeMeta.symbols.map((s) => <div key={s} className="card skeleton" />)
          : shown.map((s) => {
              const dir = s.pct > 0 ? "up" : s.pct < 0 ? "down" : "flat";
              const isActive = selected === s.symbol;
              const isDimmed = selected && !isActive;
              const flash = flashing[s.symbol];

              return (
                <article
                  key={s.symbol}
                  className={`card ${dir} ${isActive ? "active" : ""} ${
                    isDimmed ? "hidden" : ""
                  } ${flash ? `flash-${flash}` : ""}`}
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(isActive ? null : s.symbol);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(isActive ? null : s.symbol);
                    }
                  }}
                >
                  <div className="row">
                    <h2>{s.symbol}</h2>
                    <span className={`badge ${dir}`}>
                      {s.pct > 0 ? "▲" : s.pct < 0 ? "▼" : "•"} {fmt(Math.abs(s.pct))}%
                    </span>
                  </div>
                  <p className="name">{s.name || "—"}</p>
                  <div className="price">₹{fmt(s.price)}</div>
                  <div className={`chg ${dir}`}>
                    {s.change > 0 ? "+" : ""}
                    {fmt(s.change)} ({s.pct > 0 ? "+" : ""}
                    {fmt(s.pct)}%)
                  </div>

                  <div className="detailBox">
                    <div className="detailBox__head">
                      <b>{s.symbol}</b>
                      <span className={dir}>
                        {s.pct > 0 ? "▲" : s.pct < 0 ? "▼" : "•"} {fmt(Math.abs(s.pct))}%
                      </span>
                    </div>
                    <div className="detailBox__row"><span>Price</span><b>₹{fmt(s.price)}</b></div>
                    <div className="detailBox__row"><span>Change</span><b className={dir}>{s.change > 0 ? "+" : ""}{fmt(s.change)}</b></div>
                    <div className="detailBox__row"><span>% Change</span><b className={dir}>{s.pct > 0 ? "+" : ""}{fmt(s.pct)}%</b></div>
                    <div className="detailBox__row"><span>Volume</span><b>{fmtBig(s.volume)}</b></div>
                    <div className="detailBox__row"><span>P/E</span><b>{fmt(s.pe)}</b></div>
                    <div className="detailBox__row"><span>Mkt Cap</span><b>{fmtBig(s.mcap)}</b></div>
                    <div className="detailBox__row"><span>Sector</span><b>{s.sector || "—"}</b></div>
                  </div>
                </article>
              );
            })}
      </main>

      {!loading && !shown.length && !error && <p className="empty">No stocks found.</p>}

      <footer className="foot">
        Data for educational purposes only. Not for financial decisions.
      </footer>
    </div>
  );
}