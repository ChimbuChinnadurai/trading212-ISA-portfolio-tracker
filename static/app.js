/* ── SPA Note: Theme, toggleTheme, _updateThemeIcon are defined in home.js ── */
/* ── PORTFOLIO_ID is set dynamically by router.js before calling loadPortfolio ── */


/* ─── State ───────────────────────────────────────────────────────────────── */
let allRows = [];
let sortCol = 'current_value';
let sortDir = 'desc';
let activeCountry = null;
let _recommendations = {};
let _lastTotalDividends = null;
let _activityData = null;
let _dividendData = null;
let _monthlyData = null;
let _stockCalData = null;
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();

/* ─── Returns toggle state ────────────────────────────────────────────────── */
let _returnsMode = 'alltime'; // 'alltime' | 'today'
let _allTimeReturns = 0;
let _allTimeReturnsPct = 0;
let _todayReturns = null;     // null = not yet fetched
let _todayReturnsPct = null;
let _tickerChangeMap = {};    // ticker -> change_pct (today)
let _histReturnsData = null; // {ticker: {ret1w, ...}}

/* ─── Column picker ─────────────────────────────────────────────────────── */
const _COL_DEFS = [
  { id: 'ticker', label: 'Ticker', locked: true },
  { id: 'company', label: 'Company' },
  { id: 'country', label: 'Country' },
  { id: 'trend', label: '48h Trend' },
  { id: 'spark7d', label: '7d Chart' },
  { id: 'shares', label: 'Shares' },
  { id: 'avg_price', label: 'Avg Price' },
  { id: 'current_price', label: 'Current Price' },
  { id: 'breakeven', label: 'Breakeven' },
  { id: 'invested', label: 'Invested' },
  { id: 'value', label: 'Value' },
  { id: 'weight', label: 'Weight' },
  { id: 'pnl', label: 'P&L' },
  { id: 'fx_impact', label: 'FX Impact' },
  { id: 'returns_pct', label: 'Returns %' },
  { id: 'ret1d', label: '1d %' },
  { id: 'ret1w', label: '1w %' },
  { id: 'ret1m', label: '1M %' },
  { id: 'ret3m', label: '3M %' },
  { id: 'ret6m', label: '6M %' },
  { id: 'ret1y', label: '1y %' },
  { id: 'ret3y', label: '3y %' },
  { id: 'ret5y', label: '5y %' },
  { id: 'div_yield', label: 'Div Yield' },
  { id: 'rating', label: 'Rating' },
];

function _loadColVis() {
  try {
    const stored = JSON.parse(localStorage.getItem('colVisibility') || '{}');
    const map = {};
    _COL_DEFS.forEach(c => {
      // New historical return columns default to false
      const isHist = c.id.startsWith('ret') && c.id !== 'returns_pct';
      map[c.id] = c.locked ? true : (stored[c.id] !== undefined ? stored[c.id] : !isHist);
    });
    return map;
  } catch { return Object.fromEntries(_COL_DEFS.map(c => [c.id, !c.id.startsWith('ret') || c.id === 'returns_pct'])); }
}

function _saveColVis(map) {
  localStorage.setItem('colVisibility', JSON.stringify(map));
}

function _applyColVis(map) {
  _COL_DEFS.forEach(c => {
    document.querySelectorAll(`[data-colid="${c.id}"]`).forEach(el => {
      el.classList.toggle('col-hidden', map[c.id] === false);
    });
  });
}

function toggleColPicker() {
  let dropdown = document.getElementById('colPickerDropdown');
  if (!dropdown) {
    const map = _loadColVis();
    const wrap = document.getElementById('colPickerBtn').closest('.col-picker-wrap');
    dropdown = document.createElement('div');
    dropdown.id = 'colPickerDropdown';
    dropdown.className = 'col-picker-dropdown';
    dropdown.innerHTML = `
      <div class="col-picker-header">
        <span>Toggle Columns</span>
        <button class="col-picker-reset" onclick="_resetColVis()">Reset all</button>
      </div>
      <div class="col-picker-list">
        ${_COL_DEFS.map(c => `
          <label class="col-picker-item${c.locked ? ' col-picker-locked' : ''}">
            <input type="checkbox" data-col="${c.id}" ${map[c.id] !== false ? 'checked' : ''} ${c.locked ? 'disabled' : ''} onchange="_onColToggle(this)">
            <span>${c.label}</span>
          </label>
        `).join('')}
      </div>`;
    wrap.appendChild(dropdown);
  }
  dropdown.classList.toggle('open');
}

function _onColToggle(cb) {
  const map = _loadColVis();
  map[cb.dataset.col] = cb.checked;
  _saveColVis(map);
  _applyColVis(map);
}

function _resetColVis() {
  localStorage.removeItem('colVisibility');
  const map = _loadColVis();
  document.querySelectorAll('#colPickerDropdown input[type=checkbox]').forEach(cb => {
    cb.checked = map[cb.dataset.col] !== false;
  });
  _applyColVis(map);
}

document.addEventListener('click', e => {
  const dropdown = document.getElementById('colPickerDropdown');
  if (dropdown && dropdown.classList.contains('open')) {
    if (!dropdown.contains(e.target) && !e.target.closest('#colPickerBtn')) {
      dropdown.classList.remove('open');
    }
  }
});

/* ─── Currency colors ───────────────────────────────────────────────────── */
const CURRENCY_COLORS = {
  GBP: '#3b82f6', USD: '#f43f5e', EUR: '#8b5cf6',
  JPY: '#f59e0b', AUD: '#0ea5e9', CHF: '#ec4899',
  HKD: '#dc2626', CAD: '#ef4444', SEK: '#10b981',
  DKK: '#06b6d4', NOK: '#22c55e',
};
function normalizeCurrency(code) {
  if (!code) return 'GBP';
  const c = code.toUpperCase();
  if (c === 'GBX' || c === 'GBP') return 'GBP';
  return c;
}

/* ─── Country colors ────────────────────────────────────────────────────── */
const COUNTRY_COLORS = {
  UK: '#3b82f6', US: '#f43f5e', DE: '#eab308', FR: '#8b5cf6',
  IE: '#10b981', NL: '#f97316', CA: '#ef4444', AU: '#0ea5e9',
  CH: '#ec4899', JP: '#f59e0b', HK: '#dc2626', CN: '#dc2626',
};
const COUNTRY_FLAGS = {
  UK: '🇬🇧', US: '🇺🇸', DE: '🇩🇪', FR: '🇫🇷', NL: '🇳🇱',
  IE: '🇮🇪', LU: '🇱🇺', CH: '🇨🇭', CA: '🇨🇦', AU: '🇦🇺',
  JP: '🇯🇵', ES: '🇪🇸', IT: '🇮🇹', SE: '🇸🇪', DK: '🇩🇰',
  NO: '🇳🇴', FI: '🇫🇮', BE: '🇧🇪', HK: '🇭🇰', CN: '🇨🇳',
};
function countryColor(c) { return COUNTRY_COLORS[c] || '#64748b'; }

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function colorClass(n) {
  if (n == null) return '';
  return Number(n) >= 0 ? 'pos' : 'neg';
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



/* ─── Activity panels ─────────────────────────────────────────────────────── */
let _actFilter = 'all';

function _actSwitchFilter(f) {
  _actFilter = f;
  ['all', 'stock', 'dividend'].forEach(t => {
    const btn = document.getElementById('actTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === f);
  });
  if (_activityData || _dividendData) {
    _renderActivity(_activityData || [], _dividendData || []);
  }
}

async function loadDetailActivity() {
  try {
    const [actRes, divRes] = await Promise.all([
      fetch(`/api/p${PORTFOLIO_ID}/activity`),
      fetch(`/api/p${PORTFOLIO_ID}/recent-dividends`)
    ]);
    const actJson = await actRes.json();
    const divJson = await divRes.json();
    _activityData = actJson.data || [];
    _dividendData = divJson.data || [];
    _renderActivity(_activityData, _dividendData, actJson.warning);
  } catch (err) {
    document.getElementById('detailActivityList').innerHTML =
      `<div class="activity-empty">Could not load activity: ${esc(err.message)}</div>`;
  }
}

function _renderActivity(orders, dividends, warning) {
  const listEl = document.getElementById('detailActivityList');

  const taggedOrders = orders.map(o => ({ ...o, _type: 'order' }));
  const taggedDivs = dividends.map(d => ({ ...d, _type: 'dividend' }));
  const all = [...taggedOrders, ...taggedDivs].sort((a, b) => {
    const dateA = a.dateExecuted ?? a.dateCreated ?? a.paidOn ?? a.date ?? '';
    const dateB = b.dateExecuted ?? b.dateCreated ?? b.paidOn ?? b.date ?? '';
    return dateB.localeCompare(dateA);
  });

  const combined = _actFilter === 'all' ? all
    : _actFilter === 'dividend' ? all.filter(i => i._type === 'dividend')
      : all.filter(i => i._type === 'order');

  if (combined.length === 0) {
    const msg = warning ? `API error: ${warning}` : 'No recent activity found.';
    listEl.innerHTML = `<div class="activity-empty">${esc(msg)}</div>`;
    return;
  }

  const badge = document.getElementById('detailActivityBadge');
  if (badge) { badge.textContent = combined.length; badge.style.display = ''; }

  listEl.innerHTML = combined.map(item => {
    if (item._type === 'dividend') {
      const rawTicker = item.ticker || '';
      const ticker = rawTicker.split('_')[0] || rawTicker;
      const company = item._company_name || item.company_name || ticker || 'Unknown';
      const amount = fmt.currency(item.amount || 0);
      const rawDate = item.paidOn || item.date || '';
      const timeStr = rawDate
        ? new Date(rawDate).toLocaleString('en-GB', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        })
        : '—';
      return `
        <div class="activity-item">
          <div class="activity-dot activity-dot-div"></div>
          <div class="activity-content">
            <span class="activity-company">${esc(company)}</span>
            <span class="activity-ticker activity-ticker-sm">${esc(ticker)}</span>
            <div class="activity-desc">Dividend paid</div>
            <div class="activity-time">${timeStr}</div>
          </div>
          <div class="activity-amount pos">${amount}</div>
        </div>`;
    }

    const rawTicker = item.ticker || '';
    const ticker = rawTicker.split('_')[0] || rawTicker;
    const company = item._company_name || item.company_name || ticker || 'Unknown stock';

    const qty = Math.abs(item.filledQuantity ?? item.orderedQuantity ?? 0);
    const price = item.fillPrice ?? item.filledPrice ?? 0;
    const rawDate = item.dateExecuted ?? item.dateCreated ?? '';
    const status = (item.status || '').toUpperCase();
    const type = item.type || '';

    const isCancelled = status === 'CANCELLED' || status === 'REJECTED';
    const typeUpper = type.toUpperCase();
    const isSell = (item.side || item.direction || '').toUpperCase() === 'SELL'
      || typeUpper.includes('SELL');
    const dotClass = isCancelled ? 'activity-dot-cancel'
      : isSell ? 'activity-dot-sell'
        : 'activity-dot-buy';
    const actionWord = isCancelled ? (status === 'CANCELLED' ? 'Cancelled' : 'Rejected')
      : isSell ? 'Sold'
        : 'Bought';

    const timeStr = rawDate
      ? new Date(rawDate).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      })
      : '—';
    const value = item.filledValue
      ? fmt.currency(item.filledValue)
      : (qty && price) ? fmt.currency(qty * price) : '—';

    return `
      <div class="activity-item">
        <div class="activity-dot ${dotClass}"></div>
        <div class="activity-content">
          <span class="activity-company">${esc(company)}</span>
          <span class="activity-ticker activity-ticker-sm">${esc(ticker)}</span>
          <div class="activity-desc">${actionWord}${qty > 0 ? ' · ' + fmt.number(qty, 4) + ' shares' : type ? ' · ' + type.replace(/_/g, ' ').toLowerCase() : ''}</div>
          <div class="activity-time">${timeStr}</div>
        </div>
        <div class="activity-amount ${isCancelled ? 'neg' : ''}">${value}</div>
      </div>`;
  }).join('');
}


/* ─── Load portfolio ──────────────────────────────────────────────────────── */
async function loadPortfolio(force = false) {
  document.getElementById('refreshBtn').disabled = true;
  showSkeletons();
  activeCountry = null;
  _todayReturns = null;
  _todayReturnsPct = null;
  _dynamicsData = null;
  _dynamicsRange = '12m';
  let _loadSuccess = false;

  try {
    const url = force ? `/api/p${PORTFOLIO_ID}/portfolio?force=1` : `/api/p${PORTFOLIO_ID}/portfolio`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.status !== 'ok') {
      showState('error', json.message || 'Failed to load portfolio.');
      return;
    }

    allRows = json.data || [];

    if (allRows.length === 0) {
      showState('empty');
      return;
    }

    // Pre-compute weight and dividend yield per row
    const totalValue = allRows.reduce((s, r) => s + r.current_value, 0);
    allRows.forEach(r => {
      r.weight = totalValue ? r.current_value / totalValue * 100 : 0;
      r.div_yield = r.current_value > 0 ? (r.dividends / r.current_value * 100) : 0;
    });

    _lastTotalDividends = json.total_dividends ?? null;

    renderSummary(allRows, _lastTotalDividends);
    renderTable(allRows);
    if (_returnsMode === 'today') _loadTodayReturns();
    document.getElementById('dashboard').style.display = '';
    document.getElementById('stateError').style.display = 'none';
    document.getElementById('stateEmpty').style.display = 'none';

    // Accurate data timestamp
    const cached = json.cached;
    const cacheAge = json.cache_age;
    const fetchedAt = (cached && cacheAge != null)
      ? new Date(Date.now() - cacheAge * 1000)
      : new Date();
    const ts = fetchedAt.toLocaleTimeString('en-GB');
    // Footer data
    const lastUpdated = document.getElementById('lastUpdated');
    if (lastUpdated) lastUpdated.textContent = ts;
    const summaryTime = document.getElementById('summaryTime');
    if (summaryTime) {
      summaryTime.textContent = ts;
      const summaryUpdated = document.getElementById('summaryUpdated');
      if (summaryUpdated) summaryUpdated.removeAttribute('data-stale');
    }

    // Cache banner (CACHED badge)
    const cacheEl = document.getElementById('cacheBanner');
    if (cacheEl) {
      if (json.cached || json.cache_age > 0) {
        const ageStr = fmtAge(json.cache_age);
        cacheEl.innerHTML = `<span class="cb-dot"></span>Cached &middot; fetched ${ageStr} &middot; <span class="cb-refresh" onclick="loadPortfolio(true)">click Refresh for live</span>`;
        cacheEl.style.display = '';
      } else {
        cacheEl.style.display = 'none';
      }
    }

    // Per-data-type freshness indicators
    const freshEl = document.getElementById('freshnessInfo');
    if (freshEl && json.metadata && json.metadata.freshness) {
      const f = json.metadata.freshness;
      const dot = (age, threshold) =>
        `<span class="${(age ?? 9999) < threshold ? 'fresh-live' : 'fresh-stale'}">${fmtAge(age)}</span>`;
      freshEl.innerHTML =
        `Prices: ${dot(f.prices, 120)} <span class="footer-sep">·</span> ` +
        `Dividends: ${dot(f.dividends, 1800)} <span class="footer-sep">·</span> ` +
        `FX Rate: ${dot(f.fx, 300)}`;
      freshEl.style.display = '';
    }

    // Stale banner (> 5 minutes)
    const staleEl = document.getElementById('staleBanner');
    if (staleEl) {
      if (cached && cacheAge != null && cacheAge > 300) {
        const mins = Math.floor(cacheAge / 60);
        const staleText = document.getElementById('staleBannerText');
        if (staleText) staleText.textContent = `Data is ${mins} minute${mins !== 1 ? 's' : ''} old.`;
        staleEl.style.display = '';
      } else {
        staleEl.style.display = 'none';
      }
    }

    // Dividend warning
    const warnEl = document.getElementById('divWarning');
    if (warnEl) {
      if (json.warning) {
        warnEl.textContent = '⚠ ' + json.warning;
        warnEl.style.display = '';
      } else {
        warnEl.style.display = 'none';
      }
    }

    // Load portfolio bottom panels
    _actFilter = 'all';
    ['all', 'stock', 'dividend'].forEach(t => {
      const btn = document.getElementById('actTab' + t.charAt(0).toUpperCase() + t.slice(1));
      if (btn) btn.classList.toggle('active', t === 'all');
    });
    loadDetailActivity();
    loadMonthlyDividends();
    loadDynamicsChart();
    loadRiskMetricsStrip();
    loadRealizedUnrealized();
    
    _loadSuccess = true;

  } catch (err) {
    showState('error', 'Network error: ' + err.message);
  } finally {
    document.getElementById('refreshBtn').disabled = false;
    hideSkeletons();
    if (_loadSuccess && force) showRefreshSuccess();
  }
}

function showSkeletons() {
  const cards = document.querySelectorAll('.s-card-value, .s-card-sub, .s-card-pct');
  cards.forEach(el => {
    el.classList.add('skeleton', 'skeleton-text');
    el.dataset.oldText = el.textContent;
    el.textContent = '';
  });

  const tbody = document.getElementById('tableBody');
  if (tbody) {
    tbody.innerHTML = Array(8).fill(0).map(() => `
      <tr class="skeleton-row-loading">
        <td colspan="16"><div class="skeleton skeleton-row"></div></td>
      </tr>
    `).join('');
  }
}

function hideSkeletons() {
  const skeletons = document.querySelectorAll('.skeleton');
  skeletons.forEach(el => {
    el.classList.remove('skeleton', 'skeleton-text');
    if (el.dataset.oldText && el.textContent === '') {
      el.textContent = el.dataset.oldText;
    }
  });
}

/* ─── Count-up animation for summary card values ─────────────────────────── */
function _animateCardValue(el, toValue, formatter, duration = 700) {
  if (!el) return;
  // Remove any skeleton state so value is visible immediately
  el.classList.remove('skeleton', 'skeleton-text');
  const raw = parseFloat(el.dataset.rawValue);
  const fromValue = isNaN(raw) ? 0 : raw;
  el.dataset.rawValue = toValue;

  if (Math.abs(toValue - fromValue) < 0.005) {
    el.textContent = formatter(toValue);
    return;
  }

  const start = performance.now();
  const delta = toValue - fromValue;

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(fromValue + delta * eased);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = formatter(toValue);
  }
  requestAnimationFrame(tick);
}

