const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');

class ReputationSystem extends EventEmitter {
  constructor(configDir = '~/.backup-peer') {
    super();
    this.configDir = configDir.replace('~', require('os').homedir());
    this.reputationFile = path.join(this.configDir, 'reputation.json');
    this.peers = new Map(); // peerId -> reputation data
    
    // Reputation scoring weights
    this.weights = {
      uptime: 0.3,
      responseTime: 0.2,
      verificationSuccess: 0.3,
      dataIntegrity: 0.2
    };
    
    // Reputation thresholds
    this.thresholds = {
      trusted: 0.8,
      acceptable: 0.6,
      suspicious: 0.4,
      blacklisted: 0.2
    };
  }
  
  // Initialize reputation system
  async initialize() {
    await fs.ensureDir(this.configDir);
    await this.loadReputation();
  }
  
  // Load reputation data from disk
  async loadReputation() {
    try {
      if (await fs.pathExists(this.reputationFile)) {
        const data = await fs.readJSON(this.reputationFile);
        
        for (const [peerId, reputation] of Object.entries(data)) {
          this.peers.set(peerId, this.migrateReputationData(reputation));
        }
        
        console.log(`Loaded reputation data for ${this.peers.size} peers`);
      }
    } catch (error) {
      console.warn('Could not load reputation data:', error.message);
    }
  }
  
