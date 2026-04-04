/**
 * home.js - Logic for the Multi-Portfolio Landing Page
 */

let _overviewData = null;
let _topPerformersData = [];
let _underPerformersData = [];
let _homeActivityData = null;
let _homeDividendData = null;
let _sp500Data = [];          // S&P 500 heatmap full dataset
let _mktChartData = null;  // market-indicators API data
let _mktActiveRange = '3M'; // 1W | 1M | 3M | 1Y
let _nasdaqActiveRange = '3M';
let _portfolioVsData = null; // [{date, ts, value}] from /api/pcombined/daily-history
let _pvsActiveRange = '1Y';  // 1M | 3M | 6M | 1Y | ALL
let _ddActiveRange = '1Y';   // drawdown chart range
let _pvsChartType = 'line';  // line | bar

/* ── Shared chart empty-state helpers ──────────────────────────────────────
 * Pass the canvas element; the overlay is injected into canvas.parentElement.
 * Works for any chart whose wrap already has position:relative.
 * ─────────────────────────────────────────────────────────────────────── */
function _showChartEmpty(canvas, msg = 'No data for this period') {
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;
    canvas.style.opacity = '0';
    let el = wrap.querySelector('.chart-empty-state');
    if (!el) {
        el = document.createElement('div');
        el.className = 'chart-empty-state';
        el.innerHTML =
            '<div class="chart-empty-bars">' +
            '<div class="chart-empty-bar"></div>'.repeat(7) +
            '</div>' +
            '<span class="chart-empty-text"></span>';
        wrap.appendChild(el);
    }
    el.querySelector('.chart-empty-text').textContent = msg;
    requestAnimationFrame(() => el.classList.add('visible'));
}

function _hideChartEmpty(canvas) {
    if (!canvas) return;
    canvas.style.opacity = '';
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const el = wrap.querySelector('.chart-empty-state');
    if (el) el.classList.remove('visible');
}

/* ── Shared element loading helper (non-canvas containers) ─────────────────
 * Replaces the element's content with the standard bar-chart animation.
 * Call _hideElemLoading(el) to clear it before injecting real content.
 * ─────────────────────────────────────────────────────────────────────── */
function _showElemLoading(el, msg = 'Loading…') {
    if (!el) return;
    el.innerHTML =
        '<div class="elem-loading-state">' +
        '<div class="chart-empty-bars">' +
        '<div class="chart-empty-bar"></div>'.repeat(7) +
        '</div>' +
        '<span class="chart-empty-text">' + msg + '</span>' +
        '</div>';
}
function _hideElemLoading(el) {
    if (!el) return;
    const existing = el.querySelector('.elem-loading-state');
    if (existing) existing.remove();
}

let _pvsShowSP = true;
let _pvsShowPvs = true;
let _signalsData = {};        // cache per signal type
let _insiderData = {};
let _tradeSignalsData = null;

async function loadOverview(refresh = false) {
    try {
        const url = refresh ? '/api/overview?refresh=1' : '/api/overview';
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.status === 'ok') {
            _overviewData = data.data;
            renderOverview(_overviewData);

            // Populate footer
            const ts = new Date().toLocaleTimeString('en-GB');
            const lastUpdated = document.getElementById('lastUpdated');
            if (lastUpdated) lastUpdated.textContent = ts;

            const freshEl = document.getElementById('freshnessInfo');
            if (freshEl && data.metadata && data.metadata.freshness) {
                const f = data.metadata.freshness;
                const dot = (age, threshold) =>
                    `<span class="${(age ?? 9999) < threshold ? 'fresh-live' : 'fresh-stale'}">${fmtAge(age)}</span>`;
                freshEl.innerHTML =
                    `Prices: ${dot(f.prices, 120)} <span class="footer-sep">·</span> ` +
                    `Dividends: ${dot(f.dividends, 1800)} <span class="footer-sep">·</span> ` +
                    `FX Rate: ${dot(f.fx, 300)}`;
                freshEl.style.display = '';
            }

            const cacheEl = document.getElementById('cacheBanner');
            if (cacheEl) {
                if (!refresh) {
                    const age = data.metadata?.freshness?.prices;
                    const ageStr = age != null ? fmtAge(age) : '—';
                    cacheEl.innerHTML = `<span class="cb-dot"></span>Cached &middot; fetched ${ageStr} &middot; <span class="cb-refresh" onclick="loadOverview(true)">click Refresh for live</span>`;
                    cacheEl.style.display = '';
                } else {
                    cacheEl.style.display = 'none';
                }
            }
        }
    } catch (e) {
        console.error("Failed to load overview:", e);
    }
}


/* ─── Combined home-data loader (1 request instead of 5 on page load) ──────── */
async function loadHomeData(refresh = false) {
    try {
        const url = refresh ? '/api/home-data?refresh=1' : '/api/home-data';
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.status !== 'ok') return;

        // FX rate
        if (data.fx_rate && typeof setRate === 'function') setRate(data.fx_rate);

        // Overview cards
        _overviewData = data.overview;
        renderOverview(_overviewData);

        // Footer freshness
        const meta = data.overview_metadata;
        const lastUpdated = document.getElementById('lastUpdated');
        if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString('en-GB');

        if (meta) {
            const freshEl = document.getElementById('freshnessInfo');
            if (freshEl && meta.freshness) {
                const f = meta.freshness;
                const dot = (age, threshold) =>
                    `<span class="${(age ?? 9999) < threshold ? 'fresh-live' : 'fresh-stale'}">${fmtAge(age)}</span>`;
                freshEl.innerHTML =
                    `Prices: ${dot(f.prices, 120)} <span class="footer-sep">·</span> ` +
                    `Dividends: ${dot(f.dividends, 1800)} <span class="footer-sep">·</span> ` +
                    `FX Rate: ${dot(f.fx, 300)}`;
                freshEl.style.display = '';
            }
            const cacheEl = document.getElementById('cacheBanner');
            if (cacheEl) {
                if (!refresh) {
                    const age = meta.freshness?.prices;
                    const ageStr = age != null ? fmtAge(age) : '—';
                    cacheEl.innerHTML = `<span class="cb-dot"></span>Cached &middot; fetched ${ageStr} &middot; <span class="cb-refresh" onclick="loadHomeData(true)">click Refresh for live</span>`;
                    cacheEl.style.display = '';
                } else {
                    cacheEl.style.display = 'none';
                }
            }
        }

        // Market indicators (stored for F&G detail panel)
        if (data.market_indicators) {
            _marketIndData = data.market_indicators;
            if (document.getElementById('fgPanel')?.classList.contains('open')) {
                _renderFGPanelContent(_marketIndData);
            }
        }

        // Home performers
        _topPerformersData = data.top_performers || [];
        _underPerformersData = data.under_performers || [];
        _renderHomeTopUnder(_topPerformersData, _underPerformersData);

        // Market status is client-side time-based — no server data needed

        // Load independent AI Trade Signals
        setTimeout(() => {
            if (typeof loadTradeSignals === 'function') loadTradeSignals();
            if (typeof loadAnalystRatings === 'function') loadAnalystRatings();
            if (typeof loadMarketDigest === 'function') loadMarketDigest();
        }, 300);

        // Upcoming events (earnings + dividends in next 7 days)
        loadUpcomingEvents();

        if (refresh) showRefreshSuccess();

    } catch (e) {
        console.error('Failed to load home data:', e);
    }
}

function _renderHomeTopUnder(top, under) {
    const el = document.getElementById('homeContributors');
    if (!el) return;

    const all = [...top, ...under];
    if (!all.length) { el.innerHTML = '<div class="activity-empty">No data.</div>'; return; }

    const maxAbs = Math.max(...all.map(r => Math.abs(r.total_returns ?? 0)), 1);

    function renderRow(r) {
        const abs = r.total_returns ?? 0;
        const pct = r.returns_pct ?? 0;
        const isPos = abs >= 0;
        const cls = isPos ? 'pos' : 'neg';
        const sign = isPos ? '+' : '';
        const barPct = Math.round(Math.abs(abs) / maxAbs * 100);
        const ticker = esc((r.ticker || '—').slice(0, 7));
        const absVal = fmt.currency(Math.abs(abs));
        const valStr = `${absVal}`;
        const pctStr = `${sign}${pct.toFixed(1)}%`;

        const infoHtml = `<span class="cdiv-ticker">${ticker}</span>`
            + `<span class="cdiv-val ${cls}">${valStr}</span>`
            + `<span class="cdiv-pct">(${pctStr})</span>`;
        const barHtml = `<div class="cdiv-fill ${cls}" style="width:${barPct}%"></div>`;

        if (isPos) {
            return `<div class="cdiv-row pos">
                <div class="cdiv-half cdiv-left">${infoHtml}</div>
                <div class="cdiv-half cdiv-right">${barHtml}</div>
            </div>`;
        } else {
            return `<div class="cdiv-row neg">
                <div class="cdiv-half cdiv-left">${barHtml}</div>
                <div class="cdiv-half cdiv-right">${infoHtml}</div>
            </div>`;
        }
    }

    el.innerHTML = top.map(renderRow).join('') + under.map(renderRow).join('');
}

function renderOverview(data) {
    if (data["1"]) updateCard('p1', data["1"]);

    if (data["2"]) {
        const p2Body = document.getElementById('p2-body');
        if (p2Body) { p2Body.style.filter = 'none'; p2Body.style.opacity = '1'; }
        const p2Mini = document.getElementById('p2-mini');
        if (p2Mini) p2Mini.style.opacity = '1';
        updateCard('p2', data["2"]);
    } else {
        const p2Val = document.getElementById('p2-value');
        if (p2Val) p2Val.innerText = "Not Configured";
    }

    if (data["combined"]) updateCard('c', data["combined"]);
}

function updateCard(prefix, stats) {
    const valEl = document.getElementById(`${prefix}-value`);
    const retEl = document.getElementById(`${prefix}-returns`);
    const pctEl = document.getElementById(`${prefix}-pct`);

    if (valEl) valEl.innerText = fmt.currency(stats.value);

    if (retEl) {
        const sign = stats.returns >= 0 ? '+' : '';
        retEl.innerText = `${sign}${fmt.currency(stats.returns)}`;
        retEl.className = `ov-returns ${stats.returns >= 0 ? 'pos' : 'neg'}`;
    }

    if (pctEl) pctEl.innerText = `(${stats.returns_pct.toFixed(2)}%)`;

    // Mini stats row
    const invEl = document.getElementById(`${prefix}-invested`);
    const posEl = document.getElementById(`${prefix}-positions`);

    if (invEl && stats.invested != null)
        invEl.textContent = fmt.currency(stats.invested);


    if (posEl && stats.positions != null) {
        const sector = stats.top_sector ? ` · ${stats.top_sector}` : '';
        posEl.textContent = `${stats.positions} positions${sector}`;
    }
}



/* ─── Re-render home page monetary values when currency toggles ──────────── */
function onHomeCurrencyChange() {
    // Overview cards (value, returns, invested, PAI)
    if (_overviewData) renderOverview(_overviewData);

    // Contributors to Returns chart
    if (_topPerformersData.length || _underPerformersData.length) {
        _renderHomeTopUnder(_topPerformersData, _underPerformersData);
    }

    // 24h change labels on sparkline cards
    const sparkConfigs = [
        { canvasId: 'p1-spark', elId: 'p1-24h' },
        { canvasId: 'p2-spark', elId: 'p2-24h' },
        { canvasId: 'pc-spark', elId: 'c-24h' },
    ];
    for (const { canvasId, elId } of sparkConfigs) {
        const d = _sparkData[canvasId];
        if (d && d.points) _render24hChange(elId, d.points);
    }
}

function _updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (!icon) return;
    // Material Symbols: show dark_mode in light theme (click to go dark), light_mode in dark theme
    icon.textContent = theme === 'light' ? 'dark_mode' : 'light_mode';
}

function fmtAge(s) {
    if (s == null || s < 0) return '—';
    if (s < 60) return `${Math.floor(s)}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Returns an <img> tag for a stock logo.
 * Tries FMP first (good US coverage), falls back to EODHD LSE (UK stocks),
 * then hides on second failure.
 */
function _logoImg(ticker, cssClass) {
    const t = encodeURIComponent(ticker);
    const fmp  = `https://financialmodelingprep.com/image-stock/${t}.png`;
    const lse  = `https://eodhd.com/img/logos/LSE/${t}.png`;
    return `<img class="${cssClass}" src="${fmp}" alt="${esc(ticker)}" loading="lazy" ` +
        `onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${lse}';}else{this.style.display='none';}">`;
}

/* ─── Refresh Countdown Clocks ───────────────────────────────────────────── */

const _clocks = {};

function _initClock(el) {
    const totalSecs = parseInt(el.dataset.refreshSecs, 10);
    const showMins = totalSecs >= 120;
    const R = 8, CX = 10, CY = 10;
    const circ = +(2 * Math.PI * R).toFixed(3);
    const accentMap = { 'rc-heatmap': '#06b6d4', 'rc-fg': '#8b5cf6', 'rc-news': '#f59e0b' };
    const accent = accentMap[el.id] || '#94a3b8';

    el.innerHTML =
        `<svg class="rc-svg" viewBox="0 0 20 20" width="20" height="20">` +
        `<circle class="rc-track" cx="${CX}" cy="${CY}" r="${R}"/>` +
        `<circle class="rc-arc"   cx="${CX}" cy="${CY}" r="${R}"` +
        ` stroke-dasharray="${circ}" stroke-dashoffset="0"` +
        ` transform="rotate(-90 ${CX} ${CY})"/>` +
        `<text class="rc-text" x="${CX}" y="${CY}" dy="0.35em"` +
        ` fill="${accent}" stroke="none"></text>` +
        `</svg>`;

    const arc = el.querySelector('.rc-arc');
    const text = el.querySelector('.rc-text');
    let remaining = totalSecs;

    function _label() {
        return showMins ? Math.ceil(remaining / 60) : remaining;
    }

    function tick() {
        remaining = Math.max(0, remaining - 1);
        if (remaining <= 0) remaining = totalSecs;
        arc.style.strokeDashoffset = (circ * (1 - remaining / totalSecs)).toFixed(3);
        if (text) text.textContent = _label();
    }

    arc.style.strokeDashoffset = '0';
    if (text) text.textContent = _label();
    const timer = setInterval(tick, 1000);

    return {
        reset() {
            remaining = totalSecs;
            arc.style.strokeDashoffset = '0';
            if (text) text.textContent = _label();
        },
        destroy() { clearInterval(timer); }
    };
}

function initRefreshClocks() {
    document.querySelectorAll('.refresh-clock[data-refresh-secs]').forEach(el => {
        _clocks[el.id] = _initClock(el);
    });
}

function resetClock(id) {
    if (_clocks[id]) _clocks[id].reset();
}

// ── SPA lifecycle hooks (called by router.js) ────────────────────────────────
// router.js calls these instead of running its own DOMContentLoaded auto-init.
// This file intentionally has NO DOMContentLoaded block of its own.

/* ─── Live Ticker Data (shared with Portfolio Heatmap) ───────────────────── */

let _tickerData = null;
let _tickerDataMap = {};
let _tickerRetryTimer = null;

async function loadStockTicker() {
    try {
        const res = await fetch('/api/stock-tickers');
        const json = await res.json();
        if (json.status === 'ok' && json.data.length > 0) {
            _tickerData = json.data;
            _tickerDataMap = {};
            for (const d of _tickerData) _tickerDataMap[d.ticker] = d;
            _renderHeatmap(_tickerData);
            resetClock('rc-heatmap');
            if (_tickerRetryTimer) { clearTimeout(_tickerRetryTimer); _tickerRetryTimer = null; }
        } else if (!_tickerData) {
            // Portfolio cache may still be warming up — retry in 5 s
            if (!_tickerRetryTimer) {
                _tickerRetryTimer = setTimeout(() => { _tickerRetryTimer = null; loadStockTicker(); }, 5000);
            }
        }
    } catch (err) {
        console.warn('[stockTicker]', err);
    }
}

/* ─── Portfolio Heatmap ──────────────────────────────────────────────────── */

function _heatColor(pct) {
    const v = pct ?? 0;
    // Thresholds tuned for daily % change (vs total-return in Position Heatmap)
    if (Math.abs(v) < 0.05) return 'linear-gradient(135deg,#1e293b,#334155)';
    if (v >= 3) return 'linear-gradient(135deg,#052e16,#15803d)';
    if (v >= 1.5) return 'linear-gradient(135deg,#14532d,#16a34a)';
    if (v >= 0.5) return 'linear-gradient(135deg,#166534,#22c55e)';
    if (v > 0) return 'linear-gradient(135deg,#0f766e,#14b8a6)';
    if (v >= -0.5) return 'linear-gradient(135deg,#78350f,#b45309)';
    if (v >= -1.5) return 'linear-gradient(135deg,#7f1d1d,#dc2626)';
    return 'linear-gradient(135deg,#450a0a,#b91c1c)';
}

function _computeTreemap(items, W, H) {
    if (!items.length || W < 1 || H < 1) return [];
    const totalVal = items.reduce((s, d) => s + (d.value || 0), 0);
    if (!totalVal) return [];
    const area = W * H;
    const scaled = items
        .filter(d => (d.value || 0) > 0)
        .sort((a, b) => b.value - a.value)
        .map(d => ({ ...d, _a: (d.value / totalVal) * area }));

    const rects = [];

    function worst(row, side) {
        if (!row.length) return Infinity;
        const rA = row.reduce((s, i) => s + i._a, 0);
        const rL = rA / side;
        return row.reduce((mx, i) => {
            const l = i._a / rL;
            return Math.max(mx, rL / l, l / rL);
        }, 0);
    }

    function placeRow(row, x, y, w, h) {
        const rA = row.reduce((s, i) => s + i._a, 0);
        const isH = w >= h;
        const rL = isH ? rA / h : rA / w;
        let pos = isH ? y : x;
        for (const item of row) {
            const len = item._a / rL;
            rects.push(isH
                ? { item, x, y: pos, w: rL, h: len }
                : { item, x: pos, y, w: len, h: rL });
            pos += len;
        }
        return rL;
    }

    function layout(items, x, y, w, h) {
        if (!items.length) return;
        const side = Math.min(w, h);
        let row = [];
        for (let i = 0; i < items.length; i++) {
            const next = [...row, items[i]];
            if (!row.length || worst(next, side) <= worst(row, side)) {
                row = next;
            } else {
                const dim = placeRow(row, x, y, w, h);
                if (w >= h) layout(items.slice(i), x + dim, y, w - dim, h);
                else layout(items.slice(i), x, y + dim, w, h - dim);
                return;
            }
        }
        placeRow(row, x, y, w, h);
    }

    layout(scaled, 0, 0, W, H);
    return rects;
}

