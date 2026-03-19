/**
 * router.js — Hash-based SPA router for the Portfolio Tracker
 *
 * Routes:
 *   #home                  → Overview / landing page
 *   #portfolio/1           → Portfolio 1 detail (charts + activity)
 *   #portfolio/2           → Portfolio 2 detail
 *   #portfolio/combined    → Combined portfolio detail
 *   #stocks/1              → Holdings table for portfolio 1
 *   #stocks/2              → Holdings table for portfolio 2
 *   #news                  → Market news view
 */

/* ── State ──────────────────────────────────────────────────────────────── */
let _currentRoute       = null;
let _homeInitialized    = false;
let _detailInitialized  = false;
let _detailActivePid    = null;
let _stocksInitialized  = false;
let _stocksActivePid    = null;
let _newsInitialized    = false;

/* ── Auto-refresh timer handles ─────────────────────────────────────────── */
const _homeTimers = {
    heatmap: null,
    fg:      null,
    news:    null,
    mkt:     null,
    mktTick: null,
};

/* ── View helpers ────────────────────────────────────────────────────────── */
function _showView(name) {
    document.querySelectorAll('.spa-view').forEach(el => {
        el.style.display = el.id === `view-${name}` ? '' : 'none';
    });
}

/* ── Breadcrumb ──────────────────────────────────────────────────────────── */
function _updateBreadcrumb(route) {
    const el = document.getElementById('breadcrumbText');
    if (!el) return;
    const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : {};
    const map = {
        'home':                 'Overview',
        'portfolio/1':          `Portfolio · ${names['1'] || 'Portfolio 1'}`,
        'portfolio/2':          `Portfolio · ${names['2'] || 'Portfolio 2'}`,
        'portfolio/combined':   'Portfolio · Combined',
        'stocks/1':             `Stocks · ${names['1'] || 'Portfolio 1'}`,
        'stocks/2':             `Stocks · ${names['2'] || 'Portfolio 2'}`,
        'stocks/combined':      'Stocks · Combined',
        'news':                 'Market News',
    };
    el.textContent = map[route] || 'Portfolio Tracker';
}

/* ── Pid switcher ────────────────────────────────────────────────────────── */
function _updatePidSwitcher(route) {
    const switcher  = document.getElementById('pidSwitcher');
    const btnCombined = document.getElementById('pidBtnCombined');
    if (!switcher) return;

    if (route.startsWith('portfolio/') || route.startsWith('stocks/')) {
        switcher.style.display = '';
        // Show Combined button for both portfolio and stocks
        if (btnCombined) btnCombined.style.display = '';

        const pid = route.split('/')[1];
        document.querySelectorAll('.pid-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById(
            pid === 'combined' ? 'pidBtnCombined' :
            pid === '1'        ? 'pidBtn1'        : 'pidBtn2'
        );
        if (activeBtn) activeBtn.classList.add('active');
    } else {
        switcher.style.display = 'none';
    }
}

/* Switch pid within the same view type (portfolio/* or stocks/*) */
function switchPid(pid) {
    if (!_currentRoute) return;
    const viewType = _currentRoute.startsWith('stocks/') ? 'stocks' : 'portfolio';
    navigate(`${viewType}/${pid}`);
}

/* ── Refresh button ──────────────────────────────────────────────────────── */
function _updateRefreshBtn(view) {
    const btn = document.getElementById('refreshBtn');
    if (!btn) return;
    if (view === 'home') {
        btn.onclick = () => loadHomeData(true);
    } else if (view === 'portfolio') {
        btn.onclick = () => loadPortfolio(true);
    } else if (view === 'stocks') {
        btn.onclick = () => loadStocksView(true);
    } else if (view === 'news') {
        btn.onclick = () => loadNewsView(true);
    }
}

/* ── Sidebar active state ────────────────────────────────────────────────── */
function _updateSidebarActive(route) {
    document.querySelectorAll('.nav-item[data-route], .nav-group-header[data-route]').forEach(el => {
        el.classList.remove('active');
    });

    // Exact match first
    const exact = document.querySelector(`.nav-item[data-route="${route}"]`);
    if (exact) exact.classList.add('active');

    // Auto-expand parent group
    if (route.startsWith('portfolio/')) _openNavGroup('portfolio');
    if (route.startsWith('stocks/'))    _openNavGroup('stocks');
}