  // Save reputation data to disk
  async saveReputation() {
    try {
      const data = Object.fromEntries(this.peers);
      await fs.writeJSON(this.reputationFile, data, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save reputation data:', error.message);
    }
  }
  
  // Migrate old reputation data format
  migrateReputationData(reputation) {
    return {
      peerId: reputation.peerId,
      firstSeen: reputation.firstSeen || Date.now(),
      lastSeen: reputation.lastSeen || Date.now(),
      
      // Connection metrics
      totalConnections: reputation.totalConnections || 0,
      successfulConnections: reputation.successfulConnections || 0,
      failedConnections: reputation.failedConnections || 0,
      averageResponseTime: reputation.averageResponseTime || 0,
      
      // Storage metrics
      totalChallenges: reputation.totalChallenges || 0,
      successfulChallenges: reputation.successfulChallenges || 0,
      failedChallenges: reputation.failedChallenges || 0,
      averageVerificationTime: reputation.averageVerificationTime || 0,
      
      // Data integrity
      dataIntegrityScore: reputation.dataIntegrityScore || 1.0,
      corruptedFiles: reputation.corruptedFiles || 0,
      totalFilesTransferred: reputation.totalFilesTransferred || 0,
      
      // Uptime tracking
      uptimeScore: reputation.uptimeScore || 1.0,
      uptimeHistory: reputation.uptimeHistory || [],
      
      // Overall reputation
      overallScore: reputation.overallScore || 0.5,
      trustLevel: reputation.trustLevel || 'unknown',
      
      // Flags
      isBlacklisted: reputation.isBlacklisted || false,
      blacklistReason: reputation.blacklistReason || null,
      
      // Additional metadata
      publicKey: reputation.publicKey || null,
      lastCommitment: reputation.lastCommitment || null,
      notes: reputation.notes || []
    };
  }
  
  // Get or create peer reputation
  getPeerReputation(peerId) {
    if (!this.peers.has(peerId)) {
      const newReputation = this.migrateReputationData({
        peerId,
        firstSeen: Date.now(),
        lastSeen: Date.now()
      });
      this.peers.set(peerId, newReputation);
    }
    
    return this.peers.get(peerId);
  }
  
  // Record successful connection
  recordConnection(peerId, responseTime = 0, success = true) {
    const reputation = this.getPeerReputation(peerId);
    
    reputation.lastSeen = Date.now();
    reputation.totalConnections++;
    
    if (success) {
      reputation.successfulConnections++;
      
      // Update average response time
      if (responseTime > 0) {
        const total = reputation.totalConnections;
        reputation.averageResponseTime = (
          (reputation.averageResponseTime * (total - 1)) + responseTime
        ) / total;
      }
    } else {
      reputation.failedConnections++;
    }
    
    this.updateOverallScore(peerId);
    this.emit('reputation_updated', peerId, reputation);
    
    // Auto-save periodically
    if (reputation.totalConnections % 10 === 0) {
      this.saveReputation();
    }
  }
  
  // Record verification challenge result
  recordVerification(peerId, success = true, responseTime = 0) {
    const reputation = this.getPeerReputation(peerId);
    
    reputation.totalChallenges++;
    
    if (success) {
      reputation.successfulChallenges++;
      
      if (responseTime > 0) {
        const total = reputation.totalChallenges;
        reputation.averageVerificationTime = (
          (reputation.averageVerificationTime * (total - 1)) + responseTime
        ) / total;
      }
    } else {
      reputation.failedChallenges++;
    }
    
    this.updateOverallScore(peerId);
    this.emit('verification_recorded', peerId, reputation);
  }
  
  // Record file transfer result
  recordFileTransfer(peerId, success = true, filesCount = 1, corruptedCount = 0) {
    const reputation = this.getPeerReputation(peerId);
    
    reputation.totalFilesTransferred += filesCount;
    reputation.corruptedFiles += corruptedCount;
    
    // Update data integrity score
    if (reputation.totalFilesTransferred > 0) {
      reputation.dataIntegrityScore = 1 - (reputation.corruptedFiles / reputation.totalFilesTransferred);
    }
    
    this.updateOverallScore(peerId);
    this.emit('transfer_recorded', peerId, reputation);
  }
  
  // Update uptime based on availability
  recordUptime(peerId, wasAvailable = true) {
    const reputation = this.getPeerReputation(peerId);
    
    // Keep last 100 uptime checks
    if (reputation.uptimeHistory.length >= 100) {
      reputation.uptimeHistory.shift();
    }
    
    reputation.uptimeHistory.push({
      timestamp: Date.now(),
      available: wasAvailable
    });
    
    // Calculate uptime score from recent history
    const recentChecks = reputation.uptimeHistory.slice(-50); // Last 50 checks
    const upCount = recentChecks.filter(check => check.available).length;
    reputation.uptimeScore = recentChecks.length > 0 ? upCount / recentChecks.length : 1.0;
    
    this.updateOverallScore(peerId);
  }
  
  // Calculate overall reputation score
  updateOverallScore(peerId) {
    const reputation = this.getPeerReputation(peerId);
    
    // Calculate component scores
    const connectionScore = reputation.totalConnections > 0 
      ? reputation.successfulConnections / reputation.totalConnections 
      : 0.5;
      
    const verificationScore = reputation.totalChallenges > 0
      ? reputation.successfulChallenges / reputation.totalChallenges
      : 0.5;
      
    const responseTimeScore = this.calculateResponseTimeScore(reputation.averageResponseTime);
    
    // Weighted overall score
    reputation.overallScore = (
      (connectionScore * this.weights.uptime) +
      (responseTimeScore * this.weights.responseTime) +
      (verificationScore * this.weights.verificationSuccess) +
      (reputation.dataIntegrityScore * this.weights.dataIntegrity)
    );
    
    // Update trust level
    reputation.trustLevel = this.getTrustLevel(reputation.overallScore);
    
    // Auto-blacklist very low reputation peers
    if (reputation.overallScore < this.thresholds.blacklisted && !reputation.isBlacklisted) {
      this.blacklistPeer(peerId, 'Automatic blacklist due to low reputation');
    }
  }
  
  // Calculate response time score (lower is better)
  calculateResponseTimeScore(avgResponseTime) {
    if (avgResponseTime === 0) return 0.5; // No data
    
    // Convert milliseconds to score (1.0 = instant, 0.0 = >30 seconds)
    const maxAcceptableTime = 30000; // 30 seconds
    const score = Math.max(0, 1 - (avgResponseTime / maxAcceptableTime));
    return Math.min(1, score);
  }
  
  // Get trust level from score
  getTrustLevel(score) {
    if (score >= this.thresholds.trusted) return 'trusted';
    if (score >= this.thresholds.acceptable) return 'acceptable';
    if (score >= this.thresholds.suspicious) return 'suspicious';
    return 'untrusted';
  }
  
  // Blacklist a peer
  blacklistPeer(peerId, reason) {
    const reputation = this.getPeerReputation(peerId);
    
    reputation.isBlacklisted = true;
    reputation.blacklistReason = reason;
    reputation.overallScore = 0;
    reputation.trustLevel = 'blacklisted';
    
    console.log(`Blacklisted peer ${peerId}: ${reason}`);
    this.emit('peer_blacklisted', peerId, reason);
    
    this.saveReputation();
  }
  
  // Remove peer from blacklist
  unblacklistPeer(peerId) {
    const reputation = this.getPeerReputation(peerId);
    
    reputation.isBlacklisted = false;
    reputation.blacklistReason = null;
    
    this.updateOverallScore(peerId);
    
    console.log(`Removed peer ${peerId} from blacklist`);
    this.emit('peer_unblacklisted', peerId);
    
    this.saveReputation();
  }
  
  // Check if peer is acceptable for backup
  isPeerAcceptable(peerId, minScore = null) {
    const reputation = this.getPeerReputation(peerId);
    
    if (reputation.isBlacklisted) {
      return { acceptable: false, reason: 'Peer is blacklisted' };
    }
    
    const threshold = minScore || this.thresholds.acceptable;
    
    if (reputation.overallScore < threshold) {
      return { 
        acceptable: false, 
        reason: `Reputation too low: ${reputation.overallScore.toFixed(2)} < ${threshold}` 
      };
    }
    
    return { acceptable: true };
  }
  
  // Get ranked list of peers by reputation
  getRankedPeers(limit = 50) {
    const peers = Array.from(this.peers.values());
    
    return peers
      .filter(p => !p.isBlacklisted)
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, limit)
      .map(p => ({
        peerId: p.peerId,
        score: p.overallScore,
        trustLevel: p.trustLevel,
        lastSeen: p.lastSeen,
        connections: p.totalConnections,
        verifications: p.totalChallenges
      }));
  }
  
