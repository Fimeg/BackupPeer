const sodium = require('sodium-native');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

class BackupCrypto {
  constructor() {
    this.keyPair = null; // crypto_box keypair for encryption
    this.signingKeyPair = null; // crypto_sign keypair for signatures
    this.sharedSecrets = new Map(); // peer_id -> shared_secret
  }
  
  // Generate or load both encryption and signing keypairs
  async initializeKeys(configDir = '~/.backup-peer') {
    const expandedDir = configDir.replace('~', require('os').homedir());
    const keyPath = path.join(expandedDir, 'keys');
    
    await fs.ensureDir(keyPath);
    
    const publicKeyFile = path.join(keyPath, 'public.key');
    const privateKeyFile = path.join(keyPath, 'private.key');
    const signingPublicKeyFile = path.join(keyPath, 'signing_public.key');
    const signingPrivateKeyFile = path.join(keyPath, 'signing_private.key');
    
    try {
      // Try to load existing keys
      if (await fs.pathExists(publicKeyFile) && await fs.pathExists(privateKeyFile) &&
          await fs.pathExists(signingPublicKeyFile) && await fs.pathExists(signingPrivateKeyFile)) {
        const publicKey = await fs.readFile(publicKeyFile);
        const privateKey = await fs.readFile(privateKeyFile);
        const signingPublicKey = await fs.readFile(signingPublicKeyFile);
        const signingPrivateKey = await fs.readFile(signingPrivateKeyFile);
        
        this.keyPair = {
          publicKey: Buffer.from(publicKey),
          privateKey: Buffer.from(privateKey)
        };
        
        this.signingKeyPair = {
          publicKey: Buffer.from(signingPublicKey),
          privateKey: Buffer.from(signingPrivateKey)
        };
        
        console.log('Loaded existing keypairs');
        return { encryption: this.keyPair, signing: this.signingKeyPair };
      }
    } catch (error) {
      console.log('Could not load existing keys, generating new ones...');
    }
    
    // Generate new encryption keypair (X25519)
    const publicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
    const privateKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
    sodium.crypto_box_keypair(publicKey, privateKey);
    this.keyPair = { publicKey, privateKey };
    
    // Generate new signing keypair (Ed25519)
    const signingPublicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const signingPrivateKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.crypto_sign_keypair(signingPublicKey, signingPrivateKey);
    this.signingKeyPair = { publicKey: signingPublicKey, privateKey: signingPrivateKey };
    
    // Save encryption keys to disk
    await fs.writeFile(publicKeyFile, publicKey);
    await fs.writeFile(privateKeyFile, privateKey);
    
    // Save signing keys to disk
    await fs.writeFile(signingPublicKeyFile, signingPublicKey);
    await fs.writeFile(signingPrivateKeyFile, signingPrivateKey);
    
    // Set restrictive permissions
    await fs.chmod(privateKeyFile, 0o600);
    await fs.chmod(publicKeyFile, 0o644);
    await fs.chmod(signingPrivateKeyFile, 0o600);
    await fs.chmod(signingPublicKeyFile, 0o644);
    
    console.log('Generated new keypairs');
    return { encryption: this.keyPair, signing: this.signingKeyPair };
  }
  
  // Generate shared secret with peer's public key
  generateSharedSecret(peerPublicKey, peerId) {
    if (!this.keyPair) {
      throw new Error('Keys not initialized');
    }
    
    const sharedSecret = Buffer.alloc(sodium.crypto_box_BEFORENMBYTES);
    sodium.crypto_box_beforenm(sharedSecret, peerPublicKey, this.keyPair.privateKey);
    
    this.sharedSecrets.set(peerId, sharedSecret);
    return sharedSecret;
  }

  // Generate SHA-256 hash of Ed25519 signing public key for compact peer ID
  generatePeerIdHash(publicKey = null) {
    const pubKey = publicKey || this.signingKeyPair.publicKey;
    const hash = Buffer.alloc(sodium.crypto_hash_sha256_BYTES);
    sodium.crypto_hash_sha256(hash, pubKey);
    return hash.toString('hex').slice(0, 16); // First 16 chars for compactness
  }

