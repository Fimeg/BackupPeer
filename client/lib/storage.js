const fs = require('fs-extra');
const path = require('path');
const BackupCrypto = require('./crypto');
const BackupIgnore = require('./backup-ignore');
const minimatch = require('minimatch');

class StorageManager {
  constructor(configDir = '~/.backup-peer') {
    this.configDir = configDir.replace('~', require('os').homedir());
    this.backupsDir = path.join(this.configDir, 'backups');
    this.receivedDir = path.join(this.configDir, 'received');
    this.metadataFile = path.join(this.configDir, 'backups.json');
    this.backups = new Map(); // backupId -> backup metadata
  }
  
  async initialize() {
    await fs.ensureDir(this.configDir);
    await fs.ensureDir(this.backupsDir);
    await fs.ensureDir(this.receivedDir);
    
    // Load existing backup metadata
    try {
      if (await fs.pathExists(this.metadataFile)) {
        const metadata = await fs.readJSON(this.metadataFile);
        for (const [id, backup] of Object.entries(metadata)) {
          this.backups.set(id, backup);
        }
        console.log(`Loaded ${this.backups.size} backup records`);
      }
    } catch (error) {
      console.warn('Could not load backup metadata:', error.message);
    }
  }
  
  // Save backup metadata to disk
  async saveMetadata() {
    const metadata = Object.fromEntries(this.backups);
    await fs.writeJSON(this.metadataFile, metadata, { spaces: 2 });
  }
  
  // Record a new backup
  async recordBackup(backupId, backupData) {
    const backup = {
      id: backupId,
      name: backupData.name || backupId,
      timestamp: Date.now(),
      files: backupData.files || [],
      peerId: backupData.peerId,
      status: 'active',
      type: 'sent'
    };
    
    this.backups.set(backupId, backup);
    await this.saveMetadata();
    
    console.log(`Recorded backup: ${backup.name}`);
    return backup;
  }
  
  // Record a received backup
  async recordReceivedBackup(backupId, backupData) {
    const backup = {
      id: backupId,
      name: backupData.name || backupId,
      timestamp: Date.now(),
      files: backupData.files || [],
      peerId: backupData.peerId,
      status: 'active',
      type: 'received',
      location: this.receivedDir
    };
    
    this.backups.set(backupId, backup);
    await this.saveMetadata();
    
    console.log(`Recorded received backup: ${backup.name}`);
    return backup;
  }
  
  // List all backups
  listBackups(type = 'all') {
    const backupList = Array.from(this.backups.values());
    
    if (type === 'all') {
      return backupList;
    }
    
    return backupList.filter(backup => backup.type === type);
  }
  
  // Get specific backup
  getBackup(backupId) {
    return this.backups.get(backupId);
  }
  
  // Delete backup record
  async deleteBackup(backupId) {
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    this.backups.delete(backupId);
    await this.saveMetadata();
    
    console.log(`Deleted backup record: ${backup.name}`);
    return backup;
  }
  
  // Generate storage commitment proof
  generateStorageProof(backupId, challenge) {
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    // Simple challenge-response proof
    const proof = {
      backupId,
      challenge,
      timestamp: Date.now(),
      fileCount: backup.files.length,
      totalSize: backup.files.reduce((sum, file) => sum + file.size, 0),
      // Include hash of some file metadata as proof we have the data
      metadataHash: BackupCrypto.hashData(JSON.stringify(backup.files))
    };
    
    return proof;
  }
  
  // Verify a storage proof from peer
  verifyStorageProof(proof, expectedChallenge, expectedBackupId) {
    if (proof.challenge !== expectedChallenge) {
      return { valid: false, reason: 'Challenge mismatch' };
    }
    
    if (proof.backupId !== expectedBackupId) {
      return { valid: false, reason: 'Backup ID mismatch' };
    }
    
    // Check if proof is recent (within 5 minutes)
    const maxAge = 5 * 60 * 1000;
    if (Date.now() - proof.timestamp > maxAge) {
      return { valid: false, reason: 'Proof too old' };
    }
    
    return { valid: true };
  }
  