/* ─── Summary cards ───────────────────────────────────────────────────────── */
function renderSummary(rows, allTimeDividends = null) {
  const totalValue = rows.reduce((s, r) => s + r.current_value, 0);
  const totalReturns = rows.reduce((s, r) => s + r.total_returns, 0);
  const totalDividends = allTimeDividends != null
    ? allTimeDividends
    : rows.reduce((s, r) => s + r.dividends, 0);
  const totalFx = rows.reduce((s, r) => s + (r.fx_impact ?? 0), 0);
  const invested = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
  const returnsPct = invested ? (totalReturns / invested) * 100 : 0;
  const winners = rows.filter(r => r.total_returns >= 0).length;
  const losers = rows.length - winners;

  const best = rows.reduce((b, r) => r.total_returns > (b?.total_returns ?? -Infinity) ? r : b, null);
  const worst = rows.reduce((w, r) => r.total_returns < (w?.total_returns ?? Infinity) ? r : w, null);
  const topDiv = rows.reduce((t, r) => r.dividends > (t?.dividends ?? -Infinity) ? r : t, null);

  // Card 1: Portfolio Value
  _animateCardValue(document.getElementById('totalValue'), totalValue, v => fmt.currency(v));
  set('totalInvested', 'Invested: ' + fmt.currency(invested));
  set('totalHoldings', rows.length + ' holdings');

  // Card 2: Dividends
  _animateCardValue(document.getElementById('totalDividends'), totalDividends, v => fmt.currency(v));

  const topDivEl = document.getElementById('topDivStock');
  if (topDiv && topDiv.dividends > 0) {
    topDivEl.innerHTML = `🏅 ${esc(topDiv.company_name)} <strong>${fmt.currency(topDiv.dividends)}</strong>`;
    topDivEl.className = 's-card-sub';
  } else {
    topDivEl.textContent = 'No dividends yet';
    topDivEl.className = 's-card-sub';
  }
  const fEl = document.getElementById('totalFxImpact');
  if (rows.some(r => r.fx_impact != null)) {
    fEl.textContent = 'FX: ' + (totalFx >= 0 ? '+' : '') + fmt.currency(totalFx);
    fEl.className = 's-card-sub ' + colorClass(totalFx);
  } else {
    fEl.textContent = '';
    fEl.className = 's-card-sub';
  }

  // Card 3: Returns — store all-time values, re-render with current mode
  _allTimeReturns = totalReturns;
  _allTimeReturnsPct = returnsPct;
  _renderReturnsValues();

  const rc = document.getElementById('returnsCard');
  if (rc) rc.dataset.pnl = totalReturns >= 0 ? 'pos' : 'neg';

  // Update breadcrumb value
  const bcv = document.getElementById('breadcrumbValue');
  if (bcv) { bcv.textContent = ' · ' + fmt.currency(totalValue); bcv.style.display = ''; }

  const wlEl = document.getElementById('winnersLosers');
  wlEl.innerHTML =
    `<span style="color:var(--green)">${winners} up</span>` +
    ` · <span style="color:var(--red)">${losers} down</span>`;

  const bpEl = document.getElementById('bestPct');
  if (best) {
    bpEl.className = 's-card-sub pos';
    bpEl.innerHTML = `🏆 ${esc(best.ticker)} <strong>+${fmt.currency(best.total_returns)}</strong>`;
  }
  const wpEl = document.getElementById('worstPct');
  if (worst) {
    wpEl.className = 's-card-sub neg';
    wpEl.innerHTML = `📉 ${esc(worst.ticker)} <strong>${fmt.currency(worst.total_returns)}</strong>`;
  }

  drawPortfolioHeatmap(rows, totalValue);
  drawSectorHeatmap(rows, totalValue);
}

/* ─── Returns toggle ──────────────────────────────────────────────────────── */
function _renderReturnsValues() {
  const isToday = _returnsMode === 'today';
  const val = isToday ? _todayReturns : _allTimeReturns;
  const pct = isToday ? _todayReturnsPct : _allTimeReturnsPct;

  const rEl = document.getElementById('totalReturns');
  const pEl = document.getElementById('totalReturnsPct');
  if (!rEl || !pEl) return;

  if (isToday && val === null) {
    rEl.textContent = '—';
    rEl.className = 's-card-value';
    pEl.textContent = 'Loading…';
    pEl.className = 's-card-pct';
  } else if (val != null) {
    rEl.className = 's-card-value ' + colorClass(val);
    _animateCardValue(rEl, val, v => (v >= 0 ? '+' : '') + fmt.currency(v));
    pEl.textContent = fmt.pct(pct);
    pEl.className = 's-card-pct ' + colorClass(pct);
  }
}

function setReturnsMode(mode) {
  _returnsMode = mode;
  const btnAll = document.getElementById('returnsBtnAllTime');
  const btnToday = document.getElementById('returnsBtnToday');
  if (btnAll) btnAll.classList.toggle('active', mode === 'alltime');
  if (btnToday) btnToday.classList.toggle('active', mode === 'today');

  if (mode === 'today' && _todayReturns === null) {
    _loadTodayReturns();
  } else {
    _renderReturnsValues();
  }
}

async function _loadTodayReturns() {
  _renderReturnsValues(); // show "Loading…"
  try {
    const res = await fetch('/api/stock-tickers');
    const json = await res.json();
    if (!json.data) return;

    _tickerChangeMap = {};
    for (const d of json.data) _tickerChangeMap[d.ticker] = d.change_pct ?? 0;

    let todayTotal = 0;
    let todayInvested = 0;
    for (const r of allRows) {
      const chg = _tickerChangeMap[r.ticker] ?? 0;
      todayTotal += r.current_value * chg / 100;
      todayInvested += r.current_value;
    }
    _todayReturns = todayTotal;
    _todayReturnsPct = todayInvested ? (todayTotal / todayInvested) * 100 : 0;
    renderTopMovers();
  } catch (_) {
    _todayReturns = 0;
    _todayReturnsPct = 0;
  }
  _renderReturnsValues();
}

function _updateMktStatusDot(isOpen) {
  const dot = document.getElementById('mktStatusDot');
  if (!dot) return;
  dot.className = 'mkt-status-dot ' + (isOpen ? 'mkt-dot-open' : 'mkt-dot-closed');
  dot.title = isOpen ? 'Market open' : 'Market closed';
}

/* ─── Country allocation bar ─────────────────────────────────────────────── */
function renderAllocBar(rows, totalValue) {
  const byCountry = {};
  rows.forEach(r => { byCountry[r.country] = (byCountry[r.country] || 0) + r.current_value; });
  const sorted = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);

  const bar = document.getElementById('allocBar');
  const legend = document.getElementById('allocLegend');
  bar.innerHTML = '';
  legend.innerHTML = '';

  sorted.forEach(([country, value]) => {
    const pct = value / totalValue * 100;
    const col = countryColor(country);
    const flag = COUNTRY_FLAGS[country] || '';

    const seg = document.createElement('div');
    seg.className = 'alloc-segment';
    seg.style.width = pct.toFixed(2) + '%';
    seg.style.background = col;
    seg.title = `${flag} ${country}: ${pct.toFixed(1)}% (${fmt.currency(value)})`;
    seg.onclick = () => filterCountry(country);
    bar.appendChild(seg);

    const item = document.createElement('div');
    item.className = 'legend-item';
    item.onclick = () => filterCountry(country);
    item.innerHTML = `
      <div class="legend-dot" style="background:${col}"></div>
      <span>${flag} ${country} <strong>${pct.toFixed(1)}%</strong></span>`;
    legend.appendChild(item);
  });
}

/* ─── Currency exposure bar ──────────────────────────────────────────────── */
function renderCurrencyBar(rows, totalValue) {
  const byCurrency = {};
  rows.forEach(r => {
    const cur = normalizeCurrency(r.currency_code || '');
    byCurrency[cur] = (byCurrency[cur] || 0) + r.current_value;
  });
  const sorted = Object.entries(byCurrency).sort((a, b) => b[1] - a[1]);

  const bar = document.getElementById('currencyBar');
  const legend = document.getElementById('currencyLegend');
  if (!bar || !legend) return;
  bar.innerHTML = '';
  legend.innerHTML = '';

  sorted.forEach(([cur, value]) => {
    const pct = value / totalValue * 100;
    const col = CURRENCY_COLORS[cur] || '#64748b';

    const seg = document.createElement('div');
    seg.className = 'alloc-segment';
    seg.style.width = pct.toFixed(2) + '%';
    seg.style.background = col;
    seg.title = `${cur}: ${pct.toFixed(1)}% (${fmt.currency(value)})`;
    bar.appendChild(seg);

    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-dot" style="background:${col}"></div>
      <span>${cur} <strong>${pct.toFixed(1)}%</strong></span>`;
    legend.appendChild(item);
  });

  const section = document.getElementById('currencySection');
  if (section) section.style.display = 'block';
}


/* ─── Monthly dividends chart ────────────────────────────────────────────── */
async function loadMonthlyDividends() {
  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/dividend-monthly`);
    const json = await res.json();
    _monthlyData = (json.data || []).filter(d => d.amount > 0);
    _renderMonthly(_monthlyData);
  } catch (_) {
    const panel = document.getElementById('monthlyDivPanel');
    if (panel) panel.style.display = 'none';
  }
}

function _renderMonthly(data) {
  const chartEl = document.getElementById('monthlyChart');
  if (!chartEl) return;

  if (data.length === 0) { chartEl.style.display = 'none'; return; }

  chartEl.style.display = '';
  // Show last 8 months in the mini chart for better fit
  const recent = data.slice(-8);
  const maxAmount = Math.max(...recent.map(d => d.amount));

  chartEl.innerHTML = `<div class="monthly-bars-mini">
    ${recent.map(d => {
    const pct = maxAmount > 0 ? (d.amount / maxAmount * 100) : 0;
    const label = new Date(d.month + '-01').toLocaleString('en-GB', { month: 'short' });
    const tipText = `<strong>${label}</strong><br/>${fmt.currency(d.amount)}`;
    return `<div class="month-bar-item" 
              onmouseenter="showTooltip(event, '${tipText}')" 
              onmouseleave="hideTooltip()">
        <div class="month-bar-track">
          <div class="month-bar-spacer" style="flex:${(100 - pct).toFixed(1)}"></div>
          <div class="month-bar-fill" style="flex:${pct.toFixed(1)}"></div>
        </div>
        <div class="month-bar-label">${label}</div>
      </div>`;
  }).join('')}
  </div>`;
}

/* ─── Sector Allocation (Category) ─────────────────────────────────────────── */
function renderSectorBar(rows, totalValue) {
  const bySector = {};
  rows.forEach(r => { bySector[r.sector || 'Other'] = (bySector[r.sector || 'Other'] || 0) + r.current_value; });
  const sorted = Object.entries(bySector).sort((a, b) => b[1] - a[1]);

  const bar = document.getElementById('sectorBar');
  const legend = document.getElementById('sectorLegend');
  if (!bar || !legend) return;

  bar.innerHTML = '';
  legend.innerHTML = '';

  const colors = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#84cc16', '#10b981', '#06b6d4', '#0ea5e9',
    '#6366f1', '#d946ef', '#f4f4f5'
  ];

  sorted.forEach(([sector, value], i) => {
    const pct = value / totalValue * 100;
    const col = colors[i % colors.length];

    const seg = document.createElement('div');
    seg.className = 'alloc-segment';
    seg.style.width = pct.toFixed(2) + '%';
    seg.style.background = col;
    const tipText = `<strong>${esc(sector)}</strong><br/>${pct.toFixed(1)}% (${fmt.currency(value)})`;
    seg.onmouseenter = (e) => showTooltip(e, tipText);
    seg.onmouseleave = hideTooltip;
    bar.appendChild(seg);

    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-dot" style="background:${col}"></div>
      <span>${sector} <strong>${pct.toFixed(1)}%</strong></span>`;
    legend.appendChild(item);
  });
}

/* ─── Country filters ────────────────────────────────────────────────────── */
function renderCountryFilters(rows) {
  const bar = document.getElementById('filterBar');
  bar.innerHTML = '';

  const counts = {};
  rows.forEach(r => { counts[r.country] = (counts[r.country] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const all = document.createElement('button');
  all.className = 'filter-pill active';
  all.id = 'pill-all';
  all.innerHTML = `All <span class="filter-pill-count">${rows.length}</span>`;
  all.onclick = () => filterCountry(null);
  bar.appendChild(all);

  sorted.forEach(([country, count]) => {
    const flag = COUNTRY_FLAGS[country] || '';
    const btn = document.createElement('button');
    btn.className = 'filter-pill';
    btn.id = `pill-${country}`;
    btn.innerHTML = `${flag} ${country} <span class="filter-pill-count">${count}</span>`;
    btn.onclick = () => filterCountry(country);
    bar.appendChild(btn);
  });
}

function filterCountry(country) {
  activeCountry = (activeCountry === country) ? null : country;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(activeCountry ? `pill-${activeCountry}` : 'pill-all');
  if (target) target.classList.add('active');
  renderTable(allRows);
}

/* ─── P&L thermometer cell ───────────────────────────────────────────────── */
function _pnlCell(pnl, pct) {
  const sign = pnl >= 0 ? '+' : '';
  const clipped = Math.max(-100, Math.min(100, pct ?? 0));
  // Center-anchored bar: 50% = breakeven; each side fills up to 50% width
  const barW = (Math.abs(clipped) / 2).toFixed(1);   // 0 – 50 %
  const barL = (clipped >= 0 ? 50 : 50 + clipped).toFixed(1);
  const fillCls = pnl >= 0 ? 'pnl-fill-pos' : 'pnl-fill-neg';
  return `<div class="pnl-cell">
    <span class="pnl-amount ${colorClass(pnl)}">${sign}${fmt.currency(pnl)}</span>
    <div class="pnl-track" title="${sign}${(pct ?? 0).toFixed(2)}% vs break-even">
      <div class="pnl-fill ${fillCls}" style="left:${barL}%;width:${barW}%"></div>
      <div class="pnl-center-mark"></div>
    </div>
  </div>`;
}

/* ─── Analyst ratings ─────────────────────────────────────────────────────── */
async function loadAnalystRatings() {
  try {
    const res = await fetch('/api/analyst-ratings');
    const json = await res.json();
    if (json.status === 'ok') {
      _recommendations = json.data || {};
      renderTable(allRows);
    } else {
      console.warn('Analyst ratings error:', json.message);
    }
  } catch (err) {
    console.error('Failed to load analyst ratings:', err);
  }
}

function _ratingCell(r) {
  if ((r.sector || '').toLowerCase().includes('index')) return '<span class="cell-na">N/A</span>';
  const rec = _recommendations[r.ticker];
  if (!rec) return '<span class="cell-na">—</span>';
  const cls = {
    'Strong Buy': 'rating-strong-buy',
    'Buy': 'rating-buy',
    'Hold': 'rating-hold',
    'Sell': 'rating-sell',
    'Strong Sell': 'rating-strong-sell',
  }[rec.consensus] || '';
  const tooltip = rec.total > 0
    ? `${rec.total} analysts · ${rec.period}`
    : rec.consensus;
  return `<span class="rating-badge ${cls}" title="${esc(tooltip)}">${esc(rec.consensus)}</span>`;
}

/* ─── Table render ────────────────────────────────────────────────────────── */
function renderTable(rows) {
  const sorted = sortRows([...rows]);
  const filtered = filterRows(sorted);
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  filtered.forEach(r => {
    let fxCell;
    if (r.fx_impact == null) {
      fxCell = '<span class="cell-na">N/A</span>';
    } else {
      const sign = r.fx_impact >= 0 ? '+' : '';
      fxCell = `<span class="${colorClass(r.fx_impact)}">${sign}${fmt.currency(r.fx_impact)}</span>`;
    }

    const w = r.weight ?? 0;
    const bar = Math.min(w, 100);
    const weightCell = `
      <div class="weight-bar-wrap weight-cell">
        <div class="weight-bar-track">
          <div class="weight-bar-fill" style="width:${bar.toFixed(1)}%"></div>
        </div>
        <span class="weight-val">${w.toFixed(1)}%</span>
      </div>`;

    const cbClass = `country-badge cb-${r.country}`;
    const pct = r.returns_pct;
    let perfClass = '';
    if (pct >= 20) perfClass = 'perf-strong-pos';
    else if (pct >= 0) perfClass = 'perf-pos';
    else if (pct >= -10) perfClass = 'perf-neg';
    else perfClass = 'perf-strong-neg';

    const tr = document.createElement('tr');
    tr.className = perfClass;
    tr.style.cursor = 'pointer';
    tr.onclick = () => openStockPanel(r);
    const sectorLabel = r.sector
      ? `<span class="cell-sector">${esc(r.sector)}</span>` : '';
    const divYieldCell = r.div_yield > 0
      ? `<span class="div-yield-badge">${r.div_yield.toFixed(2)}%</span>`
      : '<span class="div-yield-badge">0.00%</span>';

    // Current price + Breakeven cells
    const beQty = r.quantity || 1;
    const beBreakeven = (r.invested - (r.dividends || 0)) / beQty;
    const beCurrentPx = r.current_value / beQty;
    const currentPxCell = `<span class="cell-num">${fmt.currency(beCurrentPx, 4)}</span>`;
    let beCell;
    if (beCurrentPx >= beBreakeven) {
      beCell = `<span class="be-profit">${fmt.currency(beBreakeven, 4)}</span>`;
    } else {
      const shortfall = (beBreakeven - beCurrentPx).toFixed(4);
      beCell = `<span class="be-loss">${fmt.currency(beBreakeven, 4)}</span><br><span class="be-needed-tag">${fmt.currency(shortfall, 4)} short</span>`;
    }

    const sparkId = 'sspark-' + r.ticker.replace(/[^a-zA-Z0-9]/g, '_');
    const spark7dId = 'spark7d-' + r.ticker.replace(/[^a-zA-Z0-9]/g, '_');
    tr.innerHTML = `
      <td data-colid="ticker"><span class="cell-ticker">${esc(r.ticker)}</span></td>
      <td data-colid="company">
        <div class="cell-name-wrap">
          <span class="cell-company" title="${esc(r.company_name)}">${esc(r.company_name)}</span>
          ${sectorLabel}
        </div>
      </td>
      <td data-colid="country"><span class="${cbClass}">${esc(r.country)}</span></td>
      <td data-colid="trend" class="td-center">
        <div class="trend-skeleton"></div>
        <canvas class="stock-spark" id="${sparkId}" width="80" height="32"></canvas>
      </td>
      <td data-colid="spark7d" class="td-center">
        <canvas class="stock-spark7d" id="${spark7dId}" width="72" height="28"></canvas>
      </td>
      <td data-colid="shares" class="td-right cell-num">${fmt.number(r.quantity, 6)}</td>
      <td data-colid="avg_price" class="td-right cell-num">${fmt.currency(r.avg_price, 4)}</td>
      <td data-colid="current_price" class="td-right cell-num">${currentPxCell}</td>
      <td data-colid="breakeven" class="td-right cell-num">${beCell}</td>
      <td data-colid="invested" data-label="Invested" class="td-right cell-num">${fmt.currency(r.invested)}</td>
      <td data-colid="value" data-label="Value" class="td-right cell-num mob-primary">${fmt.currency(r.current_value)}</td>
      <td data-colid="weight" class="td-right">${weightCell}</td>
      <td data-colid="pnl" data-label="P&L" class="td-right mob-secondary">
        ${_pnlCell(r.total_returns, r.returns_pct)}
      </td>
      <td data-colid="fx_impact" class="td-right cell-num">${fxCell}</td>
      <td data-colid="returns_pct" data-label="Return" class="td-right mob-badge">
        <span class="pct-badge ${colorClass(r.returns_pct)}">
          ${r.returns_pct >= 0 ? '▲' : '▼'} ${Math.abs(r.returns_pct).toFixed(2)}%
        </span>
      </td>
      <td data-colid="ret1d" class="td-right">${_histReturnCell(r, 'ret1d')}</td>
      <td data-colid="ret1w" class="td-right">${_histReturnCell(r, 'ret1w')}</td>
      <td data-colid="ret1m" class="td-right">${_histReturnCell(r, 'ret1m')}</td>
      <td data-colid="ret3m" class="td-right">${_histReturnCell(r, 'ret3m')}</td>
      <td data-colid="ret6m" class="td-right">${_histReturnCell(r, 'ret6m')}</td>
      <td data-colid="ret1y" class="td-right">${_histReturnCell(r, 'ret1y')}</td>
      <td data-colid="ret3y" class="td-right">${_histReturnCell(r, 'ret3y')}</td>
      <td data-colid="ret5y" class="td-right">${_histReturnCell(r, 'ret5y')}</td>
      <td data-colid="div_yield" class="td-right">${divYieldCell}</td>
      <td data-colid="rating" class="td-right">${_ratingCell(r)}</td>
    `;
    tbody.appendChild(tr);
  });

  _applyColVis(_loadColVis());

  const total = rows.length, shown = filtered.length;
  const rcEl = document.getElementById('rowCount');
  if (rcEl) {
    rcEl.textContent = shown === total
      ? `${total} holding${total !== 1 ? 's' : ''}`
      : `${shown} of ${total} holdings`;
  }

  _loadStockSparklines(filtered);
  _loadSparklines7d(filtered);
}

function _histReturnCell(row, key) {
  const val = row[key];
  if (val == null) return '<span class="cell-na">N/A</span>';
  const cls = val >= 0 ? 'pos' : 'neg';
  const sign = val >= 0 ? '+' : '';
  return `<span class="pct-badge-small ${cls}">${sign}${val.toFixed(2)}%</span>`;
}

/* ─── Stock 48h Sparklines ────────────────────────────────────────────────── */

let _sparklineVisibleMap = {}; // cache to track if we've already shown a sparkline

async function _loadStockSparklines(rows, forceRefresh = false) {
  if (!rows.length) return;
  const tickers = rows.map(r => r.ticker).join(',');
  const countries = rows.map(r => r.country).join(',');

  // Clear skeletons visually if this is a refresh
  if (forceRefresh) {
    document.querySelectorAll('[data-colid="trend"]').forEach(td => {
      td.classList.remove('trend-refreshing');
      void td.offsetWidth; // reflow
      td.classList.add('trend-refreshing');
      setTimeout(() => td.classList.remove('trend-refreshing'), 800);
    });
  }

  try {
    const res = await fetch(`/api/stock-sparklines?tickers=${encodeURIComponent(tickers)}&countries=${encodeURIComponent(countries)}`);
    const json = await res.json();
    if (json.status !== 'ok') return;

    for (const [ticker, points] of Object.entries(json.data)) {
      if (!points.length) continue;
      const sparkId = ticker.replace(/[^a-zA-Z0-9]/g, '_');
      const canvasId = 'sspark-' + sparkId;

      // Draw the sparkline
      _drawStockSparkline(canvasId, points);

      // Remove the skeleton for this ticker once data is ready
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        const skeleton = canvas.parentElement.querySelector('.trend-skeleton');
        if (skeleton) skeleton.remove();
      }
    }
  } catch (err) {
    console.warn('[stockSpark]', err);
  }
}

function _drawStockSparkline(canvasId, points) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const W = 80, H = 32;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const prices = points.map(p => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = (maxP - minP) || 1;
  const isUp = prices[prices.length - 1] >= prices[0];
  const lineCol = isUp ? '#10b981' : '#ef4444';
  const fillCol = isUp ? 'rgba(16,185,129,0.13)' : 'rgba(239,68,68,0.13)';

  const pad = { top: 3, bottom: 3, left: 1, right: 1 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const xOf = i => pad.left + (i / (points.length - 1)) * cW;
  const yOf = v => pad.top + (1 - (v - minP) / range) * cH;

  // Fill
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(prices[0]));
  for (let i = 1; i < prices.length; i++) ctx.lineTo(xOf(i), yOf(prices[i]));
  ctx.lineTo(xOf(prices.length - 1), H - pad.bottom);
  ctx.lineTo(xOf(0), H - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = fillCol;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(prices[0]));
  for (let i = 1; i < prices.length; i++) ctx.lineTo(xOf(i), yOf(prices[i]));
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  canvas._sparkPoints = points;
  canvas._sparkLineCol = lineCol;
  canvas._sparkMinP = minP;
  canvas._sparkRange = range;
  canvas._sparkPad = pad;

  _attachStockSparkHover(canvas);
}

function _attachStockSparkHover(canvas) {
  if (canvas._sparkBound) return;
  canvas._sparkBound = true;

  let tip = document.getElementById('stock-spark-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'stock-spark-tip';
    tip.className = 'spark-tip';
    document.body.appendChild(tip);
  }

  canvas.addEventListener('mousemove', (e) => {
    const points = canvas._sparkPoints;
    if (!points) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const W = 80;
    const pad = canvas._sparkPad;
    const cW = W - pad.left - pad.right;
    const idx = Math.max(0, Math.min(points.length - 1, Math.round((mouseX - pad.left) / cW * (points.length - 1))));
    const pt = points[idx];
    const time = new Date(pt.ts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    tip.innerHTML = `<span class="spark-tip-val">${pt.price.toFixed(2)}</span><span class="spark-tip-time">${time}</span>`;
    tip.style.display = 'flex';
    const tipW = 140;
    let left = e.clientX + window.scrollX - tipW / 2;
    if (left + tipW > window.innerWidth - 8) left = e.clientX + window.scrollX - tipW;
    if (left < 4) left = 4;
    tip.style.left = left + 'px';
    tip.style.top = (e.clientY + window.scrollY - 54) + 'px';
    e.stopPropagation();
  });

  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  canvas.addEventListener('click', e => e.stopPropagation());
}

/* ─── Sort ────────────────────────────────────────────────────────────────── */
function sortTable(th) {
  const col = th.dataset.col;
  sortDir = (sortCol === col && sortDir === 'desc') ? 'asc' : 'desc';
  sortCol = col;
  document.querySelectorAll('.th-sortable').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  renderTable(allRows);
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

/* ─── Filter ──────────────────────────────────────────────────────────────── */
function filterTable() { renderTable(allRows); }

function filterRows(rows) {
  let result = rows;
  if (activeCountry) result = result.filter(r => r.country === activeCountry);
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (q) result = result.filter(r =>
    r.company_name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q));
  return result;
}

/* ─── CSV Export ──────────────────────────────────────────────────────────── */
function exportCSV() {
  const visible = filterRows(sortRows([...allRows]));
  const headers = [
    'Company', 'Ticker', 'Country', 'Sector', 'Currency', 'Shares',
    'Avg Price (GBP)', 'Invested (GBP)', 'Value (GBP)', 'Weight %',
    'P&L (GBP)', 'FX Impact (GBP)', 'Returns %', 'Dividends (GBP)', 'Div Yield %',
  ];
  const csvRows = visible.map(r => [
    `"${String(r.company_name).replace(/"/g, '""')}"`,
    r.ticker, r.country, r.sector || '', r.currency_code || '',
    r.quantity, r.avg_price,
    r.invested ?? '', r.current_value,
    r.weight != null ? r.weight.toFixed(2) : '',
    r.total_returns, r.fx_impact != null ? r.fx_impact : '',
    r.returns_pct, r.dividends,
    r.div_yield != null ? r.div_yield.toFixed(2) : '',
  ].join(','));
  const csv = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portfolio_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── State management ────────────────────────────────────────────────────── */
