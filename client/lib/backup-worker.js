const { parentPort, workerData } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const BackupCrypto = require('./crypto');
const FileTransfer = require('./transfer');
const Database = require('./database');

class BackupWorker {
  constructor(workerData) {
    this.backupId = workerData.backupId;
    this.backupData = workerData.backupData;
    this.configDir = workerData.configDir;
    
    this.isPaused = false;
    this.isCancelled = false;
    this.currentFileIndex = 0;
    this.bytesTransferred = 0;
    this.totalBytes = 0;
    
    // Components
    this.crypto = null;
    this.transfer = null;
    this.database = null;
  }

  async initialize() {
    this.crypto = new BackupCrypto();
    await this.crypto.initializeKeys(this.configDir);
    
    this.database = new Database(this.configDir);
    await this.database.initialize();
    
    // Calculate total size
    for (const file of this.backupData.files) {
      try {
        const stats = await fs.stat(file);
        this.totalBytes += stats.size;
      } catch (error) {
        this.log(`Failed to stat file ${file}: ${error.message}`, 'warn');
      }
    }
    
    this.sendMessage({
      type: 'progress',
      progress: 0,
      totalBytes: this.totalBytes
    });
  }

  async run() {
    try {
      await this.initialize();
      
      // Check for resumption data
      const resumeData = await this.checkResumption();
      if (resumeData) {
        this.currentFileIndex = resumeData.currentFileIndex;
        this.bytesTransferred = resumeData.bytesTransferred;
      }
      
      // Process files
      for (let i = this.currentFileIndex; i < this.backupData.files.length; i++) {
        if (this.isCancelled) break;
        
        await this.waitIfPaused();
        
        const file = this.backupData.files[i];
        this.currentFileIndex = i;
        
        try {
          await this.backupFile(file);
          
          this.sendMessage({
            type: 'file_complete',
            file,
            index: i,
            total: this.backupData.files.length
          });
          
        } catch (error) {
          this.log(`Failed to backup ${file}: ${error.message}`, 'error');
          this.sendMessage({
            type: 'error',
            error: error.message,
            file
          });
        }
        
        // Save progress periodically
        if (i % 5 === 0) {
          await this.saveProgress();
        }
      }
      
      if (!this.isCancelled) {
        this.sendMessage({
          type: 'backup_complete',
          totalFiles: this.backupData.files.length,
          totalBytes: this.bytesTransferred
        });
      }
      
    } catch (error) {
      this.sendMessage({
        type: 'error',
        error: error.message
      });
    } finally {
      if (this.database) {
        await this.database.close();
      }
    }
  }

  async backupFile(filePath) {
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    const chunkSize = 64 * 1024; // 64KB chunks
    
    this.sendMessage({
      type: 'progress',
      progress: Math.round((this.bytesTransferred / this.totalBytes) * 100),
      currentFile: path.basename(filePath),
      bytesTransferred: this.bytesTransferred,
      totalBytes: this.totalBytes
    });
    
    // Simulate file transfer with progress
    const stream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
    let fileBytes = 0;
    
    for await (const chunk of stream) {
      if (this.isCancelled) break;
      await this.waitIfPaused();
      
      // Process chunk (encrypt, transfer, etc.)
      // This is where you'd integrate with FileTransfer
      await this.processChunk(chunk, filePath);
      
      fileBytes += chunk.length;
      this.bytesTransferred += chunk.length;
      
      // Update progress every 10 chunks
      if (fileBytes % (chunkSize * 10) === 0) {
        this.sendMessage({
          type: 'progress',
          progress: Math.round((this.bytesTransferred / this.totalBytes) * 100),
          currentFile: path.basename(filePath),
          bytesTransferred: this.bytesTransferred,
          totalBytes: this.totalBytes
        });
      }
    }
  }

  async processChunk(chunk, filePath) {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Here you would:
    // 1. Encrypt chunk with this.crypto
    // 2. Send via P2P connection
    // 3. Handle acknowledgments
    // 4. Store chunk state in database
  }

  async waitIfPaused() {
    while (this.isPaused && !this.isCancelled) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async checkResumption() {
    try {
      const progress = await this.database.getTransferProgress(this.backupId);
      if (progress && progress.completedChunks > 0) {
        return {
          currentFileIndex: Math.floor(progress.completedChunks / 100), // Approximate
          bytesTransferred: progress.completedSize
        };
      }
    } catch (error) {
      this.log(`Failed to check resumption data: ${error.message}`, 'warn');
    }
    return null;
  }

  async saveProgress() {
    try {
      await this.database.saveTransferChunkState(
        this.backupId,
        this.currentFileIndex,
        'progress',
        this.bytesTransferred,
        'transferring'
      );
    } catch (error) {
      this.log(`Failed to save progress: ${error.message}`, 'warn');
    }
  }

  sendMessage(message) {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }

  log(message, level = 'info') {
    this.sendMessage({
      type: 'log',
      message,
      level
    });
  }
}

// Handle messages from main thread
if (parentPort) {
  const worker = new BackupWorker(workerData);
  
  parentPort.on('message', (message) => {
    switch (message.type) {
      case 'pause':
        worker.isPaused = true;
        break;
      case 'resume':
        worker.isPaused = false;
        break;
      case 'cancel':
        worker.isCancelled = true;
        break;
    }
  });
  
  // Start worker
  worker.run();
}