function _renderHeatmap(items) {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;
    const valid = items.filter(d => d.price != null);
    if (!valid.length) return;

    // Defer until layout is painted so offsetWidth/Height are non-zero
    if (!container.offsetWidth || !container.offsetHeight) {
        requestAnimationFrame(() => _renderHeatmap(items));
        return;
    }

    const CW = container.offsetWidth;
    const CH = container.offsetHeight;
    const GAP = 3;

    // Group by sector, sized by portfolio holding value (fallback to 1 if missing)
    const sectorMap = {};
    for (const d of valid) {
        const sec = d.sector || 'Other';
        const val = d.current_value > 0 ? d.current_value : 1;
        if (!sectorMap[sec]) sectorMap[sec] = { name: sec, value: 0, items: [] };
        sectorMap[sec].value += val;
        sectorMap[sec].items.push({ ...d, value: val });
    }
    const sectors = Object.values(sectorMap);

    const secRects = _computeTreemap(sectors, CW, CH);

    const html = [];
    for (const sr of secRects) {
        const { item: sec, x: sx, y: sy, w: sw, h: sh } = sr;
        const ix = Math.round(sx + GAP);
        const iy = Math.round(sy + GAP);
        const iw = Math.max(0, Math.round(sw - GAP * 2));
        const ih = Math.max(0, Math.round(sh - GAP * 2));
        if (iw < 8 || ih < 8) continue;

        const LABEL_H = ih >= 32 ? 14 : 0;

        html.push(`<div class="hm-sector-bg" style="left:${ix}px;top:${iy}px;width:${iw}px;height:${ih}px"></div>`);
        if (LABEL_H) {
            html.push(`<div class="hm-sector-label" style="left:${ix + 2}px;top:${iy + 1}px;width:${iw - 4}px;height:${LABEL_H}px">${esc(sec.name)}</div>`);
        }

        const stockH = ih - LABEL_H;
        if (stockH < 8) continue;

        const cellRects = _computeTreemap(sec.items, iw, stockH);
        for (const cr of cellRects) {
            const { item: d, x: cx, y: cy, w: cw, h: ch } = cr;
            const celX = ix + Math.round(cx) + 1;
            const celY = iy + LABEL_H + Math.round(cy) + 1;
            const celW = Math.max(0, Math.round(cw) - 2);
            const celH = Math.max(0, Math.round(ch) - 2);
            if (celW < 4 || celH < 4) continue;

            const pct = d.change_pct ?? 0;
            const bg = _heatColor(pct);
            const sign = pct > 0 ? '+' : '';
            const pctStr = `${sign}${pct.toFixed(2)}%`;

            // Extended-hours badge: PRE / POST (only for US equities)
            const ms = d.market_state || 'REGULAR';
            const extBadge = ms === 'PRE' ? 'PRE'
                           : (ms === 'POST' || ms === 'POSTPOST') ? 'POST'
                           : '';

            // Format price with currency symbol
            const cMap = { USD: '$', GBP: '£', GBP2: '£', GBp: 'p', GBX: 'p', EUR: '€', CAD: 'CA$', AUD: 'A$', JPY: '¥', CHF: 'Fr' };
            const cur = d.currency || 'USD';
            const cSym = cMap[cur] || '';
            const priceStr = d.price != null
                ? (cur === 'GBp' || cur === 'GBX' ? `p${d.price.toFixed(2)}` : `${cSym}${d.price.toFixed(2)}`)
                : '';
            const extLabel = extBadge ? ` (${extBadge})` : '';
            const title = `${d.company_name}\n${d.ticker}  ${priceStr}  ${pctStr}${extLabel}`;

            const badgeHtml = extBadge
                ? `<span class="hm-ext-badge hm-ext-${extBadge.toLowerCase()}">${extBadge}</span>`
                : '';

            const minDim = Math.min(celW, celH);
            let content = '';
            if (minDim >= 50 && celH >= 62) {
                // Large: ticker + price + pct + optional badge
                content = `<span class="hm-t hm-tl">${esc(d.ticker)}</span>`
                    + `<span class="hm-price hm-pricem">${priceStr}</span>`
                    + `<span class="hm-p hm-pm">${pctStr}</span>`
                    + badgeHtml;
            } else if (minDim >= 50) {
                content = `<span class="hm-t hm-tl">${esc(d.ticker)}</span><span class="hm-p hm-pm">${pctStr}</span>${badgeHtml}`;
            } else if (minDim >= 30 && celH >= 48) {
                content = `<span class="hm-t hm-tm">${esc(d.ticker)}</span>`
                    + `<span class="hm-price hm-prices">${priceStr}</span>`
                    + `<span class="hm-p hm-ps">${pctStr}</span>`
                    + badgeHtml;
            } else if (minDim >= 30) {
                content = `<span class="hm-t hm-tm">${esc(d.ticker)}</span><span class="hm-p hm-ps">${pctStr}</span>${badgeHtml}`;
            } else if (minDim >= 18) {
                content = `<span class="hm-t hm-ts">${esc(d.ticker)}</span>`;
            } else if (celW >= 12 && celH >= 8) {
                content = `<span class="hm-t hm-tx">${esc(d.ticker)}</span>`;
            }

            html.push(
                `<div class="hm-cell" data-ticker="${esc(d.ticker)}" title="${title}" ` +
                `style="left:${celX}px;top:${celY}px;width:${celW}px;height:${celH}px;background:${bg};cursor:pointer">` +
                content + `</div>`
            );
        }
    }
    container.innerHTML = html.join('');

    // Update session label in the heatmap header
    const sessionLabel = document.getElementById('heatmapSessionLabel');
    if (sessionLabel) {
        const states = valid.map(d => d.market_state || 'REGULAR');
        const hasPost = states.some(s => s === 'POST' || s === 'POSTPOST');
        const hasPre  = states.some(s => s === 'PRE');
        sessionLabel.textContent = hasPre  ? 'Pre-market change'
                                 : hasPost ? 'After-hours change'
                                 :           "Today's change";
    }

    // Randomise each cell's phase within the 10s cycle so they pulse out of sync
    container.querySelectorAll('.hm-cell').forEach(cell => {
        const delay = (-Math.random() * 10).toFixed(2); // random start point in -10..0s
        cell.style.setProperty('--hm-delay', `${delay}s`);
    });

    // Scan-line sweep to signal fresh data
    container.classList.remove('hm-scanning');
    void container.offsetWidth; // force reflow so animation restarts cleanly
    container.classList.add('hm-scanning');
    setTimeout(() => container.classList.remove('hm-scanning'), 900);

    if (!container._hmClickBound) {
        container._hmClickBound = true;
        container.addEventListener('click', _onHeatmapCellClick);
    }
}

function _onHeatmapCellClick(e) {
    const cell = e.target.closest('.hm-cell');
    if (!cell) return;
    const ticker = cell.dataset.ticker;
    if (!ticker || !_tickerDataMap[ticker]) return;
    const d = _tickerDataMap[ticker];
    if (typeof window.openStockPanel !== 'function') return;
    window.PORTFOLIO_ID = window.PORTFOLIO_ID || 'combined';
    window.openStockPanel({
        ...d,
        native_price: d.price,
        native_currency: d.currency,
        total_returns: d.total_returns ?? 0,
        returns_pct: d.returns_pct ?? 0,
        quantity: d.quantity ?? 0,
        avg_price: d.avg_price ?? 0,
    });
}

/* ─── Sparkline charts ───────────────────────────────────────────────────── */
const SPARK_COLORS = {
    '1': { line: '#3b82f6', fill: 'rgba(59,130,246,0.18)' },
    '2': { line: '#8b5cf6', fill: 'rgba(139,92,246,0.18)' },
    'combined': { line: '#14b8a6', fill: 'rgba(20,184,166,0.18)' },
};

// Cached sparkline data so theme changes can redraw without re-fetching
const _sparkData = {};

async function loadSparklines() {
    const configs = [
        { pid: '1', canvasId: 'p1-spark', elId: 'p1-24h' },
        { pid: '2', canvasId: 'p2-spark', elId: 'p2-24h' },
        { pid: 'combined', canvasId: 'pc-spark', elId: 'c-24h' },
    ];
    await Promise.all(configs.map(async ({ pid, canvasId, elId }) => {
        try {
            const res = await fetch(`/api/p${pid}/history`);
            const json = await res.json();
            if (json.status === 'ok' && json.data.length >= 2) {
                _sparkData[canvasId] = { points: json.data, colors: SPARK_COLORS[pid] };
                requestAnimationFrame(() => {
                    drawSparkline(canvasId, json.data, SPARK_COLORS[pid]);
                    _attachSparkHover(canvasId);
                });
                _render24hChange(elId, json.data);
            }
        } catch (_) { }
    }));
}

function _render24hChange(elId, points) {
    const el = document.getElementById(elId);
    if (!el || points.length < 2) return;
    const now = Date.now() / 1000;
    const target24h = now - 86400;
    // Find the point closest to 24 hours ago
    let ref = points[0];
    for (const pt of points) {
        if (Math.abs(pt.ts - target24h) < Math.abs(ref.ts - target24h)) ref = pt;
    }
    const current = points[points.length - 1];
    const delta = current.value - ref.value;
    const pct = ref.value > 0 ? (delta / ref.value) * 100 : 0;
    const sign = delta >= 0 ? '+' : '';
    if (el) {
        el.textContent = `${sign}${fmt.currency(delta)} (${sign}${pct.toFixed(2)}%) 24h`;
        el.className = `ov-24h ${delta >= 0 ? 'pos' : 'neg'}`;
        el.style.display = '';
    }
}

function _attachSparkHover(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || canvas._hoverBound) return;
    canvas._hoverBound = true;

    // Shared floating tooltip div (created once)
    let tip = document.getElementById('spark-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'spark-tooltip';
        tip.className = 'spark-tip';
        document.body.appendChild(tip);
    }

    canvas.addEventListener('mousemove', (e) => {
        const d = _sparkData[canvasId];
        if (!d) return;
        const { points, colors } = d;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const W = canvas.offsetWidth || 160;
        const pad = { left: 2, right: 2 };
        const chartW = W - pad.left - pad.right;

        // Find nearest point index
        const idx = Math.round((mouseX - pad.left) / chartW * (points.length - 1));
        const clampedIdx = Math.max(0, Math.min(points.length - 1, idx));
        const pt = points[clampedIdx];

        // Redraw clean chart + overlay
        drawSparkline(canvasId, points, colors, clampedIdx);

        // Position and populate tooltip
        const time = new Date(pt.ts * 1000).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        tip.innerHTML = `<span class="spark-tip-val">${fmt.currency(pt.value)}</span><span class="spark-tip-time">${time}</span>`;
        tip.style.display = 'flex';

        // Place tooltip above cursor, flip left if near right edge
        const tipW = 140;
        let left = e.clientX + window.scrollX - tipW / 2;
        if (left + tipW > window.innerWidth - 8) left = e.clientX + window.scrollX - tipW;
        if (left < 4) left = 4;
        tip.style.left = left + 'px';
        tip.style.top = (e.clientY + window.scrollY - 54) + 'px';
    });

    canvas.addEventListener('mouseleave', () => {
        const d = _sparkData[canvasId];
        if (d) drawSparkline(canvasId, d.points, d.colors);
        if (tip) tip.style.display = 'none';
    });
}

function drawSparkline(canvasId, points, colors, hoverIdx = -1) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const W = canvas.offsetWidth || 160;
    const H = canvas.offsetHeight || 64;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const values = points.map(p => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    const pad = { top: 6, bottom: 6, left: 2, right: 2 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    const xOf = i => pad.left + (i / (points.length - 1)) * chartW;
    const yOf = v => pad.top + (1 - (v - minV) / range) * chartH;

    // Filled gradient area
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, colors.fill);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.lineTo(xOf(points.length - 1), H - pad.bottom);
    ctx.lineTo(xOf(0), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (hoverIdx >= 0) {
        // Vertical crosshair
        const hx = xOf(hoverIdx);
        const hy = yOf(values[hoverIdx]);
        ctx.beginPath();
        ctx.moveTo(hx, pad.top);
        ctx.lineTo(hx, H - pad.bottom);
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Hover dot (outer ring + inner fill)
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fillStyle = colors.fill;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.line;
        ctx.fill();
    } else {
        // Default end dot
        ctx.beginPath();
        ctx.arc(xOf(points.length - 1), yOf(values[values.length - 1]), 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.line;
        ctx.fill();
    }
}

async function loadHomeWidgets() {
    // Nothing to load here currently — widgets moved to dedicated Market view
}

async function loadMarketView(force = false) {
    if (force) {
        _sp500Data = [];
        _signalsData = {};
        _insiderData = {};
    }
    loadSP500Data();
    loadMarketChart();
    loadMarketSignals(_activeSignal || 'gainers');
    loadInsiderTrading(_activeInsiderPeriod || 'latest');
    loadInlineTradeSignals();
    loadMarketMonthlyPerf();
}

async function loadMarketMonthlyPerf() {
    const container = document.getElementById('monthlyPerfHeatmap');
    if (!container) return;
    _showElemLoading(container, 'Loading monthly performance…');
    try {
        const res = await fetch('/api/pcombined/monthly-performance');
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'Failed');
        window._marketMonthlyPerfData = json.data;
        if (typeof _renderMonthlyPerfHeatmap === 'function') _renderMonthlyPerfHeatmap(json.data);
    } catch (err) {
        _showElemLoading(container, 'Failed to load sector performance');
    }
}

function setMarketMonthlyPerfView(view, btn) {
    document.querySelectorAll('#monthlyPerfCard .mpv-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (view === '12m' && window._marketMonthlyPerfData) {
        if (typeof _renderMonthlyPerfHeatmap === 'function') _renderMonthlyPerfHeatmap(window._marketMonthlyPerfData);
    }
}

async function loadMetricsView(force = false) {
    if (force) {
        _portfolioVsData = null;
    }
    loadPortfolioVsMarket();
    loadMarketChart();   // ensure S&P 500 series is available for portfolio vs chart
    loadRiskMetrics();
}

async function loadRiskMetrics() {
    const grid = document.getElementById('riskMetricsGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/pcombined/risk-metrics');
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'Failed');
        _renderRiskMetrics(json.data);
    } catch (err) {
        if (grid) grid.innerHTML = _rmEmptyState(
            'cloud_off',
            'Unable to load metrics',
            err.message
        );
    }
}

function _rmEmptyState(icon, title, subtitle) {
    return `<div class="risk-metrics-empty">
        <div class="rme-icon-wrap">
            <span class="material-symbols-outlined rme-icon">${icon}</span>
        </div>
        <span class="rme-title">${title}</span>
        ${subtitle ? `<span class="rme-subtitle">${subtitle}</span>` : ''}
    </div>`;
}

function _rmBadge(text, type) {
    // type: 'good' | 'ok' | 'warn' | 'neutral'
    return `<span class="rm-badge rm-badge-${type}">${text}</span>`;
}

function _rmTrack(value, min, max, markers) {
    // markers: [{label, val, accent}]
    const clamp = v => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
    const dots = (markers || []).map(m =>
        `<div class="rm-track-dot${m.accent ? ' rm-track-dot-accent' : ''}" style="left:${clamp(m.val).toFixed(1)}%">
           <div class="rm-track-label">${m.label}</div>
         </div>`
    ).join('');
    return `<div class="rm-track"><div class="rm-track-fill" style="width:${clamp(value).toFixed(1)}%"></div>${dots}</div>`;
}

function _renderRiskMetrics(data) {
    const grid = document.getElementById('riskMetricsGrid');
    if (!grid) return;

    if (data.insufficient_data) {
        grid.innerHTML = _rmEmptyState(
            'history_toggle_off',
            'Not enough history yet',
            'Portfolio metrics will appear once more trading days have been recorded.'
        );
        return;
    }

    const cards = [];

    // ── TWR ──────────────────────────────────────────────────────────────
    const twrSign = data.twr >= 0 ? '▲' : '▼';
    const twrClass = data.twr >= 0 ? 'pos' : 'neg';
    const spyChip = data.spy_twr != null
        ? `<div class="rm-bench-chip">SPY: ${data.spy_twr > 0 ? '+' : ''}${data.spy_twr.toFixed(2)}%
             <span class="${data.twr_vs_spy >= 0 ? 'pos' : 'neg'}">
               (${data.twr_vs_spy >= 0 ? '▲' : '▼'}${Math.abs(data.twr_vs_spy).toFixed(2)}%)
             </span></div>`
        : '';
    cards.push(`
      <div class="risk-metric-card">
        <div class="rm-header">
          <div>
            <span class="rm-title">Portfolio TWR</span>
            <span class="rm-badge rm-badge-neutral" style="font-size:0.65rem;padding:1px 5px">β</span>
          </div>
          <span class="rm-desc">True performance excluding the impact of cash flows</span>
        </div>
        <div class="rm-value ${twrClass}">${twrSign}${Math.abs(data.twr).toFixed(2)}%</div>
        ${spyChip}
      </div>`);

    // ── P/E ──────────────────────────────────────────────────────────────
    if (data.pe != null) {
        const peStatus = data.pe < 15 ? _rmBadge('undervalued', 'good')
            : data.pe < 25 ? _rmBadge('fair value', 'ok')
                : data.pe < 35 ? _rmBadge('elevated', 'warn')
                    : _rmBadge('expensive', 'warn');
        cards.push(`
          <div class="risk-metric-card">
            <div class="rm-header">
              <span class="rm-title">Portfolio P/E</span>
              <span class="rm-desc">Weighted average P/E of all holdings</span>
            </div>
            <div class="rm-value neutral">${data.pe.toFixed(1)}×</div>
            <div class="rm-info-row">${peStatus}
              ${_rmTrack(data.pe, 0, 70, [{ label: 'Portfolio', val: data.pe, accent: true }])}
            </div>
          </div>`);
    }

    // ── Beta ─────────────────────────────────────────────────────────────
    if (data.beta != null) {
        const betaStatus = data.beta < 0.8 ? _rmBadge('lower than market', 'good')
            : data.beta < 1.1 ? _rmBadge('similar to market', 'ok')
                : _rmBadge('higher than market', 'warn');
        const betaTrack = _rmTrack(data.beta, 0, 2, [
            { label: 'Market', val: 1.0, accent: false },
            { label: 'Portfolio', val: data.beta, accent: true }
        ]);
        const volStr = data.volatility != null ? ` · Vol ${data.volatility.toFixed(1)}% p.a.` : '';
        cards.push(`
          <div class="risk-metric-card">
            <div class="rm-header">
              <span class="rm-title">Volatility / Beta</span>
              <span class="rm-desc">Portfolio volatility relative to the market</span>
            </div>
            <div class="rm-info-box">
              <span class="rm-info-label">β = ${data.beta.toFixed(3)}${volStr}</span>
              ${betaStatus}
            </div>
            ${betaTrack}
          </div>`);
    }

    // ── Sharpe ───────────────────────────────────────────────────────────
    if (data.sharpe != null) {
        const shStatus = data.sharpe > 2 ? _rmBadge('excellent', 'good')
            : data.sharpe > 1 ? _rmBadge('good', 'good')
                : data.sharpe > 0.5 ? _rmBadge('adequate', 'ok')
                    : _rmBadge('requires attention', 'warn');
        const shMarkers = [{ label: 'Portfolio', val: data.sharpe, accent: true }];
        if (data.spy_sharpe != null) shMarkers.unshift({ label: 'SPY', val: data.spy_sharpe, accent: false });
        cards.push(`
          <div class="risk-metric-card">
            <div class="rm-header">
              <span class="rm-title">Sharpe Ratio</span>
              <span class="rm-desc">Risk-adjusted return (all volatility considered)</span>
            </div>
            <div class="rm-info-box">
              <span class="rm-info-label">Sharpe = ${data.sharpe.toFixed(3)}</span>
              ${shStatus}
            </div>
            ${_rmTrack(data.sharpe, -1, 3, shMarkers)}
          </div>`);
    }

    // ── Sortino ──────────────────────────────────────────────────────────
    if (data.sortino != null) {
        const soStatus = data.sortino > 2 ? _rmBadge('excellent', 'good')
            : data.sortino > 1 ? _rmBadge('good', 'good')
                : data.sortino > 0.5 ? _rmBadge('adequate', 'ok')
                    : _rmBadge('requires attention', 'warn');
        cards.push(`
          <div class="risk-metric-card">
            <div class="rm-header">
              <span class="rm-title">Sortino Ratio</span>
              <span class="rm-desc">Risk-adjusted return (downside volatility only)</span>
            </div>
            <div class="rm-info-box">
              <span class="rm-info-label">Sortino = ${data.sortino.toFixed(3)}</span>
              ${soStatus}
              <span class="rm-hint">Value above 2 is considered good</span>
            </div>
            ${_rmTrack(data.sortino, -1, 4, [{ label: 'Portfolio', val: data.sortino, accent: true }])}
          </div>`);
    }

    grid.innerHTML = cards.join('');
}

async function loadInlineTradeSignals() {
    const el = document.getElementById('inlineSignalsList');
    if (!el) return;
    try {
        const res = await fetch('/api/trade-signals');
        const json = await res.json();
        if (json.status !== 'ok' || !json.data?.length) {
            el.innerHTML = '<div class="activity-empty">No signals available.</div>';
            return;
        }
        const rows = json.data.slice(0, 12);
        el.innerHTML = `<table class="inline-signals-table">
            <thead><tr>
                <th>Ticker</th><th>Company</th><th>Signal</th>
                <th>Entry</th><th>Avg Target</th><th>Exp. Return</th><th>Conviction</th>
            </tr></thead>
            <tbody>${rows.map(r => {
            const cls = r.signal === 'BUY' ? 'buy' : r.signal === 'SELL' ? 'sell' : 'hold';
            const sign = (r.exp_return ?? 0) >= 0 ? '+' : '';
            const target = r.target != null ? fmt.currency(r.target, 2) : '—';
            return `<tr>
                    <td><span class="wl-ticker-chip">${esc(r.ticker)}</span></td>
                    <td style="color:var(--text-secondary);max-width:130px;overflow:hidden;text-overflow:ellipsis">${esc(r.company_name || '')}</td>
                    <td><span class="wl-signal-badge ${cls}">${esc(r.signal)}</span></td>
                    <td>${fmt.currency(r.entry, 2)}</td>
                    <td>${target}</td>
                    <td class="${(r.exp_return ?? 0) >= 0 ? 'pos' : 'neg'}">${sign}${(r.exp_return ?? 0).toFixed(1)}%</td>
                    <td><span class="ts-conviction ${(r.conviction || '').toLowerCase()}">${esc(r.conviction || '—')}</span></td>
                </tr>`;
        }).join('')}</tbody>
        </table>`;
    } catch (e) {
        el.innerHTML = '<div class="activity-empty">Error loading signals.</div>';
    }
}