function showState(state, msg) {
  document.getElementById('stateLoading').style.display = 'none';
  document.getElementById('stateError').style.display = 'none';
  document.getElementById('stateEmpty').style.display = 'none';

  if (state === 'error') {
    document.getElementById('stateError').style.display = '';
    document.getElementById('errorText').textContent = msg || '';
    document.getElementById('dashboard').style.display = 'none';
  } else if (state === 'empty') {
    document.getElementById('stateEmpty').style.display = '';
    document.getElementById('dashboard').style.display = 'none';
  } else {
    // 'table' or any other state → show dashboard
    document.getElementById('dashboard').style.display = '';
  }
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function set(id, val) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = val;
  } else {
    console.warn(`[UI] Element with id "${id}" not found.`);
  }
}

function fmtAge(seconds) {
  if (seconds == null) return '?';
  if (seconds < 60) return 'live';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function showTooltip(e, text) {
  const tip = document.getElementById('tooltip');
  if (!tip) return;
  tip.innerHTML = text;
  tip.classList.add('active');

  const moveTip = (ev) => {
    tip.style.left = (ev.clientX + 15) + 'px';
    tip.style.top = (ev.clientY - 15) + 'px';
  };

  moveTip(e);
  // Add listener for move
  e.target.addEventListener('mousemove', moveTip);
}

function hideTooltip() {
  const tip = document.getElementById('tooltip');
  if (tip) tip.classList.remove('active');
}

/* ─── Currency re-render ─────────────────────────────────────────────────── */
function onCurrencyChange() {
  if (allRows.length === 0) return;
  renderSummary(allRows, _lastTotalDividends, _lastPAI);
  renderTable(allRows);
  if (_activityData) _renderActivity(_activityData);
  if (_dividendData) _renderDividends(_dividendData);
  if (_monthlyData) _renderMonthly(_monthlyData);
  // Re-render live price in stock panel if it's open
  if (_spLivePriceData) _spRenderLivePrice();
}

/* ─── Init ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  _updateThemeIcon(theme);

  fetchFxRate();

  const th = document.querySelector('[data-col="current_value"]');
  if (th) th.classList.add('sort-desc');

  showState('table');   // show dashboard skeleton immediately — router calls loadPortfolio()

  // Auto-refresh every 5 minutes — only when a portfolio/stocks view is active
  setInterval(() => {
    if (!PORTFOLIO_ID) return;
    const portfolioVisible = document.getElementById('view-portfolio')?.style.display !== 'none';
    const stocksVisible = document.getElementById('view-stocks')?.style.display !== 'none';
    // Use the correct loader for each view so renderTable() is always called
    if (stocksVisible && typeof loadStocksView === 'function') loadStocksView(false);
    else if (portfolioVisible) loadPortfolio();
  }, 30 * 1000);
});

/* ─── Analyst Ratings panel renderer ─────────────────────────────────────── */
function _renderPanelAnalystRatings(ticker, curPrice, currency) {
  const sec = document.getElementById('spAnalystRatingsSection');
  const container = document.getElementById('spAnalystRatings');
  const periodEl = document.getElementById('spAnalystPeriod');
  if (!sec || !container) return;

  const rec = _recommendations[ticker];
  // Show section if we have a consensus (total may be 0 when only rec_text is available)
  if (!rec || (!rec.total && !rec.consensus)) { sec.style.display = 'none'; return; }

  sec.style.display = '';
  periodEl.textContent = '';

  // Map consensus to 0-100 gauge score (Strong Buy=100, Strong Sell=0)
  const gaugeMap = { 'Strong Buy': 100, 'Buy': 75, 'Hold': 50, 'Sell': 25, 'Strong Sell': 0 };
  let gaugeScore = gaugeMap[rec.consensus] ?? 50;

  // If we have the full breakdown, compute exact weighted score
  if (rec.hasBreakdown && rec.total > 0) {
    const score = (rec.strongBuy * 1 + rec.buy * 2 + rec.hold * 3 + rec.sell * 4 + rec.strongSell * 5) / rec.total;
    gaugeScore = ((5 - score) / 4) * 100;
  }

  const consensusCls = _ratingCls(rec.consensus);
  const totalLabel = rec.total > 0
    ? `Based on ${rec.total} analysts giving stock ratings in the ${rec.period || 'past 3 months'}.`
    : '';

  // Breakdown rows — only shown when individual counts are available
  let breakdownHtml = '';
  if (rec.hasBreakdown && rec.total > 0) {
    const cats = [
      { key: 'strongBuy', label: 'Strong buy', cls: 'ar-strong-buy' },
      { key: 'buy', label: 'Buy', cls: 'ar-buy' },
      { key: 'hold', label: 'Hold', cls: 'ar-hold' },
      { key: 'sell', label: 'Sell', cls: 'ar-sell' },
      { key: 'strongSell', label: 'Strong sell', cls: 'ar-strong-sell' },
    ];
    const maxCount = Math.max(...cats.map(c => rec[c.key] || 0), 1);
    breakdownHtml = `<div class="ar-breakdown">` + cats.map(c => {
      const count = rec[c.key] || 0;
      const pct = Math.round(count / maxCount * 100);
      return `
        <div class="ar-row">
          <span class="ar-label">${c.label}</span>
          <div class="ar-track"><div class="ar-fill ${c.cls}" style="width:${pct}%"></div></div>
          <span class="ar-count">${count}</span>
        </div>`;
    }).join('') + `</div>`;
  }

  // Price target chart — shown when targets and current price are available
  const hasTargets = rec.avgTarget != null || rec.highTarget != null || rec.lowTarget != null;
  console.debug('[PriceTarget]', ticker, 'curPrice:', curPrice, 'avg:', rec.avgTarget, 'high:', rec.highTarget, 'low:', rec.lowTarget);
  const priceTargetHtml = (hasTargets && curPrice)
    ? `<div class="pt-chart-wrap"><canvas id="pt-canvas" class="pt-canvas"></canvas></div>`
    : '';

  container.innerHTML = `
    ${priceTargetHtml}
    ${totalLabel ? `<p class="ar-subtitle">${totalLabel}</p>` : ''}
    <div class="ar-gauge-outer">
      <canvas id="ar-gauge" class="ar-gauge-canvas"></canvas>
    </div>
    <div class="ar-consensus-label ${consensusCls}">${esc(rec.consensus)}</div>
    ${breakdownHtml}`;

  requestAnimationFrame(() => {
    if (hasTargets && curPrice) {
      drawPriceTargetChart('pt-canvas', curPrice, rec.avgTarget, rec.highTarget, rec.lowTarget, currency);
    }
    drawAnalystGauge('ar-gauge', gaugeScore, rec.consensus);
  });
}

/* ─── Price Target Fan Chart ──────────────────────────────────────────────── */
function drawPriceTargetChart(canvasId, curPrice, avg, high, low, currency) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const W = canvas.offsetWidth || 280;
  const H = 140;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const mutedColor = isDark ? '#64748b' : '#9ca3af';
  const textColor = isDark ? '#cbd5e1' : '#374151';
  const dividerColor = isDark ? '#334155' : '#e2e8f0';

  // Layout constants
  const padT = 12, padB = 18;
  const anchorX = 28;          // left anchor dot x
  const fanEndX = W * 0.52;    // where dashed lines end (left edge of label area)
  const labelX = fanEndX + 8; // where label pills start

  // Y scale: span all values with 15% padding above and below
  const vals = [curPrice, high, avg, low].filter(v => v != null);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = (maxV - minV) || curPrice * 0.25;
  const yLo = minV - span * 0.25;
  const yHi = maxV + span * 0.25;
  const yScale = v => padT + (1 - (v - yLo) / (yHi - yLo)) * (H - padT - padB);

  const anchorY = yScale(curPrice);
  const maxY = high != null ? yScale(high) : anchorY - 35;
  const avgY = avg != null ? yScale(avg) : anchorY - 15;
  const minY = low != null ? yScale(low) : anchorY + 10;

  // Currency symbol helper
  const symMap = { USD: '$', GBP: '£', GBp: 'p', GBX: 'p', EUR: '€', CAD: 'CA$', AUD: 'A$', JPY: '¥', CHF: 'Fr' };
  const sym = symMap[currency] || '';

  const fmtPrice = v => {
    if (v == null) return '';
    if (v >= 1000) return sym + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return sym + v.toFixed(2);
  };

  // ── Shaded fan region (max → min cone) ──────────────────────────────────
  if (high != null && low != null) {
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(fanEndX, maxY);
    ctx.lineTo(fanEndX, minY);
    ctx.closePath();
    ctx.fillStyle = isDark ? 'rgba(13,148,136,0.13)' : 'rgba(13,148,136,0.09)';
    ctx.fill();
  }

  // ── Dashed lines: anchor → each target level ─────────────────────────────
  const lineConf = [
    { y: maxY, val: high, color: '#0d9488' },
    { y: avgY, val: avg, color: '#3b82f6' },
    { y: minY, val: low, color: '#94a3b8' },
  ];
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1.5;
  for (const { y, val, color } of lineConf) {
    if (val == null) continue;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(fanEndX, y);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Short baseline for "Current" ─────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(4, anchorY);
  ctx.lineTo(anchorX + 8, anchorY);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Anchor dot
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4, 0, 2 * Math.PI);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();

  // ── Right-side labels ─────────────────────────────────────────────────────
  const labelConf = [
    { y: maxY, val: high, label: 'Max', color: '#0d9488' },
    { y: avgY, val: avg, label: 'Avg', color: '#3b82f6' },
    { y: minY, val: low, label: 'Min', color: '#94a3b8' },
  ];

  for (const { y, val, label, color } of labelConf) {
    if (val == null) continue;
    const pct = ((val - curPrice) / curPrice * 100);
    const sign = pct >= 0 ? '+' : '';
    const pill = `${label} ${sign}${pct.toFixed(1)}%`;

    ctx.font = `600 9px system-ui,sans-serif`;
    const pillW = ctx.measureText(pill).width + 10;
    const pillH = 15;
    const pillY = y - pillH / 2;

    // Pill background
    ctx.beginPath();
    _roundRect(ctx, labelX, pillY, pillW, pillH, 3);
    ctx.fillStyle = color;
    ctx.fill();

    // Pill text
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pill, labelX + 5, y);

    // Price value to the right of pill
    const priceStr = fmtPrice(val);
    ctx.font = `600 10px system-ui,sans-serif`;
    ctx.fillStyle = textColor;
    ctx.fillText(priceStr, labelX + pillW + 5, y);
  }

  // Current label (bottom-aligned near anchor)
  const curStr = fmtPrice(curPrice);
  ctx.font = `600 9px system-ui,sans-serif`;
  const curPillW = ctx.measureText('Current').width + 10;
  _roundRect(ctx, labelX, anchorY - 7.5, curPillW, 15, 3);
  ctx.fillStyle = '#3b82f6';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Current', labelX + 5, anchorY);

  ctx.font = `600 10px system-ui,sans-serif`;
  ctx.fillStyle = textColor;
  ctx.fillText(curStr, labelX + curPillW + 5, anchorY);

  // ── X-axis divider line at bottom ─────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(4, H - padB + 2);
  ctx.lineTo(W - 4, H - padB + 2);
  ctx.strokeStyle = dividerColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Footer labels ─────────────────────────────────────────────────────────
  ctx.font = `500 9px system-ui,sans-serif`;
  ctx.fillStyle = mutedColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Current', 4, H - 4);
  ctx.textAlign = 'center';
  ctx.fillText('1Y Forecast', fanEndX * 0.75, H - 4);
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAnalystGauge(canvasId, score, consensus) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const W = canvas.offsetWidth || 200;
  const H = Math.round(W * 0.62);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Arc centre: near the bottom, with room below for bottom labels
  const cx = W / 2;
  const cy = H - 22;
  // Leave room on sides for "Strong sell" / "Strong buy" labels
  const outerR = Math.min(W / 2 - 44, H - 30);
  const innerR = outerR * 0.62;

  // Sectors: [start%, end%, color]
  const sectors = [
    [0, 20, '#f97316'],   // strong sell – orange
    [20, 40, '#ca8a04'],   // sell        – amber
    [40, 60, '#cbd5e1'],   // neutral     – slate
    [60, 80, '#86efac'],   // buy         – light green
    [80, 100, '#0d9488'],   // strong buy  – teal
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

  // Labels
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const mutedColor = isDark ? '#94a3b8' : '#6b7280';
  const activeColor = '#0d9488';
  const fontSize = Math.max(8, Math.round(outerR * 0.13));
  ctx.font = `500 ${fontSize}px sans-serif`;

  const cons = (consensus || '').toLowerCase();
  const labelDefs = [
    { pos: 0, lines: ['Strong', 'sell'], align: 'right', active: cons === 'strong sell' },
    { pos: 25, lines: ['Sell'], align: 'right', active: cons === 'sell' },
    { pos: 50, lines: ['Neutral'], align: 'center', active: cons === 'hold' },
    { pos: 75, lines: ['Buy'], align: 'left', active: cons === 'buy' },
    { pos: 100, lines: ['Strong', 'buy'], align: 'left', active: cons === 'strong buy' },
  ];
  const labelR = outerR + 14;
  const lineH = fontSize + 2;
  for (const ldef of labelDefs) {
    const angle = Math.PI + (ldef.pos / 100) * Math.PI;
    let lx = cx + Math.cos(angle) * labelR;
    const ly = cy + Math.sin(angle) * labelR;
    // Clamp label anchor so text doesn't overflow canvas edges
    const longestLine = ldef.lines.reduce((a, b) => a.length > b.length ? a : b, '');
    const tw = ctx.measureText(longestLine).width;
    if (ldef.align === 'right') lx = Math.max(lx, tw + 2);
    if (ldef.align === 'left') lx = Math.min(lx, W - tw - 2);
    ctx.fillStyle = ldef.active ? activeColor : mutedColor;
    ctx.textAlign = ldef.align;
    ctx.textBaseline = 'middle';
    if (ldef.lines.length === 2) {
      ctx.fillText(ldef.lines[0], lx, ly - lineH / 2);
      ctx.fillText(ldef.lines[1], lx, ly + lineH / 2);
    } else {
      ctx.fillText(ldef.lines[0], lx, ly);
    }
  }

  // Needle
  if (score != null) {
    const needleAngle = Math.PI + (score / 100) * Math.PI;
    const needleLen = outerR * 0.84;
    const tipX = cx + Math.cos(needleAngle) * needleLen;
    const tipY = cy + Math.sin(needleAngle) * needleLen;
    const needleColor = isDark ? '#e2e8f0' : '#1e293b';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = needleColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
    ctx.fillStyle = needleColor;
    ctx.fill();
  }
}

