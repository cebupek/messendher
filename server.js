const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Parse JSON bodies
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Server-side user database (in-memory, will reset on restart)
const serverUsers = new Map();

// Connected clients
const clients = new Map();

// API Endpoints
app.post('/api/register', (req, res) => {
  const { username, publicKey } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  if (serverUsers.has(username)) {
    return res.status(409).json({ error: 'User already exists' });
  }
  
  serverUsers.set(username, {
    username: username,
    publicKey: publicKey,
    registeredAt: Date.now()
  });
  
  console.log(`✅ Пользователь ${username} зарегистрирован на сервере`);
  console.log(`Всего пользователей: ${serverUsers.size}`);
  
  res.json({ success: true, username: username });
});

app.get('/api/users/search/:query', (req, res) => {
  const query = req.params.query.toLowerCase();
  
  // Search for user (case-insensitive)
  let foundUser = null;
  for (const [username, userData] of serverUsers.entries()) {
    if (username.toLowerCase() === query) {
      foundUser = { 
        username: username,
        publicKey: userData.publicKey
      };
      break;
    }
  }
  
  if (foundUser) {
    console.log(`✅ Найден пользователь: ${foundUser.username}`);
    res.json({ found: true, user: foundUser });
  } else {
    console.log(`❌ Пользователь не найден: ${query}`);
    res.json({ found: false });
  }
});

app.get('/api/users/list', (req, res) => {
  const usersList = Array.from(serverUsers.keys());
  res.json({ users: usersList });
});

wss.on('connection', (ws) => {
  console.log('Новое подключение');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Register client
      if (data.type === 'register') {
        clients.set(data.userId, ws);
        ws.userId = data.userId;
        console.log(`Пользователь ${data.userId} зарегистрирован`);
        
        // Send online users list
        broadcastOnlineUsers();
        return;
      }
      
      // Relay message to recipient(s)
      if (data.type === 'signal' || data.type === 'message') {
        if (data.to) {
          const recipientWs = clients.get(data.to);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify(data));
          }
        }
      }
      
      // Broadcast to group/channel
      if (data.type === 'broadcast') {
        data.recipients?.forEach(recipientId => {
          const recipientWs = clients.get(recipientId);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify(data));
          }
        });
      }
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error);
    }
  });
  
  ws.on('close', () => {
    if (ws.userId) {
      console.log(`Пользователь ${ws.userId} отключился`);
      clients.delete(ws.userId);
      broadcastOnlineUsers();
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket ошибка:', error);
  });
});

function broadcastOnlineUsers() {
  const onlineUsers = Array.from(clients.keys());
  const message = JSON.stringify({
    type: 'online_users',
    users: onlineUsers
  });
  
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
