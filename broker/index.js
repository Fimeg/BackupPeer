const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// In-memory storage for active peers and hosted slots
const peers = new Map();
const waitingPeers = new Map();
const hostedSlots = new Map(); // peerId -> hosted backup slot info
const peerConnections = new Map(); // socketId -> peer connection state

// Web redirect for browsers
app.get('/', (req, res) => {
  // Check if request is from a web browser
  const userAgent = req.headers['user-agent'] || '';
  const isWebBrowser = userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari');
  
  if (isWebBrowser) {
    // Redirect web browsers to the main site
    res.redirect(301, 'https://backup.wiuf.net');
  } else {
    // For non-browser clients, return a simple message
    res.json({ 
      service: 'BackupPeer Signaling Server',
      status: 'operational',
      message: 'WebSocket signaling only - web interface at https://backup.wiuf.net'
    });
  }
});

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    peers: peers.size, 
    waiting: waitingPeers.size,
    hosted: hostedSlots.size,
    connections: peerConnections.size,
    timestamp: Date.now()
  });
});

// Peer marketplace API - browse available peers
app.get('/api/peers/browse', (req, res) => {
  const availablePeers = Array.from(hostedSlots.values()).map(slot => ({
    peerId: slot.peerId,
    storage: slot.storage,
    location: slot.location || 'Unknown',
    trustLevel: slot.trustLevel || 'unknown',
    reputation: slot.reputation || 0.5,
    created: slot.created,
    expires: slot.expires,
    description: slot.description || '',
    requirements: slot.requirements || {}
  }));
  
  res.json({
    success: true,
    peers: availablePeers,
    total: availablePeers.length,
    timestamp: Date.now()
  });
});

// Peer requirements matching logic
function findCompatiblePeer(requirements) {
  for (const [peerId, peer] of waitingPeers) {
    // Basic matching - both peers need similar storage amounts
    const storageMatch = Math.abs(peer.requirements.storage - requirements.storage) < (requirements.storage * 0.2);
    
    if (storageMatch) {
      waitingPeers.delete(peerId);
      return peer;
    }
  }
  return null;
}

