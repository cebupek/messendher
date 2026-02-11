// Application State
let currentUser = null;
let ws = null;
let currentChat = null;
let chats = [];
let onlineUsers = [];
let peerConnections = new Map();
let localStream = null;
let inCall = false;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initSearchDB();
    syncSearchDBWithUsers();
    loadTheme();
    loadUserSession();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch(err => console.error('SW registration failed:', err));
    }
});

// ============ AUTHENTICATION ============

// Search Database Functions
function initSearchDB() {
    // Initialize search database if not exists
    if (!localStorage.getItem('usernames_db')) {
        localStorage.setItem('usernames_db', JSON.stringify([]));
    }
}

function addUsernameToSearchDB(username) {
    const db = JSON.parse(localStorage.getItem('usernames_db') || '[]');
    if (!db.includes(username)) {
        db.push(username);
        localStorage.setItem('usernames_db', JSON.stringify(db));
        console.log('Логин добавлен в базу поиска:', username);
    }
}

async function searchUsernameInDB(query) {
    console.log('🔍 Поиск пользователя на сервере:', query);
    
    try {
        const response = await fetch(`/api/users/search/${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.found) {
            console.log('✅ Пользователь найден на сервере:', data.user.username);
            return data.user.username;
        } else {
            console.log('❌ Пользователь не найден на сервере:', query);
            return null;
        }
    } catch (error) {
        console.error('❌ Ошибка поиска на сервере:', error);
        
        // Fallback to local database if server is unavailable
        console.log('⚠️ Используем локальную базу данных');
        const db = JSON.parse(localStorage.getItem('usernames_db') || '[]');
        const found = db.find(username => 
            username.toLowerCase() === query.toLowerCase()
        );
        
        return found || null;
    }
}

function syncSearchDBWithUsers() {
    // Sync search database with existing users (for backward compatibility)
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const db = JSON.parse(localStorage.getItem('usernames_db') || '[]');
    
    let updated = false;
    Object.keys(users).forEach(username => {
        if (!db.includes(username)) {
            db.push(username);
            updated = true;
        }
    });
    
    if (updated) {
        localStorage.setItem('usernames_db', JSON.stringify(db));
        console.log('База данных логинов синхронизирована:', db);
    }
}

function showLogin() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
}

function showRegister() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
}

function register() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const hint = document.getElementById('regHint').value.trim();

    if (!username || !password) {
        alert('Заполните все поля');
        return;
    }

    const users = JSON.parse(localStorage.getItem('users') || '{}');
    
    if (users[username]) {
        alert('Пользователь уже существует');
        return;
    }
    
    // Add username to local search DB
    addUsernameToSearchDB(username);
    console.log('Регистрация: логин добавлен в локальную базу:', username);

    // Generate encryption keys
    generateKeyPair().then(async keys => {
        users[username] = {
            password: hashPassword(password),
            hint: hint,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
            avatar: null,
            createdAt: Date.now()
        };

        localStorage.setItem('users', JSON.stringify(users));
        
        // Register user on server
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    username: username,
                    publicKey: keys.publicKey
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                console.log('✅ Пользователь зарегистрирован на сервере:', username);
                alert('✅ Регистрация успешна! Теперь вы можете войти.');
            } else {
                console.error('❌ Ошибка регистрации на сервере:', data.error);
                alert('⚠️ Регистрация выполнена локально, но возникла проблема с сервером. Вы можете войти в систему.');
            }
        } catch (error) {
            console.error('❌ Ошибка подключения к серверу:', error);
            alert('⚠️ Регистрация выполнена локально, но нет подключения к серверу. Вы можете войти в систему.');
        }
        
        showLogin();
    });
}

function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('Заполните все поля');
        return;
    }

    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const user = users[username];

    if (!user || user.password !== hashPassword(password)) {
        alert('Неверный логин или пароль');
        return;
    }

    currentUser = {
        username: username,
        ...user
    };

    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    startApp();
}

function logout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        if (ws) ws.close();
        localStorage.removeItem('currentUser');
        location.reload();
    }
}

function loadUserSession() {
    const saved = localStorage.getItem('currentUser');
    if (saved) {
        currentUser = JSON.parse(saved);
        startApp();
    }
}

function hashPassword(password) {
    // Simple hash for demo - in production use proper hashing
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// ============ APP INITIALIZATION ============

function startApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    
    document.getElementById('currentUsername').textContent = currentUser.username;
    
    // Update user avatar
    updateUserAvatar();
    
    loadChats();
    connectWebSocket();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        ws.send(JSON.stringify({
            type: 'register',
            userId: currentUser.username
        }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'online_users':
            onlineUsers = data.users;
            updateOnlineStatus();
            break;
        case 'message':
            if (data.notification && data.notification.type === 'chat_invite') {
                handleChatInvite(data.notification);
            } else {
                receiveMessage(data);
            }
            break;
        case 'signal':
            handleSignal(data);
            break;
        case 'broadcast':
            receiveBroadcastMessage(data);
            break;
    }
}

// ============ ENCRYPTION ============

async function generateKeyPair() {
    // Generate RSA key pair for E2E encryption
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256"
        },
        true,
        ["encrypt", "decrypt"]
    );
    
    const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    
    return {
        publicKey: JSON.stringify(publicKey),
        privateKey: JSON.stringify(privateKey)
    };
}

async function encryptMessage(message, publicKeyJwk) {
    try {
        const publicKey = await crypto.subtle.importKey(
            "jwk",
            JSON.parse(publicKeyJwk),
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );
        
        const encoded = new TextEncoder().encode(message);
        const encrypted = await crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            publicKey,
            encoded
        );
        
        return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    } catch (error) {
        console.error('Encryption error:', error);
        return message; // Fallback to unencrypted
    }
}

async function decryptMessage(encryptedMessage, privateKeyJwk) {
    try {
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            JSON.parse(privateKeyJwk),
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
        
        const encrypted = Uint8Array.from(atob(encryptedMessage), c => c.charCodeAt(0));
        const decrypted = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            encrypted
        );
        
        return new TextDecoder().decode(decrypted);
    } catch (error) {
        console.error('Decryption error:', error);
        return encryptedMessage; // Fallback
    }
}

// ============ CHAT MANAGEMENT ============

function loadChats() {
    const savedChats = localStorage.getItem(`chats_${currentUser.username}`);
    chats = savedChats ? JSON.parse(savedChats) : [];
    renderChatsList();
}

function saveChats() {
    localStorage.setItem(`chats_${currentUser.username}`, JSON.stringify(chats));
}

function renderChatsList(searchQuery = '') {
    const container = document.getElementById('chatsList');
    container.innerHTML = '';
    
    let filteredChats = chats.filter(chat => !chat.hidden);
    
    // Apply search filter if query provided
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filteredChats = filteredChats.filter(chat => 
            chat.name.toLowerCase().includes(query) ||
            chat.participants?.some(p => p.toLowerCase().includes(query)) ||
            chat.members?.some(m => m.toLowerCase().includes(query))
        );
    }
    
    if (filteredChats.length === 0) {
        if (searchQuery.trim()) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">Чаты не найдены</p>';
        } else {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">Нет чатов</p>';
        }
        return;
    }
    
    filteredChats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item' + (currentChat?.id === chat.id ? ' active' : '');
        div.onclick = () => openChat(chat.id);
        
        const lastMessage = chat.messages?.[chat.messages.length - 1];
        const unreadCount = chat.messages?.filter(m => !m.read && m.sender !== currentUser.username).length || 0;
        
        // Create avatar element
        let avatarHtml = '';
        if (chat.avatar) {
            avatarHtml = `<div class="chat-avatar" style="background-image: url(${chat.avatar}); background-size: cover; background-position: center;"></div>`;
        } else {
            avatarHtml = `<div class="chat-avatar">${chat.name[0].toUpperCase()}</div>`;
        }
        
        div.innerHTML = `
            ${avatarHtml}
            <div class="chat-info">
                <h4>${chat.name}</h4>
                <p>${lastMessage ? (lastMessage.text?.substring(0, 30) || '📎 Файл') : 'Нет сообщений'}</p>
            </div>
            <div class="chat-meta">
                ${lastMessage ? `<span class="chat-time">${formatTime(lastMessage.timestamp)}</span>` : ''}
                ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
            </div>
        `;
        
        container.appendChild(div);
    });
}

function searchChats() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();
    renderChatsList(query);
}

function openChat(chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    currentChat = chat;
    
    // Mark messages as read
    chat.messages?.forEach(m => {
        if (m.sender !== currentUser.username) m.read = true;
    });
    saveChats();
    
    // Close mobile menu on mobile devices
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('mobileToggle');
        if (sidebar) {
            sidebar.classList.remove('active');
        }
        if (toggle) {
            toggle.textContent = '☰';
        }
    }
    
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    document.getElementById('chatName').textContent = chat.name;
    
    // Update chat avatar
    const chatAvatarElement = document.getElementById('chatAvatar');
    if (chat.avatar) {
        chatAvatarElement.style.backgroundImage = `url(${chat.avatar})`;
        chatAvatarElement.style.backgroundSize = 'cover';
        chatAvatarElement.style.backgroundPosition = 'center';
        chatAvatarElement.textContent = '';
    } else {
        chatAvatarElement.style.backgroundImage = 'none';
        chatAvatarElement.textContent = chat.name[0].toUpperCase();
    }
    
    // Update status
    let statusText = '';
    if (chat.type === 'private') {
        const isOnline = onlineUsers.includes(chat.participants[0]);
        statusText = isOnline ? 'В сети' : 'Не в сети';
    } else if (chat.type === 'group') {
        statusText = `${chat.participants.length} участников`;
    } else if (chat.type === 'channel') {
        statusText = `${chat.participants.length} подписчиков`;
    }
    document.getElementById('chatStatus').textContent = statusText;
    
    // Show/hide call buttons for private chats only
    const voiceCallBtn = document.getElementById('voiceCallBtn');
    const videoCallBtn = document.getElementById('videoCallBtn');
    if (voiceCallBtn && videoCallBtn) {
        voiceCallBtn.style.display = chat.type === 'private' ? 'flex' : 'none';
        videoCallBtn.style.display = chat.type === 'private' ? 'flex' : 'none';
    }
    
    renderMessages();
    renderChatsList();
}

// Helper functions for call initiation
function initiateVoiceCall() {
    if (!currentChat || currentChat.type !== 'private') {
        alert('Дзвінки доступні лише в приватних чатах');
        return;
    }
    const recipient = currentChat.participants[0];
    startVoiceCall(recipient);
}

function initiateVideoCall() {
    if (!currentChat || currentChat.type !== 'private') {
        alert('Дзвінки доступні лише в приватних чатах');
        return;
    }
    const recipient = currentChat.participants[0];
    startVideoCall(recipient);
}

function renderMessages() {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
    
    if (!currentChat.messages || currentChat.messages.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Нет сообщений</p>';
        return;
    }
    
    currentChat.messages.forEach(message => {
        const div = createMessageElement(message);
        container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
}

function createMessageElement(message) {
    const div = document.createElement('div');
    const isOwn = message.sender === currentUser.username;
    div.className = 'message' + (isOwn ? ' own' : '');
    div.dataset.messageId = message.id;
    
    let messageContent = `
        <div class="message-avatar">${message.sender[0].toUpperCase()}</div>
        <div class="message-content">
            ${!isOwn ? `<div class="message-header">
                <span class="message-sender">${message.sender}</span>
                <span class="message-time">${formatTime(message.timestamp)}</span>
            </div>` : ''}
            <div class="message-bubble">
                ${message.text ? `<div class="message-text">${escapeHtml(message.text)}</div>` : ''}
                ${message.file ? renderFileAttachment(message.file) : ''}
                ${message.voice ? renderVoiceMessage(message.voice) : ''}
                ${message.edited ? '<span style="font-size: 11px; color: var(--text-muted); margin-top: 4px; display: block;">изменено</span>' : ''}
            </div>
            ${renderMessageReactions(message)}
            ${renderMessageActions(message, isOwn)}
        </div>
    `;
    
    div.innerHTML = messageContent;
    return div;
}

function renderFileAttachment(file) {
    if (file.type.startsWith('image/')) {
        return `<div class="media-message"><img src="${file.data}" alt="${file.name}" onclick="viewMedia('${file.data}')"></div>`;
    } else if (file.type.startsWith('video/')) {
        return `<div class="media-message"><video src="${file.data}" controls></video></div>`;
    } else {
        const size = file.size ? `${(file.size / 1024).toFixed(1)} KB` : '';
        return `
            <div class="file-message">
                <div class="file-icon">📄</div>
                <div class="file-info">
                    <h5>${file.name}</h5>
                    <p>${size}</p>
                </div>
            </div>
        `;
    }
}

function renderVoiceMessage(voice) {
    const voiceId = 'voice_' + generateId();
    return `
        <div class="voice-message">
            <button class="voice-play-btn" onclick="playVoiceMessage('${voiceId}')">▶️</button>
            <audio id="${voiceId}" src="${voice.data}" preload="metadata"></audio>
            <span class="voice-duration" id="${voiceId}_duration">00:00</span>
        </div>
    `;
}

function playVoiceMessage(voiceId) {
    const audio = document.getElementById(voiceId);
    if (!audio) return;
    
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
}

function renderMessageReactions(message) {
    if (!message.reactions || message.reactions.length === 0) return '';
    
    const reactionsMap = {};
    message.reactions.forEach(r => {
        reactionsMap[r.emoji] = reactionsMap[r.emoji] || [];
        reactionsMap[r.emoji].push(r.user);
    });
    
    let html = '<div class="message-reactions">';
    Object.entries(reactionsMap).forEach(([emoji, users]) => {
        html += `
            <div class="reaction" onclick="toggleReaction('${message.id}', '${emoji}')">
                <span>${emoji}</span>
                <span class="reaction-count">${users.length}</span>
            </div>
        `;
    });
    html += '</div>';
    
    return html;
}

function renderMessageActions(message, isOwn) {
    const canEdit = isOwn || (currentChat.admins && currentChat.admins.includes(currentUser.username));
    const canDelete = canEdit;
    
    let html = '<div class="message-actions">';
    
    html += `<button class="message-action-btn" onclick="addReaction('${message.id}')">👍</button>`;
    
    if (canEdit && message.text) {
        html += `<button class="message-action-btn" onclick="editMessage('${message.id}')">✏️</button>`;
    }
    
    if (canDelete) {
        html += `<button class="message-action-btn" onclick="deleteMessage('${message.id}')">🗑️</button>`;
    }
    
    html += '</div>';
    
    return html;
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !currentChat) return;
    
    const message = {
        id: generateId(),
        sender: currentUser.username,
        text: text,
        timestamp: Date.now(),
        reactions: [],
        read: false
    };
    
    currentChat.messages = currentChat.messages || [];
    currentChat.messages.push(message);
    saveChats();
    
    // Send to other participants
    if (currentChat.type === 'private') {
        const recipient = currentChat.participants[0];
        sendEncryptedMessage(recipient, message);
    } else {
        broadcastToGroup(currentChat.id, message);
    }
    
    input.value = '';
    renderMessages();
    renderChatsList();
}

async function sendEncryptedMessage(recipient, message) {
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const recipientData = users[recipient];
    
    if (!recipientData || !ws) return;
    
    const encrypted = await encryptMessage(message.text, recipientData.publicKey);
    
    ws.send(JSON.stringify({
        type: 'message',
        to: recipient,
        from: currentUser.username,
        message: {
            ...message,
            text: encrypted,
            encrypted: true
        },
        chatId: currentChat.id
    }));
}

function broadcastToGroup(chatId, message) {
    if (!ws) return;
    
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    ws.send(JSON.stringify({
        type: 'broadcast',
        recipients: chat.participants,
        from: currentUser.username,
        chatId: chatId,
        chatName: chat.name,
        chatType: chat.type,
        allParticipants: [...chat.participants, currentUser.username], // Включаем всех участников включая отправителя
        message: message
    }));
}

async function receiveMessage(data) {
    let messageText = data.message.text;
    
    // Decrypt if encrypted
    if (data.message.encrypted && currentUser.privateKey) {
        messageText = await decryptMessage(messageText, currentUser.privateKey);
    }
    
    const message = {
        ...data.message,
        text: messageText,
        encrypted: false
    };
    
    // Find or create chat
    let chat = chats.find(c => c.id === data.chatId);
    
    if (!chat) {
        // Загрузить публичный ключ отправителя если его нет
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        if (!users[data.from] || !users[data.from].publicKey) {
            try {
                const response = await fetch(`/api/users/search/${encodeURIComponent(data.from)}`);
                const apiData = await response.json();
                
                if (apiData.found && apiData.user.publicKey) {
                    if (!users[data.from]) {
                        users[data.from] = {
                            publicKey: apiData.user.publicKey,
                            addedAt: Date.now()
                        };
                    } else {
                        users[data.from].publicKey = apiData.user.publicKey;
                    }
                    localStorage.setItem('users', JSON.stringify(users));
                    console.log('✅ Публичный ключ отправителя сохранен:', data.from);
                }
            } catch (error) {
                console.error('❌ Ошибка получения публичного ключа отправителя:', error);
            }
        }
        
        chat = {
            id: data.chatId || generateId(),
            name: data.from,
            type: 'private',
            participants: [data.from],
            messages: [],
            createdAt: Date.now()
        };
        chats.push(chat);
    }
    
    chat.messages = chat.messages || [];
    chat.messages.push(message);
    saveChats();
    
    if (currentChat?.id === chat.id) {
        renderMessages();
    }
    
    renderChatsList();
    
    // Show notification if not in focus
    if (document.hidden) {
        showNotification(`${data.from}: ${messageText}`);
    }
}

function receiveBroadcastMessage(data) {
    let chat = chats.find(c => c.id === data.chatId);
    
    // Если чата нет, создаем его автоматически
    if (!chat) {
        console.log('📨 Получено сообщение для несуществующего чата, создаю чат:', data.chatId);
        
        // Определяем имя чата
        let chatName = data.chatName || data.from;
        let chatType = data.chatType || 'group';
        
        chat = {
            id: data.chatId,
            name: chatName,
            type: chatType,
            participants: data.allParticipants || [data.from, currentUser.username],
            messages: [],
            createdAt: Date.now()
        };
        
        chats.unshift(chat);
        console.log('✅ Чат автоматически создан:', chat);
    }
    
    chat.messages = chat.messages || [];
    chat.messages.push(data.message);
    saveChats();
    
    if (currentChat?.id === chat.id) {
        renderMessages();
    }
    
    renderChatsList();
    
    // Show notification if not in focus
    if (document.hidden) {
        showNotification(`${data.from} в ${chat.name}: ${data.message.text}`);
    }
}

async function handleChatInvite(notification) {
    console.log('📨 Получено приглашение в чат:', notification);
    
    // Проверяем, есть ли уже такой чат
    let chat = chats.find(c => c.id === notification.chatId);
    
    if (!chat) {
        // Загружаем публичные ключи участников
        if (notification.participants && notification.participants.length > 0) {
            for (const username of notification.participants) {
                if (username !== currentUser.username) {
                    try {
                        const response = await fetch(`/api/users/search/${encodeURIComponent(username)}`);
                        const data = await response.json();
                        
                        if (data.found && data.user.publicKey) {
                            const users = JSON.parse(localStorage.getItem('users') || '{}');
                            if (!users[username]) {
                                users[username] = {
                                    publicKey: data.user.publicKey,
                                    addedAt: Date.now()
                                };
                            } else if (!users[username].publicKey) {
                                users[username].publicKey = data.user.publicKey;
                            }
                            localStorage.setItem('users', JSON.stringify(users));
                            console.log('✅ Публичный ключ участника сохранен:', username);
                        }
                    } catch (error) {
                        console.error('❌ Ошибка получения публичного ключа для:', username, error);
                    }
                }
            }
        }
        
        // Создаем новый чат
        chat = {
            id: notification.chatId,
            name: notification.chatName,
            type: notification.chatType,
            participants: notification.participants || [],
            messages: [],
            createdAt: notification.timestamp
        };
        chats.unshift(chat);
        saveChats();
        renderChatsList();
        
        // Показываем уведомление
        showNotification(`${notification.invitedBy} добавил вас в ${notification.chatType === 'group' ? 'группу' : 'канал'} "${notification.chatName}"`);
    }
}

function handleMessageKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function editMessage(messageId) {
    const message = currentChat.messages.find(m => m.id === messageId);
    if (!message) return;
    
    const newText = prompt('Редактировать сообщение:', message.text);
    if (newText !== null && newText.trim()) {
        message.text = newText.trim();
        message.edited = true;
        saveChats();
        renderMessages();
        
        // Notify other participants
        broadcastToGroup(currentChat.id, {
            type: 'edit',
            messageId: messageId,
            newText: newText.trim()
        });
    }
}

function deleteMessage(messageId) {
    if (!confirm('Удалить сообщение?')) return;
    
    const index = currentChat.messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
        currentChat.messages.splice(index, 1);
        saveChats();
        renderMessages();
        
        broadcastToGroup(currentChat.id, {
            type: 'delete',
            messageId: messageId
        });
    }
}

function addReaction(messageId) {
    const emoji = prompt('Введите эмодзи реакцию:', '👍');
    if (!emoji) return;
    
    toggleReaction(messageId, emoji);
}

function toggleReaction(messageId, emoji) {
    const message = currentChat.messages.find(m => m.id === messageId);
    if (!message) return;
    
    message.reactions = message.reactions || [];
    const existingIndex = message.reactions.findIndex(r => r.user === currentUser.username && r.emoji === emoji);
    
    if (existingIndex !== -1) {
        message.reactions.splice(existingIndex, 1);
    } else {
        message.reactions.push({
            emoji: emoji,
            user: currentUser.username
        });
    }
    
    saveChats();
    renderMessages();
    
    broadcastToGroup(currentChat.id, {
        type: 'reaction',
        messageId: messageId,
        emoji: emoji,
        user: currentUser.username
    });
}

// ============ FILE ATTACHMENTS ============

function attachFile() {
    document.getElementById('fileInput').click();
}

function attachImage() {
    document.getElementById('imageInput').click();
}

function attachVideo() {
    document.getElementById('videoInput').click();
}

function attachSticker() {
    document.getElementById('stickerInput').click();
}

function handleFileSelect(event) {
    handleFileAttachment(event.target.files[0]);
}

function handleImageSelect(event) {
    handleFileAttachment(event.target.files[0]);
}

function handleVideoSelect(event) {
    handleFileAttachment(event.target.files[0]);
}

function handleStickerSelect(event) {
    handleFileAttachment(event.target.files[0]);
}

function handleFileAttachment(file) {
    if (!file || !currentChat) return;
    
    // Show modal to add description
    createModal('📎 Отправка файла', `
        <div style="text-align: center; margin-bottom: 20px;">
            <div style="background: var(--glass-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--glass-border);">
                <div style="font-size: 48px; margin-bottom: 10px;">
                    ${file.type.startsWith('image/') ? '🖼️' : file.type.startsWith('video/') ? '🎥' : '📄'}
                </div>
                <div style="font-weight: 600; margin-bottom: 5px;">${file.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">
                    ${(file.size / 1024).toFixed(1)} КБ
                </div>
            </div>
        </div>
        <div class="form-group">
            <label>Добавить описание (необязательно)</label>
            <textarea id="fileDescription" placeholder="Напишите описание к файлу..." style="min-height: 80px; resize: vertical;"></textarea>
        </div>
        <button class="btn" onclick="sendFileWithDescription()">📤 Отправить</button>
        <button class="btn btn-secondary" onclick="closeModal()">❌ Отмена</button>
    `);
    
    // Store file in temporary variable
    window.tempFileToSend = file;
}

function sendFileWithDescription() {
    const file = window.tempFileToSend;
    const description = document.getElementById('fileDescription').value.trim();
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const message = {
            id: generateId(),
            sender: currentUser.username,
            timestamp: Date.now(),
            text: description || '',
            file: {
                name: file.name,
                type: file.type,
                size: file.size,
                data: e.target.result
            },
            reactions: [],
            read: false
        };
        
        currentChat.messages = currentChat.messages || [];
        currentChat.messages.push(message);
        saveChats();
        
        if (currentChat.type === 'private') {
            const recipient = currentChat.participants[0];
            sendEncryptedMessage(recipient, message);
        } else {
            broadcastToGroup(currentChat.id, message);
        }
        
        renderMessages();
        renderChatsList();
        closeModal();
        
        // Clear temp file
        window.tempFileToSend = null;
    };
    
    reader.readAsDataURL(file);
}

function viewMedia(src) {
    const modal = createModal('Просмотр медиа', `
        <img src="${src}" style="max-width: 100%; border-radius: 12px;">
    `);
}

// ============ MODALS ============

function openNewChatModal() {
    createModal('Новый чат', `
        <div class="form-group">
            <label>Поиск пользователя по логину</label>
            <div style="display: flex; gap: 8px;">
                <input type="text" id="userSearchInput" placeholder="Введите логин пользователя..." style="flex: 1;" onkeypress="if(event.key==='Enter') searchUserInModal()">
                <button class="btn" onclick="searchUserInModal()" style="width: auto; padding: 12px 20px;">🔎 Найти</button>
            </div>
        </div>
        <div id="searchResult" style="margin-top: 16px;"></div>
    `);
    
    // Focus on input
    setTimeout(() => {
        document.getElementById('userSearchInput').focus();
    }, 100);
}

async function searchUserInModal() {
    const searchInput = document.getElementById('userSearchInput');
    const query = searchInput.value.trim();
    const resultDiv = document.getElementById('searchResult');
    
    if (!query) {
        resultDiv.innerHTML = '<p style="color: var(--warning); text-align: center;">⚠️ Введите логин для поиска</p>';
        return;
    }
    
    console.log('Поиск в модальном окне:', query);
    console.log('Текущий пользователь:', currentUser.username);
    
    // Show loading
    resultDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted);">🔍 Поиск...</p>';
    
    try {
        // Search on server first
        const response = await fetch(`/api/users/search/${encodeURIComponent(query)}`);
        const data = await response.json();
        
        console.log('Результат поиска на сервере:', data);
        
        if (data.found) {
            const foundUsername = data.user.username;
            console.log('✅ Найден пользователь на сервере:', foundUsername);
            
            // Check if trying to chat with yourself
            if (foundUsername === currentUser.username) {
                resultDiv.innerHTML = '<p style="color: var(--danger); text-align: center;">❌ Вы не можете создать чат с самим собой!</p>';
                return;
            }
            
            // Add to local DB if not exists
            addUsernameToSearchDB(foundUsername);
            
            // Show found user
            resultDiv.innerHTML = `
                <div class="member-item" style="background: var(--glass-bg); padding: 14px; border-radius: 12px; border: 1px solid var(--glass-border);">
                    <div class="member-info">
                        <div class="avatar" style="width: 40px; height: 40px; font-size: 16px;">${foundUsername[0].toUpperCase()}</div>
                        <div>
                            <div style="font-weight: 600;">${foundUsername}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Пользователь найден ✅</div>
                        </div>
                    </div>
                    <button class="btn" onclick="startPrivateChatFromSearch('${foundUsername}')" style="width: auto; padding: 10px 20px;">
                        💬 Начать чат
                    </button>
                </div>
            `;
        } else {
            console.log('❌ Пользователь не найден на сервере:', query);
            
            resultDiv.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: var(--danger); font-size: 18px; margin-bottom: 8px;">❌ Пользователь не найден</p>
                    <p style="color: var(--text-muted); font-size: 14px;">
                        Пользователь "${query}" не зарегистрирован в системе.<br>
                        Проверьте правильность написания логина.
                    </p>
                </div>
            `;
        }
    } catch (error) {
        console.error('❌ Ошибка поиска на сервере:', error);
        
        // Fallback to local search
        const foundUsername = await searchUsernameInDB(query);
        
        if (foundUsername) {
            console.log('✅ Найден в локальной базе:', foundUsername);
            
            if (foundUsername === currentUser.username) {
                resultDiv.innerHTML = '<p style="color: var(--danger); text-align: center;">❌ Вы не можете создать чат с самим собой!</p>';
                return;
            }
            
            resultDiv.innerHTML = `
                <div class="member-item" style="background: var(--glass-bg); padding: 14px; border-radius: 12px; border: 1px solid var(--glass-border);">
                    <div class="member-info">
                        <div class="avatar" style="width: 40px; height: 40px; font-size: 16px;">${foundUsername[0].toUpperCase()}</div>
                        <div>
                            <div style="font-weight: 600;">${foundUsername}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Найден локально ✅</div>
                        </div>
                    </div>
                    <button class="btn" onclick="startPrivateChatFromSearch('${foundUsername}')" style="width: auto; padding: 10px 20px;">
                        💬 Начать чат
                    </button>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: var(--danger); font-size: 18px; margin-bottom: 8px;">❌ Пользователь не найден</p>
                    <p style="color: var(--text-muted); font-size: 14px;">
                        Пользователь "${query}" не найден.<br>
                        Проверьте подключение к серверу и правильность логина.
                    </p>
                </div>
            `;
        }
    }
}

async function startPrivateChatFromSearch(username) {
    closeModal();
    
    // Check if chat already exists (including hidden)
    let chat = chats.find(c => c.type === 'private' && c.participants.includes(username));
    
    if (chat) {
        // If chat exists but is hidden, unhide it
        if (chat.hidden) {
            chat.hidden = false;
            saveChats();
        }
    } else {
        // Get user's public key from server
        try {
            const response = await fetch(`/api/users/search/${encodeURIComponent(username)}`);
            const data = await response.json();
            
            if (data.found && data.user.publicKey) {
                // Save user's public key to local storage
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                if (!users[username]) {
                    users[username] = {
                        publicKey: data.user.publicKey,
                        addedAt: Date.now()
                    };
                } else if (!users[username].publicKey) {
                    users[username].publicKey = data.user.publicKey;
                }
                localStorage.setItem('users', JSON.stringify(users));
                console.log('✅ Публичный ключ пользователя сохранен:', username);
            }
        } catch (error) {
            console.error('❌ Ошибка получения публичного ключа:', error);
        }
        
        // Create new chat
        chat = {
            id: generateId(),
            name: username,
            type: 'private',
            participants: [username],
            messages: [],
            createdAt: Date.now(),
            hidden: false
        };
        chats.unshift(chat);
        saveChats();
    }
    
    openChat(chat.id);
    renderChatsList();
}

function openCreateGroupModal() {
    createModal('Создать группу', `
        <div class="form-group">
            <label>Аватар группы (необязательно)</label>
            <div style="text-align: center; margin-bottom: 15px;">
                <div id="groupAvatarPreview" class="avatar" style="width: 80px; height: 80px; font-size: 32px; margin: 0 auto;">👥</div>
            </div>
            <input type="file" id="groupAvatarInput" accept="image/*" style="padding: 12px; border: 2px dashed var(--glass-border); border-radius: 12px; background: var(--glass-bg);">
        </div>
        <div class="form-group">
            <label>Название группы</label>
            <input type="text" id="groupName" placeholder="Введите название...">
        </div>
        <div class="form-group">
            <label>Добавить участников</label>
            <div id="groupMembersSelect"></div>
        </div>
        <button class="btn" onclick="createGroup()">Создать группу</button>
    `);
    
    renderMembersSelect('groupMembersSelect');
    
    // Add preview for avatar
    document.getElementById('groupAvatarInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const preview = document.getElementById('groupAvatarPreview');
                preview.style.backgroundImage = `url(${event.target.result})`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.textContent = '';
            };
            reader.readAsDataURL(file);
        }
    });
}