  // Sign peer ID hash with Ed25519 signing private key for verification
  signPeerIdHash(peerIdHash, privateKey = null) {
    const privKey = privateKey || this.signingKeyPair.privateKey;
    const message = Buffer.from(peerIdHash, 'hex');
    const signature = Buffer.alloc(sodium.crypto_sign_BYTES);
    
    sodium.crypto_sign_detached(signature, message, privKey);
    
    return {
      peerIdHash,
      signature: signature.toString('hex'),
      publicKey: this.signingKeyPair.publicKey.toString('hex'),
      timestamp: Date.now(),
      version: '1.0'
    };
  }

  // Verify signed peer ID hash from another peer
  verifyPeerIdHash(signedHash) {
    try {
      const { peerIdHash, signature, publicKey, timestamp, version } = signedHash;
      
      // Check version compatibility
      if (version !== '1.0') {
        return { valid: false, reason: 'Unsupported signature version' };
      }
      
      // Check timestamp (reject if older than 1 hour)
      if (Date.now() - timestamp > 3600000) {
        return { valid: false, reason: 'Signature expired' };
      }
      
      const message = Buffer.from(peerIdHash, 'hex');
      const sig = Buffer.from(signature, 'hex');
      const pubKey = Buffer.from(publicKey, 'hex');
      
      // Verify the signature
      const isValid = sodium.crypto_sign_verify_detached(sig, message, pubKey);
      
      // Verify the hash matches the public key
      const expectedHashBuffer = Buffer.alloc(sodium.crypto_hash_sha256_BYTES);
      sodium.crypto_hash_sha256(expectedHashBuffer, pubKey);
      const expectedHash = expectedHashBuffer.toString('hex').slice(0, 16);
      const hashMatches = expectedHash === peerIdHash;
      
      return {
        valid: isValid && hashMatches,
        reason: isValid && hashMatches ? 'Valid peer ID hash' : 'Invalid signature or hash mismatch',
        peerIdHash,
        publicKey,
        trustLevel: 'software-verified' // Will be 'tpm-verified' with TPM support
      };
    } catch (error) {
      return { valid: false, reason: `Verification failed: ${error.message}` };
    }
  }

  // Generate zero-knowledge proof for session integrity
  generateSessionProof(sessionData) {
    const { iceCandidate, timestamp, nonce } = sessionData;
    const proofData = JSON.stringify({ 
      iceCandidate: iceCandidate || 'no-ice', 
      timestamp, 
      nonce 
    });
    
    const proofHash = Buffer.alloc(sodium.crypto_hash_sha256_BYTES);
    sodium.crypto_hash_sha256(proofHash, Buffer.from(proofData));
    
    const signature = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(signature, proofHash, this.signingKeyPair.privateKey);
    
    return {
      proof: proofHash.toString('hex'),
      signature: signature.toString('hex'),
      nonce,
      timestamp,
      sessionData: proofData
    };
  }

  // Verify zero-knowledge session proof
  verifySessionProof(sessionProof, peerPublicKey, expectedSessionData) {
    try {
      const { proof, signature, nonce, timestamp } = sessionProof;
      const { iceCandidate } = expectedSessionData;
      
      // Check timestamp freshness (within 5 minutes)
      if (Math.abs(Date.now() - timestamp) > 300000) {
        return { valid: false, reason: 'Session proof timestamp too old' };
      }
      
      // Reconstruct expected proof
      const expectedProofData = JSON.stringify({ 
        iceCandidate: iceCandidate || 'no-ice', 
        timestamp, 
        nonce 
      });
      const expectedProofHash = Buffer.alloc(sodium.crypto_hash_sha256_BYTES);
      sodium.crypto_hash_sha256(expectedProofHash, Buffer.from(expectedProofData));
      
      // Verify proof matches
      if (expectedProofHash.toString('hex') !== proof) {
        return { valid: false, reason: 'Session proof hash mismatch' };
      }
      
      // Verify signature
      const sig = Buffer.from(signature, 'hex');
      const proofBuffer = Buffer.from(proof, 'hex');
      const isValid = sodium.crypto_sign_verify_detached(sig, proofBuffer, peerPublicKey);
      
      return {
        valid: isValid,
        reason: isValid ? 'Valid session proof' : 'Invalid session signature',
        timestamp,
        nonce
      };
    } catch (error) {
      return { valid: false, reason: `Session proof verification failed: ${error.message}` };
    }
  }

