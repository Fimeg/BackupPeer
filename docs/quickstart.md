# BackupPeer MVP - Quick Start Guide

*Version: 0.1.0*

## Installation

```bash
# Install globally via npm (when published)
npm install -g backup-peer

# Or clone and run locally
git clone https://github.com/backuppeer/backup-peer
cd backup-peer
npm install
```

## First Backup Exchange (< 5 minutes)

### 1. Initialize Your Peer
```bash
backup-peer init
# Generates encryption keys
# Sets default 10GB storage allocation
# Creates ~/.backup-peer/config
```

### 2. Find a Backup Partner
```bash
# Start listening for peers
backup-peer listen --storage 10GB

# In another terminal (or on friend's computer):
backup-peer connect --storage 10GB
```

### 3. Start Your First Backup
```bash
# Backup a folder
backup-peer backup ./important-files

# Or restore from peer
backup-peer restore backup-20250725 ./restored-files
```

## Architecture Overview

```
You ←→ Signaling Server ←→ Friend
 │                           │
 └─── Direct P2P Connection ─┘
     (Your data never touches server)
```

## Configuration

### Basic Setup
```bash
# Check status
backup-peer status

# View settings
backup-peer config list

# Change storage allocation
backup-peer config set storage 50GB
```

### Privacy Modes
```bash
# Basic mode (default)
backup-peer config set privacy basic

# Enhanced privacy (via proxy)  
backup-peer config set privacy enhanced

# Maximum privacy (via Tor - coming soon)
backup-peer config set privacy maximum
```

## How It Works

1. **Discovery**: Find peers with compatible storage needs
2. **Handshake**: Establish encrypted WebRTC connection
3. **Exchange**: Trade encrypted backup data directly
4. **Verification**: Periodic challenges ensure data integrity

## Security Features

- ✅ **Client-side encryption** - Your data is encrypted before leaving your device
- ✅ **Zero-knowledge broker** - Signaling server never sees your data or keys  
- ✅ **Direct P2P transfer** - Data flows directly between peers
- ✅ **Mutual dependency** - Both peers must stay online for access

## FAQ

**Q: What happens if my backup partner goes offline?**
A: You'll lose access to that specific backup. We recommend multiple backup partners for redundancy.

**Q: Can the signaling server see my files?**
A: No. The server only helps peers find each other. All data is encrypted and transferred directly between peers.

**Q: How do I know my data is safe?**
A: Your peer sends periodic "proof of storage" responses to verify they still have your encrypted data.

## Troubleshooting

```bash
# Connection issues
backup-peer doctor          # Run connectivity tests
backup-peer logs           # View recent activity

# Reset everything
backup-peer reset          # Clears keys and config (destructive!)
```

## Next Steps

- Join our [Discord community](https://discord.gg/backuppeer)
- Read the [full documentation](./README.md)  
- Report issues on [GitHub](https://github.com/backuppeer/backup-peer)

**Remember**: This is an MVP. Features like Tor integration, GUI client, and mobile apps are coming in future releases!