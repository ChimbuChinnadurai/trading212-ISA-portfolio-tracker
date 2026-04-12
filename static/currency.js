/* ─── Currency State ─────────────────────────────────────────────────────── */
let currentCurrency = localStorage.getItem('currency') || 'GBP';
let fxRate = 1.27; // fallback until fetched

async function fetchFxRate() {
  try {
    const res = await fetch('/api/fx-rate');
    const json = await res.json();
    if (json.rate) fxRate = json.rate;
  } catch (_) {}
}

function convertFromGBP(v) {
  return currentCurrency === 'USD' ? Number(v) * fxRate : Number(v);
}

function setRate(r) {
  const n = Number(r);
  if (n > 0) fxRate = n;
}

function setCurrency(c) {
  if (c === currentCurrency) return;
  currentCurrency = c;
  localStorage.setItem('currency', c);
  _updateCurrencyButtons();
  if (typeof onCurrencyChange === 'function') onCurrencyChange();
  if (typeof onHomeCurrencyChange === 'function') onHomeCurrencyChange();
  _flashCurrencyValues();
}

function _flashCurrencyValues() {
  const els = document.querySelectorAll(
    '.s-card-value, .ov-main-val, .ov-returns, .ov-mini-val, .cell-num, .topbar-breadcrumb-value'
  );
  els.forEach(el => {
    el.classList.remove('currency-flash');
    // force reflow so re-adding the class retriggers the animation
    void el.offsetWidth;
    el.classList.add('currency-flash');
  });
}

function _updateCurrencyButtons() {
  document.querySelectorAll('.currency-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.currency === currentCurrency)
  );
}

/* ─── Shared UI feedback helpers ────────────────────────────────────────── */
function showRefreshSuccess() {
  const btn = document.getElementById('refreshBtn');
  if (!btn) return;
  const prev = btn.innerHTML;
  btn.classList.add('btn-success');
  btn.innerHTML = '<span class="material-symbols-outlined btn-icon" style="font-size:15px;line-height:1">check_circle</span> Updated';
  setTimeout(() => {
    btn.classList.remove('btn-success');
    btn.innerHTML = prev;
  }, 2200);
}

/* ─── Shared formatters (replaces per-page fmt objects) ─────────────────── */
const fmt = {
  currency: (n, decimals = 2) => {
    if (n == null) return '—';
    const val = convertFromGBP(Number(n));
    const sym = currentCurrency === 'USD' ? '$' : '£';
    return sym + val.toLocaleString('en-GB', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    });
  },
  currencyNative: (n, currencyCode, decimals = 2) => {
    if (n == null) return '—';
    const symMap = { 'GBP': '£', 'USD': '$', 'EUR': '€', 'GBX': 'p' };
    const code = (currencyCode || 'GBP').toUpperCase();
    const sym = symMap[code] || code;
    const formatted = Number(n).toLocaleString('en-GB', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    });
    return code === 'GBX' ? (formatted + 'p') : (sym + formatted);
  },
  number: (n, decimals = 4) =>
    n == null ? '—' : Number(n).toLocaleString('en-GB', {
      minimumFractionDigits: 0, maximumFractionDigits: decimals
    }),
  pct: (n) =>
    n == null ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%',
};

document.addEventListener('DOMContentLoaded', () => _updateCurrencyButtons());
