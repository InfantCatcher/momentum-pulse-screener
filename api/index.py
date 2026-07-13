import os
import re
import time
from datetime import datetime, time as dtime
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Optional

import requests
from bs4 import BeautifulSoup
import yfinance as yf
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Stock Momentum Screener API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SEC_TICKERS_CACHE: List[str] = []
LAST_SEC_FETCH_TIME: float = 0.0

FALLBACK_POPULAR_STOCKS = [
    "PLBL", "MARA", "RIOT", "SOUN", "BBAI", "SMCI", "NIO", "XPEV", "LCID", "BB",
    "CLSK", "WULF", "HUT", "BITF", "IREN", "CIFR", "SDIG", "MSTR", "COIN", "GME",
    "AMC", "MULN", "FFIE", "CVNA", "UPST", "AI", "PLTR", "SOFI", "RIVN", "HOOD",
    "DKNG", "OPEN", "PATH", "STEM", "JOBY", "ACHR", "QS", "LCID", "NKLA", "RIG"
]

def get_market_session_info() -> Dict[str, Any]:
    ny_tz = ZoneInfo("America/New_York")
    now = datetime.now(ny_tz)
    weekday = now.weekday()
    current_time = now.time()
    
    pre_start = dtime(4, 0)
    market_open = dtime(9, 30)
    market_close = dtime(16, 0)
    post_close = dtime(20, 0)
    
    session_name = "Closed"
    elapsed_fraction = 1.0
    
    if weekday >= 5:
        session_name = "Weekend (Closed)"
        elapsed_fraction = 1.0
    elif current_time < pre_start:
        session_name = "Overnight (Closed)"
        elapsed_fraction = 1.0
    elif pre_start <= current_time < market_open:
        session_name = "Pre-market"
        elapsed_pre_mins = (now.hour - 4) * 60 + now.minute + (now.second / 60)
        elapsed_fraction = max(0.015, (elapsed_pre_mins / 330) * 0.3)
    elif market_open <= current_time <= market_close:
        session_name = "Regular Session"
        elapsed_reg_mins = (now.hour - 9) * 60 + (now.minute - 30) + (now.second / 60)
        elapsed_fraction = max(0.02, elapsed_reg_mins / 390)
    elif market_close < current_time <= post_close:
        session_name = "After-Hours"
        elapsed_fraction = 1.0
    else:
        session_name = "Closed"
        elapsed_fraction = 1.0
        
    return {
        "session_name": session_name,
        "est_time": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "elapsed_fraction": round(elapsed_fraction, 4),
        "is_premarket": session_name == "Pre-market",
        "is_open": session_name == "Regular Session"
    }

def get_master_ticker_universe() -> List[str]:
    global SEC_TICKERS_CACHE, LAST_SEC_FETCH_TIME
    now = time.time()
    
    if not SEC_TICKERS_CACHE or (now - LAST_SEC_FETCH_TIME > 3600):
        try:
            sec_headers = {
                "User-Agent": "MomentumPulse Screener/1.0 (contact@momentumpulse.com)"
            }
            url = "https://www.sec.gov/files/company_tickers.json"
            res = requests.get(url, headers=sec_headers, timeout=2.0)
            if res.status_code == 200:
                data = res.json()
                symbols = set()
                for val in data.values():
                    sym = val.get("ticker")
                    if sym and sym.isalpha() and len(sym) <= 5:
                        symbols.add(sym.upper())
                if symbols:
                    SEC_TICKERS_CACHE = sorted(list(symbols))
                    LAST_SEC_FETCH_TIME = now
        except Exception:
            pass
            
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
    target_urls = [
        "https://finance.yahoo.com/markets/stocks/gainers/?count=100&offset=0",
        "https://finance.yahoo.com/markets/stocks/gainers/?count=100&offset=100",
        "https://finance.yahoo.com/markets/stocks/losers/?count=100&offset=0",
        "https://finance.yahoo.com/markets/stocks/most-active/?count=100&offset=0",
        "https://finance.yahoo.com/markets/stocks/premarket-gainers/?count=100&offset=0",
        "https://finance.yahoo.com/markets/stocks/premarket-losers/?count=100&offset=0"
    ]
    
    active_scraped = []
    seen = set()
    
    def fetch_url(u):
        symbols = []
        try:
            r = requests.get(u, headers=headers, timeout=2.0)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "html.parser")
                for link in soup.find_all("a"):
                    href = link.get("href", "")
                    match = re.search(r"^/quote/([A-Z0-9\-]+)/?$", href)
                    if match:
                        sym = match.group(1).upper()
                        if not sym.startswith("^") and "=" not in sym and "%" not in sym:
                            symbols.append(sym)
        except Exception:
            pass
        return symbols

    try:
        with ThreadPoolExecutor(max_workers=6) as executor:
            futs = [executor.submit(fetch_url, url) for url in target_urls]
            for f in as_completed(futs):
                for sym in f.result():
                    if sym not in seen:
                        seen.add(sym)
                        active_scraped.append(sym)
    except Exception:
        pass
            
    combined = list(active_scraped)
    if SEC_TICKERS_CACHE:
        for sym in SEC_TICKERS_CACHE:
            if sym not in seen:
                seen.add(sym)
                combined.append(sym)
    else:
        for sym in FALLBACK_POPULAR_STOCKS:
            if sym not in seen:
                seen.add(sym)
                combined.append(sym)
                
    return combined

