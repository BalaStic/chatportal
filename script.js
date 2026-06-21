// ===== CHATPORTAL — STEEL PROTOCOL =====
// Core state
let conversationHistory = [];
let msgCounter = 0;
let isProcessing = false;

const MODELS = {
    gemini: 'gemini-3.1-pro-preview',
    deepseek: 'deepseek-v4-pro'
};

// ===== DOM REFS =====
const chatFeed = document.getElementById('chat-feed');
const historyDiv = document.getElementById('history');
const chatInput = document.getElementById('userInput');
const sendBtn = document.getElementById('send-btn');
const mainContainer = document.getElementById('main-container');
const settingsPanel = document.getElementById('settings-panel');
const statusIndicator = document.getElementById('status-indicator');
const apiKeyLabel = document.getElementById('api-key-label');
const apiKeyInput = document.getElementById('apiKey');
const modelInput = document.getElementById('model');

// ===== PROVIDER MANAGEMENT =====
function getProvider() {
    return document.querySelector('input[name="provider"]:checked').value;
}

function onProviderChange() {
    const provider = getProvider();
    modelInput.value = MODELS[provider];
    if (provider === 'gemini') {
        apiKeyLabel.textContent = 'Gemini API Key';
        apiKeyInput.placeholder = 'AIzaSy...';
    } else {
        apiKeyLabel.textContent = 'DeepSeek API Key';
        apiKeyInput.placeholder = 'sk-...';
    }
    // Auto-switch API key from stored keys
    if (typeof window.API_KEYS !== 'undefined' && window.API_KEYS[provider] && window.API_KEYS[provider] !== '') {
        apiKeyInput.value = window.API_KEYS[provider];
    } else {
        apiKeyInput.value = '';
    }
    // Clear history on provider switch
    conversationHistory = [];
    historyDiv.innerHTML = '';
    appendSystemMessage('Provider switched to ' + provider.toUpperCase() + '. Session cleared.');
}

// ===== SETTINGS TOGGLE =====
function toggleSettings() {
    settingsPanel.classList.toggle('open');
}

// ===== MESSAGE RENDERING =====
function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'flex justify-center my-4 msg-enter';
    div.innerHTML = `
        <div class="px-4 py-1 border border-outline/20 bg-surface-container-low">
            <span class="font-mono text-label-xs text-on-surface-variant uppercase tracking-wider">${text}</span>
        </div>
    `;
    historyDiv.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
}

