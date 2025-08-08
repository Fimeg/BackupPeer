#!/usr/bin/env node

const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const fs = require('fs-extra');
const path = require('path');
const net = require('net');
const BackupCrypto = require('./crypto');
const StorageManager = require('./storage');
const Database = require('./database');
const P2PConnection = require('./p2p');

class BackupPeerService extends EventEmitter {
  constructor() {
    super();
    this.configDir = path.join(require('os').homedir(), '.backup-peer');
    this.socketPath = path.join(this.configDir, 'backuppeer.sock');
    this.pidFile = path.join(this.configDir, 'backuppeer.pid');
    this.logFile = path.join(this.configDir, 'service.log');
    
    this.workers = new Map(); // backupId -> worker
    this.activeBackups = new Map(); // backupId -> backup state
    this.connections = new Map(); // peerId -> P2P connection
    this.ipcServer = null;
    this.isShuttingDown = false;
    
    // Components
    this.crypto = null;
    this.storage = null;
    this.database = null;
  }

  async initialize() {
    await fs.ensureDir(this.configDir);
    
    // Check if service is already running
    if (await this.isRunning()) {
      throw new Error('BackupPeer service is already running');
    }
    
    // Initialize components
    this.crypto = new BackupCrypto();
    await this.crypto.initializeKeys();
    
    this.storage = new StorageManager();
    await this.storage.initialize();
    
    this.database = new Database();
    await this.database.initialize();
    
    // Write PID file
    await fs.writeFile(this.pidFile, process.pid.toString());
    
    // Setup IPC server for CLI/TUI communication
    await this.setupIPCServer();
    
    // Setup signal handlers
    this.setupSignalHandlers();
    
    // Restore interrupted backups
    await this.restoreInterruptedBackups();
    
    this.log('BackupPeer service initialized');
  }