function _ratingCls(consensus) {
  return {
    'Strong Buy': 'rating-strong-buy', 'Buy': 'rating-buy', 'Hold': 'rating-hold',
    'Sell': 'rating-sell', 'Strong Sell': 'rating-strong-sell'
  }[consensus] || '';
}

/* ─── Side panel swipe-to-dismiss (mobile bottom sheet) ─────────────────── */
// Attaches once; detects a downward swipe ≥120px and closes the panel.
let _panelSwipeInitialized = false;
function _initPanelSwipeDismiss() {
  if (_panelSwipeInitialized) return;
  _panelSwipeInitialized = true;

  const panel = document.getElementById('sidePanel');
  if (!panel) return;

  let startY = 0, isDragging = false;

  panel.addEventListener('touchstart', e => {
    if (window.innerWidth > 768) return;
    // Only start drag when touching the handle area (top 56px of panel)
    if (e.touches[0].clientY - panel.getBoundingClientRect().top > 56) return;
    startY = e.touches[0].clientY;
    isDragging = true;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  panel.addEventListener('touchend', e => {
    if (!isDragging) return;
    isDragging = false;
    panel.style.transition = '';
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 120) {
      window.closeStockPanel();
    } else {
      panel.style.transform = '';
    }
  });
}

/* ─── Stock Drill-Down Side Panel ────────────────────────────────────────── */
window.openStockPanel = function (r) {
  // Populate headers
  document.getElementById('spCompanyName').textContent = r.company_name || r.ticker;
  document.getElementById('spTicker').textContent = r.ticker;
  document.getElementById('spCompanyInitial').textContent = (r.company_name || r.ticker).charAt(0).toUpperCase();

  // Populate metrics
  document.getElementById('spValue').textContent = fmt.currency(r.current_value);

  const returnEl = document.getElementById('spReturn');
  const sign = r.total_returns >= 0 ? '+' : '';
  const colorStr = r.total_returns >= 0 ? 'var(--green)' : 'var(--red)';

  returnEl.innerHTML = `<span style="color:${colorStr}">${sign}${fmt.currency(r.total_returns)} <span class="sp-metric-pct">(${sign}${r.returns_pct.toFixed(2)}%)</span></span>`;

  document.getElementById('spQuantity').textContent = fmt.number(r.quantity, 4);
  document.getElementById('spAvgPrice').textContent = fmt.currency(r.avg_price, 4);
  // Show cached price initially, then refresh with live data
  document.getElementById('spCurrentPrice').textContent = fmt.currency((r.current_value / (r.quantity || 1)), 4);
  _spFetchLivePrice(r.ticker, r.country || 'US');
  // document.getElementById('spSector').textContent = r.sector || 'Unknown';

  // Breakeven: dividend-adjusted cost per share
  const qty = r.quantity || 1;
  const divs = r.dividends || 0;
  const breakeven = (r.invested - divs) / qty;
  const currentPx = r.current_value / qty;
  const beEl = document.getElementById('spBreakeven');
  if (beEl) {
    if (currentPx >= breakeven) {
      beEl.innerHTML = `<span class="be-profit">${fmt.currency(breakeven, 4)}</span>`;
    } else {
      const neededPct = breakeven > 0 ? ((breakeven - currentPx) / currentPx * 100).toFixed(1) : 0;
      beEl.innerHTML = `<span class="be-loss">${fmt.currency(breakeven, 4)}</span><span class="be-needed-tag">+${neededPct}% needed</span>`;
    }
  }

  // Held Since: placeholder until activity loads
  const hsEl = document.getElementById('spHeldSince');
  if (hsEl) hsEl.textContent = '—';

  // Show panel
  _initPanelSwipeDismiss();
  document.getElementById('sidePanelBackdrop').classList.add('active');
  document.getElementById('sidePanel').classList.add('open');

  // Load price chart
  _spChartTicker = r.ticker;
  _spChartCountry = r.country || 'US';
  _spChartPeriod = '1w';
  _spChartType = 'candle';
  _spChartData = null;
  document.querySelectorAll('.sp-range-tab').forEach(b => b.classList.toggle('active', b.dataset.period === '1w'));
  document.getElementById('spChartTypeCandle').classList.add('active');
  document.getElementById('spChartTypeLine').classList.remove('active');
  _spLoadChart();

  // Load activity, news, and fundamentals
  window.loadStockActivity(r.ticker);
  window.loadStockNews(r.ticker);
  if (r.country === 'US' || r.country === 'CA') {
    const nativePx = r.native_price != null ? r.native_price : (r.current_value / (r.quantity || 1));
    window.loadStockMetrics(r.ticker, nativePx);
  } else {
    const sec = document.getElementById('spFundamentalsSection');
    if (sec) sec.style.display = 'none';
  }
  // Show analyst ratings for all individual stocks (skip index funds/ETFs)
  if (!(r.sector || '').toLowerCase().includes('index')) {
    // native_price = raw price in original currency (USD/GBX/EUR), matches TradingView target prices
    _renderPanelAnalystRatings(r.ticker, r.native_price, r.native_currency);
  } else {
    const sec = document.getElementById('spAnalystRatingsSection');
    if (sec) sec.style.display = 'none';
  }
}

window.closeStockPanel = function () {
  document.getElementById('sidePanelBackdrop').classList.remove('active');
  document.getElementById('sidePanel').classList.remove('open');
  _spLivePriceData = null;
}

let _spLivePriceData = null; // cached so currency switch can re-render without refetch

async function _spFetchLivePrice(ticker, country) {
  _spLivePriceData = null;
  try {
    const res = await fetch(`/api/watchlist/price?ticker=${encodeURIComponent(ticker)}&country=${encodeURIComponent(country)}`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data) return;
    _spLivePriceData = json.data;
    _spRenderLivePrice();
  } catch (_) { }
}

function _spRenderLivePrice() {
  const d = _spLivePriceData;
  const el = document.getElementById('spCurrentPrice');
  if (!d || !el || d.price == null) return;

  // Convert native price to GBP so fmt.currency() can handle display-currency switching.
  // fxRate = GBP/USD (≈1.27), so USD→GBP = price / fxRate.
  // GBX/GBp are pence: divide by 100 for GBP.
  // Other currencies (EUR, CAD…) shown native with their symbol — no cross-rate available.
  let priceGBP = null;
  const cur = (d.currency || '').toUpperCase();
  if (cur === 'USD') priceGBP = d.price / fxRate;
  else if (cur === 'GBP') priceGBP = d.price;
  else if (cur === 'GBX' || cur === 'GBP' || d.currency === 'GBp') priceGBP = d.price / 100;

  const pxStr = priceGBP != null
    ? fmt.currency(priceGBP, 4)
    : (() => {
      const _SYM = { EUR: '€', CAD: 'CA$', AUD: 'A$', JPY: '¥', CHF: 'Fr' };
      const sym = _SYM[cur] || (d.currency ? d.currency + '\u00a0' : '');
      return sym + fmt.number(d.price, 4);
    })();

  const pct = d.change_pct;
  if (pct != null) {
    const sign = pct >= 0 ? '+' : '';
    const col = pct >= 0 ? 'var(--green)' : 'var(--red)';
    const session = d.market_state && d.market_state !== 'REGULAR'
      ? ` <span style="font-size:0.7em;color:var(--text-muted)">${d.market_state}</span>` : '';
    el.innerHTML = `${pxStr} <span style="font-size:0.78em;color:${col}">${sign}${pct.toFixed(2)}%</span>${session}`;
  } else {
    el.textContent = pxStr;
  }
}

// ── Stock Price Chart ──────────────────────────────────────────────────────────
let _spChartTicker = null;
let _spChartCountry = 'US';
let _spChartPeriod = '1w';
let _spChartType = 'candle';
let _spChartData = null;

function _spSetPeriod(period) {
  _spChartPeriod = period;
  document.querySelectorAll('.sp-range-tab').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  _spLoadChart();
}

function _spSetChartType(type) {
  _spChartType = type;
  document.getElementById('spChartTypeCandle').classList.toggle('active', type === 'candle');
  document.getElementById('spChartTypeLine').classList.toggle('active', type === 'line');
  if (_spChartData) _spDrawChart(_spChartData);
}

async function _spLoadChart() {
  if (!_spChartTicker) return;
  const wrap = document.getElementById('spChartWrap');
  const loading = document.getElementById('spChartLoading');
  wrap.style.display = 'none';
  loading.style.display = 'block';
  loading.textContent = 'Loading chart…';
  try {
    const res = await fetch(`/api/stock-chart/${encodeURIComponent(_spChartTicker)}?period=${_spChartPeriod}&country=${_spChartCountry}`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data.candles.length) {
      loading.textContent = 'No chart data available.';
      return;
    }
    _spChartData = json.data;
    loading.style.display = 'none';
    wrap.style.display = 'block';
    requestAnimationFrame(() => _spDrawChart(_spChartData));
  } catch (e) {
    loading.textContent = 'Failed to load chart.';
  }
}

function _spDrawChart(data) {
  if (_spChartType === 'candle') _spDrawCandle(data.candles, data.ext_price, data.market_state);
  else _spDrawLine(data.candles, data.ext_price, data.market_state);
}

function _spDrawCandle(candles, extPrice, marketState) {
  const canvas = document.getElementById('spPriceCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 380;
  const H = canvas.offsetHeight || 200;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 12, right: 8, bottom: 28, left: 48 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  // Expand Y range to include ext_price so the AH line is always visible
  const allVals = extPrice != null ? [...highs, ...lows, extPrice] : [...highs, ...lows];
  const minP = Math.min(...allVals);
  const maxP = Math.max(...allVals);
  const range = (maxP - minP) || 1;

  const yOf = v => pad.top + ch - ((v - minP) / range) * ch;
  const n = candles.length;
  const candleW = Math.max(1, Math.floor((cw / n) * 0.7));

  // Y-axis grid
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textCol = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  ctx.font = '10px system-ui,sans-serif';
  ctx.fillStyle = textCol;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minP + (range * i / steps);
    const y = yOf(v);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(v >= 100 ? 0 : 2), pad.left - 4, y + 3);
  }

  // X-axis labels
  const labelIdxs = _spPickXLabels(candles, _spChartPeriod);
  ctx.textAlign = 'center';
  labelIdxs.forEach(i => {
    const x = pad.left + (i / (n - 1)) * cw;
    ctx.fillStyle = textCol;
    ctx.fillText(_spFmtXLabel(candles[i].ts, _spChartPeriod), x, H - 4);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
  });

  // Candles
  candles.forEach((c, i) => {
    const x = pad.left + (i / Math.max(n - 1, 1)) * cw;
    const bullish = c.c >= c.o;
    const col = bullish ? '#10b981' : '#ef4444';
    ctx.strokeStyle = col;
    ctx.fillStyle = col;

    // Wick
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.h));
    ctx.lineTo(x, yOf(c.l));
    ctx.stroke();

    // Body
    const yO = yOf(c.o), yC = yOf(c.c);
    const bodyY = Math.min(yO, yC);
    const bodyH = Math.max(Math.abs(yC - yO), 1);
    ctx.fillRect(x - candleW / 2, bodyY, candleW, bodyH);
  });

  // Extended-hours price line (AH / Pre-market)
  if (extPrice != null && (marketState === 'PRE' || marketState === 'POST' || marketState === 'POSTPOST' || marketState === 'PREPRE' || marketState === 'CLOSED')) {
    const y = yOf(extPrice);
    const label = marketState === 'PRE' ? 'PRE' : 'AH';
    ctx.save();
    ctx.strokeStyle = 'rgba(250,204,21,0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(250,204,21,0.9)';
    ctx.font = 'bold 9px system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label} ${extPrice.toFixed(extPrice >= 100 ? 2 : 4)}`, pad.left + 2, y - 3);
  }

  // Hover tooltip
  _spAttachHover(canvas, candles, pad, cw, ch, yOf, 'candle');
}

function _spDrawLine(candles, extPrice, marketState) {
  const canvas = document.getElementById('spPriceCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 380;
  const H = canvas.offsetHeight || 200;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 12, right: 8, bottom: 28, left: 48 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const vals = candles.map(c => c.c);
  // Expand Y range to include ext_price so the AH line is always visible
  const allVals = extPrice != null ? [...vals, extPrice] : vals;
  const minP = Math.min(...allVals);
  const maxP = Math.max(...allVals);
  const range = (maxP - minP) || 1;
  const yOf = v => pad.top + ch - ((v - minP) / range) * ch;
  const n = candles.length;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textCol = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  ctx.font = '10px system-ui,sans-serif';

  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minP + (range * i / steps);
    const y = yOf(v);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = textCol;
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(v >= 100 ? 0 : 2), pad.left - 4, y + 3);
  }

  const labelIdxs = _spPickXLabels(candles, _spChartPeriod);
  ctx.textAlign = 'center';
  labelIdxs.forEach(i => {
    const x = pad.left + (i / (n - 1)) * cw;
    ctx.fillStyle = textCol;
    ctx.fillText(_spFmtXLabel(candles[i].ts, _spChartPeriod), x, H - 4);
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
  });

  // Gradient fill
  const isUp = candles[n - 1].c >= candles[0].c;
  const lineCol = isUp ? '#10b981' : '#ef4444';
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, isUp ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.beginPath();
  candles.forEach((c, i) => {
    const x = pad.left + (i / (n - 1)) * cw;
    i === 0 ? ctx.moveTo(x, yOf(c.c)) : ctx.lineTo(x, yOf(c.c));
  });
  const lastX = pad.left + cw;
  ctx.lineTo(lastX, H - pad.bottom);
  ctx.lineTo(pad.left, H - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  candles.forEach((c, i) => {
    const x = pad.left + (i / (n - 1)) * cw;
    i === 0 ? ctx.moveTo(x, yOf(c.c)) : ctx.lineTo(x, yOf(c.c));
  });
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Extended-hours price line (AH / Pre-market)
  if (extPrice != null && (marketState === 'PRE' || marketState === 'POST' || marketState === 'POSTPOST' || marketState === 'PREPRE' || marketState === 'CLOSED')) {
    const y = yOf(extPrice);
    const label = marketState === 'PRE' ? 'PRE' : 'AH';
    ctx.save();
    ctx.strokeStyle = 'rgba(250,204,21,0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(250,204,21,0.9)';
    ctx.font = 'bold 9px system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label} ${extPrice.toFixed(extPrice >= 100 ? 2 : 4)}`, pad.left + 2, y - 3);
  }

  _spAttachHover(canvas, candles, pad, cw, ch, yOf, 'line');
}

function _spPickXLabels(candles, period) {
  const n = candles.length;
  if (n < 2) return [];
  const maxLabels = period === '1d' ? 6 : period === '1w' ? 5 : period === '1m' ? 4 : 5;
  const step = Math.ceil(n / maxLabels);
  const idxs = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  return idxs;
}