function openCreateChannelModal() {
    createModal('Создать канал', `
        <div class="form-group">
            <label>Аватар канала (необязательно)</label>
            <div style="text-align: center; margin-bottom: 15px;">
                <div id="channelAvatarPreview" class="avatar" style="width: 80px; height: 80px; font-size: 32px; margin: 0 auto;">📢</div>
            </div>
            <input type="file" id="channelAvatarInput" accept="image/*" style="padding: 12px; border: 2px dashed var(--glass-border); border-radius: 12px; background: var(--glass-bg);">
        </div>
        <div class="form-group">
            <label>Название канала</label>
            <input type="text" id="channelName" placeholder="Введите название...">
        </div>
        <div class="form-group">
            <label>Добавить подписчиков</label>
            <div id="channelMembersSelect"></div>
        </div>
        <button class="btn" onclick="createChannel()">Создать канал</button>
    `);
    
    renderMembersSelect('channelMembersSelect');
    
    // Add preview for avatar
    document.getElementById('channelAvatarInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const preview = document.getElementById('channelAvatarPreview');
                preview.style.backgroundImage = `url(${event.target.result})`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.textContent = '';
            };
            reader.readAsDataURL(file);
        }
    });
}

function renderMembersSelect(containerId) {
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const usersList = Object.keys(users).filter(u => u !== currentUser.username);
    
    const container = document.getElementById(containerId);
    let html = '';
    
    usersList.forEach(username => {
        html += `
            <div class="member-item">
                <div class="member-info">
                    <div class="avatar" style="width: 32px; height: 32px; font-size: 13px;">${username[0].toUpperCase()}</div>
                    <span>${username}</span>
                </div>
                <input type="checkbox" value="${username}" class="member-checkbox">
            </div>
        `;
    });
    
    container.innerHTML = html || '<p style="color: var(--text-muted);">Нет пользователей</p>';
}

