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
let _currentRoute = null;
let _homeInitialized = false;
let _detailInitialized = false;
let _detailActivePid = null;
let _stocksInitialized = false;
let _stocksActivePid = null;
let _newsInitialized = false;
let _calendarInitialized = false;
let _activityInitialized = false;
let _marketInitialized = false;
let _metricsInitialized = false;
let _watchlistInitialized = false;
let _aiInitialized = false;
let _dividendsInitialized = false;



/* ── Auto-refresh timer handles ─────────────────────────────────────────── */
const _homeTimers = {
    heatmap: null,
    hmScan: null,
    fg: null,
    news: null,
    mkt: null,
    mktTick: null,
    digest: null,
    sparklines: null,
};

const _marketTimers = {
    sp500: null,
    signals: null,
};

const _newsTimers = {
    autoRefresh: null,
};

/* ── View helpers ────────────────────────────────────────────────────────── */
function _showView(name) {
    const target = document.getElementById(`view-${name}`);
    if (!target) return;

    // Always apply display changes synchronously so subsequent init code
    // (loadStocksView, loadPortfolio, etc.) sees the correct visible state.
    // startViewTransition callbacks are called asynchronously (in a new task
    // after a screenshot is captured), which can cause data to render into a
    // still-hidden view. By updating the DOM first and then optionally starting
    // a transition for the cosmetic animation, we avoid that race condition.
    document.querySelectorAll('.spa-view').forEach(el => {
        el.style.display = el.id === `view-${name}` ? '' : 'none';
    });

    // Trigger the animation without a callback (old state already captured above)
    if (document.startViewTransition) {
        document.startViewTransition();
    }
}

/* ── Breadcrumb ──────────────────────────────────────────────────────────── */
function _formatTopbarDate() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
}

function _updateBreadcrumb(route) {
    const greetEl = document.getElementById('greetingText');
    const subtitleEl = document.getElementById('breadcrumbText');
    const iconEl = document.getElementById('topbarSectionIcon');
    const names = typeof PORTFOLIO_NAMES !== 'undefined' ? PORTFOLIO_NAMES : {};
    const sectionMap = {
        'portfolio/1': { label: '', icon: 'pie_chart' },
        'portfolio/2': { label: '', icon: 'pie_chart' },
        'portfolio/combined': { label: '', icon: 'pie_chart' },
        'stocks/1': { label: '', icon: 'table_chart' },
        'stocks/2': { label: '', icon: 'table_chart' },
        'stocks/combined': { label: '', icon: 'table_chart' },
        'news': { label: 'Market News', icon: 'newspaper' },
        'calendar': { label: 'Market Calendar', icon: 'event' },
        'activity': { label: 'Activity', icon: 'history' },
        'market': { label: 'Market', icon: 'candlestick_chart' },
        'metrics': { label: 'Metrics', icon: 'analytics' },
        'watchlist': { label: 'Watchlist', icon: 'bookmark' },
        'dividends/combined': { label: '', icon: 'payments' },
        'dividends/1': { label: '', icon: 'payments' },
        'dividends/2': { label: '', icon: 'payments' },
    };

    if (route === 'home') {
        if (iconEl) iconEl.style.display = 'none';
        if (subtitleEl) {
            subtitleEl.style.display = '';
            subtitleEl.textContent = _formatTopbarDate() + ' \u00B7 Portfolio overview';
        }
        if (greetEl) {
            const h = new Date().getHours();
            const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
            const name = (typeof PORTFOLIO_NAMES !== 'undefined' && PORTFOLIO_NAMES['1']) || 'there';
            greetEl.textContent = greet + ', ' + name + ' \uD83D\uDC4B';
        }
    } else if (route.startsWith('portfolio/') || route.startsWith('stocks/') || route.startsWith('dividends/')) {
        const pSection = sectionMap[route];
        if (greetEl && pSection) greetEl.textContent = pSection.label;
        if (iconEl) iconEl.style.display = 'none';
        if (subtitleEl) subtitleEl.style.display = 'none';
    } else {
        const section = sectionMap[route] || { label: route, icon: 'chevron_right' };
        if (greetEl) greetEl.textContent = section.label;
        if (iconEl) {
            iconEl.textContent = section.icon;
            iconEl.style.display = '';
        }
        if (subtitleEl) {
            subtitleEl.textContent = _formatTopbarDate();
            subtitleEl.style.display = '';
        }
    }

    // Hide breadcrumb value when not on portfolio view
    const bcv = document.getElementById('breadcrumbValue');
    if (bcv && !route.startsWith('portfolio/')) {
        bcv.style.display = 'none';
        bcv.textContent = '';
    }
}

