let rawData = [];
let watchlist = JSON.parse(localStorage.getItem("momentum_watchlist") || "[]");
let currentTab = "screened";
let autoRefreshActive = true;
let countdownInterval = null;
let secondsRemaining = 60;
let currentSortColumn = "active_gain";
let currentSortDirection = "desc";

const screenedTbody = document.getElementById("screener-tbody");
const marketStatusCard = document.getElementById("market-status-card");
const sessionNameEl = document.getElementById("session-name");
const estTimeEl = document.getElementById("est-time");
const statusDot = document.getElementById("status-dot");

const countdownCircle = document.getElementById("countdown-circle");
const countdownSec = document.getElementById("countdown-sec");
const toggleAutorefreshBtn = document.getElementById("toggle-autorefresh-btn");
const refreshIcon = document.getElementById("refresh-icon");
const scanNowBtn = document.getElementById("scan-now-btn");
const scanBtnIcon = document.getElementById("scan-btn-icon");

const tabScreened = document.getElementById("tab-screened");
const tabWatchlist = document.getElementById("tab-watchlist");
const screenedCountBadge = document.getElementById("screened-count");
const watchlistCountBadge = document.getElementById("watchlist-count");

const searchInput = document.getElementById("search-input");
const toggleFiltersBtn = document.getElementById("toggle-filters-btn");
const filterDrawer = document.getElementById("filter-drawer");

const minPriceInput = document.getElementById("min-price");
const maxPriceInput = document.getElementById("max-price");
const minRelvolRange = document.getElementById("min-relvol-range");
const minRelvolVal = document.getElementById("min-relvol-val");
const minGainRange = document.getElementById("min-gain-range");
const minGainVal = document.getElementById("min-gain-val");
const minFloatInput = document.getElementById("min-float");
const maxFloatInput = document.getElementById("max-float");
const allowUnknownFloatCheckbox = document.getElementById("allow-unknown-float");
const sectorFilter = document.getElementById("sector-filter");
const countryFilter = document.getElementById("country-filter");

const statScanned = document.getElementById("stat-scanned");
const statPassed = document.getElementById("stat-passed");
const statTime = document.getElementById("stat-time");
const exportCsvBtn = document.getElementById("export-csv-btn");

const newsModal = document.getElementById("news-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const modalTickerSymbol = document.getElementById("modal-ticker-symbol");
const modalCompanyName = document.getElementById("modal-company-name");
const modalNewsContent = document.getElementById("modal-news-content");
const modalYahooLink = document.getElementById("modal-yahoo-link");

document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    fetchData();
    startCountdown();
});

function setupEventListeners() {
    tabScreened.addEventListener("click", () => switchTab("screened"));
    tabWatchlist.addEventListener("click", () => switchTab("watchlist"));

    toggleFiltersBtn.addEventListener("click", () => {
        filterDrawer.classList.toggle("hidden");
    });

    minRelvolRange.addEventListener("input", (e) => {
        minRelvolVal.textContent = parseFloat(e.target.value).toFixed(1) + "x";
        applyFiltersAndRender();
    });

    minGainRange.addEventListener("input", (e) => {
        minGainVal.textContent = "+" + e.target.value + "%";
        applyFiltersAndRender();
    });

    [minPriceInput, maxPriceInput, minFloatInput, maxFloatInput, searchInput, sectorFilter, countryFilter].forEach(el => {
        el.addEventListener("input", applyFiltersAndRender);
        el.addEventListener("change", applyFiltersAndRender);
    });

    allowUnknownFloatCheckbox.addEventListener("change", applyFiltersAndRender);

    toggleAutorefreshBtn.addEventListener("click", toggleAutoRefresh);
    scanNowBtn.addEventListener("click", () => {
        resetCountdown();
        fetchData();
    });

    exportCsvBtn.addEventListener("click", exportToCSV);

    document.querySelectorAll(".data-table th.sortable").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (currentSortColumn === col) {
                currentSortDirection = currentSortDirection === "asc" ? "desc" : "asc";
            } else {
                currentSortColumn = col;
                currentSortDirection = "desc";
            }
            updateSortHeaderIcons();
            applyFiltersAndRender();
        });
    });

    closeModalBtn.addEventListener("click", () => newsModal.classList.add("hidden"));
    newsModal.addEventListener("click", (e) => {
        if (e.target === newsModal) newsModal.classList.add("hidden");
    });
}

function updateSortHeaderIcons() {
    document.querySelectorAll(".data-table th.sortable").forEach(th => {
        const col = th.dataset.sort;
        const icon = th.querySelector("i");
        if (col === currentSortColumn) {
            icon.className = currentSortDirection === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            th.style.color = "var(--accent-cyan)";
        } else {
            icon.className = "fa-solid fa-sort";
            th.style.color = "";
        }
    });
}

