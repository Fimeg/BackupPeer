const crypto = require('crypto');
const cron = require('node-cron');
const { EventEmitter } = require('events');
const BackupCrypto = require('./crypto');

class StorageVerification extends EventEmitter {
  constructor(storage, p2pConnection) {
    super();
    this.storage = storage;
    this.connection = p2pConnection;
    this.verificationInterval = null;
    this.activeVerifications = new Map(); // backupId -> verification state
    this.peerCommitments = new Map(); // peerId -> commitment data
    this.challengeHistory = new Map(); // peerId -> challenge results
  }
  
  // Storage commitment protocol
  createStorageCommitment(storageOffered, terms = {}) {
    const commitment = {
      peerId: this.connection.peerId,
      publicKey: this.connection.crypto?.getPublicKeyHex() || 'temp-key',
      storageOffered: storageOffered, // bytes
      availabilityGuarantee: terms.availability || '24/7',
      retentionPeriod: terms.retention || 365 * 24 * 60 * 60 * 1000, // 1 year
      redundancyLevel: terms.redundancy || 1,
      timestamp: Date.now(),
      expiresAt: Date.now() + (terms.duration || 365 * 24 * 60 * 60 * 1000),
      terms: {
        maxFileSize: terms.maxFileSize || 1024 * 1024 * 1024, // 1GB
        allowedFileTypes: terms.allowedFileTypes || ['*'],
        verificationFrequency: terms.verificationFreq || 24 * 60 * 60 * 1000 // daily
      }
    };
    
    // Sign commitment with private key (simplified)
    const commitmentData = JSON.stringify({
      peerId: commitment.peerId,
      storageOffered: commitment.storageOffered,
      timestamp: commitment.timestamp,
      expiresAt: commitment.expiresAt
    });
    
    commitment.signature = this.signCommitment(commitmentData);
    commitment.hash = BackupCrypto.hashData(commitmentData);
    
    return commitment;
  }
  
  // Secure commitment signing using Ed25519
  signCommitment(data) {
    if (!this.connection.crypto || !this.connection.crypto.getKeyPair) {
      throw new Error('Crypto system not initialized - cannot sign commitments');
    }
    
    const sodium = require('sodium-native');
    const keyPair = this.connection.crypto.getKeyPair();
    
    const message = Buffer.from(data, 'utf8');
    const signature = Buffer.alloc(sodium.crypto_sign_BYTES);
    
    sodium.crypto_sign_detached(signature, message, keyPair.privateKey);
    
    return {
      signature: signature.toString('hex'),
      publicKey: keyPair.publicKey.toString('hex'),
      algorithm: 'Ed25519'
    };
  }
  
  // Verify peer's storage commitment
  verifyCommitment(commitment) {
    try {
      // Check signature using Ed25519 verification
      const commitmentData = JSON.stringify({
        peerId: commitment.peerId,
        storageOffered: commitment.storageOffered,
        timestamp: commitment.timestamp,
        expiresAt: commitment.expiresAt
      });
      
      if (!commitment.signature || typeof commitment.signature !== 'object') {
        return { valid: false, reason: 'Invalid signature format' };
      }
      
      const sodium = require('sodium-native');
      const message = Buffer.from(commitmentData, 'utf8');
      const signature = Buffer.from(commitment.signature.signature, 'hex');
      const publicKey = Buffer.from(commitment.signature.publicKey, 'hex');
      
      // Validate key and signature lengths for Ed25519
      if (!publicKey || publicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES) {
        return { valid: false, reason: 'Invalid public key length for Ed25519 signature' };
      }
      
      if (!signature || signature.length !== sodium.crypto_sign_BYTES) {
        return { valid: false, reason: 'Invalid signature length for Ed25519' };
      }
      
      // Verify Ed25519 signature
      const isValid = sodium.crypto_sign_verify_detached(signature, message, publicKey);
      
      if (!isValid) {
        return { valid: false, reason: 'Invalid Ed25519 signature' };
      }
      
      // Verify public key matches peer ID
      if (commitment.signature.publicKey !== commitment.publicKey) {
        return { valid: false, reason: 'Public key mismatch' };
      }
      
    } catch (error) {
      return { valid: false, reason: `Signature verification failed: ${error.message}` };
    }
    
    // Check expiration
    if (Date.now() > commitment.expiresAt) {
      return { valid: false, reason: 'Commitment expired' };
    }
    
    // Check storage amount is reasonable
    if (commitment.storageOffered < 1024 * 1024) { // < 1MB
      return { valid: false, reason: 'Storage offering too small' };
    }
    
    if (commitment.storageOffered > 1024 * 1024 * 1024 * 1024) { // > 1TB
      return { valid: false, reason: 'Storage offering suspiciously large' };
    }
    
    return { valid: true };
  }
  
