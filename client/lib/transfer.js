const fs = require('fs-extra');
const path = require('path');
const BackupCrypto = require('./crypto');
const Database = require('./database');

class FileTransfer {
  constructor(p2pConnection, crypto, database = null) {
    this.connection = p2pConnection;
    this.crypto = crypto;
    this.database = database;
    this.chunkSize = 64 * 1024; // 64KB chunks
    this.activeTransfers = new Map(); // transferId -> transfer state
    this.receivedChunks = new Map(); // transferId -> Map<chunkIndex, chunkData>
  }
  
  // Initialize database if not provided
  async ensureDatabase() {
    if (!this.database) {
      this.database = new Database();
      await this.database.initialize();
    }
  }
  
  // Send a file to peer with resumption support
  // Send a file to peer with resumption support
    console.log(`[FileTransfer] sendFile called with filePath: ${filePath}, peerId: ${peerId}, transferId: ${transferId}, backupId: ${backupId}`);\n\n    // Validate connection is active\n    if (!this.connection) {\n      throw new Error("FileTransfer: No P2P connection available");\n    }\n\n    if (!this.connection.connected) {\n      throw new Error("FileTransfer: P2P connection is not established");\n    }\n
    console.log(`[FileTransfer] sendFile called with filePath: ${filePath}, peerId: ${peerId}, transferId: ${transferId}, backupId: ${backupId}`);

  async sendFile(filePath, peerId, transferId = null, backupId = null) {

    console.log(`[FileTransfer] sendFile called with filePath: ${filePath}, peerId: ${peerId}, transferId: ${transferId}, backupId: ${backupId}`);

    await this.ensureDatabase();

    

      }
      