function createGroup() {
    const name = document.getElementById('groupName').value.trim();
    const checkboxes = document.querySelectorAll('.member-checkbox:checked');
    const participants = Array.from(checkboxes).map(cb => cb.value);
    
    if (!name) {
        alert('Введите название группы');
        return;
    }
    
    // Get avatar if uploaded
    const avatarInput = document.getElementById('groupAvatarInput');
    const avatarFile = avatarInput?.files[0];
    
    if (avatarFile) {
        const reader = new FileReader();
        reader.onload = function(e) {
            createGroupWithAvatar(name, participants, e.target.result);
        };
        reader.readAsDataURL(avatarFile);
    } else {
        createGroupWithAvatar(name, participants, null);
    }
}

async function createGroupWithAvatar(name, participants, avatar) {
    // Загрузить публичные ключи участников
    for (const username of participants) {
        try {
            const response = await fetch(`/api/users/search/${encodeURIComponent(username)}`);
            const data = await response.json();
            
            if (data.found && data.user.publicKey) {
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                if (!users[username]) {
                    users[username] = {
                        publicKey: data.user.publicKey,
                        addedAt: Date.now()
                    };
                } else if (!users[username].publicKey) {
                    users[username].publicKey = data.user.publicKey;
                }
                localStorage.setItem('users', JSON.stringify(users));
                console.log('✅ Публичный ключ участника сохранен:', username);
            }
        } catch (error) {
            console.error('❌ Ошибка получения публичного ключа для:', username, error);
        }
    }
    
    const group = {
        id: generateId(),
        name: name,
        type: 'group',
        participants: participants,
        admins: [currentUser.username],
        messages: [],
        avatar: avatar,
        createdAt: Date.now()
    };
    
    chats.push(group);
    saveChats();
    renderChatsList();
    
    // Отправить уведомления участникам
    if (ws && ws.readyState === WebSocket.OPEN) {
        const notification = {
            type: 'chat_invite',
            chatId: group.id,
            chatName: group.name,
            chatType: 'group',
            invitedBy: currentUser.username,
            participants: [...participants, currentUser.username],
            timestamp: Date.now()
        };
        
        participants.forEach(member => {
            if (member !== currentUser.username) {
                ws.send(JSON.stringify({
                    type: 'message',
                    to: member,
                    from: currentUser.username,
                    notification: notification
                }));
            }
        });
    }
    
    closeModal();
    
    alert('Группа создана!');
}