  async isRunning() {
    try {
      if (await fs.pathExists(this.pidFile)) {
        const pid = parseInt(await fs.readFile(this.pidFile, 'utf8'));
        // Check if process is actually running
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          // Process not running, clean up stale PID file
          await fs.remove(this.pidFile);
          return false;
        }
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  setupIPCServer() {
    return new Promise((resolve, reject) => {
      // Clean up old socket if exists
      if (fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }

      this.ipcServer = net.createServer((client) => {
        this.handleIPCConnection(client);
      });

      this.ipcServer.listen(this.socketPath, () => {
        // Set socket permissions for user access only
        fs.chmodSync(this.socketPath, '600');
        this.log('IPC server listening');
        resolve();
      });

      this.ipcServer.on('error', reject);
    });
  }

  handleIPCConnection(client) {
    let buffer = '';
    
    client.on('data', async (data) => {
      buffer += data.toString();
      
      // Process complete messages
      const messages = buffer.split('\n');
      buffer = messages.pop(); // Keep incomplete message in buffer
      
      for (const message of messages) {
        if (message.trim()) {
          try {
            const command = JSON.parse(message);
            await this.handleCommand(command, client);
          } catch (error) {
            this.sendIPCResponse(client, {
              error: error.message,
              command: message
            });
          }
        }
      }
    });

    client.on('error', (error) => {
      this.log(`IPC client error: ${error.message}`, 'error');
    });
  }

  async handleCommand(command, client) {
    const { type, data } = command;
    
    switch (type) {
      case 'start_backup':
        await this.startBackup(data, client);
        break;
        
      case 'get_progress':
        await this.getBackupProgress(data.backupId, client);
        break;
        
      case 'list_active':
        await this.listActiveBackups(client);
        break;
        
      case 'pause_backup':
        await this.pauseBackup(data.backupId, client);
        break;
        
      case 'resume_backup':
        await this.resumeBackup(data.backupId, client);
        break;
        
      case 'cancel_backup':
        await this.cancelBackup(data.backupId, client);
        break;
        
      case 'get_status':
        await this.getServiceStatus(client);
        break;
        
      case 'shutdown':
        await this.shutdown(client);
        break;
        
      default:
        this.sendIPCResponse(client, {
          error: `Unknown command: ${type}`
        });
    }
  }

  async startBackup(backupData, client) {
    const backupId = `backup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    try {
      // Create backup state
      const backupState = {
        id: backupId,
        name: backupData.name,
        files: backupData.files,
        peerId: backupData.peerId,
        status: 'initializing',
        progress: 0,
        startTime: Date.now(),
        worker: null,
        isPaused: false
      };
      
      this.activeBackups.set(backupId, backupState);
      
      // Get or create P2P connection
      let connection = this.connections.get(backupData.peerId);
      if (!connection || !connection.connected) {
        connection = await this.createP2PConnection(backupData);
        this.connections.set(backupData.peerId, connection);
      }
      
      // Create worker for backup processing
      const worker = new Worker(path.join(__dirname, 'backup-worker.js'), {
        workerData: {
          backupId,
          backupData,
          configDir: this.configDir
        }
      });
      
      backupState.worker = worker;
      
      // Handle worker messages
      worker.on('message', (message) => {
        this.handleWorkerMessage(backupId, message);
      });
      
      worker.on('error', (error) => {
        this.log(`Worker error for ${backupId}: ${error.message}`, 'error');
        backupState.status = 'error';
        backupState.error = error.message;
      });
      
      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          this.log(`Worker exited unexpectedly for ${backupId} with code ${code}`, 'error');
          backupState.status = 'failed';
        }
      });
      
      this.sendIPCResponse(client, {
        success: true,
        backupId,
        message: 'Backup started successfully'
      });
      
    } catch (error) {
      this.activeBackups.delete(backupId);
      this.sendIPCResponse(client, {
        error: error.message
      });
    }
  }

  async createP2PConnection(backupData) {
    const connection = new P2PConnection({
      peerId: `service-${Date.now()}`,
      signalingUrl: backupData.signalingUrl || 'wss://backup01.wiuf.net',
      requirements: {
        storage: backupData.storageSize || 10 * 1024 * 1024 * 1024
      }
    });
    
    await connection.connect();
    
    return connection;
  }

  handleWorkerMessage(backupId, message) {
    const backupState = this.activeBackups.get(backupId);
    if (!backupState) return;
    
    switch (message.type) {
      case 'progress':
        backupState.progress = message.progress;
        backupState.currentFile = message.currentFile;
        backupState.bytesTransferred = message.bytesTransferred;
        backupState.totalBytes = message.totalBytes;
        this.emit('backup_progress', { backupId, ...message });
        break;
        
      case 'file_complete':
        backupState.completedFiles = (backupState.completedFiles || 0) + 1;
        this.emit('file_complete', { backupId, ...message });
        break;
        
      case 'backup_complete':
        backupState.status = 'completed';
        backupState.endTime = Date.now();
        this.saveBackupRecord(backupId, backupState);
        this.emit('backup_complete', { backupId, ...message });
        break;
        
      case 'error':
        backupState.status = 'error';
        backupState.error = message.error;
        this.emit('backup_error', { backupId, ...message });
        break;
        
      case 'log':
        this.log(`[Worker ${backupId}] ${message.message}`, message.level);
        break;
    }
    
    // Save state periodically
    if (message.type === 'progress' && backupState.progress % 10 === 0) {
      this.saveBackupState(backupId, backupState);
    }
  }

  async getBackupProgress(backupId, client) {
    const backupState = this.activeBackups.get(backupId);
    
    if (!backupState) {
      this.sendIPCResponse(client, {
        error: 'Backup not found'
      });
      return;
    }
    
    this.sendIPCResponse(client, {
      backupId,
      status: backupState.status,
      progress: backupState.progress,
      currentFile: backupState.currentFile,
      completedFiles: backupState.completedFiles || 0,
      totalFiles: backupState.files.length,
      bytesTransferred: backupState.bytesTransferred || 0,
      totalBytes: backupState.totalBytes || 0,
      startTime: backupState.startTime,
      isPaused: backupState.isPaused
    });
  }

  async listActiveBackups(client) {
    const activeBackups = Array.from(this.activeBackups.entries()).map(([id, state]) => ({
      id,
      name: state.name,
      status: state.status,
      progress: state.progress,
      files: state.files.length,
      startTime: state.startTime,
      isPaused: state.isPaused
    }));
    
    this.sendIPCResponse(client, {
      backups: activeBackups
    });
  }

  async pauseBackup(backupId, client) {
    const backupState = this.activeBackups.get(backupId);
    
    if (!backupState || !backupState.worker) {
      this.sendIPCResponse(client, {
        error: 'Backup not found or not active'
      });
      return;
    }
    
    backupState.worker.postMessage({ type: 'pause' });
    backupState.isPaused = true;
    backupState.status = 'paused';
    
    this.sendIPCResponse(client, {
      success: true,
      message: 'Backup paused'
    });
  }

  async resumeBackup(backupId, client) {
    const backupState = this.activeBackups.get(backupId);
    
    if (!backupState || !backupState.worker) {
      this.sendIPCResponse(client, {
        error: 'Backup not found or not active'
      });
      return;
    }
    
    backupState.worker.postMessage({ type: 'resume' });
    backupState.isPaused = false;
    backupState.status = 'active';
    
    this.sendIPCResponse(client, {
      success: true,
      message: 'Backup resumed'
    });
  }

  async cancelBackup(backupId, client) {
    const backupState = this.activeBackups.get(backupId);
    
    if (!backupState) {
      this.sendIPCResponse(client, {
        error: 'Backup not found'
      });
      return;
    }
    
    if (backupState.worker) {
      backupState.worker.postMessage({ type: 'cancel' });
      backupState.worker.terminate();
    }
    
    backupState.status = 'cancelled';
    this.activeBackups.delete(backupId);
    
    this.sendIPCResponse(client, {
      success: true,
      message: 'Backup cancelled'
    });
  }

  async getServiceStatus(client) {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    this.sendIPCResponse(client, {
      status: 'running',
      uptime,
      activeBackups: this.activeBackups.size,
      connections: this.connections.size,
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB'
      },
      pid: process.pid
    });
  }

  async restoreInterruptedBackups() {
    try {
      const stateFile = path.join(this.configDir, 'backup-state.json');
      if (await fs.pathExists(stateFile)) {
        const states = await fs.readJSON(stateFile);
        
        for (const state of states) {
          if (state.status === 'active' || state.status === 'paused') {
            this.log(`Restoring interrupted backup: ${state.id}`);
            // Resume backup from saved state
            await this.resumeFromState(state);
          }
        }
      }
    } catch (error) {
      this.log(`Failed to restore interrupted backups: ${error.message}`, 'error');
    }
  }

  async saveBackupState(backupId, state) {
    try {
      const stateFile = path.join(this.configDir, 'backup-state.json');
      let states = [];
      
      if (await fs.pathExists(stateFile)) {
        states = await fs.readJSON(stateFile);
      }
      
      // Update or add state
      const index = states.findIndex(s => s.id === backupId);
      const stateData = {
        id: state.id,
        name: state.name,
        files: state.files,
        peerId: state.peerId,
        status: state.status,
        progress: state.progress,
        completedFiles: state.completedFiles,
        bytesTransferred: state.bytesTransferred,
        totalBytes: state.totalBytes,
        startTime: state.startTime
      };
      
      if (index >= 0) {
        states[index] = stateData;
      } else {
        states.push(stateData);
      }
      
      await fs.writeJSON(stateFile, states, { spaces: 2 });
    } catch (error) {
      this.log(`Failed to save backup state: ${error.message}`, 'error');
    }
  }

  async saveBackupRecord(backupId, state) {
    try {
      await this.storage.recordBackup(backupId, {
        name: state.name,
        files: state.files,
        peerId: state.peerId,
        startTime: state.startTime,
        endTime: state.endTime,
        bytesTransferred: state.bytesTransferred
      });
    } catch (error) {
      this.log(`Failed to save backup record: ${error.message}`, 'error');
    }
  }

  sendIPCResponse(client, data) {
    try {
      client.write(JSON.stringify(data) + '\n');
    } catch (error) {
      this.log(`Failed to send IPC response: ${error.message}`, 'error');
    }
  }

  setupSignalHandlers() {
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
    
    process.on('uncaughtException', (error) => {
      this.log(`Uncaught exception: ${error.message}\n${error.stack}`, 'error');
      this.shutdown();
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      this.log(`Unhandled rejection at: ${promise}, reason: ${reason}`, 'error');
    });
  }

  async shutdown(client = null) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    this.log('Shutting down BackupPeer service...');
    
    // Pause all active backups
    for (const [backupId, state] of this.activeBackups) {
      if (state.worker) {
        state.worker.postMessage({ type: 'pause' });
        await this.saveBackupState(backupId, state);
      }
    }
    
    // Close P2P connections
    for (const [peerId, connection] of this.connections) {
      await connection.close();
    }
    
    // Close IPC server
    if (this.ipcServer) {
      this.ipcServer.close();
    }
    
    // Remove socket and PID file
    await fs.remove(this.socketPath);
    await fs.remove(this.pidFile);
    
    // Close database
    if (this.database) {
      await this.database.close();
    }
    
    if (client) {
      this.sendIPCResponse(client, {
        success: true,
        message: 'Service shutdown complete'
      });
    }
    
    this.log('BackupPeer service shutdown complete');
    process.exit(0);
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    
    // Write to log file
    fs.appendFileSync(this.logFile, logMessage);
    
    // Also output to console if running in foreground
    if (process.stdout.isTTY) {
      console.log(logMessage.trim());
    }
  }
}

// Start service if run directly
if (require.main === module) {
  const service = new BackupPeerService();
  
  service.initialize().catch(error => {
    console.error('Failed to start BackupPeer service:', error.message);
    process.exit(1);
  });
}

module.exports = BackupPeerService;