function _spFmtXLabel(ts, period) {
  const d = new Date(ts * 1000);
  if (period === '1d') return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (period === '1w') return d.toLocaleDateString('en-GB', { weekday: 'short' });
  if (period === '1m') return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function _spAttachHover(canvas, candles, pad, cw, _ch, yOf, mode) {
  const tooltip = document.getElementById('spChartTooltip');
  const n = candles.length;

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.round((mx - pad.left) / cw * (n - 1));
    if (idx < 0 || idx >= n) { tooltip.style.display = 'none'; return; }
    const c = candles[idx];
    const d = new Date(c.ts * 1000);
    const dateStr = d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

    let html;
    if (mode === 'candle') {
      const col = c.c >= c.o ? '#10b981' : '#ef4444';
      html = `<div class="sp-tt-date">${dateStr}</div>
        <div class="sp-tt-row"><span>O</span><span>${c.o.toFixed(2)}</span></div>
        <div class="sp-tt-row"><span>H</span><span>${c.h.toFixed(2)}</span></div>
        <div class="sp-tt-row"><span>L</span><span>${c.l.toFixed(2)}</span></div>
        <div class="sp-tt-row" style="color:${col}"><span>C</span><span>${c.c.toFixed(2)}</span></div>`;
    } else {
      html = `<div class="sp-tt-date">${dateStr}</div>
        <div class="sp-tt-row"><span>Price</span><span>${c.c.toFixed(2)}</span></div>`;
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    const left = Math.min(mx + 12, canvas.offsetWidth - 130);
    const top = Math.max(pad.top, yOf(c.c) - 60);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  };
  canvas.onmouseleave = () => { tooltip.style.display = 'none'; };
}

window.loadStockActivity = async function (ticker) {
  const container = document.getElementById('spActivityList');
  container.innerHTML = `
    <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-60"></div><div class="skeleton skel-line skel-w-40"></div></div><div class="skeleton skel-amount"></div></div>
    <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-50"></div><div class="skeleton skel-line skel-w-35"></div></div><div class="skeleton skel-amount"></div></div>
    <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-55"></div><div class="skeleton skel-line skel-w-30"></div></div><div class="skeleton skel-amount"></div></div>
  `;

  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/stock-activity/${ticker}`);
    const json = await res.json();

    if (json.status !== 'ok' || !json.data || json.data.length === 0) {
      container.innerHTML = '<div class="activity-empty">No activity found for this stock.</div>';
      return;
    }

    _stockCalData = json.data;

    // Compute "Held Since" from earliest BUY date
    const buyDates = _stockCalData
      .filter(a => (a.type || '').toUpperCase().includes('BUY') || (a.type || '').toUpperCase().includes('MARKET_BUY') || a.quantity > 0)
      .map(a => (a.date || '').substring(0, 10))
      .filter(Boolean).sort();
    const hsEl = document.getElementById('spHeldSince');
    if (hsEl && buyDates.length > 0) {
      const firstBuy = new Date(buyDates[0]);
      const diffMs = Date.now() - firstBuy.getTime();
      const diffDays = Math.floor(diffMs / 86400000);
      const label = firstBuy.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      hsEl.textContent = `${label} · ${diffDays}d`;
    }

    // Default to the most recent month with data
    const dates = _stockCalData
      .map(a => (a.date || '').substring(0, 10))
      .filter(Boolean).sort();
    if (dates.length > 0) {
      const latest = new Date(dates[dates.length - 1]);
      _calYear = latest.getFullYear();
      _calMonth = latest.getMonth();
    } else {
      _calYear = new Date().getFullYear();
      _calMonth = new Date().getMonth();
    }

    _renderActivityCalendar(_stockCalData, _calYear, _calMonth);

  } catch (err) {
    document.getElementById('spActivityList').innerHTML =
      '<div class="activity-empty">Error loading activity.</div>';
  }
}

function _renderActivityCalendar(data, year, month) {
  const container = document.getElementById('spActivityList');

  // Build date → events map
  const eventMap = {};
  data.forEach(act => {
    const d = (act.date || '').substring(0, 10);
    if (!d) return;
    if (!eventMap[d]) eventMap[d] = [];
    eventMap[d].push(act);
  });

  // Month metadata
  const firstDay = new Date(year, month, 1);
  const totalDays = new Date(year, month + 1, 0).getDate();
  const monthLabel = firstDay.toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  // Mon=0 … Sun=6 offset
  let startDow = firstDay.getDay();
  startDow = (startDow + 6) % 7;

  // Build flat cell list (null = empty padding)
  const cells = Array(startDow).fill(null);
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr, events: eventMap[dateStr] || [] });
  }
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  // Render weeks
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const dayCells = week.map(cell => {
      if (!cell) return '<div class="cal-day cal-day-empty"></div>';

      const badges = cell.events.slice(0, 2).map(ev => {
        const isDiv = ev.type === 'dividend';
        const isSell = !isDiv && (ev.action || '').toLowerCase().includes('sell');
        const cls = isDiv ? 'cal-ev-div' : isSell ? 'cal-ev-sell' : 'cal-ev-buy';
        const label = isDiv
          ? `Dividend · ${fmt.currency(ev.amount)}`
          : `${ev.action.replace(/_/g, ' ')} · ${fmt.number(ev.quantity, 2)} @ ${fmt.currency(ev.price, 2)}`;
        const short = isDiv ? 'Dividend' : (isSell ? 'Sell' : 'Buy');
        return `<div class="cal-ev ${cls}" data-label="${esc(label)}" onclick="showCalTooltip(event,this.dataset.label)">${short}</div>`;
      }).join('');

      const more = cell.events.length > 2
        ? `<div class="cal-ev-more">+${cell.events.length - 2} more</div>` : '';

      const today = new Date();
      const isToday = cell.day === today.getDate()
        && month === today.getMonth() && year === today.getFullYear();

      return `<div class="cal-day${isToday ? ' cal-today' : ''}">
        <span class="cal-day-num">${cell.day}</span>
        ${badges}${more}
      </div>`;
    }).join('');
    weeks.push(`<div class="cal-week">${dayCells}</div>`);
  }

  container.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-header">
        <button class="cal-nav" onclick="calPrevMonth()">&#8249;</button>
        <span class="cal-title">${monthLabel}</span>
        <button class="cal-nav" onclick="calNextMonth()">&#8250;</button>
      </div>
      <div class="cal-dow-row">
        <span>Mon</span><span>Tue</span><span>Wed</span>
        <span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
      </div>
      <div class="cal-grid">${weeks.join('')}</div>
      <div class="cal-legend">
        <span class="cal-leg cal-ev-buy">Buy</span>
        <span class="cal-leg cal-ev-sell">Sell</span>
        <span class="cal-leg cal-ev-div">Dividend</span>
      </div>
    </div>`;
}

/* ─── Calendar tooltip (position:fixed, outside overflow context) ────────── */
window.showCalTooltip = function (event, text) {
  event.stopPropagation();

  let tip = document.getElementById('calTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'calTooltip';
    tip.className = 'cal-tooltip';
    document.body.appendChild(tip);
    // One-time dismiss listener
    document.addEventListener('click', () => {
      const t = document.getElementById('calTooltip');
      if (t) t.style.display = 'none';
    });
  }

  tip.textContent = text;
  tip.style.display = 'block';
  // Temporarily off-screen to measure
  tip.style.left = '0';
  tip.style.top = '-9999px';

  // Capture before rAF — event.currentTarget is null after handler returns
  const target = event.currentTarget;
  requestAnimationFrame(() => {
    const rect = target.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let x = rect.left + rect.width / 2 - tw / 2;
    let y = rect.top - th - 8;

    if (x < 8) x = 8;
    if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
    if (y < 8) y = rect.bottom + 8; // flip below if no room above

    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
}

window.calPrevMonth = function () {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  if (_stockCalData) _renderActivityCalendar(_stockCalData, _calYear, _calMonth);
}

window.calNextMonth = function () {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  if (_stockCalData) _renderActivityCalendar(_stockCalData, _calYear, _calMonth);
}

/* ─── Stock Fundamentals ─────────────────────────────────────────────────── */
window.loadStockMetrics = async function (ticker, currentPrice) {
  const sec = document.getElementById('spFundamentalsSection');
  const container = document.getElementById('spFundamentals');
  if (!sec || !container) return;

  sec.style.display = '';
  container.innerHTML = `
    <div style="padding:12px 0;display:flex;flex-direction:column;gap:8px">
      <div class="skeleton skel-line skel-w-60" style="height:14px"></div>
      <div class="skeleton skel-line skel-w-80" style="height:14px"></div>
      <div class="skeleton skel-line skel-w-50" style="height:14px"></div>
      <div class="skeleton skel-line skel-w-70" style="height:14px"></div>
    </div>
  `;

  try {
    const res = await fetch(`/api/stock-metrics/${encodeURIComponent(ticker)}`);
    const json = await res.json();

    if (json.status !== 'ok' || !json.data || Object.keys(json.data).length === 0) {
      container.innerHTML = `<div class="activity-empty">${json.message || 'No fundamental data available.'}</div>`;
      return;
    }
    _renderStockMetrics(json.data, currentPrice);
  } catch (err) {
    console.error('Fundamentals error:', err);
    container.innerHTML = '<div class="activity-empty">Error loading fundamentals.</div>';
  }
}

function _renderStockMetrics(m, currentPrice) {
  const container = document.getElementById('spFundamentals');

  // Helper: format a number with fixed decimals and optional suffix
  const n = (v, dec = 2, suffix = '') =>
    v != null && isFinite(v) ? Number(v).toFixed(dec) + suffix : null;
  const pct = v => n(v, 2, '%');
  const x = v => n(v, 2, 'x');
  const $ = v => v != null && isFinite(v) ? '$' + Number(v).toFixed(2) : null;

  // Color class for directional values
  const pos = v => v != null ? (v >= 0 ? 'fund-pos' : 'fund-neg') : '';

  // Build 52W range bar
  const hi = m['52WeekHigh'], lo = m['52WeekLow'];

  // Sections: [title, [[label, value, colorClass]]]
  const sections = [
    ['Valuation', [
      ['P/E (TTM)', x(m.peTTM)],
      ['Forward P/E', x(m.forwardPE)],
      ['PEG (TTM)', x(m.pegTTM)],
      ['P/B', x(m.pb)],
      ['P/S (TTM)', x(m.psTTM)],
      ['EV/EBITDA', x(m.evEbitdaTTM)],
    ]],
    ['Performance', [
      ['Beta', n(m.beta, 2)],
      ['YTD Return', pct(m.yearToDatePriceReturnDaily), pos(m.yearToDatePriceReturnDaily)],
      ['52W Return', pct(m['52WeekPriceReturnDaily']), pos(m['52WeekPriceReturnDaily'])],
      ['26W Return', pct(m['26WeekPriceReturnDaily']), pos(m['26WeekPriceReturnDaily'])],
      ['13W Return', pct(m['13WeekPriceReturnDaily']), pos(m['13WeekPriceReturnDaily'])],
      ['52W High', $(hi)],
      ['52W Low', $(lo)],
    ]],
    // ['Profitability', [
    //   ['Gross Margin', pct(m.grossMarginTTM != null ? m.grossMarginTTM * 100 : null)],
    //   ['Net Margin', pct(m.netProfitMarginTTM != null ? m.netProfitMarginTTM * 100 : null)],
    //   ['Op. Margin', pct(m.operatingMarginTTM != null ? m.operatingMarginTTM * 100 : null)],
    //   ['ROE (TTM)', pct(m.roeTTM)],
    //   ['ROA (TTM)', pct(m.roaTTM)],
    //   ['ROI (TTM)', pct(m.roiTTM)],
    // ]],
    // ['Growth', [
    //   ['EPS Growth YoY', pct(m.epsGrowthTTMYoy),          pos(m.epsGrowthTTMYoy)],
    //   ['EPS Growth 5Y',  pct(m.epsGrowth5Y),              pos(m.epsGrowth5Y)],
    //   ['Rev Growth YoY', pct(m.revenueGrowthTTMYoy),      pos(m.revenueGrowthTTMYoy)],
    //   ['Rev Growth 5Y',  pct(m.revenueGrowth5Y),          pos(m.revenueGrowth5Y)],
    //   ['EBITDA CAGR 5Y', pct(m.ebitdaCagr5Y),             pos(m.ebitdaCagr5Y)],
    // ]],
    ['Dividends', [
      ['Yield (TTM)', pct(m.currentDividendYieldTTM)],
      ['Div/Share TTM', $(m.dividendPerShareTTM)],
      ['Payout Ratio', pct(m.payoutRatioTTM)],
      ['Div Growth 5Y', pct(m.dividendGrowthRate5Y), pos(m.dividendGrowthRate5Y)],
    ]],
    // ['Financial Health', [
    //   ['Current Ratio', n(m.currentRatioAnnual, 2)],
    //   ['Quick Ratio', n(m.quickRatioAnnual, 2)],
    //   ['D/E (Annual)', n(m['totalDebt/totalEquityAnnual'], 2)],
    //   ['LT D/E', n(m['longTermDebt/equityAnnual'], 2)],
    // ]],
  ];

  // 52-week price range bar (if data available)
  let rangeBar = '';
  if (hi != null && lo != null && hi > lo) {
    const hiDate = m['52WeekHighDate'] ? ` (${m['52WeekHighDate']})` : '';
    const loDate = m['52WeekLowDate'] ? ` (${m['52WeekLowDate']})` : '';
    const px = (currentPrice != null && isFinite(currentPrice)) ? currentPrice : null;
    const fillPct = px != null ? Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100)) : null;
    const markerHtml = fillPct != null
      ? `<div class="fund-range-marker" style="left:${fillPct.toFixed(1)}%"></div>`
      : '';
    const fillStyle = fillPct != null ? `style="width:${fillPct.toFixed(1)}%"` : '';
    const currentLabel = px != null
      ? `<div class="fund-range-current">Current: $${Number(px).toFixed(2)} &nbsp;·&nbsp; ${fillPct.toFixed(0)}% of range</div>`
      : '';
    rangeBar = `
      <div class="fund-range-wrap">
        <div class="fund-range-header">
          <span class="fund-range-lo">$${Number(lo).toFixed(2)}<span class="fund-range-date">${loDate}</span></span>
          <span class="fund-range-label">52-Week Range</span>
          <span class="fund-range-hi">$${Number(hi).toFixed(2)}<span class="fund-range-date">${hiDate}</span></span>
        </div>
        <div class="fund-range-track">
          <div class="fund-range-fill" ${fillStyle}></div>
          ${markerHtml}
        </div>
        ${currentLabel}
      </div>`;
  }

  const html = sections.map(([title, rows]) => {
    const visible = rows.filter(r => r[1] != null);
    if (visible.length === 0) return '';
    const cells = visible.map(([label, val, cls]) =>
      `<div class="fund-cell">
        <span class="fund-label">${esc(label)}</span>
        <span class="fund-value ${cls || ''}">${esc(val)}</span>
      </div>`
    ).join('');
    return `<div class="fund-section">
      <div class="fund-section-title">${esc(title)}</div>
      <div class="fund-grid">${cells}</div>
    </div>`;
  }).join('');

  container.innerHTML = rangeBar + html;
}

/* ─── Stock News ──────────────────────────────────────────────────────────── */
window.loadStockNews = async function (ticker) {
  const listEl = document.getElementById('spNewsList');
  const badgeEl = document.getElementById('spNewsBadge');
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="skel-news-item"><div class="skeleton skel-news-img"></div><div class="skel-news-body"><div class="skeleton skel-line skel-w-30"></div><div class="skeleton skel-line skel-w-90"></div><div class="skeleton skel-line skel-w-70"></div></div></div>
    <div class="skel-news-item"><div class="skeleton skel-news-img"></div><div class="skel-news-body"><div class="skeleton skel-line skel-w-40"></div><div class="skeleton skel-line skel-w-80"></div><div class="skeleton skel-line skel-w-60"></div></div></div>
    <div class="skel-news-item"><div class="skeleton skel-news-img"></div><div class="skel-news-body"><div class="skeleton skel-line skel-w-35"></div><div class="skeleton skel-line skel-w-85"></div><div class="skeleton skel-line skel-w-55"></div></div></div>
  `;
  if (badgeEl) badgeEl.style.display = 'none';

  try {
    const res = await fetch(`/api/stock-news/${encodeURIComponent(ticker)}`);
    const json = await res.json();

    if (json.status !== 'ok' || !json.data) {
      listEl.innerHTML = '<div class="activity-empty">News unavailable — Finnhub token not configured.</div>';
      return;
    }

    _renderStockNews(json.data, ticker);
  } catch (err) {
    listEl.innerHTML = '<div class="activity-empty">Could not load news.</div>';
  }
}

function _renderStockNews(data, ticker) {
  const listEl = document.getElementById('spNewsList');
  const badgeEl = document.getElementById('spNewsBadge');

  if (!data || data.length === 0) {
    listEl.innerHTML = `<div class="activity-empty">No news found for ${esc(ticker)} in the past year.</div>`;
    return;
  }

  if (badgeEl) { badgeEl.textContent = `${data.length} articles`; badgeEl.style.display = ''; }

  listEl.innerHTML = data.map(item => {
    const ts = item.datetime ? new Date(item.datetime * 1000) : null;
    const dateStr = ts ? ts.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }) : '';
    const headline = item.headline || 'Untitled';
    const source = item.source || '';
    const summary = item.summary || '';
    const url = item.url || '#';
    const image = item.image || '';
    const category = item.category || '';

    const truncated = summary.length > 140 ? summary.slice(0, 140).trimEnd() + '…' : summary;

    return `
      <div class="news-item">
        ${image ? `<img class="news-thumb" src="${esc(image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="news-body">
          <a class="news-headline" href="${esc(url)}" target="_blank" rel="noopener">${esc(headline)}</a>
          <div class="news-meta">
            ${source ? `<span class="news-source">${esc(source)}</span>` : ''}
            ${category ? `<span class="news-cat">${esc(category)}</span>` : ''}
            ${dateStr ? `<span class="news-date">${dateStr}</span>` : ''}
          </div>
          ${truncated ? `<p class="news-summary">${esc(truncated)}</p>` : ''}
        </div>
      </div>`;
  }).join('');
}


/* ─── Summary Drill-downs (Diversification) ───────────────────────────── */

