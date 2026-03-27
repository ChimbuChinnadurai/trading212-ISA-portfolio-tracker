/**
 * ai_intelligence.js — Logic for the Gemini AI Intelligence page.
 */

let aiChatHistory = [];

function initAiView() {
    loadAiDigest();
    loadAiSignals();
}

/**
 * Load and render the AI Market Digest.
 */
async function loadAiDigest(force = false) {
    const container = document.getElementById('aiDigestContent');
    const btn = document.getElementById('aiRefreshDigest');
    
    if (btn) btn.classList.add('rotating');
    container.innerHTML = '<div class="ai-loading">Generating summary via Gemini...</div>';

    try {
        const url = force ? '/api/ai/market-digest?refresh=1' : '/api/ai/market-digest';
        const resp = await fetch(url);
        const json = await resp.json();

        if (json.status === 'ok') {
            container.innerHTML = formatAiContent(json.digest);
        } else {
            container.innerHTML = `<div class="ai-error">Error: ${json.message}</div>`;
        }
    } catch (err) {
        console.error('AI Digest failed:', err);
        container.innerHTML = '<div class="ai-error">Failed to load market digest.</div>';
    } finally {
        if (btn) btn.classList.remove('rotating');
    }
}

/**
 * Load and render the AI Trade Signals.
 */
async function loadAiSignals(force = false) {
    const container = document.getElementById('aiSignalsContent');
    const btn = document.getElementById('aiRefreshSignals');

    if (btn) btn.classList.add('rotating');
    container.innerHTML = '<div class="ai-loading">Analyzing portfolio with Gemini...</div>';

    try {
        const url = force ? '/api/ai/trade-signals?refresh=1' : '/api/ai/trade-signals';
        const resp = await fetch(url);
        const json = await resp.json();

        if (json.status === 'ok') {
            container.innerHTML = formatAiContent(json.signals);
        } else {
            container.innerHTML = `<div class="ai-error">Error: ${json.message}</div>`;
        }
    } catch (err) {
        console.error('AI Signals failed:', err);
        container.innerHTML = '<div class="ai-error">Failed to load trade signals.</div>';
    } finally {
        if (btn) btn.classList.remove('rotating');
    }
}

/**
 * Send a message to the AI Chat.
 */
async function sendAiChatMessage() {
    const input = document.getElementById('aiChatInput');
    const chatContent = document.getElementById('aiChatContent');
    const msg = input.value.trim();

    if (!msg) return;

    // Add user message to UI
    appendAiMessage('user', msg);
    input.value = '';

    // Add loading message
    const loadingId = 'ai-loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className = 'ai-msg ai-msg-bot ai-loading-msg';
    loadingDiv.textContent = 'Thinking...';
    chatContent.appendChild(loadingDiv);
    chatContent.scrollTop = chatContent.scrollHeight;

    try {
        const resp = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, history: aiChatHistory })
        });
        const json = await resp.json();

        // Remove loading
        const ld = document.getElementById(loadingId);
        if (ld) ld.remove();

        if (json.status === 'ok') {
            appendAiMessage('bot', json.response);
            // Update history
            aiChatHistory.push({ role: 'user', parts: [msg] });
            aiChatHistory.push({ role: 'model', parts: [json.response] });
            // Keep history reasonable
            if (aiChatHistory.length > 20) aiChatHistory = aiChatHistory.slice(-20);
        } else {
            appendAiMessage('bot', 'Sorry, I encountered an error: ' + json.message);
        }
    } catch (err) {
        console.error('AI Chat failed:', err);
        const ld = document.getElementById(loadingId);
        if (ld) ld.remove();
        appendAiMessage('bot', 'Network error. Please try again.');
    }
}

function appendAiMessage(role, text) {
    const chatContent = document.getElementById('aiChatContent');
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${role}`;
    div.innerHTML = formatAiContent(text);
    chatContent.appendChild(div);
    chatContent.scrollTop = chatContent.scrollHeight;
}

/**
 * Very basic markdown-ish to HTML formatter.
 * Handles bold (**text**), bullet points (- ), and newlines.
 */
function formatAiContent(text) {
    if (!text) return '';
    
    // Escape HTML to prevent XSS
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Lines starting with - or * become list items
    const lines = html.split('\n');
    let inList = false;
    let newHtml = '';

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('- ') || line.startsWith('* ')) {
            if (!inList) {
                newHtml += '<ul>';
                inList = true;
            }
            newHtml += `<li>${line.substring(2)}</li>`;
        } else {
            if (inList) {
                newHtml += '</ul>';
                inList = false;
            }
            if (line) {
                newHtml += `<p>${line}</p>`;
            }
        }
    }
    if (inList) newHtml += '</ul>';

    return newHtml;
}

// Add animation style for refresh button
const style = document.createElement('style');
style.textContent = `
    @keyframes ai-rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .rotating {
        animation: ai-rotate 1s linear infinite;
        color: var(--accent) !important;
        pointer-events: none;
    }
    .ai-error {
        color: var(--red);
        padding: 10px;
        border: 1px solid var(--red-glow);
        border-radius: 4px;
        background: var(--red-glow);
    }
    .ai-loading-msg {
        opacity: 0.6;
        font-style: italic;
    }
`;
document.head.appendChild(style);