  // Get my peer ID hash for sharing
  getMyPeerIdHash() {
    if (!this.signingKeyPair) {
      throw new Error('Signing keys not initialized');
    }
    return this.generatePeerIdHash();
  }

  // Get current encryption key pair (for internal use)
  getKeyPair() {
    if (!this.keyPair) {
      throw new Error('Encryption keys not initialized');
    }
    return this.keyPair;
  }

  // Get current signing key pair (for internal use)
  getSigningKeyPair() {
    if (!this.signingKeyPair) {
      throw new Error('Signing keys not initialized');
    }
    return this.signingKeyPair;
  }

  // Create signed peer identity for network sharing
  createPeerIdentity() {
    if (!this.signingKeyPair) {
      throw new Error('Signing keys not initialized');
    }
    
    const peerIdHash = this.generatePeerIdHash();
    const signedHash = this.signPeerIdHash(peerIdHash);
    
    return {
      ...signedHash,
      capabilities: ['backup', 'restore', 'verify'],
      protocol: 'backuppeer-v1',
      created: Date.now()
    };
  }
  
  // Encrypt data for a specific peer
  encrypt(data, peerId) {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      throw new Error(`No shared secret for peer: ${peerId}`);
    }
    
    const nonce = Buffer.alloc(sodium.crypto_box_NONCEBYTES);
    sodium.randombytes_buf(nonce);
    
    const ciphertext = Buffer.alloc(data.length + sodium.crypto_box_MACBYTES);
    sodium.crypto_box_easy_afternm(ciphertext, data, nonce, sharedSecret);
    
    // Return nonce + ciphertext
    return Buffer.concat([nonce, ciphertext]);
  }
  
  // Decrypt data from a specific peer
  decrypt(encryptedData, peerId) {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      throw new Error(`No shared secret for peer: ${peerId}`);
    }
    
    if (encryptedData.length < sodium.crypto_box_NONCEBYTES + sodium.crypto_box_MACBYTES) {
      throw new Error('Invalid encrypted data length');
    }
    
    const nonce = encryptedData.slice(0, sodium.crypto_box_NONCEBYTES);
    const ciphertext = encryptedData.slice(sodium.crypto_box_NONCEBYTES);
    
    const plaintext = Buffer.alloc(ciphertext.length - sodium.crypto_box_MACBYTES);
    
    if (!sodium.crypto_box_open_easy_afternm(plaintext, ciphertext, nonce, sharedSecret)) {
      throw new Error('Decryption failed - invalid ciphertext or key');
    }
    
    return plaintext;
  }
  
  // Generate file hash for integrity verification
  static hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
  
  // Generate hash for arbitrary data
  static hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  // Verify data integrity
  static verifyHash(data, expectedHash) {
    const actualHash = this.hashData(data);
    return actualHash === expectedHash;
  }
  
  // Get encryption public key as hex string for sharing
  getPublicKeyHex() {
    if (!this.keyPair) {
      throw new Error('Encryption keys not initialized');
    }
    return this.keyPair.publicKey.toString('hex');
  }

  // Get signing public key as hex string for sharing
  getSigningPublicKeyHex() {
    if (!this.signingKeyPair) {
      throw new Error('Signing keys not initialized');
    }
    return this.signingKeyPair.publicKey.toString('hex');
  }
  
  // Import peer's public key from hex
  static publicKeyFromHex(hexKey) {
    return Buffer.from(hexKey, 'hex');
  }
  
  // Create encrypted backup metadata
  createBackupMetadata(fileList, peerId) {
    const metadata = {
      timestamp: Date.now(),
      files: fileList.map(file => ({
        path: file.path,
        size: file.size,
        hash: file.hash,
        chunks: file.chunks || 1
      })),
      version: '0.1.0'
    };
    
    const metadataJson = JSON.stringify(metadata);
    const metadataBuffer = Buffer.from(metadataJson, 'utf8');
    
    return {
      metadata,
      encrypted: this.encrypt(metadataBuffer, peerId)
    };
  }
  
  // Decrypt and parse backup metadata
  parseBackupMetadata(encryptedMetadata, peerId) {
    const decryptedBuffer = this.decrypt(encryptedMetadata, peerId);
    const metadataJson = decryptedBuffer.toString('utf8');
    return JSON.parse(metadataJson);
  }
}

module.exports = BackupCrypto;