async function openDiversificationDetails() {
  const panel = document.getElementById('summaryPanel');
  const backdrop = document.getElementById('summaryPanelBackdrop');
  const content = document.getElementById('smContent');
  const title = document.getElementById('smTitle');
  const subtitle = document.getElementById('smSubtitle');
  const iconWrap = document.getElementById('smIcon');

  title.textContent = 'Diversification Insights';
  subtitle.textContent = 'Risk & Concentration Analysis';
  iconWrap.textContent = '◓';
  content.innerHTML = `
    <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-60"></div><div class="skeleton skel-line skel-w-40"></div></div><div class="skeleton skel-amount"></div></div>
    <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-55"></div><div class="skeleton skel-line skel-w-35"></div></div><div class="skeleton skel-amount"></div></div>
    <div class="skel-item"><div class="skeleton skel-dot"></div><div class="skel-body"><div class="skeleton skel-line skel-w-50"></div><div class="skeleton skel-line skel-w-30"></div></div><div class="skeleton skel-amount"></div></div>
  `;

  panel.classList.add('open');
  backdrop.classList.add('active');

  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/diversification-details`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message);

    const { recommendations, sector_breakdown, top_holdings } = json.data;

    let html = `
      <div class="sm-section">
        <div class="recommendations-box">
          ${recommendations.map(msg => `
            <div class="sm-recommendation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
              <span>${esc(msg)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="sm-section">
        <h3 class="sm-section-title">Sector Allocation</h3>
        <table class="sm-table">
          <tbody>
            ${sector_breakdown.map(s => `
              <tr>
                <td>${esc(s.sector)}</td>
                <td style="text-align:right; white-space:nowrap">
                  <div>${s.percentage}%</div>
                  <div class="sm-item-weight"><div class="sm-weight-fill" style="width:${s.percentage}%"></div></div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="sm-section">
        <h3 class="sm-section-title">Top Holdings Concentration</h3>
        <div style="display:flex; flex-wrap:wrap; gap:8px">
          ${top_holdings.map(h => `
            <div style="background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:6px; font-size:0.85rem">
              <strong>${esc(h.ticker)}</strong>: ${h.weight}%
            </div>
          `).join('')}
        </div>
      </div>
    `;
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="activity-empty">Error: ${err.message}</div>`;
  }
}

function closeSummaryPanel() {
  document.getElementById('summaryPanel').classList.remove('open');
  document.getElementById('summaryPanelBackdrop').classList.remove('active');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PORTFOLIO REBALANCING PANEL
   ═══════════════════════════════════════════════════════════════════════════ */

const _REBAL_STORAGE_KEY = () => `rebal_targets_${PORTFOLIO_ID}`;

function _loadRebalTargets() {
  try { return JSON.parse(localStorage.getItem(_REBAL_STORAGE_KEY()) || 'null') || {}; }
  catch { return {}; }
}

function _saveRebalTargets(map) {
  localStorage.setItem(_REBAL_STORAGE_KEY(), JSON.stringify(map));
}

function openRebalancePanel() {
  const panel = document.getElementById('rebalancePanel');
  const backdrop = document.getElementById('rebalancePanelBackdrop');
  if (!panel) return;
  panel.classList.add('open');
  backdrop.classList.add('active');
  _renderRebalancePanel();
}

function closeRebalancePanel() {
  document.getElementById('rebalancePanel').classList.remove('open');
  document.getElementById('rebalancePanelBackdrop').classList.remove('active');
}

function _renderRebalancePanel() {
  const content = document.getElementById('rebalancePanelContent');
  if (!content || !allRows.length) {
    if (content) content.innerHTML = '<div class="activity-empty" style="padding:24px">Load a portfolio first.</div>';
    return;
  }

  // ── Build sector totals from current rows ─────────────────────────────────
  const totalValue = allRows.reduce((s, r) => s + (r.current_value || 0), 0);
  const sectorMap = {};
  for (const r of allRows) {
    const sec = r.sector || 'Other';
    if (!sectorMap[sec]) sectorMap[sec] = { value: 0, tickers: [] };
    sectorMap[sec].value += r.current_value || 0;
    sectorMap[sec].tickers.push(r.ticker);
  }
  const sectors = Object.entries(sectorMap)
    .map(([name, d]) => ({ name, value: d.value, currentPct: totalValue > 0 ? (d.value / totalValue * 100) : 0 }))
    .sort((a, b) => b.value - a.value);

  // ── Load / default target weights ────────────────────────────────────────
  const saved = _loadRebalTargets();
  const equalPct = parseFloat((100 / sectors.length).toFixed(1));
  const targets = {};
  let targetSum = 0;
  for (const s of sectors) {
    targets[s.name] = saved[s.name] != null ? saved[s.name] : equalPct;
    targetSum += targets[s.name];
  }

  // ── Summary pills ─────────────────────────────────────────────────────────
  let totalBuy = 0, totalSell = 0;
  for (const s of sectors) {
    const delta = targets[s.name] - s.currentPct;
    const amt = Math.abs(delta / 100 * totalValue);
    if (delta > 0.1) totalBuy += amt;
    if (delta < -0.1) totalSell += amt;
  }

  // ── Build HTML ────────────────────────────────────────────────────────────
  const rows = sectors.map(s => {
    const target = targets[s.name];
    const delta = target - s.currentPct;
    const absDelta = Math.abs(delta);
    const actionAmt = absDelta / 100 * totalValue;
    const deltaClass = delta > 0.5 ? 'under' : delta < -0.5 ? 'over' : 'ok';
    const deltaSign = delta > 0 ? '+' : '';
    let actionHtml;
    if (delta > 0.5) actionHtml = `<span class="buy">Buy ${fmt.currency(actionAmt)}</span>`;
    else if (delta < -0.5) actionHtml = `<span class="sell">Sell ${fmt.currency(actionAmt)}</span>`;
    else actionHtml = `<span class="hold">On target</span>`;

    const barPct = Math.min(100, s.currentPct / Math.max(...sectors.map(x => x.currentPct)) * 100);

    return `<tr>
      <td>
        <div class="rebal-sector-name">${esc(s.name)}</div>
        <div style="display:flex;align-items:center;margin-top:4px">
          <span class="rebal-bar-wrap"><span class="rebal-bar-fill" style="width:${barPct.toFixed(0)}%"></span></span>
          <span style="font-size:0.68rem;color:var(--text-muted)">${fmt.currency(s.value)}</span>
        </div>
      </td>
      <td class="rebal-val">${s.currentPct.toFixed(1)}%</td>
      <td>
        <div class="rebal-target-wrap">
          <input class="rebal-target-input" type="number" min="0" max="100" step="0.1"
            value="${target.toFixed(1)}"
            data-sector="${esc(s.name)}"
            oninput="_onRebalTargetChange()" />
          <span style="font-size:0.75rem;color:var(--text-muted)">%</span>
        </div>
      </td>
      <td class="rebal-delta ${deltaClass}">${deltaSign}${delta.toFixed(1)}%</td>
      <td class="rebal-action">${actionHtml}</td>
    </tr>`;
  }).join('');

  const targetSumWarn = Math.abs(targetSum - 100) > 0.5
    ? `<div style="font-size:0.72rem;color:var(--red);padding:4px 16px 0">⚠ Targets sum to ${targetSum.toFixed(1)}% — should be 100%</div>`
    : '';

  content.innerHTML = `
    <p class="rebal-intro">Set target sector weights and see what to buy or sell to rebalance your portfolio.</p>
    <div class="rebal-summary">
      <div class="rebal-summary-pill">
        <div class="pill-val">${fmt.currency(totalValue)}</div>
        <div class="pill-label">Portfolio value</div>
      </div>
      <div class="rebal-summary-pill">
        <div class="pill-val pos">${fmt.currency(totalBuy)}</div>
        <div class="pill-label">To buy</div>
      </div>
      <div class="rebal-summary-pill">
        <div class="pill-val neg">${fmt.currency(totalSell)}</div>
        <div class="pill-label">To sell</div>
      </div>
    </div>
    ${targetSumWarn}
    <div class="rebal-table-wrap">
      <table class="rebal-table">
        <thead>
          <tr>
            <th>Sector</th>
            <th class="th-r">Current</th>
            <th class="th-r">Target</th>
            <th class="th-r">Delta</th>
            <th class="th-r">Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="rebal-footer">
      <button class="rebal-footer-btn" onclick="_rebalReset()">Reset to equal</button>
      <button class="rebal-footer-btn primary" onclick="_rebalSave()">Save targets</button>
    </div>`;
}

function _onRebalTargetChange() {
  // Live re-render so delta/action columns update as user types
  const saved = _loadRebalTargets();
  for (const inp of document.querySelectorAll('.rebal-target-input')) {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) saved[inp.dataset.sector] = v;
  }
  _saveRebalTargets(saved);
  _renderRebalancePanel();
}

function _rebalReset() {
  localStorage.removeItem(_REBAL_STORAGE_KEY());
  _renderRebalancePanel();
}

function _rebalSave() {
  const map = {};
  for (const inp of document.querySelectorAll('.rebal-target-input')) {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) map[inp.dataset.sector] = v;
  }
  _saveRebalTargets(map);
  // Brief visual confirmation
  const btn = document.querySelector('.rebal-footer-btn.primary');
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save targets'; }, 1500); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PORTFOLIO HEATMAP — Squarified treemap, size = weight, color = return
   ═══════════════════════════════════════════════════════════════════════════ */

let _phmRects = [];

function _pnlColor(pct) {
  // Total return % — green = gain, amber = tiny loss, red = loss
  if (pct >= 30) return 'linear-gradient(135deg,#052e16,#15803d)';
  if (pct >= 15) return 'linear-gradient(135deg,#14532d,#16a34a)';
  if (pct >= 5) return 'linear-gradient(135deg,#166534,#22c55e)';
  if (pct >= 0) return 'linear-gradient(135deg,#0f766e,#14b8a6)';
  if (pct >= -5) return 'linear-gradient(135deg,#78350f,#b45309)';
  if (pct >= -15) return 'linear-gradient(135deg,#7f1d1d,#dc2626)';
  return 'linear-gradient(135deg,#450a0a,#b91c1c)';
}

function drawPortfolioHeatmap(rows, totalValue) {
  const container = document.getElementById('portfolioHeatmap');
  if (!container || !rows.length) return;

  const W = container.clientWidth || 600;
  const H = container.clientHeight || Math.max(Math.round(W * 0.52), 240);
  if (!container.clientHeight) { requestAnimationFrame(() => drawPortfolioHeatmap(rows, totalValue)); return; }
  container.style.height = H + 'px';

  const items = [...rows]
    .filter(r => r.current_value > 0)
    .sort((a, b) => b.current_value - a.current_value)
    .map(r => ({ ...r, value: r.current_value }));

  // _computeTreemap is defined globally in home.js (squarified algorithm)
  _phmRects = _computeTreemap(items, W, H);

  const GAP = 3;
  container.innerHTML = _phmRects.map((rect, i) => {
    const r = rect.item;
    const pct = r.returns_pct || 0;
    const sign = pct >= 0 ? '+' : '';
    const weight = totalValue > 0 ? (r.current_value / totalValue * 100) : (r.weight || 0);
    const bg = _heatColor(pct);
    const tinyW = rect.w < 52;
    const tinyH = rect.h < 44;

    const inner = tinyW || tinyH
      ? `<span class="phm-ticker" style="font-size:0.58rem">${esc(r.ticker)}</span>`
      : `<span class="phm-ticker">${esc(r.ticker)}</span>
         <span class="phm-weight">${weight.toFixed(1)}%</span>
         <span class="phm-pct">${sign}${pct.toFixed(2)}%</span>`;

    return `<div class="phm-cell" data-i="${i}"
      style="left:${(rect.x + GAP / 2).toFixed(1)}px;top:${(rect.y + GAP / 2).toFixed(1)}px;
             width:${(rect.w - GAP).toFixed(1)}px;height:${(rect.h - GAP).toFixed(1)}px;
             background:${bg}"
      title="${esc(r.company_name)} · ${weight.toFixed(1)}% · ${sign}${pct.toFixed(2)}%">
      ${inner}
    </div>`;
  }).join('');

  container.querySelectorAll('.phm-cell').forEach(el => {
    el.onclick = () => openStockPanel(_phmRects[+el.dataset.i].item);
  });
  _animateHeatmapCells('portfolioHeatmap');
}

function drawSectorHeatmap(rows, totalValue) {
  const container = document.getElementById('sectorHeatmap');
  if (!container || !rows.length) return;

  // Group rows by sector
  const bySecMap = {};
  rows.filter(r => r.current_value > 0).forEach(r => {
    const sec = r.sector || 'Other';
    if (!bySecMap[sec]) bySecMap[sec] = { value: 0, weightedReturn: 0 };
    bySecMap[sec].value += r.current_value;
    bySecMap[sec].weightedReturn += r.current_value * (r.returns_pct || 0);
  });

  const items = Object.entries(bySecMap)
    .map(([name, d]) => ({
      name,
      value: d.value,
      avgReturn: d.value > 0 ? d.weightedReturn / d.value : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const W = container.clientWidth || 300;
  const H = container.clientHeight || Math.max(Math.round(W * 0.52), 240);
  if (!container.clientHeight) { requestAnimationFrame(() => drawSectorHeatmap(rows, totalValue)); return; }
  container.style.height = H + 'px';

  const rects = _computeTreemap(items, W, H);
  const GAP = 3;

  container.innerHTML = rects.map((rect) => {
    const r = rect.item;
    const pct = r.avgReturn;
    const sign = pct >= 0 ? '+' : '';
    const weight = totalValue > 0 ? (r.value / totalValue * 100) : 0;
    const bg = _heatColor(pct);
    const tinyW = rect.w < 70;
    const tinyH = rect.h < 44;

    // Shorten common sector labels for tight cells
    const shortName = r.name
      .replace('Communication Services', 'Comms')
      .replace('Consumer Discretionary', 'Cons. Disc.')
      .replace('Consumer Staples', 'Cons. Staples')
      .replace('Information Technology', 'Tech')
      .replace('Health Care', 'Healthcare')
      .replace('Real Estate', 'Real Estate')
      .replace('Index Funds', 'Index');

    const displayName = tinyW ? shortName.split(/[\s/]/)[0] : shortName;

    const inner = tinyW || tinyH
      ? `<span class="phm-ticker" style="font-size:0.58rem">${esc(displayName)}</span>`
      : `<span class="phm-ticker" style="font-size:0.72rem;font-weight:600">${esc(displayName)}</span>
         <span class="phm-weight">${weight.toFixed(1)}%</span>
         <span class="phm-pct">${sign}${pct.toFixed(1)}%</span>`;

    return `<div class="phm-cell"
      style="left:${(rect.x + GAP / 2).toFixed(1)}px;top:${(rect.y + GAP / 2).toFixed(1)}px;
             width:${(rect.w - GAP).toFixed(1)}px;height:${(rect.h - GAP).toFixed(1)}px;
             background:${bg}"
      title="${esc(r.name)} · ${weight.toFixed(1)}% · avg return ${sign}${pct.toFixed(1)}%">
      ${inner}
    </div>`;
  }).join('');
  _animateHeatmapCells('sectorHeatmap');
}

/* ═══════════════════════════════════════════════════════════════════════════
   DONUT CHARTS — Canvas-drawn, no external library
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Draw a donut chart on a canvas element.
 * @param {string} canvasId   - canvas element id
 * @param {string} legendId   - legend container id
 * @param {Array}  segments   - [{label, value, color, pct}]
 */
function drawDonutChart(canvasId, legendId, segments) {
  const canvas = document.getElementById(canvasId);
  const legendEl = document.getElementById(legendId);
  if (!canvas || !legendEl) return;

  const dpr = window.devicePixelRatio || 1;
  const size = 220;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 10;
  const hole = radius * 0.58;
  const total = segments.reduce((s, g) => s + g.value, 0);

  if (total === 0) {
    ctx.clearRect(0, 0, size, size);
    legendEl.innerHTML = '<span style="font-size:0.78rem;color:var(--text-secondary)">No data</span>';
    return;
  }

  let startAngle = -Math.PI / 2;
  const gap = 0.018; // radians gap between segments

  segments.forEach(seg => {
    const slice = (seg.value / total) * (Math.PI * 2 - gap * segments.length);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle + gap / 2, startAngle + gap / 2 + slice);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();

    // Inner hole — erase center
    ctx.beginPath();
    ctx.arc(cx, cy, hole, 0, Math.PI * 2);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#0f1629';
    ctx.fill();

    seg._startAngle = startAngle + gap / 2;
    seg._endAngle = startAngle + gap / 2 + slice;
    startAngle += slice + gap;
  });

  // Hover interaction
  canvas._donutSegments = segments;
  canvas._donutTotal = total;
  canvas._donutCx = cx; canvas._donutCy = cy;
  canvas._donutR = radius; canvas._donutHole = hole;
  canvas.onmousemove = _donutHover;
  canvas.onmouseleave = _donutLeave;

  // Legend
  legendEl.innerHTML = segments.map(seg => {
    const pct = (seg.value / total * 100).toFixed(1);
    return `<div class="chart-legend-item">
      <div class="chart-legend-dot" style="background:${seg.color}"></div>
      <span class="chart-legend-label">${esc(seg.label)}</span>
      <span class="chart-legend-val">${pct}%</span>
    </div>`;
  }).join('');
}

function _donutHover(e) {
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const dx = mx - canvas._donutCx;
  const dy = my - canvas._donutCy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < canvas._donutHole || dist > canvas._donutR) { hideTooltip(); return; }

  let angle = Math.atan2(dy, dx);
  if (angle < -Math.PI / 2) angle += Math.PI * 2;

  const seg = canvas._donutSegments.find(s => angle >= s._startAngle && angle <= s._endAngle);
  if (seg) {
    const pct = (seg.value / canvas._donutTotal * 100).toFixed(1);
    showTooltip(e, `<strong>${esc(seg.label)}</strong><br/>${fmt.currency(seg.value)} · ${pct}%`);
  } else {
    hideTooltip();
  }
}
function _donutLeave() { hideTooltip(); }

/** Build segments and draw all 3 donut charts for the portfolio view */
function drawDonutCharts(rows, totalValue) {
  if (!totalValue) return;

  // Palette
  const palette = [
    '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#a855f7', '#eab308', '#22c55e', '#64748b',
  ];
  let pi = 0;
  const nextColor = () => palette[pi++ % palette.length];

  // --- By Holdings (top 8 + Other) ---
  const sortedRows = [...rows].sort((a, b) => b.current_value - a.current_value);
  const top8 = sortedRows.slice(0, 8);
  const other = sortedRows.slice(8);
  const stockSegs = top8.map(r => ({ label: r.ticker, value: r.current_value, color: nextColor() }));
  if (other.length) {
    const otherVal = other.reduce((s, r) => s + r.current_value, 0);
    stockSegs.push({ label: 'Other', value: otherVal, color: '#475569' });
  }
  drawDonutChart('chartStocks', 'legendStocks', stockSegs);

  // --- By Country ---
  pi = 0;
  const byCountry = {};
  rows.forEach(r => { byCountry[r.country || 'Unknown'] = (byCountry[r.country || 'Unknown'] || 0) + r.current_value; });
  const countrySegs = Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: countryColor(label) }));
  drawDonutChart('chartCountry', 'legendCountry', countrySegs);

}

/* ═══════════════════════════════════════════════════════════════════════════
   STOCKS VIEW — Holdings table (separate from portfolio view)
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadStocksView(force = false) {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.disabled = true;
  showStocksState('loading');

  try {
    const url = force
      ? `/api/p${PORTFOLIO_ID}/portfolio?force=1`
      : `/api/p${PORTFOLIO_ID}/portfolio`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.status !== 'ok') { showStocksState('error', json.message || 'Failed to load.'); return; }

    allRows = json.data || [];
    if (allRows.length === 0) { showStocksState('empty'); return; }

    const totalValue = allRows.reduce((s, r) => s + r.current_value, 0);
    allRows.forEach(r => {
      r.weight = totalValue ? r.current_value / totalValue * 100 : 0;
      r.div_yield = r.current_value > 0 ? (r.dividends / r.current_value * 100) : 0;
    });

    _lastTotalDividends = json.total_dividends ?? null;
    _lastPAI = json.pai ?? 0;

    const titleEl = document.getElementById('stocksTableTitle');
    const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : {};
    if (titleEl) {
      const label = PORTFOLIO_ID === 'combined' ? 'Combined'
        : (names[PORTFOLIO_ID] || `Portfolio ${PORTFOLIO_ID}`);
      // titleEl.textContent = `Holdings · ${label}`;
    }

    // renderCountryFilters(allRows);
    renderTable(allRows);
    loadAnalystRatings();
    _loadStockSparklines(allRows);
    if (Object.keys(_tickerChangeMap).length) renderTopMovers();

    showStocksState('table');
  } catch (err) {
    showStocksState('error', 'Network error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showStocksState(state, msg) {
  const loading = document.getElementById('stocksStateLoading');
  const error = document.getElementById('stocksStateError');
  const empty = document.getElementById('stocksStateEmpty');
  const table = document.getElementById('stocksTableWrapper');

  if (loading) loading.style.display = state === 'loading' ? '' : 'none';
  if (error) error.style.display = state === 'error' ? '' : 'none';
  if (empty) empty.style.display = state === 'empty' ? '' : 'none';
  if (table) table.style.display = state === 'table' ? '' : 'none';

  if (state === 'error' && msg) {
    const el = document.getElementById('stocksErrorText');
    if (el) el.textContent = msg;
  }
}

/* ── Monthly Performance Heatmap ────────────────────────────────────────── */