  // Exchange commitments with peer
  async exchangeCommitments(peerConnection, myStorageOffering) {
    const myCommitment = this.createStorageCommitment(myStorageOffering);
    
    return new Promise((resolve, reject) => {
      // Send our commitment
      peerConnection.send({
        type: 'storage_commitment',
        commitment: myCommitment
      });
      
      // Wait for peer's commitment
      const timeout = setTimeout(() => {
        reject(new Error('Commitment exchange timeout'));
      }, 30000);
      
      const messageHandler = (message) => {
        if (message.type === 'storage_commitment') {
          clearTimeout(timeout);
          peerConnection.off('message', messageHandler);
          
          const verification = this.verifyCommitment(message.commitment);
          if (!verification.valid) {
            reject(new Error(`Invalid peer commitment: ${verification.reason}`));
            return;
          }
          
          // Store peer's commitment
          this.peerCommitments.set(message.commitment.peerId, message.commitment);
          
          resolve({
            myCommitment,
            peerCommitment: message.commitment
          });
        }
      };
      
      peerConnection.on('message', messageHandler);
    });
  }
  
  // Generate challenge for storage proof
  generateChallenge(backupId, challengeType = 'random_blocks') {
    const challenge = {
      id: `challenge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      backupId,
      type: challengeType,
      timestamp: Date.now(),
      expiresAt: Date.now() + (5 * 60 * 1000), // 5 minutes to respond
    };
    
    switch (challengeType) {
      case 'random_blocks':
        // Request proof for random file chunks
        challenge.blockIndices = this.generateRandomIndices(10, 1000); // 10 random blocks out of ~1000
        break;
        
      case 'file_hash':
        // Request hash of specific files
        challenge.fileIndices = this.generateRandomIndices(3, 10); // 3 random files
        break;
        
      case 'metadata_proof':
        // Request backup metadata verification
        challenge.nonce = crypto.randomBytes(32).toString('hex');
        break;
        
      default:
        throw new Error(`Unknown challenge type: ${challengeType}`);
    }
    
    return challenge;
  }
  
  generateRandomIndices(count, max) {
    const indices = new Set();
    while (indices.size < count && indices.size < max) {
      indices.add(Math.floor(Math.random() * max));
    }
    return Array.from(indices);
  }
  
  // Send storage challenge to peer
  async sendChallenge(peerId, backupId) {
    const challenge = this.generateChallenge(backupId);
    
    this.activeVerifications.set(challenge.id, {
      challenge,
      peerId,
      backupId,
      startTime: Date.now(),
      status: 'pending'
    });
    
    this.connection.send({
      type: 'storage_challenge',
      challenge
    });
    
    console.log(`Sent storage challenge ${challenge.id} to ${peerId}`);
    
    // Set timeout for response
    setTimeout(() => {
      const verification = this.activeVerifications.get(challenge.id);
      if (verification && verification.status === 'pending') {
        verification.status = 'timeout';
        this.handleVerificationResult(challenge.id, null, 'Challenge timeout');
      }
    }, challenge.expiresAt - Date.now());
    
    return challenge.id;
  }
  
  // Handle incoming storage challenge
  async handleChallenge(challenge, fromPeer) {
    console.log(`Received storage challenge ${challenge.id} from ${fromPeer}`);
    
    try {
      const backup = this.storage.getBackup(challenge.backupId);
      if (!backup) {
        throw new Error(`Backup not found: ${challenge.backupId}`);
      }
      
      let proof;
      
      switch (challenge.type) {
        case 'random_blocks':
          proof = await this.generateBlockProof(backup, challenge.blockIndices);
          break;
          
        case 'file_hash':
          proof = await this.generateFileHashProof(backup, challenge.fileIndices);
          break;
          
        case 'metadata_proof':
          proof = await this.generateMetadataProof(backup, challenge.nonce);
          break;
          
        default:
          throw new Error(`Unsupported challenge type: ${challenge.type}`);
      }
      
      // Send proof response
      this.connection.send({
        type: 'storage_proof',
        challengeId: challenge.id,
        proof,
        timestamp: Date.now()
      });
      
      console.log(`Sent storage proof for challenge ${challenge.id}`);
      
    } catch (error) {
      console.error(`Failed to handle challenge ${challenge.id}:`, error.message);
      
      // Send error response
      this.connection.send({
        type: 'storage_proof',
        challengeId: challenge.id,
        error: error.message,
        timestamp: Date.now()
      });
    }
  }
  
  // Generate proof for random block challenge
  async generateBlockProof(backup, blockIndices) {
    const proof = {
      type: 'random_blocks',
      backupId: backup.id,
      blocks: []
    };
    
    // For each requested block, provide hash
    for (const blockIndex of blockIndices) {
      if (blockIndex < backup.files.length) {
        const file = backup.files[blockIndex];
        proof.blocks.push({
          index: blockIndex,
          hash: file.hash,
          size: file.size
        });
      }
    }
    
    return proof;
  }
  
  // Generate proof for file hash challenge
  async generateFileHashProof(backup, fileIndices) {
    const proof = {
      type: 'file_hash',
      backupId: backup.id,
      files: []
    };
    
    for (const fileIndex of fileIndices) {
      if (fileIndex < backup.files.length) {
        const file = backup.files[fileIndex];
        proof.files.push({
          index: fileIndex,
          name: file.name || file.path,
          hash: file.hash,
          size: file.size
        });
      }
    }
    
    return proof;
  }
  
  // Generate proof for metadata challenge
  async generateMetadataProof(backup, nonce) {
    const metadataHash = BackupCrypto.hashData(JSON.stringify({
      backupId: backup.id,
      timestamp: backup.timestamp,
      fileCount: backup.files.length,
      nonce
    }));
    
    return {
      type: 'metadata_proof',
      backupId: backup.id,
      metadataHash,
      fileCount: backup.files.length,
      totalSize: backup.files.reduce((sum, f) => sum + (f.size || 0), 0),
      nonce
    };
  }
  
  // Handle storage proof response
  handleProof(challengeId, proof, fromPeer) {
    const verification = this.activeVerifications.get(challengeId);
    if (!verification) {
      console.warn(`Unknown challenge ID: ${challengeId}`);
      return;
    }
    
    verification.status = 'completed';
    verification.proof = proof;
    verification.responseTime = Date.now() - verification.startTime;
    
    // Verify the proof
    const isValid = this.verifyProof(verification.challenge, proof);
    verification.valid = isValid;
    
    this.handleVerificationResult(challengeId, proof, isValid ? null : 'Invalid proof');
  }
  
  // Verify storage proof
  verifyProof(challenge, proof) {
    if (proof.error) {
      return false;
    }
    
    switch (challenge.type) {
      case 'random_blocks':
        return proof.blocks && proof.blocks.length === challenge.blockIndices.length;
        
      case 'file_hash':
        return proof.files && proof.files.length === challenge.fileIndices.length;
        
      case 'metadata_proof':
        return proof.metadataHash && proof.nonce === challenge.nonce;
        
      default:
        return false;
    }
  }
  
  // Handle verification result
  handleVerificationResult(challengeId, proof, error) {
    const verification = this.activeVerifications.get(challengeId);
    if (!verification) return;
    
    const result = {
      challengeId,
      peerId: verification.peerId,
      backupId: verification.backupId,
      success: !error,
      error,
      responseTime: verification.responseTime,
      timestamp: Date.now()
    };
    
    // Update challenge history
    const peerHistory = this.challengeHistory.get(verification.peerId) || [];
    peerHistory.push(result);
    
    // Keep only last 100 challenges
    if (peerHistory.length > 100) {
      peerHistory.splice(0, peerHistory.length - 100);
    }
    
    this.challengeHistory.set(verification.peerId, peerHistory);
    
    // Emit result
    this.emit('verification_result', result);
    
    console.log(`Verification ${challengeId}: ${result.success ? 'PASS' : 'FAIL'} (${result.responseTime}ms)`);
    
    // Cleanup
    this.activeVerifications.delete(challengeId);
  }
  
  // Start periodic verification
  startPeriodicVerification(intervalHours = 24) {
    if (this.verificationInterval) {
      cron.destroy(this.verificationInterval);
    }
    
    // Run verification every N hours
    const cronPattern = `0 */${intervalHours} * * *`;
    
    this.verificationInterval = cron.schedule(cronPattern, async () => {
      await this.runPeriodicVerification();
    }, {
      scheduled: false
    });
    
    this.verificationInterval.start();
    console.log(`Started periodic verification every ${intervalHours} hours`);
  }
  
  // Run verification for all active backups
  async runPeriodicVerification() {
    console.log('Running periodic storage verification...');
    
    const backups = this.storage.listBackups('sent'); // Verify backups we sent
    
    for (const backup of backups) {
      if (backup.status === 'active' && backup.peerId) {
        try {
          await this.sendChallenge(backup.peerId, backup.id);
          
          // Space out challenges to avoid overwhelming peers
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`Failed to challenge backup ${backup.id}:`, error.message);
        }
      }
    }
  }
  
  // Stop periodic verification
  stopPeriodicVerification() {
    if (this.verificationInterval) {
      this.verificationInterval.destroy();
      this.verificationInterval = null;
      console.log('Stopped periodic verification');
    }
  }
  
  // Get verification statistics for a peer
  getPeerStats(peerId) {
    const history = this.challengeHistory.get(peerId) || [];
    const recent = history.filter(h => Date.now() - h.timestamp < 7 * 24 * 60 * 60 * 1000); // Last 7 days
    
    const total = recent.length;
    const successful = recent.filter(h => h.success).length;
    const avgResponseTime = recent.reduce((sum, h) => sum + (h.responseTime || 0), 0) / total;
    
    return {
      peerId,
      totalChallenges: total,
      successfulChallenges: successful,
      successRate: total > 0 ? successful / total : 0,
      averageResponseTime: avgResponseTime || 0,
      lastChallenge: recent.length > 0 ? recent[recent.length - 1].timestamp : null
    };
  }
  
  // Get all peer statistics
  getAllPeerStats() {
    const stats = [];
    for (const peerId of this.challengeHistory.keys()) {
      stats.push(this.getPeerStats(peerId));
    }
    return stats.sort((a, b) => b.successRate - a.successRate);
  }
}

module.exports = StorageVerification;