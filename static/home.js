/**
 * home.js - Logic for the Multi-Portfolio Landing Page
 */

let _overviewData = null;
let _homeActivityData = null;
let _homeDividendData = null;
let _homePerformerData = null;

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

        // Top performers widget
        _homePerformerData = data.top_performers || [];
        _renderHomePerformers(_homePerformerData);

        // Market indicators (stored for F&G detail panel)
        if (data.market_indicators) {
            _marketIndData = data.market_indicators;
            if (document.getElementById('fgPanel')?.classList.contains('open')) {
                _renderFGPanelContent(_marketIndData);
            }
        }

        // Market status is client-side time-based — no server data needed
    } catch (e) {
        console.error('Failed to load home data:', e);
    }
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
        document.getElementById('p2-value').innerText = "Not Configured";
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
    const paiEl = document.getElementById(`${prefix}-pai`);
    const posEl = document.getElementById(`${prefix}-positions`);

    if (invEl && stats.invested != null)
        invEl.textContent = fmt.currency(stats.invested);

    if (paiEl && stats.pai != null)
        paiEl.textContent = `${fmt.currency(stats.pai)} / yr`;

    if (posEl && stats.positions != null) {
        const score = stats.div_score ?? 0;
        const bg = score >= 70 ? '#4caf50' : score >= 50 ? '#ffb74d' : '#e57373';
        const sector = stats.top_sector ? ` · ${stats.top_sector}` : '';
        posEl.innerHTML =
            `<span class="ov-mini-badge" style="background:${bg}">${score}</span>` +
            `${stats.positions} positions${esc(sector)}`;
    }
}


/* ─── Theme ───────────────────────────────────────────────────────────────── */
(function () {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    _updateThemeIcon(saved);

    const glass = localStorage.getItem('glassMode') === 'true';
    document.documentElement.setAttribute('data-glass', glass);
})();

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') !== 'light';
    const newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    _updateThemeIcon(newTheme);
}