function _openNavGroup(name) {
    const items  = document.getElementById(`navGroup${_cap(name)}Items`);
    const header = document.querySelector(`#navGroup${_cap(name)} .nav-group-header`);
    if (items)  items.classList.add('open');
    if (header) header.classList.add('open');
}

function toggleNavGroup(name) {
    const items  = document.getElementById(`navGroup${_cap(name)}Items`);
    const header = document.querySelector(`#navGroup${_cap(name)} .nav-group-header`);
    if (!items) return;
    const isOpen = items.classList.toggle('open');
    if (header) header.classList.toggle('open', isOpen);
}

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ── Sidebar collapse ────────────────────────────────────────────────────── */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const scrim   = document.getElementById('sidebarScrim');
    if (!sidebar) return;

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        const open = sidebar.classList.toggle('mobile-open');
        if (scrim) scrim.classList.toggle('active', open);
    } else {
        const collapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    }
}

function _restoreSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || window.innerWidth <= 768) return;
    // On tablet (≤1100px) the CSS forces icon-only via CSS vars — no JS needed
    if (window.innerWidth > 1100 && localStorage.getItem('sidebarCollapsed') === '1') {
        sidebar.classList.add('collapsed');
    }
}

/* ── Navigate (public API) ───────────────────────────────────────────────── */
function navigate(route) {
    const clean = route.replace(/^#/, '');
    location.hash = clean;
}

/* ── Router core ─────────────────────────────────────────────────────────── */
function _router() {
    const hash = (location.hash || '#home').replace(/^#/, '') || 'home';
    if (hash === _currentRoute) return;

    const prev = _currentRoute;
    _currentRoute = hash;

    // Deactivate previous view
    if (prev === 'home')                    _deactivateHomeView();
    else if (prev?.startsWith('portfolio/')) _deactivateDetailView();

    // Update shared UI
    _updateBreadcrumb(hash);
    _updateSidebarActive(hash);
    _updatePidSwitcher(hash);

    // Close mobile sidebar on navigation
    const sidebar = document.getElementById('sidebar');
    const scrim   = document.getElementById('sidebarScrim');
    if (sidebar?.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
        scrim?.classList.remove('active');
    }

    /* ── Home ── */
    if (hash === 'home') {
        _showView('home');
        _updateRefreshBtn('home');
        document.title = 'Portfolio Tracker';
        if (!_homeInitialized) {
            _initHomeView();
            _homeInitialized = true;
        } else {
            _activateHomeView();
        }

    /* ── Portfolio ── */
    } else if (hash.startsWith('portfolio/')) {
        const pid = hash.split('/')[1];
        _showView('portfolio');
        _updateRefreshBtn('portfolio');
        document.title = _portfolioTitle(pid) + ' — Portfolio Tracker';
        window.PORTFOLIO_ID = pid;

        if (!_detailInitialized || _detailActivePid !== pid) {
            _detailActivePid   = pid;
            _detailInitialized = true;
            _resetDetailView();
            if (typeof loadPortfolio === 'function') loadPortfolio(false);
        }
        _activateDetailView();

    /* ── Stocks ── */
    } else if (hash.startsWith('stocks/')) {
        const pid = hash.split('/')[1];
        _showView('stocks');
        _updateRefreshBtn('stocks');
        document.title = _portfolioTitle(pid) + ' · Stocks — Portfolio Tracker';
        window.PORTFOLIO_ID = pid;

        if (!_stocksInitialized || _stocksActivePid !== pid) {
            _stocksActivePid   = pid;
            _stocksInitialized = true;
            _resetStocksView();
            if (typeof loadStocksView === 'function') loadStocksView(false);
        }
        _activateDetailView(); // market status shared

    /* ── News ── */
    } else if (hash === 'news') {
        _showView('news');
        _updateRefreshBtn('news');
        document.title = 'Market News — Portfolio Tracker';
        if (!_newsInitialized) {
            if (typeof loadNewsView === 'function') loadNewsView();
            _newsInitialized = true;
        }
    }
}

function _portfolioTitle(pid) {
    const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : {};
    if (pid === 'combined') return 'Combined View';
    return names[pid] || `Portfolio ${pid}`;
}

/* ── Home view lifecycle ─────────────────────────────────────────────────── */
function _initHomeView() {
    if (typeof initRefreshClocks  === 'function') initRefreshClocks();
    if (typeof loadHomeData       === 'function') loadHomeData();
    if (typeof loadHomeWidgets    === 'function') loadHomeWidgets();
    if (typeof loadSparklines     === 'function') loadSparklines();
    if (typeof loadFearGreed      === 'function') loadFearGreed();
    if (typeof loadMarketIndicators==='function') loadMarketIndicators();
    if (typeof loadMarketStatus   === 'function') loadMarketStatus();
    if (typeof loadStockTicker    === 'function') loadStockTicker();
    _startHomeTimers();
}

function _activateHomeView() {
    if (typeof loadStockTicker === 'function') loadStockTicker();
    if (typeof loadFearGreed   === 'function') loadFearGreed();
    _startHomeTimers();
}

function _deactivateHomeView() { _stopHomeTimers(); }

function _startHomeTimers() {
    _stopHomeTimers();
    if (typeof loadFearGreed === 'function')
        _homeTimers.fg = setInterval(loadFearGreed, 60000);
    if (typeof loadMarketStatus === 'function') {
        _homeTimers.mkt = setInterval(loadMarketStatus, 60000);
        if (typeof _renderMarketStatus === 'function') {
            _homeTimers.mktTick = setInterval(() => {
                if (window._mktStatusData) _renderMarketStatus(window._mktStatusData);
            }, 1000);
        }
    }
    if (typeof loadMarketIndicators === 'function')
        setInterval(loadMarketIndicators, 1800000);
    if (typeof loadStockTicker === 'function')
        _homeTimers.heatmap = setInterval(loadStockTicker, 60000);
    // News has its own view — no background timer on home
}

function _stopHomeTimers() {
    Object.keys(_homeTimers).forEach(k => {
        if (_homeTimers[k]) { clearInterval(_homeTimers[k]); _homeTimers[k] = null; }
    });
}

/* ── Detail view lifecycle ───────────────────────────────────────────────── */
function _resetDetailView() {
    const dash    = document.getElementById('dashboard');
    const loading = document.getElementById('stateLoading');
    const search  = document.getElementById('searchInput');
    if (dash)    dash.style.display   = 'none';
    if (loading) loading.style.display = 'none';
    if (search)  search.value          = '';
}

function _resetStocksView() {
    const wrap    = document.getElementById('stocksTableWrapper');
    const loading = document.getElementById('stocksStateLoading');
    const tbody   = document.getElementById('tableBody');
    if (wrap)    wrap.style.display    = 'none';
    if (loading) loading.style.display = 'none';
    if (tbody)   tbody.innerHTML       = '';
}

function _activateDetailView() {
    if (typeof loadMarketStatus === 'function' && !_homeTimers.mkt) {
        loadMarketStatus();
        _homeTimers.mkt = setInterval(loadMarketStatus, 60000);
        if (typeof _renderMarketStatus === 'function') {
            _homeTimers.mktTick = setInterval(() => {
                if (window._mktStatusData) _renderMarketStatus(window._mktStatusData);
            }, 1000);
        }
    }
}

function _deactivateDetailView() {
    if (_homeTimers.mkt)     { clearInterval(_homeTimers.mkt);     _homeTimers.mkt     = null; }
    if (_homeTimers.mktTick) { clearInterval(_homeTimers.mktTick); _homeTimers.mktTick = null; }
}

/* ── Bootstrap ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);

    if (typeof applyCurrency === 'function') applyCurrency();

    _restoreSidebar();
    _router();
});

window.addEventListener('hashchange', _router);

// Public exports
window.navigate      = navigate;
window.toggleSidebar = toggleSidebar;
window.toggleNavGroup = toggleNavGroup;
window.switchPid     = switchPid;
