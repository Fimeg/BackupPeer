const fs = require('fs-extra');
const path = require('path');

class StorageAllocation {
  constructor(configDir = '~/.backup-peer') {
    this.configDir = configDir.replace('~', require('os').homedir());
    this.allocationFile = path.join(this.configDir, 'allocation.json');
    this.allocation = {
      maxStorageOffered: 0, // bytes available to offer
      storageOffered: 0,    // bytes currently offered to peers
      storageUsed: 0,       // bytes used by our backups on peers
      ratio: '1:1',         // storage ratio (give:take)
      allocations: new Map() // peerId -> { offered, used, timestamp }
    };
  }
  
  async initialize() {
    await fs.ensureDir(this.configDir);
    
    try {
      if (await fs.pathExists(this.allocationFile)) {
        const data = await fs.readJSON(this.allocationFile);
        this.allocation = { ...this.allocation, ...data };
        
        // Convert allocations back to Map
        if (data.allocations && Array.isArray(data.allocations)) {
          this.allocation.allocations = new Map(data.allocations);
        } else if (data.allocations) {
          this.allocation.allocations = new Map(Object.entries(data.allocations));
        }
        
        console.log('Loaded storage allocation data');
      }
    } catch (error) {
      console.warn('Could not load allocation data:', error.message);
    }
  }
  
  async saveAllocation() {
    const data = {
      ...this.allocation,
      allocations: Array.from(this.allocation.allocations.entries())
    };
    await fs.writeJSON(this.allocationFile, data, { spaces: 2 });
  }
  
  // Set maximum storage we can offer
  async setMaxStorage(bytes) {
    this.allocation.maxStorageOffered = bytes;
    await this.saveAllocation();
    console.log(`Max storage set to ${this.formatBytes(bytes)}`);
  }
  
  // Check if we can accept a new backup request
  canAcceptBackup(requestedBytes, fromPeerId) {
    const currentUsed = this.allocation.storageUsed;
    const currentOffered = this.allocation.storageOffered;
    const maxOffered = this.allocation.maxStorageOffered;
    
    // Check 1:1 ratio - can't use more than we offer
    if (currentUsed + requestedBytes > currentOffered + this.getAllocatedToPeer(fromPeerId)) {
      return {
        canAccept: false,
        reason: 'Insufficient allocation - violates 1:1 ratio',
        currentRatio: this.getCurrentRatio(),
        requiredOffering: currentUsed + requestedBytes
      };
    }
    
    // Check storage limit
    if (currentOffered >= maxOffered) {
      return {
        canAccept: false,
        reason: 'Maximum storage capacity reached',
        maxOffered: this.formatBytes(maxOffered),
        currentOffered: this.formatBytes(currentOffered)
      };
    }
    
    return { canAccept: true };
  }
  
  // Record storage allocated to a peer (we store their data)
  async allocateStorageToPeer(peerId, bytes, backupId) {
    const existing = this.allocation.allocations.get(peerId) || { offered: 0, used: 0, backups: [] };
    existing.offered += bytes;
    existing.used += bytes;
    existing.backups.push({ id: backupId, size: bytes, timestamp: Date.now() });
    existing.timestamp = Date.now();
    
    this.allocation.allocations.set(peerId, existing);
    this.allocation.storageOffered += bytes;
    
    await this.saveAllocation();
    console.log(`Allocated ${this.formatBytes(bytes)} to peer ${peerId.slice(0, 12)}...`);
  }
  
  // Record storage used from a peer (they store our data)  
  async recordStorageUsed(peerId, bytes, backupId) {
    const existing = this.allocation.allocations.get(peerId) || { offered: 0, used: 0, backups: [] };
    existing.used += bytes;
    existing.timestamp = Date.now();
    
    this.allocation.allocations.set(peerId, existing);
    this.allocation.storageUsed += bytes;
    
    await this.saveAllocation();
    console.log(`Using ${this.formatBytes(bytes)} from peer ${peerId.slice(0, 12)}...`);
  }
  
  // Release storage allocation when backup is deleted
  async releaseAllocation(peerId, bytes, isOffered = true) {
    const existing = this.allocation.allocations.get(peerId);
    if (!existing) return;
    
    if (isOffered) {
      existing.offered = Math.max(0, existing.offered - bytes);
      this.allocation.storageOffered = Math.max(0, this.allocation.storageOffered - bytes);
    } else {
      existing.used = Math.max(0, existing.used - bytes);
      this.allocation.storageUsed = Math.max(0, this.allocation.storageUsed - bytes);
    }
    
    existing.timestamp = Date.now();
    
    if (existing.offered === 0 && existing.used === 0) {
      this.allocation.allocations.delete(peerId);
    } else {
      this.allocation.allocations.set(peerId, existing);
    }
    
    await this.saveAllocation();
    console.log(`Released ${this.formatBytes(bytes)} ${isOffered ? 'offered to' : 'used from'} peer ${peerId.slice(0, 12)}...`);
  }
  