async function loadCalendarView(force) {
    if (force) {
        // Clear cached data so both functions re-fetch
        try { sessionStorage.removeItem('divCal'); } catch (_) { }
    }
    await Promise.all([
        loadDividendCalendar(),
        loadEarnings(),
    ]);
}

/* ─── Activity View ──────────────────────────────────────────────────────── */

async function loadActivityView(force = false) {
    await Promise.all([
        _loadActivityTimeline(force),
        _loadDivHistoryTimeline(),
    ]);
}

async function _loadActivityTimeline(force) {
    const el = document.getElementById('activityTimelineList');
    if (!el) return;
    el.innerHTML = `
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-55"></div><div class="skeleton skel-line skel-w-35"></div></div><div class="skeleton skel-amount"></div></div>
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-65"></div><div class="skeleton skel-line skel-w-40"></div></div><div class="skeleton skel-amount"></div></div>
    `;
    try {
        const url = force ? '/api/pcombined/activity?force=1' : '/api/pcombined/activity';
        const res = await fetch(url);
        const json = await res.json();
        _renderActivityTimeline(json.data || []);
    } catch (err) {
        el.innerHTML = '<div class="activity-empty">Error loading activity</div>';
    }
}

async function _loadDivHistoryTimeline() {
    const el = document.getElementById('divHistoryList');
    if (!el) return;
    el.innerHTML = `
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-50"></div><div class="skeleton skel-line skel-w-30"></div></div><div class="skeleton skel-amount"></div></div>
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-60"></div><div class="skeleton skel-line skel-w-40"></div></div><div class="skeleton skel-amount"></div></div>
    `;
    try {
        const res = await fetch('/api/pcombined/recent-dividends');
        const json = await res.json();
        _renderDivHistoryTimeline(json.data || []);
    } catch (err) {
        el.innerHTML = '<div class="activity-empty">Error loading dividend history</div>';
    }
}

