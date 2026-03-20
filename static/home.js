/**
 * home.js - Logic for the Multi-Portfolio Landing Page
 */

let _overviewData = null;
let _homeActivityData = null;
let _homeDividendData = null;
let _sp500Data = [];          // S&P 500 heatmap full dataset
let _mktChartData    = null;  // market-indicators API data
let _mktActiveRange  = '3M'; // 1W | 1M | 3M | 1Y
let _nasdaqActiveRange = '3M';
let _portfolioVsData = null; // [{date, ts, value}] from /api/pcombined/daily-history
let _signalsData = {};        // cache per signal type
let _insiderData = {};

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
        _renderHomeTopUnder(data.top_performers || [], data.under_performers || []);

        // Market status is client-side time-based — no server data needed
    } catch (e) {
        console.error('Failed to load home data:', e);
    }
}

function _renderHomeTopUnder(top, under) {
    const topEl = document.getElementById('homeTopPerformers');
    const underEl = document.getElementById('homeUnderPerformers');

    function renderList(el, items) {
        if (!el) return;
        if (!items.length) { el.innerHTML = '<div class="activity-empty">No data.</div>'; return; }
        el.innerHTML = items.map(r => {
            const pct = r.returns_pct ?? 0;
            const sign = pct >= 0 ? '+' : '';
            const cls = pct >= 0 ? 'pos' : 'neg';
            const name = (r.company_name || r.ticker || '').slice(0, 16);
            return `<div class="home-perf-item">
                <span class="home-perf-ticker">${esc(r.ticker || '—')}</span>
                <span class="home-perf-pct ${cls}">${sign}${pct.toFixed(1)}%</span>
            </div>`;
        }).join('');
    }

    renderList(topEl, top);
    renderList(underEl, under);
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
        const res = await fetch('/api/stock-tickers');
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
    // Thresholds tuned for daily % change (vs total-return in Position Heatmap)
    if (Math.abs(v) < 0.05) return 'linear-gradient(135deg,#1e293b,#334155)';
    if (v >= 3)   return 'linear-gradient(135deg,#052e16,#15803d)';
    if (v >= 1.5) return 'linear-gradient(135deg,#14532d,#16a34a)';
    if (v >= 0.5) return 'linear-gradient(135deg,#166534,#22c55e)';
    if (v > 0)    return 'linear-gradient(135deg,#0f766e,#14b8a6)';
    if (v >= -0.5)return 'linear-gradient(135deg,#78350f,#b45309)';
    if (v >= -1.5)return 'linear-gradient(135deg,#7f1d1d,#dc2626)';
    return             'linear-gradient(135deg,#450a0a,#b91c1c)';
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
            const title = `${d.company_name}\n${d.ticker}  ${pctStr}`;

            const minDim = Math.min(celW, celH);
            let content = '';
            if (minDim >= 50) {
                content = `<span class="hm-t hm-tl">${esc(d.ticker)}</span><span class="hm-p hm-pm">${pctStr}</span>`;
            } else if (minDim >= 30) {
                content = `<span class="hm-t hm-tm">${esc(d.ticker)}</span><span class="hm-p hm-ps">${pctStr}</span>`;
            } else if (minDim >= 18) {
                content = `<span class="hm-t hm-ts">${esc(d.ticker)}</span>`;
            } else if (celW >= 12 && celH >= 8) {
                content = `<span class="hm-t hm-tx">${esc(d.ticker)}</span>`;
            }

            html.push(
                `<div class="hm-cell" title="${title}" ` +
                `style="left:${celX}px;top:${celY}px;width:${celW}px;height:${celH}px;background:${bg}">` +
                content + `</div>`
            );
        }
    }
    container.innerHTML = html.join('');
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
    // Nothing to load here currently — widgets moved to dedicated Market view
}

