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

  socket.on('join', ({ roomId, name }) => {
    console.log(`📥 ${name} (${socket.id}) joining room: ${roomId}`);
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
    }
    
    const room = rooms.get(roomId);
    
    // Check if room is full
    if (room.length >= 2) {
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
    
    // Join the room
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;
    
    // Add user to room
    const isInitiator = room.length === 0;
    room.push({
      id: socket.id,
      name: name,
      isInitiator: isInitiator
    });
    
    console.log(`✅ ${name} joined room ${roomId}. Users: ${room.length}, Initiator: ${isInitiator}`);
    
    // Emit to all users in the room
    io.to(roomId).emit('user-joined', {
      users: room,
      isInitiator: isInitiator
    });
    
    // If second user joined, both are ready
    if (room.length === 2) {
      console.log(`🚀 Room ${roomId} is ready with 2 users`);
      
      // Send specific role to each user
      room.forEach(user => {
        io.to(user.id).emit('user-joined', {
          users: room,
          isInitiator: user.isInitiator
        });
      });
    }
  });

  socket.on('offer', ({ sdp, roomId, name }) => {
    console.log(`📤 Forwarding offer from ${name} in room ${roomId}`);
    socket.to(roomId).emit('offer', { sdp, name });
  });

  socket.on('answer', ({ sdp, roomId, name }) => {
    console.log(`📤 Forwarding answer from ${name} in room ${roomId}`);
    socket.to(roomId).emit('answer', { sdp, name });
  });

  socket.on('ice-candidate', ({ candidate, roomId }) => {
    console.log(`📶 Forwarding ICE candidate in room ${roomId}`);
    socket.to(roomId).emit('ice-candidate', { candidate });
  });

  socket.on('leave', ({ roomId, name }) => {
    console.log(`👋 ${name} leaving room ${roomId}`);
    handleUserLeave(socket);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
    handleUserLeave(socket);
  });

  function handleUserLeave(socket) {
    const roomId = socket.data?.roomId;
    const name = socket.data?.name;
    
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Remove user from room
    const index = room.findIndex(user => user.id === socket.id);
    if (index !== -1) {
      room.splice(index, 1);
      
      // Notify remaining users
      socket.to(roomId).emit('user-left', { name });
      
      // If room is empty, delete it
      if (room.length === 0) {
        rooms.delete(roomId);
        console.log(`🗑️ Deleted empty room ${roomId}`);
      } else {
        console.log(`📤 Notified room ${roomId} that ${name} left`);
      }
    }
    
    socket.leave(roomId);
  }
});

// Status endpoint for debugging
app.get('/status', (req, res) => {
  const roomData = {};
  rooms.forEach((users, roomId) => {
    roomData[roomId] = users.map(u => ({ name: u.name, isInitiator: u.isInitiator }));
  });
  
  res.json({
    totalRooms: rooms.size,
    totalUsers: Array.from(rooms.values()).reduce((sum, users) => sum + users.length, 0),
    rooms: roomData
  });
});

// Basic health check
app.get('/', (req, res) => {
  res.send('Video signaling server is running!');
});

const PORT = 5001;
server.listen(PORT, () => {
  console.log(`🚀 Video signaling server running on http://localhost:${PORT}`);
  console.log(`📊 Status: http://localhost:${PORT}/status`);
});