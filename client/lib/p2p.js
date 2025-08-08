const SimplePeer = require('simple-peer');
const io = require('socket.io-client');
const { EventEmitter } = require('events');
const StorageVerification = require('./verification');
const ReputationSystem = require('./reputation');
const Database = require('./database');
const BackupCrypto = require('./crypto');
const RateLimiter = require('./rate-limiter');
const FileTransfer = require('./transfer');
const logger = require('./logger');

class P2PConnection extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.peerId = options.peerId || `peer-${Date.now()}`;
    this.signalingUrl = options.signalingUrl || 'wss://backup01.wiuf.net';
    this.requirements = options.requirements || { storage: 10 * 1024 * 1024 * 1024 }; // 10GB default
    
    this.socket = null;
    this.peer = null;
    this.isInitiator = false;
    this.connected = false;
    
    // Initialize verification and reputation systems
    this.verification = null;
    this.reputation = null;
    this.database = null;
    this.crypto = null;
    this.currentPeerId = null;
    this.fileTransfer = null;
    
    // Hash-based verification
    this.peerIdHash = null;
    this.peerIdentity = null;
    this.verifiedPeers = new Map(); // peerIdHash -> verification result
    
    // Connection resilience
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
    this.pingInterval = null;
    this.lastPingTime = null;
    this.connectionTimeout = 30000; // 30 seconds
    
    // Cached peer connections for resumption
    this.cachedPeers = new Map(); // peerIdHash -> { iceData, lastSeen, trustLevel }
    
    // Rate limiting for security
    this.rateLimiter = new RateLimiter({
      maxRequests: 100, // 100 requests per minute
      windowMs: 60000,
      maxBurst: 20, // 20 requests per second max
      burstWindowMs: 1000
    });
    
    // Set up rate limiter event handlers
    this.rateLimiter.on('rate_limited', (info) => {
      console.warn(`Rate limited peer ${info.peerId}: ${info.reason} for ${info.messageType}`);
      this.emit('peer_rate_limited', info);
    });
    
    this.rateLimiter.on('peer_banned', (info) => {
      console.warn(`Banned peer ${info.peerId} for ${info.durationMs}ms due to rate limit violations`);
      this.emit('peer_banned', info);
    });
    
    logger.info('Initializing P2P connection - PeerId: %s, Server: %s', this.peerId, this.signalingUrl);
    logger.debug('P2P requirements: %j', this.requirements);
    console.log(`Initializing P2P connection for peer: ${this.peerId}`);
  }
  
  // Initialize verification systems with hash-based crypto
  async initializeVerificationSystems() {
    try {
      logger.info('Initializing verification systems...');
      
      this.database = new Database();
      await this.database.initialize();
      
      this.reputation = new ReputationSystem();
      await this.reputation.initialize();
      
      this.crypto = new BackupCrypto();
      await this.crypto.initializeKeys();
      
      // Generate my peer identity hash
      this.peerIdHash = this.crypto.getMyPeerIdHash();
      this.peerIdentity = this.crypto.createPeerIdentity();
      
      // Initialize file transfer system
      this.fileTransfer = new FileTransfer(this, this.crypto, this.database);
      
      // Load cached peer connections from database
      await this.loadCachedPeers();
      
      logger.info('Verification systems initialized - PeerIdHash: %s', this.peerIdHash);
      console.log(`Verification systems initialized. My peer ID hash: ${this.peerIdHash}`);
    } catch (error) {
      logger.error('Failed to initialize verification systems:', error);
      console.error('Failed to initialize verification systems:', error.message);
    }
  }

  // Main connection method that was missing
  async connect() {
    // Initialize verification systems first
    await this.initializeVerificationSystems();
    
    return new Promise((resolve, reject) => {
      logger.info('P2P connect() called - connecting to signaling server');
      console.log(`Connecting to signaling server: ${this.signalingUrl}`);
      
      this.socket = io(this.signalingUrl);
      
      this.socket.on('connect', () => {
        logger.info('Connected to signaling server, announcing with requirements: %j', this.requirements);
        console.log('Connected to signaling server, announcing presence...');
        
        // Send announce message with requirements
        this.socket.emit('announce', {
          peerId: this.peerId,
          requirements: this.requirements,
          publicKey: this.crypto?.getPublicKeyHex() || 'temp-key'
        });
      });
      
      this.socket.on('waiting', () => {
        logger.debug('P2P state: waiting for compatible peer');
        console.log('Waiting for compatible peer...');
        this.emit('waiting');
      });
      
      this.socket.on('matched', (data) => {
        logger.info('P2P matched with peer: %s, initiating WebRTC as %s', data.peerId, this.isInitiator ? 'initiator' : 'receiver');
        console.log(`Matched with peer: ${data.peerId}`);
        this.currentPeerId = data.peerId;
        this.emit('matched', data);
        
        // Store the matched peer's socket ID for WebRTC signaling
        this.isInitiator = true;
        this.initializeWebRTC(data.socketId);
      });
      
      this.socket.on('error', (error) => {
        logger.error('Signaling server error:', error);
        console.error('Signaling server error:', error);
        reject(error);
      });
      
      this.socket.on('disconnect', () => {
        logger.warn('Disconnected from signaling server before P2P established');
        console.log('Disconnected from signaling server');
        if (!this.connected) {
          reject(new Error('Disconnected before establishing P2P connection'));
        }
      });
      
      // Set up additional signaling handlers
      this.setupSignalingHandlers();
      
      // Resolve promise once socket is connected
      this.socket.on('connect', () => {
        resolve();
      });
    });
  }

  // Load cached peer connections for resumption
  async loadCachedPeers() {
    try {
      const cachedData = await this.database.getCachedPeers();
      for (const peerData of cachedData) {
        this.cachedPeers.set(peerData.peerIdHash, {
          iceData: peerData.iceData,
          lastSeen: peerData.lastSeen,
          trustLevel: peerData.trustLevel,
          publicKey: peerData.publicKey
        });
      }
      console.log(`Loaded ${this.cachedPeers.size} cached peer connections`);
    } catch (error) {
      console.log('No cached peers found or failed to load:', error.message);
    }
  }

  // Cache peer connection data for resumption
  async cachePeerConnection(peerIdHash, iceData, trustLevel, publicKey) {
    try {
      const peerData = {
        peerIdHash,
        iceData: JSON.stringify(iceData),
        lastSeen: Date.now(),
        trustLevel,
        publicKey
      };
      
      this.cachedPeers.set(peerIdHash, peerData);
      await this.database.cachePeerConnection(peerData);
      
      console.log(`Cached connection data for peer: ${peerIdHash}`);
    } catch (error) {
      console.error('Failed to cache peer connection:', error.message);
    }
  }

  // Verify peer identity using hash-based verification
  async verifyPeerIdentity(peerIdentity) {
    try {
      const verification = this.crypto.verifyPeerIdHash(peerIdentity);
      
      if (!verification.valid) {
        console.warn(`Peer verification failed: ${verification.reason}`);
        return { verified: false, reason: verification.reason };
      }
      
      // Store verification result
      this.verifiedPeers.set(verification.peerIdHash, {
        verified: true,
        trustLevel: verification.trustLevel,
        publicKey: verification.publicKey,
        timestamp: Date.now()
      });
      
      console.log(`Peer ${verification.peerIdHash} verified with ${verification.trustLevel} trust`);
      
      return {
        verified: true,
        peerIdHash: verification.peerIdHash,
        trustLevel: verification.trustLevel,
        publicKey: verification.publicKey
      };
    } catch (error) {
      console.error('Peer verification error:', error.message);
      return { verified: false, reason: error.message };
    }
  }

  // Start connection keepalive pings
  startKeepalive() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    this.pingInterval = setInterval(() => {
      if (this.connected && this.peer) {
        this.sendPing();
      }
    }, 30000); // Ping every 30 seconds
  }

  // Stop keepalive pings  
  stopKeepalive() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Send ping message for connection monitoring
  sendPing() {
    if (!this.connected || !this.peer) return;
    
    try {
      const pingData = {
        type: 'ping',
        timestamp: Date.now(),
        peerIdHash: this.peerIdHash,
        nonce: this.crypto.generateSessionProof({
          iceCandidate: null,
          timestamp: Date.now(),
          nonce: Math.random().toString(36)
        }).nonce
      };
      
      this.peer.send(JSON.stringify(pingData));
      this.lastPingTime = Date.now();
    } catch (error) {
      console.error('Failed to send ping:', error.message);
      this.handleConnectionDrop();
    }
  }

  // Handle connection drop and attempt reconnection
  async handleConnectionDrop() {
    console.log('Connection dropped, attempting to reconnect...');
    this.connected = false;
    this.stopKeepalive();
    
    // Update database with connection failure if we have a current peer
    if (this.currentPeerId && this.database) {
      await this.database.updatePeerConnectionSuccess(this.currentPeerId, false);
    }
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
      
      console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
      
      setTimeout(() => {
        this.attemptReconnection();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.emit('connection_failed', { reason: 'Max reconnection attempts exceeded' });
    }
  }

  // Attempt to reconnect using cached peer data
  async attemptReconnection() {
    try {
      // Try to reconnect to known peers first
      for (const [peerIdHash, cachedData] of this.cachedPeers) {
        if (Date.now() - cachedData.lastSeen < 3600000) { // Within last hour
          console.log(`Attempting direct reconnection to cached peer: ${peerIdHash}`);
          
          try {
            await this.connectToCachedPeer(peerIdHash, cachedData);
            return; // Success!
          } catch (error) {
            console.log(`Direct reconnection failed: ${error.message}`);
          }
        }
      }
      
      // Fall back to signaling server reconnection
      console.log('Falling back to signaling server reconnection...');
      await this.connect();
      
    } catch (error) {
      console.error('Reconnection attempt failed:', error.message);
      this.handleConnectionDrop(); // Try again
    }
  }

  // Connect to cached peer using stored ICE data
  async connectToCachedPeer(peerIdHash, cachedData) {
    return new Promise((resolve, reject) => {
      try {
        const iceData = JSON.parse(cachedData.iceData);
        
        // Create new peer connection with cached ICE data
        this.peer = new SimplePeer({
          initiator: true,
          trickle: false,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });
        
        // Set up peer event handlers
        this.setupPeerEventHandlers(resolve, reject);
        
        // Attempt to signal with cached ICE data
        this.peer.signal(iceData);
        
        // Set timeout for connection attempt
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Cached peer connection timeout'));
          }
        }, this.connectionTimeout);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  
  
  setupSignalingHandlers() {
    // Handle connection request when we're hosting
    this.socket.on('connection-request', (data) => {
      console.log(`[HOST] Received connection request:`, JSON.stringify(data, null, 2));
      this.emit('connection_request', data);
      
      console.log(`[HOST] Sending accept-connection response`);
      this.socket.emit('accept-connection', {
        requesterPeerId: data.requesterPeerId,
        accept: true
      });
    });

    // Handle when we're matched as a requester
    this.socket.on('peer-matched', (data) => {
      console.log(`[${data.role.toUpperCase()}] Matched with peer:`, JSON.stringify(data, null, 2));
      this.currentPeerId = data.peerId;
      
      if (data.role === 'requester') {
        this.isInitiator = true;
      } else {
        this.isInitiator = false;
      }
      
      this.initializeWebRTC(data.socketId);
      this.emit('matched', data);
    });

    // Handle connection rejection
    this.socket.on('connection-rejected', (data) => {
      console.error(`Connection rejected by ${data.hostPeerId}: ${data.reason}`);
      this.emit('connection_rejected', data);
    });

    // Handle connection failures
    this.socket.on('connection-failed', (data) => {
      console.error(`Connection failed: ${data.error}`);
      this.emit('connection_failed', data);
    });

    // Handle slot hosted confirmation
    this.socket.on('slot-hosted', (data) => {
      console.log(`Slot hosted successfully: ${data.slotId}`);
      this.emit('slot_hosted', data);
    });

    // Handle incoming WebRTC offer
    this.socket.on('offer', (data) => {
      console.log(`[WebRTC] Received offer from ${data.fromPeer}`);
      
      if (!this.peer) {
        this.isInitiator = false;
        this.initializeWebRTC(data.fromPeer);
      }
      
      this.peer.signal(data.offer);
    });
    
    // Handle incoming WebRTC answer
    this.socket.on('answer', (data) => {
      console.log(`[WebRTC] Received answer from ${data.fromPeer}`);
      if (this.peer) {
        this.peer.signal(data.answer);
      }
    });
    
    // Handle incoming ICE candidates
    this.socket.on('ice-candidate', (data) => {
      console.log(`[WebRTC] Received ICE candidate from ${data.fromPeer}`);
      if (this.peer) {
        this.peer.signal(data.candidate);
      }
    });
  }
  
  initializeWebRTC(targetSocketId) {
    console.log(`[WebRTC] Initializing connection (initiator: ${this.isInitiator}) to target: ${targetSocketId}`);
    
    this.peer = new SimplePeer({
      initiator: this.isInitiator,
      wrtc: require('wrtc'), // Use Node.js WebRTC implementation
      trickle: true // Enable trickle ICE for faster connection setup
    });
    
    this.peer.on('signal', (data) => {
      const signalType = data.type || (data.candidate ? 'candidate' : 'unknown');
      console.log(`[WebRTC] Emitting signal: ${signalType}`);
      
      if (data.type === 'offer') {
        this.socket.emit('offer', {
          offer: data,
          targetPeer: targetSocketId
        });
      } else if (data.type === 'answer') {
        this.socket.emit('answer', {
          answer: data,
          targetPeer: targetSocketId
        });
      } else if (data.candidate) {
        // ICE candidate
        this.socket.emit('ice-candidate', {
          candidate: data,
          targetPeer: targetSocketId
        });
      } else {
        console.warn('[WebRTC] Unknown signal data:', data);
      }
    });
    
    this.peer.on('connect', async () => {
      console.log('p2p.js: P2P connection established!');
      console.log('P2P connection established!');
      this.connected = true;
      this.reconnectAttempts = 0; // Reset reconnection counter
      
      // Record successful connection in reputation system
      if (this.reputation && this.currentPeerId) {
        this.reputation.recordConnection(this.currentPeerId, 0, true);
      }
      
      // Update database with successful connection
      if (this.currentPeerId && this.database) {
      // Start health checks\n      this.startHealthChecks();\n
        await this.database.updatePeerConnectionSuccess(this.currentPeerId, true);
      }
      
      // Exchange peer identities for verification
      await this.exchangePeerIdentities();
      
      // Start keepalive pings for connection monitoring
      this.startKeepalive();
      
      this.emit('connected');
      
      // Close signaling server connection - no longer needed
      if (this.socket) {
        this.socket.disconnect();
      }
    });
    
    this.peer.on('data', (data) => {
      const message = JSON.parse(data.toString());
      console.log('p2p.js: Received P2P message:', message.type);
      const senderId = this.currentPeerId || 'unknown';
      
      // Check rate limiting first
      if (!this.rateLimiter.isAllowed(senderId, message.type)) {
        console.warn(`Rate limited message from ${senderId}: ${message.type}`);
        
        // Check if peer should be banned for repeated violations
        const stats = this.rateLimiter.getStats(senderId);
        if (stats.windowUtilization > 90 || stats.burstUtilization > 95) {
          this.rateLimiter.banPeer(senderId, 300000); // 5 minute ban
          this.emit('peer_misbehaving', { peerId: senderId, reason: 'rate_limit_violation' });
        }
        return;
      }
      
      console.log('Received P2P message:', message.type);
      
      // Handle ping/pong for connection monitoring
      if (message.type === 'ping') {
        this.handlePing(message);
        return;
      } else if (message.type === 'pong') {
        this.handlePong(message);
        return;
      }
      
      // Handle peer identity verification
      if (message.type === 'peer_identity') {
        this.handlePeerIdentityMessage(message);
        return;
      }
      
      // Handle file transfer messages
      if (this.fileTransfer && this.isFileTransferMessage(message.type)) {
        this.fileTransfer.handleTransferMessage(message, senderId);
        return;
      }
      
      // Handle verification messages
      this.handleVerificationMessage(message);
      
      this.emit('message', message);
    });
    
    this.peer.on('error', (error) => {
      console.error('P2P connection error:', error);
      this.emit('error', error);
    });
    
    this.peer.on('close', () => {
      console.log('P2P connection closed');
      // Stop health checks\n      this.stopHealthChecks();\n
      this.connected = false;
      this.emit('disconnected');
    });
  // Send message over P2P connection

  send(message) {

    console.log(`[P2P] Sending message: ${message.type || "unknown"} (connected: ${this.connected})`);

    if (this.connected && this.peer) {

      try {

        const data = JSON.stringify(message);

        this.peer.send(data);

        console.log(`[P2P] Message sent successfully: ${message.type || "unknown"}`);

        return true;

      } catch (error) {

        console.error(`[P2P] Failed to send message: ${message.type || "unknown"}`, error);

        return false;

      }

    } else {

      console.warn(`[P2P] Cannot send message - not connected (connected: ${this.connected}, peer: ${!!this.peer})`);

      return false;

    }

  }
      console.warn(`[P2P] Cannot send message - not connected (connected: ${this.connected}, peer: ${!!this.peer})`);
      return false;
  
  // Send a test ping
  ping() {
    return this.send({
      type: 'ping',
      timestamp: Date.now(),
      from: this.peerId
    });
  }
  
  // Handle ping response
  handlePing(message) {
    try {
      const pongData = {
        type: 'pong',
        timestamp: Date.now(),
        originalTimestamp: message.timestamp,
        peerIdHash: this.peerIdHash,
        nonce: message.nonce
      };
      
      this.peer.send(JSON.stringify(pongData));
    } catch (error) {
      console.error('Failed to respond to ping:', error.message);
    }
  }

  // Handle pong response
  handlePong(message) {
    const latency = Date.now() - message.originalTimestamp;
    console.log(`Connection latency: ${latency}ms`);
    
    // Update connection statistics
    this.emit('ping_response', { latency, timestamp: message.timestamp });
  }

  // Handle peer identity verification messages
  async handlePeerIdentityMessage(message) {
    try {
      const verification = await this.verifyPeerIdentity(message.identity);
      
      if (verification.verified) {
        // Cache the verified peer connection
        await this.cachePeerConnection(
          verification.peerIdHash,
          message.iceData || {},
          verification.trustLevel,
          verification.publicKey
        );
        
        console.log(`Peer identity verified: ${verification.peerIdHash}`);
        this.currentPeerId = verification.peerIdHash;
      } else {
        console.warn(`Peer identity verification failed: ${verification.reason}`);
        this.emit('verification_failed', verification);
      }
    } catch (error) {
      console.error('Error handling peer identity:', error.message);
    }
  }

  // Handle verification-related messages
  handleVerificationMessage(message) {
    if (!this.verification) return;
    
    switch (message.type) {
      case 'storage_challenge':
        this.verification.handleChallenge(message.challenge, message.fromPeer || this.currentPeerId);
        break;
        
      case 'storage_proof':
        this.verification.handleProof(message.challengeId, message.proof, message.fromPeer || this.currentPeerId);
        break;
        
      case 'storage_commitment':
        // Handle storage commitment exchange
        console.log('Received storage commitment from peer');
        break;
        
      default:
        // Not a verification message, continue normal processing
        break;
    }
  }
  
  // Check if message type is a file transfer message
  isFileTransferMessage(messageType) {
    const transferMessageTypes = [
      'file_start',
      'file_chunk', 
      'file_complete',
      'file_start_ack',
      'file_complete_ack',
      'chunk_ack',
      'backup_start',
      'backup_complete'
    ];
    return transferMessageTypes.includes(messageType);
  }
  
  // Send file using integrated file transfer system
  async sendFile(filePath, targetDirectory = null) {
    if (!this.fileTransfer || !this.connected) {
      throw new Error('File transfer not available - no connection or transfer system not initialized');
    }
    
    if (!this.currentPeerId) {
      throw new Error('No authenticated peer connection');
    }
    
    return this.fileTransfer.sendFile(filePath, this.currentPeerId);
  }
  
  // Send multiple files as backup
  async sendBackup(filePaths, backupName = null) {
    if (!this.fileTransfer || !this.connected) {
      throw new Error('File transfer not available - no connection or transfer system not initialized');
    }
    
    if (!this.currentPeerId) {
      throw new Error('No authenticated peer connection');
    }
    
    return this.fileTransfer.sendBackup(filePaths, this.currentPeerId, backupName);
  }
  
  // Get transfer status
  getTransferStatus(transferId) {
    if (!this.fileTransfer) {
      return null;
    }
    return this.fileTransfer.getTransferStatus(transferId);
  }
  
  // List active transfers
  listTransfers() {
    if (!this.fileTransfer) {
      return [];
    }
    return this.fileTransfer.listTransfers();
  }
  
  // Set storage context for verification
  setStorageContext(storage) {
    if (this.database && this.reputation) {
      this.verification = new StorageVerification(storage, this);
      
      // Set up verification event handlers
      this.verification.on('verification_result', (result) => {
        console.log(`Verification result: ${result.success ? 'PASS' : 'FAIL'}`);
        
        // Record in reputation system
        if (this.reputation) {
          this.reputation.recordVerification(result.peerId, result.success, result.responseTime);
        }
      });
      
      console.log('Storage verification context set');
    }
  }
  
  // Send storage challenge
  async sendStorageChallenge(backupId, challengeType = 'random_blocks') {
    if (!this.verification || !this.currentPeerId) {
      throw new Error('Verification system not initialized or no peer connected');
    }
    
    return this.verification.sendChallenge(this.currentPeerId, backupId);
  }
  
  // Start monitoring mode (periodic verification)
  startMonitoring(intervalHours = 24) {
    if (this.verification) {
      this.verification.startPeriodicVerification(intervalHours);
      console.log(`Started monitoring with ${intervalHours}h interval`);
    }
  }
  
  // Stop monitoring
  stopMonitoring() {
    if (this.verification) {
      this.verification.stopPeriodicVerification();
      console.log('Stopped monitoring');
    }
  }
  
  // Get peer statistics
  getPeerStats() {
    if (this.reputation && this.currentPeerId) {
      return this.reputation.getPeerReputation(this.currentPeerId);
    }
    return null;
  }
  
  // Exchange peer identities for hash-based verification
  async exchangePeerIdentities() {
    if (!this.peerIdentity || !this.connected) return;
    
    try {
      const identityMessage = {
        type: 'peer_identity',
        identity: this.peerIdentity,
        timestamp: Date.now()
      };
      
      this.peer.send(JSON.stringify(identityMessage));
      console.log('Sent peer identity for verification');
    } catch (error) {
      console.error('Failed to exchange peer identity:', error.message);
    }
  }

  // Get cached peer connection statistics
  async getPeerStats(peerIdHash) {
    if (!this.database) return null;
    return this.database.getPeerConnectionStats(peerIdHash);
  }

  // List all cached peers with their trust levels
  async listCachedPeers(trustLevel = null, maxAge = 86400000) {
    if (!this.database) return [];
    return this.database.getCachedPeers(trustLevel, maxAge);
  }

  // Remove stale peer connections from cache
  async cleanupStaleConnections(maxAge = 2592000000) {
    if (!this.database) return;
    const result = await this.database.removeStalePeerConnections(maxAge);
    console.log(`Removed ${result.changes} stale peer connections`);
    return result;
  }

  // Host a backup slot
  async hostSlot(storageOffered, duration = 2 * 60 * 60 * 1000, location = 'Sovereign Territory') {
    await this.initializeVerificationSystems();
    
    return new Promise((resolve) => {  // Remove reject - we want to keep running
      console.log(`Connecting to signaling server: ${this.signalingUrl}`);
      
      this.socket = io(this.signalingUrl);
      
      this.socket.on('connect', () => {
        // Set up ALL signaling handlers first
        this.setupSignalingHandlers();
        
        // THEN register the slot
        console.log('Connected to signaling server, registering host slot...');
        
        const slotData = {
          peerId: this.peerId,
          storage: storageOffered,
          duration: duration,
          location: location,
          description: 'Sovereign backup slot',
          publicKey: this.crypto?.getPublicKeyHex() || 'temp-key',
          trustLevel: 'acceptable',
          reputation: 0.75
        };
        
        this.socket.emit('host-slot', slotData);
      });
      
      this.socket.on('slot-hosted', (data) => {
        console.log('Slot hosted successfully!');
        resolve(data);
        // Don't disconnect! Keep listening for connections
      });
      
      this.socket.on('error', (error) => {
        console.error('Signaling server error:', error);
        // Don't reject - log and continue
      });
    });
  }

  // Connect to a specific peer using the marketplace protocol
  async connectToPeer(targetPeerId) {
    await this.initializeVerificationSystems();

    return new Promise((resolve, reject) => {
      console.log(`Connecting to signaling server: ${this.signalingUrl}`);

      this.socket = io(this.signalingUrl);

      // Set up all signaling handlers BEFORE connecting to ensure no race conditions
      this.setupSignalingHandlers();

      this.socket.on('connect', () => {
        console.log('Connected to signaling server, sending connection request...');
        this.socket.emit('connect-to-peer', {
          targetPeerId: targetPeerId,
          requesterPeerId: this.peerId,
          requirements: this.requirements
        });
      });

      this.socket.on('peer-matched', (data) => {
        console.log(`[P2PConnection] Matched with peer: ${data.peerId}, initiating WebRTC.`);
        this.currentPeerId = data.peerId;
        this.isInitiator = true; // The 'connectToPeer' caller is always the initiator
        this.initializeWebRTC(data.socketId);
        // DO NOT RESOLVE HERE. Resolution happens on 'connected' event.
      });

      this.socket.on('connection-failed', (data) => {
        reject(new Error(data.error));
      });

      this.socket.on('connection-pending', (data) => {
        console.log(`Connection request sent to ${data.targetPeerId}, waiting for acceptance...`);
      });

      this.socket.on('error', (error) => {
        console.error('Signaling server error:', error);
        reject(error);
      });

      // CRITICAL: Resolve the promise ONLY when the WebRTC connection is established
      this.once('connected', () => {
        console.log('[P2PConnection] WebRTC connection established, resolving connectToPeer promise.');
        resolve();
      });

      // Add a timeout for the overall connection process
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('P2P connection timed out.'));
        }
      }, this.connectionTimeout); // Use the existing connectionTimeout
    });
  }

  // Close all connections
  async close() {
    // Stop monitoring if active
    this.stopMonitoring();
    
    // Stop keepalive pings
    this.stopKeepalive();
    
    // Close P2P connection
    if (this.peer) {
      this.peer.destroy();
    }
    
    // Close signaling connection
    if (this.socket) {
      this.socket.disconnect();
    }
    
    // Close database connection
    if (this.database) {
      await this.database.close();
    }
    
    this.connected = false;
    console.log('All connections closed');
  }
}

\n  // Check if connection is healthy\n
  isConnectionHealthy() {\n
    const healthy = this.connected && this.peer && this.socket;\n
    console.log(`[P2P] Connection health check - connected: ${this.connected}, peer: ${!!this.peer}, socket: ${!!this.socket} -> ${healthy}`);\n
    return healthy;\n
  }\n
\n
  // Start periodic health checks\n
  startHealthChecks() {\n
    if (this.healthCheckInterval) {\n
      clearInterval(this.healthCheckInterval);\n
    }\n
    \n
    this.healthCheckInterval = setInterval(() => {\n
      if (!this.isConnectionHealthy()) {\n
        console.warn("[P2P] Connection health check failed");\n
        this.emit("connection_unhealthy");\n
      }\n
    }, 30000); // Check every 30 seconds\n
  }\n
\n
  // Stop health checks\n
  stopHealthChecks() {\n
    if (this.healthCheckInterval) {\n
      clearInterval(this.healthCheckInterval);\n
      this.healthCheckInterval = null;\n
    }\n
  }\n
module.exports = P2PConnection;