/* ── Pid switcher ────────────────────────────────────────────────────────── */
function _updatePidSwitcher(route) {
    const switcher = document.getElementById('pidSwitcher');
    const btnCombined = document.getElementById('pidBtnCombined');
    if (!switcher) return;

    // Show on portfolio/stocks/dividends routes
    const isRelevant = route.startsWith('portfolio/') || route.startsWith('stocks/') || route.startsWith('dividends/');
    switcher.style.display = isRelevant ? 'flex' : 'none';

    document.querySelectorAll('.pid-btn').forEach(b => b.classList.remove('active'));

    if (isRelevant) {
        const pid = route.split('/')[1];
        const activeBtn = document.getElementById(
            pid === 'combined' ? 'pidBtnCombined' :
                pid === '1' ? 'pidBtn1' : 'pidBtn2'
        );
        if (activeBtn) activeBtn.classList.add('active');
    }
}

/* Switch pid — stays in same view type, defaults to portfolio from other routes */
function switchPid(pid) {
    const route = _currentRoute || '';
    const viewType = route.startsWith('stocks/') ? 'stocks'
        : route.startsWith('dividends/') ? 'dividends'
            : 'portfolio';
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
    } else if (view === 'calendar') {
        btn.onclick = () => loadCalendarView(true);
    } else if (view === 'activity') {
        btn.onclick = () => loadActivityView(true);
    } else if (view === 'market') {
        btn.onclick = () => loadMarketView(true);
    } else if (view === 'metrics') {
        btn.onclick = () => loadMetricsView(true);
    } else if (view === 'watchlist') {
        btn.onclick = () => loadWatchlistView();
    } else if (view === 'dividends') {
        btn.onclick = () => loadDividendsView(true, window.DIVIDENDS_PID || 'combined');
    } else if (view === 'ai-intelligence') {
        // AI view has its own refresh buttons per section
        btn.style.display = 'none';
    }

}

/* ── Sidebar active state ────────────────────────────────────────────────── */
function _updateSidebarActive(route) {
    document.querySelectorAll('.nav-item[data-route], .nav-group-header[data-route]').forEach(el => {
        el.classList.remove('active');
    });

    // Exact match first; dividends sub-routes all highlight the dividends/combined nav item
    const navRoute = route.startsWith('dividends/') ? 'dividends/combined' : route;
    const exact = document.querySelector(`.nav-item[data-route="${navRoute}"]`);
    if (exact) exact.classList.add('active');

    // Highlight group header when a sub-route is active
    if (route.startsWith('portfolio/')) {
        const header = document.querySelector('#navGroupPortfolio .nav-group-header');
        if (header) header.classList.add('active');
    }
    if (route.startsWith('stocks/')) {
        const header = document.querySelector('#navGroupStocks .nav-group-header');
        if (header) header.classList.add('active');
    }
}

