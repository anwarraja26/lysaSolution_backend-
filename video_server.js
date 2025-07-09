const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const os = require('os');

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

// Metrics tracking
const metrics = {
  // Network metrics
  latency: new Map(),  
  jitter: new Map(),        
  packetLoss: new Map(),  
  bandwidth: new Map(),     
  bitrate: new Map(),       
  
  // Video metrics
  frameRate: new Map(),    
  resolution: new Map(),    
  videoFreezes: new Map(),  
  videoDelay: new Map(),
  
  // Audio metrics
  audioLatency: new Map(),  
  audioDrops: new Map(),    
  audioMOS: new Map(),      
  // System metrics
  cpuUsage: 0,              
  memoryUsage: {            
    total: 0,
    free: 0,
    used: 0,
    timestamp: Date.now()
  },
  
  // Update system metrics
  updateSystemMetrics: function() {
    this.cpuUsage = os.loadavg()[0] / os.cpus().length * 100; // Average CPU usage
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    this.memoryUsage = {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      timestamp: Date.now()
    };
  },
  
  // Clean up old metrics
  cleanupOldMetrics: function() {
    const now = Date.now();
    const metricsToClean = [
      'latency', 'jitter', 'packetLoss', 'bandwidth', 'bitrate',
      'frameRate', 'resolution', 'videoDelay', 'audioLatency', 'audioMOS'
    ];
    
    metricsToClean.forEach(metric => {
      this[metric].forEach((value, userId) => {
        if (now - value.timestamp > 60000) { // Remove metrics older than 1 minute
          this[metric].delete(userId);
        }
      });
    });
  }
};

// Update system metrics every 5 seconds
setInterval(() => {
  metrics.updateSystemMetrics();
  metrics.cleanupOldMetrics();
}, 5000);

// Helper function to get user's metrics
function getUserMetrics(userId) {
  return {
    network: {
      latency: metrics.latency.get(userId)?.value,
      jitter: metrics.jitter.get(userId)?.value,
      packetLoss: metrics.packetLoss.get(userId)?.value,
      bandwidth: metrics.bandwidth.get(userId),
      bitrate: metrics.bitrate.get(userId)
    },
    video: {
      frameRate: metrics.frameRate.get(userId)?.value,
      resolution: metrics.resolution.get(userId),
      freezes: metrics.videoFreezes.get(userId),
      delay: metrics.videoDelay.get(userId)?.value
    },
    audio: {
      latency: metrics.audioLatency.get(userId)?.value,
      drops: metrics.audioDrops.get(userId),
      mos: metrics.audioMOS.get(userId)?.value
    },
    system: {
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage
    },
    timestamp: Date.now()
  };
}

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

  // Handle metrics updates from client
  socket.on('metrics-update', (data) => {
    const now = Date.now();
    const { userId } = data;
    
    // Update network metrics
    if (data.network) {
      if (data.network.latency !== undefined) {
        metrics.latency.set(userId, { value: data.network.latency, timestamp: now });
      }
      if (data.network.jitter !== undefined) {
        metrics.jitter.set(userId, { value: data.network.jitter, timestamp: now });
      }
      if (data.network.packetLoss !== undefined) {
        metrics.packetLoss.set(userId, { value: data.network.packetLoss, timestamp: now });
      }
      if (data.network.bandwidth) {
        metrics.bandwidth.set(userId, { 
          upload: data.network.bandwidth.upload,
          download: data.network.bandwidth.download,
          timestamp: now 
        });
      }
      if (data.network.bitrate) {
        metrics.bitrate.set(userId, { 
          video: data.network.bitrate.video,
          audio: data.network.bitrate.audio,
          timestamp: now 
        });
      }
    }
    
    // Update video metrics
    if (data.video) {
      if (data.video.frameRate !== undefined) {
        metrics.frameRate.set(userId, { value: data.video.frameRate, timestamp: now });
      }
      if (data.video.resolution) {
        metrics.resolution.set(userId, { 
          width: data.video.resolution.width,
          height: data.video.resolution.height,
          timestamp: now 
        });
      }
      if (data.video.freeze) {
        const freezeData = metrics.videoFreezes.get(userId) || { count: 0, duration: 0, lastEvent: 0 };
        freezeData.count++;
        freezeData.duration += data.video.freeze.duration || 0;
        freezeData.lastEvent = now;
        metrics.videoFreezes.set(userId, freezeData);
      }
      if (data.video.delay !== undefined) {
        metrics.videoDelay.set(userId, { value: data.video.delay, timestamp: now });
      }
    }
    
    // Update audio metrics
    if (data.audio) {
      if (data.audio.latency !== undefined) {
        metrics.audioLatency.set(userId, { value: data.audio.latency, timestamp: now });
      }
      if (data.audio.drop) {
        const dropData = metrics.audioDrops.get(userId) || { count: 0, duration: 0, lastEvent: 0 };
        dropData.count++;
        dropData.duration += data.audio.drop.duration || 0;
        dropData.lastEvent = now;
        metrics.audioDrops.set(userId, dropData);
      }
      if (data.audio.mos !== undefined) {
        metrics.audioMOS.set(userId, { value: data.audio.mos, timestamp: now });
      }
    }
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

// Get metrics for a specific user
app.get('/metrics/user/:userId', (req, res) => {
  const userId = req.params.userId;
  res.json(getUserMetrics(userId));
});

// Get metrics for all users in a room
app.get('/metrics/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const roomMetrics = {
    roomId,
    users: {},
    system: {
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage
    },
    timestamp: Date.now()
  };
  
  room.forEach(user => {
    roomMetrics.users[user.id] = getUserMetrics(user.id);
  });
  
  res.json(roomMetrics);
});

// Status Endpoint
app.get('/status', (req, res) => {
  const roomData = {};
  rooms.forEach((users, roomId) => {
    roomData[roomId] = users.map(u => ({
      id: u.id,
      name: u.name,
      isInitiator: u.isInitiator,
      metrics: getUserMetrics(u.id)
    }));
  });

  // Add system metrics to the status
  metrics.updateSystemMetrics();
  
  res.json({
    totalRooms: rooms.size,
    totalUsers: Array.from(rooms.values()).reduce((sum, users) => sum + users.length, 0),
    systemMetrics: {
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage
    },
    rooms: roomData
  });
});

// Health Check
app.get('/', (req, res) => {
  res.send('Video signaling server is running!');
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Status dashboard: http://localhost:${PORT}/status`);
});