  // Calculate storage usage
  async getStorageUsage() {
    const backupList = this.listBackups();
    
    let totalSize = 0;
    let sentSize = 0;
    let receivedSize = 0;
    
    for (const backup of backupList) {
      const backupSize = backup.files.reduce((sum, file) => sum + file.size, 0);
      totalSize += backupSize;
      
      if (backup.type === 'sent') {
        sentSize += backupSize;
      } else {
        receivedSize += backupSize;
      }
    }
    
    return {
      totalBackups: backupList.length,
      totalSize,
      sentSize,
      receivedSize,
      sentBackups: backupList.filter(b => b.type === 'sent').length,
      receivedBackups: backupList.filter(b => b.type === 'received').length
    };
  }
  
  // Check for file existence (for received backups)
  async verifyReceivedFiles(backupId) {
    const backup = this.backups.get(backupId);
    if (!backup || backup.type !== 'received') {
      throw new Error('Invalid backup for verification');
    }
    
    const results = [];
    
    for (const file of backup.files) {
      const filePath = path.join(this.receivedDir, file.name);
      
      try {
        const exists = await fs.pathExists(filePath);
        let valid = false;
        
        if (exists) {
          const actualHash = await BackupCrypto.hashFile(filePath);
          valid = actualHash === file.hash;
        }
        
        results.push({
          name: file.name,
          path: filePath,
          exists,
          valid,
          expectedHash: file.hash
        });
        
      } catch (error) {
        results.push({
          name: file.name,
          path: filePath,
          exists: false,
          valid: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
  
  // Export backup list for sharing/syncing
  exportBackupList() {
    return {
      timestamp: Date.now(),
      backups: Array.from(this.backups.values()).map(backup => ({
        id: backup.id,
        name: backup.name,
        timestamp: backup.timestamp,
        fileCount: backup.files.length,
        totalSize: backup.files.reduce((sum, file) => sum + file.size, 0),
        type: backup.type,
        status: backup.status
      }))
    };
  }
  
  // Clean up old/invalid backup records
  async cleanup() {
    let cleaned = 0;
    const toDelete = [];
    
    for (const [backupId, backup] of this.backups) {
      // Remove backups older than 1 year
      const maxAge = 365 * 24 * 60 * 60 * 1000;
      if (Date.now() - backup.timestamp > maxAge) {
        toDelete.push(backupId);
        continue;
      }
      
      // For received backups, check if files still exist
      if (backup.type === 'received') {
        try {
          const verification = await this.verifyReceivedFiles(backupId);
          const validFiles = verification.filter(f => f.exists && f.valid);
          
          if (validFiles.length === 0) {
            toDelete.push(backupId);
          }
        } catch (error) {
          console.warn(`Could not verify backup ${backupId}:`, error.message);
        }
      }
    }
    
    for (const backupId of toDelete) {
      await this.deleteBackup(backupId);
      cleaned++;
    }
    
    console.log(`Cleaned up ${cleaned} old backup records`);
    return cleaned;
  }

  async selectFilesForBackup(directory, options = {}) {
    const {
      includePatterns = [],
      excludePatterns = [],
      maxFileSize = 1024 * 1024 * 1024, // 1GB default
      priorityPatterns = ['*.key', '*.wallet', '*.password', '*.p12', '*.pem']
    } = options;

    const backupIgnore = new BackupIgnore();
    await backupIgnore.loadIgnoreFile(directory);
    
    // Add exclude patterns to ignore list
    excludePatterns.forEach(pattern => backupIgnore.addPattern(pattern));
    
    const files = [];
    const walk = async (dir, relativePath = '') => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);
          
          if (entry.isDirectory()) {
            if (!backupIgnore.shouldIgnore(relPath)) {
              await walk(fullPath, relPath);
            }
          } else if (entry.isFile()) {
            // Check ignore patterns
            if (backupIgnore.shouldIgnore(relPath)) {
              continue;
            }
            
            // Check include patterns (if specified)
            if (includePatterns.length > 0) {
              const matches = includePatterns.some(pattern => 
                minimatch(relPath, pattern, { dot: true })
              );
              if (!matches) continue;
            }
            
            try {
              const stats = await fs.stat(fullPath);
              
              // Apply size filter
              if (stats.size <= maxFileSize) {
                const priority = this.calculatePriority(relPath, priorityPatterns);
                
                files.push({
                  path: fullPath,
                  relativePath: relPath,
                  size: stats.size,
                  modified: stats.mtime,
                  priority,
                  hash: null // Will be calculated during backup
                });
              }
            } catch (statError) {
              console.warn(`Could not stat file ${fullPath}:`, statError.message);
            }
          }
        }
      } catch (readdirError) {
        console.warn(`Could not read directory ${dir}:`, readdirError.message);
      }
    };
    
    await walk(directory);
    
    // Sort by priority (higher first), then by size (smaller first for faster initial transfers)
    files.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.size - b.size;
    });
    