function _renderActivityTimeline(data) {
    const el = document.getElementById('activityTimelineList');
    if (!el) return;
    if (!data.length) {
        el.innerHTML = '<div class="activity-empty">No recent activity found.</div>';
        return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : { '1': 'Chimbu', '2': 'Poornima' };

    const items = data.map((order, i) => {
        const ticker = (order.ticker || '').split('_')[0];
        const company = order.company_name || ticker || 'Unknown';
        const qty = order.filledQuantity || 0;
        const dateStr = order.dateExecuted || order.dateCreated || '';
        const status = (order.status || '').toUpperCase();
        const pid = order._pid || '1';
        const ownerName = names[pid] || pid;
        const isCancelled = status === 'CANCELLED' || status === 'REJECTED';
        const typeUpper = (order.type || '').toUpperCase();
        const isSell = (order.side || '').toUpperCase() === 'SELL' || typeUpper.includes('SELL');
        const actionWord = isCancelled ? 'Cancelled' : (isSell ? 'Sold' : 'Bought');
        const value = fmt.currency(order.filledValue || (qty * (order.fillPrice || 0)));

        const date = dateStr ? new Date(dateStr) : new Date();
        const day = date.getDate();
        const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const timeStr = dateStr
            ? date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '—';

        const diffDays = dateStr
            ? Math.round((today - new Date(dateStr.split('T')[0] + 'T00:00:00')) / 86400000)
            : 0;
        let relLabel;
        if (diffDays === 0) relLabel = 'TODAY';
        else if (diffDays === 1) relLabel = 'YESTERDAY';
        else if (diffDays < 7) relLabel = `${diffDays}D AGO`;
        else relLabel = `${Math.floor(diffDays / 7)}W AGO`;

        const badgeClass = isCancelled ? 'div-tl-date-badge--paid' : (isSell ? 'div-tl-date-badge--sell' : 'div-tl-date-badge--buy');
        const statusClass = isCancelled ? 'div-tl-status--paid' : (isSell ? 'div-tl-status--sell' : 'div-tl-status--buy');
        const isLast = i === data.length - 1;

        return `
        <div class="div-tl-item">
          <div class="div-tl-left">
            <div class="div-tl-date-badge ${badgeClass}">
              <span class="div-tl-month">${month}</span>
              <span class="div-tl-day">${day}</span>
            </div>
            <span class="div-tl-relative">${relLabel}</span>
            ${isLast ? '' : '<div class="div-tl-line"></div>'}
          </div>
          <div class="div-tl-card">
            <div class="div-tl-card-top">
              <div class="div-tl-identity">
                ${_logoImg(ticker, 'div-tl-logo')}
                <div class="div-tl-name-stack">
                  <span class="div-tl-ticker">${esc(ticker)}</span>
                  <div class="div-tl-company-block">
                    <span class="div-tl-company">${esc(company)}</span>
                    <span class="div-tl-type">${actionWord} · ${fmt.number(qty, 4)} shares</span>
                  </div>
                </div>
              </div>
              <div class="div-tl-amount-block">
                <span class="div-tl-value">${value}</span>
              </div>
            </div>
            <div class="div-tl-card-bottom">
              <div class="div-tl-dates">
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Executed ${timeStr}</span>
                </div>
              </div>
              <span class="ov-card-pid-tag ov-tag-p${pid}">${esc(ownerName)}</span>
              <span class="div-tl-status ${statusClass}">${actionWord}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="div-timeline">${items}</div>`;
}

function _renderDivHistoryTimeline(data) {
    const el = document.getElementById('divHistoryList');
    if (!el) return;
    if (!data.length) {
        el.innerHTML = '<div class="activity-empty">No dividend history found.</div>';
        return;
    }
    const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : { '1': 'Chimbu', '2': 'Poornima' };

    const items = data.map((div, i) => {
        const ticker = (div.ticker || '').split('_')[0];
        const company = div.company_name || '';
        const amount = fmt.currency(div.amount || 0);
        const dateStr = div.paidOn || div.date || '';
        const pid = div._pid || '1';
        const ownerName = names[pid] || pid;

        let day = '—', month = '—', timeStr = dateStr || '—';
        if (dateStr && dateStr !== '—') {
            const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
            day = d.getDate();
            month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
            timeStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        const isLast = i === data.length - 1;

        return `
        <div class="div-tl-item">
          <div class="div-tl-left">
            <div class="div-tl-date-badge div-tl-date-badge--div">
              <span class="div-tl-month">${month}</span>
              <span class="div-tl-day">${day}</span>
            </div>
            <span class="div-tl-relative" style="color:#00786e">RECEIVED</span>
            ${isLast ? '' : '<div class="div-tl-line"></div>'}
          </div>
          <div class="div-tl-card">
            <div class="div-tl-card-top">
              <div class="div-tl-identity">
                ${_logoImg(ticker, 'div-tl-logo')}
                <div class="div-tl-name-stack">
                  <span class="div-tl-ticker">${esc(ticker)}</span>
                  <div class="div-tl-company-block">
                    ${company ? `<span class="div-tl-company">${esc(company)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="div-tl-amount-block">
                <span class="div-tl-value pos">${amount}</span>
              </div>
            </div>
            <div class="div-tl-card-bottom">
              <div class="div-tl-dates">
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Paid On ${esc(timeStr)}</span>
                </div>
              </div>
              <span class="ov-card-pid-tag ov-tag-p${pid}">${esc(ownerName)}</span>
              <span class="div-tl-status div-tl-status--received">Dividend</span>
            </div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="div-timeline">${items}</div>`;
}

/* ─── S&P 500 Data + Sector Bars ─────────────────────────────────────────── */

async function loadSP500Data() {
    const canvas = document.getElementById('sectorRadialChart');
    _showChartEmpty(canvas, 'Loading sector data…');
    try {
        const res = await fetch('/api/market/sector-performance');
        const json = await res.json();
        if (json.status === 'ok') {
            _sp500Data = json.data || [];
            _drawSectorRadialChart();
        }
    } catch (err) {
        console.warn('[sp500Data]', err);
        _showChartEmpty(canvas, 'Failed to load sector data');
    }
}

function _drawSectorRadialChart() {
    const canvas = document.getElementById('sectorRadialChart');
    if (!canvas || !_sp500Data.length) return;
    _hideChartEmpty(canvas);

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 300;
    const H = canvas.offsetHeight || canvas.parentElement.offsetHeight || 300;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textPrimary = isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.78)';
    const gridColor = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';

    ctx.clearRect(0, 0, W, H);

    // ── Build sector aggregates ─────────────────────────────────────────────
    const sectorMap = {};
    for (const s of _sp500Data) {
        const sec = s.sector || 'Other';
        if (!sectorMap[sec]) sectorMap[sec] = { sum: 0, n: 0 };
        sectorMap[sec].sum += s.change_pct ?? 0;
        sectorMap[sec].n++;
    }
    const sectors = Object.entries(sectorMap)
        .map(([name, d]) => ({
            name: name
                .replace('Consumer ', '').replace(' Services', '')
                .replace('Basic Materials', 'Materials').replace('Financial Services', 'Financial'),
            avg: d.sum / d.n
        }))
        .sort((a, b) => b.avg - a.avg);

    const N = sectors.length;
    if (!N) return;

    const maxAbs = Math.max(...sectors.map(s => Math.abs(s.avg)), 0.5);
    const labelR = 46;                              // pixels reserved outside max ring for labels
    const maxR = Math.min(W, H) / 2 - labelR - 4;
    const cx = W / 2;
    const cy = H / 2;
    const sa = (2 * Math.PI) / N;              // slice angle
    const GAP = 0.018;                           // small gap between slices (radians)

    // ── Grid rings ──────────────────────────────────────────────────────────
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * i / 4, 0, Math.PI * 2);
        ctx.strokeStyle = gridColor;
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── Spoke lines ─────────────────────────────────────────────────────────
    for (let i = 0; i < N; i++) {
        const angle = -Math.PI / 2 + i * sa;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle));
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ── Colour bands — same scheme as Monthly Performance heatmap ───────────
    const _sectorBandColors = pct => {
        if (pct >= 10) return ['#052e16', '#15803d'];
        if (pct >= 5) return ['#14532d', '#16a34a'];
        if (pct >= 2) return ['#166534', '#22c55e'];
        if (pct >= 0) return ['#0f766e', '#14b8a6'];
        if (pct >= -2) return ['#78350f', '#b45309'];
        if (pct >= -5) return ['#7f1d1d', '#dc2626'];
        return ['#450a0a', '#b91c1c'];
    };

    // ── Wedges ──────────────────────────────────────────────────────────────
    for (let i = 0; i < N; i++) {
        const s = sectors[i];
        const startA = -Math.PI / 2 + i * sa + GAP;
        const endA = -Math.PI / 2 + (i + 1) * sa - GAP;
        const r = Math.max(maxR * Math.abs(s.avg) / maxAbs, 4);

        const [c1, c2] = _sectorBandColors(s.avg);
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grd.addColorStop(0, c1);
        grd.addColorStop(1, c2);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startA, endA);
        ctx.closePath();
        ctx.fillStyle = grd;
        ctx.fill();
        ctx.strokeStyle = c2 + '55';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ── Labels ──────────────────────────────────────────────────────────────
    for (let i = 0; i < N; i++) {
        const s = sectors[i];
        const midA = -Math.PI / 2 + (i + 0.5) * sa;
        const dist = maxR + labelR * 0.52;
        const lx = cx + dist * Math.cos(midA);
        const ly = cy + dist * Math.sin(midA);

        const sign = s.avg >= 0 ? '+' : '';
        const pctCol = _sectorBandColors(s.avg)[1];

        // Align based on position around circle
        const cosA = Math.cos(midA);
        ctx.textAlign = cosA < -0.15 ? 'right' : cosA > 0.15 ? 'left' : 'center';
        ctx.textBaseline = 'middle';

        ctx.font = `600 10px system-ui, sans-serif`;
        ctx.fillStyle = textPrimary;
        ctx.fillText(s.name, lx, ly - 7);

        ctx.font = `500 9.5px system-ui, sans-serif`;
        ctx.fillStyle = pctCol;
        ctx.fillText(`${sign}${s.avg.toFixed(2)}%`, lx, ly + 6);
    }

    // ── Centre dot ──────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = gridColor;
    ctx.fill();
}

/* ─── S&P 500 Chart ──────────────────────────────────────────────────────── */

const _MKT_RANGE_DAYS = { '1W': 5, '1M': 22, '3M': 66, '1Y': 252 };

function _mktDataValid(d) {
    // A market-indicators payload is valid only if at least one symbol has values
    return d && (d.GSPC?.values?.length > 0 || d.IXIC?.values?.length > 0 || d.VIX?.values?.length > 0);
}

async function loadMarketChart() {
    if (_mktDataValid(_mktChartData)) {
        _drawMarketChart();
        _drawNasdaqChart();
        _updateMarketStats();
        _updateNasdaqStats();
        // redraw portfolio vs S&P if data already loaded
        if (_portfolioVsData) _drawPortfolioVsChart();
        return;
    }
    // Reset any previously cached null-valued object so we always re-fetch
    _mktChartData = null;
    try {
        const res = await fetch('/api/market-indicators');
        const json = await res.json();
        if (json.status === 'ok' && _mktDataValid(json.data)) {
            _mktChartData = json.data;
            if (!_marketIndData) _marketIndData = json.data;
            _drawMarketChart();
            _drawNasdaqChart();
            _updateMarketStats();
            _updateNasdaqStats();
            if (_portfolioVsData) _drawPortfolioVsChart();
        }
    } catch (err) { console.warn('[marketChart]', err); }
}

function _updateMarketStats() {
    const sp = _mktChartData?.GSPC;
    const vix = _mktChartData?.VIX;
    if (!sp?.values?.length) return;

    const n = _MKT_RANGE_DAYS[_mktActiveRange] || 66;
    const vals = sp.values.slice(-n);
    const current = vals[vals.length - 1];
    const prev = sp.values[sp.values.length - 2];

    const priceEl = document.getElementById('mktSpPrice');
    const changeEl = document.getElementById('mktSpChange');
    if (priceEl) priceEl.textContent = current != null
        ? current.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
    if (changeEl && current != null && prev != null) {
        const d = ((current / prev) - 1) * 100;
        changeEl.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%';
        changeEl.className = 'mkt-sp-change ' + (d >= 0 ? 'pos' : 'neg');
    }

    const rangePctEl = document.getElementById('mktRangePct');
    if (rangePctEl && current != null && vals[0] != null) {
        const p = ((current / vals[0]) - 1) * 100;
        rangePctEl.textContent = (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
        rangePctEl.className = 'mkt-footer-val ' + (p >= 0 ? 'pos' : 'neg');
    }

    const vsMaEl = document.getElementById('mktVsMa');
    if (vsMaEl && sp.pct_vs_ma != null) {
        vsMaEl.textContent = (sp.pct_vs_ma >= 0 ? '+' : '') + sp.pct_vs_ma.toFixed(1) + '%';
        vsMaEl.className = 'mkt-footer-val ' + (sp.pct_vs_ma >= 0 ? 'pos' : 'neg');
    }

    const vixEl = document.getElementById('mktVix');
    if (vixEl && vix?.current != null) {
        vixEl.textContent = vix.current.toFixed(1);
        vixEl.className = 'mkt-footer-val ' + (vix.current > 25 ? 'neg' : vix.current > 18 ? '' : 'pos');
    }
}

function _updateNasdaqStats() {
    const nd = _mktChartData?.IXIC;
    if (!nd?.values?.length) return;
    const n = _MKT_RANGE_DAYS[_nasdaqActiveRange] || 66;
    const vals = nd.values.slice(-n);
    const current = vals[vals.length - 1];
    const prev = nd.values[nd.values.length - 2];

    const priceEl = document.getElementById('nasdaqPrice');
    const changeEl = document.getElementById('nasdaqChange');
    if (priceEl) priceEl.textContent = current != null
        ? current.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
    if (changeEl && current != null && prev != null) {
        const d = ((current / prev) - 1) * 100;
        changeEl.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%';
        changeEl.className = 'mkt-sp-change ' + (d >= 0 ? 'pos' : 'neg');
    }

    const rangePctEl = document.getElementById('nasdaqRangePct');
    if (rangePctEl && current != null && vals[0] != null) {
        const p = ((current / vals[0]) - 1) * 100;
        rangePctEl.textContent = (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
        rangePctEl.className = 'mkt-footer-val ' + (p >= 0 ? 'pos' : 'neg');
    }

    const vsMaEl = document.getElementById('nasdaqVsMa');
    if (vsMaEl && nd.pct_vs_ma != null) {
        vsMaEl.textContent = (nd.pct_vs_ma >= 0 ? '+' : '') + nd.pct_vs_ma.toFixed(1) + '%';
        vsMaEl.className = 'mkt-footer-val ' + (nd.pct_vs_ma >= 0 ? 'pos' : 'neg');
    }
}

// ── Generic index chart drawing (S&P 500 + NASDAQ) ──────────────────────────

function _drawMarketChart() {
    _drawIndexChart('mktChart', _mktChartData?.GSPC, _mktActiveRange, 'mktChartTooltip');
}

function _drawNasdaqChart() {
    _drawIndexChart('nasdaqChart', _mktChartData?.IXIC, _nasdaqActiveRange, 'nasdaqChartTooltip');
}

function _drawIndexChart(canvasId, sp, activeRange, tooltipId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !sp?.values?.length) return;
    if (!canvas.offsetWidth) { requestAnimationFrame(() => _drawIndexChart(canvasId, sp, activeRange, tooltipId)); return; }

    const n = _MKT_RANGE_DAYS[activeRange] || 66;
    const values = sp.values.slice(-n);
    const maAll = sp.ma.slice(-n);
    const tsAll = sp.timestamps.slice(-n);
    if (!values.length) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { top: 12, right: 10, bottom: 26, left: 52 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;
    const minV = Math.min(...values) * 0.9985;
    const maxV = Math.max(...values) * 1.0015;
    const vRng = maxV - minV || 1;

    const xOf = i => PAD.left + (i / (values.length - 1)) * cW;
    const yOf = v => PAD.top + (1 - (v - minV) / vRng) * cH;

    const isUp = values[values.length - 1] >= values[0];
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const fillA = isUp ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
    const fillB = isUp ? 'rgba(34,197,94,0.02)' : 'rgba(239,68,68,0.02)';

    // Y gridlines + labels
    for (let i = 0; i <= 4; i++) {
        const v = minV + (i / 4) * (maxV - minV);
        const y = yOf(v);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '10px "JetBrains Mono",monospace';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(v).toLocaleString('en-US'), PAD.left - 4, y + 3);
    }

    // X labels
    const xCount = activeRange === '1W' ? 5 : 6;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '10px system-ui,sans-serif';
    for (let i = 0; i < xCount; i++) {
        const idx = Math.round(i / (xCount - 1) * (values.length - 1));
        const d = new Date(tsAll[idx] * 1000);
        const lbl = activeRange === '1W'
            ? d.toLocaleDateString('en-GB', { weekday: 'short' })
            : activeRange === '1Y'
                ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
                : d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        ctx.fillText(lbl, xOf(idx), H - 6);
    }

    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    grad.addColorStop(0, fillA); grad.addColorStop(1, fillB);
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.lineTo(xOf(values.length - 1), PAD.top + cH);
    ctx.lineTo(xOf(0), PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // MA line
    if (maAll.some(v => v != null)) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < maAll.length; i++) {
            if (maAll[i] == null) continue;
            if (!started) { ctx.moveTo(xOf(i), yOf(maAll[i])); started = true; }
            else ctx.lineTo(xOf(i), yOf(maAll[i]));
        }
        ctx.strokeStyle = 'rgba(251,191,36,0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Price line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Data dots (visible at shorter ranges)
    if (values.length <= 66) {
        const dotR = values.length <= 5 ? 3.5 : values.length <= 22 ? 2.5 : 1.5;
        ctx.fillStyle = lineColor;
        for (let i = 0; i < values.length; i++) {
            ctx.beginPath();
            ctx.arc(xOf(i), yOf(values[i]), dotR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Store for hover
    canvas._mkt = { values, tsAll, PAD, cW, cH, minV, vRng, lineColor, W, H };
    canvas._mktRedraw = canvasId === 'mktChart' ? _drawMarketChart : _drawNasdaqChart;
    _initChartHoverGeneric(canvas, tooltipId);
}

function _initChartHoverGeneric(canvas, tooltipId) {
    if (canvas._mktHoverBound) return;
    canvas._mktHoverBound = true;

    canvas.addEventListener('mousemove', e => {
        const m = canvas._mkt;
        if (!m) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const { values, tsAll, PAD, cW, cH, minV, vRng, lineColor } = m;
        const xOf = i => PAD.left + (i / (values.length - 1)) * cW;
        const yOf = v => PAD.top + (1 - (v - minV) / vRng) * cH;
        const idx = Math.max(0, Math.min(values.length - 1,
            Math.round((mx - PAD.left) / cW * (values.length - 1))));

        if (canvas._mktRedraw) canvas._mktRedraw();
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.scale(dpr, dpr);

        const hx = xOf(idx), hy = yOf(values[idx]);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PAD.left, hy); ctx.lineTo(canvas.offsetWidth - PAD.right, hy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor + '40'; ctx.fill();
        ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fillStyle = lineColor; ctx.fill();

        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            const d = new Date(tsAll[idx] * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const price = values[idx].toLocaleString('en-US', { maximumFractionDigits: 0 });
            tooltip.innerHTML = `<span class="mkt-tt-date">${d}</span><span class="mkt-tt-price" style="color:${lineColor}">${price}</span>`;
            const tx = Math.min(mx + 12, canvas.offsetWidth - 120);
            const ty = Math.max(e.clientY - rect.top - 40, 4);
            tooltip.style.cssText = `display:flex;left:${tx}px;top:${ty}px`;
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (canvas._mktRedraw) canvas._mktRedraw();
        const tooltip = document.getElementById(tooltipId);
        if (tooltip) tooltip.style.display = 'none';
    });
}

// ── Portfolio vs S&P 500 overlay chart ──────────────────────────────────────

async function loadPortfolioVsMarket() {
    _initPvsRangeTabs();
    _initPvsChartTypeToggle();
    _initPvsLegendToggle();
    _initDrawdownRangeTabs();
    if (_portfolioVsData) { _drawPortfolioVsChart(); _renderPortfolioGain(); _drawDrawdownChart(); return; }
    try {
        const res = await fetch('/api/pcombined/daily-history');
        const json = await res.json();
        if (json.status === 'ok') {
            _portfolioVsData = json.data;
            _drawPortfolioVsChart();
            _renderPortfolioGain();
            _drawDrawdownChart();
        }
    } catch (err) { console.warn('[portfolioVs]', err); }
}

function _drawPortfolioVsChart() {
    const canvas = document.getElementById('pvsChart');
    if (!canvas) return;
    if (!canvas.offsetWidth) { requestAnimationFrame(_drawPortfolioVsChart); return; }

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    if (!_portfolioVsData?.length || !_mktChartData?.GSPC) {
        _showChartEmpty(canvas, 'Building portfolio history…');
        return;
    }
    _hideChartEmpty(canvas);

    const sp = _mktChartData.GSPC;
    const spByDate = {};
    for (let i = 0; i < sp.timestamps.length; i++) {
        const d = new Date(sp.timestamps[i] * 1000).toISOString().slice(0, 10);
        spByDate[d] = sp.values[i];
    }
    const pvsByDate = {};
    for (const pt of _portfolioVsData) pvsByDate[pt.date] = pt.value;

    const allDates = Object.keys(spByDate).filter(d => pvsByDate[d]).sort();

    // Apply range filter
    const rangeDays = { '1M': 22, '3M': 66, '6M': 132, '1Y': 252, 'ALL': 99999 };
    const maxDays = rangeDays[_pvsActiveRange] || 252;
    const dates = allDates.slice(-maxDays);

    if (dates.length < 2) {
        _showChartEmpty(canvas, 'Not enough data yet');
        return;
    }
    _hideChartEmpty(canvas);

    const spBase = spByDate[dates[0]];
    const pvsBase = pvsByDate[dates[0]];
    const spVals = dates.map(d => ((spByDate[d] / spBase) - 1) * 100);
    const pvsVals = dates.map(d => ((pvsByDate[d] / pvsBase) - 1) * 100);

    const spColor = '#ec4899';   // pink  — matches legend
    const pvsColor = '#f59e0b';  // amber — matches legend

    // Right padding accounts for end-of-line labels
    const PAD = { top: 18, right: 58, bottom: 28, left: 48 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    const activeSeries = [];
    if (_pvsShowSP) activeSeries.push({ vals: spVals, color: spColor });
    if (_pvsShowPvs) activeSeries.push({ vals: pvsVals, color: pvsColor });

    const allVals = activeSeries.flatMap(s => s.vals);
    if (!allVals.length) { ctx.clearRect(0, 0, W, H); return; }

    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const vPad = (maxV - minV) * 0.15 || 2;
    const minVP = minV - vPad, maxVP = maxV + vPad;
    const vRng = maxVP - minVP;

    const xOf = i => PAD.left + (i / (dates.length - 1)) * cW;
    const yOf = v => PAD.top + (1 - (v - minVP) / vRng) * cH;
    const y0 = Math.min(Math.max(yOf(0), PAD.top), PAD.top + cH);

    // Smooth bezier path helper
    function smoothPath(vals) {
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(vals[0]));
        for (let i = 1; i < vals.length; i++) {
            const x1 = xOf(i - 1), y1 = yOf(vals[i - 1]);
            const x2 = xOf(i), y2 = yOf(vals[i]);
            const cpX = (x1 + x2) / 2;
            ctx.bezierCurveTo(cpX, y1, cpX, y2, x2, y2);
        }
    }

    // Y gridlines
    ctx.font = '9.5px "JetBrains Mono",monospace';
    for (let i = 0; i <= 4; i++) {
        const v = minVP + (i / 4) * vRng;
        const y = yOf(v);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.textAlign = 'right';
        ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1) + '%', PAD.left - 4, y + 3);
    }

    // Zero baseline
    if (minVP < 0 && maxVP > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD.left, y0); ctx.lineTo(W - PAD.right, y0); ctx.stroke();
        ctx.setLineDash([]);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = '9.5px system-ui,sans-serif';
    const xCount = Math.min(7, dates.length);
    for (let i = 0; i < xCount; i++) {
        const idx = Math.round(i / (xCount - 1) * (dates.length - 1));
        const d = new Date(dates[idx] + 'T12:00:00');
        const label = d.toLocaleDateString('en-GB', { month: 'short', year: _pvsActiveRange === '1M' ? undefined : '2-digit' });
        ctx.fillText(label, xOf(idx), H - 7);
    }

    if (_pvsChartType === 'bar') {
        // Bar chart rendering
        const barW = Math.max(1, cW / dates.length - 1);
        for (const { vals, color } of activeSeries) {
            for (let i = 0; i < vals.length; i++) {
                const v = vals[i];
                const bx = xOf(i) - barW / 2;
                const by = v >= 0 ? yOf(v) : y0;
                const bh = Math.abs(yOf(v) - y0);
                ctx.fillStyle = color + (v >= 0 ? 'cc' : '99');
                ctx.fillRect(bx, by, barW, bh);
            }
        }
    } else {
        // Line chart rendering with subtle fills
        for (const { vals, color } of activeSeries) {
            smoothPath(vals);
            ctx.lineTo(xOf(vals.length - 1), y0);
            ctx.lineTo(xOf(0), y0);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
            grad.addColorStop(0, color + '22');
            grad.addColorStop(1, color + '04');
            ctx.fillStyle = grad;
            ctx.fill();
        }

        // Draw lines on top
        for (const { vals, color } of activeSeries) {
            smoothPath(vals);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.setLineDash([]);
            ctx.stroke();
        }

        // End-cap dots
        for (const { vals, color } of activeSeries) {
            const lx = xOf(vals.length - 1), ly = yOf(vals[vals.length - 1]);
            ctx.beginPath(); ctx.arc(lx, ly, 5, 0, Math.PI * 2);
            ctx.fillStyle = color + '30'; ctx.fill();
            ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = color; ctx.fill();
        }
    }

    // End-of-line % labels on the right
    ctx.font = 'bold 10px "JetBrains Mono",monospace';
    ctx.textAlign = 'left';
    for (const { vals, color } of activeSeries) {
        const lastVal = vals[vals.length - 1];
        const ly = Math.min(Math.max(yOf(lastVal), PAD.top + 6), PAD.top + cH - 6);
        const lx = xOf(vals.length - 1) + 6;
        // Background pill
        const labelTxt = (lastVal >= 0 ? '+' : '') + lastVal.toFixed(2) + '%';
        const metrics = ctx.measureText(labelTxt);
        ctx.fillStyle = color + '25';
        ctx.beginPath();
        ctx.roundRect(lx - 2, ly - 8, metrics.width + 6, 13, 3);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillText(labelTxt, lx, ly + 1);
    }

    // Store state for hover
    canvas._pvs = { dates, spVals: _pvsShowSP ? spVals : null, pvsVals: _pvsShowPvs ? pvsVals : null, PAD, cW, cH, minVP, vRng, spColor, pvsColor, W, H, y0 };
    _initPvsHover(canvas);

    _updatePortfolioVsStats(spVals, pvsVals);
}

function _initPvsHover(canvas) {
    if (canvas._pvsHoverBound) return;
    canvas._pvsHoverBound = true;

    canvas.addEventListener('mousemove', e => {
        const m = canvas._pvs;
        if (!m) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const { dates, spVals, pvsVals, PAD, cW, cH, minVP, vRng, spColor, pvsColor } = m;

        const idx = Math.max(0, Math.min(dates.length - 1,
            Math.round((mx - PAD.left) / cW * (dates.length - 1))));

        _drawPortfolioVsChart();
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.scale(dpr, dpr);

        const xOf = i => PAD.left + (i / (dates.length - 1)) * cW;
        const yOf = v => PAD.top + (1 - (v - minVP) / vRng) * cH;

        const hx = xOf(idx);

        // Vertical crosshair
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
        ctx.setLineDash([]);

        // Hover dots — only for visible series
        if (spVals) {
            const spY = yOf(spVals[idx]);
            ctx.beginPath(); ctx.arc(hx, spY, 6, 0, Math.PI * 2);
            ctx.fillStyle = spColor + '30'; ctx.fill();
            ctx.beginPath(); ctx.arc(hx, spY, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = spColor; ctx.fill();
        }
        if (pvsVals) {
            const pvsY = yOf(pvsVals[idx]);
            ctx.beginPath(); ctx.arc(hx, pvsY, 6, 0, Math.PI * 2);
            ctx.fillStyle = pvsColor + '30'; ctx.fill();
            ctx.beginPath(); ctx.arc(hx, pvsY, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = pvsColor; ctx.fill();
        }

        const tooltip = document.getElementById('pvsChartTooltip');
        if (tooltip) {
            const d = new Date(dates[idx] + 'T12:00:00')
                .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            let html = `<span class="mkt-tt-date">${d}</span>`;
            if (spVals) {
                const spTxt = (spVals[idx] >= 0 ? '+' : '') + spVals[idx].toFixed(2) + '%';
                html += `<span class="pvs-tt-row"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${spColor};margin-right:5px;flex-shrink:0"></span><span style="color:${spColor};font-weight:600">${spTxt}</span><span style="color:rgba(255,255,255,0.45);margin-left:3px">S&P 500</span></span>`;
            }
            if (pvsVals) {
                const pvsTxt = (pvsVals[idx] >= 0 ? '+' : '') + pvsVals[idx].toFixed(2) + '%';
                html += `<span class="pvs-tt-row"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${pvsColor};margin-right:5px;flex-shrink:0"></span><span style="color:${pvsColor};font-weight:600">${pvsTxt}</span><span style="color:rgba(255,255,255,0.45);margin-left:3px">Portfolio</span></span>`;
            }
            tooltip.innerHTML = html;
            const tx = Math.min(mx + 14, canvas.offsetWidth - 140);
            const ty = Math.max(e.clientY - rect.top - 58, 4);
            tooltip.style.cssText = `display:flex;flex-direction:column;gap:4px;left:${tx}px;top:${ty}px`;
        }
    });

    canvas.addEventListener('mouseleave', () => {
        _drawPortfolioVsChart();
        const tooltip = document.getElementById('pvsChartTooltip');
        if (tooltip) tooltip.style.display = 'none';
    });
}

function _updatePortfolioVsStats(_spVals, _pvsVals) {
    // Nothing to update in footer now — footer was removed
    _renderPortfolioGain();
}

function _renderPortfolioGain() {
    if (!_portfolioVsData?.length) return;
    const data = _portfolioVsData;
    const today = new Date();
    const latestVal = data[data.length - 1].value;

    function valOnOrBefore(targetDate) {
        const td = targetDate.toISOString().slice(0, 10);
        let best = null;
        for (const pt of data) {
            if (pt.date <= td) best = pt;
        }
        return best;
    }

    function returnPct(pt) {
        if (!pt || pt.value === 0) return null;
        return ((latestVal / pt.value) - 1) * 100;
    }

    const d1M = new Date(today); d1M.setMonth(d1M.getMonth() - 1);
    const d6M = new Date(today); d6M.setMonth(d6M.getMonth() - 6);
    const d12M = new Date(today); d12M.setFullYear(d12M.getFullYear() - 1);
    const dYTD = new Date(today.getFullYear(), 0, 1);

    const pt1M = valOnOrBefore(d1M);
    const pt6M = valOnOrBefore(d6M);
    const pt12M = valOnOrBefore(d12M);
    const ptYTD = valOnOrBefore(dYTD);
    const ptFirst = data[0];

    const metrics = [
        { id: 'pvsGain1M', pct: returnPct(pt1M) },
        { id: 'pvsGain6M', pct: returnPct(pt6M) },
        { id: 'pvsGain12M', pct: returnPct(pt12M) },
        { id: 'pvsGainYTD', pct: returnPct(ptYTD) },
        { id: 'pvsGainTotal', pct: returnPct(ptFirst) },
    ];

    for (const { id, pct } of metrics) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (pct === null) { el.textContent = '—'; el.className = 'pvs-gain-val'; continue; }
        const pos = pct >= 0;
        el.innerHTML = `<span class="pvs-gain-arrow ${pos ? 'pos' : 'neg'}">${pos ? '▲' : '▼'}</span>${Math.abs(pct).toFixed(2)}%`;
        el.className = 'pvs-gain-val ' + (pos ? 'pos' : 'neg');
    }
}

function _initChartRangeTabs() {
    const tabs = document.getElementById('mktRangeTabs');
    if (!tabs || tabs._mktInit) return;
    tabs._mktInit = true;
    tabs.addEventListener('click', e => {
        const btn = e.target.closest('.mkt-range-tab');
        if (!btn) return;
        tabs.querySelectorAll('.mkt-range-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mktActiveRange = btn.dataset.range;
        _drawMarketChart();
        _updateMarketStats();
    });
}

function _initNasdaqRangeTabs() {
    const tabs = document.getElementById('nasdaqRangeTabs');
    if (!tabs || tabs._nqInit) return;
    tabs._nqInit = true;
    tabs.addEventListener('click', e => {
        const btn = e.target.closest('.mkt-range-tab');
        if (!btn) return;
        tabs.querySelectorAll('.mkt-range-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _nasdaqActiveRange = btn.dataset.range;
        _drawNasdaqChart();
        _updateNasdaqStats();
    });
}

function _initSP500Tabs() { /* replaced by _initChartRangeTabs */ }

function _initPvsRangeTabs() {
    const tabs = document.getElementById('pvsRangeTabs');
    if (!tabs || tabs._pvsInit) return;
    tabs._pvsInit = true;
    tabs.addEventListener('click', e => {
        const btn = e.target.closest('.mkt-range-tab');
        if (!btn) return;
        tabs.querySelectorAll('.mkt-range-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _pvsActiveRange = btn.dataset.range;
        _drawPortfolioVsChart();
    });
}

function _initPvsChartTypeToggle() {
    const btn = document.getElementById('pvsChartTypeBtn');
    if (!btn || btn._pvsTypeInit) return;
    btn._pvsTypeInit = true;
    btn.addEventListener('click', () => {
        _pvsChartType = _pvsChartType === 'line' ? 'bar' : 'line';
        btn.dataset.type = _pvsChartType;
        // Update icon
        if (_pvsChartType === 'bar') {
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor"/><rect x="6" y="5" width="3" height="10" rx="1" fill="currentColor"/><rect x="11" y="2" width="3" height="13" rx="1" fill="currentColor"/></svg>`;
        } else {
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><polyline points="1,13 5,7 9,10 15,3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        }
        _drawPortfolioVsChart();
    });
}

function _initPvsLegendToggle() {
    ['pvsLegSP', 'pvsLegPvs'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el._pvsLegInit) return;
        el._pvsLegInit = true;
        el.addEventListener('click', () => {
            const series = el.dataset.series;
            const chk = el.querySelector('.pvs-leg-checkbox');
            if (series === 'sp') {
                _pvsShowSP = !_pvsShowSP;
                chk.classList.toggle('pvs-leg-checked', _pvsShowSP);
            } else {
                _pvsShowPvs = !_pvsShowPvs;
                chk.classList.toggle('pvs-leg-checked', _pvsShowPvs);
            }
            _drawPortfolioVsChart();
        });
    });
}


/* ─── Drawdown Analysis Chart ────────────────────────────────────────────── */

function _calcDrawdown(data) {
    let peak = -Infinity;
    return data.map(pt => {
        if (pt.value > peak) peak = pt.value;
        const dd = peak > 0 ? ((pt.value - peak) / peak) * 100 : 0;
        return { date: pt.date, ts: pt.ts, value: pt.value, drawdown: dd, peak };
    });
}

function _drawDrawdownChart() {
    const canvas = document.getElementById('drawdownChart');
    if (!canvas) return;
    if (!canvas.offsetWidth) { requestAnimationFrame(_drawDrawdownChart); return; }
    if (!_portfolioVsData?.length) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        _showChartEmpty(canvas);
        return;
    }

    // Filter by range
    const rangeDays = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 99999 };
    const days = rangeDays[_ddActiveRange] || 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const raw = _portfolioVsData.filter(pt => pt.date >= cutoffStr);
    if (raw.length < 2) {
        _showChartEmpty(canvas, 'Not enough data for this range');
        return;
    }
    _hideChartEmpty(canvas);

    const series = _calcDrawdown(raw);

    // Update stats
    const maxDD = Math.min(...series.map(p => p.drawdown));
    const current = series[series.length - 1].drawdown;

    // Count days in current drawdown streak (from last peak)
    let ddDays = 0;
    for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].drawdown < -0.01) ddDays++;
        else break;
    }

    const fmtDD = v => v.toFixed(2) + '%';
    const maxEl = document.getElementById('ddMaxDD');
    const curEl = document.getElementById('ddCurrent');
    const daysEl = document.getElementById('ddDays');
    if (maxEl) {
        maxEl.textContent = fmtDD(maxDD);
        maxEl.className = 'drawdown-stat-val ' + (maxDD < -0.5 ? 'neg' : 'pos');
    }
    if (curEl) {
        curEl.textContent = fmtDD(current);
        curEl.className = 'drawdown-stat-val ' + (current < -0.5 ? 'neg' : 'pos');
    }
    if (daysEl) daysEl.textContent = ddDays > 0 ? ddDays + 'd' : '—';

    // Canvas setup
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textCol = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
    const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const zeroCol = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
    const lineCol = '#ef4444';
    const fillCol = isDark ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.12)';

    const PAD = { top: 10, right: 8, bottom: 30, left: 38 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    // Y range: always show 0 at top, scale to min drawdown (with small buffer)
    const minDD = Math.min(maxDD, -0.5);
    const yMin = Math.floor(minDD / 5) * 5 - 2; // round to nearest 5, add buffer
    const yMax = 1; // slight headroom above 0
    const yRng = yMax - yMin;

    const yOf = v => PAD.top + (1 - (v - yMin) / yRng) * cH;
    const xOf = i => PAD.left + (i / (series.length - 1)) * cW;

    // Y grid lines and labels
    ctx.font = `9px system-ui,sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ySteps = [];
    for (let v = 0; v >= yMin; v -= 5) ySteps.push(v);

    for (const v of ySteps) {
        const y = yOf(v);
        ctx.strokeStyle = v === 0 ? zeroCol : gridCol;
        ctx.lineWidth = v === 0 ? 1 : 0.5;
        ctx.setLineDash(v === 0 ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = textCol;
        ctx.fillText(v + '%', PAD.left - 4, y);
    }

    // X axis labels (month ticks)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelStep = Math.max(1, Math.floor(series.length / 5));
    for (let i = 0; i < series.length; i += labelStep) {
        const d = new Date(series[i].date);
        const label = d.toLocaleDateString('en-GB', { month: 'short', day: undefined });
        const x = xOf(i);
        ctx.fillStyle = textCol;
        ctx.fillText(label, x, H - PAD.bottom + 5);
    }

    // Fill area
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(0));
    for (let i = 0; i < series.length; i++) {
        ctx.lineTo(xOf(i), yOf(series[i].drawdown));
    }
    ctx.lineTo(xOf(series.length - 1), yOf(0));
    ctx.closePath();
    ctx.fillStyle = fillCol;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < series.length; i++) {
        if (i === 0) ctx.moveTo(xOf(i), yOf(series[i].drawdown));
        else ctx.lineTo(xOf(i), yOf(series[i].drawdown));
    }
    ctx.stroke();

    // Store metadata for hover
    canvas._ddMeta = { series, PAD, cW, cH, xOf, yOf, W, H };
}

function _initDrawdownRangeTabs() {
    const tabs = document.getElementById('ddRangeTabs');
    if (!tabs || tabs._ddInit) return;
    tabs._ddInit = true;
    tabs.addEventListener('click', e => {
        const btn = e.target.closest('.mkt-range-tab');
        if (!btn) return;
        tabs.querySelectorAll('.mkt-range-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _ddActiveRange = btn.dataset.range;
        _drawDrawdownChart();
    });

    // Hover tooltip
    const canvas = document.getElementById('drawdownChart');
    if (!canvas) return;

    canvas.addEventListener('mousemove', e => {
        const m = canvas._ddMeta;
        if (!m) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const idx = Math.max(0, Math.min(m.series.length - 1,
            Math.round((mx - m.PAD.left) / m.cW * (m.series.length - 1))));
        const pt = m.series[idx];
        if (!pt) return;

        _drawDrawdownChart();
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.scale(dpr, dpr);

        // Crosshair
        const x = m.xOf(idx);
        const y = m.yOf(pt.drawdown);
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, m.PAD.top); ctx.lineTo(x, m.H - m.PAD.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();

        // Tooltip
        const tooltip = document.getElementById('drawdownTooltip');
        if (!tooltip) return;
        const dateStr = new Date(pt.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
        const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        tooltip.innerHTML = `
            <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:2px">${dateStr}</div>
            <div style="font-size:0.8rem;font-weight:700;color:#ef4444">${fmt(pt.drawdown)}</div>
            <div style="font-size:0.7rem;color:var(--text-muted)">Value: £${pt.value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</div>`;

        const tx = Math.min(x + 8, m.W - 110);
        const ty = Math.max(m.PAD.top, y - 40);
        tooltip.style.cssText = `display:flex;flex-direction:column;gap:2px;left:${tx}px;top:${ty}px`;
    });

    canvas.addEventListener('mouseleave', () => {
        _drawDrawdownChart();
        const tooltip = document.getElementById('drawdownTooltip');
        if (tooltip) tooltip.style.display = 'none';
    });
}

/* ─── Trade Signals (AI) ─────────────────────────────────────────────────── */

async function loadTradeSignals() {
    const listEl = document.getElementById('tradeSignalsList');
    if (!listEl) return;

    if (_tradeSignalsData) {
        _renderTradeSignals(_tradeSignalsData);
        return;
    }

    listEl.innerHTML = `
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-60"></div><div class="skeleton skel-line skel-w-40"></div></div><div class="skeleton skel-amount"></div></div>
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-50"></div><div class="skeleton skel-line skel-w-35"></div></div><div class="skeleton skel-amount"></div></div>
      <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-55"></div><div class="skeleton skel-line skel-w-30"></div></div><div class="skeleton skel-amount"></div></div>
    `;
    try {
        const res = await fetch('/api/trade-signals');
        const json = await res.json();
        if (json.status === 'ok') {
            _tradeSignalsData = json.data || [];
            _renderTradeSignals(_tradeSignalsData);
        }
    } catch (err) {
        listEl.innerHTML = '<div class="activity-empty" style="color:var(--text-secondary)">AI Analysis currently unavailable</div>';
    }
}

function _renderTradeSignals(data) {
    const listEl = document.getElementById('tradeSignalsList');
    if (!listEl) return;

    if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No trade signals detected at the moment.</div>';
        return;
    }

    // Limit to top 3 for the home view
    const top3 = data.slice(0, 3);
    listEl.innerHTML = `<div class="ts-grid">` + top3.map(s => {
        // Signal Badge
        let sigClass = "ts-badge-neutral";
        if (s.signal === "BUY" || s.signal === "ADD" || s.signal === "STRONG BUY") sigClass = "ts-badge-buy";
        if (s.signal === "SELL" || s.signal === "REDUCE" || s.signal === "STRONG SELL") sigClass = "ts-badge-sell";

        // Conviction Badge
        let convClass = "ts-badge-neutral";
        if (s.conviction === "HIGH") convClass = "ts-badge-high";

        // Format prices
        const cMap = { 'USD': '$', 'GBP': '£', 'EUR': '€', 'GBX': 'p' };
        const cSym = cMap[s.currency] || '$';
        const fmtPri = p => {
            if (p == null) return '—';
            if (s.currency === 'GBX') return 'p' + p.toFixed(2);
            return cSym + p.toFixed(2);
        };
        const fpEntry = fmtPri(s.entry);
        const fpTarget = fmtPri(s.target);
        const fpStop = fmtPri(s.stop);

        const isPos = s.exp_return > 0;
        const expRetClass = isPos ? 'pos' : 'neg';
        const expRetStr = s.exp_return != null ? `${isPos ? '+' : ''}${s.exp_return.toFixed(1)}% expected` : '—';

        return `<div class="ts-card trade-signal-card">
            <button class="signal-exclude-btn" onclick="excludeTicker('${esc(s.ticker)}')" title="Exclude from signals">
                <span class="material-symbols-outlined" style="font-size:16px">visibility_off</span>
            </button>
            <div class="ts-card-top">
                <div class="ts-ticker-wrap">
                    <span class="ts-ticker">${esc(s.ticker)}</span>
                </div>
                <div class="ts-badges">
                    <span class="ts-badge ${sigClass}">${esc(s.signal)}</span>
                    <span class="ts-badge ${convClass}">${esc(s.conviction)}</span>
                </div>
            </div>
            <div class="ts-prices-row">
                <div class="ts-price-block">
                    <span class="ts-price-lbl">ENTRY</span>
                    <span class="ts-price-val">${fpEntry}</span>
                </div>
                <div class="ts-price-block target">
                    <span class="ts-price-lbl">◎ TARGET</span>
                    <span class="ts-price-val target-val">${fpTarget}</span>
                </div>
                <div class="ts-price-block stop">
                    <span class="ts-price-lbl">⤓ STOP</span>
                    <span class="ts-price-val stop-val">${fpStop}</span>
                </div>
            </div>
            <div class="ts-card-bot">
                <span class="ts-expected ${expRetClass}">${expRetStr}</span>
                <span class="ts-timeframe"><span class="material-symbols-outlined" style="font-size:12px;margin-right:2px">schedule</span>${esc(s.timeframe)}</span>
            </div>
        </div>`;
    }).join('') + `</div>`;
}

/* ─── Trade Signals Sidebar & Exclusions ─────────────────────────────────── */

function openSignalsSidebar() {
    document.getElementById('signalsSidebar').classList.add('active');
    document.getElementById('signalsSidebarOverlay').classList.add('active');
    switchSignalsTab('signals');
}

function closeSignalsSidebar() {
    document.getElementById('signalsSidebar').classList.remove('active');
    document.getElementById('signalsSidebarOverlay').classList.remove('active');
}

async function switchSignalsTab(tab) {
    const tabs = document.querySelectorAll('.ss-tab');
    tabs.forEach(t => t.classList.toggle('active', t.id === `ssTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`));

    const signalsList = document.getElementById('ssListSignals');
    const excludedList = document.getElementById('ssListExcluded');

    if (tab === 'signals') {
        signalsList.style.display = 'flex';
        excludedList.style.display = 'none';
        _renderFullSignals();
    } else {
        signalsList.style.display = 'none';
        excludedList.style.display = 'flex';
        loadExcludedTickers();
    }
}

function _renderFullSignals() {
    const listEl = document.getElementById('ssListSignals');
    if (!listEl) return;

    const data = _tradeSignalsData || [];
    if (data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No signals available.</div>';
        return;
    }

    let html = `
        <table class="ss-table">
            <thead>
                <tr>
                    <th class="col-ticker">Ticker</th>
                    <th class="col-signal">
                        <div class="ss-header-content">
                            Signal 
                            <span class="material-symbols-outlined header-info-icon" title="Overall recommendation based on technical and fundamental data.">info</span>
                        </div>
                    </th>
                    <th class="col-conviction">
                        <div class="ss-header-content">
                            Conviction
                            <span class="material-symbols-outlined header-info-icon" title="Confidence level in the target based on analyst consensus.">info</span>
                        </div>
                    </th>
                    <th class="col-price">
                        <div class="ss-header-content">
                            Entry
                            <span class="material-symbols-outlined header-info-icon" title="The suggested price range to buy the stock.">info</span>
                        </div>
                    </th>
                    <th class="col-price">
                        <div class="ss-header-content">
                            Max
                            <span class="material-symbols-outlined header-info-icon" title="The 12-month high analyst price target.">info</span>
                        </div>
                    </th>
                    <th class="col-price">
                        <div class="ss-header-content">
                            Avg
                            <span class="material-symbols-outlined header-info-icon" title="The 12-month median analyst price target.">info</span>
                        </div>
                    </th>
                    <th class="col-price">
                        <div class="ss-header-content">
                            Min
                            <span class="material-symbols-outlined header-info-icon" title="The 12-month low analyst price target.">info</span>
                        </div>
                    </th>
                    <th class="col-price">
                        <div class="ss-header-content">
                            Stop
                            <span class="material-symbols-outlined header-info-icon" title="Recommended stop-loss price to limit downside risk.">info</span>
                        </div>
                    </th>
                    <th class="col-return">
                        <div class="ss-header-content">
                            Exp.
                            <span class="material-symbols-outlined header-info-icon" title="Potential profit based on Current Price vs Target Price.">info</span>
                        </div>
                    </th>
                    <th class="col-actions"></th>
                </tr>
            </thead>
            <tbody>
    `;

    html += data.map(s => {
        let sigClass = "ts-badge-neutral";
        if (s.signal === "BUY" || s.signal === "ADD" || s.signal === "STRONG BUY") sigClass = "ts-badge-buy";
        if (s.signal === "SELL" || s.signal === "REDUCE" || s.signal === "STRONG SELL") sigClass = "ts-badge-sell";

        // Conviction Badge
        let convClass = "ts-badge-neutral";
        if (s.conviction === "HIGH") convClass = "ts-badge-high";

        const cMap = { 'USD': '$', 'GBP': '£', 'EUR': '€', 'GBX': 'p' };
        const cSym = cMap[s.currency] || '$';
        const fmtPri = p => (p == null) ? '—' : (s.currency === 'GBX' ? 'p' + p.toFixed(2) : cSym + p.toFixed(2));

        return `
            <tr>
                <td class="col-ticker">${esc(s.ticker)}</td>
                <td class="col-signal">
                    <span class="ts-badge ${sigClass}">${esc(s.signal)}</span>
                </td>
                <td class="col-conviction">
                    <span class="ts-badge ${convClass}">${esc(s.conviction)}</span>
                </td>
                <td class="col-price">${fmtPri(s.entry)}</td>
                <td class="col-price" style="color:var(--green); font-weight:600">${fmtPri(s.max_target)}</td>
                <td class="col-price" style="color:var(--green); font-weight:600">${fmtPri(s.target)}</td>
                <td class="col-price" style="color:var(--green); font-weight:600">${fmtPri(s.min_target)}</td>
                <td class="col-price" style="color:var(--red); font-weight:600">${fmtPri(s.stop)}</td>
                <td class="col-return ${s.exp_return > 0 ? 'pos' : 'neg'}">
                    ${s.exp_return > 0 ? '+' : ''}${s.exp_return?.toFixed(1)}%
                </td>
                <td class="col-actions">
                    <button class="ss-exclude-icon-btn" onclick="excludeTicker('${esc(s.ticker)}')" title="Exclude from signals">
                        <span class="material-symbols-outlined" style="font-size:18px">visibility_off</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    html += `</tbody></table>`;
    listEl.innerHTML = html;
}

function _showConfirmModal({ icon = '', title, body, okLabel, danger = false }) {
    return new Promise(resolve => {
        const overlay = document.getElementById('confirmModalOverlay');
        const modal = document.getElementById('confirmModal');
        document.getElementById('confirmModalIcon').textContent = icon;
        document.getElementById('confirmModalTitle').textContent = title;
        document.getElementById('confirmModalBody').textContent = body;
        const okBtn = document.getElementById('confirmModalOk');
        okBtn.textContent = okLabel;
        okBtn.classList.toggle('danger', danger);

        const close = result => {
            overlay.classList.remove('open');
            modal.classList.remove('open');
            okBtn.removeEventListener('click', onOk);
            document.getElementById('confirmModalCancel').removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onCancel);
            resolve(result);
        };
        const onOk = () => close(true);
        const onCancel = () => close(false);

        okBtn.addEventListener('click', onOk);
        document.getElementById('confirmModalCancel').addEventListener('click', onCancel);
        overlay.addEventListener('click', onCancel);

        overlay.classList.add('open');
        modal.classList.add('open');
    });
}

