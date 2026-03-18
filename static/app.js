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
  if (theme === 'light') {
    icon.innerHTML = '<path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>';
  } else {
    icon.innerHTML = '<path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/>';
  }
}

/* ─── State ───────────────────────────────────────────────────────────────── */
let allRows = [];
let sortCol = 'current_value';
let sortDir = 'desc';
let activeCountry = null;
let _recommendations = {};
let _lastTotalDividends = null;
let _lastPAI = 0;
let _lastDivScore = 0;
let _activityData = null;
let _dividendData = null;
let _monthlyData = null;
let _stockCalData = null;
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();

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
async function loadActivity() {
  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/activity`);
    const json = await res.json();
    _activityData = json.data || [];
    _renderActivity(_activityData, json.warning);
  } catch (err) {
    document.getElementById('activityList').innerHTML =
      `<div class="activity-empty">Could not load activity: ${esc(err.message)}</div>`;
  }
}

function _renderActivity(data, warning) {
  const listEl = document.getElementById('activityList');
  if (data.length === 0) {
    const msg = warning ? `API error: ${warning}` : 'No recent orders found.';
    listEl.innerHTML = `<div class="activity-empty">${esc(msg)}</div>`;
    return;
  }

  const badge = document.getElementById('activityBadge');
  if (badge) { badge.textContent = data.length; badge.style.display = ''; }

  listEl.innerHTML = data.map(order => {
    const rawTicker = order.ticker || '';
    const ticker = rawTicker.split('_')[0] || rawTicker;
    const company = order._company_name || order.company_name || ticker || 'Unknown stock';

    const qty = Math.abs(order.filledQuantity ?? order.orderedQuantity ?? 0);
    const price = order.fillPrice ?? order.filledPrice ?? 0;
    const rawDate = order.dateExecuted ?? order.dateCreated ?? '';
    const status = (order.status || '').toUpperCase();
    const type = order.type || '';

    const isCancelled = status === 'CANCELLED' || status === 'REJECTED';
    const typeUpper = type.toUpperCase();
    const isSell = (order.side || order.direction || '').toUpperCase() === 'SELL'
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
    const value = order.filledValue
      ? fmt.currency(order.filledValue)
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

async function loadUpcomingDividends() {
  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/recent-dividends`);
    const json = await res.json();
    _dividendData = json.data || [];
    _renderDividends(_dividendData);
  } catch (err) {
    document.getElementById('upcomingList').innerHTML =
      '<div class="activity-empty">Could not load dividend history.</div>';
  }
}

function _renderDividends(data) {
  const listEl = document.getElementById('upcomingList');
  if (data.length === 0) {
    listEl.innerHTML = '<div class="activity-empty">No dividend history found.</div>';
    return;
  }
  listEl.innerHTML = data.map(div => {
    const ticker = (div.ticker || '').split('_')[0];
    const amount = fmt.currency(div.amount || 0);
    const date = div.paidOn || div.date || '—';
    return `
      <div class="activity-item">
        <div class="activity-dot activity-dot-div"></div>
        <div class="activity-content">
          <span class="activity-ticker">${esc(ticker)}</span>
          <div class="activity-desc">Dividend paid</div>
          <div class="activity-time">${esc(date)}</div>
        </div>
        <div class="activity-amount pos">${amount}</div>
      </div>`;
  }).join('');
}