function createChannel() {
    const name = document.getElementById('channelName').value.trim();
    const checkboxes = document.querySelectorAll('.member-checkbox:checked');
    const participants = Array.from(checkboxes).map(cb => cb.value);
    
    if (!name) {
        alert('Введите название канала');
        return;
    }
    
    // Get avatar if uploaded
    const avatarInput = document.getElementById('channelAvatarInput');
    const avatarFile = avatarInput?.files[0];
    
    if (avatarFile) {
        const reader = new FileReader();
        reader.onload = function(e) {
            createChannelWithAvatar(name, participants, e.target.result);
        };
        reader.readAsDataURL(avatarFile);
    } else {
        createChannelWithAvatar(name, participants, null);
    }
}

async function createChannelWithAvatar(name, participants, avatar) {
    // Загрузить публичные ключи участников
    for (const username of participants) {
        try {
            const response = await fetch(`/api/users/search/${encodeURIComponent(username)}`);
            const data = await response.json();
            
            if (data.found && data.user.publicKey) {
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                if (!users[username]) {
                    users[username] = {
                        publicKey: data.user.publicKey,
                        addedAt: Date.now()
                    };
                } else if (!users[username].publicKey) {
                    users[username].publicKey = data.user.publicKey;
                }
                localStorage.setItem('users', JSON.stringify(users));
                console.log('✅ Публичный ключ участника сохранен:', username);
            }
        } catch (error) {
            console.error('❌ Ошибка получения публичного ключа для:', username, error);
        }
    }
    
    const channel = {
        id: generateId(),
        name: name,
        type: 'channel',
        participants: participants,
        admins: [currentUser.username],
        messages: [],
        avatar: avatar,
        createdAt: Date.now()
    };
    
    chats.push(channel);
    saveChats();
    renderChatsList();
    
    // Отправить уведомления участникам
    if (ws && ws.readyState === WebSocket.OPEN) {
        const notification = {
            type: 'chat_invite',
            chatId: channel.id,
            chatName: channel.name,
            chatType: 'channel',
            invitedBy: currentUser.username,
            participants: [...participants, currentUser.username],
            timestamp: Date.now()
        };
        
        participants.forEach(member => {
            if (member !== currentUser.username) {
                ws.send(JSON.stringify({
                    type: 'message',
                    to: member,
                    from: currentUser.username,
                    notification: notification
                }));
            }
        });
    }
    
    closeModal();
    
    alert('Канал создан!');
}