function _updateMobileNav(route) {
    document.querySelectorAll('.mob-nav-item[data-mob-route]').forEach(el => {
        el.classList.remove('active');
    });
    let mobRoute = 'home';
    if (route === 'home') mobRoute = 'home';
    else if (route.startsWith('portfolio/') || route.startsWith('stocks/')) mobRoute = 'portfolio';
    else if (route === 'market') mobRoute = 'market';
    else if (route === 'watchlist') mobRoute = 'watchlist';
    const el = document.querySelector(`.mob-nav-item[data-mob-route="${mobRoute}"]`);
    if (el) el.classList.add('active');
}

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ── Sidebar collapse ────────────────────────────────────────────────────── */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('sidebarScrim');
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
    if (prev === 'home') _deactivateHomeView();
    else if (prev?.startsWith('portfolio/')) _deactivateDetailView();
    else if (prev === 'market') _deactivateMarketView();
    else if (prev === 'metrics') _deactivateMetricsView();
    else if (prev === 'news') _stopNewsTimers();

    // Update shared UI
    _updateBreadcrumb(hash);
    _updateSidebarActive(hash);
    _updateMobileNav(hash);
    _updatePidSwitcher(hash);

    // Close mobile sidebar on navigation
    const sidebar = document.getElementById('sidebar');
    const scrim = document.getElementById('sidebarScrim');
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
        const pid = hash.split('/')[1] || 'combined';
        _showView('portfolio');
        _updateRefreshBtn('portfolio');
        document.title = _portfolioTitle(pid) + ' — Portfolio Tracker';
        window.PORTFOLIO_ID = pid;

        if (!_detailInitialized || _detailActivePid !== pid) {
            _detailActivePid = pid;
            _detailInitialized = true;
            _resetDetailView();
            if (typeof loadPortfolio === 'function') loadPortfolio(false);
        }
        _activateDetailView();

        /* ── Stocks ── */
    } else if (hash.startsWith('stocks/')) {
        const pid = hash.split('/')[1] || 'combined';
        _showView('stocks');
        _updateRefreshBtn('stocks');
        document.title = _portfolioTitle(pid) + ' · Stocks — Portfolio Tracker';
        window.PORTFOLIO_ID = pid;

        if (!_stocksInitialized || _stocksActivePid !== pid) {
            _stocksActivePid = pid;
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
            _newsInitialized = true;
            if (typeof loadNewsView === 'function') loadNewsView();
        } else {
            // Re-entering: silently check for new items (social refresh)
            if (typeof loadNewsView === 'function') loadNewsView(false);
        }
        _startNewsTimers();

        /* ── Calendar ── */
    } else if (hash === 'calendar') {
        _showView('calendar');
        _updateRefreshBtn('calendar');
        document.title = 'Market Calendar — Portfolio Tracker';
        if (!_calendarInitialized) {
            if (typeof loadCalendarView === 'function') loadCalendarView();
            _calendarInitialized = true;
        }

        /* ── Activity ── */
    } else if (hash === 'activity') {
        _showView('activity');
        _updateRefreshBtn('activity');
        document.title = 'Activity & History — Portfolio Tracker';
        if (!_activityInitialized) {
            if (typeof loadActivityView === 'function') loadActivityView();
            _activityInitialized = true;
        }

        /* ── Market ── */
    } else if (hash === 'market') {
        _showView('market');
        _updateRefreshBtn('market');
        document.title = 'Market — Portfolio Tracker';
        if (!_marketInitialized) {
            _initMarketView();
            _marketInitialized = true;
        } else {
            _activateMarketView();
        }

        /* ── Metrics ── */
    } else if (hash === 'metrics') {
        _showView('metrics');
        _updateRefreshBtn('metrics');
        document.title = 'Metrics — Portfolio Tracker';
        if (!_metricsInitialized) {
            _initMetricsView();
            _metricsInitialized = true;
        } else {
            _activateMetricsView();
        }

        /* ── Watchlist ── */
    } else if (hash === 'watchlist') {
        _showView('watchlist');
        _updateRefreshBtn('watchlist');
        document.title = 'Watchlist — Portfolio Tracker';
        if (!_watchlistInitialized) {
            if (typeof loadWatchlistView === 'function') loadWatchlistView();
            _watchlistInitialized = true;
        }

        /* ── Dividends ── */
    } else if (hash.startsWith('dividends/')) {
        const dvPid = hash.split('/')[1] || 'combined';
        _showView('dividends');
        _updateRefreshBtn('dividends');
        document.title = 'Dividends & Income — Portfolio Tracker';
        window.DIVIDENDS_PID = dvPid;
        if (!_dividendsInitialized || window._dividendsActivePid !== dvPid) {
            window._dividendsActivePid = dvPid;
            _dividendsInitialized = true;
            if (typeof loadDividendsView === 'function') loadDividendsView(false, dvPid);
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
    if (typeof initRefreshClocks === 'function') initRefreshClocks();
    if (typeof loadHomeData === 'function') loadHomeData();
    if (typeof loadSparklines === 'function') loadSparklines();
    if (typeof loadFearGreed === 'function') loadFearGreed();
    if (typeof loadMarketIndicators === 'function') loadMarketIndicators();
    if (typeof loadMarketStatus === 'function') loadMarketStatus();
    if (typeof loadStockTicker === 'function') loadStockTicker();
    if (typeof loadMarketDigest === 'function') loadMarketDigest();
    if (typeof initHeatmapResizeObserver === 'function') initHeatmapResizeObserver();
    _startHomeTimers();
}

function _activateHomeView() {
    if (typeof loadStockTicker === 'function') loadStockTicker();
    if (typeof loadFearGreed === 'function') loadFearGreed();
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
    if (typeof loadStockTicker === 'function') {
        _homeTimers.heatmap = setInterval(loadStockTicker, 5000);
        _homeTimers.hmScan = setInterval(() => {
            const c = document.querySelector('.heatmap-container');
            if (!c) return;
            c.classList.remove('hm-scanning');
            void c.offsetWidth;
            c.classList.add('hm-scanning');
            setTimeout(() => c.classList.remove('hm-scanning'), 900);
        }, 2000);
    }
    if (typeof loadMarketDigest === 'function')
        _homeTimers.digest = setInterval(() => loadMarketDigest(null, false), 300000);
}

function _stopHomeTimers() {
    Object.keys(_homeTimers).forEach(k => {
        if (_homeTimers[k]) { clearInterval(_homeTimers[k]); _homeTimers[k] = null; }
    });
}

/* ── News view lifecycle ─────────────────────────────────────────────────── */
function _startNewsTimers() {
    _stopNewsTimers();
    if (typeof loadNewsView === 'function')
        _newsTimers.autoRefresh = setInterval(() => loadNewsView(false), 300000); // 5 min
}

function _stopNewsTimers() {
    Object.keys(_newsTimers).forEach(k => {
        if (_newsTimers[k]) { clearInterval(_newsTimers[k]); _newsTimers[k] = null; }
    });
}

/* ── Market view lifecycle ───────────────────────────────────────────────── */
function _initMarketView() {
    if (typeof initFinvizTabs === 'function') initFinvizTabs();
    if (typeof loadMarketView === 'function') loadMarketView();
    _startMarketTimers();
}

function _activateMarketView() {
    if (typeof loadSP500Heatmap === 'function') loadSP500Heatmap();
    if (typeof loadMarketSignals === 'function') loadMarketSignals(_activeSignal);
    _startMarketTimers();
}

function _deactivateMarketView() { _stopMarketTimers(); }

function _startMarketTimers() {
    _stopMarketTimers();
    if (typeof loadSP500Heatmap === 'function')
        _marketTimers.sp500 = setInterval(loadSP500Heatmap, 300000);
    if (typeof loadMarketSignals === 'function')
        _marketTimers.signals = setInterval(() => {
            if (typeof _signalsData !== 'undefined') _signalsData = {};
            loadMarketSignals(typeof _activeSignal !== 'undefined' ? _activeSignal : 'gainers');
        }, 300000);
}

function _stopMarketTimers() {
    Object.keys(_marketTimers).forEach(k => {
        if (_marketTimers[k]) { clearInterval(_marketTimers[k]); _marketTimers[k] = null; }
    });
}

/* ── Metrics view lifecycle ──────────────────────────────────────────────── */
function _initMetricsView() {
    if (typeof loadMetricsView === 'function') loadMetricsView();
}

function _activateMetricsView() {
    if (typeof loadMetricsView === 'function') loadMetricsView();
}

function _deactivateMetricsView() { }

/* ── Detail view lifecycle ───────────────────────────────────────────────── */
function _resetDetailView() {
    const dash = document.getElementById('dashboard');
    const loading = document.getElementById('stateLoading');
    const search = document.getElementById('searchInput');
    if (dash) dash.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (search) search.value = '';
}

function _resetStocksView() {
    const wrap = document.getElementById('stocksTableWrapper');
    const loading = document.getElementById('stocksStateLoading');
    const tbody = document.getElementById('tableBody');
    if (wrap) wrap.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (tbody) tbody.innerHTML = '';
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
    // 15s refresh for holdings sparklines (Trend column)
    if (typeof _loadStockSparklines === 'function' && !_homeTimers.sparklines) {
        _homeTimers.sparklines = setInterval(() => {
            if (typeof allRows !== 'undefined' && allRows.length > 0) {
                _loadStockSparklines(allRows, true);
            }
        }, 15000);
    }
}

function _deactivateDetailView() {
    if (_homeTimers.mkt) { clearInterval(_homeTimers.mkt); _homeTimers.mkt = null; }
    if (_homeTimers.mktTick) { clearInterval(_homeTimers.mktTick); _homeTimers.mktTick = null; }
    if (_homeTimers.sparklines) { clearInterval(_homeTimers.sparklines); _homeTimers.sparklines = null; }
}

/* ── Bootstrap ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    // Theme initialization
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    _updateThemeIcon(savedTheme);
    if (typeof _syncMobileTheme === 'function') _syncMobileTheme();

    if (typeof applyCurrency === 'function') applyCurrency();

    _restoreSidebar();
    _router();
    // Seed notification badge count on load
    setTimeout(() => { if (typeof loadNotifications === 'function') loadNotifications(); }, 500);
});

/* ── Theme & Glass Toggles ───────────────────────────────────────────────── */
function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') !== 'light';
    const newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    _updateThemeIcon(newTheme);
    // Sync mobile theme label
    if (typeof _syncMobileTheme === 'function') _syncMobileTheme();
    // Redraw theme-aware canvas charts
    if (typeof _drawSectorRadialChart === 'function') _drawSectorRadialChart();
}


function _updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (!icon) return;
    icon.textContent = theme === 'light' ? 'dark_mode' : 'light_mode';
}

window.addEventListener('hashchange', _router);

function toggleNavGroup(groupId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const group = document.getElementById(groupId);
    if (!group) return;
    group.classList.toggle('open');
}

/* ── Mobile bottom sheet ─────────────────────────────────────────────────── */
function openMobileSheet() {
    const sheet = document.getElementById('mobSheet');
    const overlay = document.getElementById('mobSheetOverlay');
    if (!sheet || !overlay) return;
    overlay.classList.add('active');
    sheet.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeMobileSheet() {
    const sheet = document.getElementById('mobSheet');
    const overlay = document.getElementById('mobSheetOverlay');
    if (!sheet || !overlay) return;
    overlay.classList.remove('active');
    sheet.classList.remove('active');
    document.body.style.overflow = '';
}

// Public exports
window.navigate = navigate;
window.toggleSidebar = toggleSidebar;
window.toggleNavGroup = toggleNavGroup;
window.switchPid = switchPid;
window.toggleTheme = toggleTheme;
window.openMobileSheet = openMobileSheet;
window.closeMobileSheet = closeMobileSheet;