function startCountdown() {
    clearInterval(countdownInterval);
    const fullCircleOffset = 87.96;
    
    countdownInterval = setInterval(() => {
        if (!autoRefreshActive) return;
        
        secondsRemaining--;
        countdownSec.textContent = secondsRemaining;
        
        const offset = fullCircleOffset - (secondsRemaining / 60) * fullCircleOffset;
        countdownCircle.style.strokeDashoffset = offset;

        if (secondsRemaining <= 0) {
            resetCountdown();
            fetchData();
        }
    }, 1000);
}

function resetCountdown() {
    secondsRemaining = 60;
    countdownSec.textContent = "60";
    countdownCircle.style.strokeDashoffset = "0";
}

function toggleAutoRefresh() {
    autoRefreshActive = !autoRefreshActive;
    if (autoRefreshActive) {
        refreshIcon.className = "fa-solid fa-pause";
        toggleAutorefreshBtn.style.color = "var(--text-primary)";
    } else {
        refreshIcon.className = "fa-solid fa-play";
        toggleAutorefreshBtn.style.color = "var(--accent-amber)";
    }
}

async function fetchData() {
    scanBtnIcon.classList.add("fa-spin");
    
    try {
        const minPrice = minPriceInput.value || 1.0;
        const maxPrice = maxPriceInput.value || 25.0;
        const minRelVol = minRelvolRange.value || 4.0;
        const minGain = minGainRange.value || 5.0;
        const minFloat = minFloatInput.value || 5.0;
        const maxFloat = maxFloatInput.value || 25.0;
        const allowUnknown = allowUnknownFloatCheckbox.checked;

        const baseParams = `min_price=${minPrice}&max_price=${maxPrice}&min_rel_vol=${minRelVol}&min_gain=${minGain}&min_float=${minFloat}&max_float=${maxFloat}&allow_unknown_float=${allowUnknown}&limit=60`;

        let accumulatedStocks = [];
        let totalScannedSum = 0;
        const startTimeTotal = performance.now();

        const chunkOffsets = [0, 60, 120, 180, 240];
        
        // Fetch first chunk immediately to render initial state fast
        const res0 = await fetch(`/api/screen?${baseParams}&offset=0`);
        const data0 = await res0.json();
        
        updateMarketStatusUI(data0.market_session);
        
        accumulatedStocks = [...(data0.stocks || [])];
        totalScannedSum = data0.chunk_size || 60;
        
        rawData = [...accumulatedStocks];
        statScanned.textContent = totalScannedSum;
        statPassed.textContent = rawData.length;
        statTime.textContent = ((performance.now() - startTimeTotal) / 1000).toFixed(1) + "s";
        populateDropdowns(rawData);
        applyFiltersAndRender();

        // Fetch background chunks (scanning 300 tickers total per cycle)
        const backgroundPromises = chunkOffsets.slice(1).map(offset => 
            fetch(`/api/screen?${baseParams}&offset=${offset}`).then(r => r.json()).catch(() => null)
        );

        const backgroundResults = await Promise.all(backgroundPromises);
        backgroundResults.forEach(res => {
            if (res && res.stocks) {
                accumulatedStocks.push(...res.stocks);
                totalScannedSum += res.chunk_size || 60;
            }
        });

        const stockMap = new Map();
        accumulatedStocks.forEach(s => stockMap.set(s.ticker, s));
        rawData = Array.from(stockMap.values());

        statScanned.textContent = totalScannedSum;
        statPassed.textContent = rawData.length;
        statTime.textContent = ((performance.now() - startTimeTotal) / 1000).toFixed(1) + "s";
        populateDropdowns(rawData);
        applyFiltersAndRender();
        
    } catch (err) {
        console.error("Failed to fetch screener data:", err);
        if (rawData.length === 0) {
            screenedTbody.innerHTML = `<tr><td colspan="10" class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i> Error loading screener data. Server ready?</td></tr>`;
        }
    } finally {
        scanBtnIcon.classList.remove("fa-spin");
    }
}

function updateMarketStatusUI(sessionInfo) {
    if (!sessionInfo) return;
    
    sessionNameEl.textContent = sessionInfo.session_name;
    estTimeEl.textContent = sessionInfo.est_time;
    
    statusDot.className = "status-indicator-dot";
    if (sessionInfo.is_open) {
        statusDot.classList.add("live-green");
    } else if (sessionInfo.is_premarket) {
        statusDot.classList.add("live-amber");
    }
}