def fetch_single_ticker_data(ticker_symbol: str, elapsed_fraction: float, is_premarket: bool) -> Optional[Dict[str, Any]]:
    try:
        t = yf.Ticker(ticker_symbol)
        info = None
        try:
            info = t.info
        except Exception:
            return None
            
        if not isinstance(info, dict) or not info:
            return None
            
        prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")
        if not prev_close:
            return None
            
        reg_price = info.get("regularMarketPrice") or info.get("currentPrice")
        premarket_price = info.get("preMarketPrice")
        
        if info.get("regularMarketChangePercent") is not None:
            reg_gain = float(info.get("regularMarketChangePercent"))
        else:
            reg_gain = ((reg_price - prev_close) / prev_close) * 100 if reg_price and prev_close else 0.0

        if info.get("preMarketChangePercent") is not None:
            pre_gain = float(info.get("preMarketChangePercent"))
        else:
            pre_gain = ((premarket_price - prev_close) / prev_close) * 100 if premarket_price and prev_close else 0.0

        if is_premarket and premarket_price:
            display_price = premarket_price
            active_gain = pre_gain
            session_gained = "Pre-Market"
        elif abs(pre_gain) >= 5.0 and (abs(reg_gain) < 5.0 or premarket_price == reg_price) and premarket_price:
            display_price = premarket_price
            active_gain = pre_gain
            session_gained = "Pre-Market"
        elif abs(pre_gain) >= 5.0 and abs(reg_gain) >= 5.0:
            display_price = reg_price if reg_price else premarket_price
            active_gain = reg_gain
            session_gained = "Pre & Open Market"
        else:
            display_price = reg_price if reg_price else (premarket_price or prev_close)
            active_gain = reg_gain
            session_gained = "Open Market"

        if not display_price:
            display_price = reg_price or premarket_price or prev_close

        volume = info.get("regularMarketVolume") or info.get("volume") or 0
        avg_vol_30d = info.get("averageVolume") or info.get("averageVolume10days") or info.get("averageDailyVolume3Month") or 1
        
        raw_rel_vol = (volume / avg_vol_30d) if avg_vol_30d > 0 else 0.0
        projected_vol = volume / elapsed_fraction if elapsed_fraction > 0 else volume
        projected_rel_vol = (projected_vol / avg_vol_30d) if avg_vol_30d > 0 else 0.0
        
        float_shares = info.get("floatShares")
        float_m = (float_shares / 1_000_000) if float_shares else None
        
        sector = info.get("sector") or "Unknown"
        country = info.get("country") or "Unknown"
        company_name = info.get("shortName") or info.get("longName") or ticker_symbol
        
        formatted_news = []
        try:
            raw_news = t.news or []
            for item in raw_news[:5]:
                c = item.get("content", {})
                if isinstance(c, dict):
                    title = c.get("title")
                    pub_date = c.get("pubDate")
                    provider = c.get("provider", {}).get("displayName") if isinstance(c.get("provider"), dict) else "Yahoo Finance"
                    click_url = c.get("clickThroughUrl", {}).get("url") if isinstance(c.get("clickThroughUrl"), dict) else None
                    canon_url = c.get("canonicalUrl", {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else None
                    article_url = click_url or canon_url or f"https://finance.yahoo.com/quote/{ticker_symbol}/news"
                    
                    if title:
                        formatted_news.append({
                            "id": item.get("id"),
                            "title": title,
                            "publisher": provider,
                            "pub_date": pub_date,
                            "url": article_url
                        })
        except Exception:
            pass
                    
        yahoo_overview_url = f"https://finance.yahoo.com/quote/{ticker_symbol}/news"
        
        return {
            "ticker": ticker_symbol,
            "company_name": company_name,
            "price": round(display_price, 2),
            "reg_price": round(reg_price, 2) if reg_price else None,
            "prev_close": round(prev_close, 2),
            "premarket_price": round(premarket_price, 2) if premarket_price else None,
            "reg_gain": round(reg_gain, 2),
            "pre_gain": round(pre_gain, 2),
            "active_gain": round(active_gain, 2),
            "session_gained": session_gained,
            "volume": volume,
            "avg_vol_30d": avg_vol_30d,
            "raw_rel_vol": round(raw_rel_vol, 2),
            "projected_rel_vol": round(projected_rel_vol, 2),
            "float_shares": float_shares,
            "float_m": round(float_m, 2) if float_m is not None else None,
            "sector": sector,
            "country": country,
            "yahoo_url": yahoo_overview_url,
            "news": formatted_news
        }
    except Exception:
        return None

@app.get("/api/status")
def get_status():
    return get_market_session_info()

@app.get("/api/screen")
def screen_stocks(
    min_price: float = Query(1.0, description="Minimum price"),
    max_price: float = Query(25.0, description="Maximum price"),
    min_rel_vol: float = Query(4.0, description="Minimum time-adjusted relative volume"),
    min_gain: float = Query(5.0, description="Minimum percentage gain (+/- magnitude)"),
    min_float: float = Query(5.0, description="Minimum float in millions"),
    max_float: float = Query(25.0, description="Maximum float in millions"),
    allow_unknown_float: bool = Query(True, description="Allow stocks with unknown float")
):
    start_time = time.time()
    session_info = get_market_session_info()
    elapsed_fraction = session_info["elapsed_fraction"]
    is_premarket = session_info["is_premarket"]
    
    try:
        tickers_universe = get_master_ticker_universe()
    except Exception:
        tickers_universe = FALLBACK_POPULAR_STOCKS

    if not tickers_universe:
        tickers_universe = FALLBACK_POPULAR_STOCKS
        
    scan_limit = min(60, len(tickers_universe))
    tickers_to_scan = tickers_universe[:scan_limit]

    results = []
    try:
        with ThreadPoolExecutor(max_workers=15) as executor:
            futures = {executor.submit(fetch_single_ticker_data, sym, elapsed_fraction, is_premarket): sym for sym in tickers_to_scan}
            for future in as_completed(futures):
                try:
                    res = future.result()
                    if res:
                        results.append(res)
                except Exception:
                    pass
    except Exception as e:
        print("Batch fetch exception:", e)
                
    filtered = []
    for item in results:
        try:
            if not (min_price <= item["price"] <= max_price):
                continue
                
            if abs(item["reg_gain"]) < min_gain and abs(item["pre_gain"]) < min_gain:
                continue
                
            if item["projected_rel_vol"] < min_rel_vol and item["raw_rel_vol"] < min_rel_vol:
                continue
                
            float_m = item["float_m"]
            if float_m is None:
                if not allow_unknown_float:
                    continue
            else:
                if not (min_float <= float_m <= max_float):
                    continue
                    
            filtered.append(item)
        except Exception:
            pass
        
    execution_time = round(time.time() - start_time, 2)
    
    return {
        "market_session": session_info,
        "total_universe_available": len(tickers_universe),
        "total_scanned": len(tickers_to_scan),
        "total_passed": len(filtered),
        "execution_time_seconds": execution_time,
        "stocks": filtered
    }