/* ─── Load portfolio ──────────────────────────────────────────────────────── */
async function loadPortfolio(force = false) {
  document.getElementById('refreshBtn').disabled = true;
  showSkeletons();
  activeCountry = null;

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
    _lastPAI = json.pai ?? 0;
    _lastDivScore = json.div_score ?? 0;

    renderSummary(allRows, _lastTotalDividends, _lastPAI, _lastDivScore);
    // renderCountryFilters(allRows);
    renderTable(allRows);
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
    if (summaryTime) summaryTime.textContent = ts;

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
        document.getElementById('staleBannerText').textContent =
          `Data is ${mins} minute${mins !== 1 ? 's' : ''} old.`;
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

    // Load activity panels
    loadActivity();
    loadUpcomingDividends();
    loadMonthlyDividends();
    loadAnalystRatings();

  } catch (err) {
    showState('error', 'Network error: ' + err.message);
  } finally {
    document.getElementById('refreshBtn').disabled = false;
    hideSkeletons();
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
        <td colspan="14"><div class="skeleton skeleton-row"></div></td>
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

/* ─── Summary cards ───────────────────────────────────────────────────────── */
function renderSummary(rows, allTimeDividends = null, pai = 0, divScore = 0) {
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
  set('totalValue', fmt.currency(totalValue));
  set('totalInvested', 'Invested: ' + fmt.currency(invested));
  set('totalHoldings', rows.length + ' holdings');

  // Card 2: Dividends
  set('totalDividends', fmt.currency(totalDividends));

  // Card 4: PAI
  set('totalPAI', fmt.currency(pai));

  // Card 5: Div Score
  set('divScore', divScore);
  const meaningEl = document.getElementById('divScoreMeaning');
  if (meaningEl) {
    if (divScore >= 80) meaningEl.textContent = 'Excellent diversification';
    else if (divScore >= 60) meaningEl.textContent = 'Good diversification';
    else if (divScore >= 40) meaningEl.textContent = 'Moderate concentration';
    else meaningEl.textContent = 'High concentration';
  }

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

  // Card 3: Returns
  const rEl = document.getElementById('totalReturns');
  rEl.textContent = (totalReturns >= 0 ? '+' : '') + fmt.currency(totalReturns);
  rEl.className = 's-card-value ' + colorClass(totalReturns);

  const pEl = document.getElementById('totalReturnsPct');
  pEl.textContent = fmt.pct(returnsPct);
  pEl.className = 's-card-pct ' + colorClass(returnsPct);

  const rc = document.getElementById('returnsCard');
  if (rc) rc.dataset.pnl = totalReturns >= 0 ? 'pos' : 'neg';

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

  renderAllocBar(rows, totalValue);
  renderCurrencyBar(rows, totalValue);
  renderSectorBar(rows, totalValue);
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
  const panel = document.getElementById('monthlyDivPanel');
  const chartEl = document.getElementById('monthlyChart');
  if (!panel || !chartEl) return;

  if (data.length === 0) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  const recent = data.slice(-12);
  const maxAmount = Math.max(...recent.map(d => d.amount));

  const badge = document.getElementById('monthlyDivBadge');
  if (badge) { badge.textContent = `${data.length} mo`; badge.style.display = ''; }

  chartEl.innerHTML = `<div class="monthly-bars">
    ${recent.map(d => {
    const pct = maxAmount > 0 ? (d.amount / maxAmount * 100) : 0;
    const label = new Date(d.month + '-01').toLocaleString('en-GB', { month: 'short', year: '2-digit' });
    const tipText = `<strong>${label}</strong><br/>${fmt.currency(d.amount)}`;
    return `<div class="month-bar-item" 
              onmouseenter="showTooltip(event, '${tipText}')" 
              onmouseleave="hideTooltip()">
        <div class="month-bar-track">
          <div class="month-bar-fill" style="height:${pct.toFixed(1)}%"></div>
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
  if (r.country !== 'US' && r.country !== 'CA') return '<span class="cell-na">N/A</span>';
  const rec = _recommendations[r.ticker];
  if (!rec) return '<span class="cell-na">—</span>';
  const cls = {
    'Strong Buy': 'rating-strong-buy',
    'Buy': 'rating-buy',
    'Hold': 'rating-hold',
    'Sell': 'rating-sell',
    'Strong Sell': 'rating-strong-sell',
  }[rec.consensus] || '';
  const tooltip = `Strong Buy: ${rec.strongBuy}, Buy: ${rec.buy}, Hold: ${rec.hold}, Sell: ${rec.sell}, Strong Sell: ${rec.strongSell} (${rec.total} analysts · ${rec.period})`;
  return `<span class="rating-badge ${cls}" title="${esc(tooltip)}">${esc(rec.consensus)}</span>`;
}

/* ─── Table render ────────────────────────────────────────────────────────── */
function renderTable(rows) {
  const sorted = sortRows([...rows]);
  const filtered = filterRows(sorted);
  const tbody = document.getElementById('tableBody');
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

    const sparkId = 'sspark-' + r.ticker.replace(/[^a-zA-Z0-9]/g, '_');
    tr.innerHTML = `
      <td>
        <div class="cell-name-wrap">
          <span class="cell-company" title="${esc(r.company_name)}">${esc(r.company_name)}</span>
          ${sectorLabel}
        </div>
      </td>
      <td><span class="cell-ticker">${esc(r.ticker)}</span></td>
      <td><span class="${cbClass}">${esc(r.country)}</span></td>
      <td class="td-center"><canvas class="stock-spark" id="${sparkId}" width="80" height="32"></canvas></td>
      <td class="td-right cell-num">${fmt.number(r.quantity, 6)}</td>
      <td class="td-right cell-num">${fmt.currency(r.avg_price, 4)}</td>
      <td class="td-right cell-num">${fmt.currency(r.invested)}</td>
      <td class="td-right cell-num">${fmt.currency(r.current_value)}</td>
      <td class="td-right">${weightCell}</td>
      <td class="td-right">
        ${_pnlCell(r.total_returns, r.returns_pct)}
      </td>
      <td class="td-right cell-num">${fxCell}</td>
      <td class="td-right">
        <span class="pct-badge ${colorClass(r.returns_pct)}">
          ${r.returns_pct >= 0 ? '▲' : '▼'} ${Math.abs(r.returns_pct).toFixed(2)}%
        </span>
      </td>
      <td class="td-right cell-num">${fmt.currency(r.dividends)}</td>
      <td class="td-right">${divYieldCell}</td>
      <td class="td-right">${_ratingCell(r)}</td>
    `;
    tbody.appendChild(tr);
  });

  const total = rows.length, shown = filtered.length;
  document.getElementById('rowCount').textContent =
    shown === total
      ? `${total} holding${total !== 1 ? 's' : ''}`
      : `${shown} of ${total} holdings`;

  _loadStockSparklines(filtered);
}