let _monthlyPerfData = null;
let _dynamicsData = null;
let _dynamicsRange = '12m';

async function loadMonthlyPerformance() {
  const container = document.getElementById('monthlyPerfHeatmap');
  if (!container) return;
  _showElemLoading(container, 'Loading monthly performance…');

  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/monthly-performance`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Failed');
    _monthlyPerfData = json.data;
    _renderMonthlyPerfHeatmap(_monthlyPerfData);
  } catch (err) {
    _showElemLoading(container, 'Failed to load monthly performance');
  }
}

function setMonthlyPerfView(view, btn) {
  document.querySelectorAll('.mpv-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (view === '1y' && _monthlyPerfData) {
    _renderMonthlyPerfHeatmap(_monthlyPerfData);
  }
}

function _renderMonthlyPerfHeatmap(data) {
  const container = document.getElementById('monthlyPerfHeatmap');
  if (!container) return;
  container.dataset.view = '1y';

  // Collect all month keys present across tickers, last 12 months sorted
  const allMonths = new Set();
  Object.values(data).forEach(monthly => Object.keys(monthly).forEach(m => allMonths.add(m)));
  const sortedMonths = Array.from(allMonths).sort().slice(-12);

  if (sortedMonths.length === 0) {
    _showElemLoading(container, 'No monthly data available yet');
    return;
  }

  const monthLabels = sortedMonths.map(m => {
    const [year, mon] = m.split('-');
    const d = new Date(+year, +mon - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).toUpperCase();
  });

  // S&P 500 first, then portfolio rows by allRows order (or alphabetical)
  const tickers = Object.keys(data).filter(t => t !== 'S&P 500');
  if (typeof allRows !== 'undefined' && allRows.length) {
    const order = allRows.map(r => r.ticker);
    tickers.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  } else {
    tickers.sort();
  }
  if (data['S&P 500']) tickers.unshift('S&P 500');

  // Build table
  let html = '<table class="mph-table"><thead><tr>';
  html += '<th class="mph-ticker-col">Ticker</th>';
  monthLabels.forEach(lbl => { html += `<th>${lbl}</th>`; });
  html += '</tr></thead><tbody>';

  tickers.forEach(ticker => {
    const monthly = data[ticker] || {};
    const isSp500 = ticker === 'S&P 500';
    const rowClass = isSp500 ? '' : '';
    html += `<tr${rowClass}><td class="mph-ticker-col"><span class="mph-ticker">${ticker}</span></td>`;
    sortedMonths.forEach(mk => {
      const val = monthly[mk];
      if (val == null) {
        html += '<td class="mph-cell mph-empty">—</td>';
      } else {
        const sign = val >= 0 ? '+' : '';
        const cls = val >= 0 ? 'mph-pos' : 'mph-neg';
        const bg = _mphColor(val);
        html += `<td class="mph-cell ${cls}" style="background:${bg}">${sign}${val.toFixed(1)}%</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function _renderMtdHeatmap(data) {
  const container = document.getElementById('monthlyPerfHeatmap');
  if (!container) return;
  container.dataset.view = 'mtd';

  // Collect current-month day keys only
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const allDays = new Set();
  Object.values(data).forEach(daily => {
    Object.keys(daily).forEach(d => { if (d.startsWith(currentYM)) allDays.add(d); });
  });
  const sortedDays = Array.from(allDays).sort();

  if (sortedDays.length === 0) {
    _showElemLoading(container, 'No MTD data available yet');
    return;
  }

  const dayLabels = sortedDays.map(d => {
    const date = new Date(d + 'T12:00:00Z');
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
  });

  // S&P 500 first, then portfolio tickers alphabetically
  const tickers = Object.keys(data).filter(t => t !== 'S&P 500').sort();
  if (data['S&P 500']) tickers.unshift('S&P 500');

  let html = '<table class="mph-table"><thead><tr>';
  html += '<th class="mph-ticker-col">Ticker</th>';
  dayLabels.forEach(lbl => { html += `<th>${lbl}</th>`; });
  html += '</tr></thead><tbody>';

  tickers.forEach(ticker => {
    const daily = data[ticker] || {};
    const isSp500 = ticker === 'S&P 500';
    const rowClass = isSp500 ? '' : '';
    html += `<tr${rowClass}><td class="mph-ticker-col"><span class="mph-ticker">${ticker}</span></td>`;
    sortedDays.forEach(dk => {
      const val = daily[dk];
      if (val == null) {
        html += '<td class="mph-cell mph-empty">—</td>';
      } else {
        const sign = val >= 0 ? '+' : '';
        const cls = val >= 0 ? 'mph-pos' : 'mph-neg';
        const bg = _mphColor(val);
        html += `<td class="mph-cell ${cls}" style="background:${bg}">${sign}${val.toFixed(1)}%</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function _renderYearlyHeatmap(data) {
  const container = document.getElementById('monthlyPerfHeatmap');
  if (!container) return;
  container.dataset.view = '15y';

  const allYears = new Set();
  Object.values(data).forEach(yearly => Object.keys(yearly).forEach(y => allYears.add(y)));
  const sortedYears = Array.from(allYears).sort().slice(-15);

  if (sortedYears.length === 0) {
    _showElemLoading(container, 'No yearly data available yet');
    return;
  }

  // S&P 500 first, then portfolio tickers alphabetically
  const tickers = Object.keys(data).filter(t => t !== 'S&P 500').sort();
  if (data['S&P 500']) tickers.unshift('S&P 500');

  let html = '<table class="mph-table"><thead><tr>';
  html += '<th class="mph-ticker-col">Ticker</th>';
  sortedYears.forEach(y => { html += `<th>${y}</th>`; });
  html += '</tr></thead><tbody>';

  tickers.forEach(ticker => {
    const yearly = data[ticker] || {};
    const isSp500 = ticker === 'S&P 500';
    const rowClass = isSp500 ? ' class="mph-sp500-row"' : '';
    html += `<tr${rowClass}><td class="mph-ticker-col"><span class="mph-ticker">${ticker}</span></td>`;
    sortedYears.forEach(yk => {
      const val = yearly[yk];
      if (val == null) {
        html += '<td class="mph-cell mph-empty">—</td>';
      } else {
        const sign = val >= 0 ? '+' : '';
        const cls = val >= 0 ? 'mph-pos' : 'mph-neg';
        const bg = _mphYearlyColor(val);
        html += `<td class="mph-cell ${cls}" style="background:${bg}">${sign}${val.toFixed(1)}%</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function _mphColor(pct) {
  // Monthly/daily return bands
  if (pct >= 10) return 'linear-gradient(135deg,#052e16,#15803d)';
  if (pct >= 5) return 'linear-gradient(135deg,#14532d,#16a34a)';
  if (pct >= 2) return 'linear-gradient(135deg,#166534,#22c55e)';
  if (pct >= 0) return 'linear-gradient(135deg,#0f766e,#14b8a6)';
  if (pct >= -2) return 'linear-gradient(135deg,#78350f,#b45309)';
  if (pct >= -5) return 'linear-gradient(135deg,#7f1d1d,#dc2626)';
  return 'linear-gradient(135deg,#450a0a,#b91c1c)';
}

function _mphYearlyColor(pct) {
  // Annual return bands — wider thresholds for full-year moves
  if (pct >= 40) return 'linear-gradient(135deg,#052e16,#15803d)';
  if (pct >= 20) return 'linear-gradient(135deg,#14532d,#16a34a)';
  if (pct >= 8) return 'linear-gradient(135deg,#166534,#22c55e)';
  if (pct >= 0) return 'linear-gradient(135deg,#0f766e,#14b8a6)';
  if (pct >= -8) return 'linear-gradient(135deg,#78350f,#b45309)';
  if (pct >= -20) return 'linear-gradient(135deg,#7f1d1d,#dc2626)';
  return 'linear-gradient(135deg,#450a0a,#b91c1c)';
}

/* ── Dynamics of Portfolio Returns ──────────────────────────────────────── */

async function loadDynamicsChart() {
  const card = document.getElementById('dynamicsCard');
  if (!card) return;
  if (_dynamicsData) { _initDynamicsRangeTabs(); _drawDynamicsChart(); return; }
  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/monthly-returns`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Failed');
    _dynamicsData = json.data || [];
    _initDynamicsRangeTabs();
    _drawDynamicsChart();
  } catch (err) {
    const canvas = document.getElementById('dynamicsChart');
    if (canvas) _showChartEmpty(canvas, 'No data yet — history is building up');
  }
}

function _getDynamicsFiltered() {
  if (!_dynamicsData || !_dynamicsData.length) return [];
  if (_dynamicsRange === 'all') return _dynamicsData;
  if (_dynamicsRange === '12m') return _dynamicsData.slice(-12);
  return _dynamicsData.filter(d => d.month.startsWith(_dynamicsRange));
}

function _drawDynamicsChart() {
  const canvas = document.getElementById('dynamicsChart');
  if (!canvas) return;
  if (!canvas.offsetWidth) { requestAnimationFrame(_drawDynamicsChart); return; }

  const data = _getDynamicsFiltered();
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if (!data.length) {
    _showChartEmpty(canvas);
    return;
  }
  _hideChartEmpty(canvas);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textCol = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const gridCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const zeroCol = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
  const posCol = '#4ade80';
  const negCol = '#f87171';

  const PAD = { top: 32, right: 12, bottom: 44, left: 44 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const vals = data.map(d => d.pct);
  const maxVal = Math.max(...vals, 1);
  const minVal = Math.min(...vals, -1);
  const yMax = Math.ceil(maxVal * 1.25 / 5) * 5;
  const yMin = Math.floor(minVal * 1.25 / 5) * 5;
  const yRng = yMax - yMin;

  const yOf = v => PAD.top + (1 - (v - yMin) / yRng) * cH;
  const y0 = yOf(0);
  const barStep = cW / data.length;
  const barW = Math.max(6, Math.min(44, barStep * 0.62));
  const xOf = i => PAD.left + (i + 0.5) * barStep;

  // Y-axis gridlines + labels
  const yStep = yRng <= 15 ? 5 : yRng <= 40 ? 10 : 20;
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = yMin; v <= yMax + 0.01; v += yStep) {
    const y = yOf(v);
    ctx.strokeStyle = v === 0 ? zeroCol : gridCol;
    ctx.lineWidth = v === 0 ? 1.2 : 0.5;
    ctx.setLineDash(v === 0 ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = textCol;
    ctx.fillText(v + '%', PAD.left - 6, y);
  }

  const showLabels = barW > 16;

  // Draw bars with rounded outer corners
  data.forEach((d, i) => {
    const x = xOf(i);
    const pos = d.pct >= 0;
    const bTop = pos ? yOf(d.pct) : y0;
    const bH = Math.max(1, Math.abs(yOf(d.pct) - y0));
    const r = Math.min(3, barW / 5);

    ctx.fillStyle = pos ? posCol : negCol;
    ctx.beginPath();
    if (pos) {
      ctx.moveTo(x - barW / 2 + r, bTop);
      ctx.arcTo(x + barW / 2, bTop, x + barW / 2, bTop + r, r);
      ctx.lineTo(x + barW / 2, y0);
      ctx.lineTo(x - barW / 2, y0);
      ctx.arcTo(x - barW / 2, bTop, x - barW / 2 + r, bTop, r);
    } else {
      ctx.moveTo(x - barW / 2, y0);
      ctx.lineTo(x + barW / 2, y0);
      ctx.lineTo(x + barW / 2, bTop + bH - r);
      ctx.arcTo(x + barW / 2, bTop + bH, x + barW / 2 - r, bTop + bH, r);
      ctx.lineTo(x - barW / 2 + r, bTop + bH);
      ctx.arcTo(x - barW / 2, bTop + bH, x - barW / 2, bTop + bH - r, r);
      ctx.lineTo(x - barW / 2, y0);
    }
    ctx.closePath();
    ctx.fill();

    // Value label above/below bar
    if (showLabels) {
      const sign = d.pct >= 0 ? '+' : '';
      const lbl = sign + d.pct.toFixed(1) + '%';
      ctx.fillStyle = pos ? posCol : negCol;
      ctx.font = 'bold 10px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = pos ? 'bottom' : 'top';
      ctx.fillText(lbl, x, pos ? bTop - 3 : bTop + bH + 3);
    }
  });

  // X-axis month labels
  ctx.fillStyle = textCol;
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = Math.max(1, Math.ceil(data.length / 18));
  data.forEach((d, i) => {
    if (i % labelEvery !== 0 && i !== data.length - 1) return;
    const [yr, mo] = d.month.split('-');
    const lbl = new Date(+yr, +mo - 1, 1)
      .toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    ctx.fillText(lbl, xOf(i), H - PAD.bottom + 6);
  });

  canvas._dynMeta = { data, xOf, yOf, y0, barW, barStep, PAD, W, H };

  // ── SPY benchmark overlay line ────────────────────────────────────────────
  const spyData = data.filter(d => d.spy_pct != null);
  if (spyData.length >= 2) {
    const spyCol = 'rgba(251,191,36,0.85)';
    ctx.save();
    ctx.strokeStyle = spyCol;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    data.forEach((d, i) => {
      if (d.spy_pct == null) return;
      const x = xOf(i);
      const y = yOf(d.spy_pct);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Show SPY legend
    const spyLeg = document.getElementById('dynLegSpy');
    const spyLbl = document.getElementById('dynLegSpyLabel');
    if (spyLeg) spyLeg.style.display = '';
    if (spyLbl) spyLbl.style.display = '';
  }
}

function _initDynamicsRangeTabs() {
  const tabBar = document.getElementById('dynamicsRangeTabs');
  if (!tabBar || tabBar._dynInit) return;
  tabBar._dynInit = true;

  // Inject year tabs from data
  if (_dynamicsData && _dynamicsData.length) {
    const years = [...new Set(_dynamicsData.map(d => d.month.slice(0, 4)))].sort((a, b) => b - a);
    years.forEach(yr => {
      const btn = document.createElement('button');
      btn.className = 'dyn-tab';
      btn.dataset.range = yr;
      btn.dataset.year = yr;
      btn.textContent = yr;
      tabBar.appendChild(btn);
    });
  }

  tabBar.addEventListener('click', e => {
    const btn = e.target.closest('.dyn-tab');
    if (!btn) return;
    tabBar.querySelectorAll('.dyn-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const range = btn.dataset.range;
    if (range === '1W' || range === '1M') {
      _loadDailyReturns(range);
    } else {
      _dynamicsRange = range;
      _dynamicsView = _dynamicsView || 'returns';
      if (_dynamicsView === 'attribution') _drawAttributionChart();
      else _drawDynamicsChart();
    }
  });

  // Hover: column highlight + tooltip
  const canvas = document.getElementById('dynamicsChart');
  if (!canvas) return;

  canvas.addEventListener('mousemove', e => {
    const m = canvas._dynMeta;
    if (!m || !m.data.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(m.data.length - 1,
      Math.floor((mx - m.PAD.left) / m.barStep)));
    const pt = m.data[idx];
    if (!pt) return;

    _drawDynamicsChart();
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    // Column highlight
    const pos = pt.pct >= 0;
    ctx.fillStyle = pos ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)';
    ctx.fillRect(m.xOf(idx) - m.barStep / 2, m.PAD.top, m.barStep, m.H - m.PAD.top - m.PAD.bottom);

    const tooltip = document.getElementById('dynamicsTooltip');
    if (!tooltip) return;
    const [yr, mo] = pt.month.split('-');
    const monthStr = new Date(+yr, +mo - 1, 1)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const sign = pt.pct >= 0 ? '+' : '';
    const fmtVal = v => '£' + v.toLocaleString('en-GB', { maximumFractionDigits: 0 });
    tooltip.innerHTML = `
      <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:2px">${monthStr}</div>
      <div style="font-size:0.85rem;font-weight:700;color:${pos ? '#4ade80' : '#f87171'}">${sign}${pt.pct.toFixed(2)}%</div>
      <div style="font-size:0.7rem;color:var(--text-muted)">Value: ${fmtVal(pt.value)}</div>`;
    const tx = Math.min(m.xOf(idx) + 10, m.W - 120);
    const ty = Math.max(m.PAD.top + 4, m.y0 - 60);
    tooltip.style.cssText = `display:flex;flex-direction:column;gap:2px;left:${tx}px;top:${ty}px`;
  });

  canvas.addEventListener('mouseleave', () => {
    _drawDynamicsChart();
    const tooltip = document.getElementById('dynamicsTooltip');
    if (tooltip) tooltip.style.display = 'none';
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   RISK METRICS STRIP  (portfolio view — compact row below summary cards)
   ══════════════════════════════════════════════════════════════════════════ */

async function loadRiskMetricsStrip() {
  try {
    const res = await fetch('/api/pcombined/risk-metrics');
    const json = await res.json();
    if (json.status !== 'ok') return;
    const d = json.data;
    if (d.insufficient_data) {
      const strip = document.getElementById('riskStrip');
      if (strip) strip.style.display = 'none';
      return;
    }

    // Remove skeleton classes
    ['rs-volatility', 'rs-sharpe', 'rs-beta', 'rs-twr', 'rs-maxdd'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('skeleton');
    });

    _setRsValue('rsVolatility', d.volatility != null ? d.volatility.toFixed(1) + '%' : '—');
    _setRsValue('rsSharpe', d.sharpe != null ? d.sharpe.toFixed(2) : '—', d.sharpe);
    _setRsValue('rsBeta', d.beta != null ? d.beta.toFixed(2) : '—');

    // TWR vs SPY: show portfolio TWR and diff
    if (d.twr != null && d.spy_twr != null) {
      const diff = d.twr_vs_spy;
      const sign = diff >= 0 ? '+' : '';
      const el = document.getElementById('rsTwr');
      if (el) {
        el.textContent = d.twr.toFixed(1) + '%';
        el.className = 'rs-value ' + (diff >= 0 ? 'pos' : 'neg');
      }
      const sub = document.querySelector('#rs-twr .rs-sub');
      if (sub) sub.textContent = `SPY: ${d.spy_twr.toFixed(1)}% (${sign}${diff.toFixed(1)}%)`;
    } else {
      _setRsValue('rsTwr', d.twr != null ? d.twr.toFixed(1) + '%' : '—');
    }

    // Max drawdown: compute from snapshot data (reuse drawdown if already computed)
    if (typeof _ddMaxDD !== 'undefined' && _ddMaxDD != null) {
      const el = document.getElementById('rsMaxDD');
      if (el) el.textContent = _ddMaxDD.toFixed(1) + '%';
    } else {
      _setRsValue('rsMaxDD', '—');
      _loadMaxDrawdownForStrip();
    }
  } catch (_) { }
}

function _setRsValue(id, text, numForColor) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (numForColor != null) {
    el.className = 'rs-value ' + (numForColor >= 0 ? 'pos' : 'neg');
  }
}

async function _loadMaxDrawdownForStrip() {
  try {
    const res = await fetch(`/api/pcombined/daily-history`);
    const json = await res.json();
    if (json.status !== 'ok' || !json.data.length) return;
    const vals = json.data.map(d => d.value);
    let peak = vals[0], maxDD = 0;
    for (const v of vals) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? (v - peak) / peak * 100 : 0;
      if (dd < maxDD) maxDD = dd;
    }
    const el = document.getElementById('rsMaxDD');
    if (el) el.textContent = maxDD.toFixed(1) + '%';
  } catch (_) { }
}

/* ══════════════════════════════════════════════════════════════════════════
   REALIZED vs UNREALIZED P&L  (fetched once on portfolio load)
   ══════════════════════════════════════════════════════════════════════════ */

async function loadRealizedUnrealized() {
  try {
    const res = await fetch('/api/overview');
    const json = await res.json();
    if (json.status !== 'ok') return;
    const pid = typeof PORTFOLIO_ID !== 'undefined' ? PORTFOLIO_ID : 'combined';
    const d = json.data[pid] || json.data['combined'];
    if (!d) return;
    const unrealized = d.unrealized_pnl;
    const realized = d.realized_pnl;
    const rvEl = document.getElementById('realizedValue');
    const uvEl = document.getElementById('unrealizedValue');
    if (uvEl && unrealized != null) {
      const sign = unrealized >= 0 ? '+' : '';
      uvEl.textContent = sign + fmt.currency(unrealized);
      uvEl.className = 'pnl-split-val ' + colorClass(unrealized);
    }
    if (rvEl && realized != null) {
      const sign = realized >= 0 ? '+' : '';
      rvEl.textContent = sign + fmt.currency(realized);
      rvEl.className = 'pnl-split-val ' + colorClass(realized);
    }
    // const splitRow = document.getElementById('pnlSplitRow');
    // if (splitRow) splitRow.style.display = '';
  } catch (_) { }
}

/* ══════════════════════════════════════════════════════════════════════════
   RETURN ATTRIBUTION  (sector contribution stacked bar)
   ══════════════════════════════════════════════════════════════════════════ */

let _attributionData = null;
let _dynamicsView = 'returns'; // 'returns' | 'attribution'

function _setDynamicsView(view) {
  _dynamicsView = view;
  const btnR = document.getElementById('dynViewReturns');
  const btnA = document.getElementById('dynViewAttrib');
  if (btnR) btnR.classList.toggle('active', view === 'returns');
  if (btnA) btnA.classList.toggle('active', view === 'attribution');
  const hintEl = document.getElementById('dynamicsHint');
  if (view === 'attribution') {
    if (hintEl) hintEl.textContent = 'Monthly sector contribution to returns';
    if (_attributionData) _drawAttributionChart();
    else _loadAttribution();
  } else {
    if (hintEl) hintEl.textContent = 'Month-over-month portfolio value change';
    if (_dynamicsData) _drawDynamicsChart();
    else loadDynamicsChart();
  }
}

async function _loadAttribution() {
  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/return-attribution`);
    const json = await res.json();
    if (json.status === 'ok') {
      _attributionData = json.data;
      _drawAttributionChart();
    }
  } catch (_) { }
}

const _SECTOR_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#22c55e',
  '#a78bfa', '#fb923c', '#e879f9', '#4ade80', '#60a5fa',
];

function _drawAttributionChart() {
  const canvas = document.getElementById('dynamicsChart');
  if (!canvas) return;
  if (!canvas.offsetWidth) { requestAnimationFrame(_drawAttributionChart); return; }

  const d = _attributionData;
  if (!d || !d.months || !d.months.length) {
    _showChartEmpty(canvas, 'Not enough data yet');
    return;
  }
  _hideChartEmpty(canvas);

  // Filter months based on _dynamicsRange
  let months = d.months;
  if (_dynamicsRange === '12m') months = months.slice(-12);
  else if (_dynamicsRange !== 'all' && _dynamicsRange.length === 4) {
    months = months.filter(m => m.startsWith(_dynamicsRange));
  }

  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textCol = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const gridCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  const PAD = { top: 32, right: 12, bottom: 44, left: 44 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const sectors = d.sectors;
  const colorMap = {};
  sectors.forEach((s, i) => { colorMap[s] = _SECTOR_COLORS[i % _SECTOR_COLORS.length]; });

  // Compute total range
  const totals = months.map(m => {
    const mv = d.attribution[m] || {};
    return sectors.reduce((s, sec) => s + (mv[sec] || 0), 0);
  });
  const maxVal = Math.max(...totals, 1);
  const minVal = Math.min(...totals, -1);
  const yMax = Math.ceil(maxVal * 1.25 / 5) * 5;
  const yMin = Math.floor(minVal * 1.25 / 5) * 5;
  const yRng = yMax - yMin;
  const yOf = v => PAD.top + (1 - (v - yMin) / yRng) * cH;
  const y0 = yOf(0);
  const barStep = cW / months.length;
  const barW = Math.max(6, Math.min(44, barStep * 0.62));
  const xOf = i => PAD.left + (i + 0.5) * barStep;

  // Y gridlines
  const yStep = yRng <= 15 ? 5 : yRng <= 40 ? 10 : 20;
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = yMin; v <= yMax + 0.01; v += yStep) {
    const y = yOf(v);
    ctx.strokeStyle = v === 0 ? (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)') : gridCol;
    ctx.lineWidth = v === 0 ? 1.2 : 0.5;
    ctx.setLineDash(v === 0 ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = textCol;
    ctx.fillText(v + '%', PAD.left - 6, y);
  }

  // Stacked bars
  months.forEach((m, i) => {
    const mv = d.attribution[m] || {};
    const x = xOf(i);
    let posY = y0, negY = y0;
    sectors.forEach(sec => {
      const v = mv[sec] || 0;
      if (v === 0) return;
      const bH = Math.abs(yOf(v) - y0);
      if (v >= 0) {
        ctx.fillStyle = colorMap[sec];
        ctx.fillRect(x - barW / 2, posY - bH, barW, bH);
        posY -= bH;
      } else {
        ctx.fillStyle = colorMap[sec];
        ctx.fillRect(x - barW / 2, negY, barW, bH);
        negY += bH;
      }
    });
  });

  // X labels
  ctx.fillStyle = textCol;
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = Math.max(1, Math.ceil(months.length / 18));
  months.forEach((m, i) => {
    if (i % labelEvery !== 0 && i !== months.length - 1) return;
    const [yr, mo] = m.split('-');
    const lbl = new Date(+yr, +mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    ctx.fillText(lbl, xOf(i), H - PAD.bottom + 6);
  });

  // Legend
  const legEl = document.getElementById('dynamicsLegend');
  if (legEl) {
    legEl.innerHTML = sectors.map(s =>
      `<span class="dyn-leg-dot" style="background:${colorMap[s]};border:none"></span><span class="dyn-leg-label">${esc(s)}</span>`
    ).join('');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   DAILY / WEEKLY CHART GRANULARITY
   ══════════════════════════════════════════════════════════════════════════ */

let _dailyReturnsData = null;
let _dailyRange = null;

async function _loadDailyReturns(range) {
  _dailyRange = range;
  const canvas = document.getElementById('dynamicsChart');
  if (canvas) _showChartEmpty(canvas, 'Loading…');
  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/daily-returns?range=${range}`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message);
    _dailyReturnsData = json.data || [];
    _drawDailyChart(_dailyReturnsData, range);
    const hintEl = document.getElementById('dynamicsHint');
    if (hintEl) hintEl.textContent = range === '1W' ? 'Daily returns — last 7 days' : 'Daily returns — last 30 days';
  } catch (err) {
    const canvas2 = document.getElementById('dynamicsChart');
    if (canvas2) _showChartEmpty(canvas2, 'No daily data yet');
  }
}

function _drawDailyChart(data, range) {
  const canvas = document.getElementById('dynamicsChart');
  if (!canvas || !canvas.offsetWidth) { requestAnimationFrame(() => _drawDailyChart(data, range)); return; }
  _hideChartEmpty(canvas);

  if (!data.length) { _showChartEmpty(canvas, 'No data yet'); return; }

  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textCol = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const gridCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const zeroCol = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
  const posCol = '#4ade80', negCol = '#f87171';

  const PAD = { top: 32, right: 12, bottom: 44, left: 44 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const vals = data.map(d => d.pct);
  const maxVal = Math.max(...vals, 0.1);
  const minVal = Math.min(...vals, -0.1);
  const yMax = Math.ceil(maxVal * 1.3 / 0.5) * 0.5;
  const yMin = Math.floor(minVal * 1.3 / 0.5) * 0.5;
  const yRng = yMax - yMin;
  const yOf = v => PAD.top + (1 - (v - yMin) / yRng) * cH;
  const y0 = yOf(0);
  const barStep = cW / data.length;
  const barW = Math.max(4, Math.min(28, barStep * 0.7));
  const xOf = i => PAD.left + (i + 0.5) * barStep;

  // Grid + labels
  const yStep = yRng <= 2 ? 0.5 : yRng <= 5 ? 1 : 2;
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = yMin; v <= yMax + 0.001; v = Math.round((v + yStep) * 100) / 100) {
    const y = yOf(v);
    ctx.strokeStyle = v === 0 ? zeroCol : gridCol;
    ctx.lineWidth = v === 0 ? 1.2 : 0.5;
    ctx.setLineDash(v === 0 ? [] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = textCol;
    ctx.fillText(v.toFixed(1) + '%', PAD.left - 6, y);
  }

  // Bars
  data.forEach((d, i) => {
    const x = xOf(i), pos = d.pct >= 0;
    const bTop = pos ? yOf(d.pct) : y0;
    const bH = Math.max(1, Math.abs(yOf(d.pct) - y0));
    ctx.fillStyle = pos ? posCol : negCol;
    ctx.fillRect(x - barW / 2, bTop, barW, bH);
  });

  // X labels
  ctx.fillStyle = textCol;
  ctx.font = '10px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = Math.max(1, Math.ceil(data.length / 14));
  data.forEach((d, i) => {
    if (i % labelEvery !== 0 && i !== data.length - 1) return;
    const dt = new Date(d.date);
    const lbl = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    ctx.fillText(lbl, xOf(i), H - PAD.bottom + 6);
  });

  // Reset legend when in daily view
  const legEl = document.getElementById('dynamicsLegend');
  if (legEl) legEl.innerHTML = `<span class="dyn-leg-dot"></span><span class="dyn-leg-label">Portfolio (daily)</span>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   7-DAY SPARKLINES FOR HOLDINGS TABLE
   ══════════════════════════════════════════════════════════════════════════ */

async function _loadSparklines7d(rows) {
  if (!rows || !rows.length) return;
  const tickers = rows.map(r => r.ticker).join(',');
  const countries = rows.map(r => r.country).join(',');
  try {
    // Reuse stock-sparklines endpoint but request 5d/1d data
    const res = await fetch(`/api/stock-sparklines?tickers=${encodeURIComponent(tickers)}&countries=${encodeURIComponent(countries)}&range=5d`);
    const json = await res.json();
    if (json.status !== 'ok') return;
    for (const [ticker, points] of Object.entries(json.data)) {
      if (!points.length) continue;
      const safeId = ticker.replace(/[^a-zA-Z0-9]/g, '_');
      const canvas = document.getElementById('spark7d-' + safeId);
      if (canvas) _drawStockSparkline7d(canvas, points);
    }
  } catch (_) { }
}

function _drawStockSparkline7d(canvas, points) {
  const W = 72, H = 28;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const prices = points.map(p => p.price);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const range = (maxP - minP) || 1;
  const isUp = prices[prices.length - 1] >= prices[0];
  const lineCol = isUp ? '#10b981' : '#ef4444';
  const pad = { t: 2, b: 2, l: 1, r: 1 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  const xOf = i => pad.l + (i / (prices.length - 1)) * cW;
  const yOf = v => pad.t + (1 - (v - minP) / range) * cH;
  ctx.beginPath();
  prices.forEach((p, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(p)) : ctx.lineTo(xOf(i), yOf(p)));
  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/* ══════════════════════════════════════════════════════════════════════════
   TOP MOVERS STRIP  (above holdings table)
   ══════════════════════════════════════════════════════════════════════════ */

function renderTopMovers() {
  if (!Object.keys(_tickerChangeMap).length) return;
  const strip = document.getElementById('topMoversStrip');
  const container = document.getElementById('moversItems');
  if (!strip || !container) return;

  const entries = Object.entries(_tickerChangeMap)
    .filter(([, v]) => v != null)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8);

  if (!entries.length) return;

  container.innerHTML = entries.map(([ticker, pct]) => {
    const sign = pct >= 0 ? '+' : '';
    const cls = pct >= 0 ? 'mover-pos' : 'mover-neg';
    return `<span class="mover-chip ${cls}" onclick="openStockPanelByTicker('${esc(ticker)}')">
      <span class="mover-ticker">${esc(ticker)}</span>
      <span class="mover-pct">${sign}${pct.toFixed(2)}%</span>
    </span>`;
  }).join('');
  strip.style.display = '';
}

function openStockPanelByTicker(ticker) {
  const row = allRows.find(r => r.ticker === ticker);
  if (row) openStockPanel(row);
}

/* ══════════════════════════════════════════════════════════════════════════
   ANIMATED SECTOR HEATMAP
   ══════════════════════════════════════════════════════════════════════════ */

function _animateHeatmapCells(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const cells = container.querySelectorAll('.phm-cell');
  cells.forEach((cell, i) => {
    cell.style.opacity = '0';
    cell.style.transform = 'scale(0.88)';
    cell.style.transition = 'none';
    requestAnimationFrame(() => {
      setTimeout(() => {
        cell.style.transition = `opacity 0.25s ease ${i * 18}ms, transform 0.25s ease ${i * 18}ms`;
        cell.style.opacity = '1';
        cell.style.transform = 'scale(1)';
      }, 10);
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   NOTIFICATIONS PANEL
   ══════════════════════════════════════════════════════════════════════════ */

let _notifPanelOpen = false;

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  _notifPanelOpen = !_notifPanelOpen;
  panel.style.display = _notifPanelOpen ? '' : 'none';
  if (_notifPanelOpen) {
    loadNotifications();
    loadAlertsList();
  }
}

document.addEventListener('click', e => {
  if (_notifPanelOpen && !e.target.closest('#notifWrap')) {
    _notifPanelOpen = false;
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
  }
});

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const json = await res.json();
    if (json.status !== 'ok') return;
    const badge = document.getElementById('notifBadge');
    if (badge) {
      if (json.unread > 0) { badge.textContent = json.unread; badge.style.display = ''; }
      else badge.style.display = 'none';
    }
    const list = document.getElementById('notifList');
    if (!list) return;
    if (!json.data.length) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }
    list.innerHTML = json.data.map(n => {
      const dt = new Date(n.created_at * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const unreadCls = n.is_read ? '' : ' notif-unread';
      const iconMap = { alert: 'add_alert', price: 'trending_up', system: 'info' };
      const icon = iconMap[n.type] || 'notifications';
      return `<div class="notif-item${unreadCls}">
        <span class="material-symbols-outlined notif-icon">${icon}</span>
        <div class="notif-content">
          <div class="notif-title">${esc(n.title)}</div>
          <div class="notif-msg">${esc(n.message)}</div>
          <div class="notif-time">${dt}</div>
        </div>
      </div>`;
    }).join('');
  } catch (_) { }
}

async function markNotificationsRead() {
  try {
    await fetch('/api/notifications/read', { method: 'POST' });
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
    const list = document.getElementById('notifList');
    if (list) list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
  } catch (_) { }
}

/* ══════════════════════════════════════════════════════════════════════════
   PRICE ALERTS  (modal + list)
   ══════════════════════════════════════════════════════════════════════════ */

function openAlertsModal() {
  const overlay = document.getElementById('alertModalOverlay');
  if (overlay) overlay.style.display = 'flex';
  toggleNotifPanel(); // close notification panel
}

function closeAlertsModal() {
  const overlay = document.getElementById('alertModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function saveAlert() {
  const ticker = (document.getElementById('alertTicker')?.value || '').trim().toUpperCase();
  const condition = document.getElementById('alertCondition')?.value || 'above';
  const currency = document.getElementById('alertCurrency')?.value || 'GBP';
  const threshold = parseFloat(document.getElementById('alertThreshold')?.value || '0');
  if (!ticker || isNaN(threshold) || threshold <= 0) {
    alert('Please enter a valid ticker and threshold.');
    return;
  }
  try {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, condition, threshold, currency }),
    });
    const json = await res.json();
    if (json.status === 'ok') {
      closeAlertsModal();
      document.getElementById('alertTicker').value = '';
      document.getElementById('alertThreshold').value = '';
      // Re-open notifications panel to see the new alert
      _notifPanelOpen = false;
      toggleNotifPanel();
    }
  } catch (_) { }
}

async function loadAlertsList() {
  try {
    const res = await fetch('/api/alerts');
    const json = await res.json();
    if (json.status !== 'ok') return;
    const container = document.getElementById('alertsList');
    if (!container) return;
    if (!json.data.length) {
      container.innerHTML = '<div class="notif-empty" style="font-size:0.75rem">No alerts set</div>';
      return;
    }
    container.innerHTML = json.data.map(a => {
      const triggered = a.triggered_at ? ' alert-triggered' : '';
      const status = a.triggered_at ? '✓ Triggered' : (a.enabled ? 'Active' : 'Disabled');
      return `<div class="alert-item${triggered}">
        <div class="alert-item-info">
          <span class="alert-ticker">${esc(a.ticker)}</span>
          <span class="alert-cond">${a.condition} ${fmt.currencyNative(a.threshold, a.currency)}</span>
          <span class="alert-status">${status}</span>
        </div>
        <button class="alert-delete-btn" onclick="deleteAlert(${a.id})">✕</button>
      </div>`;
    }).join('');
  } catch (_) { }
}

async function deleteAlert(id) {
  try {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
    loadAlertsList();
  } catch (_) { }
}

// Auto-detect currency when typing ticker
document.getElementById('alertTicker')?.addEventListener('input', (e) => {
  const ticker = (e.target.value || '').trim().toUpperCase();
  const row = allRows.find(r => r.ticker === ticker);
  const currencyEl = document.getElementById('alertCurrency');
  const labelEl = document.getElementById('alertThresholdLabel');
  if (row && currencyEl) {
    let native = row.native_currency || 'GBP';
    if (native === 'GBX') native = 'GBP'; // User enters in GBP for UK stocks
    currencyEl.value = native;
    if (labelEl) labelEl.textContent = `Threshold (${native})`;
  }
});

document.getElementById('alertCurrency')?.addEventListener('change', (e) => {
  const labelEl = document.getElementById('alertThresholdLabel');
  if (labelEl) labelEl.textContent = `Threshold (${e.target.value})`;
});

/* ══════════════════════════════════════════════════════════════════════════
   MOBILE THEME LABEL SYNC
   ══════════════════════════════════════════════════════════════════════════ */

function _syncMobileTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const mobIcon = document.getElementById('mobThemeIcon');
  const mobLabel = document.getElementById('mobThemeLabel');
  const mobBadge = document.getElementById('mobThemeBadge');
  if (mobIcon) mobIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
  if (mobLabel) mobLabel.textContent = isDark ? 'Dark Mode' : 'Light Mode';
  if (mobBadge) mobBadge.textContent = isDark ? 'ON' : 'OFF';
}