async function excludeTicker(ticker) {
    const confirmed = await _showConfirmModal({
        icon: '🚫',
        title: `Exclude ${ticker}?`,
        body: `${ticker} will be hidden from all trade signal lists. You can re-include it from the Excluded tab.`,
        okLabel: 'Exclude',
        danger: true,
    });
    if (!confirmed) return;
    try {
        const res = await fetch('/api/trade-signals/exclude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: ticker, excluded: true })
        });
        if (res.ok) {
            loadTradeSignals(true);
            if (document.getElementById('signalsSidebar').classList.contains('active')) {
                switchSignalsTab('signals');
            }
        }
    } catch (err) { console.error('Exclusion failed', err); }
}

async function includeTicker(ticker) {
    const confirmed = await _showConfirmModal({
        icon: '✅',
        title: `Re-include ${ticker}?`,
        body: `${ticker} will appear again in trade signal lists.`,
        okLabel: 'Re-include',
        danger: false,
    });
    if (!confirmed) return;
    try {
        const res = await fetch('/api/trade-signals/exclude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: ticker, excluded: false })
        });
        if (res.ok) {
            loadTradeSignals(true);
            loadExcludedTickers();
        }
    } catch (err) { console.error('Inclusion failed', err); }
}

async function loadExcludedTickers() {
    const listEl = document.getElementById('ssListExcluded');
    if (!listEl) return;
    _showElemLoading(listEl, 'Loading exclusions…');
    try {
        const res = await fetch('/api/trade-signals/excluded');
        const json = await res.json();
        if (json.status === 'ok' && json.data) {
            if (json.data.length === 0) {
                listEl.innerHTML = '<div class="activity-empty">No tickers excluded.</div>';
                return;
            }
            listEl.innerHTML = json.data.map(ticker => `
                <div class="ss-excluded-item">
                    <span class="ss-excluded-name">${esc(ticker)}</span>
                    <button class="ss-reinclude-btn" onclick="includeTicker('${esc(ticker)}')">Re-include</button>
                </div>
            `).join('');
        }
    } catch (err) {
        listEl.innerHTML = '<div class="activity-empty">Error loading exclusions</div>';
    }
}


/* ─── Market Signals ─────────────────────────────────────────────────────── */

let _activeSignal = 'gainers';

async function loadMarketSignals(signalType) {
    _activeSignal = signalType || _activeSignal;
    const listEl = document.getElementById('signalsList');

    // Use cached data if available for this signal type
    if (_signalsData[_activeSignal]) {
        _renderSignals(_signalsData[_activeSignal]);
        return;
    }

    if (listEl) listEl.innerHTML = '<div class="activity-empty">Loading…</div>';
    try {
        const res = await fetch(`/api/finviz/signals?type=${encodeURIComponent(_activeSignal)}`);
        const json = await res.json();
        if (json.status === 'ok') {
            _signalsData[_activeSignal] = json.data || [];
            _renderSignals(_signalsData[_activeSignal]);
        }
    } catch (err) {
        if (listEl) listEl.innerHTML = '<div class="activity-empty">Error loading signals</div>';
    }
}

function _renderSignals(data) {
    const listEl = document.getElementById('signalsList');
    if (!listEl) return;
    if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No data available</div>';
        return;
    }
    listEl.innerHTML = data.map(s => {
        const sign = s.change_pct >= 0 ? '+' : '';
        const chgCls = s.change_pct >= 0 ? 'pos' : 'neg';
        const capStr = s.market_cap ? _fmtCap(s.market_cap) : '—';
        const volStr = s.volume ? _fmtVol(s.volume) : '—';
        return `<div class="signal-item">
            <div class="signal-ticker-chip">${esc(s.ticker)}</div>
            <div class="signal-info">
                <span class="signal-company">${esc(s.company)}</span>
                <span class="signal-meta">${esc(s.sector || '—')} · Cap ${capStr} · Vol ${volStr}</span>
            </div>
            <div class="signal-right">
                <span class="signal-price">$${s.price != null ? s.price.toFixed(2) : '—'}</span>
                <span class="signal-change ${chgCls}">${sign}${s.change_pct.toFixed(2)}%</span>
            </div>
        </div>`;
    }).join('');
}

function _initSignalTabs() {
    const tabs = document.getElementById('signalTabs');
    if (!tabs || tabs._signalInit) return;
    tabs._signalInit = true;
    tabs.addEventListener('click', e => {
        const btn = e.target.closest('.signal-tab');
        if (!btn) return;
        tabs.querySelectorAll('.signal-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _signalsData[btn.dataset.signal] = null; // bust cache on tab switch
        loadMarketSignals(btn.dataset.signal);
    });
}

function _fmtCap(n) {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
    return `$${n}`;
}

function _fmtVol(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(n);
}


/* ─── Insider Trading ────────────────────────────────────────────────────── */

let _activeInsiderPeriod = 'latest';

async function loadInsiderTrading(period) {
    _activeInsiderPeriod = period || _activeInsiderPeriod;
    const listEl = document.getElementById('insiderList');

    if (_insiderData[_activeInsiderPeriod]) {
        _renderInsider(_insiderData[_activeInsiderPeriod]);
        return;
    }

    if (listEl) listEl.innerHTML = '<div class="activity-empty">Loading…</div>';
    try {
        const res = await fetch(`/api/finviz/insider?period=${encodeURIComponent(_activeInsiderPeriod)}`);
        const json = await res.json();
        if (json.status === 'ok') {
            _insiderData[_activeInsiderPeriod] = json.data || [];
            _renderInsider(_insiderData[_activeInsiderPeriod]);
        }
    } catch (err) {
        if (listEl) listEl.innerHTML = '<div class="activity-empty">Error loading insider data</div>';
    }
}

function _renderInsider(data) {
    const listEl = document.getElementById('insiderList');
    if (!listEl) return;
    if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No insider trades found</div>';
        return;
    }
    listEl.innerHTML = data.map(t => {
        const badge = t.is_buy
            ? '<span class="insider-badge insider-buy">BUY</span>'
            : '<span class="insider-badge insider-sell">SELL</span>';
        const valStr = t.value != null ? `$${_fmtVol(t.value)}` : '—';
        const sharesStr = t.shares != null ? _fmtVol(t.shares) + ' sh' : '—';
        const role = t.relationship ? t.relationship.replace(/Director/g, 'Dir').replace(/Officer/g, 'Ofcr') : '';
        return `<div class="insider-item">
            <div class="signal-ticker-chip">${esc(t.ticker || '—')}</div>
            <div class="signal-info">
                <span class="signal-company">${esc(t.insider || '—')}</span>
                <span class="signal-meta">${esc(role)} · ${esc(t.date || '—')}</span>
            </div>
            <div class="signal-right">
                ${badge}
                <span class="signal-meta" style="margin-top:2px">${sharesStr} · ${valStr}</span>
            </div>
        </div>`;
    }).join('');
}

