const net = require('net');
const path = require('path');
const fs = require('fs-extra');

class ServiceClient {
  constructor() {
    this.configDir = path.join(require('os').homedir(), '.backup-peer');
    this.socketPath = path.join(this.configDir, 'backuppeer.sock');
    this.client = null;
    this.connected = false;
    this.responseHandlers = new Map();
    this.messageId = 0;
  }

  async isServiceRunning() {
    const pidFile = path.join(this.configDir, 'backuppeer.pid');
    
    try {
      if (await fs.pathExists(pidFile)) {
        const pid = parseInt(await fs.readFile(pidFile, 'utf8'));
        // Check if process is running
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          return false;
        }
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client = net.connect(this.socketPath, () => {
        this.connected = true;
        resolve();
      });

      let buffer = '';
      this.client.on('data', (data) => {
        buffer += data.toString();
        
        // Process complete messages
        const messages = buffer.split('\n');
        buffer = messages.pop();
        
        for (const message of messages) {
          if (message.trim()) {
            try {
              const response = JSON.parse(message);
              if (response.id && this.responseHandlers.has(response.id)) {
                const handler = this.responseHandlers.get(response.id);
                this.responseHandlers.delete(response.id);
                handler.resolve(response);
              }
            } catch (error) {
              console.error('Failed to parse response:', error);
            }
          }
        }
      });

      this.client.on('error', (error) => {
        if (!this.connected) {
          reject(error);
        }
      });

      this.client.on('close', () => {
        this.connected = false;
      });
    });
  }

  sendCommand(type, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to service'));
        return;
      }

      const id = ++this.messageId;
      const command = { id, type, data };
      
      this.responseHandlers.set(id, { resolve, reject });
      
      // Set timeout
      setTimeout(() => {
        if (this.responseHandlers.has(id)) {
          this.responseHandlers.delete(id);
          reject(new Error('Command timeout'));
        }
      }, 30000);
      
      this.client.write(JSON.stringify(command) + '\n');
    });
  }

  close() {
    if (this.client) {
      this.client.destroy();
    }
  }
}

module.exports = ServiceClient;