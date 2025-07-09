const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Simple room tracking
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`🟢 New connection: ${socket.id}`);

  socket.on('join', ({ roomId, userName }) => {
    console.log(`📥 ${userName} (${socket.id}) joining room: ${roomId}`);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
    }

    const room = rooms.get(roomId);

    // Check if room is full (adjust limit as needed)
    if (room.length >= 6) {
      console.log(`❌ Room ${roomId} is full`);
      socket.emit('room-full');
      return;
    }

    // Remove user from other rooms first
    rooms.forEach((users, rId) => {
      const index = users.findIndex(user => user.id === socket.id);
      if (index !== -1) {
        users.splice(index, 1);
        if (users.length === 0) {
          rooms.delete(rId);
        }
      }
    });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    const isInitiator = room.length === 0;
    room.push({
      id: socket.id,
      name: userName,
      isInitiator: isInitiator
    });

    console.log(`✅ ${userName} joined room ${roomId}. Users: ${room.length}, Initiator: ${isInitiator}`);

    // Notify all users in the room about the new user
    io.to(roomId).emit('user-joined', {
      users: room,
      isInitiator: isInitiator
    });
  });

  // Handle when user is ready for peer connections
  socket.on('user-ready', ({ roomId, userName }) => {
    console.log(`🚀 ${userName} is ready for connections in room ${roomId}`);
    
    // Notify all OTHER users in the room that this user is ready
    socket.to(roomId).emit('user-ready', {
      userId: socket.id,
      userName: userName
    });
  });

  // Handle WebRTC offer
  socket.on('offer', ({ sdp, roomId, userName, toUserId }) => {
    console.log(`📤 Forwarding offer from ${userName} (${socket.id}) to ${toUserId}`);
    socket.to(toUserId).emit('offer', {
      sdp,
      fromUserId: socket.id,
      userName: userName
    });
  });

  // Handle WebRTC answer
  socket.on('answer', ({ sdp, roomId, userName, toUserId, fromUserId }) => {
    console.log(`📤 Forwarding answer from ${userName} (${socket.id}) to ${toUserId}`);
    socket.to(toUserId).emit('answer', {
      sdp,
      fromUserId: socket.id,
      userName: userName
    });
  });

  // Handle ICE candidates
  socket.on('ice-candidate', ({ candidate, roomId, toUserId }) => {
    console.log(`📶 Forwarding ICE candidate from ${socket.id} to ${toUserId}`);
    socket.to(toUserId).emit('ice-candidate', {
      candidate,
      fromUserId: socket.id
    });
  });

  // Handle audio toggle notifications
  socket.on('audio-toggle', ({ roomId, enabled, userName }) => {
    console.log(`🎤 ${userName} ${enabled ? 'enabled' : 'disabled'} audio`);
    socket.to(roomId).emit('audio-toggle', {
      userId: socket.id,
      enabled,
      userName
    });
  });

  // Handle video toggle notifications
  socket.on('video-toggle', ({ roomId, enabled, userName }) => {
    console.log(`📹 ${userName} ${enabled ? 'enabled' : 'disabled'} video`);
    socket.to(roomId).emit('video-toggle', {
      userId: socket.id,
      enabled,
      userName
    });
  });

  // Handle screen share start
  socket.on('screen-share-start', ({ roomId, userName }) => {
    console.log(`📺 ${userName} started screen sharing`);
    socket.to(roomId).emit('screen-share-start', {
      userId: socket.id,
      userName
    });
  });

  // Handle screen share stop
  socket.on('screen-share-stop', ({ roomId, userName }) => {
    console.log(`📺 ${userName} stopped screen sharing`);
    socket.to(roomId).emit('screen-share-stop', {
      userId: socket.id,
      userName
    });
  });

  // Handle leave
  socket.on('leave', ({ roomId, userName }) => {
    console.log(`👋 ${userName} leaving room ${roomId}`);
    handleUserLeave(socket);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    handleUserLeave(socket);
  });

  function handleUserLeave(socket) {
    const roomId = socket.data?.roomId;
    const userName = socket.data?.userName;

    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const index = room.findIndex(user => user.id === socket.id);
    if (index !== -1) {
      room.splice(index, 1);

      // Notify other users in the room
      socket.to(roomId).emit('user-left', {
        userId: socket.id,
        userName: userName
      });

      if (room.length === 0) {
        rooms.delete(roomId);
        console.log(`🗑️ Deleted empty room ${roomId}`);
      } else {
        console.log(`📤 Notified room ${roomId} that ${userName} left`);
      }
    }

    socket.leave(roomId);
  }
});

// Status Endpoint
app.get('/status', (req, res) => {
  const roomData = {};
  rooms.forEach((users, roomId) => {
    roomData[roomId] = users.map(u => ({
      name: u.name,
      isInitiator: u.isInitiator
    }));
  });

  res.json({
    totalRooms: rooms.size,
    totalUsers: Array.from(rooms.values()).reduce((sum, users) => sum + users.length, 0),
    rooms: roomData
  });
});

// Health Check
app.get('/', (req, res) => {
  res.send('🎥 Video signaling server is running!');
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Status dashboard: http://localhost:${PORT}/status`);
});