function openChatSettings() {
    if (!currentChat) return;
    
    const isAdmin = currentChat.admins?.includes(currentUser.username);
    const isOwner = currentChat.createdBy === currentUser.username || currentChat.admins?.[0] === currentUser.username;
    
    let html = `
        <div class="form-group">
            <label>Название ${currentChat.type === 'group' ? 'группы' : currentChat.type === 'channel' ? 'канала' : 'чата'}</label>
            <input type="text" id="chatNameEdit" value="${currentChat.name}" ${!isAdmin ? 'disabled' : ''}>
        </div>
    `;
    
    if (currentChat.type !== 'private') {
        html += `
            <div class="form-group">
                <label>Участники</label>
                <div id="chatMembers" class="members-list"></div>
            </div>
        `;
        
        if (isAdmin) {
            html += `
                <button class="btn btn-secondary" onclick="addMembersToChat()">➕ Добавить участников</button>
            `;
        }
        
        html += `
            <button class="btn btn-secondary" onclick="clearChatHistory()">🗑️ Очистить историю</button>
        `;
        
        if (currentChat.type === 'group') {
            html += `
                <button class="btn btn-secondary" onclick="leaveGroup()">👋 Покинуть группу</button>
            `;
        }
        
        if (isOwner) {
            html += `
                <button class="btn" style="background: var(--danger);" onclick="deleteChat()">❌ Удалить ${currentChat.type === 'group' ? 'группу' : 'канал'}</button>
            `;
        }
        
        html += `
            <button class="btn" onclick="saveChatSettings()">💾 Сохранить</button>
        `;
    } else {
        html += `
            <button class="btn btn-secondary" onclick="clearChatHistory()">🗑️ Очистить переписку</button>
            <button class="btn btn-secondary" onclick="blockUser()">🚫 Блокировать</button>
        `;
    }
    
    createModal('Настройки чата', html);
    
    if (currentChat.type !== 'private') {
        renderChatMembers();
    }
}