/* ─── Stock 48h Sparklines ────────────────────────────────────────────────── */

async function _loadStockSparklines(rows) {
  if (!rows.length) return;
  const tickers   = rows.map(r => r.ticker).join(',');
  const countries = rows.map(r => r.country).join(',');
  try {
    const res  = await fetch(`/api/stock-sparklines?tickers=${encodeURIComponent(tickers)}&countries=${encodeURIComponent(countries)}`);
    const json = await res.json();
    if (json.status !== 'ok') return;
    for (const [ticker, points] of Object.entries(json.data)) {
      if (!points.length) continue;
      const canvasId = 'sspark-' + ticker.replace(/[^a-zA-Z0-9]/g, '_');
      _drawStockSparkline(canvasId, points);
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
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const prices  = points.map(p => p.price);
  const minP    = Math.min(...prices);
  const maxP    = Math.max(...prices);
  const range   = (maxP - minP) || 1;
  const isUp    = prices[prices.length - 1] >= prices[0];
  const lineCol = isUp ? '#10b981' : '#ef4444';
  const fillCol = isUp ? 'rgba(16,185,129,0.13)' : 'rgba(239,68,68,0.13)';

  const pad = { top: 3, bottom: 3, left: 1, right: 1 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;
  const xOf = i => pad.left + (i / (points.length - 1)) * cW;
  const yOf = v => pad.top  + (1 - (v - minP) / range) * cH;

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
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  canvas._sparkPoints  = points;
  canvas._sparkLineCol = lineCol;
  canvas._sparkMinP    = minP;
  canvas._sparkRange   = range;
  canvas._sparkPad     = pad;

  _attachStockSparkHover(canvas);
}

function _attachStockSparkHover(canvas) {
  if (canvas._sparkBound) return;
  canvas._sparkBound = true;

  let tip = document.getElementById('stock-spark-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id        = 'stock-spark-tip';
    tip.className = 'spark-tip';
    document.body.appendChild(tip);
  }

  canvas.addEventListener('mousemove', (e) => {
    const points = canvas._sparkPoints;
    if (!points) return;
    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const W      = 80;
    const pad    = canvas._sparkPad;
    const cW     = W - pad.left - pad.right;
    const idx    = Math.max(0, Math.min(points.length - 1, Math.round((mouseX - pad.left) / cW * (points.length - 1))));
    const pt     = points[idx];
    const time   = new Date(pt.ts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    tip.innerHTML    = `<span class="spark-tip-val">${pt.price.toFixed(2)}</span><span class="spark-tip-time">${time}</span>`;
    tip.style.display = 'flex';
    const tipW = 140;
    let left   = e.clientX + window.scrollX - tipW / 2;
    if (left + tipW > window.innerWidth - 8) left = e.clientX + window.scrollX - tipW;
    if (left < 4) left = 4;
    tip.style.left = left + 'px';
    tip.style.top  = (e.clientY + window.scrollY - 54) + 'px';
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
  document.getElementById(id).textContent = val;
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
  renderSummary(allRows, _lastTotalDividends, _lastPAI, _lastDivScore);
  renderTable(allRows);
  if (_activityData) _renderActivity(_activityData);
  if (_dividendData) _renderDividends(_dividendData);
  if (_monthlyData) _renderMonthly(_monthlyData);
}

/* ─── Init ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  _updateThemeIcon(theme);

  fetchFxRate();

  const th = document.querySelector('[data-col="current_value"]');
  if (th) th.classList.add('sort-desc');

  showState('table');   // show dashboard skeleton immediately
  loadPortfolio();

  // Auto-refresh every 5 minutes
  setInterval(() => {
    loadPortfolio();
  }, 5 * 60 * 1000);
});

/* ─── Analyst Ratings panel renderer ─────────────────────────────────────── */
function _renderPanelAnalystRatings(ticker) {
  const sec = document.getElementById('spAnalystRatingsSection');
  const container = document.getElementById('spAnalystRatings');
  const periodEl = document.getElementById('spAnalystPeriod');
  if (!sec || !container) return;

  const rec = _recommendations[ticker];
  if (!rec || rec.total === 0) { sec.style.display = 'none'; return; }

  sec.style.display = '';
  periodEl.textContent = rec.period || '';

  const cats = [
    { key: 'strongBuy', label: 'Strong Buy', cls: 'ar-strong-buy' },
    { key: 'buy', label: 'Buy', cls: 'ar-buy' },
    { key: 'hold', label: 'Hold', cls: 'ar-hold' },
    { key: 'sell', label: 'Sell', cls: 'ar-sell' },
    { key: 'strongSell', label: 'Strong Sell', cls: 'ar-strong-sell' },
  ];

  // Stacked bar
  const barSegs = cats.map(c => {
    const pct = (rec[c.key] / rec.total * 100).toFixed(1);
    return pct > 0 ? `<div class="ar-bar-seg ${c.cls}" style="width:${pct}%" title="${c.label}: ${rec[c.key]}"></div>` : '';
  }).join('');

  // Row breakdown
  const rows = cats.map(c => {
    if (rec[c.key] === 0) return '';
    const pct = (rec[c.key] / rec.total * 100).toFixed(0);
    return `
      <div class="ar-row">
        <span class="ar-dot ${c.cls}"></span>
        <span class="ar-label">${c.label}</span>
        <div class="ar-track"><div class="ar-fill ${c.cls}" style="width:${pct}%"></div></div>
        <span class="ar-count">${rec[c.key]}</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="ar-consensus-row">
      <span class="rating-badge ${_ratingCls(rec.consensus)}">${esc(rec.consensus)}</span>
      <span class="ar-total">${rec.total} analysts</span>
    </div>
    <div class="ar-bar">${barSegs}</div>
    <div class="ar-breakdown">${rows}</div>`;
}

function _ratingCls(consensus) {
  return {
    'Strong Buy': 'rating-strong-buy', 'Buy': 'rating-buy', 'Hold': 'rating-hold',
    'Sell': 'rating-sell', 'Strong Sell': 'rating-strong-sell'
  }[consensus] || '';
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
  document.getElementById('spCurrentPrice').textContent = fmt.currency((r.current_value / (r.quantity || 1)), 4);
  document.getElementById('spSector').textContent = r.sector || 'Unknown';

  // Show panel
  document.getElementById('sidePanelBackdrop').classList.add('active');
  document.getElementById('sidePanel').classList.add('open');

  // Load activity, news, and fundamentals
  window.loadStockActivity(r.ticker);
  window.loadStockNews(r.ticker);
  if (r.country === 'US' || r.country === 'CA') {
    window.loadStockMetrics(r.ticker);
    _renderPanelAnalystRatings(r.ticker);
  } else {
    const sec = document.getElementById('spFundamentalsSection');
    if (sec) sec.style.display = 'none';
  }
}

window.closeStockPanel = function () {
  document.getElementById('sidePanelBackdrop').classList.remove('active');
  document.getElementById('sidePanel').classList.remove('open');
}

window.loadStockActivity = async function (ticker) {
  const container = document.getElementById('spActivityList');
  container.innerHTML = '<div class="activity-loading">Loading Activity…</div>';

  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/stock-activity/${ticker}`);
    const json = await res.json();

    if (json.status !== 'ok' || !json.data || json.data.length === 0) {
      container.innerHTML = '<div class="activity-empty">No activity found for this stock.</div>';
      return;
    }

    _stockCalData = json.data;

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
window.loadStockMetrics = async function (ticker) {
  const sec = document.getElementById('spFundamentalsSection');
  const container = document.getElementById('spFundamentals');
  if (!sec || !container) return;

  sec.style.display = '';
  container.innerHTML = '<div class="activity-loading" style="padding:12px 0">Loading fundamentals…</div>';

  try {
    const res = await fetch(`/api/stock-metrics/${encodeURIComponent(ticker)}`);
    const json = await res.json();

    if (json.status !== 'ok' || !json.data || Object.keys(json.data).length === 0) {
      container.innerHTML = `<div class="activity-empty">${json.message || 'No fundamental data available.'}</div>`;
      return;
    }
    _renderStockMetrics(json.data);
  } catch (err) {
    console.error('Fundamentals error:', err);
    container.innerHTML = '<div class="activity-empty">Error loading fundamentals.</div>';
  }
}

function _renderStockMetrics(m) {
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
    rangeBar = `
      <div class="fund-range-wrap">
        <div class="fund-range-header">
          <span class="fund-range-lo">$${Number(lo).toFixed(2)}<span class="fund-range-date">${loDate}</span></span>
          <span class="fund-range-label">52-Week Range</span>
          <span class="fund-range-hi">$${Number(hi).toFixed(2)}<span class="fund-range-date">${hiDate}</span></span>
        </div>
        <div class="fund-range-track"><div class="fund-range-fill"></div></div>
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

  listEl.innerHTML = '<div class="activity-loading">Loading news…</div>';
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


/* ─── Summary Drill-downs (PAI & Diversification) ────────────────────────── */
async function openPaiDetails() {
  const panel = document.getElementById('summaryPanel');
  const backdrop = document.getElementById('summaryPanelBackdrop');
  const content = document.getElementById('smContent');
  const title = document.getElementById('smTitle');
  const subtitle = document.getElementById('smSubtitle');
  const iconWrap = document.getElementById('smIcon');

  title.textContent = 'Projected Annual Income';
  subtitle.textContent = 'Trailing 12m Estimates';
  iconWrap.textContent = '£';
  content.innerHTML = '<div class="activity-loading">Calculating income contributors...</div>';

  panel.classList.add('open');
  backdrop.classList.add('active');

  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/pai-details`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message);

    const { total_pai, contributors } = json.data;
    let html = `
      <div class="sm-section">
        <div class="sm-rationale" style="border-left-color: #8b5cf6;">
          Based on your current holdings, your portfolio is estimated to generate <strong>${fmt.currency(total_pai)}</strong> over the next 12 months (excluding special dividends).
        </div>
      </div>
      <div class="sm-section">
        <h3 class="sm-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
          Top Income Contributors
        </h3>
        <table class="sm-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th style="text-align:right">Income</th>
              <th style="text-align:right">Share</th>
            </tr>
          </thead>
          <tbody>
            ${contributors.map(c => `
              <tr>
                <td>
                  <div style="font-weight:600">${esc(c.ticker)}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted)">${esc(c.company_name)}</div>
                </td>
                <td style="text-align:right">${fmt.currency(c.income)}</td>
                <td style="text-align:right">
                  <div>${c.percentage}%</div>
                  <div class="sm-item-weight"><div class="sm-weight-fill" style="width:${c.percentage}%; background:#8b5cf6"></div></div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="activity-empty">Error: ${err.message}</div>`;
  }
}

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
  content.innerHTML = '<div class="activity-loading">Analyzing risk metrics...</div>';

  panel.classList.add('open');
  backdrop.classList.add('active');

  try {
    const res = await fetch(`/api/p${PORTFOLIO_ID}/diversification-details`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message);

    const { rationale, recommendations, sector_breakdown, top_holdings } = json.data;

    let html = `
      <div class="sm-section">
        <div class="sm-rationale">${esc(rationale)}</div>
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
