# BackupPeer Security Model

**Version:** 1.0  
**Last Updated:** 2025-07-26

## Executive Summary

BackupPeer implements a **zero-knowledge, peer-to-peer backup system** designed for maximum privacy and security. The system uses **Ed25519 cryptographic signatures**, **end-to-end encryption**, and **hash-based peer verification** to ensure data sovereignty without relying on trusted third parties.

## Threat Model

### 1. **Threat Actors**

**Untrusted Peers**
- May attempt to access encrypted backup data
- Could provide corrupted or malicious data
- Might attempt denial-of-service attacks

**Network Adversaries**
- ISPs or governments performing traffic analysis
- Man-in-the-middle attacks on peer connections
- Attempts to decrypt WebRTC traffic

**Signaling Server Compromise**
- Server operator could log connection metadata
- Malicious server could perform correlation attacks
- Infrastructure could be seized or compromised

**Malicious Storage Providers**
- Peers might delete data or claim to store what they don't
- Could attempt to extract information from encrypted chunks

### 2. **Assets to Protect**

**User Data**
- Personal files and documents
- Backup metadata and file structures
- Access patterns and backup schedules

**Cryptographic Material**
- Ed25519 private keys
- Peer identity information
- Connection session data

**Network Metadata**
- Peer relationships and trust levels
- Connection timing and frequency
- Storage allocation patterns

## Security Architecture

### 1. **Cryptographic Foundation**

**Core Encryption: libsodium (NaCl)**
```javascript
// Authenticated encryption for all data
const encryptedChunk = crypto.encrypt(fileChunk, peerSharedSecret);
// Uses XChaCha20-Poly1305 authenticated encryption
```

**Identity Management: Ed25519**
```javascript
// Peer identity verification
const peerIdHash = crypto.generatePeerIdHash(publicKey); // SHA-256 of Ed25519 key
const signature = crypto.signPeerIdHash(peerIdHash, privateKey);
const verified = crypto.verifyPeerIdHash(signature, publicKey);
```

**Key Derivation: PBKDF2**
```javascript
// Database encryption with 100,000 iterations
const key = crypto.pbkdf2Sync(systemInfo, salt, 100000, 32, 'sha256');
```

### 2. **Zero-Knowledge Architecture**

**Signaling Server Blindness**
- Server facilitates WebRTC handshake only
- Never receives user data or encryption keys
- Cannot decrypt or access backup content
- Peer discovery through hashed identities

**Client-Side Encryption**
```javascript
// Data encrypted before leaving device
const metadata = crypto.createBackupMetadata(fileList, peerId);
const encryptedChunk = crypto.encrypt(chunkData, sharedSecret);
// Server only sees encrypted blobs
```

**Mutual Dependency Game Theory**
- Both peers must cooperate for data access
- No single point of trust required
- Natural incentive alignment for honest behavior

### 3. **Transport Security**

**WebRTC Data Channels**
- DTLS 1.2 encryption for all peer traffic
- Perfect forward secrecy through ephemeral keys
- NAT traversal without compromising security

**Signaling Authentication**
```javascript
// Cryptographic authentication to signaling server
const authToken = crypto.randomBytes(32).toString('hex');
const signedAuth = crypto.signPeerIdHash(authToken);
// Prevents peer impersonation
```

## Security Mitigations

### 1. **DoS Attack Prevention**

**Rate Limiting**
```javascript
// Multi-layer rate limiting per peer
const rateLimiter = new RateLimiter({
  maxRequests: 100,    // Per minute
  maxBurst: 20,        // Per second
  messageSpecific: {
    'file_chunk': 200,
    'ping': 60,
    'storage_challenge': 10
  }
});
```

**Connection Monitoring**
- Automatic peer banning for violations
- Exponential backoff for failed connections
- Resource usage tracking and limits

### 2. **Data Integrity**

**Multi-Level Verification**
```javascript
// File-level integrity
const fileHash = crypto.hashFile(filePath);

// Chunk-level verification
const chunkHash = crypto.hashData(chunkData);

// Transfer verification
const sessionProof = crypto.generateSessionProof(sessionData);
```

**Merkle Tree Proofs**
- Storage challenge-response protocol
- Proof-of-storage without revealing data
- Periodic integrity verification

### 3. **Peer Authentication**

**Hash-Based Identity**
```javascript
// Compact, verifiable peer identities
const peerIdHash = sha256(ed25519PublicKey).slice(0, 16);
const commitment = crypto.signCommitment(storageData, privateKey);
// Prevents Sybil attacks and impersonation
```

**Trust Levels**
- `tpm-verified`: Hardware-anchored trust (future)
- `software-verified`: Ed25519 signature verification
- `reputation-based`: Behavioral trust scoring
- `unknown`: New or unverified peers

### 4. **Database Security**

**Encrypted Sensitive Fields**
```javascript
// AES-256-GCM encryption for database storage
const sensitiveFields = {
  peers: ['public_key', 'metadata'],
  cached_peer_connections: ['public_key', 'ice_data'],
  storage_commitments: ['signature']
};
```

**Key Derivation**
- Master key derived from system characteristics
- PBKDF2 with 100,000 iterations
- Future: User password or hardware security module

## Security Controls

### 1. **Access Controls**

**File System Permissions**
```bash
# Private key storage
chmod 600 ~/.backup-peer/keys/private.key
chmod 644 ~/.backup-peer/keys/public.key
```

**Database Protection**
- Encrypted sensitive fields
- No plaintext private keys in database
- Secure deletion of temporary files

### 2. **Network Security**

**Connection Validation**
- Peer identity verification before data exchange
- Session integrity proofs
- Automatic disconnection on verification failure