async function loadMarketView(force = false) {
    if (force) {
        _sp500Data       = [];
        _mktChartData    = null;
        _portfolioVsData = null;
        _signalsData     = {};
        _insiderData     = {};
    }
    loadMarketChart();
    loadSP500Data();
    loadPortfolioVsMarket();
    loadMarketSignals(_activeSignal || 'gainers');
    loadInsiderTrading(_activeInsiderPeriod || 'latest');
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
              <span class="div-tl-ticker">${esc(ticker)}</span>
              <div class="div-tl-company-block">
                ${company ? `<span class="div-tl-company">${esc(company)}</span>` : ''}
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
    try {
        const res  = await fetch('/api/finviz/sp500-heatmap');
        const json = await res.json();
        if (json.status === 'ok') {
            _sp500Data = json.data || [];
            _renderSectorBars();
        }
    } catch (err) {
        console.warn('[sp500Data]', err);
    }
}

function _renderSectorBars() {
    const el = document.getElementById('sectorBarsList');
    if (!el || !_sp500Data.length) return;

    const sectorMap = {};
    for (const s of _sp500Data) {
        const sec = s.sector || 'Other';
        if (!sectorMap[sec]) sectorMap[sec] = { sum: 0, n: 0 };
        sectorMap[sec].sum += s.change_pct ?? 0;
        sectorMap[sec].n++;
    }
    const sectors = Object.entries(sectorMap)
        .map(([name, d]) => ({ name, avg: d.sum / d.n }))
        .sort((a, b) => b.avg - a.avg);

    const maxAbs = Math.max(...sectors.map(s => Math.abs(s.avg)), 0.5);

    el.innerHTML = sectors.map(s => {
        const pct   = s.avg;
        const sign  = pct >= 0 ? '+' : '';
        const cls   = pct >= 0 ? 'pos' : 'neg';
        const barW  = (Math.abs(pct) / maxAbs * 100).toFixed(1);
        const color = pct >= 0 ? '#16a34a' : '#dc2626';
        const label = s.name
            .replace('Consumer ', '').replace(' Services', '')
            .replace('Basic Materials', 'Materials').replace('Financial Services', 'Financials');
        return `<div class="sector-bar-row">
            <span class="sector-bar-name">${esc(label)}</span>
            <div class="sector-bar-track">
              <div class="sector-bar-fill" style="width:${barW}%;background:${color}"></div>
            </div>
            <span class="sector-bar-pct ${cls}">${sign}${pct.toFixed(2)}%</span>
        </div>`;
    }).join('');
}

/* ─── S&P 500 Chart ──────────────────────────────────────────────────────── */

const _MKT_RANGE_DAYS = { '1W': 5, '1M': 22, '3M': 66, '1Y': 252 };

