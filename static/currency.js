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
}

function _updateCurrencyButtons() {
  document.querySelectorAll('.currency-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.currency === currentCurrency)
  );
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
  number: (n, decimals = 4) =>
    n == null ? '—' : Number(n).toLocaleString('en-GB', {
      minimumFractionDigits: 0, maximumFractionDigits: decimals
    }),
  pct: (n) =>
    n == null ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%',
};

document.addEventListener('DOMContentLoaded', () => _updateCurrencyButtons());