**Traffic Analysis Resistance**
- WebRTC with STUN/TURN traversal
- Optional Tor integration (future)
- Connection timing randomization

### 3. **Operational Security**

**Key Management**
- Local key generation only
- No key escrow or centralized storage
- User responsible for key backup

**Audit Logging**
```javascript
// Security events logged locally
logger.security('peer_verification_failed', { peerId, reason });
logger.security('rate_limit_exceeded', { peerId, messageType });
logger.security('suspicious_behavior', { peerId, behavior });
```

## Known Limitations

### 1. **Current Limitations**

**No Forward Secrecy**
- Long-term Ed25519 keys used for all operations
- Compromise of private key affects all historical data
- Future: Implement Double Ratchet protocol

**Signaling Server Metadata**
- Connection timing and frequency visible
- Peer relationship mapping possible
- Mitigation: Multiple signaling servers, Tor integration

**Side-Channel Attacks**
- Timing attacks on cryptographic operations
- Traffic analysis through connection patterns
- File size and transfer timing leakage

### 2. **Future Security Enhancements**

**Hardware Security Module Support**
```javascript
// TPM integration for hardware-anchored trust
const tpmSignature = tpm.sign(commitment, tpmPrivateKey);
const verified = crypto.verifyTPMSignature(signature, tpmPublicKey);
```

**Tor Hidden Service Integration**
- Complete traffic anonymization
- Censorship resistance
- Protection against ISP surveillance

**Post-Quantum Cryptography**
- CRYSTALS-Kyber for key exchange
- CRYSTALS-Dilithium for signatures
- Preparation for quantum computing threats

## Incident Response

### 1. **Compromise Detection**

**Automated Monitoring**
- Unusual peer behavior detection
- Failed verification attempt tracking
- Anomalous connection pattern alerts

**Manual Investigation**
```bash
# Security audit commands
backup-peer stats --security
backup-peer verify --all-backups
backup-peer reputation --list-suspicious
```

### 2. **Response Procedures**

**Peer Compromise**
1. Immediately blacklist compromised peer
2. Re-verify all data from that peer
3. Generate new identity keys if necessary
4. Notify other trusted peers

**Key Compromise**
1. Stop all network activity
2. Generate new Ed25519 keypair
3. Re-establish trusted peer relationships
4. Securely delete compromised keys

## Compliance & Standards

### 1. **Cryptographic Standards**

**NIST Compliance**
- Ed25519: FIPS 186-4 approved
- ChaCha20-Poly1305: RFC 8439 standard
- PBKDF2: NIST SP 800-132 compliant

**Industry Best Practices**
- OWASP cryptographic guidelines
- Signal Protocol inspiration
- Tor Project security model

### 2. **Privacy Regulations**

**GDPR Compliance**
- User controls all personal data
- No central data collection
- Right to erasure through local deletion

**Data Sovereignty**
- No cross-border data storage without consent
- User selects backup destinations
- Jurisdiction-aware peer selection

## Security Assessment

### 1. **Penetration Testing**

**Automated Testing**
```bash
# Cryptographic verification
npm run security-audit
npm run crypto-test

# Network security testing
npm run connection-security-test
npm run rate-limit-test
```

**Manual Testing Areas**
- Peer identity verification bypass attempts
- Rate limiting circumvention testing
- Database encryption validation
- WebRTC connection security review

### 2. **Code Review Focus**

**Critical Security Components**
- `/lib/crypto.js` - All cryptographic operations
- `/lib/verification.js` - Peer verification logic
- `/lib/rate-limiter.js` - DoS prevention
- `/lib/db-encryption.js` - Database security

**Security Checklist**
- [ ] No hardcoded keys or passwords
- [ ] All user input validated and sanitized
- [ ] Cryptographic operations use constant-time algorithms
- [ ] Error messages don't leak sensitive information
- [ ] All network data encrypted before transmission

## Responsible Disclosure

### 1. **Security Contact**

**Reporting Security Issues**
- Email: security@backuppeer.example.com
- PGP Key: [Future: Include PGP public key]
- Response Time: 48 hours for initial response

**Scope**
- Cryptographic vulnerabilities
- Authentication bypass
- Data leakage issues
- DoS attack vectors

### 2. **Disclosure Timeline**

1. **Day 0**: Vulnerability reported
2. **Day 1-7**: Initial assessment and confirmation
3. **Day 8-30**: Development of fix
4. **Day 31-45**: Testing and validation
5. **Day 46-90**: Coordinated public disclosure

## Security Roadmap

### 1. **Short-term (Next Release)**
- [ ] Complete Tor hidden service integration
- [ ] Hardware security module support
- [ ] Advanced rate limiting with machine learning
- [ ] Comprehensive security audit

### 2. **Long-term (Future Versions)**
- [ ] Post-quantum cryptography migration
- [ ] Zero-knowledge peer discovery
- [ ] Formal security verification
- [ ] Bug bounty program

---

## Conclusion

BackupPeer implements **defense-in-depth security** with multiple layers of cryptographic protection, network security, and operational safeguards. The system is designed to be **secure by default** while maintaining usability for non-technical users.

**Key Security Principles:**
1. **Zero-knowledge**: No trusted third parties
2. **End-to-end encryption**: Data encrypted at source
3. **Cryptographic verification**: All peers and data verified
4. **Resilient architecture**: Multiple failure mitigation layers

The security model prioritizes **user sovereignty** and **privacy protection** while providing enterprise-grade cryptographic security suitable for sensitive data protection.

For security questions or concerns, please contact the security team through the channels outlined in the Responsible Disclosure section.

---

*BackupPeer Security Team*  
*Last Updated: 2025-07-26*