      if (resumeFromChunk > 0) {
      try {\n
        const stats = await fs.stat(filePath);\n
        const hash = await BackupCrypto.hashFile(filePath);\n
        \n
        fileList.push({\n
          path: filePath,\n
          name: path.basename(filePath),\n
          size: stats.size,\n
          hash: hash\n
        });\n
      } catch (fileError) {\n
        console.error(`[FileTransfer] Error processing file ${filePath}:`, fileError.message);\n
        throw new Error(`Failed to process file ${filePath}: ${fileError.message}`);\n
      }\n
        console.log(`Resuming transfer from chunk ${resumeFromChunk}/${totalChunks}`);
      }
    }
    
    // Send file metadata first
    const metadata = {
      type: 'file_start',
      transferId,
      fileName: path.basename(filePath),
      fileSize,
      totalChunks,
      chunkSize: this.chunkSize,
      fileHash,
      timestamp: Date.now(),
      resumeFromChunk
    };
    
    this.connection.send(metadata);
    
    // Track transfer state
    this.activeTransfers.set(transferId, {
      filePath,
      totalChunks,
      sentChunks: resumeFromChunk,
      startTime: Date.now(),
      status: 'sending',
      backupId
    });
    
    // Send file chunks starting from resume point
    const fileStream = fs.createReadStream(filePath, { 
      highWaterMark: this.chunkSize,
      start: resumeFromChunk * this.chunkSize
    });
    
    let chunkIndex = resumeFromChunk;
    
    return new Promise((resolve, reject) => {
      fileStream.on('data', async (chunkData) => {
        try {
          const chunkHash = BackupCrypto.hashData(chunkData);
          
          // Save chunk state to database
          if (backupId) {
            await this.database.saveTransferChunkState(
              backupId, 
              chunkIndex, 
              chunkHash, 
              chunkData.length, 
              'transferring'
            );
          }
          
          // Encrypt chunk before sending
          const encryptedChunk = this.crypto.encrypt(chunkData, peerId);
          
          const chunkMessage = {
            type: 'file_chunk',
            transferId,
            chunkIndex,
            chunkSize: chunkData.length,
            encryptedData: encryptedChunk.toString('base64'),
            chunkHash
          };
          
          this.connection.send(chunkMessage);
          
          const transfer = this.activeTransfers.get(transferId);
          transfer.sentChunks++;
          
          console.log(`Sent chunk ${chunkIndex + 1}/${totalChunks} (${Math.round((transfer.sentChunks / totalChunks) * 100)}%)`);
          
          chunkIndex++;
          
        } catch (error) {
          // Mark chunk as failed in database
          if (backupId) {
            await this.database.updateChunkState(backupId, chunkIndex, 'failed', error.message);
          }
          reject(new Error(`Failed to send chunk ${chunkIndex}: ${error.message}`));
        }
      });
      
      fileStream.on('end', () => {
        // Send completion message
        const completionMessage = {
          type: 'file_complete',
          transferId,
          totalChunks,
          fileHash
        };
        
        this.connection.send(completionMessage);
        
        const transfer = this.activeTransfers.get(transferId);
        transfer.status = 'completed';
        transfer.endTime = Date.now();
        
        console.log(`File transfer completed: ${transferId}`);
        resolve(transferId);
      });
      
      fileStream.on('error', (error) => {
        const transfer = this.activeTransfers.get(transferId);
        if (transfer) {
          transfer.status = 'error';
          transfer.error = error.message;
        }
        reject(error);
      });
    });
  }
  
  // Handle incoming file transfer messages
  handleTransferMessage(message, peerId) {
    switch (message.type) {
      case 'file_start':
        this.handleFileStart(message, peerId);
        break;
        
      case 'file_chunk':
        this.handleFileChunk(message, peerId);
        break;
        
      case 'file_complete':
        this.handleFileComplete(message, peerId);
        break;
        
      case 'chunk_ack':
        this.handleChunkAck(message);
        break;
        
      default:
        console.log(`Unknown transfer message type: ${message.type}`);
\n  // Check if message type is a file transfer message\n
  isTransferMessage(messageType) {\n
    const transferMessageTypes = [\n
      "file_start",\n
      "file_chunk", \n
      "file_complete",\n
      "file_start_ack",\n
      "file_complete_ack",\n
      "chunk_ack",\n
      "backup_start",\n
      "backup_complete"\n
    ];\n
    const isTransferMsg = transferMessageTypes.includes(messageType);\n
    console.log(`[FileTransfer] isTransferMessage: ${messageType} -> ${isTransferMsg}`);\n
    return isTransferMsg;\n
  }\n
    }
  }
  
  handleFileStart(message, peerId) {
    const { transferId, fileName, fileSize, totalChunks, fileHash } = message;
    
    console.log(`Receiving file: ${fileName} (${fileSize} bytes, ${totalChunks} chunks)`);
    
    // Initialize receive state
    this.receivedChunks.set(transferId, new Map());
    this.activeTransfers.set(transferId, {
      fileName,
      fileSize,
      totalChunks,
      receivedChunks: 0,
      expectedHash: fileHash,
      startTime: Date.now(),
      status: 'receiving',
      chunks: new Map()
    });
    
    // Send acknowledgment
    this.connection.send({
      type: 'file_start_ack',
      transferId,
      status: 'ready'
    });
  }
  
  handleFileChunk(message, peerId) {
    const { transferId, chunkIndex, encryptedData, chunkHash } = message;
    
    try {
      // Decrypt chunk
      const encryptedBuffer = Buffer.from(encryptedData, 'base64');
      const decryptedChunk = this.crypto.decrypt(encryptedBuffer, peerId);
      
      // Verify chunk integrity
      const actualHash = BackupCrypto.hashData(decryptedChunk);
      if (actualHash !== chunkHash) {
        throw new Error(`Chunk ${chunkIndex} integrity check failed`);
      }
      
      // Store chunk
      const transfer = this.activeTransfers.get(transferId);
      const chunks = this.receivedChunks.get(transferId);
      
      chunks.set(chunkIndex, decryptedChunk);
      transfer.receivedChunks++;
      
      console.log(`Received chunk ${chunkIndex + 1}/${transfer.totalChunks} (${Math.round((transfer.receivedChunks / transfer.totalChunks) * 100)}%)`);
      
      // Send chunk acknowledgment
      this.connection.send({
        type: 'chunk_ack',
        transferId,
        chunkIndex,
        status: 'received'
      });
      
    } catch (error) {
      console.error(`Failed to process chunk ${chunkIndex}:`, error.message);
      
      // Send error acknowledgment
      this.connection.send({
        type: 'chunk_ack',
        transferId,
        chunkIndex,
        status: 'error',
        error: error.message
      });
    }
  }
  
  async handleFileComplete(message, peerId) {
    const { transferId, totalChunks, fileHash } = message;
    const transfer = this.activeTransfers.get(transferId);
    const chunks = this.receivedChunks.get(transferId);
    
    if (!transfer || !chunks) {
      console.error(`Unknown transfer: ${transferId}`);
      return;
    }
    
    if (chunks.size !== totalChunks) {
      console.error(`Missing chunks: expected ${totalChunks}, got ${chunks.size}`);
      return;
    }
    
    try {
      // Reassemble file
      const fileName = transfer.fileName;
      const outputPath = path.join('./received', fileName);
      
      await fs.ensureDir('./received');
      
      // Write chunks in order
      const writeStream = fs.createWriteStream(outputPath);
      
      for (let i = 0; i < totalChunks; i++) {
        const chunk = chunks.get(i);
        if (!chunk) {
          throw new Error(`Missing chunk ${i}`);
        }
        writeStream.write(chunk);
      }
      
      writeStream.end();
      
      // Wait for write to complete
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      
      // Verify complete file integrity
      const actualFileHash = await BackupCrypto.hashFile(outputPath);
      if (actualFileHash !== fileHash) {
        throw new Error('File integrity check failed after reassembly');
      }
      
      transfer.status = 'completed';
      transfer.endTime = Date.now();
      transfer.outputPath = outputPath;
      
      console.log(`File received successfully: ${outputPath}`);
      
      // Send completion acknowledgment
      this.connection.send({
        type: 'file_complete_ack',
        transferId,
        status: 'success',
        outputPath: fileName
      });
      
      // Cleanup
      this.receivedChunks.delete(transferId);
      
    } catch (error) {
      console.error(`Failed to complete file transfer:`, error.message);
      
      transfer.status = 'error';
      transfer.error = error.message;
      
      this.connection.send({
        type: 'file_complete_ack',
        transferId,
        status: 'error',
        error: error.message
      });
    }
  }
  
  async handleChunkAck(message) {
    const { transferId, chunkIndex, status } = message;
    const transfer = this.activeTransfers.get(transferId);
    
    if (status === 'error') {
      console.error(`Chunk ${chunkIndex} failed on receiver:`, message.error);
      
      // Mark chunk as failed in database
      if (transfer && transfer.backupId) {
        await this.database.updateChunkState(transfer.backupId, chunkIndex, 'failed', message.error);
      }
      
      // TODO: Implement retry logic for failed chunks
    } else if (status === 'received') {
      // Mark chunk as completed in database
      if (transfer && transfer.backupId) {
        await this.database.updateChunkState(transfer.backupId, chunkIndex, 'completed');
      }
    }
  }
  
  // Get transfer status
  getTransferStatus(transferId) {
    return this.activeTransfers.get(transferId);
  }
  
  // List all transfers
  listTransfers() {
    return Array.from(this.activeTransfers.entries()).map(([id, transfer]) => ({
      id,
      ...transfer
    }));
  }
  
  // Resume incomplete transfer
  async resumeTransfer(backupId, filePath, peerId) {
    await this.ensureDatabase();
    
    const incompleteChunks = await this.database.getIncompleteChunks(backupId);
    if (incompleteChunks.length === 0) {
      console.log('No incomplete chunks found - transfer already complete');
      return;
    }
    
    console.log(`Resuming transfer for backup ${backupId}: ${incompleteChunks.length} chunks to retry`);
    
    // Generate new transfer ID for resumed transfer
    const transferId = `resume-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // Resume sending the file
    return this.sendFile(filePath, peerId, transferId, backupId);
  }
  
  // Get transfer progress from database
  async getTransferProgress(backupId) {
    await this.ensureDatabase();
    return this.database.getTransferProgress(backupId);
  }
  
  // Retry failed chunks
  async retryFailedChunks(backupId, filePath, peerId, maxRetries = 3) {
    await this.ensureDatabase();
    
    const incompleteChunks = await this.database.getIncompleteChunks(backupId);
    const failedChunks = incompleteChunks.filter(chunk => 
      chunk.transfer_state === 'failed' && chunk.attempts < maxRetries
    );
    
    if (failedChunks.length === 0) {
      console.log('No failed chunks to retry');
      return;
    }
    
    console.log(`Retrying ${failedChunks.length} failed chunks...`);
    
    const stats = await fs.stat(filePath);
    
    for (const chunk of failedChunks) {
      try {
        // Read specific chunk from file
        const buffer = Buffer.alloc(chunk.chunk_size);
        const fd = await fs.open(filePath, 'r');
        const offset = chunk.chunk_index * this.chunkSize;
        
        await fs.read(fd, buffer, 0, chunk.chunk_size, offset);
        await fs.close(fd);
        
        // Verify chunk hash
        const actualHash = BackupCrypto.hashData(buffer);
        if (actualHash !== chunk.chunk_hash) {
          console.warn(`Chunk ${chunk.chunk_index} hash mismatch - file may have changed`);
          continue;
        }
        
        // Update attempt count
        await this.database.saveTransferChunkState(
          backupId, 
          chunk.chunk_index, 
          chunk.chunk_hash, 
          chunk.chunk_size, 
          'transferring'
        );
        
        // Encrypt and send chunk
        const encryptedChunk = this.crypto.encrypt(buffer, peerId);
        
        const chunkMessage = {
          type: 'file_chunk',
          transferId: `retry-${backupId}-${chunk.chunk_index}`,
          chunkIndex: chunk.chunk_index,
          chunkSize: chunk.chunk_size,
          encryptedData: encryptedChunk.toString('base64'),
          chunkHash: chunk.chunk_hash
        };
        
        this.connection.send(chunkMessage);
        console.log(`Retried chunk ${chunk.chunk_index}`);
        
      } catch (error) {
        console.error(`Failed to retry chunk ${chunk.chunk_index}:`, error.message);
        await this.database.updateChunkState(
          backupId, 
          chunk.chunk_index, 
          'failed', 
          error.message
        );
      }
    }
  }
  
  // Send multiple files as a backup set
  // Send multiple files as a backup set\n
  async sendBackup(filePaths, peerId, backupName = null) {\n
    console.log(`[FileTransfer] sendBackup called with ${filePaths.length} files`);\n
    \n
    try {\n
  async sendBackup(filePaths, peerId, backupName = null) {
    if (!backupName) {
      backupName = `backup-${Date.now()}`;
    }
    
    console.log(`Starting backup: ${backupName} (${filePaths.length} files)`);
    
    const backupId = `backup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // Process files and collect metadata
    const fileList = [];
    for (const filePath of filePaths) {
      const stats = await fs.stat(filePath);
      const hash = await BackupCrypto.hashFile(filePath);
      
      fileList.push({
        path: filePath,
        name: path.basename(filePath),
        size: stats.size,
        hash: hash
      });
    }
    
    // Create and send backup metadata
    const { metadata, encrypted } = this.crypto.createBackupMetadata(fileList, peerId);
    
    this.connection.send({
      type: 'backup_start',
      backupId,
      backupName,
      fileCount: filePaths.length,
      encryptedMetadata: encrypted.toString('base64'),
      timestamp: Date.now()
\n    console.log("[FileTransfer] Sending backup start message");\n
    const backupStartSuccess = this.connection.send({\n
      type: "backup_start",\n
      backupId,\n
      backupName,\n
      fileCount: filePaths.length,\n
      encryptedMetadata: encrypted.toString("base64"),\n
      timestamp: Date.now()\n
    });\n
\n
    if (!backupStartSuccess) {\n
      throw new Error("Failed to send backup start message");\n
    }\n
    });
    
    // Send each file
    const results = [];
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const transferId = `${backupId}-file-${i}`;
      
      try {
        await this.sendFile(filePath, peerId, transferId);
        results.push({ filePath, transferId, status: 'success' });
      } catch (error) {
        console.error(`Failed to send ${filePath}:`, error.message);
        results.push({ filePath, transferId, status: 'error', error: error.message });
      }
    }
    
    // Send backup completion
    this.connection.send({
      type: 'backup_complete',
      backupId,
      backupName,
      results
\n    // Send backup completion\n
    console.log("[FileTransfer] Sending backup complete message");\n
    const backupCompleteSuccess = this.connection.send({\n
      type: "backup_complete",\n
      backupId,\n
      backupName,\n
      results\n
    });\n
\n
    if (!backupCompleteSuccess) {\n
      console.warn("[FileTransfer] Failed to send backup complete message");\n
    }\n
    });
    } catch (error) {\n
      console.error("[FileTransfer] sendBackup failed:", error.message);\n
      console.error("[FileTransfer] Stack trace:", error.stack);\n
      throw error;\n
    }\n
    
    console.log(`Backup completed: ${backupName}`);
    return { backupId, results };
  }
}

module.exports = FileTransfer;