function toggleGlassMode() {
    const html = document.documentElement;
    const isGlass = html.getAttribute('data-glass') === 'true';
    const newVal = !isGlass;
    html.setAttribute('data-glass', newVal);
    localStorage.setItem('glassMode', newVal);
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

/* ─── Refresh Countdown Clocks ───────────────────────────────────────────── */

const _clocks = {};

function _initClock(el) {
    const totalSecs = parseInt(el.dataset.refreshSecs, 10);
    const showMins  = totalSecs >= 120;
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

    const arc  = el.querySelector('.rc-arc');
    const text = el.querySelector('.rc-text');
    let remaining = totalSecs;

    function _label() {
        return showMins ? Math.ceil(remaining / 60) : remaining;
    }

    function tick() {
        remaining = Math.max(0, remaining - 1);
        if (remaining <= 0) remaining = totalSecs;
        arc.style.strokeDashoffset = (circ * (1 - remaining / totalSecs)).toFixed(3);
        text.textContent = _label();
    }

    arc.style.strokeDashoffset = '0';
    text.textContent = _label();
    const timer = setInterval(tick, 1000);

    return {
        reset() {
            remaining = totalSecs;
            arc.style.strokeDashoffset = '0';
            text.textContent = _label();
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
let _tickerRetryTimer = null;

async function loadStockTicker() {
    try {
        const res  = await fetch('/api/stock-tickers');
        const json = await res.json();
        if (json.status === 'ok' && json.data.length > 0) {
            _tickerData = json.data;
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
    if (Math.abs(v) < 0.05) return 'hsl(220,10%,20%)';
    if (v > 0) {
        const t = Math.min(v / 4, 1);
        return `hsl(142,${Math.round(30 + t * 50)}%,${Math.round(26 - t * 10)}%)`;
    } else {
        const t = Math.min(Math.abs(v) / 4, 1);
        return `hsl(0,${Math.round(30 + t * 55)}%,${Math.round(24 - t * 10)}%)`;
    }
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
        const rA  = row.reduce((s, i) => s + i._a, 0);
        const isH = w >= h;
        const rL  = isH ? rA / h : rA / w;
        let pos   = isH ? y : x;
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
                else        layout(items.slice(i), x, y + dim, w, h - dim);
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

    const valid = items.filter(d => d.price != null && (d.current_value || 0) > 0);
    if (!valid.length) return;

    // Sort: highest absolute movement first (biggest movers, up or down)
    valid.sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0));

    const _currencySymbol = { USD:'$', GBP:'£', GBp:'p', GBX:'p', EUR:'€', CAD:'CA$', AUD:'A$', JPY:'¥', CHF:'Fr' };

    const cells = valid.map(d => {
        const pct    = d.change_pct ?? 0;
        const up     = pct >= 0;
        const bg     = _heatColor(pct);
        const sign   = (up && pct !== 0) ? '+' : '';
        const pctStr = `${sign}${pct.toFixed(2)}%`;
        const sym    = _currencySymbol[d.currency] ?? '';
        const price  = d.price != null ? `${sym}${d.price.toFixed(2)}` : '';
        const title  = `${d.company_name}\n${d.ticker}  ${pctStr}`;

        return `<div class="hm-cell" title="${title}" style="background:${bg}">` +
            `<span class="hm-ticker">${esc(d.ticker)}</span>` +
            `<span class="hm-price">${price}</span>` +
            `<span class="hm-pct">${up ? '▲' : '▼'} ${pctStr}</span>` +
            `</div>`;
    }).join('');

    container.innerHTML = cells;
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
    el.textContent = `${sign}${fmt.currency(delta)} (${sign}${pct.toFixed(2)}%) 24h`;
    el.className = `ov-24h ${delta >= 0 ? 'pos' : 'neg'}`;
    el.style.display = '';
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
    // Dividend calendar and earnings are now in the dedicated Calendar view
}

async function loadCalendarView(force) {
    if (force) {
        // Clear cached data so both functions re-fetch
        try { sessionStorage.removeItem('divCal'); } catch(_) {}
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
    el.innerHTML = '<div class="activity-loading"><div class="table-loading-spinner"></div></div>';
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
    el.innerHTML = '<div class="activity-loading"><div class="table-loading-spinner"></div></div>';
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
        const ticker    = (order.ticker || '').split('_')[0];
        const company   = order.company_name || ticker || 'Unknown';
        const qty       = order.filledQuantity || 0;
        const dateStr   = order.dateExecuted || order.dateCreated || '';
        const status    = (order.status || '').toUpperCase();
        const pid       = order._pid || '1';
        const ownerName = names[pid] || pid;
        const isCancelled = status === 'CANCELLED' || status === 'REJECTED';
        const typeUpper = (order.type || '').toUpperCase();
        const isSell    = (order.side || '').toUpperCase() === 'SELL' || typeUpper.includes('SELL');
        const actionWord = isCancelled ? 'Cancelled' : (isSell ? 'Sold' : 'Bought');
        const value     = fmt.currency(order.filledValue || (qty * (order.fillPrice || 0)));

        const date  = dateStr ? new Date(dateStr) : new Date();
        const day   = date.getDate();
        const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const timeStr = dateStr
            ? date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '—';

        const diffDays = dateStr
            ? Math.round((today - new Date(dateStr.split('T')[0] + 'T00:00:00')) / 86400000)
            : 0;
        let relLabel;
        if (diffDays === 0)       relLabel = 'TODAY';
        else if (diffDays === 1)  relLabel = 'YESTERDAY';
        else if (diffDays < 7)   relLabel = `${diffDays}D AGO`;
        else                     relLabel = `${Math.floor(diffDays / 7)}W AGO`;

        const badgeClass  = isCancelled ? 'div-tl-date-badge--paid' : (isSell ? 'div-tl-date-badge--sell' : 'div-tl-date-badge--buy');
        const statusClass = isCancelled ? 'div-tl-status--paid'     : (isSell ? 'div-tl-status--sell'     : 'div-tl-status--buy');
        const isLast      = i === data.length - 1;

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
              <span class="div-tl-ticker">${esc(ticker)}</span>
              <div class="div-tl-company-block">
                <span class="div-tl-company">${esc(company)}</span>
                <span class="div-tl-type">${actionWord} · ${fmt.number(qty, 4)} shares</span>
              </div>
              <div class="div-tl-amount-block">
                <span class="div-tl-value">${value}</span>
              </div>
            </div>
            <div class="div-tl-card-bottom">
              <div class="div-tl-dates">
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Executed</span>
                  <span class="div-tl-date-val">${timeStr}</span>
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
        const ticker    = (div.ticker || '').split('_')[0];
        const company   = div.company_name || '';
        const amount    = fmt.currency(div.amount || 0);
        const dateStr   = div.paidOn || div.date || '';
        const pid       = div._pid || '1';
        const ownerName = names[pid] || pid;

        let day = '—', month = '—', timeStr = dateStr || '—';
        if (dateStr && dateStr !== '—') {
            const d   = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
            day       = d.getDate();
            month     = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
            timeStr   = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
              <span class="div-tl-ticker">${esc(ticker)}</span>
              <div class="div-tl-company-block">
                ${company ? `<span class="div-tl-company">${esc(company)}</span>` : ''}
                <span class="div-tl-type">Dividend received</span>
              </div>
              <div class="div-tl-amount-block">
                <span class="div-tl-value pos">${amount}</span>
              </div>
            </div>
            <div class="div-tl-card-bottom">
              <div class="div-tl-dates">
                <div class="div-tl-date-col">
                  <span class="div-tl-date-label">Paid On</span>
                  <span class="div-tl-date-val">${esc(timeStr)}</span>
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

async function loadTopPerformers() {
    try {
        const res = await fetch('/api/pcombined/top-performers');
        const json = await res.json();
        _homePerformerData = json.data || [];
        _renderHomePerformers(_homePerformerData);
    } catch (err) {
        document.getElementById('performerList').innerHTML =
            '<div class="activity-empty">Error loading performers</div>';
    }
}

function _renderHomePerformers(data) {
    const listEl = document.getElementById('performerList');
    if (data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No performance data found.</div>';
        return;
    }
    listEl.innerHTML = data.map(r => {
        const ticker = r.ticker;
        const returns = fmt.currency(r.total_returns);
        const pct = r.returns_pct.toFixed(2);
        const pid = r._pid || '1';
        const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : { '1': 'Chimbu', '2': 'Poornima' };
        const ownerName = names[pid] || pid;
        const company = r.company_name || ticker;
        return `
            <div class="activity-item">
                <div class="activity-dot activity-dot-buy"></div>
                <div class="activity-content">
                    <span class="ov-card-pid-tag ov-tag-p${pid}">${ownerName}</span>
                    <span class="activity-company">${esc(company)}</span>
                    <span class="activity-ticker activity-ticker-sm">${esc(ticker)}</span>
                    <div class="activity-desc">Total Gain: ${returns}</div>
                </div>
                <div class="activity-amount pos">+${pct}%</div>
            </div>`;
    }).join('');
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
    const lseSession    = data?.LSE?.session    ?? 'closed';

    // ET time for NASDAQ, GMT for LSE
    const now = new Date();
    const etParts = {};
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).forEach(p => { if (p.type !== 'literal') etParts[p.type] = p.value; });
    const etHH  = etParts.hour === '24' ? '00' : etParts.hour;
    const etStr = `${etHH}:${etParts.minute} ET`;
    const gmtStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now) + ' GMT';

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
        let top  = pr.bottom + window.scrollY + 6;
        let left = pr.left   + window.scrollX;
        if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - tr.width - 8;
        if (left < 8) left = 8;
        tt.style.top  = top  + 'px';
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
    const SESSION_CLS   = { 'open': 'mkt-open', 'pre-market': 'mkt-pre', 'after-hours': 'mkt-post', 'closed': 'mkt-closed' };

    const fmtTime = iso => {
        const p = {};
        new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(new Date(iso)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
        return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
    };

    const fmtDay = iso => {
        const d   = new Date(iso);
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
        if (json.status !== 'ok') return;
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
const _DIV_CAL_CACHE_KEY = 'divCal:v2';
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

    el.innerHTML = '<div class="activity-loading"><div class="table-loading-spinner"></div></div>';

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
        const exDate  = new Date(d.ex_dividend_date + 'T00:00:00');
        const diff    = Math.round((payDate - today) / 86400000);
        const exDiff  = Math.round((exDate  - today) / 86400000);

        const isPaid = diff < 0;
        let status, statusClass;
        if (isPaid)        { status = 'Paid';           statusClass = 'div-tl-status--paid'; }
        else if (exDiff < 0){ status = 'Pending Payout'; statusClass = 'div-tl-status--pending'; }
        else                { status = 'Upcoming';       statusClass = 'div-tl-status--upcoming'; }

        let relLabel;
        if (isPaid)      relLabel = 'PAID';
        else if (diff === 0) relLabel = 'TODAY';
        else if (diff === 1) relLabel = 'TOMORROW';
        else             relLabel = `IN ${diff} DAYS`;

        const month    = payDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const day      = payDate.getDate();
        const perShare = d.amount_per_share > 0 ? `$${d.amount_per_share.toFixed(4)}` : '—';
        const payout   = d.expected_payout  > 0 ? `Est. $${d.expected_payout.toFixed(2)} total` : '';
        const isLast   = i === data.length - 1;

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
              <span class="div-tl-ticker">${esc(d.ticker)}</span>
              <div class="div-tl-company-block">
                <span class="div-tl-company">${esc(d.company_name)}</span>
                ${payout ? `<span class="div-tl-type">${esc(payout)}</span>` : ''}
              </div>
              <div class="div-tl-amount-block">
                <span class="div-tl-value">${perShare}</span>
                <span class="div-tl-per-share">per share</span>
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
    const listEl = document.getElementById('earningsList');
    if (!listEl) return;

    if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="activity-empty">No upcoming earnings found for held US stocks.</div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    listEl.innerHTML = data.map(e => {
        const symbol = e.symbol || '—';
        const company = e._company_name || symbol;
        const dateStr = e.date || '';
        const quarter = e.quarter ? `Q${e.quarter}` : '';
        const year = e.year || '';
        const quarterLabel = (quarter && year) ? `${quarter} ${year}` : (quarter || year || '');

        const epsEst = e.epsEstimate != null ? Number(e.epsEstimate).toFixed(2) : null;
        const epsActual = e.epsActual != null ? Number(e.epsActual).toFixed(2) : null;
        const revEst = e.revenueEstimate != null ? _fmtRevenue(e.revenueEstimate) : null;
        const revActual = e.revenueActual != null ? _fmtRevenue(e.revenueActual) : null;

        const hour = e.hour === 'bmo' ? 'Pre-market' : e.hour === 'amc' ? 'After-hours' : '';

        let daysLabel = '', daysClass = '';
        if (dateStr) {
            const earningsDate = new Date(dateStr + 'T00:00:00');
            const diff = Math.round((earningsDate - today) / 86400000);
            if (diff === 0) { daysLabel = 'Today'; daysClass = 'earnings-days-today'; }
            else if (diff === 1) { daysLabel = 'Tomorrow'; daysClass = 'earnings-days-soon'; }
            else if (diff <= 7) { daysLabel = `in ${diff}d`; daysClass = 'earnings-days-soon'; }
            else { daysLabel = `in ${diff}d`; daysClass = ''; }
        }

        // EPS row: show estimate, and actual if reported
        let epsRow = '';
        if (epsEst != null || epsActual != null) {
            epsRow = `<div class="earnings-row">
                <span class="earnings-label">EPS</span>
                ${epsEst != null ? `<span class="earnings-val">Est. $${epsEst}</span>` : ''}
                ${epsActual != null ? `<span class="earnings-val earnings-actual">Act. $${epsActual}</span>` : ''}
            </div>`;
        }

        // Revenue row
        let revRow = '';
        if (revEst != null || revActual != null) {
            revRow = `<div class="earnings-row">
                <span class="earnings-label">Revenue</span>
                ${revEst != null ? `<span class="earnings-val">Est. ${revEst}</span>` : ''}
                ${revActual != null ? `<span class="earnings-val earnings-actual">Act. ${revActual}</span>` : ''}
            </div>`;
        }

        return `
            <div class="earnings-card">
                <div class="earnings-card-header">
                    <div class="earnings-card-left">
                        <span class="earnings-symbol">${esc(symbol)}</span>
                        <span class="earnings-company">${esc(company)}</span>
                    </div>
                    <div class="earnings-card-right">
                        ${daysLabel ? `<span class="earnings-days ${daysClass}">${esc(daysLabel)}</span>` : ''}
                    </div>
                </div>
                <div class="earnings-card-meta">
                    ${dateStr ? `<span class="earnings-date">${esc(dateStr)}</span>` : ''}
                    ${quarterLabel ? `<span class="earnings-quarter">${esc(quarterLabel)}</span>` : ''}
                    ${hour ? `<span class="earnings-hour">${esc(hour)}</span>` : ''}
                </div>
                ${epsRow}${revRow}
            </div>`;
    }).join('');
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
    if (score <= 25) return '#e57373';
    if (score <= 45) return '#ffb74d';
    if (score <= 55) return '#9e9e9e';
    if (score <= 75) return '#81c784';
    return '#4caf50';
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
    if (ratingEl) ratingEl.textContent = rating;

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
        [0, 25, '#e57373'],
        [25, 45, '#ffb74d'],
        [45, 55, '#9e9e9e'],
        [55, 75, '#81c784'],
        [75, 100, '#4caf50'],
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
        ctx.globalAlpha = 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
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
    if (_homePerformerData) _renderHomePerformers(_homePerformerData);
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
    if (grid) grid.innerHTML = `
        <div class="news-card skel-news-card">
          <div class="skel skel-news-img-lg"></div>
          <div class="skel-news-body">
            <div class="skel skel-line" style="width:30%"></div>
            <div class="skel skel-line" style="width:90%"></div>
            <div class="skel skel-line" style="width:70%"></div>
          </div>
        </div>`.repeat(6);

    try {
        const url = force ? '/api/news?force=1' : '/api/news';
        const res  = await fetch(url);
        const json = await res.json();
        if (json.status === 'ok') {
            _renderNewsGrid(json.data);
            resetClock('rc-news');
        }
    } catch (err) {
        if (grid) grid.innerHTML = '<div class="activity-empty">Error loading news.</div>';
    }
}

function _renderNewsGrid(data) {
    const grid = document.getElementById('newsGrid');
    if (!grid) return;

    if (!data || data.length === 0) {
        grid.innerHTML = '<div class="activity-empty">No market news available.</div>';
        return;
    }

    grid.innerHTML = data.map(news => {
        const title  = news.headline || '—';
        const source = news.source   || 'News';
        const url    = news.url      || '#';
        const time   = news.datetime
            ? new Date(news.datetime * 1000).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
              })
            : '—';
        const img = news.image || '';

        return `<a href="${url}" target="_blank" rel="noopener" class="news-card">
            ${img
                ? `<img src="${img}" class="news-card-img" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="news-card-img-placeholder">📰</div>`}
            <div class="news-card-body">
                <span class="news-card-source">${esc(source)}</span>
                <span class="news-card-title">${esc(title)}</span>
                <span class="news-card-time">${time}</span>
            </div>
        </a>`;
    }).join('');
}