function renderChatMembers() {
    const container = document.getElementById('chatMembers');
    if (!container) return;
    
    const isAdmin = currentChat.admins?.includes(currentUser.username);
    
    let html = '';
    currentChat.participants.forEach(member => {
        const isMemberAdmin = currentChat.admins?.includes(member);
        const isSelf = member === currentUser.username;
        
        html += `
            <div class="member-item">
                <div class="member-info">
                    <div class="avatar" style="width: 32px; height: 32px; font-size: 13px;">${member[0].toUpperCase()}</div>
                    <span>${member} ${isMemberAdmin ? '👑' : ''}</span>
                </div>
                ${!isSelf && isAdmin ? `
                    <div class="member-actions">
                        ${!isMemberAdmin ? `<button class="icon-btn tooltip" onclick="makeAdmin('${member}')">👑<span class="tooltiptext">Назначить админом</span></button>` : ''}
                        ${isMemberAdmin ? `<button class="icon-btn tooltip" onclick="removeAdmin('${member}')">👤<span class="tooltiptext">Снять админа</span></button>` : ''}
                        <button class="icon-btn tooltip" onclick="removeMember('${member}')">❌<span class="tooltiptext">Удалить</span></button>
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function saveChatSettings() {
    const newName = document.getElementById('chatNameEdit')?.value.trim();
    
    if (newName && newName !== currentChat.name) {
        currentChat.name = newName;
        saveChats();
        document.getElementById('chatName').textContent = newName;
        renderChatsList();
    }
    
    closeModal();
    alert('Настройки сохранены!');
}

function addMembersToChat() {
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const availableUsers = Object.keys(users).filter(u => 
        u !== currentUser.username && !currentChat.participants.includes(u)
    );
    
    if (availableUsers.length === 0) {
        alert('Нет доступных пользователей');
        return;
    }
    
    let html = '<div class="members-list">';
    availableUsers.forEach(username => {
        html += `
            <div class="member-item">
                <div class="member-info">
                    <div class="avatar" style="width: 32px; height: 32px;">${username[0].toUpperCase()}</div>
                    <span>${username}</span>
                </div>
                <input type="checkbox" value="${username}" class="add-member-checkbox">
            </div>
        `;
    });
    html += '</div><button class="btn" onclick="confirmAddMembers()">Добавить</button>';
    
    createModal('Добавить участников', html);
}

async function confirmAddMembers() {
    const checkboxes = document.querySelectorAll('.add-member-checkbox:checked');
    const newMembers = Array.from(checkboxes).map(cb => cb.value);
    
    if (newMembers.length > 0) {
        // Загрузить публичные ключи новых участников
        for (const username of newMembers) {
            try {
                const response = await fetch(`/api/users/search/${encodeURIComponent(username)}`);
                const data = await response.json();
                
                if (data.found && data.user.publicKey) {
                    const users = JSON.parse(localStorage.getItem('users') || '{}');
                    if (!users[username]) {
                        users[username] = {
                            publicKey: data.user.publicKey,
                            addedAt: Date.now()
                        };
                    } else if (!users[username].publicKey) {
                        users[username].publicKey = data.user.publicKey;
                    }
                    localStorage.setItem('users', JSON.stringify(users));
                    console.log('✅ Публичный ключ участника сохранен:', username);
                }
            } catch (error) {
                console.error('❌ Ошибка получения публичного ключа для:', username, error);
            }
        }
        
        // Добавить новых участников
        currentChat.participants.push(...newMembers);
        saveChats();
        
        // Отправить оповещение новым участникам через WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            const notification = {
                type: 'chat_invite',
                chatId: currentChat.id,
                chatName: currentChat.name,
                chatType: currentChat.type,
                invitedBy: currentUser.username,
                participants: [...currentChat.participants, currentUser.username],
                timestamp: Date.now()
            };
            
            newMembers.forEach(member => {
                ws.send(JSON.stringify({
                    type: 'message',
                    to: member,
                    from: currentUser.username,
                    notification: notification
                }));
            });
        }
        
        renderChatMembers();
        alert(`Добавлено участников: ${newMembers.length}`);
    }
    
    closeModal();
}

function removeMember(username) {
    if (!confirm(`Удалить ${username} из чата?`)) return;
    
    const index = currentChat.participants.indexOf(username);
    if (index !== -1) {
        currentChat.participants.splice(index, 1);
        saveChats();
        renderChatMembers();
    }
}

function makeAdmin(username) {
    currentChat.admins = currentChat.admins || [];
    if (!currentChat.admins.includes(username)) {
        currentChat.admins.push(username);
        saveChats();
        renderChatMembers();
    }
}

function removeAdmin(username) {
    const index = currentChat.admins?.indexOf(username);
    if (index !== -1) {
        currentChat.admins.splice(index, 1);
        saveChats();
        renderChatMembers();
    }
}

function clearChatHistory() {
    if (!confirm('Очистить всю историю сообщений?')) return;
    
    currentChat.messages = [];
    saveChats();
    renderMessages();
}

function leaveGroup() {
    if (!confirm('Вы уверены, что хотите покинуть группу?')) return;
    
    currentChat.hidden = true;
    saveChats();
    
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('chatView').classList.add('hidden');
    currentChat = null;
    renderChatsList();
    closeModal();
}

function deleteChat() {
    if (!confirm('Удалить этот чат? Это действие нельзя отменить!')) return;
    
    const index = chats.findIndex(c => c.id === currentChat.id);
    if (index !== -1) {
        chats.splice(index, 1);
        saveChats();
        
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('chatView').classList.add('hidden');
        currentChat = null;
        renderChatsList();
        closeModal();
    }
}

function blockUser() {
    if (!confirm('Заблокировать этого пользователя?')) return;
    
    const blockedUsers = JSON.parse(localStorage.getItem(`blocked_${currentUser.username}`) || '[]');
    blockedUsers.push(currentChat.participants[0]);
    localStorage.setItem(`blocked_${currentUser.username}`, JSON.stringify(blockedUsers));
    
    alert('Пользователь заблокирован');
    closeModal();
}

// ============ WEBRTC CALLS ============

function startCall() {
    if (!currentChat) return;
    
    inCall = true;
    document.getElementById('callContainer').classList.remove('hidden');
    document.getElementById('callTitle').textContent = `Звонок: ${currentChat.name}`;
    document.getElementById('callStatus').textContent = 'Подключение...';
    
    initializeCall();
}

async function initializeCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
        });
        
        // Add local audio
        const localParticipant = document.createElement('div');
        localParticipant.className = 'participant-video';
        localParticipant.innerHTML = `
            <div class="avatar" style="width: 80px; height: 80px; font-size: 32px;">${currentUser.username[0].toUpperCase()}</div>
            <div class="participant-name">${currentUser.username} (Вы)</div>
        `;
        document.getElementById('participantsGrid').appendChild(localParticipant);
        
        document.getElementById('callStatus').textContent = 'В звонке';
        
        // Initialize peer connections for group call
        if (currentChat.type === 'group') {
            currentChat.participants.forEach(participant => {
                if (participant !== currentUser.username) {
                    createPeerConnection(participant);
                }
            });
        } else if (currentChat.type === 'private') {
            createPeerConnection(currentChat.participants[0]);
        }
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Не удалось получить доступ к микрофону');
        endCall();
    }
}

function createPeerConnection(userId) {
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    };
    
    const pc = new RTCPeerConnection(config);
    peerConnections.set(userId, pc);
    
    // Add local stream
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Handle remote stream
    pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        addRemoteParticipant(userId, remoteStream);
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate && ws) {
            ws.send(JSON.stringify({
                type: 'signal',
                to: userId,
                candidate: event.candidate
            }));
        }
    };
    
    // Create and send offer
    pc.createOffer().then(offer => {
        return pc.setLocalDescription(offer);
    }).then(() => {
        if (ws) {
            ws.send(JSON.stringify({
                type: 'signal',
                to: userId,
                offer: pc.localDescription
            }));
        }
    });
}

function addRemoteParticipant(userId, stream) {
    const participant = document.createElement('div');
    participant.className = 'participant-video';
    participant.dataset.userId = userId;
    
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    
    participant.innerHTML = `
        <div class="avatar" style="width: 80px; height: 80px; font-size: 32px;">${userId[0].toUpperCase()}</div>
        <div class="participant-name">${userId}</div>
    `;
    
    participant.appendChild(audio);
    document.getElementById('participantsGrid').appendChild(participant);
}

function handleSignal(data) {
    const pc = peerConnections.get(data.from);
    
    if (!pc && inCall) {
        createPeerConnection(data.from);
        return;
    }
    
    if (data.offer) {
        pc.setRemoteDescription(new RTCSessionDescription(data.offer))
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'signal',
                        to: data.from,
                        answer: pc.localDescription
                    }));
                }
            });
    } else if (data.answer) {
        pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function toggleMic() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('micBtn');
        btn.classList.toggle('muted');
    }
}

function endCall() {
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Close all peer connections
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    // Reset UI
    document.getElementById('callContainer').classList.add('hidden');
    document.getElementById('participantsGrid').innerHTML = '';
    document.getElementById('micBtn').classList.remove('muted');
    inCall = false;
}

// ============ UTILITIES ============

function createModal(title, content) {
    const modalHtml = `
        <div class="modal" id="mainModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${title}</h2>
                    <button class="close-btn" onclick="closeModal()">×</button>
                </div>
                ${content}
            </div>
        </div>
    `;
    
    document.getElementById('modalContainer').innerHTML = modalHtml;
}