io.on('connection', (socket) => {
  console.log(`broker: Peer connected: ${socket.id}`);
  console.log(`Peer connected: ${socket.id}`);
  
  // Host a backup slot - create availability in marketplace
  socket.on('host-slot', (data) => {
    console.log(`broker: Received 'host-slot' from ${data.peerId}`);
    const { peerId, storage, duration, location, description, requirements } = data;
    
    console.log(`Peer ${peerId} hosting slot: ${storage} bytes for ${duration}ms`);
    
    const slot = {
      peerId,
      socketId: socket.id,
      storage,
      location: location || 'Unknown',
      description: description || '',
      requirements: requirements || {},
      created: Date.now(),
      expires: Date.now() + (duration || 2 * 60 * 60 * 1000), // 2 hours default
      status: 'available',
      trustLevel: data.trustLevel || 'unknown',
      reputation: data.reputation || 0.5
    };
    
    hostedSlots.set(peerId, slot);
    peers.set(socket.id, {
      id: peerId,
      socketId: socket.id,
      type: 'host',
      slot,
      timestamp: Date.now()
    });
    
    socket.emit('slot-hosted', {
      peerId,
      slotId: peerId,
      expires: slot.expires,
      status: 'available'
    });
    
    console.log(`Hosted slot created for ${peerId}, expires in ${duration}ms`);
  });
  
  // Connect to specific peer - replaces old announce/match system
  socket.on('connect-to-peer', (data) => {
    console.log(`broker: Received 'connect-to-peer' from ${data.requesterPeerId} to ${data.targetPeerId}`);
    const { targetPeerId, requesterPeerId, requirements } = data;
    
    console.log(`${requesterPeerId} requesting connection to ${targetPeerId}`);
    
    const targetSlot = hostedSlots.get(targetPeerId);
    if (!targetSlot) {
      socket.emit('connection-failed', {
        error: 'Target peer not found or no longer available',
        targetPeerId
      });
      return;
    }
    
    if (targetSlot.status !== 'available') {
      socket.emit('connection-failed', {
        error: 'Target peer is no longer available',
        targetPeerId
      });
      return;
    }
    
    // Check storage compatibility
    const storageMatch = targetSlot.storage >= (requirements.storage || 0);
    if (!storageMatch) {
      socket.emit('connection-failed', {
        error: 'Insufficient storage offered by target peer',
        offered: targetSlot.storage,
        required: requirements.storage
      });
      return;
    }
    
    // Notify target peer of connection request
    io.to(targetSlot.socketId).emit('connection-request', {
      requesterPeerId,
      requesterSocketId: socket.id,
      requirements,
      targetPeerId
    });
    
    // Store pending connection
    peerConnections.set(socket.id, {
      type: 'requester',
      peerId: requesterPeerId,
      targetPeerId,
      status: 'pending',
      timestamp: Date.now()
    });
    
    socket.emit('connection-pending', { targetPeerId });
    console.log(`Connection request sent from ${requesterPeerId} to ${targetPeerId}`);
  });
  
  // Accept connection request
  socket.on('accept-connection', (data) => {
    const { requesterPeerId, accept } = data;
    
    // Find the requester's socket
    let requesterSocket = null;
    for (const [socketId, connection] of peerConnections) {
      if (connection.peerId === requesterPeerId && connection.status === 'pending') {
        requesterSocket = socketId;
        break;
      }
    }
    
    if (!requesterSocket) {
      socket.emit('connection-error', { error: 'Requester no longer available' });
      return;
    }
    
    const myPeer = peers.get(socket.id);
    if (!myPeer) {
      socket.emit('connection-error', { error: 'Host peer data not found' });
      return;
    }
    
    if (accept) {
      // Mark slot as in use
      const slot = hostedSlots.get(myPeer.id);
      if (slot) {
        slot.status = 'in-use';
        slot.connectedTo = requesterPeerId;
      }
      
      // Notify both peers to start WebRTC handshake
      socket.emit('peer-matched', {
        peerId: requesterPeerId,
        socketId: requesterSocket,
        role: 'host'
      });
      
      io.to(requesterSocket).emit('peer-matched', {
        peerId: myPeer.id,
        socketId: socket.id,
        role: 'requester'
      });
      
      // Update connection status
      peerConnections.set(requesterSocket, {
        ...peerConnections.get(requesterSocket),
        status: 'accepted',
        hostPeerId: myPeer.id
      });
      
      console.log(`Connection accepted: ${requesterPeerId} ↔ ${myPeer.id}`);
    } else {
      // Reject connection
      io.to(requesterSocket).emit('connection-rejected', {
        hostPeerId: myPeer.id,
        reason: 'Host rejected connection'
      });
      
      peerConnections.delete(requesterSocket);
      console.log(`Connection rejected: ${requesterPeerId} → ${myPeer.id}`);
    }
  });
  
  
  
  // WebRTC signaling - offer
  socket.on('offer', (data) => {
    const { offer, targetPeer } = data;
    console.log(`Relaying offer from ${socket.id} to ${targetPeer}`);
    
    socket.to(targetPeer).emit('offer', {
      offer,
      fromPeer: socket.id
    });
  });
  
  // WebRTC signaling - answer
  socket.on('answer', (data) => {
    const { answer, targetPeer } = data;
    console.log(`Relaying answer from ${socket.id} to ${targetPeer}`);
    
    socket.to(targetPeer).emit('answer', {
      answer,
      fromPeer: socket.id
    });
  });
  
  // WebRTC signaling - ICE candidates
  socket.on('ice-candidate', (data) => {
    const { candidate, targetPeer } = data;
    
    socket.to(targetPeer).emit('ice-candidate', {
      candidate,
      fromPeer: socket.id
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Peer disconnected: ${socket.id}`);
    
    // Clean up from all data structures
    peers.delete(socket.id);
    waitingPeers.delete(socket.id);
  });
  
  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket ${socket.id} error:`, error);
  });
});

// Cleanup stale peers every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [socketId, peer] of waitingPeers) {
    if (now - peer.timestamp > maxAge) {
      console.log(`Removing stale peer: ${peer.id}`);
      waitingPeers.delete(socketId);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BackupPeer signaling server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});