  // Get reputation summary
  getReputationSummary() {
    const peers = Array.from(this.peers.values());
    
    return {
      totalPeers: peers.length,
      trusted: peers.filter(p => p.trustLevel === 'trusted').length,
      acceptable: peers.filter(p => p.trustLevel === 'acceptable').length,
      suspicious: peers.filter(p => p.trustLevel === 'suspicious').length,
      untrusted: peers.filter(p => p.trustLevel === 'untrusted').length,
      blacklisted: peers.filter(p => p.isBlacklisted).length,
      averageScore: peers.reduce((sum, p) => sum + p.overallScore, 0) / peers.length || 0
    };
  }
  
  // Export reputation data for sharing/backup
  exportReputation() {
    return {
      timestamp: Date.now(),
      version: '1.0',
      peers: Object.fromEntries(this.peers),
      weights: this.weights,
      thresholds: this.thresholds
    };
  }
  
  // Import reputation data (merge with existing)
  async importReputation(data, merge = true) {
    if (!data.peers) {
      throw new Error('Invalid reputation data format');
    }
    
    let imported = 0;
    let updated = 0;
    
    for (const [peerId, reputation] of Object.entries(data.peers)) {
      const existing = this.peers.has(peerId);
      
      if (!existing || !merge) {
        this.peers.set(peerId, this.migrateReputationData(reputation));
        imported++;
      } else {
        // Merge data (keep higher values generally)
        const current = this.peers.get(peerId);
        const merged = this.mergeReputationData(current, reputation);
        this.peers.set(peerId, merged);
        updated++;
      }
    }
    
    await this.saveReputation();
    
    console.log(`Imported reputation: ${imported} new peers, ${updated} updated`);
    return { imported, updated };
  }
  
  // Merge two reputation records
  mergeReputationData(current, incoming) {
    return {
      ...current,
      lastSeen: Math.max(current.lastSeen, incoming.lastSeen || 0),
      totalConnections: current.totalConnections + (incoming.totalConnections || 0),
      successfulConnections: current.successfulConnections + (incoming.successfulConnections || 0),
      failedConnections: current.failedConnections + (incoming.failedConnections || 0),
      totalChallenges: current.totalChallenges + (incoming.totalChallenges || 0),
      successfulChallenges: current.successfulChallenges + (incoming.successfulChallenges || 0),
      failedChallenges: current.failedChallenges + (incoming.failedChallenges || 0),
      totalFilesTransferred: current.totalFilesTransferred + (incoming.totalFilesTransferred || 0),
      corruptedFiles: current.corruptedFiles + (incoming.corruptedFiles || 0),
      // Keep current blacklist status if more restrictive
      isBlacklisted: current.isBlacklisted || incoming.isBlacklisted || false,
      blacklistReason: current.blacklistReason || incoming.blacklistReason || null
    };
  }
  
  // Cleanup old reputation data
  async cleanup(maxAge = 365 * 24 * 60 * 60 * 1000) { // 1 year
    let cleaned = 0;
    const cutoff = Date.now() - maxAge;
    
    for (const [peerId, reputation] of this.peers) {
      // Remove peers not seen in a long time with no significant history
      if (reputation.lastSeen < cutoff && 
          reputation.totalConnections < 5 && 
          reputation.totalChallenges < 5) {
        this.peers.delete(peerId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await this.saveReputation();
      console.log(`Cleaned up ${cleaned} old reputation records`);
    }
    
    return cleaned;
  }
}

module.exports = ReputationSystem;