async function loadMarketChart() {
    if (_mktChartData) {
        _drawMarketChart();
        _drawNasdaqChart();
        _updateMarketStats();
        _updateNasdaqStats();
        // redraw portfolio vs S&P if data already loaded
        if (_portfolioVsData) _drawPortfolioVsChart();
        return;
    }
    try {
        const res  = await fetch('/api/market-indicators');
        const json = await res.json();
        if (json.status === 'ok') {
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
    const sp  = _mktChartData?.GSPC;
    const vix = _mktChartData?.VIX;
    if (!sp?.values?.length) return;

    const n       = _MKT_RANGE_DAYS[_mktActiveRange] || 66;
    const vals    = sp.values.slice(-n);
    const current = vals[vals.length - 1];
    const prev    = sp.values[sp.values.length - 2];

    const priceEl  = document.getElementById('mktSpPrice');
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
    const n       = _MKT_RANGE_DAYS[_nasdaqActiveRange] || 66;
    const vals    = nd.values.slice(-n);
    const current = vals[vals.length - 1];
    const prev    = nd.values[nd.values.length - 2];

    const priceEl  = document.getElementById('nasdaqPrice');
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

    const n      = _MKT_RANGE_DAYS[activeRange] || 66;
    const values = sp.values.slice(-n);
    const maAll  = sp.ma.slice(-n);
    const tsAll  = sp.timestamps.slice(-n);
    if (!values.length) return;

    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD  = { top: 12, right: 10, bottom: 26, left: 52 };
    const cW   = W - PAD.left - PAD.right;
    const cH   = H - PAD.top  - PAD.bottom;
    const minV = Math.min(...values) * 0.9985;
    const maxV = Math.max(...values) * 1.0015;
    const vRng = maxV - minV || 1;

    const xOf = i => PAD.left + (i / (values.length - 1)) * cW;
    const yOf = v => PAD.top  + (1 - (v - minV) / vRng) * cH;

    const isUp      = values[values.length - 1] >= values[0];
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const fillA     = isUp ? 'rgba(34,197,94,0.18)'  : 'rgba(239,68,68,0.18)';
    const fillB     = isUp ? 'rgba(34,197,94,0.02)'  : 'rgba(239,68,68,0.02)';

    // Y gridlines + labels
    for (let i = 0; i <= 4; i++) {
        const v = minV + (i / 4) * (maxV - minV);
        const y = yOf(v);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
        ctx.fillStyle  = 'rgba(255,255,255,0.28)';
        ctx.font       = '10px "JetBrains Mono",monospace';
        ctx.textAlign  = 'right';
        ctx.fillText(Math.round(v).toLocaleString('en-US'), PAD.left - 4, y + 3);
    }

    // X labels
    const xCount = activeRange === '1W' ? 5 : 6;
    ctx.textAlign  = 'center';
    ctx.fillStyle  = 'rgba(255,255,255,0.28)';
    ctx.font       = '10px system-ui,sans-serif';
    for (let i = 0; i < xCount; i++) {
        const idx = Math.round(i / (xCount - 1) * (values.length - 1));
        const d   = new Date(tsAll[idx] * 1000);
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
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Price line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
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
        const rect  = canvas.getBoundingClientRect();
        const mx    = e.clientX - rect.left;
        const { values, tsAll, PAD, cW, cH, minV, vRng, lineColor } = m;
        const xOf   = i => PAD.left + (i / (values.length - 1)) * cW;
        const yOf   = v => PAD.top  + (1 - (v - minV) / vRng) * cH;
        const idx   = Math.max(0, Math.min(values.length - 1,
            Math.round((mx - PAD.left) / cW * (values.length - 1))));

        if (canvas._mktRedraw) canvas._mktRedraw();
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.scale(dpr, dpr);

        const hx = xOf(idx), hy = yOf(values[idx]);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(hx, PAD.top);    ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PAD.left, hy);   ctx.lineTo(canvas.offsetWidth - PAD.right, hy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor + '40'; ctx.fill();
        ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fillStyle = lineColor; ctx.fill();

        const tooltip = document.getElementById(tooltipId);
        if (tooltip) {
            const d     = new Date(tsAll[idx] * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
    if (_portfolioVsData) { _drawPortfolioVsChart(); return; }
    try {
        const res  = await fetch('/api/pcombined/daily-history');
        const json = await res.json();
        if (json.status === 'ok') {
            _portfolioVsData = json.data;
            _drawPortfolioVsChart();
        }
    } catch (err) { console.warn('[portfolioVs]', err); }
}

function _drawPortfolioVsChart() {
    const canvas = document.getElementById('pvsChart');
    if (!canvas) return;
    if (!canvas.offsetWidth) { requestAnimationFrame(_drawPortfolioVsChart); return; }

    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    if (!_portfolioVsData?.length || !_mktChartData?.GSPC) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '12px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Collecting portfolio history…', W / 2, H / 2);
        _updatePortfolioVsStats(null, null);
        return;
    }

    const sp = _mktChartData.GSPC;
    // Build S&P date map
    const spByDate = {};
    for (let i = 0; i < sp.timestamps.length; i++) {
        const d = new Date(sp.timestamps[i] * 1000).toISOString().slice(0, 10);
        spByDate[d] = sp.values[i];
    }
    // Build portfolio date map
    const pvsByDate = {};
    for (const pt of _portfolioVsData) pvsByDate[pt.date] = pt.value;

    // Overlapping dates (last 60 trading days max)
    const allDates = Object.keys(spByDate).filter(d => pvsByDate[d]).sort();
    const dates = allDates.slice(-60);
    if (dates.length < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '12px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Not enough data yet', W / 2, H / 2);
        _updatePortfolioVsStats(null, null);
        return;
    }

    // Normalize to % change from first overlapping date
    const spBase  = spByDate[dates[0]];
    const pvsBase = pvsByDate[dates[0]];
    const spVals  = dates.map(d => ((spByDate[d]  / spBase)  - 1) * 100);
    const pvsVals = dates.map(d => ((pvsByDate[d] / pvsBase) - 1) * 100);

    const PAD = { top: 12, right: 10, bottom: 26, left: 46 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    const allVals = [...spVals, ...pvsVals];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const vPad = (maxV - minV) * 0.1 || 1;
    const minVP = minV - vPad, maxVP = maxV + vPad;
    const vRng  = maxVP - minVP;

    const xOf = i => PAD.left + (i / (dates.length - 1)) * cW;
    const yOf = v => PAD.top  + (1 - (v - minVP) / vRng) * cH;

    // Y gridlines
    for (let i = 0; i <= 4; i++) {
        const v = minVP + (i / 4) * vRng;
        const y = yOf(v);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '10px "JetBrains Mono",monospace';
        ctx.textAlign = 'right';
        ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1) + '%', PAD.left - 4, y + 3);
    }

    // Zero baseline
    if (minVP < 0 && maxVP > 0) {
        const y0 = yOf(0);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(PAD.left, y0); ctx.lineTo(W - PAD.right, y0); ctx.stroke();
        ctx.setLineDash([]);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '10px system-ui,sans-serif';
    const xCount = Math.min(5, dates.length);
    for (let i = 0; i < xCount; i++) {
        const idx = Math.round(i / (xCount - 1) * (dates.length - 1));
        const d   = new Date(dates[idx] + 'T12:00:00');
        ctx.fillText(d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }), xOf(idx), H - 6);
    }

    // S&P gradient fill
    const spColor = '#3b82f6';
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    const spIsUp = spVals[spVals.length - 1] >= 0;
    grad.addColorStop(0, spIsUp ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(spVals[0]));
    for (let i = 1; i < spVals.length; i++) ctx.lineTo(xOf(i), yOf(spVals[i]));
    ctx.lineTo(xOf(spVals.length - 1), yOf(0));
    ctx.lineTo(xOf(0), yOf(0));
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // S&P line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(spVals[0]));
    for (let i = 1; i < spVals.length; i++) ctx.lineTo(xOf(i), yOf(spVals[i]));
    ctx.strokeStyle = spColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.stroke();

    // Portfolio line
    const pvsColor = '#14b8a6';
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pvsVals[0]));
    for (let i = 1; i < pvsVals.length; i++) ctx.lineTo(xOf(i), yOf(pvsVals[i]));
    ctx.strokeStyle = pvsColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Data dots
    if (dates.length <= 66) {
        const dotR = dates.length <= 22 ? 2.5 : 1.5;
        for (const [vals, col] of [[spVals, spColor], [pvsVals, pvsColor]]) {
            ctx.fillStyle = col;
            for (let i = 0; i < vals.length; i++) {
                ctx.beginPath();
                ctx.arc(xOf(i), yOf(vals[i]), dotR, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    _updatePortfolioVsStats(spVals, pvsVals);
}

function _updatePortfolioVsStats(spVals, pvsVals) {
    const portEl  = document.getElementById('pvsPortPct');
    const spEl    = document.getElementById('pvsSpPct');
    const alphaEl = document.getElementById('pvsAlpha');
    if (!portEl) return;
    if (!spVals || !pvsVals) {
        [portEl, spEl, alphaEl].forEach(el => { if (el) el.textContent = '—'; el?.classList.remove('pos','neg'); });
        return;
    }
    const portPct  = pvsVals[pvsVals.length - 1];
    const spPct    = spVals[spVals.length - 1];
    const alphaPct = portPct - spPct;
    const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    const cls = v => v >= 0 ? 'pos' : 'neg';
    portEl.textContent  = fmt(portPct);  portEl.className  = 'mkt-footer-val ' + cls(portPct);
    spEl.textContent    = fmt(spPct);    spEl.className    = 'mkt-footer-val ' + cls(spPct);
    alphaEl.textContent = fmt(alphaPct); alphaEl.className = 'mkt-footer-val ' + cls(alphaPct);
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
        const exDate = new Date(d.ex_dividend_date + 'T00:00:00');
        const diff = Math.round((payDate - today) / 86400000);
        const exDiff = Math.round((exDate - today) / 86400000);

        const isPaid = diff < 0;
        let status, statusClass;
        if (isPaid) { status = 'Paid'; statusClass = 'div-tl-status--paid'; }
        else if (exDiff < 0) { status = 'Pending Payout'; statusClass = 'div-tl-status--pending'; }
        else { status = 'Upcoming'; statusClass = 'div-tl-status--upcoming'; }

        let relLabel;
        if (isPaid) relLabel = 'PAID';
        else if (diff === 0) relLabel = 'TODAY';
        else if (diff === 1) relLabel = 'TOMORROW';
        else relLabel = `IN ${diff} DAYS`;

        const month = payDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        const day = payDate.getDate();
        const perShare = d.amount_per_share > 0 ? `$${d.amount_per_share.toFixed(4)}` : '—';
        const payout = d.expected_payout > 0 ? `Est. $${d.expected_payout.toFixed(2)} total` : '';
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
        [0,   25, '#dc2626'],
        [25,  45, '#ea580c'],
        [45,  55, '#475569'],
        [55,  75, '#16a34a'],
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
    _initChartRangeTabs();
    _initNasdaqRangeTabs();
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
        const res = await fetch(url);
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
        const title = news.headline || '—';
        const source = news.source || 'News';
        const url = news.url || '#';
        const time = news.datetime
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


/* ─── AI Market Digest ───────────────────────────────────────────────────── */
let _digestProvider = 'finviz';

async function loadMarketDigest(provider, force = false) {
    if (provider) _digestProvider = provider;
    const body = document.getElementById('digestBody');
    const meta = document.getElementById('digestMeta');
    const btn = document.getElementById('digestRefreshBtn');
    if (!body) return;

    const url = `/api/market-digest?provider=${_digestProvider}${force ? '&refresh=1' : ''}`;

    if (force) {
        body.innerHTML = `<div class="digest-loading"><div class="spinner" style="width:20px;height:20px;border-width:2px"></div><span>Generating digest…</span></div>`;
        if (btn) btn.disabled = true;
    }

    try {
        const res = await fetch(url);
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'Unknown error');
        _renderDigest(json.digest);
        if (meta) meta.textContent = json.cached ? 'Cached · 30m' : 'Just now';
    } catch (err) {
        body.innerHTML = `<div class="digest-error">Failed to load digest: ${esc(err.message)}</div>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function switchDigestProvider(provider) {
    _digestProvider = provider;
    document.querySelectorAll('.digest-provider-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.provider === provider);
    });
    loadMarketDigest(provider, false);
}

function _renderDigest(text) {
    const body = document.getElementById('digestBody');
    if (!body) return;

    const hi = s => s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    const parts = [];
    const pending = [];  // bullet accumulator

    const flushBullets = () => {
        if (!pending.length) return;
        parts.push(`<ul class="digest-list">${pending.splice(0).map(b => `<li>${b}</li>`).join('')}</ul>`);
    };

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (/^[•\-\*] /.test(line)) {
            pending.push(hi(line.slice(2).trim()));
        } else {
            flushBullets();
            const cls = /^\*\*|^#/.test(line) ? 'digest-headline' : 'digest-para';
            parts.push(`<div class="${cls}">${hi(line)}</div>`);
        }
    }
    flushBullets();

    body.innerHTML = parts.join('');
}