function _initInsiderTabs() {
    const tabs = document.getElementById('insiderTabs');
    if (!tabs || tabs._insiderInit) return;
    tabs._insiderInit = true;
    tabs.addEventListener('click', e => {
        const btn = e.target.closest('.signal-tab');
        if (!btn) return;
        tabs.querySelectorAll('.signal-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _insiderData[btn.dataset.period] = null; // bust cache on tab switch
        loadInsiderTrading(btn.dataset.period);
    });
}


/* ─── Market Session Status (server-side via T212 exchange metadata) ─────── */

let _mktStatusData = null;

async function loadMarketStatus() {
    try {
        const res = await fetch('/api/market-status');
        const json = await res.json();
        if (json.status === 'ok') {
            _mktStatusData = json.data;
            _renderMarketStatus(_mktStatusData);
            _ensureMktPillListeners();
        }
    } catch (err) {
        console.warn('[marketStatus]', err);
    }
}

function _renderMarketStatus(data) {
    const nasdaqEl = document.getElementById('mkt-nasdaq');
    const lseEl = document.getElementById('mkt-lse');
    if (!nasdaqEl || !lseEl) return;

    const SESSION_LABEL = { 'open': 'Open', 'pre-market': 'Pre', 'after-hours': 'AH', 'closed': 'Closed' };
    const SESSION_CLS = { 'open': 'mkt-open', 'pre-market': 'mkt-pre', 'after-hours': 'mkt-post', 'closed': 'mkt-closed' };

    const nasdaqSession = data?.NASDAQ?.session ?? 'closed';
    const lseSession = data?.LSE?.session ?? 'closed';

    // ET time for NASDAQ, GMT for LSE
    const now = new Date();
    const etParts = {};
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).forEach(p => { if (p.type !== 'literal') etParts[p.type] = p.value; });
    const etHH = etParts.hour === '24' ? '00' : etParts.hour;
    const etStr = `${etHH}:${etParts.minute} ET`;
    const gmtStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now) + ' GMT';

    if (typeof _updateMktStatusDot === 'function') _updateMktStatusDot(nasdaqSession === 'open');

    nasdaqEl.className = `mkt-pill ${SESSION_CLS[nasdaqSession]}`;
    nasdaqEl.innerHTML =
        `<span class="mkt-dot"></span>` +
        `<span class="mkt-exch">NASDAQ</span>` +
        `<span class="mkt-sess">${SESSION_LABEL[nasdaqSession]}</span>` +
        `<span class="mkt-time">${etStr}</span>`;
    nasdaqEl.dataset.mktMeta = JSON.stringify({
        name: 'NASDAQ', session: nasdaqSession,
        tz: 'America/New_York', tzLabel: 'ET',
        sched: data?.NASDAQ?.schedule ?? {},
    });

    lseEl.className = `mkt-pill ${SESSION_CLS[lseSession]}`;
    lseEl.innerHTML =
        `<span class="mkt-dot"></span>` +
        `<span class="mkt-exch">LSE</span>` +
        `<span class="mkt-sess">${SESSION_LABEL[lseSession]}</span>` +
        `<span class="mkt-time">${gmtStr}</span>`;
    lseEl.dataset.mktMeta = JSON.stringify({
        name: 'LSE', session: lseSession,
        tz: 'Europe/London', tzLabel: 'GMT',
        sched: data?.LSE?.schedule ?? {},
    });
}

/* ─── Market Pill Tooltip ─────────────────────────────────────────────────── */

function _ensureMktPillListeners() {
    ['mkt-nasdaq', 'mkt-lse'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el._mktListened) return;
        el._mktListened = true;
        el.addEventListener('mouseenter', _mktPillEnter);
        el.addEventListener('mouseleave', _mktPillLeave);
    });
}

function _mktPillEnter(e) {
    const pill = e.currentTarget;
    let meta;
    try { meta = JSON.parse(pill.dataset.mktMeta || '{}'); } catch { return; }
    if (!meta.name) return;

    const tt = _getMktTooltip();
    tt.innerHTML = _buildMktTooltipHTML(meta);
    tt.style.display = 'block';

    requestAnimationFrame(() => {
        const pr = pill.getBoundingClientRect();
        const tr = tt.getBoundingClientRect();
        let top = pr.bottom + window.scrollY + 6;
        let left = pr.left + window.scrollX;
        if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - tr.width - 8;
        if (left < 8) left = 8;
        tt.style.top = top + 'px';
        tt.style.left = left + 'px';
    });
}

function _mktPillLeave() {
    const tt = document.getElementById('mkt-tt');
    if (tt) tt.style.display = 'none';
}

function _getMktTooltip() {
    let tt = document.getElementById('mkt-tt');
    if (!tt) {
        tt = document.createElement('div');
        tt.id = 'mkt-tt';
        tt.className = 'mkt-tt';
        document.body.appendChild(tt);
    }
    return tt;
}

