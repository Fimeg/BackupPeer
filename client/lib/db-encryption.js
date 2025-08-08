const crypto = require('crypto');
const os = require('os');

/**
 * Database encryption utilities for sensitive data storage
 * Encrypts sensitive fields before storing in SQLite
 */
class DatabaseEncryption {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.tagLength = 16; // 128 bits
    this.iterations = 100000; // PBKDF2 iterations
    
    // Derive master key from system info + user data (not perfect, but better than plaintext)
    this.masterKey = this.deriveMasterKey();
  }
  
  /**
   * Derive master encryption key from system characteristics
   * In production, this should use user-provided password or hardware security
   */
  deriveMasterKey() {
    const systemInfo = [
      os.hostname(),
      os.platform(),
      os.arch(),
      process.env.USER || process.env.USERNAME || 'backup-peer'
    ].join('|');
    
    const salt = crypto.createHash('sha256').update('backup-peer-salt').digest();
    
    return crypto.pbkdf2Sync(systemInfo, salt, this.iterations, this.keyLength, 'sha256');
  }
  
  /**
   * Encrypt sensitive data for database storage
   * @param {string|object} data - Data to encrypt
   * @returns {object} - Encrypted data package
   */
  encrypt(data) {
    try {
      const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
      const iv = crypto.randomBytes(this.ivLength);
      
      const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      return {
        encrypted: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        algorithm: this.algorithm
      };
      
    } catch (error) {
      throw new Error(`Database encryption failed: ${error.message}`);
    }
  }
  
  /**
   * Decrypt data from database storage
   * @param {object} encryptedData - Encrypted data package
   * @returns {string} - Decrypted plaintext
   */
  decrypt(encryptedData) {
    try {
      if (!encryptedData || !encryptedData.encrypted) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const tag = Buffer.from(encryptedData.tag, 'hex');
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
      
    } catch (error) {
      throw new Error(`Database decryption failed: ${error.message}`);
    }
  }
  
  /**
   * Encrypt sensitive fields in a database record
   * @param {object} record - Database record
   * @param {array} sensitiveFields - Fields to encrypt
   * @returns {object} - Record with encrypted fields
   */
  encryptRecord(record, sensitiveFields = []) {
    const encryptedRecord = { ...record };
    
    for (const field of sensitiveFields) {
      if (record[field] !== null && record[field] !== undefined) {
        encryptedRecord[field] = JSON.stringify(this.encrypt(record[field]));
      }
    }
    
    return encryptedRecord;
  }
  
  /**
   * Decrypt sensitive fields in a database record
   * @param {object} record - Database record with encrypted fields
   * @param {array} sensitiveFields - Fields to decrypt
   * @returns {object} - Record with decrypted fields
   */
  decryptRecord(record, sensitiveFields = []) {
    const decryptedRecord = { ...record };
    
    for (const field of sensitiveFields) {
      if (record[field]) {
        try {
          const encryptedData = JSON.parse(record[field]);
          decryptedRecord[field] = this.decrypt(encryptedData);
        } catch (error) {
          console.warn(`Failed to decrypt field ${field}:`, error.message);
          // Leave field encrypted if decryption fails
        }
      }
    }
    
    return decryptedRecord;
  }
  
  /**
   * Create encrypted backup of sensitive data
   * @param {object} data - Sensitive data to backup
   * @param {string} password - User password for encryption
   * @returns {object} - Encrypted backup package
   */
  createSecureBackup(data, password) {
    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, 'sha256');
    const iv = crypto.randomBytes(this.ivLength);
    
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    
    const plaintext = JSON.stringify(data);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    return {
      version: '1.0',
      encrypted: encrypted,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      iterations: this.iterations,
      algorithm: this.algorithm,
      created: Date.now()
    };
  }
  
  /**
   * Restore data from encrypted backup
   * @param {object} backup - Encrypted backup package
   * @param {string} password - User password for decryption
   * @returns {object} - Restored data
   */
  restoreSecureBackup(backup, password) {
    const salt = Buffer.from(backup.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, backup.iterations, this.keyLength, 'sha256');
    const iv = Buffer.from(backup.iv, 'hex');
    const tag = Buffer.from(backup.tag, 'hex');
    
    const decipher = crypto.createDecipheriv(backup.algorithm, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(backup.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }
  
  /**
   * Generate secure hash for sensitive data indexing
   * @param {string} data - Data to hash
   * @param {string} salt - Optional salt
   * @returns {string} - Secure hash
   */
  secureHash(data, salt = '') {
    const hash = crypto.createHash('sha256');
    hash.update(data + salt);
    return hash.digest('hex');
  }
  
  /**
   * Test encryption/decryption functionality
   * @returns {boolean} - Whether encryption is working
   */
  test() {
    try {
      const testData = { test: 'sensitive data', number: 12345 };
      const encrypted = this.encrypt(testData);
      const decrypted = JSON.parse(this.decrypt(encrypted));
      
      return JSON.stringify(testData) === JSON.stringify(decrypted);
    } catch (error) {
      console.error('Database encryption test failed:', error.message);
      return false;
    }
  }
}

module.exports = DatabaseEncryption;