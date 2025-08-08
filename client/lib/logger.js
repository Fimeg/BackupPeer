const fs = require('fs-extra');
const path = require('path');
const util = require('util');

class Logger {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(require('os').homedir(), '.backup-peer');
    this.logDir = path.join(this.configDir, 'logs');
    this.logFile = options.logFile || 'backuppeer.log';
    this.debugFile = options.debugFile || 'debug.log';
    this.errorFile = options.errorFile || 'error.log';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    
    // Log levels
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      FATAL: 4
    };
    
    this.currentLevel = this.levels[options.level] || this.levels.INFO;
    
    // Ensure log directory exists
    this.initializeAsync();
  }
  
  async initializeAsync() {
    try {
      await fs.ensureDir(this.logDir);
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }
  
  // Synchronous initialization for immediate logging
  initializeSync() {
    try {
      fs.ensureDirSync(this.logDir);
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }
  
  // Main logging method
  log(level, message, ...args) {
    const levelName = Object.keys(this.levels).find(key => this.levels[key] === level) || 'INFO';
    const timestamp = new Date().toISOString();
    
    // Format message with additional arguments
    let formattedMessage = message;
    if (args.length > 0) {
      formattedMessage = util.format(message, ...args);
    }
    
    // Add stack trace for errors
    if (args[0] instanceof Error) {
      formattedMessage += '\n' + args[0].stack;
    }
    
    const logEntry = `[${timestamp}] [${levelName}] ${formattedMessage}`;
    
    // Console output
    if (this.enableConsole && level >= this.currentLevel) {
      const colors = {
        DEBUG: '\x1b[36m', // Cyan
        INFO: '\x1b[32m',  // Green
        WARN: '\x1b[33m',  // Yellow
        ERROR: '\x1b[31m', // Red
        FATAL: '\x1b[35m'  // Magenta
      };
      const color = colors[levelName] || '\x1b[0m';
      console.log(`${color}${logEntry}\x1b[0m`);
    }
    
    // File output
    if (this.enableFile) {
      this.writeToFile(logEntry, level);
    }
  }
  
  // Write log entry to appropriate file(s)
  writeToFile(logEntry, level) {
    try {
      // Always write to main log file
      const mainLogPath = path.join(this.logDir, this.logFile);
      this.appendToFile(mainLogPath, logEntry + '\n');
      
      // Write to debug file if DEBUG level
      if (level === this.levels.DEBUG) {
        const debugLogPath = path.join(this.logDir, this.debugFile);
        this.appendToFile(debugLogPath, logEntry + '\n');
      }
      
      // Write to error file if ERROR or FATAL
      if (level >= this.levels.ERROR) {
        const errorLogPath = path.join(this.logDir, this.errorFile);
        this.appendToFile(errorLogPath, logEntry + '\n');
      }
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
  
  // Append to file with rotation check
  appendToFile(filePath, content) {
    try {
      // Check if file needs rotation
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > this.maxFileSize) {
          this.rotateLog(filePath);
        }
      }
      
      // Append to file
      fs.appendFileSync(filePath, content);
    } catch (error) {
      console.error(`Failed to append to ${filePath}:`, error);
    }
  }
  
  // Rotate log file when it gets too large
  rotateLog(filePath) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = filePath.replace(/\.log$/, `-${timestamp}.log`);
      fs.renameSync(filePath, rotatedPath);
      
      // Keep only last 5 rotated files
      this.cleanupRotatedLogs(filePath);
    } catch (error) {
      console.error('Failed to rotate log:', error);
    }
  }
  
  // Clean up old rotated log files
  cleanupRotatedLogs(basePath) {
    try {
      const dir = path.dirname(basePath);
      const basename = path.basename(basePath, '.log');
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(basename) && f.includes('-') && f.endsWith('.log'))
        .sort()
        .reverse();
      
      // Keep only the 5 most recent
      for (let i = 5; i < files.length; i++) {
        fs.unlinkSync(path.join(dir, files[i]));
      }
    } catch (error) {
      console.error('Failed to cleanup rotated logs:', error);
    }
  }
  
  // Convenience methods
  debug(message, ...args) {
    this.log(this.levels.DEBUG, message, ...args);
  }
  
  info(message, ...args) {
    this.log(this.levels.INFO, message, ...args);
  }
  
  warn(message, ...args) {
    this.log(this.levels.WARN, message, ...args);
  }
  
  error(message, ...args) {
    this.log(this.levels.ERROR, message, ...args);
  }
  
  fatal(message, ...args) {
    this.log(this.levels.FATAL, message, ...args);
  }
  
  // Log system information
  logSystemInfo() {
    const os = require('os');
    this.info('=== System Information ===');
    this.info('Platform: %s', os.platform());
    this.info('Architecture: %s', os.arch());
    this.info('Node Version: %s', process.version);
    this.info('Hostname: %s', os.hostname());
    this.info('Total Memory: %s GB', (os.totalmem() / 1024 / 1024 / 1024).toFixed(2));
    this.info('Free Memory: %s GB', (os.freemem() / 1024 / 1024 / 1024).toFixed(2));
    this.info('CPU Count: %s', os.cpus().length);
    this.info('Home Directory: %s', os.homedir());
    this.info('=========================');
  }
  
  // Log P2P connection events
  logP2PEvent(event, data) {
    const sanitizedData = this.sanitizeData(data);
    this.debug('P2P Event: %s - %j', event, sanitizedData);
  }
  
  // Log signaling events
  logSignalingEvent(event, data) {
    const sanitizedData = this.sanitizeData(data);
    this.debug('Signaling Event: %s - %j', event, sanitizedData);
  }
  
  // Sanitize sensitive data before logging
  sanitizeData(data) {
    if (!data) return data;
    
    const sanitized = { ...data };
    
    // Hide sensitive fields
    const sensitiveFields = ['privateKey', 'secretKey', 'password', 'token', 'sessionId'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    // Truncate long fields
    const maxLength = 200;
    for (const key in sanitized) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > maxLength) {
        sanitized[key] = sanitized[key].substring(0, maxLength) + '... [TRUNCATED]';
      }
    }
    
    return sanitized;
  }
  
  // Get recent log entries
  async getRecentLogs(count = 100, level = null) {
    try {
      const logPath = path.join(this.logDir, this.logFile);
      if (!await fs.pathExists(logPath)) {
        return [];
      }
      
      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      let filtered = lines;
      if (level) {
        const levelName = Object.keys(this.levels).find(key => this.levels[key] === level);
        filtered = lines.filter(line => line.includes(`[${levelName}]`));
      }
      
      return filtered.slice(-count);
    } catch (error) {
      this.error('Failed to read recent logs:', error);
      return [];
    }
  }
  
  // Clear log files
  async clearLogs() {
    try {
      const files = [this.logFile, this.debugFile, this.errorFile];
      for (const file of files) {
        const filePath = path.join(this.logDir, file);
        if (await fs.pathExists(filePath)) {
          await fs.truncate(filePath, 0);
        }
      }
      this.info('Log files cleared');
    } catch (error) {
      this.error('Failed to clear logs:', error);
    }
  }
  
  // Get log file paths
  getLogPaths() {
    return {
      main: path.join(this.logDir, this.logFile),
      debug: path.join(this.logDir, this.debugFile),
      error: path.join(this.logDir, this.errorFile),
      directory: this.logDir
    };
  }
}

// Create singleton instance
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'DEBUG',
  enableConsole: process.env.DISABLE_CONSOLE_LOG !== 'true',
  enableFile: process.env.DISABLE_FILE_LOG !== 'true'
});

// Export both the class and the singleton instance
module.exports = logger;
module.exports.Logger = Logger;

