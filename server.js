const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Connected clients
const clients = new Map();

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
