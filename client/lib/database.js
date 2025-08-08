const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const DatabaseEncryption = require('./db-encryption');

class Database {
  constructor(configDir = '~/.backup-peer') {
    this.configDir = configDir.replace('~', require('os').homedir());
    this.dbPath = path.join(this.configDir, 'backuppeer.db');
    this.db = null;
    
    // Initialize database encryption for sensitive fields
    this.encryption = new DatabaseEncryption();
    
    // Define which fields should be encrypted
    this.sensitiveFields = {
      peers: ['public_key', 'metadata'],
      cached_peer_connections: ['public_key', 'ice_data', 'metadata'],
      storage_commitments: ['signature'],
      verification_challenges: ['challenge_data', 'response_data']
    };
  }
  
  // Initialize database connection and schema
  async initialize() {
    await fs.ensureDir(this.configDir);
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log('Connected to SQLite database');
        this.createTables().then(resolve).catch(reject);
      });
    });
  }
  
  // Create database tables
  async createTables() {
    const queries = [
      // Backups table
      `CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT CHECK(type IN ('sent', 'received')),
        peer_id TEXT,
        timestamp INTEGER,
        status TEXT DEFAULT 'active',
        file_count INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      
      // Files table
      `CREATE TABLE IF NOT EXISTS backup_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_id TEXT,
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER,
        file_hash TEXT,
        chunk_count INTEGER DEFAULT 1,
        transfer_status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (backup_id) REFERENCES backups (id) ON DELETE CASCADE
      )`,
      
      // Peers table
      `CREATE TABLE IF NOT EXISTS peers (
        peer_id TEXT PRIMARY KEY,
        public_key TEXT,
        first_seen INTEGER,
        last_seen INTEGER,
        reputation_score REAL DEFAULT 0.5,
        trust_level TEXT DEFAULT 'unknown',
        is_blacklisted INTEGER DEFAULT 0,
        blacklist_reason TEXT,
        connection_count INTEGER DEFAULT 0,
        successful_connections INTEGER DEFAULT 0,
        verification_count INTEGER DEFAULT 0,
        successful_verifications INTEGER DEFAULT 0,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      
      // Storage commitments table
      `CREATE TABLE IF NOT EXISTS storage_commitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id TEXT,
        commitment_hash TEXT,
        storage_offered INTEGER,
        availability_guarantee TEXT,
        retention_period INTEGER,
        expires_at INTEGER,
        signature TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (peer_id) REFERENCES peers (peer_id)
      )`,
      
      // Verification challenges table
      `CREATE TABLE IF NOT EXISTS verification_challenges (
        id TEXT PRIMARY KEY,
        backup_id TEXT,
        peer_id TEXT,
        challenge_type TEXT,
        challenge_data TEXT,
        response_data TEXT,
        success INTEGER,
        response_time INTEGER,
        timestamp INTEGER,
        expires_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (backup_id) REFERENCES backups (id),
        FOREIGN KEY (peer_id) REFERENCES peers (peer_id)
      )`,
      
      // Transfer sessions table
      `CREATE TABLE IF NOT EXISTS transfer_sessions (
        id TEXT PRIMARY KEY,
        backup_id TEXT,
        peer_id TEXT,
        direction TEXT CHECK(direction IN ('upload', 'download')),
        total_chunks INTEGER,
        completed_chunks INTEGER DEFAULT 0,
        failed_chunks INTEGER DEFAULT 0,
        bytes_transferred INTEGER DEFAULT 0,
        start_time INTEGER,
        end_time INTEGER,
        status TEXT DEFAULT 'active',
        error_message TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (backup_id) REFERENCES backups (id),
        FOREIGN KEY (peer_id) REFERENCES peers (peer_id)
      )`,

      // Cached peer connections for resumption
      `CREATE TABLE IF NOT EXISTS cached_peer_connections (
        peer_id_hash TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        ice_data TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        trust_level TEXT DEFAULT 'software-verified',
        connection_attempts INTEGER DEFAULT 0,
        successful_connections INTEGER DEFAULT 0,
        last_connection_success INTEGER,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

      // Transfer chunk states for resumption
      `CREATE TABLE IF NOT EXISTS transfer_chunk_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_hash TEXT NOT NULL,
        chunk_size INTEGER NOT NULL,
        transfer_state TEXT DEFAULT 'pending' CHECK(transfer_state IN ('pending', 'transferring', 'completed', 'failed', 'verified')),
        attempts INTEGER DEFAULT 0,
        last_attempt INTEGER,
        error_message TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (backup_id) REFERENCES backups (id) ON DELETE CASCADE,
        UNIQUE(backup_id, chunk_index)
      )`,

      // Sync schedules for peer coordination
      `CREATE TABLE IF NOT EXISTS sync_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_id_hash TEXT NOT NULL,
        schedule_type TEXT DEFAULT 'mutual' CHECK(schedule_type IN ('mutual', 'one-way', 'backup-only')),
        availability_windows TEXT NOT NULL, -- JSON array of time windows
        sync_frequency TEXT DEFAULT 'daily',
        next_sync_time INTEGER,
        timezone TEXT DEFAULT 'UTC',
        priority INTEGER DEFAULT 5,
        active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (peer_id_hash) REFERENCES cached_peer_connections (peer_id_hash) ON DELETE CASCADE
      )`
    ];
    
    for (const query of queries) {
      await this.run(query);
    }
    
    // Create indexes for better performance  
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_backups_peer_id ON backups (peer_id)',
      'CREATE INDEX IF NOT EXISTS idx_backups_timestamp ON backups (timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_backup_files_backup_id ON backup_files (backup_id)',
      'CREATE INDEX IF NOT EXISTS idx_peers_last_seen ON peers (last_seen)',
      'CREATE INDEX IF NOT EXISTS idx_peers_reputation ON peers (reputation_score)',
      'CREATE INDEX IF NOT EXISTS idx_verification_challenges_peer_id ON verification_challenges (peer_id)',
      'CREATE INDEX IF NOT EXISTS idx_verification_challenges_timestamp ON verification_challenges (timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_transfer_sessions_backup_id ON transfer_sessions (backup_id)',
      'CREATE INDEX IF NOT EXISTS idx_cached_peers_last_seen ON cached_peer_connections (last_seen)',
      'CREATE INDEX IF NOT EXISTS idx_cached_peers_trust_level ON cached_peer_connections (trust_level)',
      'CREATE INDEX IF NOT EXISTS idx_transfer_chunks_backup_id ON transfer_chunk_states (backup_id)',
      'CREATE INDEX IF NOT EXISTS idx_transfer_chunks_state ON transfer_chunk_states (transfer_state)',
      'CREATE INDEX IF NOT EXISTS idx_sync_schedules_peer_hash ON sync_schedules (peer_id_hash)',
      'CREATE INDEX IF NOT EXISTS idx_sync_schedules_next_sync ON sync_schedules (next_sync_time)'
    ];
    
    for (const index of indexes) {
      await this.run(index);
    }
    
    console.log('Database schema initialized');
  }
  
  // Encrypt record before storage
  encryptRecord(tableName, record) {
    const sensitiveFields = this.sensitiveFields[tableName] || [];
    return this.encryption.encryptRecord(record, sensitiveFields);
  }
  
  // Decrypt record after retrieval
  decryptRecord(tableName, record) {
    if (!record) return record;
    const sensitiveFields = this.sensitiveFields[tableName] || [];
    return this.encryption.decryptRecord(record, sensitiveFields);
  }
  
  // Decrypt array of records
  decryptRecords(tableName, records) {
    return records.map(record => this.decryptRecord(tableName, record));
  }

  // Execute SQL query
  run(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }
  
  // Get single row
  get(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
  
  // Get multiple rows
  all(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
  
  // Backup operations
  async saveBackup(backup) {
    const query = `
      INSERT OR REPLACE INTO backups 
      (id, name, type, peer_id, timestamp, status, file_count, total_size, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const metadata = JSON.stringify({
      files: backup.files || [],
      location: backup.location || null,
      originalPath: backup.originalPath || null
    });
    
    return this.run(query, [
      backup.id,
      backup.name,
      backup.type,
      backup.peerId,
      backup.timestamp,
      backup.status || 'active',
      backup.files ? backup.files.length : 0,
      backup.files ? backup.files.reduce((sum, f) => sum + (f.size || 0), 0) : 0,
      metadata
    ]);
  }
  
  async getBackup(backupId) {
    const backup = await this.get('SELECT * FROM backups WHERE id = ?', [backupId]);
    if (!backup) return null;
    
    // Parse metadata
    if (backup.metadata) {
      try {
        const metadata = JSON.parse(backup.metadata);
        backup.files = metadata.files || [];
        backup.location = metadata.location;
        backup.originalPath = metadata.originalPath;
      } catch (error) {
        console.warn('Failed to parse backup metadata:', error.message);
        backup.files = [];
      }
    }
    
    return backup;
  }
  
  async listBackups(type = 'all', limit = 100) {
    let query = 'SELECT * FROM backups';
    const params = [];
    
    if (type !== 'all') {
      query += ' WHERE type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    const backups = await this.all(query, params);
    
    // Parse metadata for each backup
    return backups.map(backup => {
      if (backup.metadata) {
        try {
          const metadata = JSON.parse(backup.metadata);
          backup.files = metadata.files || [];
          backup.location = metadata.location;
          backup.originalPath = metadata.originalPath;
        } catch (error) {
          backup.files = [];
        }
      }
      return backup;
    });
  }
  
  async deleteBackup(backupId) {
    return this.run('DELETE FROM backups WHERE id = ?', [backupId]);
  }
  
  // Peer operations
  async savePeer(peer) {
    const query = `
      INSERT OR REPLACE INTO peers
      (peer_id, public_key, first_seen, last_seen, reputation_score, trust_level, 
       is_blacklisted, blacklist_reason, connection_count, successful_connections,
       verification_count, successful_verifications, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const metadata = JSON.stringify({
      averageResponseTime: peer.averageResponseTime || 0,
      uptimeScore: peer.uptimeScore || 1.0,
      dataIntegrityScore: peer.dataIntegrityScore || 1.0,
      notes: peer.notes || []
    });
    
    // Encrypt sensitive peer data before storage
    const peerRecord = {
      peer_id: peer.peerId,
      public_key: peer.publicKey,
      first_seen: peer.firstSeen,
      last_seen: peer.lastSeen,
      reputation_score: peer.overallScore || 0.5,
      trust_level: peer.trustLevel || 'unknown',
      is_blacklisted: peer.isBlacklisted ? 1 : 0,
      blacklist_reason: peer.blacklistReason,
      connection_count: peer.totalConnections || 0,
      successful_connections: peer.successfulConnections || 0,
      verification_count: peer.totalChallenges || 0,
      successful_verifications: peer.successfulChallenges || 0,
      metadata: metadata
    };
    
    const encryptedRecord = this.encryptRecord('peers', peerRecord);
    
    return this.run(query, [
      encryptedRecord.peer_id,
      encryptedRecord.public_key,
      encryptedRecord.first_seen,
      encryptedRecord.last_seen,
      encryptedRecord.reputation_score,
      encryptedRecord.trust_level,
      encryptedRecord.is_blacklisted,
      encryptedRecord.blacklist_reason,
      encryptedRecord.connection_count,
      encryptedRecord.successful_connections,
      encryptedRecord.verification_count,
      encryptedRecord.successful_verifications,
      encryptedRecord.metadata
    ]);
  }
  
  async getPeer(peerId) {
    const peer = await this.get('SELECT * FROM peers WHERE peer_id = ?', [peerId]);
    if (!peer) return null;
    
    // Decrypt sensitive fields
    const decryptedPeer = this.decryptRecord('peers', peer);
    
    // Parse metadata
    if (decryptedPeer.metadata) {
      try {
        const metadata = JSON.parse(decryptedPeer.metadata);
        decryptedPeer.averageResponseTime = metadata.averageResponseTime || 0;
        decryptedPeer.uptimeScore = metadata.uptimeScore || 1.0;
        decryptedPeer.dataIntegrityScore = metadata.dataIntegrityScore || 1.0;
        decryptedPeer.notes = metadata.notes || [];
      } catch (error) {
        console.warn('Failed to parse peer metadata:', error.message);
      }
    }
    
    return decryptedPeer;
  }
  
  async listPeers(orderBy = 'reputation_score DESC', limit = 100) {
    const query = `SELECT * FROM peers ORDER BY ${orderBy} LIMIT ?`;
    return this.all(query, [limit]);
  }
  
  // Verification challenge operations
  async saveChallenge(challenge) {
    const query = `
      INSERT OR REPLACE INTO verification_challenges
      (id, backup_id, peer_id, challenge_type, challenge_data, response_data,
       success, response_time, timestamp, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    return this.run(query, [
      challenge.id,
      challenge.backupId,
      challenge.peerId,
      challenge.type,
      JSON.stringify(challenge.data || {}),
      JSON.stringify(challenge.response || {}),
      challenge.success ? 1 : 0,
      challenge.responseTime || 0,
      challenge.timestamp,
      challenge.expiresAt
    ]);
  }
  
  async getChallengeHistory(peerId, limit = 50) {
    const query = `
      SELECT * FROM verification_challenges 
      WHERE peer_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `;
    
    return this.all(query, [peerId, limit]);
  }
  
  // Transfer session operations
  async saveTransferSession(session) {
    const query = `
      INSERT OR REPLACE INTO transfer_sessions
      (id, backup_id, peer_id, direction, total_chunks, completed_chunks,
       failed_chunks, bytes_transferred, start_time, end_time, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    return this.run(query, [
      session.id,
      session.backupId,
      session.peerId,
      session.direction,
      session.totalChunks || 0,
      session.completedChunks || 0,
      session.failedChunks || 0,
      session.bytesTransferred || 0,
      session.startTime,
      session.endTime,
      session.status || 'active',
      session.errorMessage
    ]);
  }
  
  async getTransferSession(sessionId) {
    return this.get('SELECT * FROM transfer_sessions WHERE id = ?', [sessionId]);
  }
  
  // Statistics and reporting
  async getStorageStats() {
    const stats = await this.get(`
      SELECT 
        COUNT(*) as total_backups,
        SUM(CASE WHEN type = 'sent' THEN 1 ELSE 0 END) as sent_backups,
        SUM(CASE WHEN type = 'received' THEN 1 ELSE 0 END) as received_backups,
        SUM(total_size) as total_size,
        SUM(CASE WHEN type = 'sent' THEN total_size ELSE 0 END) as sent_size,
        SUM(CASE WHEN type = 'received' THEN total_size ELSE 0 END) as received_size
      FROM backups 
      WHERE status = 'active'
    `);
    
    return {
      totalBackups: stats.total_backups || 0,
      sentBackups: stats.sent_backups || 0,
      receivedBackups: stats.received_backups || 0,
      totalSize: stats.total_size || 0,
      sentSize: stats.sent_size || 0,
      receivedSize: stats.received_size || 0
    };
  }
  
  async getReputationStats() {
    const stats = await this.get(`
      SELECT 
        COUNT(*) as total_peers,
        SUM(CASE WHEN trust_level = 'trusted' THEN 1 ELSE 0 END) as trusted,
        SUM(CASE WHEN trust_level = 'acceptable' THEN 1 ELSE 0 END) as acceptable,
        SUM(CASE WHEN trust_level = 'suspicious' THEN 1 ELSE 0 END) as suspicious,
        SUM(CASE WHEN trust_level = 'untrusted' THEN 1 ELSE 0 END) as untrusted,
        SUM(CASE WHEN is_blacklisted = 1 THEN 1 ELSE 0 END) as blacklisted,
        AVG(reputation_score) as average_score
      FROM peers
    `);
    
    return {
      totalPeers: stats.total_peers || 0,
      trusted: stats.trusted || 0,
      acceptable: stats.acceptable || 0,
      suspicious: stats.suspicious || 0,
      untrusted: stats.untrusted || 0,
      blacklisted: stats.blacklisted || 0,
      averageScore: stats.average_score || 0
    };
  }
  
  // Database maintenance
  async vacuum() {
    return this.run('VACUUM');
  }
  
  async cleanup(maxAge = 365 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge;
    
    // Clean up old verification challenges
    const challengeResult = await this.run(
      'DELETE FROM verification_challenges WHERE timestamp < ?',
      [cutoff]
    );
    
    // Clean up old transfer sessions
    const sessionResult = await this.run(
      'DELETE FROM transfer_sessions WHERE created_at < ? AND status != "active"',
      [cutoff / 1000] // SQLite timestamp is in seconds
    );
    
    console.log(`Cleaned up ${challengeResult.changes} old challenges, ${sessionResult.changes} old sessions`);
    
    return {
      challengesCleaned: challengeResult.changes,
      sessionsCleaned: sessionResult.changes
    };
  }
  
  // Cached peer connection operations
  async cachePeerConnection(peerConnectionData) {
    const query = `
      INSERT OR REPLACE INTO cached_peer_connections
      (peer_id_hash, public_key, ice_data, last_seen, trust_level, 
       connection_attempts, successful_connections, last_connection_success, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, 
              COALESCE((SELECT connection_attempts FROM cached_peer_connections WHERE peer_id_hash = ?), 0) + 1,
              COALESCE((SELECT successful_connections FROM cached_peer_connections WHERE peer_id_hash = ?), 0) + 1,
              ?, ?, strftime('%s', 'now'))
    `;
    
    return this.run(query, [
      peerConnectionData.peerIdHash,
      peerConnectionData.publicKey,
      peerConnectionData.iceData,
      peerConnectionData.lastSeen,
      peerConnectionData.trustLevel || 'software-verified',
      peerConnectionData.peerIdHash, // For connection_attempts increment
      peerConnectionData.peerIdHash, // For successful_connections increment  
      Date.now(),
      JSON.stringify(peerConnectionData.metadata || {})
    ]);
  }

  async getCachedPeers(trustLevelFilter = null, maxAge = 86400000) { // 24 hours default
    let query = `
      SELECT peer_id_hash as peerIdHash, public_key as publicKey, ice_data as iceData, 
             last_seen as lastSeen, trust_level as trustLevel, connection_attempts,
             successful_connections, last_connection_success, metadata
      FROM cached_peer_connections 
      WHERE last_seen > ?
    `;
    const params = [Date.now() - maxAge];
    
    if (trustLevelFilter) {
      query += ' AND trust_level = ?';
      params.push(trustLevelFilter);
    }
    
    query += ' ORDER BY last_seen DESC, successful_connections DESC';
    
    const rows = await this.all(query, params);
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : {}
    }));
  }

  async updatePeerConnectionSuccess(peerIdHash, successful) {
    const query = `
      UPDATE cached_peer_connections 
      SET connection_attempts = connection_attempts + 1,
          successful_connections = CASE WHEN ? THEN successful_connections + 1 ELSE successful_connections END,
          last_connection_success = CASE WHEN ? THEN ? ELSE last_connection_success END,
          last_seen = ?,
          updated_at = strftime('%s', 'now')
      WHERE peer_id_hash = ?
    `;
    
    const now = Date.now();
    return this.run(query, [
      successful ? 1 : 0,
      successful ? 1 : 0,
      successful ? now : 0,
      now,
      peerIdHash
    ]);
  }

  // Transfer chunk state operations for resumption
  async saveTransferChunkState(backupId, chunkIndex, chunkHash, chunkSize, state = 'pending') {
    const query = `
      INSERT OR REPLACE INTO transfer_chunk_states
      (backup_id, chunk_index, chunk_hash, chunk_size, transfer_state, attempts, last_attempt, updated_at)
      VALUES (?, ?, ?, ?, ?, 
              COALESCE((SELECT attempts FROM transfer_chunk_states WHERE backup_id = ? AND chunk_index = ?), 0) + 1,
              strftime('%s', 'now'), strftime('%s', 'now'))
    `;
    
    return this.run(query, [
      backupId, chunkIndex, chunkHash, chunkSize, state,
      backupId, chunkIndex
    ]);
  }

  async getIncompleteChunks(backupId) {
    const query = `
      SELECT chunk_index, chunk_hash, chunk_size, transfer_state, attempts, last_attempt
      FROM transfer_chunk_states 
      WHERE backup_id = ? AND transfer_state NOT IN ('completed', 'verified')
      ORDER BY chunk_index
    `;
    
    return this.all(query, [backupId]);
  }

  async updateChunkState(backupId, chunkIndex, state, errorMessage = null) {
    const query = `
      UPDATE transfer_chunk_states 
      SET transfer_state = ?, error_message = ?, updated_at = strftime('%s', 'now')
      WHERE backup_id = ? AND chunk_index = ?
    `;
    
    return this.run(query, [state, errorMessage, backupId, chunkIndex]);
  }

  async getTransferProgress(backupId) {
    const query = `
      SELECT 
        COUNT(*) as total_chunks,
        SUM(CASE WHEN transfer_state = 'completed' THEN 1 ELSE 0 END) as completed_chunks,
        SUM(CASE WHEN transfer_state = 'failed' THEN 1 ELSE 0 END) as failed_chunks,
        SUM(CASE WHEN transfer_state = 'verified' THEN 1 ELSE 0 END) as verified_chunks,
        SUM(chunk_size) as total_size,
        SUM(CASE WHEN transfer_state IN ('completed', 'verified') THEN chunk_size ELSE 0 END) as completed_size
      FROM transfer_chunk_states
      WHERE backup_id = ?
    `;
    
    const result = await this.get(query, [backupId]);
    return {
      totalChunks: result.total_chunks || 0,
      completedChunks: result.completed_chunks || 0,
      failedChunks: result.failed_chunks || 0,
      verifiedChunks: result.verified_chunks || 0,
      totalSize: result.total_size || 0,
      completedSize: result.completed_size || 0,
      progressPercent: result.total_chunks > 0 ? 
        Math.round(((result.completed_chunks + result.verified_chunks) / result.total_chunks) * 100) : 0
    };
  }

  // Sync schedule operations
  async saveSyncSchedule(peerIdHash, scheduleData) {
    const query = `
      INSERT OR REPLACE INTO sync_schedules
      (peer_id_hash, schedule_type, availability_windows, sync_frequency, 
       next_sync_time, timezone, priority, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;
    
    return this.run(query, [
      peerIdHash,
      scheduleData.scheduleType || 'mutual',
      JSON.stringify(scheduleData.availabilityWindows || []),
      scheduleData.syncFrequency || 'daily',
      scheduleData.nextSyncTime,
      scheduleData.timezone || 'UTC',  
      scheduleData.priority || 5,
      scheduleData.active !== false ? 1 : 0
    ]);
  }

  async getUpcomingSyncSchedules(timeWindow = 3600000) { // 1 hour default
    const query = `
      SELECT s.*, c.public_key, c.trust_level, c.last_seen
      FROM sync_schedules s
      JOIN cached_peer_connections c ON s.peer_id_hash = c.peer_id_hash
      WHERE s.active = 1 AND s.next_sync_time <= ? AND s.next_sync_time > ?
      ORDER BY s.next_sync_time ASC, s.priority DESC
    `;
    
    const now = Date.now();
    const rows = await this.all(query, [now + timeWindow, now]);
    
    return rows.map(row => ({
      ...row,
      availabilityWindows: JSON.parse(row.availability_windows || '[]')
    }));
  }

  async updateNextSyncTime(peerIdHash, nextSyncTime) {
    const query = `
      UPDATE sync_schedules 
      SET next_sync_time = ?, updated_at = strftime('%s', 'now')
      WHERE peer_id_hash = ?
    `;
    
    return this.run(query, [nextSyncTime, peerIdHash]);
  }

  // Get peer connection statistics
  async getPeerConnectionStats(peerIdHash) {
    const query = `
      SELECT peer_id_hash as peerIdHash, public_key as publicKey, 
             connection_attempts, successful_connections, last_connection_success,
             trust_level as trustLevel, last_seen as lastSeen, metadata
      FROM cached_peer_connections 
      WHERE peer_id_hash = ?
    `;
    
    const result = await this.get(query, [peerIdHash]);
    if (!result) return null;
    
    return {
      ...result,
      metadata: result.metadata ? JSON.parse(result.metadata) : {},
      successRate: result.connection_attempts > 0 ? 
        (result.successful_connections / result.connection_attempts) * 100 : 0
    };
  }

  // Remove stale peer connections
  async removeStalePeerConnections(maxAge = 2592000000) { // 30 days default
    const cutoff = Date.now() - maxAge;
    const query = 'DELETE FROM cached_peer_connections WHERE last_seen < ?';
    return this.run(query, [cutoff]);
  }

  // Enhanced cleanup with new tables
  async cleanup(maxAge = 365 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge;
    
    // Clean up old verification challenges
    const challengeResult = await this.run(
      'DELETE FROM verification_challenges WHERE timestamp < ?',
      [cutoff]
    );
    
    // Clean up old transfer sessions
    const sessionResult = await this.run(
      'DELETE FROM transfer_sessions WHERE created_at < ? AND status != "active"',
      [cutoff / 1000]
    );
    
    // Clean up old cached peer connections (keep recently seen ones)
    const cachedPeerResult = await this.run(
      'DELETE FROM cached_peer_connections WHERE last_seen < ?',
      [cutoff]
    );
    
    // Clean up completed transfer chunk states older than 7 days
    const weekCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const chunkResult = await this.run(
      'DELETE FROM transfer_chunk_states WHERE updated_at < ? AND transfer_state IN ("completed", "verified")',
      [weekCutoff / 1000]
    );
    
    console.log(`Cleaned up ${challengeResult.changes} challenges, ${sessionResult.changes} sessions, ${cachedPeerResult.changes} cached peers, ${chunkResult.changes} chunk states`);
    
    return {
      challengesCleaned: challengeResult.changes,
      sessionsCleaned: sessionResult.changes,
      cachedPeersCleaned: cachedPeerResult.changes,
      chunkStatesCleaned: chunkResult.changes
    };
  }

  // Close database connection
  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err.message);
          } else {
            console.log('Database connection closed');
          }
          resolve();
        });
      });
    }
  }
}

module.exports = Database;