  // Get current storage ratio
  getCurrentRatio() {
    const offered = this.allocation.storageOffered;
    const used = this.allocation.storageUsed;
    
    if (offered === 0 && used === 0) return '0:0';
    if (offered === 0) return `0:${this.formatBytes(used)}`;
    if (used === 0) return `${this.formatBytes(offered)}:0`;
    
    // Calculate ratio
    const ratio = offered / used;
    return `${ratio.toFixed(2)}:1`;
  }
  
  // Get allocation for specific peer
  getAllocatedToPeer(peerId) {
    const allocation = this.allocation.allocations.get(peerId);
    return allocation ? allocation.offered : 0;
  }
  
  // Get usage from specific peer
  getUsedFromPeer(peerId) {
    const allocation = this.allocation.allocations.get(peerId);
    return allocation ? allocation.used : 0;
  }
  
  // Get allocation status
  getAllocationStatus() {
    const totalPeers = this.allocation.allocations.size;
    const offeredPeers = Array.from(this.allocation.allocations.values()).filter(a => a.offered > 0).length;
    const usedPeers = Array.from(this.allocation.allocations.values()).filter(a => a.used > 0).length;
    
    return {
      maxStorage: this.allocation.maxStorageOffered,
      totalOffered: this.allocation.storageOffered,
      totalUsed: this.allocation.storageUsed,
      ratio: this.getCurrentRatio(),
      availableStorage: this.allocation.maxStorageOffered - this.allocation.storageOffered,
      remainingCapacity: Math.max(0, this.allocation.storageOffered - this.allocation.storageUsed),
      totalPeers,
      offeredPeers,
      usedPeers,
      allocations: Array.from(this.allocation.allocations.entries()).map(([peerId, alloc]) => ({
        peerId: peerId.slice(0, 16) + '...',
        offered: this.formatBytes(alloc.offered),
        used: this.formatBytes(alloc.used),
        balance: this.formatBytes(alloc.offered - alloc.used),
        lastActivity: new Date(alloc.timestamp).toLocaleString()
      }))
    };
  }
  
  // Format bytes to human readable
  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Math.abs(bytes);
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    const sign = bytes < 0 ? '-' : '';
    return `${sign}${size.toFixed(1)} ${units[unitIndex]}`;
  }
  
  // Get peer allocation summary
  getPeerAllocations() {
    return Array.from(this.allocation.allocations.entries()).map(([peerId, alloc]) => ({
      peerId,
      shortId: peerId.slice(0, 12) + '...',
      offered: alloc.offered,
      used: alloc.used,
      balance: alloc.offered - alloc.used,
      offeredFormatted: this.formatBytes(alloc.offered),
      usedFormatted: this.formatBytes(alloc.used),
      balanceFormatted: this.formatBytes(alloc.offered - alloc.used),
      backupCount: (alloc.backups || []).length,
      lastActivity: alloc.timestamp,
      lastActivityFormatted: new Date(alloc.timestamp).toLocaleString()
    }));
  }
  
  // Validate allocation integrity
  async validateAllocation() {
    const issues = [];
    
    // Check if total allocations match sum of individual allocations
    let sumOffered = 0;
    let sumUsed = 0;
    
    for (const alloc of this.allocation.allocations.values()) {
      sumOffered += alloc.offered;
      sumUsed += alloc.used;
    }
    
    if (sumOffered !== this.allocation.storageOffered) {
      issues.push(`Total offered mismatch: expected ${sumOffered}, got ${this.allocation.storageOffered}`);
    }
    
    if (sumUsed !== this.allocation.storageUsed) {
      issues.push(`Total used mismatch: expected ${sumUsed}, got ${this.allocation.storageUsed}`);
    }
    
    // Check 1:1 ratio violation
    if (this.allocation.storageUsed > this.allocation.storageOffered) {
      issues.push(`Ratio violation: using ${this.formatBytes(this.allocation.storageUsed)} but only offering ${this.formatBytes(this.allocation.storageOffered)}`);
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
}

module.exports = StorageAllocation;