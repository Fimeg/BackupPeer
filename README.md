# BackupPeer

BackupPeer is a privacy-focused peer-to-peer encrypted backup system where you exchange backup storage directly with other users. Unlike rsync or Borg Backup which require central servers or cloud storage, BackupPeer creates mutual backup relationships - you store their files, they store yours, with zero-knowledge architecture ensuring only you can decrypt your data.

> **⚠️ EXPERIMENTAL VERSION**: This is an experimental build with recent improvements to file transfer reliability and connection management. Features may change and stability is not yet guaranteed for production use. Please note; during development the community singalling server will be reset many times... setting your own is essential for now. 

## Features

### Core Security
- **Zero-knowledge architecture** - signaling server never sees your data or keys
- **End-to-end encryption** with Ed25519 signatures and XChaCha20-Poly1305
- **Hash-based peer verification** with optional TPM integration support
- **Client-to-client trust model** with no central authority

### File Management
- Smart file selection with `.backupignore` support
- Priority patterns for critical files (keys, wallets, certificates)
- Resumable transfers with chunk-level state persistence
- File integrity verification with SHA-256 checksums

### Connection Resilience
- **WebRTC direct peer connections** with STUN/TURN traversal
- Connection caching and automatic reconnection
- Rate limiting and DoS protection
- Scheduled synchronization with peer coordination

### Trust and Verification
- Cryptographic storage commitments with zero-knowledge proofs
- Automated challenge-response verification
- Reputation scoring based on peer behavior
- Multiple trust levels from software-verified to TPM-anchored

## Quick Start

### Setup
```bash
cd client
chmod +x setup.sh
./setup.sh
```

### Basic Usage
```bash
# Initialize your peer identity
./bin/backup-peer init

# Start the interactive TUI
./bin/backup-peer ui

# Backup a folder
./bin/backup-peer backup ~/Documents --name "my-documents"

# Include only specific files
./bin/backup-peer backup ~/Projects --files "*.js,*.md" --exclude "node_modules/**"

# Check status
./bin/backup-peer status
```

### File Selection
Create `.backupignore` files to control what gets backed up:
```bash
# In your backup directory
echo "*.tmp" >> .backupignore
echo "node_modules/" >> .backupignore
```

## How It Works

### Security Model
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Peer A    │    │  Signaling  │    │   Peer B    │
│ (Your Data) │◄──►│   Server    │◄──►│(Their Data) │
└─────────────┘    └─────────────┘    └─────────────┘
        │                                     │
        └──── Direct Encrypted Connection ────┘
              (Your data never touches server)
```

**Zero-Knowledge Design**
- Signaling server only facilitates WebRTC handshake
- All data encrypted client-side before transmission
- Peer discovery through hashed identities
- No central storage or key escrow

**Cryptographic Foundation**
- Ed25519 signatures for peer identity verification
- XChaCha20-Poly1305 authenticated encryption for data
- SHA-256 hashing for peer IDs and file integrity
- PBKDF2 key derivation for database encryption

### Connection Management
- Exponential backoff reconnection with cached peer data
- Peer connection success rate tracking
- Automatic peer quality assessment
- Cross-server portability via Kademlia DHT

## Commands

### Core Operations
```bash
backup-peer init                    # Generate keys and setup database
backup-peer backup <directory>      # Backup folder with smart file selection
backup-peer restore                 # Receive files from peer
backup-peer ui                      # Launch interactive Terminal UI
backup-peer status                 # Show system status and peer connections
```

### File Selection Options
```bash
--files <patterns>           # Include file patterns (comma-separated)
--exclude <patterns>         # Exclude file patterns (comma-separated)
--priority <patterns>        # High-priority file patterns
--max-file-size <mb>         # Maximum file size in MB
```

### Verification and Trust
```bash
backup-peer verify <backup-id>      # Check backup integrity
backup-peer challenge <peer>        # Send storage challenge
backup-peer reputation --list       # Show peer reputation scores
```

## Privacy Considerations

### Trust Model
**Mutual Dependency**: Both peers lose access if either goes offline permanently. This creates natural incentives for honest behavior and long-term commitment.

**No Central Authority**: No blockchain, central verification, or third-party trust required. Trust is established directly between peers through cryptographic verification.

**Local Reputation**: Track peer reliability locally based on successful connections, storage challenges, and data integrity.

### Privacy Levels
1. **Basic**: Encrypted storage with direct IP connections
2. **Enhanced**: Encrypted storage with VPN/proxy connections  
3. **Maximum**: All traffic via Tor (future concept)

### Key Management
- Keys generated locally using secure random generation
- Private keys never leave the device
- Stored in `~/.backup-peer/keys/` with restrictive permissions
- User responsible for key backup and recovery

## Security

### Threat Model
Protected against:
- Untrusted peers attempting data access
- Network adversaries performing traffic analysis
- Signaling server compromise or surveillance
- Malicious storage providers

### Trust Levels
- **tpm-verified**: Hardware-anchored trust (future)
- **software-verified**: Ed25519 signature verification
- **reputation-based**: Behavioral trust scoring
- **unknown**: New or unverified peers

### Security Documentation
See `SECURITY.md` for comprehensive security model, threat analysis, and security controls documentation.

## Future Concepts

### Advanced Privacy
- Tor hidden service integration for complete anonymity
- Onion routing for multi-hop backup distribution
- Anonymous peer discovery through DHT networks

### Hardware Integration
- TPM-based hardware security module support
- Hardware wallet integration for key management
- Secure enclave support for iOS/Android

### Enhanced Features
- GUI desktop applications for non-technical users
- Mobile clients with background synchronization
- Team/organization features with shared trust networks
- Post-quantum cryptography migration path

## Production Deployment

### Signaling Server
```bash
cd broker
npm install
node index.js
```

### Client Distribution
```bash
npm pack
npm install -g backup-peer-client-0.1.0.tgz
```

## Contributing

This project focuses on core peer-to-peer backup functionality with strong cryptographic foundations.

<a href="https://www.buymeacoffee.com/caseytunturi" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-violet.png" alt="Buy Me A Coffee" height="60px" width="200px"></a>

**Priority areas for contribution:**
- Security audits and cryptographic review
- Connection resilience and network reliability
- Performance optimization for large file transfers
- Documentation and user guides
- Mobile and desktop GUI clients

**Development principles:**
- Security by design - no shortcuts on cryptography
- User sovereignty - users control their data and keys
- Decentralization - minimize dependencies on central services
- Privacy protection - metadata minimization and traffic analysis resistance

**Code standards:**
- Comprehensive security documentation for all changes
- Test coverage for cryptographic operations
- Clear separation between networking and crypto layers
- Memory safety considerations for key material

## License

MIT License - Build freely, enhance privacy, strengthen digital sovereignty.

---

BackupPeer - Encrypted by design, governed by community, built for freedom