function populateDropdowns(stocks) {
    const currentSector = sectorFilter.value;
    const currentCountry = countryFilter.value;
    
    const sectors = new Set(["ALL"]);
    const countries = new Set(["ALL"]);
    
    stocks.forEach(s => {
        if (s.sector && s.sector !== "Unknown") sectors.add(s.sector);
        if (s.country && s.country !== "Unknown") countries.add(s.country);
    });

    sectorFilter.innerHTML = Array.from(sectors).map(sec => 
        `<option value="${sec}">${sec === "ALL" ? "All Sectors" : sec}</option>`
    ).join("");
    
    countryFilter.innerHTML = Array.from(countries).map(c => 
        `<option value="${c}">${c === "ALL" ? "All Countries" : c}</option>`
    ).join("");
    
    sectorFilter.value = sectors.has(currentSector) ? currentSector : "ALL";
    countryFilter.value = countries.has(currentCountry) ? currentCountry : "ALL";
}

function switchTab(tab) {
    currentTab = tab;
    if (tab === "screened") {
        tabScreened.classList.add("active");
        tabWatchlist.classList.remove("active");
    } else {
        tabWatchlist.classList.add("active");
        tabScreened.classList.remove("active");
    }
    applyFiltersAndRender();
}

function toggleWatchlist(ticker) {
    if (watchlist.includes(ticker)) {
        watchlist = watchlist.filter(t => t !== ticker);
    } else {
        watchlist.push(ticker);
    }
    localStorage.setItem("momentum_watchlist", JSON.stringify(watchlist));
    watchlistCountBadge.textContent = watchlist.length;
    applyFiltersAndRender();
}