function closeModal() {
    document.getElementById('modalContainer').innerHTML = '';
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ч назад`;
    
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateOnlineStatus() {
    // Update online indicators in chat list
    renderChatsList();
    
    if (currentChat?.type === 'private') {
        const isOnline = onlineUsers.includes(currentChat.participants[0]);
        document.getElementById('chatStatus').textContent = isOnline ? 'В сети' : 'Не в сети';
    }
}

async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();
    
    // If empty, show all chats
    if (!query) {
        renderChatsList();
        return;
    }
    
    console.log('Поиск пользователя:', query);
    console.log('Текущий пользователь:', currentUser.username);
    
    try {
        // Search on server
        const response = await fetch(`/api/users/search/${encodeURIComponent(query)}`);
        const data = await response.json();
        
        console.log('Результат поиска на сервере:', data);
        
        if (data.found) {
            const foundUsername = data.user.username;
            console.log('✅ Найден логин на сервере:', foundUsername);
            
            // Check if trying to chat with yourself
            if (foundUsername === currentUser.username) {
                alert('❌ Вы не можете создать чат с самим собой!');
                searchInput.value = '';
                return;
            }
            
            // Add to local DB
            addUsernameToSearchDB(foundUsername);
            
            // Verify user still exists in users database
            const users = JSON.parse(localStorage.getItem('users') || '{}');
            if (!users[foundUsername]) {
                // User not in local storage, that's OK - they're on server
                console.log('⚠️ Пользователь найден на сервере, но отсутствует локально:', foundUsername);
            }
            
            // Check if chat already exists (including hidden ones)
            const existingPrivateChat = chats.find(c => 
                c.type === 'private' && 
                c.participants.includes(foundUsername)
            );
            
            if (existingPrivateChat) {
                // If chat exists but is hidden, unhide it
                if (existingPrivateChat.hidden) {
                    existingPrivateChat.hidden = false;
                    saveChats();
                    renderChatsList();
                }
                openChat(existingPrivateChat.id);
                searchInput.value = '';
                console.log('Открыт существующий чат с:', foundUsername);
                return;
            }
            
            // Create new chat with found user
            const newChat = {
                id: generateId(),
                name: foundUsername,
                type: 'private',
                participants: [foundUsername],
                messages: [],
                createdAt: Date.now(),
                hidden: false
            };
            
            chats.unshift(newChat);
            saveChats();
            renderChatsList();
            openChat(newChat.id);
            searchInput.value = '';
            
            console.log('Создан новый чат с:', foundUsername);
            alert(`✅ Чат с пользователем "${foundUsername}" создан!`);
        } else {
            console.log('❌ Логин не найден на сервере:', query);
            alert(`❌ Пользователь "${query}" не найден.\n\nПроверьте правильность написания логина.\nПользователь должен быть зарегистрирован в системе.`);
        }
    } catch (error) {
        console.error('❌ Ошибка подключения к серверу:', error);
        
        // Fallback to local search
        const foundUsername = await searchUsernameInDB(query);
        
        if (foundUsername) {
            console.log('✅ Найден в локальной базе:', foundUsername);
            
            if (foundUsername === currentUser.username) {
                alert('❌ Вы не можете создать чат с самим собой!');
                searchInput.value = '';
                return;
            }
            
            const existingPrivateChat = chats.find(c => 
                c.type === 'private' && 
                c.participants.includes(foundUsername)
            );
            
            if (existingPrivateChat) {
                if (existingPrivateChat.hidden) {
                    existingPrivateChat.hidden = false;
                    saveChats();
                    renderChatsList();
                }
                openChat(existingPrivateChat.id);
                searchInput.value = '';
                return;
            }
            
            const newChat = {
                id: generateId(),
                name: foundUsername,
                type: 'private',
                participants: [foundUsername],
                messages: [],
                createdAt: Date.now(),
                hidden: false
            };
            
            chats.unshift(newChat);
            saveChats();
            renderChatsList();
            openChat(newChat.id);
            searchInput.value = '';
            
            alert(`✅ Чат с пользователем "${foundUsername}" создан (локальная база)!`);
        } else {
            alert(`❌ Пользователь "${query}" не найден.\n\nПроверьте подключение к серверу и правильность логина.`);
        }
    }
}

// Keep old searchChats for local filtering
function searchChats() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();
    renderChatsList(query);
}

function showNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('P2P Мессенджер', {
            body: message,
            icon: '/icon-192.png'
        });
    }
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// ============ THEMES ============

function loadTheme() {
    const savedTheme = localStorage.getItem('app_theme') || 'theme-purple';
    document.body.className = savedTheme;
}

function setTheme(themeName) {
    document.body.className = themeName;
    localStorage.setItem('app_theme', themeName);
}

function openAppSettings() {
    const currentTheme = localStorage.getItem('app_theme') || 'theme-purple';
    
    const themes = [
        { id: 'theme-purple', name: 'Purple Dreams', emoji: '💜' },
        { id: 'theme-ocean', name: 'Ocean Blue', emoji: '🌊' },
        { id: 'theme-sunset', name: 'Sunset', emoji: '🌅' },
        { id: 'theme-forest', name: 'Forest Green', emoji: '🌲' },
        { id: 'theme-night', name: 'Night Sky', emoji: '🌙' },
        { id: 'theme-pink', name: 'Pink Passion', emoji: '💗' },
        { id: 'theme-mint', name: 'Mint Fresh', emoji: '🍃' },
        { id: 'theme-dark', name: 'Dark Mode', emoji: '🌑' }
    ];
    
    let themesHtml = '<div class="theme-selector">';
    themes.forEach(theme => {
        themesHtml += `
            <div class="theme-option ${theme.id} ${currentTheme === theme.id ? 'active' : ''}" 
                 onclick="selectTheme('${theme.id}')">
                <div class="theme-preview"></div>
                <div class="theme-name">${theme.emoji} ${theme.name}</div>
            </div>
        `;
    });
    themesHtml += '</div>';
    
    createModal('⚙️ Настройки', `
        <h3 style="margin-bottom: 16px;">Выберите тему</h3>
        ${themesHtml}
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--glass-border);">
        
        <h3 style="margin-bottom: 16px;">👤 Управление аккаунтом</h3>
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <button class="btn btn-secondary" onclick="openAvatarUploadModal()">
                🖼️ Загрузить аватар
            </button>
            <button class="btn btn-secondary" onclick="openChangeUsernameModal()">
                ✏️ Изменить логин
            </button>
            <button class="btn btn-secondary" onclick="openChangePasswordModal()">
                🔑 Изменить пароль
            </button>
            <button class="btn" onclick="openDeleteAccountModal()" style="background: var(--danger);">
                🗑️ Удалить аккаунт
            </button>
        </div>
        
        <p style="margin-top: 20px; color: var(--text-muted); font-size: 13px; text-align: center;">
            Текущий логин: <strong>${currentUser.username}</strong>
        </p>
    `);
}

function openAvatarUploadModal() {
    closeModal();
    const currentAvatar = currentUser.avatar;
    const avatarPreview = currentAvatar 
        ? `<img src="${currentAvatar}" style="width: 120px; height: 120px; border-radius: 50%; object-fit: cover; margin: 0 auto 20px;">`
        : `<div class="avatar" style="width: 120px; height: 120px; font-size: 48px; margin: 0 auto 20px;">${currentUser.username[0].toUpperCase()}</div>`;
    
    createModal('🖼️ Загрузить аватар', `
        <div style="text-align: center;">
            ${avatarPreview}
        </div>
        <div class="form-group">
            <label>Выберите изображение (макс. 2 МБ)</label>
            <input type="file" id="avatarInput" accept="image/*" style="padding: 12px; border: 2px dashed var(--glass-border); border-radius: 12px; background: var(--glass-bg);">
        </div>
        <button class="btn" onclick="uploadAvatar()">✅ Загрузить</button>
        ${currentAvatar ? '<button class="btn" onclick="removeAvatar()" style="background: var(--danger);">🗑️ Удалить аватар</button>' : ''}
        <button class="btn btn-secondary" onclick="openAppSettings()">❌ Отмена</button>
    `);
}

function uploadAvatar() {
    const fileInput = document.getElementById('avatarInput');
    const file = fileInput.files[0];
    
    if (!file) {
        alert('⚠️ Выберите изображение');
        return;
    }
    
    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
        alert('⚠️ Файл слишком большой. Максимальный размер: 2 МБ');
        return;
    }
    
    // Check file type
    if (!file.type.startsWith('image/')) {
        alert('⚠️ Выберите изображение');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const avatarData = e.target.result;
        
        // Save avatar to user
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        if (users[currentUser.username]) {
            users[currentUser.username].avatar = avatarData;
            localStorage.setItem('users', JSON.stringify(users));
            currentUser.avatar = avatarData;
            
            // Update UI
            updateUserAvatar();
            
            alert('✅ Аватар успешно загружен!');
            closeModal();
        }
    };
    reader.readAsDataURL(file);
}

function removeAvatar() {
    if (!confirm('Вы уверены, что хотите удалить аватар?')) {
        return;
    }
    
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    if (users[currentUser.username]) {
        users[currentUser.username].avatar = null;
        localStorage.setItem('users', JSON.stringify(users));
        currentUser.avatar = null;
        
        // Update UI
        updateUserAvatar();
        
        alert('✅ Аватар удален');
        closeModal();
    }
}

function updateUserAvatar() {
    const avatarElement = document.getElementById('userAvatar');
    if (currentUser.avatar) {
        avatarElement.style.backgroundImage = `url(${currentUser.avatar})`;
        avatarElement.style.backgroundSize = 'cover';
        avatarElement.style.backgroundPosition = 'center';
        avatarElement.textContent = '';
    } else {
        avatarElement.style.backgroundImage = 'none';
        avatarElement.textContent = currentUser.username[0].toUpperCase();
    }
}

function openChangeUsernameModal() {
    closeModal();
    createModal('✏️ Изменить логин', `
        <div class="form-group">
            <label>Текущий логин</label>
            <input type="text" value="${currentUser.username}" disabled style="opacity: 0.6;">
        </div>
        <div class="form-group">
            <label>Новый логин</label>
            <input type="text" id="newUsername" placeholder="Введите новый логин...">
        </div>
        <div class="form-group">
            <label>Подтвердите пароль</label>
            <input type="password" id="confirmPasswordForUsername" placeholder="Введите текущий пароль...">
        </div>
        <button class="btn" onclick="changeUsername()">✅ Изменить логин</button>
        <button class="btn btn-secondary" onclick="openAppSettings()">❌ Отмена</button>
    `);
}

function changeUsername() {
    const newUsername = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('confirmPasswordForUsername').value;
    
    if (!newUsername || !password) {
        alert('⚠️ Заполните все поля');
        return;
    }
    
    // Check if new username is different
    if (newUsername === currentUser.username) {
        alert('⚠️ Новый логин совпадает с текущим');
        return;
    }
    
    // Verify password
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    if (users[currentUser.username].password !== hashPassword(password)) {
        alert('❌ Неверный пароль');
        return;
    }
    
    // Check if new username already exists
    if (users[newUsername]) {
        alert('❌ Этот логин уже занят');
        return;
    }
    
    // Update username in users database
    const userData = users[currentUser.username];
    delete users[currentUser.username];
    users[newUsername] = userData;
    localStorage.setItem('users', JSON.stringify(users));
    
    // Update username in search database
    const db = JSON.parse(localStorage.getItem('usernames_db') || '[]');
    const index = db.indexOf(currentUser.username);
    if (index !== -1) {
        db[index] = newUsername;
    } else {
        db.push(newUsername);
    }
    localStorage.setItem('usernames_db', JSON.stringify(db));
    
    // Update chats
    const allChatsKey = `chats_${currentUser.username}`;
    const oldChats = localStorage.getItem(allChatsKey);
    if (oldChats) {
        localStorage.setItem(`chats_${newUsername}`, oldChats);
        localStorage.removeItem(allChatsKey);
    }
    
    // Update current user
    currentUser.username = newUsername;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    alert('✅ Логин успешно изменен!');
    closeModal();
    
    // Reload page to apply changes
    location.reload();
}

function openChangePasswordModal() {
    closeModal();
    createModal('🔑 Изменить пароль', `
        <div class="form-group">
            <label>Текущий пароль</label>
            <input type="password" id="currentPassword" placeholder="Введите текущий пароль...">
        </div>
        <div class="form-group">
            <label>Новый пароль</label>
            <input type="password" id="newPassword" placeholder="Введите новый пароль...">
        </div>
        <div class="form-group">
            <label>Повторите новый пароль</label>
            <input type="password" id="confirmNewPassword" placeholder="Повторите новый пароль...">
        </div>
        <button class="btn" onclick="changePassword()">✅ Изменить пароль</button>
        <button class="btn btn-secondary" onclick="openAppSettings()">❌ Отмена</button>
    `);
}

function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        alert('⚠️ Заполните все поля');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        alert('❌ Новые пароли не совпадают');
        return;
    }
    
    if (newPassword.length < 4) {
        alert('⚠️ Пароль должен быть не менее 4 символов');
        return;
    }
    
    // Verify current password
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    if (users[currentUser.username].password !== hashPassword(currentPassword)) {
        alert('❌ Неверный текущий пароль');
        return;
    }
    
    // Update password
    users[currentUser.username].password = hashPassword(newPassword);
    localStorage.setItem('users', JSON.stringify(users));
    
    // Update current user
    currentUser.password = hashPassword(newPassword);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    alert('✅ Пароль успешно изменен!');
    closeModal();
    openAppSettings();
}

function openDeleteAccountModal() {
    closeModal();
    createModal('🗑️ Удалить аккаунт', `
        <div style="text-align: center; padding: 20px;">
            <p style="font-size: 48px; margin-bottom: 16px;">⚠️</p>
            <h3 style="color: var(--danger); margin-bottom: 16px;">ВНИМАНИЕ!</h3>
            <p style="margin-bottom: 20px; color: var(--text-muted);">
                Вы действительно хотите удалить свой аккаунт?<br>
                Все ваши данные, чаты и сообщения будут удалены навсегда.<br>
                <strong>Это действие необратимо!</strong>
            </p>
        </div>
        <div class="form-group">
            <label>Введите пароль для подтверждения</label>
            <input type="password" id="confirmPasswordForDelete" placeholder="Введите ваш пароль...">
        </div>
        <div class="form-group">
            <label>
                <input type="checkbox" id="confirmDelete" style="width: auto; margin-right: 8px;">
                Я понимаю, что это действие необратимо
            </label>
        </div>
        <button class="btn" onclick="deleteAccount()" style="background: var(--danger);">
            🗑️ Удалить аккаунт навсегда
        </button>
        <button class="btn btn-secondary" onclick="openAppSettings()">❌ Отмена</button>
    `);
}

function deleteAccount() {
    const password = document.getElementById('confirmPasswordForDelete').value;
    const confirmed = document.getElementById('confirmDelete').checked;
    
    if (!password) {
        alert('⚠️ Введите пароль');
        return;
    }
    
    if (!confirmed) {
        alert('⚠️ Подтвердите удаление аккаунта');
        return;
    }
    
    // Verify password
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    if (users[currentUser.username].password !== hashPassword(password)) {
        alert('❌ Неверный пароль');
        return;
    }
    
    if (!confirm('⚠️ ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!\n\nВы ТОЧНО хотите удалить аккаунт?\nВсе данные будут потеряны навсегда!')) {
        return;
    }
    
    // Delete user from users database
    delete users[currentUser.username];
    localStorage.setItem('users', JSON.stringify(users));
    
    // Delete from search database
    const db = JSON.parse(localStorage.getItem('usernames_db') || '[]');
    const index = db.indexOf(currentUser.username);
    if (index !== -1) {
        db.splice(index, 1);
        localStorage.setItem('usernames_db', JSON.stringify(db));
    }
    
    // Delete all chats
    localStorage.removeItem(`chats_${currentUser.username}`);
    
    // Delete current user session
    localStorage.removeItem('currentUser');
    
    alert('✅ Аккаунт успешно удален');
    
    // Reload to login screen
    location.reload();
}

function selectTheme(themeId) {
    setTheme(themeId);
    
    // Update UI
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.remove('active');
    });
    document.querySelector(`.theme-option.${themeId}`).classList.add('active');
}

// ============ MOBILE MENU TOGGLE ============
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('mobileToggle');
    
    sidebar.classList.toggle('active');
    
    // Update icon
    if (sidebar.classList.contains('active')) {
        toggle.textContent = '✕';
    } else {
        toggle.textContent = '☰';
    }
}

// Close mobile menu when clicking outside
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('mobileToggle');
    
    if (sidebar && toggle && sidebar.classList.contains('active')) {
        // Check if click is outside sidebar and toggle button
        if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
            sidebar.classList.remove('active');
            toggle.textContent = '☰';
        }
    }
});