function _buildMktTooltipHTML(meta) {
    const { name, session, tz, tzLabel, sched } = meta;
    const SESSION_LABEL = { 'open': 'Open', 'pre-market': 'Pre-Market', 'after-hours': 'After Hours', 'closed': 'Closed' };
    const SESSION_CLS = { 'open': 'mkt-open', 'pre-market': 'mkt-pre', 'after-hours': 'mkt-post', 'closed': 'mkt-closed' };

    const fmtTime = iso => {
        const p = {};
        new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(new Date(iso)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
        return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
    };

    const fmtDay = iso => {
        const d = new Date(iso);
        const now = new Date();
        const fmt = tz => dt => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(dt);
        const inTz = fmt(tz);
        if (inTz(d) === inTz(now)) return 'Today';
        const tom = new Date(now); tom.setDate(tom.getDate() + 1);
        if (inTz(d) === inTz(tom)) return 'Tomorrow';
        return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
    };

    let html = `<div class="mkt-tt-name">${name}</div>`;
    html += `<div class="mkt-tt-status ${SESSION_CLS[session]}">` +
        `<span class="mkt-dot"></span>${SESSION_LABEL[session] ?? session}</div>`;

    if (sched.today_open || sched.today_close) {
        html += `<div class="mkt-tt-divider"></div>`;
        html += `<div class="mkt-tt-row"><span class="mkt-tt-lbl">Today</span>`;
        if (sched.today_open && sched.today_close) {
            html += `<span class="mkt-tt-val">${fmtTime(sched.today_open)} – ${fmtTime(sched.today_close)} ${tzLabel}</span>`;
        } else if (sched.today_open) {
            html += `<span class="mkt-tt-val">Opens ${fmtTime(sched.today_open)} ${tzLabel}</span>`;
        } else {
            html += `<span class="mkt-tt-val">Closes ${fmtTime(sched.today_close)} ${tzLabel}</span>`;
        }
        html += `</div>`;
    }

    if (sched.upcoming && sched.upcoming.length > 0) {
        html += `<div class="mkt-tt-divider"></div>`;
        html += `<div class="mkt-tt-section">Upcoming <span class="mkt-tt-tz">${tzLabel}</span></div>`;
        html += `<table class="mkt-tt-tbl">`;
        sched.upcoming.forEach(pair => {
            const refDate = pair.open || pair.close;
            if (!refDate) return;
            let timeStr = '';
            if (pair.open && pair.close) {
                timeStr = `${fmtTime(pair.open)} – ${fmtTime(pair.close)}`;
            } else if (pair.open) {
                timeStr = fmtTime(pair.open);
            } else {
                timeStr = `– ${fmtTime(pair.close)}`;
            }
            html += `<tr>` +
                `<td class="mkt-tt-day">${fmtDay(refDate)}</td>` +
                `<td class="mkt-tt-time">${timeStr}</td>` +
                `</tr>`;
        });
        html += `</table>`;
    }

    return html;
}

/* ─── Market Indicators: S&P 500 (MA125) + VIX (MA50) ───────────────────── */

let _marketIndData = null;

async function loadMarketIndicators() {
    try {
        const res = await fetch('/api/market-indicators');
        const json = await res.json();
        if (json.status !== 'ok' || !_mktDataValid(json.data)) return;
        _marketIndData = json.data;
        // If the panel is already open, refresh it
        if (document.getElementById('fgPanel')?.classList.contains('open')) {
            _renderFGPanelContent(_marketIndData);
        }
    } catch (err) {
        console.warn('[marketInd]', err);
    }
}

function openFGPanel() {
    document.getElementById('fgPanel').classList.add('open');
    document.getElementById('fgPanelBackdrop').classList.add('active');
    if (_marketIndData) {
        _renderFGPanelContent(_marketIndData);
    }
}

function closeFGPanel() {
    document.getElementById('fgPanel').classList.remove('open');
    document.getElementById('fgPanelBackdrop').classList.remove('active');
}

const _FG_IND_CONFIGS = [
    {
        key: 'GSPC', label: 'S&P 500', maLabel: 'MA125',
        lineColor: '#3b82f6', fillColor: 'rgba(59,130,246,0.13)',
        fmt: v => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
        invertPct: false,
        desc: (pctTxt, above) =>
            `S&P 500 is <strong>${pctTxt}</strong> ${above ? 'above' : 'below'} its 125-day moving average. ` +
            `${above ? 'Trading above the MA signals bullish momentum — a Greed indicator.' : 'Trading below the MA signals bearish pressure — a Fear indicator.'}`,
    },
    {
        key: 'VIX', label: 'VIX', maLabel: 'MA50',
        lineColor: '#f59e0b', fillColor: 'rgba(245,158,11,0.13)',
        fmt: v => v.toFixed(2),
        invertPct: true,
        desc: (pctTxt, above) =>
            `VIX is <strong>${pctTxt}</strong> ${above ? 'above' : 'below'} its 50-day moving average. ` +
            `${above ? 'Elevated volatility above the MA signals Fear in the market.' : 'Volatility below the MA signals relative calm — a Greed indicator.'}`,
    },
];

function _renderFGPanelContent(data) {
    const el = document.getElementById('fgPanelContent');
    if (!el) return;

    el.innerHTML = _FG_IND_CONFIGS.map((cfg, i) => {
        const d = data[cfg.key];
        if (!d) return `<div class="fg-panel-section"><div class="fg-panel-ind-title">${esc(cfg.label)}</div><div class="activity-empty">Data unavailable</div></div>`;

        const val = d.current != null ? cfg.fmt(d.current) : '—';
        const maVal = d.current_ma != null ? cfg.fmt(d.current_ma) : '—';
        const pct = d.pct_vs_ma;
        const pctTxt = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '';
        const positive = cfg.invertPct ? pct < 0 : pct >= 0;
        const pctBg = pct != null ? (positive ? '#4caf50' : '#e57373') : 'transparent';
        const above = pct != null && pct >= 0;
        const divider = i > 0 ? '<div class="fg-panel-divider"></div>' : '';

        return `${divider}
            <div class="fg-panel-section">
                <div class="fg-panel-ind-header">
                    <span class="fg-panel-ind-title">${esc(cfg.label)}</span>
                    <div class="fg-panel-ind-values">
                        <span class="fg-panel-val">${esc(val)}</span>
                        ${pctTxt ? `<span class="fg-ind-pct" style="background:${pctBg}">${esc(pctTxt)}</span>` : ''}
                        <span class="fg-panel-ma-label">${esc(cfg.maLabel)}: ${esc(maVal)}</span>
                    </div>
                </div>
                <canvas class="fg-panel-canvas" id="fp-${cfg.key.toLowerCase()}-chart"></canvas>
                <div class="fg-panel-desc">${cfg.desc(pctTxt, above)}</div>
            </div>`;
    }).join('');

    requestAnimationFrame(() => {
        _FG_IND_CONFIGS.forEach(cfg => {
            const d = data[cfg.key];
            if (d) _drawIndicatorChart(`fp-${cfg.key.toLowerCase()}-chart`, d.values, d.ma, cfg.lineColor, cfg.fillColor);
        });
    });
}

function _drawIndicatorChart(canvasId, values, maValues, lineColor, fillColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !values || values.length < 2) return;

    const W = canvas.offsetWidth || 372;
    const H = canvas.offsetHeight || 120;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 3, right: 2, bottom: 3, left: 2 };
    const w = W - pad.left - pad.right;
    const h = H - pad.top - pad.bottom;

    const allVals = [...values, ...maValues.filter(v => v != null)];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = (maxV - minV) || 1;

    const xOf = i => pad.left + (i / (values.length - 1)) * w;
    const yOf = v => pad.top + (1 - (v - minV) / range) * h;

    // MA line (dashed, muted)
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const maColor = isDark ? 'rgba(160,160,170,0.55)' : 'rgba(100,100,110,0.45)';
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < maValues.length; i++) {
        if (maValues[i] == null) continue;
        const x = xOf(i), y = yOf(maValues[i]);
        if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.strokeStyle = maColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Value line
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
        const x = xOf(i), y = yOf(values[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill under value line
    ctx.lineTo(xOf(values.length - 1), pad.top + h);
    ctx.lineTo(pad.left, pad.top + h);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // End-point dot
    ctx.beginPath();
    ctx.arc(xOf(values.length - 1), yOf(values[values.length - 1]), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
}

async function loadActivity() {
    try {
        const res = await fetch('/api/pcombined/activity');
        const json = await res.json();
        _homeActivityData = json.data || [];
        _renderHomeActivity(_homeActivityData);
    } catch (err) {
        document.getElementById('activityList').innerHTML =
            '<div class="activity-empty">Error loading activity</div>';
    }
}

function _renderHomeActivity(data) {
    const listEl = document.getElementById('activityList');
    if (data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No recent activity found.</div>';
        return;
    }
    const badge = document.getElementById('activityBadge');
    if (badge) { badge.textContent = data.length; badge.style.display = 'block'; }

    listEl.innerHTML = data.map(order => {
        const ticker = (order.ticker || '').split('_')[0];
        const company = order.company_name || ticker || 'Unknown stock';
        const qty = order.filledQuantity || 0;
        const price = order.fillPrice || 0;
        const date = order.dateExecuted || order.dateCreated || '';
        const status = (order.status || '').toUpperCase();
        const pid = order._pid || '1';
        const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : { '1': 'Chimbu', '2': 'Poornima' };
        const ownerName = names[pid] || pid;
        const isCancelled = status === 'CANCELLED' || status === 'REJECTED';
        const typeUpper = (order.type || '').toUpperCase();
        const isSell = (order.side || '').toUpperCase() === 'SELL' || typeUpper.includes('SELL');
        const dotClass = isCancelled ? 'activity-dot-cancel' : (isSell ? 'activity-dot-sell' : 'activity-dot-buy');
        const actionWord = isCancelled ? 'Cancelled' : (isSell ? 'Sold' : 'Bought');
        const timeStr = date ? new Date(date).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '—';
        const value = fmt.currency(order.filledValue || (qty * price));
        return `
            <div class="activity-item">
                <div class="activity-dot ${dotClass}"></div>
                <div class="activity-content">
                    <span class="ov-card-pid-tag ov-tag-p${pid}">${ownerName}</span>
                    <span class="activity-company">${esc(company)}</span>
                    <span class="activity-ticker activity-ticker-sm">${esc(ticker)}</span>
                    <div class="activity-desc">${actionWord} · ${fmt.number(qty, 4)} shares</div>
                    <div class="activity-time">${timeStr}</div>
                </div>
                <div class="activity-amount ${isCancelled ? 'neg' : ''}">${value}</div>
            </div>`;
    }).join('');
}

async function loadRecentDividends() {
    const listEl = document.getElementById('upcomingList');
    if (!listEl) return;
    try {
        const res = await fetch('/api/pcombined/recent-dividends');
        const json = await res.json();
        _homeDividendData = json.data || [];
        _renderHomeDividends(_homeDividendData);
    } catch (err) {
        listEl.innerHTML = '<div class="activity-empty">Error loading dividends</div>';
    }
}

function _renderHomeDividends(data) {
    const listEl = document.getElementById('upcomingList');
    if (!listEl) return;
    if (data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No recent dividends found.</div>';
        return;
    }
    listEl.innerHTML = data.map(div => {
        const ticker = (div.ticker || '').split('_')[0];
        const amount = fmt.currency(div.amount || 0);
        const date = div.paidOn || div.date || '—';
        const pid = div._pid || '1';
        const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : { '1': 'Chimbu', '2': 'Poornima' };
        const ownerName = names[pid] || pid;
        return `
            <div class="activity-item">
                <div class="activity-dot activity-dot-div"></div>
                <div class="activity-content">
                    <span class="ov-card-pid-tag ov-tag-p${pid}">${ownerName}</span>
                    <span class="activity-ticker">${esc(ticker)}</span>
                    <div class="activity-desc">Dividend paid</div>
                    <div class="activity-time">${esc(date)}</div>
                </div>
                <div class="activity-amount pos">${amount}</div>
            </div>`;
    }).join('');
}

/* ─── Dividend Calendar ──────────────────────────────────────────────────── */
let _divCalEntries = [];

// sessionStorage key — persists across same-tab page navigations
const _DIV_CAL_CACHE_KEY = 'divCal:v6';
const _DIV_CAL_TTL_MS = 43200 * 1000; // 12 hours — matches server DIV_REFRESH_INTERVAL

function _divCalSave(entries, lastRefresh) {
    try {
        sessionStorage.setItem(_DIV_CAL_CACHE_KEY, JSON.stringify({ ts: Date.now(), entries, lastRefresh }));
    } catch (_) { }
}

function _divCalLoad() {
    try {
        const raw = sessionStorage.getItem(_DIV_CAL_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts > _DIV_CAL_TTL_MS) {
            sessionStorage.removeItem(_DIV_CAL_CACHE_KEY);
            return null;
        }
        return parsed;
    } catch (_) { return null; }
}

function _divCalAgeLabel(lastRefreshTs) {
    if (!lastRefreshTs) return 'Refreshes every 12h';
    const mins = Math.round((Date.now() / 1000 - lastRefreshTs) / 60);
    if (mins < 2) return 'Just refreshed';
    if (mins < 60) return `Data ${mins}m old · 12h refresh`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h old · 12h refresh`;
}

function _divCalSetSubtitle(lastRefreshTs) {
    const sub = document.querySelector('.widget-dividends .panel-subtitle');
    if (sub) sub.textContent = _divCalAgeLabel(lastRefreshTs);
}

async function loadDividendCalendar() {
    const el = document.getElementById('divCalendarList');
    if (!el) return;

    // Restore from sessionStorage immediately on back-navigation
    const cached = _divCalLoad();
    if (cached && cached.entries && cached.entries.length) {
        _divCalEntries = cached.entries;
        _divCalSetSubtitle(cached.lastRefresh);
        _renderDividendCalendar(_divCalEntries);
        return;
    }

    el.innerHTML = `
      <div class="skel-card"><div class="skel-card-header"><div class="skeleton skel-line skel-w-30"></div><div class="skeleton skel-amount"></div></div><div class="skel-card-row"><div class="skeleton skel-line skel-w-45"></div><div class="skeleton skel-line skel-w-45"></div></div></div>
      <div class="skel-card"><div class="skel-card-header"><div class="skeleton skel-line skel-w-35"></div><div class="skeleton skel-amount"></div></div><div class="skel-card-row"><div class="skeleton skel-line skel-w-40"></div><div class="skeleton skel-line skel-w-40"></div></div></div>
    `;

    try {
        const res = await fetch('/api/upcoming-dividends');
        const json = await res.json();

        if (json.status !== 'ok') {
            el.innerHTML = `<div class="activity-empty">${esc(json.message || 'Not available')}</div>`;
            return;
        }

        _divCalEntries = json.data || [];
        _divCalSetSubtitle(json.last_refresh);

        if (!_divCalEntries.length) {
            const waiting = (json.total > 0 && json.cached === 0);
            el.innerHTML = waiting
                ? '<div class="activity-empty">Background refresh in progress — check back shortly.</div>'
                : '<div class="activity-empty">No upcoming dividends for held US stocks.</div>';
            return;
        }

        _renderDividendCalendar(_divCalEntries);
        _divCalSave(_divCalEntries, json.last_refresh);
    } catch (err) {
        console.error('[divCal] Error:', err);
        el.innerHTML = '<div class="activity-empty">Error loading dividend calendar.</div>';
    }
}

function _renderDividendCalendar(data) {
    const el = document.getElementById('divCalendarList');
    if (!el) return;

    if (!data.length) {
        el.innerHTML = '<div class="activity-empty">No upcoming dividends for held stocks.</div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fmtDate = dt => dt
        ? new Date(dt + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';

    const items = data.map((d, i) => {
        const payDate = new Date((d.payment_date || d.ex_dividend_date) + 'T00:00:00');
        const diff = Math.round((payDate - today) / 86400000);

        const isPaid = diff < 0;
        let status, statusClass;
        if (isPaid) { status = 'Paid'; statusClass = 'div-tl-status--paid'; }
        else { status = 'Pending Payout'; statusClass = 'div-tl-status--pending'; }

        let relLabel;
        if (isPaid) relLabel = 'PAID';
        else if (diff === 0) relLabel = 'TODAY';
        else if (diff === 1) relLabel = 'TOMORROW';
        else relLabel = `IN ${diff} DAYS`;

        const month = payDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const day = payDate.getDate();
        const perShare = d.amount_per_share > 0 ? `$${d.amount_per_share.toFixed(4)}` : '—';
        const payout = d.expected_payout > 0 ? `Est. $${d.expected_payout.toFixed(2)}` : '';
        const isLast = i === data.length - 1;

        return `
        <div class="div-tl-item${isPaid ? ' div-tl-item--paid' : ''}">
          <div class="div-tl-left">
            <div class="div-tl-date-badge${isPaid ? ' div-tl-date-badge--paid' : ''}">
              <span class="div-tl-month">${month}</span>
              <span class="div-tl-day">${day}</span>
            </div>
            <span class="div-tl-relative">${relLabel}</span>
            ${isLast ? '' : '<div class="div-tl-line"></div>'}
          </div>
          <div class="div-tl-card">
            <div class="div-tl-card-top">
              <div class="div-tl-identity">
                ${_logoImg(d.ticker, 'div-tl-logo')}
                <div class="div-tl-name-stack">
                  <span class="div-tl-ticker">${esc(d.ticker)}</span>
                  <div class="div-tl-company-block">
                    <span class="div-tl-company">${esc(d.company_name)}</span>
                    ${payout ? `<span class="div-tl-type">${perShare} per share</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="div-tl-amount-block">
                <span class="div-tl-value">${esc(payout)}</span>
              </div>
            </div>
            <div class="div-tl-card-bottom">
              <div class="div-tl-dates">
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Ex-Date</span>
                  <span class="div-tl-date-val">${fmtDate(d.ex_dividend_date)}</span>
                </div>
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Pay Date</span>
                  <span class="div-tl-date-val">${fmtDate(d.payment_date)}</span>
                </div>
              </div>
              <span class="div-tl-status ${statusClass}">${status}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="div-timeline">${items}</div>`;
}

/* ─── Upcoming Events (earnings + dividends in next 7 days) ─────────────── */

async function loadUpcomingEvents() {
    const el = document.getElementById('upcomingEventsList');
    if (!el) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() + 7);

    function toYMD(d) {
        return d.toISOString().slice(0, 10);
    }
    const todayStr = toYMD(today);
    const cutoffStr = toYMD(cutoff);

    try {
        const [earnResult, divResult] = await Promise.allSettled([
            fetch('/api/earnings').then(r => r.json()),
            fetch('/api/upcoming-dividends').then(r => r.json()),
        ]);

        const events = [];

        // ── Earnings ──────────────────────────────────────────────────────
        const earnData = (earnResult.status === 'fulfilled' && earnResult.value.status === 'ok')
            ? (earnResult.value.data || []) : [];
        for (const e of earnData) {
            const d = e.date || '';
            if (d < todayStr || d > cutoffStr) continue;
            const q = e.quarter ? `Q${e.quarter}` : '';
            const y = e.year ? `${e.year}` : '';
            const label = [q, y].filter(Boolean).join(' ') + ' Earnings';
            events.push({ date: d, ticker: e.symbol || '—', company: e._company_name || e.symbol, type: 'earnings', label });
        }

        // ── Dividends ─────────────────────────────────────────────────────
        const divData = (divResult.status === 'fulfilled' && divResult.value.status === 'ok')
            ? (divResult.value.data || []) : [];
        for (const d of divData) {
            const exDate = d.ex_dividend_date || '';
            const payDate = d.payment_date || '';
            if (exDate >= todayStr && exDate <= cutoffStr) {
                events.push({ date: exDate, ticker: d.ticker, company: d.company_name || d.ticker, type: 'ex-date', label: 'Ex-Dividend' });
            }
            if (payDate >= todayStr && payDate <= cutoffStr) {
                events.push({ date: payDate, ticker: d.ticker, company: d.company_name || d.ticker, type: 'pay-date', label: 'Dividend Pay' });
            }
        }

        events.sort((a, b) => a.date.localeCompare(b.date));
        _renderUpcomingEvents(events);
    } catch (err) {
        if (el) el.innerHTML = '<div class="activity-empty">Error loading events.</div>';
    }
}

function _renderUpcomingEvents(events) {
    const el = document.getElementById('upcomingEventsList');
    if (!el) return;

    if (!events.length) {
        el.innerHTML = '<div class="activity-empty">No upcoming events in the next 7 days.</div>';
        return;
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const day = String(d.getDate()).padStart(2, '0');
        return `${day} ${MONTHS[d.getMonth()]}`;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    function isToday(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.getTime() === today.getTime();
    }

    el.innerHTML = `<div class="ue-table">
        <div class="ue-header">
            <span class="ue-col-date">Date</span>
            <span class="ue-col-ticker">Ticker</span>
            <span class="ue-col-event">Event</span>
        </div>
        ${events.map(ev => {
        const todayCls = isToday(ev.date) ? ' ue-row-today' : '';
        const badgeCls = ev.type === 'earnings' ? 'ue-badge-earnings'
            : ev.type === 'ex-date' ? 'ue-badge-exdate'
                : 'ue-badge-paydate';
        return `<div class="ue-row${todayCls}">
                <span class="ue-col-date">${fmtDate(ev.date)}</span>
                <span class="ue-col-ticker" title="${esc(ev.company)}">${esc(ev.ticker)}</span>
                <span class="ue-col-event"><span class="ue-badge ${badgeCls}">${esc(ev.label)}</span></span>
            </div>`;
    }).join('')}
    </div>`;
}

/* ─── Upcoming Earnings ──────────────────────────────────────────────────── */
let _earningsData = null;

async function loadEarnings() {
    try {
        const res = await fetch('/api/earnings');
        const json = await res.json();
        _earningsData = json.data || [];
        _renderEarnings(_earningsData);
    } catch (err) {
        const el = document.getElementById('earningsList');
        if (el) el.innerHTML = '<div class="activity-empty">Error loading earnings</div>';
    }
}

function _renderEarnings(data) {
    const el = document.getElementById('earningsList');
    if (!el) return;

    if (!data || !data.length) {
        el.innerHTML = '<div class="activity-empty">No upcoming earnings found for held US stocks.</div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = data.map((e, i) => {
        const symbol = e.symbol || '—';
        const company = e._company_name || symbol;
        const dateStr = e.date || '';
        const quarter = e.quarter ? `Q${e.quarter}` : '';
        const year = e.year || '';
        const quarterLabel = (quarter && year) ? `${quarter} ${year}` : (quarter || year || '');

        // Use the dateStr to create the badge and relative labels
        const earnDate = dateStr ? new Date(dateStr + 'T00:00:00') : null;
        const diff = earnDate ? Math.round((earnDate - today) / 86400000) : null;

        const isPast = diff !== null && diff < 0;
        const month = earnDate ? earnDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '—';
        const day = earnDate ? earnDate.getDate() : '—';

        // Relative Label Logic
        let relLabel = '';
        if (diff !== null) {
            if (diff < 0) relLabel = 'PAST';
            else if (diff === 0) relLabel = 'TODAY';
            else if (diff === 1) relLabel = 'TOMORROW';
            else relLabel = `IN ${diff} DAYS`;
        }

        const hourLabel = e.hour === 'bmo' ? 'Pre-market' : e.hour === 'amc' ? 'After-hours' : '';
        const epsEst = e.epsEstimate != null ? `$${Number(e.epsEstimate).toFixed(2)}` : '—';
        const revEst = e.revenueEstimate != null ? _fmtRevenue(e.revenueEstimate) : '';
        const isLast = i === data.length - 1;

        return `
        <div class="div-tl-item${isPast ? ' div-tl-item--paid' : ''}">
          <div class="div-tl-left">
            <div class="div-tl-date-badge${isPast ? ' div-tl-date-badge--paid' : ''}">
              <span class="div-tl-month">${month}</span>
              <span class="div-tl-day">${day}</span>
            </div>
            <span class="div-tl-relative">${relLabel}</span>
            ${isLast ? '' : '<div class="div-tl-line"></div>'}
          </div>
          <div class="div-tl-card">
            <div class="div-tl-card-top">
              <div class="div-tl-identity">
                ${_logoImg(symbol, 'div-tl-logo')}
                <div class="div-tl-name-stack">
                  <span class="div-tl-ticker">${esc(symbol)}</span>
                  <div class="div-tl-company-block">
                    <span class="div-tl-company">${esc(company)}</span>
                  </div>
                </div>
              </div>
                <div class="div-tl-date-col">
              <div class="div-tl-dates">
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Revenue Est.</span>
                  <span class="div-tl-date-val">${revEst || '—'}</span>
                </div>  
            </div>
            </div>
            </div>
            <div class="div-tl-card-bottom">
            <div class="div-tl-date-col">
                <span class="div-tl-type">${esc(quarterLabel)} ${hourLabel ? `• ${hourLabel}` : ''}</span>
                </div>
              </div>    
            </div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="div-timeline">${items}</div>`;
}

function _fmtRevenue(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + String(n);
}

/* ─── Fear & Greed Index ─────────────────────────────────────────────────── */
function _fgScoreColor(score) {
    if (score == null) return 'var(--text-muted)';
    if (score <= 25) return '#ef4444';
    if (score <= 45) return '#f97316';
    if (score <= 55) return '#94a3b8';
    if (score <= 75) return '#22c55e';
    return '#10b981';
}

function _fgScoreToRating(score) {
    if (score == null) return '';
    if (score <= 25) return 'Extreme Fear';
    if (score <= 45) return 'Fear';
    if (score <= 55) return 'Neutral';
    if (score <= 75) return 'Greed';
    return 'Extreme Greed';
}

function _fgFmtRating(r) {
    if (!r) return '';
    return r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function loadFearGreed() {
    try {
        const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata');
        const json = await res.json();
        const fg = json.fear_and_greed;
        if (!fg) return;
        _renderFearGreed(fg);
        resetClock('rc-fg');
    } catch (err) {
        console.warn('Fear & Greed fetch failed:', err);
    }
}

function _renderFearGreed(fg) {
    const score = fg.score != null ? Math.round(fg.score) : null;
    const rating = _fgFmtRating(fg.rating) || _fgScoreToRating(score);

    const scoreEl = document.getElementById('fg-score');
    const ratingEl = document.getElementById('fg-rating');
    if (scoreEl) { scoreEl.textContent = score ?? '—'; scoreEl.style.color = _fgScoreColor(score); }
    if (ratingEl) { ratingEl.textContent = rating; ratingEl.style.color = _fgScoreColor(score); }

    requestAnimationFrame(() => drawFGGauge('fg-gauge', score));

    const updEl = document.getElementById('fg-updated');
    if (updEl) {
        const ts = fg.timestamp ? new Date(fg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        updEl.textContent = ts;
    }

    const histEl = document.getElementById('fg-history');
    if (histEl) {
        const metrics = [
            { label: 'Prev. close', val: fg.previous_close, rating: fg.previous_close_rating },
            { label: '1 week ago', val: fg.previous_1_week, rating: fg.previous_1_week_rating },
            { label: '1 month ago', val: fg.previous_1_month, rating: fg.previous_1_month_rating },
            { label: '1 year ago', val: fg.previous_1_year, rating: fg.previous_1_year_rating },
        ];
        histEl.innerHTML = metrics.map(m => {
            const v = m.val != null ? Math.round(m.val) : '—';
            const color = m.val != null ? _fgScoreColor(m.val) : 'var(--text-muted)';
            const sublabel = m.rating ? _fgFmtRating(m.rating) : _fgScoreToRating(m.val != null ? Math.round(m.val) : null);
            return `
                <div class="fg-hist-row">
                    <div class="fg-hist-left">
                        <span class="fg-hist-label">${esc(m.label)}</span>
                        <span class="fg-hist-sublabel">${esc(sublabel)}</span>
                    </div>
                    <span class="fg-hist-val" style="background:${color}">${v}</span>
                </div>`;
        }).join('');
    }
}

function drawFGGauge(canvasId, score) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const W = canvas.offsetWidth || 160;
    const H = canvas.offsetHeight || 86;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = W / 2;
    const cy = H - 4;
    const outerR = Math.min(W / 2 - 4, H - 6);
    const innerR = outerR * 0.58;

    // Sectors: [startScore, endScore, color]
    const sectors = [
        [0, 25, '#dc2626'],
        [25, 45, '#ea580c'],
        [45, 55, '#475569'],
        [55, 75, '#16a34a'],
        [75, 100, '#15803d'],
    ];
    const gapRad = (1.5 / 100) * Math.PI;

    for (const [s, e, color] of sectors) {
        const sa = Math.PI + (s / 100) * Math.PI + gapRad / 2;
        const ea = Math.PI + (e / 100) * Math.PI - gapRad / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, sa, ea, false);
        ctx.arc(cx, cy, innerR, ea, sa, true);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    if (score != null) {
        const needleAngle = Math.PI + (score / 100) * Math.PI;
        const needleLen = outerR * 0.84;
        const tipX = cx + Math.cos(needleAngle) * needleLen;
        const tipY = cy + Math.sin(needleAngle) * needleLen;
        const perpAngle = needleAngle + Math.PI / 2;
        const bw = 2.5;
        const bx1 = cx + Math.cos(perpAngle) * bw;
        const by1 = cy + Math.sin(perpAngle) * bw;
        const bx2 = cx - Math.cos(perpAngle) * bw;
        const by2 = cy - Math.sin(perpAngle) * bw;

        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        const needleColor = isDark ? '#e0e0e0' : '#1a1a2e';

        ctx.beginPath();
        ctx.moveTo(bx1, by1);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(bx2, by2);
        ctx.closePath();
        ctx.fillStyle = needleColor;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = needleColor;
        ctx.fill();
    }
}

/* ─── Currency re-render ─────────────────────────────────────────────────── */
function onCurrencyChange() {
    if (_overviewData) renderOverview(_overviewData);
    if (_homeActivityData) _renderHomeActivity(_homeActivityData);
    if (_homeDividendData) _renderHomeDividends(_homeDividendData);
}

/* ─── Tab initialisation (called once after DOM ready) ───────────────────── */
function initFinvizTabs() {
    _initSignalTabs();
    _initInsiderTabs();
}

/* ─── Market News ────────────────────────────────────────────────────────── */
async function loadMarketNews() {
    try {
        const res = await fetch('/api/news');
        const json = await res.json();
        if (json.status === 'ok') {
            _renderNewsGrid(json.data);
            resetClock('rc-news');
        }
    } catch (err) {
        const el = document.getElementById('newsGrid');
        if (el) el.innerHTML = '<div class="activity-empty">Error loading news</div>';
    }
}

/** Load news for the dedicated news view (called by router) */
async function loadNewsView(force = false) {
    const grid = document.getElementById('newsGrid');
    if (grid) {
        let skeletonHtml = '';
        for (let i = 0; i < 6; i++) {
            skeletonHtml += `
                <div class="news-card skel-news-card" style="opacity:1;transform:none">
                  <div class="news-card-overlay" style="background:linear-gradient(0deg, rgba(0,0,0,0.4), transparent)"></div>
                  <div class="news-card-content">
                    <div class="skeleton skel-line" style="width:30%;height:10px;background:rgba(255,255,255,0.2)"></div>
                    <div class="skeleton skel-line" style="width:90%;height:18px;background:rgba(255,255,255,0.3)"></div>
                    <div class="skeleton skel-line" style="width:70%;height:18px;background:rgba(255,255,255,0.3)"></div>
                  </div>
                </div>`;
        }
        grid.innerHTML = `<div class="news-feed">${skeletonHtml}</div>`;
    }

    try {
        const url = force ? '/api/news?force=1' : '/api/news';
        const res = await fetch(url);
        const json = await res.json();
        if (json.status === 'ok') {
            _renderNewsGrid(json.data);
            resetClock('rc-news');
            const el = document.getElementById('newsLastUpdated');
            if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        }
    } catch (err) {
        if (grid) grid.innerHTML = '<div class="activity-empty">Error loading news.</div>';
    }
}

function _newsRelativeTime(dt) {
    const now = Date.now();
    const diff = Math.floor((now - dt.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function _renderNewsGrid(data) {
    const grid = document.getElementById('newsGrid');
    if (!grid) return;

    if (!data || data.length === 0) {
        grid.innerHTML = '<div class="activity-empty">No market news available.</div>';
        return;
    }

    const now = Date.now();
    const items = data.map((news, i) => {
        const title = news.headline || '—';
        const source = news.source || '—';
        const url = news.url || '#';
        const img = news.image || `https://images.unsplash.com/photo-1611974717482-98246e7f293b?auto=format&fit=crop&q=80&w=800&h=800&market=${encodeURIComponent(source)}`;
        const dt = news.datetime ? new Date(news.datetime * 1000) : null;
        const relTime = dt ? _newsRelativeTime(dt) : '—';
        const ageSecs = dt ? (now - dt.getTime()) / 1000 : Infinity;
        
        // Dynamic badges
        let badgeClass = 'news-badge--update';
        let badgeText = 'News Update';
        if (ageSecs < 1200) { // < 20 min
            badgeClass = 'news-badge--breaking';
            badgeText = 'Breaking News';
        } else if (title.toLowerCase().includes('earnings') || title.toLowerCase().includes('report')) {
            badgeText = 'Earnings Report';
        }

        return `
        <a href="${url}" target="_blank" rel="noopener" class="news-card" style="animation-delay: ${i * 0.08}s">
            <img src="${img}" class="news-card-bg" alt="" loading="lazy" onerror="this.src='https://plus.unsplash.com/premium_photo-1681487769650-a0c3fbaed85a?q=80&w=800&h=800&auto=format&fit=crop'">
            <div class="news-card-overlay"></div>
            <div class="news-card-badge ${badgeClass}">${badgeText}</div>
            <div class="news-card-footer-logo">You<b>News</b></div>
            <div class="news-card-content">
                <div class="news-card-source">${esc(source)}</div>
                <h3 class="news-card-title">${esc(title)}</h3>
                <div class="news-card-time">
                    <span class="material-symbols-outlined" style="font-size:14px">schedule</span>
                    ${esc(relTime)}
                </div>
            </div>
        </a>`;
    }).join('');

    grid.innerHTML = `<div class="news-feed">${items}</div>`;
}


/* ─── AI Market Digest ───────────────────────────────────────────────────── */
let _digestProvider = 'finviz';

async function loadMarketDigest(provider, force = false) {
    if (provider) _digestProvider = provider;

    // Target the new sidebar elements
    const body = document.getElementById('digestSidebarBody');
    const meta = document.getElementById('digestSidebarMeta');
    const btn = document.getElementById('digestBtn'); // Top bar button

    if (!body) return;

    const url = `/api/market-digest?provider=${_digestProvider}${force ? '&refresh=1' : ''}`;

    if (force) {
        body.innerHTML = `<div class="digest-loading"><div style="display:flex;flex-direction:column;gap:8px;width:100%"><div class="skeleton skel-line skel-w-70" style="height:12px"></div><div class="skeleton skel-line skel-w-90" style="height:12px"></div><div class="skeleton skel-line skel-w-60" style="height:12px"></div><div class="skeleton skel-line skel-w-80" style="height:12px"></div></div></div>`;
    }

    try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'Unknown error');

        _renderDigest(json.digest, body); // Pass body to render

        // Also render into the inline Market News widget on the Market page
        const inlineEl = document.getElementById('marketDigestInline');
        if (inlineEl) _renderDigest(json.digest, inlineEl);

        if (meta) {
            const timeStr = json.cached ? `Cached · ${json.last_refresh_ago || '5m'}` : 'Just now';
            meta.innerHTML = `<a href="https://www.finviz.com/" target="_blank">Finviz</a> · ${timeStr}`;
        }
    } catch (err) {
        body.innerHTML = `<div class="digest-error">Failed to load digest: ${esc(err.message)}</div>`;
        const inlineEl = document.getElementById('marketDigestInline');
        if (inlineEl) inlineEl.innerHTML = `<div class="digest-error">Failed to load: ${esc(err.message)}</div>`;
    }
}

function switchDigestProvider(provider) {
    _digestProvider = provider;
    document.querySelectorAll('.digest-provider-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.provider === provider);
    });
    loadMarketDigest(provider, false);
}

function _renderDigest(text, targetBody) {
    const body = targetBody || document.getElementById('digestSidebarBody');
    if (!body) return;

    const hi = s => s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" class="digest-link">$1</a>');

    // Detect sentiment from text: returns 'up', 'down', or 'neutral'
    const sentiment = s => {
        const lower = s.toLowerCase();
        const upWords = /\b(rise|rises|rising|gain|gains|surge|surges|surging|up|rally|rallies|bullish|bull|positive|higher|outperform|beat|strong|strength|growth|advance|climb|climbs|soar|soars)\b/;
        const downWords = /\b(fall|falls|falling|drop|drops|decline|declines|loss|losses|slump|slumps|down|sell.?off|bearish|bear|negative|lower|underperform|miss|weak|weakness|retreat|retreats|plunge|plunges|slide|slides)\b/;
        const upScore = (lower.match(upWords) || []).length;
        const downScore = (lower.match(downWords) || []).length;
        if (upScore > downScore) return 'up';
        if (downScore > upScore) return 'down';
        return 'neutral';
    };

    const insightIcon = sent => {
        if (sent === 'up') return '<svg class="digest-card-icon digest-icon-up" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3L13 8H10V13H6V8H3L8 3Z" fill="currentColor"/></svg>';
        if (sent === 'down') return '<svg class="digest-card-icon digest-icon-down" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 13L3 8H6V3H10V8H13L8 13Z" fill="currentColor"/></svg>';
        return '<svg class="digest-card-icon digest-icon-neutral" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 8H10.5M8 5.5V10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const parts = [];
    let heroSet = false;

    // Collect bullets to be flushed as insight cards
    const pending = [];

    const flushBullets = () => {
        if (!pending.length) return;
        for (const b of pending.splice(0)) {
            const sent = sentiment(b);
            parts.push(`<div class="digest-item-card digest-item-card--${sent}">${insightIcon(sent)}<span>${b}</span></div>`);
        }
    };

    for (const line of lines) {
        if (/^[•\-\*] /.test(line)) {
            pending.push(hi(line.replace(/^[•\-\*] /, '').replace(/\(([A-Z]{1,5})\)/g, (match, ticker) => { return `(<a href="https://finviz.com/quote.ashx?t=${ticker}&p=d" target="_blank">${ticker}</a>)`; }).trim()));
        } else if (/^\d+\)/.test(line)) {
            flushBullets();
            const sent = sentiment(line);
            parts.push(`<div class="digest-item-card digest-item-card--${sent}">${insightIcon(sent)}<span>${hi(line)}</span></div>`);
        } else if (line.startsWith('Driver:')) {
            flushBullets();
            parts.push(`<div class="digest-sub-driver">${hi(line)}</div>`);
        } else if (line.startsWith('Sources:')) {
            flushBullets();
            parts.push(`<div class="digest-sub-sources">${hi(line)}</div>`);
        } else {
            flushBullets();
            const isHeadline = /^\*\*|^#|^Key things to watch/.test(line);
            if (!heroSet && isHeadline) {
                // First headline becomes the hero card
                heroSet = true;
                parts.push(`<div class="digest-hero-card"><svg class="digest-hero-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 8H15M5 11H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><div class="digest-hero-text">${hi(line)}</div></div>`);
            } else {
                const cls = isHeadline ? 'digest-headline' : 'digest-para';
                parts.push(`<div class="${cls}">${hi(line)}</div>`);
            }
        }
    }
    flushBullets();

    body.innerHTML = parts.join('');
}

function openDigestSidebar() {
    const sidebar = document.getElementById('digestSidebar');
    const overlay = document.getElementById('digestSidebarOverlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
}

function closeDigestSidebar() {
    const sidebar = document.getElementById('digestSidebar');
    const overlay = document.getElementById('digestSidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
}

// Keep for legacy if needed, but sidebar is primary now
function openDigestModal() {
    const modal = document.getElementById('digestModal');
    const modalBody = document.getElementById('digestModalBody');
    const sourceBody = document.getElementById('digestSidebarBody');
    if (!modal || !modalBody || !sourceBody) return;

    modalBody.innerHTML = sourceBody.innerHTML;
    modal.style.display = 'flex';
}

function closeDigestModal() {
    const modal = document.getElementById('digestModal');
    if (modal) modal.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════════════════
   WATCHLIST VIEW
   ═══════════════════════════════════════════════════════════════════════════ */

const _WL_STORAGE_KEY = 'wl:tickers:v1';

async function _wlLoad() {
    try {
        const resp = await fetch('/api/watchlist/tickers');
        const json = await resp.json();
        if (json.status === 'ok' && Array.isArray(json.data)) {
            // One-time migration: if server is empty but localStorage has data, push it up
            if (json.data.length === 0) {
                const local = JSON.parse(localStorage.getItem(_WL_STORAGE_KEY) || '[]');
                if (local.length > 0) {
                    await _wlSave(local);
                    localStorage.removeItem(_WL_STORAGE_KEY);
                    return local;
                }
            }
            return json.data;
        }
    } catch (_) { /* fall through */ }
    try { return JSON.parse(localStorage.getItem(_WL_STORAGE_KEY) || '[]'); }
    catch { return []; }
}

async function _wlSave(list) {
    try {
        await fetch('/api/watchlist/tickers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers: list }),
        });
    } catch (_) {
        // Fallback: keep localStorage in sync so the UI still works offline
        localStorage.setItem(_WL_STORAGE_KEY, JSON.stringify(list));
    }
}

async function loadWatchlistView() {
    const list = await _wlLoad();
    _renderWatchlistTable(list);
}

async function addWatchlistTicker() {
    const input = document.getElementById('watchlistTickerInput');
    const select = document.getElementById('watchlistCountrySelect');
    if (!input) return;

    const ticker = input.value.trim().toUpperCase();
    const country = select ? select.value : 'US';
    if (!ticker) return;

    const list = await _wlLoad();
    if (list.some(r => r.ticker === ticker)) {
        input.value = '';
        return; // already in list
    }
    list.push({ ticker, country });
    await _wlSave(list);
    input.value = '';
    _renderWatchlistTable(list);
    _loadWatchlistRow(ticker, country);
}

async function removeWatchlistTicker(ticker) {
    const current = await _wlLoad();
    const list = current.filter(r => r.ticker !== ticker);
    await _wlSave(list);
    const row = document.getElementById(`wl-row-${ticker}`);
    if (row) row.remove();
    _wlCheckEmpty(list);
}

function _wlCheckEmpty(list) {
    const emptyEl = document.getElementById('watchlistEmpty');
    const wrapEl = document.getElementById('watchlistTableWrap');
    const empty = !list || list.length === 0;
    if (emptyEl) emptyEl.style.display = empty ? '' : 'none';
    if (wrapEl) wrapEl.style.display = empty ? 'none' : '';
}

function _renderWatchlistTable(list) {
    _wlCheckEmpty(list);
    if (!list.length) return;

    const tbody = document.getElementById('watchlistTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    list.forEach(({ ticker, country }) => {
        const row = document.createElement('tr');
        row.id = `wl-row-${ticker}`;
        row.className = 'wl-table-row';
        row.innerHTML = `
            <td><div class="wl-ticker-cell">${_logoImg(ticker, 'wl-logo')}<span class="wl-ticker-chip">${esc(ticker)}</span></div></td>
            <td class="wl-company" id="wl-co-${ticker}">—</td>
            <td class="wl-price" id="wl-price-${ticker}">—</td>
            <td class="wl-change" id="wl-chg-${ticker}">—</td>
            <td class="wl-target-col wl-target-min" id="wl-min-${ticker}">—</td>
            <td class="wl-target-col wl-target-avg" id="wl-avg-${ticker}">—</td>
            <td class="wl-target-col wl-target-max" id="wl-max-${ticker}">—</td>
            <td id="wl-sig-${ticker}">—</td>
            <td class="wl-fund-col" id="wl-mktcap-${ticker}">—</td>
            <td class="wl-fund-col" id="wl-rev-${ticker}">—</td>
            <td class="wl-fund-col" id="wl-ps-${ticker}">—</td>
            <td class="wl-fund-col" id="wl-pe-${ticker}">—</td>
            <td><canvas id="wl-spark-${ticker}" class="wl-spark-canvas" width="100" height="36"></canvas></td>
            <td>
              <button class="wl-remove-btn" onclick="event.stopPropagation();removeWatchlistTicker('${ticker}')" title="Remove">
                <span class="material-symbols-outlined" style="font-size:16px;line-height:1">close</span>
              </button>
            </td>`;
        row.onclick = () => openWatchlistStockPanel(ticker, country);
        tbody.appendChild(row);
        _loadWatchlistRow(ticker, country);
    });
}

function _fmtMarketVal(v) {
    if (v == null) return '—';
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
    return '$' + v.toLocaleString();
}

async function _loadWatchlistRow(ticker, country) {
    // Fetch price + sparkline + signals + fundamentals in parallel
    const [priceRes, sparkRes, sigRes, fundRes] = await Promise.allSettled([
        fetch(`/api/watchlist/price?ticker=${encodeURIComponent(ticker)}&country=${encodeURIComponent(country)}`).then(r => r.json()),
        fetch(`/api/stock-sparklines?tickers=${encodeURIComponent(ticker)}&countries=${encodeURIComponent(country)}`).then(r => r.json()),
        fetch(`/api/watchlist/signals?ticker=${encodeURIComponent(ticker)}&country=${encodeURIComponent(country)}`).then(r => r.json()),
        fetch(`/api/watchlist/fundamentals?ticker=${encodeURIComponent(ticker)}&country=${encodeURIComponent(country)}`).then(r => r.json()),
    ]);

    // Price + company
    if (priceRes.status === 'fulfilled' && priceRes.value?.status === 'ok') {
        const d = priceRes.value.data;
        const coEl = document.getElementById(`wl-co-${ticker}`);
        const priceEl = document.getElementById(`wl-price-${ticker}`);
        const chgEl = document.getElementById(`wl-chg-${ticker}`);
        if (coEl) coEl.textContent = d.company || ticker;
        if (priceEl) {
            const sym = { USD: '$', GBP: '£', GBp: 'p', GBX: 'p', EUR: '€', CAD: 'CA$', AUD: 'A$', JPY: '¥' }[d.currency] || '';
            priceEl.textContent = d.price != null ? `${sym}${d.price.toLocaleString()}` : '—';
        }
        if (chgEl && d.change_pct != null) {
            const sign = d.change_pct >= 0 ? '+' : '';
            chgEl.textContent = `${sign}${d.change_pct.toFixed(2)}%`;
            chgEl.className = `wl-change ${d.change_pct >= 0 ? 'pos' : 'neg'}`;
        }
    }

    // Sparkline
    if (sparkRes.status === 'fulfilled' && sparkRes.value?.status === 'ok') {
        const points = sparkRes.value.data?.[ticker] || [];
        const canvas = document.getElementById(`wl-spark-${ticker}`);
        if (canvas && points.length >= 2 && typeof _drawStockSparkline === 'function') {
            _drawStockSparkline(`wl-spark-${ticker}`, points);
        }
    }

    // Signals
    if (sigRes.status === 'fulfilled' && sigRes.value?.status === 'ok') {
        const d = sigRes.value.data;
        const fmt2 = v => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
        const minEl = document.getElementById(`wl-min-${ticker}`);
        const avgEl = document.getElementById(`wl-avg-${ticker}`);
        const maxEl = document.getElementById(`wl-max-${ticker}`);
        const sigEl = document.getElementById(`wl-sig-${ticker}`);
        if (minEl) minEl.textContent = fmt2(d.low);
        if (avgEl) avgEl.textContent = fmt2(d.avg);
        if (maxEl) maxEl.textContent = fmt2(d.high);
        if (sigEl) {
            const rec = (d.rec_text || 'NEUTRAL').toUpperCase();
            const cls = rec.includes('BUY') ? 'buy' : rec.includes('SELL') ? 'sell' : rec === 'NEUTRAL' || rec === 'HOLD' ? 'hold' : 'na';
            const label = { 'STRONG BUY': 'Strong Buy', 'BUY': 'Buy', 'NEUTRAL': 'Hold', 'HOLD': 'Hold', 'SELL': 'Sell', 'STRONG SELL': 'Strong Sell' }[rec] || rec;
            sigEl.innerHTML = `<span class="wl-signal-badge ${cls}">${esc(label)}</span>`;
        }
    }

    // Fundamentals: market cap, revenue LTM, P/S, P/E
    if (fundRes.status === 'fulfilled' && fundRes.value?.status === 'ok') {
        const d = fundRes.value.data;
        const capEl = document.getElementById(`wl-mktcap-${ticker}`);
        const revEl = document.getElementById(`wl-rev-${ticker}`);
        const psEl = document.getElementById(`wl-ps-${ticker}`);
        const peEl = document.getElementById(`wl-pe-${ticker}`);
        if (capEl) capEl.textContent = _fmtMarketVal(d.market_cap);
        if (revEl) revEl.textContent = _fmtMarketVal(d.revenue);
        if (psEl && d.rev_multiple != null) {
            const ps = d.rev_multiple;
            const tier = ps >= 10 ? 'high' : ps >= 3 ? 'mid' : 'low';
            psEl.innerHTML = `<span class="wl-ps-badge ${tier}">${ps.toFixed(1)}x</span>`;
        }
        if (peEl) {
            if (d.pe_ratio != null) {
                const tier = d.pe_ratio < 15 ? 'high' : d.pe_ratio < 30 ? 'mid' : 'low';
                peEl.innerHTML = `<span class="wl-ps-badge ${tier}">${d.pe_ratio.toFixed(1)}x</span>`;
            } else {
                peEl.textContent = 'N/A';
            }
        }
    }
}

/* ── Watchlist stock drill-down panel ───────────────────────────────────── */
async function openWatchlistStockPanel(ticker, country) {
    const nameEl = document.getElementById('spCompanyName');
    const tickerEl = document.getElementById('spTicker');
    const initialEl = document.getElementById('spCompanyInitial');

    // Set initial info and open panel immediately
    if (nameEl) nameEl.textContent = ticker;
    if (tickerEl) tickerEl.textContent = ticker;
    if (initialEl) initialEl.textContent = ticker.charAt(0).toUpperCase();

    const portfolioSec = document.getElementById('spPortfolioSection');
    const activitySec = document.getElementById('spActivitySection');
    const analystSec = document.getElementById('spAnalystRatingsSection');
    const fundSec = document.getElementById('spFundamentalsSection');

    // Reset sections
    if (portfolioSec) portfolioSec.style.display = 'none';
    if (activitySec) activitySec.style.display = 'none';
    if (analystSec) analystSec.style.display = 'none';
    if (fundSec) fundSec.style.display = 'none';
    const newsList = document.getElementById('spNewsList');
    if (newsList) _showElemLoading(newsList, 'Loading news…');

    document.getElementById('sidePanelBackdrop')?.classList.add('active');
    document.getElementById('sidePanel')?.classList.add('open');

    // Fetch everything in parallel
    const [priceRes, sigRes, portfolioRes] = await Promise.allSettled([
        fetch(`/api/watchlist/price?ticker=${encodeURIComponent(ticker)}&country=${encodeURIComponent(country)}`).then(r => r.json()),
        fetch(`/api/watchlist/signals?ticker=${encodeURIComponent(ticker)}&country=${encodeURIComponent(country)}`).then(r => r.json()),
        fetch('/api/pcombined/portfolio').then(r => r.json()),
    ]);

    // Update company name from price fetch
    let currentPrice = null, priceCurrency = null;
    if (priceRes.status === 'fulfilled' && priceRes.value?.status === 'ok') {
        const d = priceRes.value.data;
        if (nameEl) nameEl.textContent = d.company || ticker;
        if (initialEl) initialEl.textContent = (d.company || ticker).charAt(0).toUpperCase();
        currentPrice = d.price;
        priceCurrency = d.currency;
    }

    // Check portfolio membership
    let portfolioRow = null;
    if (portfolioRes.status === 'fulfilled' && portfolioRes.value?.status === 'ok') {
        portfolioRow = (portfolioRes.value.data || []).find(r => r.ticker === ticker) || null;
    }

    // If held in portfolio: show metrics + activity
    if (portfolioRow) {
        if (portfolioSec) {
            const sign = portfolioRow.total_returns >= 0 ? '+' : '';
            const color = portfolioRow.total_returns >= 0 ? 'var(--green)' : 'var(--red)';
            portfolioSec.style.display = '';
            portfolioSec.innerHTML = `<div class="sp-metrics-grid">
                <div class="sp-metric">
                    <span class="sp-metric-label">Current Value</span>
                    <span class="sp-metric-value">${fmt.currency(portfolioRow.current_value)}</span>
                </div>
                <div class="sp-metric">
                    <span class="sp-metric-label">Total Return</span>
                    <span class="sp-metric-value" style="color:${color}">
                        ${sign}${fmt.currency(portfolioRow.total_returns)}
                        <span class="sp-metric-pct">(${sign}${(portfolioRow.returns_pct ?? 0).toFixed(2)}%)</span>
                    </span>
                </div>
                <div class="sp-metric">
                    <span class="sp-metric-label">Shares</span>
                    <span class="sp-metric-value">${(portfolioRow.quantity ?? 0).toFixed(4)}</span>
                </div>
                <div class="sp-metric">
                    <span class="sp-metric-label">Avg Price</span>
                    <span class="sp-metric-value">${fmt.currency(portfolioRow.avg_price, 4)}</span>
                </div>
            </div>`;
        }
        if (activitySec) {
            activitySec.style.display = '';
            const actList = document.getElementById('spActivityList');
            if (actList) _showElemLoading(actList, 'Loading activity…');
            window.PORTFOLIO_ID = portfolioRow.pid || 'combined';
            if (typeof window['loadStockActivity'] === 'function') window['loadStockActivity'](ticker);
        }
    }

    // Analyst ratings — inject into _recommendations so _renderPanelAnalystRatings can use it
    if (sigRes.status === 'fulfilled' && sigRes.value?.status === 'ok') {
        const d = sigRes.value.data;
        const recMap = { 'STRONG BUY': 'Strong Buy', 'BUY': 'Buy', 'NEUTRAL': 'Hold', 'HOLD': 'Hold', 'SELL': 'Sell', 'STRONG SELL': 'Strong Sell' };
        const consensus = recMap[(d.rec_text || 'NEUTRAL').toUpperCase()] || 'Hold';
        if (typeof _recommendations !== 'undefined') {
            _recommendations[ticker] = {
                consensus,
                avgTarget: d.avg,
                highTarget: d.high,
                lowTarget: d.low,
                total: 0,
                hasBreakdown: false,
            };
        }
        if (typeof _renderPanelAnalystRatings === 'function') {
            _renderPanelAnalystRatings(ticker, currentPrice, priceCurrency);
        }
    }

    // Fundamentals (Yahoo Finance) — only for US/CA stocks
    if (country === 'US' || country === 'CA') {
        if (typeof window['loadStockMetrics'] === 'function') window['loadStockMetrics'](ticker);
    }

    // News — always
    if (typeof window['loadStockNews'] === 'function') window['loadStockNews'](ticker);
}