function applyFiltersAndRender() {
    let dataset = currentTab === "screened" ? rawData : rawData.filter(s => watchlist.includes(s.ticker));
    
    const query = searchInput.value.trim().toLowerCase();
    if (query) {
        dataset = dataset.filter(s => 
            s.ticker.toLowerCase().includes(query) ||
            (s.company_name && s.company_name.toLowerCase().includes(query)) ||
            (s.sector && s.sector.toLowerCase().includes(query)) ||
            (s.country && s.country.toLowerCase().includes(query))
        );
    }

    const selSector = sectorFilter.value;
    if (selSector !== "ALL") {
        dataset = dataset.filter(s => s.sector === selSector);
    }

    const selCountry = countryFilter.value;
    if (selCountry !== "ALL") {
        dataset = dataset.filter(s => s.country === selCountry);
    }

    screenedCountBadge.textContent = rawData.length;
    watchlistCountBadge.textContent = watchlist.length;

    dataset.sort((a, b) => {
        let valA = a[currentSortColumn];
        let valB = b[currentSortColumn];

        if (valA === null || valA === undefined) valA = -999999;
        if (valB === null || valB === undefined) valB = -999999;

        if (typeof valA === "string") {
            return currentSortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return currentSortDirection === "asc" ? valA - valB : valB - valA;
    });

    renderTable(dataset);
}

function renderTable(stocks) {
    if (stocks.length === 0) {
        screenedTbody.innerHTML = `<tr><td colspan="10" class="empty-state"><i class="fa-solid fa-folder-open"></i> No stocks matching current criteria.</td></tr>`;
        return;
    }

    screenedTbody.innerHTML = stocks.map(stock => {
        const isWatchlisted = watchlist.includes(stock.ticker);
        const starClass = isWatchlisted ? "fa-solid fa-star active-star" : "fa-regular fa-star";
        
        const floatDisplay = stock.float_m !== null ? `${stock.float_m}M` : '<span class="unknown-badge">N/A</span>';
        
        let sessionBadge = "";
        if (stock.session_gained === "Pre-Market") {
            sessionBadge = '<span class="session-badge pre">Pre-Market</span>';
        } else if (stock.session_gained === "Pre & Open Market") {
            sessionBadge = '<span class="session-badge combined">Pre & Open</span>';
        } else {
            sessionBadge = '<span class="session-badge open">Open Market</span>';
        }

        const isPositiveGain = stock.active_gain >= 0;
        const gainBadgeClass = isPositiveGain ? "gain-badge positive" : "gain-badge negative";
        const gainSign = isPositiveGain ? "+" : "";
        const gainCaret = isPositiveGain ? "fa-caret-up" : "fa-caret-down";
        
        let preBreakdownHtml = "";
        if (stock.pre_gain !== undefined && stock.pre_gain !== null && stock.session_gained !== "Pre-Market") {
            const isPrePos = stock.pre_gain >= 0;
            const preColorClass = isPrePos ? "pos-text" : "neg-text";
            const preSign = isPrePos ? "+" : "";
            preBreakdownHtml = `<div class="sub-line ${preColorClass}">Pre: ${preSign}${stock.pre_gain.toFixed(2)}%</div>`;
        }

        const newsBtn = `<button class="catalyst-btn" onclick="openNewsModal('${stock.ticker}')"><i class="fa-solid fa-newspaper"></i> News</button>`;

        return `
            <tr>
                <td style="text-align: center;">
                    <i class="${starClass}" style="cursor: pointer;" onclick="toggleWatchlist('${stock.ticker}')"></i>
                </td>
                <td>
                    <div class="ticker-symbol-cell">
                        <a href="https://www.tradingview.com/chart/?symbol=${stock.ticker}" target="_blank" class="tradingview-link" title="Open ${stock.ticker} Interactive Chart in TradingView">
                            <span class="ticker-text">${stock.ticker}</span>
                            <i class="fa-solid fa-chart-line tv-icon"></i>
                        </a>
                        <span class="company-subname">${stock.company_name}</span>
                    </div>
                </td>
                <td>${stock.country}</td>
                <td><span class="sector-pill">${stock.sector}</span></td>
                <td><span class="price-val">$${stock.price.toFixed(2)}</span></td>
                <td>
                    <div class="${gainBadgeClass}">
                        <i class="fa-solid ${gainCaret}"></i> ${gainSign}${stock.active_gain.toFixed(2)}%
                    </div>
                    ${preBreakdownHtml}
                    ${sessionBadge}
                </td>
                <td>
                    <span class="rel-vol-badge">${stock.projected_rel_vol.toFixed(1)}x</span>
                    <div class="sub-line">Raw: ${stock.raw_rel_vol.toFixed(1)}x</div>
                </td>
                <td>${formatNumber(stock.volume)}</td>
                <td>${floatDisplay}</td>
                <td>${newsBtn}</td>
            </tr>
        `;
    }).join("");
}

async function openNewsModal(tickerSymbol) {
    modalTickerSymbol.textContent = tickerSymbol;
    modalCompanyName.textContent = "Loading catalyst news...";
    modalYahooLink.href = `https://finance.yahoo.com/quote/${tickerSymbol}/news`;
    modalNewsContent.innerHTML = `
        <div class="spinner-box" style="padding: 20px;">
            <div class="pulse-spinner"></div>
            <p style="margin-top: 10px; color: var(--text-secondary); font-size: 13px;">Fetching latest news articles...</p>
        </div>
    `;
    newsModal.classList.remove("hidden");

    try {
        const res = await fetch(`/api/news?ticker=${tickerSymbol}`);
        const data = await res.json();
        
        const stock = rawData.find(s => s.ticker === tickerSymbol);
        if (stock) {
            modalCompanyName.textContent = stock.company_name || tickerSymbol;
        } else {
            modalCompanyName.textContent = tickerSymbol;
        }

        if (!data.news || data.news.length === 0) {
            modalNewsContent.innerHTML = `<div class="empty-state">No recent articles found.</div>`;
        } else {
            modalNewsContent.innerHTML = data.news.map(n => `
                <div class="news-card">
                    <a href="${n.url}" target="_blank" class="news-card-title">${n.title}</a>
                    <div class="news-card-meta">
                        <span><i class="fa-regular fa-building"></i> ${n.publisher}</span>
                        <span><i class="fa-regular fa-clock"></i> ${n.pub_date ? new Date(n.pub_date).toLocaleString() : 'Recent'}</span>
                    </div>
                </div>
            `).join("");
        }
    } catch (err) {
        console.error("Failed to fetch news:", err);
        modalNewsContent.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i> Error loading news articles.</div>`;
    }
}

function formatNumber(num) {
    if (!num) return "0";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toLocaleString();
}

function exportToCSV() {
    let dataset = currentTab === "screened" ? rawData : rawData.filter(s => watchlist.includes(s.ticker));
    if (dataset.length === 0) {
        alert("No stocks available to export.");
        return;
    }

    const headers = ["Ticker", "Company Name", "Country", "Sector", "Price ($)", "Active Gain (%)", "Pre Gain (%)", "Reg Gain (%)", "Rel Vol (Projected)", "Rel Vol (Raw)", "Volume", "Float (M)"];
    
    const rows = dataset.map(s => [
        `"${s.ticker}"`,
        `"${(s.company_name || "").replace(/"/g, '""')}"`,
        `"${s.country}"`,
        `"${s.sector}"`,
        s.price,
        s.active_gain,
        s.pre_gain,
        s.reg_gain,
        s.projected_rel_vol,
        s.raw_rel_vol,
        s.volume,
        s.float_m !== null ? s.float_m : "N/A"
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `MomentumPulse_Stocks_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