function appendMessage(sender, text, role) {
    const isUser = role === 'user';
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ':');

    const div = document.createElement('div');
    div.className = `message-group flex flex-col ${isUser ? 'items-end self-end ml-auto' : 'items-start'} max-w-[90%] md:max-w-[75%] msg-enter mb-6`;

    const senderName = isUser ? 'USER_01' : (sender || 'AI');
    const senderClass = isUser ? 'text-secondary' : 'text-primary';

    div.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
            ${!isUser ? `<div class="w-6 h-6 border border-primary/30 flex items-center justify-center bg-white">
                <span class="material-symbols-outlined text-primary text-[16px]" style="font-variation-settings: 'FILL' 1;">smart_toy</span>
            </div>` : ''}
            <span class="font-mono text-label-xs ${senderClass} uppercase">${senderName}</span>
            <span class="font-mono text-label-xs text-on-surface-variant">${date} ${time}</span>
            <button class="copy-btn ml-2 text-on-surface-variant hover:text-primary transition-colors" onclick="copyMessage(this)" title="Copy">
                <span class="material-symbols-outlined text-[16px]">content_copy</span>
            </button>
        </div>
        <div class="${isUser ? 'bg-surface-container border border-outline/30 text-on-surface p-4' : 'relative bg-white border-l-4 border-primary p-4 border-y border-r border-outline-variant/10'}">
            <div class="msg-content font-sans text-body-md leading-relaxed whitespace-pre-wrap ${isUser ? '' : ''}">${text}</div>
        </div>
    `;

    historyDiv.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
    return div;
}

function updateMessage(messageDiv, text) {
    const contentDiv = messageDiv.querySelector('.msg-content');
    if (contentDiv) {
        contentDiv.innerHTML = marked.parse(text);
    }
    messageDiv.scrollIntoView({ behavior: 'smooth' });
}

function copyMessage(btn) {
    const msgGroup = btn.closest('.message-group');
    const contentDiv = msgGroup.querySelector('.msg-content');
    const html = contentDiv ? contentDiv.innerHTML : '';
    const text = contentDiv ? contentDiv.textContent : '';

    const done = () => {
        const icon = btn.querySelector('.material-symbols-outlined');
        icon.textContent = 'check';
        setTimeout(() => { icon.textContent = 'content_copy'; }, 2000);
    };

    try {
        const clipboardItem = new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
        });
        navigator.clipboard.write([clipboardItem]).then(done);
    } catch (e) {
        navigator.clipboard.writeText(text).then(done);
    }
}

// ===== SEND MESSAGE =====
async function sendMessage() {
    const model = modelInput.value.trim();
    const userText = chatInput.value.trim();
    const provider = getProvider();

    if (!model) { appendSystemMessage('ERROR: Model cannot be empty.'); return; }
    if (!userText) return;
    if (isProcessing) return;

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        appendSystemMessage('ERROR: API key is required.');
        return;
    }

    isProcessing = true;
    statusIndicator.textContent = 'Processing...';
    sendBtn.disabled = true;

    // Append user message
    appendMessage('USER_01', userText, 'user');
    conversationHistory.push({ role: 'user', content: userText });
    chatInput.value = '';

    // Create AI message placeholder
    const aiName = provider === 'gemini' ? 'Gemini AI' : 'DeepSeek AI';
    const aiMsgDiv = appendMessage(aiName, 'Processing...', 'assistant');

    try {
        if (provider === 'gemini') {
            await sendGemini(aiMsgDiv, model, apiKey);
        } else {
            await sendDeepSeek(aiMsgDiv, model, apiKey);
        }
    } catch (error) {
        updateMessage(aiMsgDiv, `**Network Error:** ${error.message}`);
    } finally {
        isProcessing = false;
        statusIndicator.textContent = 'Ready';
        sendBtn.disabled = false;
    }
}

async function sendGemini(messageDiv, model, apiKey) {
    const geminiContents = conversationHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: geminiContents })
    });

    const data = await response.json();

    if (response.ok) {
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            const aiText = data.candidates[0].content.parts[0].text;
            conversationHistory.push({ role: 'assistant', content: aiText });
            updateMessage(messageDiv, aiText);
        } else {
            updateMessage(messageDiv, '**Error:** API responded but no text was returned. Check your account limits.');
        }
    } else {
        const errorMsg = data.error?.message || 'Unknown error from Google server.';
        updateMessage(messageDiv, `**Google API Error:** ${errorMsg}`);
    }
}

async function sendDeepSeek(messageDiv, model, apiKey) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: conversationHistory
        })
    });

    const data = await response.json();

    if (response.ok) {
        if (data.choices?.[0]?.message?.content) {
            const aiText = data.choices[0].message.content;
            conversationHistory.push({ role: 'assistant', content: aiText });
            updateMessage(messageDiv, aiText);
        } else {
            updateMessage(messageDiv, '**Error:** API responded but no text was returned.');
        }
    } else {
        const errorMsg = data.error?.message || 'Unknown error from DeepSeek server.';
        updateMessage(messageDiv, `**DeepSeek API Error:** ${errorMsg}`);
    }
}

// ===== QUICK MESSAGES =====
function sendQuickMessage(text) {
    if (isProcessing) return;
    chatInput.value = text;
    sendMessage();
}

// ===== CLEAR CHAT =====
function clearChat() {
    conversationHistory = [];
    historyDiv.innerHTML = '';
    appendSystemMessage('Session log cleared.');
}

// ===== GLITCH EFFECT =====
function triggerGlitch() {
    mainContainer.classList.add('glitch-active');
    setTimeout(() => {
        mainContainer.classList.remove('glitch-active');
    }, 2000);
}

// ===== EVENT LISTENERS =====
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});

// ===== INIT =====
function isValidKey(key, prefix) {
    if (!key || key === '') return false;
    // Filter out placeholder example values
    if (key === 'AIzaSy...' || key === 'sk-...') return false;
    // Must start with expected prefix
    if (prefix && !key.startsWith(prefix)) return false;
    return true;
}

function setProviderUI(provider) {
    if (provider === 'gemini') {
        document.getElementById('prov-gemini').checked = true;
        apiKeyLabel.textContent = 'Gemini API Key';
        apiKeyInput.placeholder = 'AIzaSy...';
    } else {
        document.getElementById('prov-deepseek').checked = true;
        apiKeyLabel.textContent = 'DeepSeek API Key';
        apiKeyInput.placeholder = 'sk-...';
    }
    modelInput.value = MODELS[provider];
}

function loadApiKeys() {
    if (typeof window.API_KEYS === 'undefined') return;

    const geminiKey = isValidKey(window.API_KEYS.gemini, 'A') ? window.API_KEYS.gemini : null;
    const deepseekKey = isValidKey(window.API_KEYS.deepseek, 'sk-') ? window.API_KEYS.deepseek : null;

    // Both keys present — use the currently selected provider
    if (geminiKey && deepseekKey) {
        const currentProvider = getProvider();
        setProviderUI(currentProvider);
        apiKeyInput.value = window.API_KEYS[currentProvider];
    } else if (geminiKey) {
        setProviderUI('gemini');
        apiKeyInput.value = geminiKey;
    } else if (deepseekKey) {
        setProviderUI('deepseek');
        apiKeyInput.value = deepseekKey;
    }
}

setTimeout(() => {
    try {
        loadApiKeys();
    } catch (e) {
        console.warn('API keys file not loaded (likely online/GitHub Pages). Enter keys manually.');
    }
    appendSystemMessage('Steel Protocol initialized. Terminal ready.');
    console.log("%cCHATPORTAL — STEEL PROTOCOL ACTIVE", "color: #555d62; font-weight: bold; font-size: 20px; font-family: monospace;");
}, 500);