    return files;
  }

  calculatePriority(filePath, priorityPatterns) {
    for (let i = 0; i < priorityPatterns.length; i++) {
      if (minimatch(filePath, priorityPatterns[i], { dot: true })) {
        return priorityPatterns.length - i; // Higher index = higher priority
      }
    }
    return 0; // Default priority
  }

  async estimateBackupSize(files) {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const priorityFiles = files.filter(f => f.priority > 0);
    const regularFiles = files.filter(f => f.priority === 0);
    
    return {
      totalFiles: files.length,
      totalSize,
      priorityFiles: priorityFiles.length,
      prioritySize: priorityFiles.reduce((sum, f) => sum + f.size, 0),
      regularFiles: regularFiles.length,
      regularSize: regularFiles.reduce((sum, f) => sum + f.size, 0),
      formattedSize: this.formatFileSize(totalSize)
    };
  }

  formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
  
  // Restore backup from received chunks
  async restoreBackup(backupId, targetDirectory, options = {}) {
    const {
      overwrite = false,
      verifyIntegrity = true,
      onProgress = null,
      onFileComplete = null
    } = options;
    
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    if (backup.type !== 'received') {
      throw new Error('Can only restore received backups');
    }
    
    console.log(`Starting restore of backup ${backup.name} to ${targetDirectory}`);
    
    // Ensure target directory exists
    await fs.ensureDir(targetDirectory);
    
    const results = {
      totalFiles: backup.files.length,
      restoredFiles: 0,
      failedFiles: 0,
      skippedFiles: 0,
      totalBytes: 0,
      restoredBytes: 0,
      errors: []
    };
    
    // Calculate total size
    results.totalBytes = backup.files.reduce((sum, file) => sum + file.size, 0);
    
    for (let i = 0; i < backup.files.length; i++) {
      const file = backup.files[i];
      const progress = ((i + 1) / backup.files.length) * 100;
      
      if (onProgress) {
        onProgress({
          currentFile: i + 1,
          totalFiles: backup.files.length,
          progress,
          fileName: file.name,
          fileSize: file.size
        });
      }
      
      try {
        const result = await this.restoreFile(file, targetDirectory, { overwrite, verifyIntegrity });
        
        if (result.success) {
          results.restoredFiles++;
          results.restoredBytes += file.size;
          
          if (onFileComplete) {
            onFileComplete({ file, success: true, path: result.path });
          }
        } else {
          results.failedFiles++;
          results.errors.push({ file: file.name, error: result.error });
          
          if (onFileComplete) {
            onFileComplete({ file, success: false, error: result.error });
          }
        }
        
      } catch (error) {
        results.failedFiles++;
        results.errors.push({ file: file.name, error: error.message });
        
        if (onFileComplete) {
          onFileComplete({ file, success: false, error: error.message });
        }
      }
    }
    
    console.log(`Restore completed: ${results.restoredFiles}/${results.totalFiles} files restored`);
    
    if (results.errors.length > 0) {
      console.warn(`Restore had ${results.errors.length} errors:`, results.errors);
    }
    
    return results;
  }
  
  // Restore individual file from chunks
  async restoreFile(file, targetDirectory, options = {}) {
    const { overwrite = false, verifyIntegrity = true } = options;
    
    const targetPath = path.join(targetDirectory, file.relativePath || file.name);
    const targetDir = path.dirname(targetPath);
    
    // Check if file already exists
    if (!overwrite && await fs.pathExists(targetPath)) {
      return { success: false, error: 'File already exists and overwrite is false' };
    }
    
    // Ensure target directory exists
    await fs.ensureDir(targetDir);
    
    try {
      // For chunked files, reassemble from chunks
      if (file.chunks && file.chunks.length > 0) {
        await this.reassembleFileFromChunks(file, targetPath, verifyIntegrity);
      } else {
        // Single file - copy from received directory
        const sourcePath = path.join(this.receivedDir, file.name);
        
        if (!await fs.pathExists(sourcePath)) {
          return { success: false, error: 'Source file not found in received directory' };
        }
        
        await fs.copy(sourcePath, targetPath);
        
        // Verify integrity if requested
        if (verifyIntegrity && file.hash) {
          const actualHash = await BackupCrypto.hashFile(targetPath);
          if (actualHash !== file.hash) {
            await fs.remove(targetPath); // Clean up corrupted file
            return { success: false, error: 'File integrity verification failed' };
          }
        }
      }
      
      // Restore file attributes if available
      if (file.modified) {
        const stats = await fs.stat(targetPath);
        await fs.utimes(targetPath, stats.atime, new Date(file.modified));
      }
      
      return { success: true, path: targetPath };
      
    } catch (error) {
      // Clean up partial file on error
      try {
        if (await fs.pathExists(targetPath)) {
          await fs.remove(targetPath);
        }
      } catch (cleanupError) {
        console.warn('Could not clean up partial file:', cleanupError.message);
      }
      
      return { success: false, error: error.message };
    }
  }
  
  // Reassemble file from encrypted chunks
  async reassembleFileFromChunks(file, targetPath, verifyIntegrity = true) {
    const chunks = file.chunks.sort((a, b) => a.index - b.index);
    const writeStream = fs.createWriteStream(targetPath);
    
    try {
      for (const chunk of chunks) {
        const chunkPath = path.join(this.receivedDir, 'chunks', chunk.id);
        
        if (!await fs.pathExists(chunkPath)) {
          throw new Error(`Missing chunk: ${chunk.id}`);
        }
        
        // Decrypt chunk if needed
        let chunkData;
        if (chunk.encrypted) {
          const encryptedData = await fs.readFile(chunkPath);
          chunkData = await BackupCrypto.decryptData(encryptedData, chunk.key);
        } else {
          chunkData = await fs.readFile(chunkPath);
        }
        
        // Verify chunk integrity
        if (verifyIntegrity && chunk.hash) {
          const actualHash = BackupCrypto.hashData(chunkData);
          if (actualHash !== chunk.hash) {
            throw new Error(`Chunk integrity verification failed: ${chunk.id}`);
          }
        }
        
        // Write chunk to file
        await new Promise((resolve, reject) => {
          writeStream.write(chunkData, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
      
      // Close write stream
      await new Promise((resolve, reject) => {
        writeStream.end((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      // Verify final file integrity
      if (verifyIntegrity && file.hash) {
        const actualHash = await BackupCrypto.hashFile(targetPath);
        if (actualHash !== file.hash) {
          throw new Error('Final file integrity verification failed');
        }
      }
      
    } catch (error) {
      writeStream.destroy();
      throw error;
    }
  }
  
  // Get restore preview/analysis
  async getRestorePreview(backupId, targetDirectory) {
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    
    const preview = {
      backupName: backup.name,
      backupDate: new Date(backup.timestamp).toLocaleString(),
      totalFiles: backup.files.length,
      totalSize: backup.files.reduce((sum, file) => sum + file.size, 0),
      formattedSize: this.formatFileSize(backup.files.reduce((sum, file) => sum + file.size, 0)),
      conflicts: [],
      missingChunks: [],
      readyToRestore: true
    };
    
    // Check for file conflicts
    for (const file of backup.files) {
      const targetPath = path.join(targetDirectory, file.relativePath || file.name);
      
      if (await fs.pathExists(targetPath)) {
        const existingStats = await fs.stat(targetPath);
        preview.conflicts.push({
          path: file.relativePath || file.name,
          existingSize: existingStats.size,
          backupSize: file.size,
          existingModified: existingStats.mtime,
          backupModified: new Date(file.modified || backup.timestamp)
        });
      }
    }
    
    // Check for missing chunks
    for (const file of backup.files) {
      if (file.chunks && file.chunks.length > 0) {
        for (const chunk of file.chunks) {
          const chunkPath = path.join(this.receivedDir, 'chunks', chunk.id);
          if (!await fs.pathExists(chunkPath)) {
            preview.missingChunks.push({
              file: file.name,
              chunkId: chunk.id,
              chunkIndex: chunk.index
            });
          }
        }
      } else {
        // Single file - check if it exists in received directory
        const sourcePath = path.join(this.receivedDir, file.name);
        if (!await fs.pathExists(sourcePath)) {
          preview.missingChunks.push({
            file: file.name,
            reason: 'File not found in received directory'
          });
        }
      }
    }
    
    preview.readyToRestore = preview.missingChunks.length === 0;
    
    return preview;
  }
}

module.exports = StorageManager;