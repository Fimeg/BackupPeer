const { EventEmitter } = require('events');

/**
 * Rate limiter to prevent DoS attacks on P2P connections
 * Implements sliding window rate limiting per peer
 */
class RateLimiter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.maxRequests = options.maxRequests || 100; // Max requests per window
    this.windowMs = options.windowMs || 60000; // 1 minute window
    this.maxBurst = options.maxBurst || 20; // Max burst requests
    this.burstWindowMs = options.burstWindowMs || 1000; // 1 second burst window
    
    // Store request history per peer
    this.requests = new Map(); // peerId -> [timestamps]
    this.bursts = new Map(); // peerId -> [timestamps]
    
    // Cleanup old entries periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.windowMs / 2);
  }
  
  /**
   * Check if a request from peer is allowed
   * @param {string} peerId - Peer identifier
   * @param {string} messageType - Type of message (for specific limits)
   * @returns {boolean} - Whether request is allowed
   */
  isAllowed(peerId, messageType = 'default') {
    const now = Date.now();
    
    // Check burst rate limit
    if (!this.checkBurstLimit(peerId, now)) {
      this.emit('rate_limited', { peerId, reason: 'burst_limit', messageType });
      return false;
    }
    
    // Check window rate limit
    if (!this.checkWindowLimit(peerId, now)) {
      this.emit('rate_limited', { peerId, reason: 'window_limit', messageType });
      return false;
    }
    
    // Apply specific message type limits
    if (!this.checkMessageTypeLimit(peerId, messageType, now)) {
      this.emit('rate_limited', { peerId, reason: 'message_type_limit', messageType });
      return false;
    }
    
    // Record the request
    this.recordRequest(peerId, now);
    
    return true;
  }
  
  /**
   * Check burst rate limit (short-term)
   */
  checkBurstLimit(peerId, now) {
    const burstRequests = this.bursts.get(peerId) || [];
    const recentBursts = burstRequests.filter(time => now - time < this.burstWindowMs);
    
    return recentBursts.length < this.maxBurst;
  }
  
  /**
   * Check window rate limit (long-term)
   */
  checkWindowLimit(peerId, now) {
    const peerRequests = this.requests.get(peerId) || [];
    const recentRequests = peerRequests.filter(time => now - time < this.windowMs);
    
    return recentRequests.length < this.maxRequests;
  }
  
  /**
   * Apply specific limits for different message types
   */
  checkMessageTypeLimit(peerId, messageType, now) {
    const messageLimits = {
      'file_chunk': { max: 200, window: 60000 }, // File chunks can be frequent
      'ping': { max: 60, window: 60000 }, // 1 ping per second max
      'storage_challenge': { max: 10, window: 60000 }, // Limited challenges
      'peer_identity': { max: 5, window: 60000 }, // Very limited identity exchanges
      'file_start': { max: 20, window: 60000 } // Limited file starts
    };
    
    const limit = messageLimits[messageType];
    if (!limit) return true; // No specific limit
    
    const key = `${peerId}-${messageType}`;
    const typeRequests = this.requests.get(key) || [];
    const recentRequests = typeRequests.filter(time => now - time < limit.window);
    
    if (recentRequests.length >= limit.max) {
      return false;
    }
    
    // Record message type request
    recentRequests.push(now);
    this.requests.set(key, recentRequests);
    
    return true;
  }
  
  /**
   * Record a request from peer
   */
  recordRequest(peerId, timestamp) {
    // Record for general rate limiting
    const peerRequests = this.requests.get(peerId) || [];
    peerRequests.push(timestamp);
    this.requests.set(peerId, peerRequests);
    
    // Record for burst limiting
    const burstRequests = this.bursts.get(peerId) || [];
    burstRequests.push(timestamp);
    this.bursts.set(peerId, burstRequests);
  }
  
  /**
   * Clean up old request records
   */
  cleanup() {
    const now = Date.now();
    
    // Clean up general requests
    for (const [peerId, requests] of this.requests.entries()) {
      const recentRequests = requests.filter(time => now - time < this.windowMs * 2);
      if (recentRequests.length === 0) {
        this.requests.delete(peerId);
      } else {
        this.requests.set(peerId, recentRequests);
      }
    }
    
    // Clean up burst requests
    for (const [peerId, bursts] of this.bursts.entries()) {
      const recentBursts = bursts.filter(time => now - time < this.burstWindowMs * 2);
      if (recentBursts.length === 0) {
        this.bursts.delete(peerId);
      } else {
        this.bursts.set(peerId, recentBursts);
      }
    }
  }
  
  /**
   * Get rate limiting statistics for a peer
   */
  getStats(peerId) {
    const now = Date.now();
    const peerRequests = this.requests.get(peerId) || [];
    const burstRequests = this.bursts.get(peerId) || [];
    
    const recentRequests = peerRequests.filter(time => now - time < this.windowMs);
    const recentBursts = burstRequests.filter(time => now - time < this.burstWindowMs);
    
    return {
      windowRequests: recentRequests.length,
      maxWindowRequests: this.maxRequests,
      burstRequests: recentBursts.length,
      maxBurstRequests: this.maxBurst,
      windowUtilization: (recentRequests.length / this.maxRequests) * 100,
      burstUtilization: (recentBursts.length / this.maxBurst) * 100
    };
  }
  
  /**
   * Temporarily ban a peer for severe violations
   */
  banPeer(peerId, durationMs = 300000) { // 5 minutes default
    const banUntil = Date.now() + durationMs;
    this.bannedPeers = this.bannedPeers || new Map();
    this.bannedPeers.set(peerId, banUntil);
    
    this.emit('peer_banned', { peerId, durationMs });
    
    // Auto-unban after duration
    setTimeout(() => {
      this.bannedPeers.delete(peerId);
      this.emit('peer_unbanned', { peerId });
    }, durationMs);
  }
  
  /**
   * Check if peer is currently banned
   */
  isBanned(peerId) {
    if (!this.bannedPeers) return false;
    
    const banUntil = this.bannedPeers.get(peerId);
    if (!banUntil) return false;
    
    if (Date.now() > banUntil) {
      this.bannedPeers.delete(peerId);
      return false;
    }
    
    return true;
  }
  
  /**
   * Close rate limiter and cleanup
   */
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.requests.clear();
    this.bursts.clear();
    if (this.bannedPeers) {
      this.bannedPeers.clear();
    }
  }
}

module.exports = RateLimiter;