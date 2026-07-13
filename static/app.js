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

        const url = `/api/screen?min_price=${minPrice}&max_price=${maxPrice}&min_rel_vol=${minRelVol}&min_gain=${minGain}&min_float=${minFloat}&max_float=${maxFloat}&allow_unknown_float=${allowUnknown}`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        rawData = data.stocks || [];
        
        updateMarketStatusUI(data.market_session);
        
        statScanned.textContent = data.total_scanned;
        statPassed.textContent = data.total_passed;
        statTime.textContent = data.execution_time_seconds + "s";
        
        populateDropdowns(rawData);
        applyFiltersAndRender();
        
    } catch (err) {
        console.error("Failed to fetch screener data:", err);
        screenedTbody.innerHTML = `<tr><td colspan="10" class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i> Error loading screener data. Backend server running?</td></tr>`;
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
        screenedTbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <i class="fa-solid fa-inbox fa-2x"></i>
                    <p style="margin-top:8px;">No ${currentTab === "watchlist" ? "watchlist items saved" : "stocks matching current criteria"}.</p>
                </td>
            </tr>`;
        return;
    }

    screenedTbody.innerHTML = stocks.map(item => {
        const isStarred = watchlist.includes(item.ticker);
        const floatDisplay = item.float_m !== null ? `${item.float_m}M` : `<span class="float-unknown">Unknown</span>`;
        const newsCount = item.news ? item.news.length : 0;

        return `
            <tr>
                <td class="col-star">
                    <button class="star-btn ${isStarred ? 'starred' : ''}" onclick="toggleWatchlist('${item.ticker}')">
                        <i class="${isStarred ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                    </button>
                </td>
                <td>
                    <div class="ticker-cell">
                        <a href="https://www.tradingview.com/chart/?symbol=${item.ticker}" target="_blank" rel="noopener noreferrer" class="ticker-link" title="Open full chart for ${item.ticker} on TradingView">
                            <span class="ticker-symbol">${item.ticker} <i class="fa-solid fa-arrow-up-right-from-square ticker-icon"></i></span>
                        </a>
                        <span class="company-name" title="${item.company_name}">${item.company_name}</span>
                    </div>
                </td>
                <td>
                    <span class="country-pill"><i class="fa-solid fa-location-dot"></i> ${item.country}</span>
                </td>
                <td>
                    <span class="sector-text">${item.sector}</span>
                </td>
                <td class="num-col">
                    <span class="price-text">$${item.price.toFixed(2)}</span>
                </td>
                <td class="num-col">
                    <div class="gain-badge-box">
                        <span class="gain-badge positive">
                            <i class="fa-solid fa-caret-up"></i> +${item.active_gain.toFixed(2)}%
                        </span>
                        <span class="gain-session-label">${item.session_gained}</span>
                    </div>
                </td>
                <td class="num-col">
                    <span class="relvol-pill">${item.projected_rel_vol.toFixed(2)}x</span>
                    <span class="raw-relvol">Raw: ${item.raw_rel_vol.toFixed(2)}x</span>
                </td>
                <td class="num-col">
                    <span style="font-weight:600;">${item.volume.toLocaleString()}</span>
                </td>
                <td class="num-col">
                    <span class="float-text">${floatDisplay}</span>
                </td>
                <td class="col-catalyst">
                    <button class="btn-catalyst" onclick="openNewsModal('${item.ticker}')">
                        <i class="fa-solid fa-newspaper"></i> Catalysts (${newsCount})
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function openNewsModal(tickerSymbol) {
    const item = rawData.find(s => s.ticker === tickerSymbol);
    if (!item) return;

    modalTickerSymbol.textContent = item.ticker;
    modalCompanyName.textContent = item.company_name;
    modalYahooLink.href = item.yahoo_url;

    if (!item.news || item.news.length === 0) {
        modalNewsContent.innerHTML = `<p class="empty-state">No recent news articles reported on Yahoo Finance.</p>`;
    } else {
        modalNewsContent.innerHTML = item.news.map(n => `
            <div class="news-item">
                <a href="${n.url}" target="_blank" class="news-title">${n.title}</a>
                <div class="news-meta">
                    <span><i class="fa-solid fa-building-newspaper"></i> ${n.publisher}</span>
                    <span>${n.pub_date ? new Date(n.pub_date).toLocaleString() : ''}</span>
                </div>
            </div>
        `).join("");
    }

    newsModal.classList.remove("hidden");
}

function exportToCSV() {
    let dataset = currentTab === "screened" ? rawData : rawData.filter(s => watchlist.includes(s.ticker));
    if (dataset.length === 0) return alert("No data to export!");

    const headers = ["Ticker", "Company", "Country", "Sector", "Price", "Session", "Active Gain %", "Projected Rel Vol", "Raw Rel Vol", "Volume", "Float (M)", "Yahoo Link"];
    
    const rows = dataset.map(s => [
        s.ticker,
        `"${s.company_name.replace(/"/g, '""')}"`,
        s.country,
        s.sector,
        s.price,
        s.session_gained,
        s.active_gain,
        s.projected_rel_vol,
        s.raw_rel_vol,
        s.volume,
        s.float_m !== null ? s.float_m : "Unknown",
        s.yahoo_url
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `momentum_pulse_${currentTab}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
