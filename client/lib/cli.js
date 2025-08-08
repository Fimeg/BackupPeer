#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const P2PConnection = require('./p2p');
const BackupCrypto = require('./crypto');
const FileTransfer = require('./transfer');
const StorageManager = require('./storage');
const StorageVerification = require('./verification');
const ReputationSystem = require('./reputation');
const Database = require('./database');
const BackupPeerTUI = require('./tui');
const TradeAuthenticator = require('./auth');
const logger = require('./logger');
const blessed = require('blessed');
const path = require('path');

const program = new Command();

// Log system info on startup
logger.initializeSync();
logger.logSystemInfo();
logger.info('BackupPeer CLI started');

program
  .name('backup-peer')
  .description('Privacy-focused P2P backup exchange')
  .version('0.1.0');

// Initialize command - setup keys and config
program
  .command('init')
  .description('Initialize BackupPeer with encryption keys')
  .option('-d, --dir <directory>', 'config directory', '~/.backup-peer')
  .action(async (options) => {
    const spinner = ora('Initializing BackupPeer...').start();
    
    try {
      const crypto = new BackupCrypto();
      const storage = new StorageManager(options.dir);
      
      // Initialize crypto keys
      await crypto.initializeKeys(options.dir);
      
      // Initialize storage
      await storage.initialize();
      
      spinner.succeed('BackupPeer initialized successfully!');
      console.log(chalk.green('✓ Encryption keys generated'));
      console.log(chalk.green('✓ Storage directories created'));
      console.log(chalk.blue(`Public key: ${crypto.getPublicKeyHex()}`));
      console.log(chalk.gray(`Config directory: ${options.dir.replace('~', require('os').homedir())}`));
      
    } catch (error) {
      spinner.fail('Initialization failed');
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Test command - establish P2P connection and ping
program
  .command('test')
  .description('Test P2P connection with another peer')
  .option('-s, --server <url>', 'signaling server URL', 'ws://localhost:3000')
  .option('-i, --id <peerId>', 'peer ID', `peer-${Date.now()}`)
  .option('--storage <size>', 'storage offering in GB', '10')
  .action(async (options) => {
    const spinner = ora('Initializing P2P connection...').start();
    
    try {
      const connection = new P2PConnection({
        peerId: options.id,
        signalingUrl: options.server,
        requirements: {
          storage: parseInt(options.storage) * 1024 * 1024 * 1024 // Convert GB to bytes
        }
      });
      
      // Set up event handlers
      connection.on('waiting', () => {
        spinner.text = 'Waiting for compatible peer...';
      });
      
      connection.on('matched', (peer) => {
        spinner.text = `Matched with ${peer.peerId}, establishing connection...`;
      });
      
      connection.on('connected', () => {
        spinner.succeed('P2P connection established!');
        
        console.log(chalk.green('✓ Connection successful'));
        console.log(chalk.blue('Sending test ping...'));
        
        // Send a test ping
        connection.ping();
        
        // Handle responses
        connection.on('message', (message) => {
          if (message.type === 'ping') {
            console.log(chalk.yellow(`Received ping from ${message.from}`));
            // Send pong back
            connection.send({
              type: 'pong',
              timestamp: Date.now(),
              from: options.id,
              originalTimestamp: message.timestamp
            });
          } else if (message.type === 'pong') {
            const latency = Date.now() - message.originalTimestamp;
            console.log(chalk.green(`Pong received! Latency: ${latency}ms`));
            
            // Close connection after successful test
            setTimeout(() => {
              console.log(chalk.blue('Test completed, closing connection...'));
              connection.close();
              process.exit(0);
            }, 1000);
          }
        });
      });
      
      connection.on('error', (error) => {
        spinner.fail('Connection failed');
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      });
      
      connection.on('disconnected', () => {
        console.log(chalk.yellow('Connection closed'));
        process.exit(0);
      });
      
      // Start connection
      await connection.connect();
      
    } catch (error) {
      spinner.fail('Failed to initialize connection');
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Listen command - wait for incoming connections
program
  .command('listen')
  .description('Listen for incoming backup requests')
  .option('-s, --server <url>', 'signaling server URL', 'ws://localhost:3000')
  .option('-i, --id <peerId>', 'peer ID', `listener-${Date.now()}`)
  .option('--storage <size>', 'storage offering in GB', '10')
  .action(async (options) => {
    console.log(chalk.blue(`Starting backup peer listener: ${options.id}`));
    console.log(chalk.gray(`Storage offering: ${options.storage}GB`));
    console.log(chalk.gray(`Signaling server: ${options.server}`));
    
    const connection = new P2PConnection({
      peerId: options.id,
      signalingUrl: options.server,
      requirements: {
        storage: parseInt(options.storage) * 1024 * 1024 * 1024
      }
    });
    
    const spinner = ora('Waiting for peer connections...').start();
    
    connection.on('waiting', () => {
      spinner.text = 'Waiting for compatible peer...';
    });
    
    connection.on('matched', (peer) => {
      spinner.text = `Matched with ${peer.peerId}, establishing connection...`;
    });
    
    connection.on('connected', () => {
      spinner.succeed('Peer connected!');
      console.log(chalk.green('✓ Ready to exchange backups'));
      
      // Handle incoming messages
      connection.on('message', (message) => {
        console.log(chalk.yellow(`Received: ${message.type} from ${message.from}`));
        
        if (message.type === 'ping') {
          connection.send({
            type: 'pong',
            timestamp: Date.now(),
            from: options.id,
            originalTimestamp: message.timestamp
          });
        }
      });
    });
    
    connection.on('error', (error) => {
      spinner.fail('Connection error');
      console.error(chalk.red('Error:'), error.message);
    });
    
    try {
      await connection.connect();
    } catch (error) {
      spinner.fail('Failed to start listener');
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Backup command - send files to peer
program
  .command('backup <files...>')
  .description('🔐 Backup files to sovereign peer - ENCRYPT & LIBERATE!')
  .option('-s, --server <url>', 'signaling server URL', 'wss://backup01.wiuf.net')
  .option('-n, --name <backupName>', 'backup set name')
  .option('-p, --peer <peerId>', 'specific peer ID to backup to')
  .option('--storage <size>', 'storage offering in GB', '10')
  .option('-d, --daemon', 'run backup in background service')
  .option('-w, --watch', 'watch progress in real-time')
  .option('--accept-terms', 'automatically accept terms of use (for testing)')
  .option('--auto', 'automatically select first available peer')
  .action(async (files, options) => {
    console.log(chalk.blue('🔥 Starting sovereign backup process...'));
    
    if (options.daemon) {
      // Use background service
      const ServiceClient = require('./service-client');
      const client = new ServiceClient();
      
      try {
        // Ensure service is running
        const isRunning = await client.isServiceRunning();
        if (!isRunning) {
          console.log(chalk.yellow('Starting BackupPeer service...'));
          await startService();
        }
        
        await client.connect();
        
        const backupData = {
          name: options.name || `backup-${Date.now()}`,
          files,
          peerId: `peer-${Date.now()}`, // This should come from peer selection
          signalingUrl: options.server,
          storageSize: parseInt(options.storage) * 1024 * 1024 * 1024
        };
        
        const result = await client.sendCommand('start_backup', backupData);
        
        if (result.success) {
          console.log(chalk.green(`✅ Backup started: ${result.backupId}`));
          console.log(chalk.blue('Run "backup-peer progress" to monitor'));
          
          if (options.watch) {
            // Watch progress in real-time
            await watchBackupProgress(client, result.backupId);
          }
        } else {
          console.error(chalk.red('Failed to start backup:'), result.error);
        }
        
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
      } finally {
        client.close();
      }
      
      return; // Exit early for daemon mode
    }
    
    // Continue with foreground mode
    console.log(chalk.green('Breaking free from Big Tech surveillance!'));
    let spinner;
    try {
      // Handle terms acceptance
      if (options.acceptTerms) {
        console.log(chalk.green('✅ Terms automatically accepted (testing mode)'));
      } else {
        // Initialize authentication first
        const screen = blessed.screen({ smartCSR: true, title: 'BackupPeer - Digital Sovereignty' });
        const auth = new TradeAuthenticator(screen);
        
        const termsAccepted = await auth.checkTermsAcceptance();
        if (!termsAccepted) {
          const accepted = await auth.showTermsOfUse();
          if (!accepted) {
            screen.destroy();
            console.log(chalk.red('🚫 Terms rejected. Cannot backup files.'));
            process.exit(1);
          }
        }
        screen.destroy();
      }
      
      spinner = ora('Initializing crypto-anarchist backup...').start();
      
      // Initialize components
      const crypto = new BackupCrypto();
      const storage = new StorageManager();
      
      await crypto.initializeKeys();
      await storage.initialize();
      
// DIAGNOSTIC: Add initial logging
console.log('\n🔍 DIAGNOSTIC: Checking backup prerequisites...');
console.log(`- options.peer: ${options.peer}`);
console.log(`- options.auto: ${options.auto}`);
console.log(`- files to backup: ${files.length}`);

// DIAGNOSTIC: Check database for cached peers
const database = new Database();
await database.initialize();
const cachedPeers = await database.getCachedPeers();
console.log(`- Cached peers in database: ${cachedPeers.length}`);
if (cachedPeers.length > 0) {
  console.log('- Available cached peers:');
  cachedPeers.forEach(peer => {
    console.log(`  • ${peer.peerIdHash} (trust: ${peer.trustLevel}, last seen: ${new Date(peer.lastSeen).toLocaleString()})`);
  });
}
await database.close();

// Handle peer selection
let peerId = options.peer;

// Auto-discovery mode
if (!peerId && options.auto) {
  console.log('\n🔍 Auto-discovering available peers for backup...');
  
  const serverUrl = options.server.replace('wss://', 'https://').replace('ws://', 'http://');
  let availablePeers = [];
  
  try {
    // Try marketplace API first
    const response = await fetch(`${serverUrl}/api/peers/browse`);
    if (response.ok) {
      const data = await response.json();
      availablePeers = (data.peers || []).filter(peer =>
        (peer.reputation || 0.5) >= 0.5 && // Minimum trust
        peer.storage >= parseInt(options.storage) * 1024 * 1024 * 1024 // Has enough storage
      );
    }
  } catch (error) {
    console.log(chalk.yellow(`API Error: ${error.message}`));
  }
  
  // Fallback to cached peers if API fails
  if (availablePeers.length === 0 && cachedPeers.length > 0) {
    console.log(chalk.yellow('Using cached peers from database...'));
    availablePeers = cachedPeers.map(peer => ({
      peerId: peer.peerIdHash,
      reputation: peer.successRate || 0.5,
      trustLevel: peer.trustLevel
    }));
  }
  
  if (availablePeers.length === 0) {
    throw new Error('No suitable peers found for auto-backup. Try "backup-peer browse" to see available peers.');
  }
  
  // Select the best peer (highest reputation)
  const selectedPeer = availablePeers.sort((a, b) => b.reputation - a.reputation)[0];
  peerId = selectedPeer.peerId;
  
  console.log(chalk.green(`\n✅ Auto-selected peer: ${peerId.slice(0, 16)}...`));
  console.log(chalk.gray(`   Trust: ${(selectedPeer.reputation * 100).toFixed(0)}% | Level: ${selectedPeer.trustLevel || 'unknown'}`));
}

// Check if we still don't have a peer
if (!peerId) {
  console.log('\n❌ No peer specified for backup!');
  console.log('- Use --peer <peerId> to specify a peer');
  console.log('- Use --auto to automatically select a peer');
  console.log('- Run "backup-peer browse" to see available peers');
  
  throw new Error('No peer specified for backup. Use --peer <peerId> or --auto flag.');
}

console.log(`\n✅ Using peer for backup: ${peerId}`);

// Initialize P2P connection
const connection = new P2PConnection({
  peerId: `backup-${Date.now()}`,
  signalingUrl: options.server,
  requirements: {
    storage: parseInt(options.storage) * 1024 * 1024 * 1024
  }
});

// Initialize file transfer
const transfer = new FileTransfer(connection, crypto);

// Set up connection event handlers
connection.on('waiting', () => {
  spinner.text = 'Waiting for peer connection...';
});

connection.on('matched', (peer) => {
  spinner.text = `Matched with peer ${peer.peerId}, establishing connection...`;
});

connection.on('connected', async () => {
  spinner.succeed('P2P connection established!');
  console.log(chalk.green('🔐 Secure encrypted channel ready!'));
  
  try {
    // Start the backup transfer
    spinner = ora('Encrypting and sending files...').start();
    
    const backupName = options.name || `backup-${Date.now()}`;
    const result = await transfer.sendBackup(files, connection.currentPeerId, backupName);
    
    // Record backup in storage
    await storage.recordBackup(result.backupId, {
      name: backupName,
      files: files.map(f => ({ path: f, name: path.basename(f) })),
      peerId: connection.currentPeerId,
      timestamp: Date.now()
    });
    
    spinner.succeed('🎉 DIGITAL LIBERATION COMPLETE!');
    console.log(chalk.green(`✅ Backup ID: ${result.backupId}`));
    console.log(chalk.blue('💪 Your data is now sovereign!'));
    
  } catch (error) {
    spinner.fail('Backup transfer failed');
    console.error(chalk.red('Transfer error:'), error.message);
  } finally {
    // Close connection after transfer
    await connection.close();
    process.exit(0);
  }
});

connection.on('error', (error) => {
  spinner.fail('Connection failed');
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});

connection.on('disconnected', () => {
  console.log(chalk.yellow('Connection closed'));
});

// Handle file transfer messages
connection.on('message', (message) => {
  if (transfer.isTransferMessage(message.type)) {
    transfer.handleTransferMessage(message, connection.currentPeerId);
  }
});

// Await the connection to be fully established before proceeding
try {
  spinner = ora('Connecting to peer...').start();
  console.log(`\n🔍 Attempting to connect to peer: ${peerId}`);
  
  // Use connectToPeer for specific peer connection
  await connection.connectToPeer(peerId);
  
  // Connection handlers will take over from here
} catch (error) {
  spinner.fail('Failed to establish P2P connection');
  console.error(chalk.red('Connection error:'), error.message);
  console.log('\n💡 Hint: Make sure the peer is online and hosting a backup slot');
  console.log('💡 Try: backup-peer browse to see available peers');
  process.exit(1);
}

// ... (rest of the backup command logic, which now assumes a connected peer)
      
    } catch (error) {
      if (spinner) {
        spinner.fail('Backup initialization failed');
      } else {
        console.error(chalk.red('Backup initialization failed'));
      }
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Restore command - receive files from peer
program
  .command('restore')
  .description('Wait to receive backup files from a peer')
  .option('-s, --server <url>', 'signaling server URL', 'ws://localhost:3000')
  .option('--storage <size>', 'storage offering in GB', '10')
  .action(async (options) => {
    console.log(chalk.blue('Starting restore mode...'));
    
    try {
      const crypto = new BackupCrypto();
      const storage = new StorageManager();
      
      await crypto.initializeKeys();
      await storage.initialize();
      
      const connection = new P2PConnection({
        peerId: `restore-${Date.now()}`,
        signalingUrl: options.server,
        requirements: {
          storage: parseInt(options.storage) * 1024 * 1024 * 1024
        }
      });
      
      const transfer = new FileTransfer(connection, crypto);
      
      const spinner = ora('Waiting for backup partner...').start();
      
      connection.on('matched', async (peer) => {
        spinner.text = 'Establishing secure connection...';
        
        if (!peer.publicKey) {
          throw new Error('Peer must provide valid public key for secure restoration');
        }
        const peerPublicKey = BackupCrypto.publicKeyFromHex(peer.publicKey);
        crypto.generateSharedSecret(peerPublicKey, peer.peerId);
      });
      
      connection.on('connected', () => {
        spinner.succeed('Connected! Ready to receive backups.');
        console.log(chalk.green('✓ Secure connection established'));
        console.log(chalk.blue('Waiting for files...'));
      });
      
      // Handle incoming messages
      connection.on('message', async (message) => {
        if (message.type === 'backup_start') {
          console.log(chalk.yellow(`Receiving backup: ${message.backupName}`));
        } else if (message.type === 'backup_complete') {
          console.log(chalk.green('✓ Backup received successfully!'));
          
          // Record received backup
          await storage.recordReceivedBackup(message.backupId, {
            name: message.backupName,
            peerId: connection.peerId
          });
          
          connection.close();
        }
        
        transfer.handleTransferMessage(message, connection.peerId);
      });
      
      connection.on('error', (error) => {
        spinner.fail('Connection failed');
        console.error(chalk.red('Error:'), error.message);
      });
      
      await connection.connect();
      
    } catch (error) {
      console.error(chalk.red('Restore failed:'), error.message);
      process.exit(1);
    }
  });

// List backups command
program
  .command('list')
  .description('List all backups')
  .option('-t, --type <type>', 'backup type (sent|received|all)', 'all')
  .action(async (options) => {
    try {
      const storage = new StorageManager();
      await storage.initialize();
      
      const backups = storage.listBackups(options.type);
      const usage = await storage.getStorageUsage();
      
      console.log(chalk.blue('BackupPeer Storage Summary'));
      console.log(chalk.gray('═'.repeat(40)));
      console.log(`Total backups: ${usage.totalBackups}`);
      console.log(`Sent: ${usage.sentBackups} (${(usage.sentSize / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`Received: ${usage.receivedBackups} (${(usage.receivedSize / 1024 / 1024).toFixed(1)} MB)`);
      console.log('');
      
      if (backups.length === 0) {
        console.log(chalk.yellow('No backups found'));
        return;
      }
      
      backups.forEach(backup => {
        const date = new Date(backup.timestamp).toLocaleDateString();
        const size = backup.files.reduce((sum, f) => sum + (f.size || 0), 0);
        const sizeStr = (size / 1024 / 1024).toFixed(1) + ' MB';
        
        console.log(`${backup.type === 'sent' ? '📤' : '📥'} ${backup.name}`);
        console.log(`   ID: ${backup.id}`);
        console.log(`   Date: ${date}`);
        console.log(`   Files: ${backup.files.length} (${sizeStr})`);
        console.log(`   Status: ${backup.status}`);
        console.log('');
      });
      
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Status command
program
  .command('status')
  .description('Show current peer status and configuration')
  .action(async () => {
    try {
      const crypto = new BackupCrypto();
      const storage = new StorageManager();
      
      console.log(chalk.blue('BackupPeer Status'));
      console.log(chalk.gray('═'.repeat(30)));
      console.log('Version:', chalk.green('0.2.0 Sprint 2'));
      console.log('Features:', chalk.green('✓ Encrypted file transfer'));
      
      try {
        await crypto.initializeKeys();
        console.log('Encryption:', chalk.green('✓ Keys initialized'));
        console.log('Public Key:', chalk.gray(crypto.getPublicKeyHex().slice(0, 16) + '...'));
      } catch (error) {
        console.log('Encryption:', chalk.red('✗ Run \'backup-peer init\' first'));
      }
      
      try {
        await storage.initialize();
        const usage = await storage.getStorageUsage();
        console.log('Storage:', chalk.green(`✓ ${usage.totalBackups} backups tracked`));
      } catch (error) {
        console.log('Storage:', chalk.yellow('⚠ Storage not initialized'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

// Add service management commands
program
  .command('service <action>')
  .description('Manage BackupPeer background service (start|stop|status|restart)')
  .action(async (action) => {
    const ServiceClient = require('./service-client');
    const client = new ServiceClient();
    
    try {
      switch (action) {
        case 'start':
          await startService();
          break;
          
        case 'stop':
          await client.connect();
          const result = await client.sendCommand('shutdown');
          if (result.success) {
            console.log(chalk.green('✓ BackupPeer service stopped'));
          }
          break;
          
        case 'status':
          await client.connect();
          const status = await client.sendCommand('get_status');
          console.log(chalk.blue('BackupPeer Service Status'));
          console.log(chalk.gray('═'.repeat(40)));
          console.log(`Status: ${chalk.green(status.status)}`);
          console.log(`PID: ${status.pid}`);
          console.log(`Uptime: ${formatUptime(status.uptime)}`);
          console.log(`Active Backups: ${status.activeBackups}`);
          console.log(`Connections: ${status.connections}`);
          console.log(`Memory: ${status.memory.rss} (heap: ${status.memory.heapUsed})`);
          break;
          
        case 'restart':
          await client.connect();
          await client.sendCommand('shutdown');
          await new Promise(resolve => setTimeout(resolve, 1000));
          await startService();
          break;
          
        default:
          console.error(chalk.red(`Unknown action: ${action}`));
          console.log('Valid actions: start, stop, status, restart');
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        console.log(chalk.yellow('BackupPeer service is not running'));
      } else {
        console.error(chalk.red('Error:'), error.message);
      }
    } finally {
      client.close();
    }
  });

// Add progress command
program
  .command('progress [backupId]')
  .description('Show progress of active backups')
  .action(async (backupId) => {
    const ServiceClient = require('./service-client');
    const client = new ServiceClient();
    
    try {
      await client.connect();
      
      if (backupId) {
        // Show specific backup progress
        const progress = await client.sendCommand('get_progress', { backupId });
        displayBackupProgress(progress);
      } else {
        // Show all active backups
        const result = await client.sendCommand('list_active');
        
        if (result.backups.length === 0) {
          console.log(chalk.yellow('No active backups'));
          return;
        }
        
        console.log(chalk.blue('Active Backups'));
        console.log(chalk.gray('═'.repeat(60)));
        
        for (const backup of result.backups) {
          console.log(`\n${chalk.bold(backup.name || backup.id)}`);
          console.log(`Status: ${getStatusIcon(backup.status)} ${backup.status}`);
          console.log(`Progress: ${createProgressBar(backup.progress)}%`);
          console.log(`Files: ${backup.files} | Started: ${new Date(backup.startTime).toLocaleString()}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    } finally {
      client.close();
    }
  });

// Verify command - check backup integrity
program
  .command('verify <backupId>')
  .description('Verify integrity of a received backup')
  .action(async (backupId) => {
    try {
      const storage = new StorageManager();
      await storage.initialize();
      
      const backup = storage.getBackup(backupId);
      if (!backup) {
        console.error(chalk.red('Backup not found:'), backupId);
        return;
      }
      
      if (backup.type !== 'received') {
        console.error(chalk.red('Can only verify received backups'));
        return;
      }
      
      console.log(chalk.blue(`Verifying backup: ${backup.name}`));
      
      const results = await storage.verifyReceivedFiles(backupId);
      let validFiles = 0;
      
      results.forEach(result => {
        const status = result.valid ? chalk.green('✓') : chalk.red('✗');
        console.log(`${status} ${result.name}`);
        if (result.valid) validFiles++;
        if (!result.exists) {
          console.log(chalk.red(`   File missing: ${result.path}`));
        } else if (!result.valid) {
          console.log(chalk.red('   Integrity check failed'));
        }
      });
      
      console.log('');
      console.log(`Valid files: ${validFiles}/${results.length}`);
      
      if (validFiles === results.length) {
        console.log(chalk.green('✓ Backup integrity verified'));
      } else {
        console.log(chalk.red('✗ Backup integrity compromised'));
      }
      
    } catch (error) {
      console.error(chalk.red('Verification failed:'), error.message);
    }
  });

// Challenge command - send storage verification challenge
program
  .command('challenge <peerId> <backupId>')
  .description('Send storage verification challenge to peer')
  .option('-t, --type <type>', 'challenge type (random_blocks|file_hash|metadata_proof)', 'random_blocks')
  .action(async (peerId, backupId, options) => {
    try {
      const crypto = new BackupCrypto();
      const db = new Database();
      
      await crypto.initializeKeys();
      await db.initialize();
      
      // This would normally require an active P2P connection
      console.log(chalk.yellow('Note: Challenge requires active P2P connection'));
      console.log(chalk.blue(`Would send ${options.type} challenge to ${peerId} for backup ${backupId}`));
      
      // For demonstration, show what challenge would look like
      const verification = new StorageVerification(null, null);
      const challenge = verification.generateChallenge(backupId, options.type);
      
      console.log(chalk.gray('Challenge data:'));
      console.log(JSON.stringify(challenge, null, 2));
      
    } catch (error) {
      console.error(chalk.red('Challenge failed:'), error.message);
    }
  });

// Reputation command - manage peer reputation
program
  .command('reputation')
  .description('Show peer reputation statistics')
  .option('-p, --peer <peerId>', 'show specific peer reputation')
  .option('--list', 'list all peers by reputation')
  .option('--summary', 'show reputation summary')
  .action(async (options) => {
    try {
      const reputation = new ReputationSystem();
      await reputation.initialize();
      
      if (options.peer) {
        // Show specific peer reputation
        const peerRep = reputation.getPeerReputation(options.peer);
        
        console.log(chalk.blue(`Reputation for ${options.peer}`));
        console.log(chalk.gray('═'.repeat(40)));
        console.log(`Overall Score: ${peerRep.overallScore.toFixed(3)} (${peerRep.trustLevel})`);
        console.log(`Connections: ${peerRep.successfulConnections}/${peerRep.totalConnections}`);
        console.log(`Verifications: ${peerRep.successfulChallenges}/${peerRep.totalChallenges}`);
        console.log(`Data Integrity: ${(peerRep.dataIntegrityScore * 100).toFixed(1)}%`);
        console.log(`Uptime Score: ${(peerRep.uptimeScore * 100).toFixed(1)}%`);
        console.log(`Last Seen: ${new Date(peerRep.lastSeen).toLocaleDateString()}`);
        
        if (peerRep.isBlacklisted) {
          console.log(chalk.red(`⚠ BLACKLISTED: ${peerRep.blacklistReason}`));
        }
        
      } else if (options.list) {
        // Show ranked peer list
        const rankedPeers = reputation.getRankedPeers(20);
        
        console.log(chalk.blue('Peer Reputation Rankings'));
        console.log(chalk.gray('═'.repeat(50)));
        
        rankedPeers.forEach((peer, index) => {
          const rank = index + 1;
          const score = peer.score.toFixed(3);
          const trustIcon = {
            'trusted': '🟢',
            'acceptable': '🟡', 
            'suspicious': '🟠',
            'untrusted': '🔴'
          }[peer.trustLevel] || '⚪';
          
          console.log(`${rank.toString().padStart(2)}. ${trustIcon} ${peer.peerId.slice(0, 16)}... (${score})`);
        });
        
      } else {
        // Show summary
        const summary = reputation.getReputationSummary();
        
        console.log(chalk.blue('Reputation System Summary'));
        console.log(chalk.gray('═'.repeat(35)));
        console.log(`Total Peers: ${summary.totalPeers}`);
        console.log(`🟢 Trusted: ${summary.trusted}`);
        console.log(`🟡 Acceptable: ${summary.acceptable}`);
        console.log(`🟠 Suspicious: ${summary.suspicious}`);
        console.log(`🔴 Untrusted: ${summary.untrusted}`);
        console.log(`⚫ Blacklisted: ${summary.blacklisted}`);
        console.log(`Average Score: ${summary.averageScore.toFixed(3)}`);
      }
      
    } catch (error) {
      console.error(chalk.red('Reputation command failed:'), error.message);
    }
  });

// Monitor command - start verification monitoring
program
  .command('monitor')
  .description('Start periodic storage verification monitoring')
  .option('-i, --interval <hours>', 'verification interval in hours', '24')
  .option('-s, --server <url>', 'signaling server URL', 'ws://localhost:3000')
  .action(async (options) => {
    console.log(chalk.blue('Starting BackupPeer monitoring daemon...'));
    
    try {
      const crypto = new BackupCrypto();
      const storage = new StorageManager();
      const reputation = new ReputationSystem();
      const db = new Database();
      
      await crypto.initializeKeys();
      await storage.initialize();
      await reputation.initialize();
      await db.initialize();
      
      console.log(chalk.green('✓ All systems initialized'));
      console.log(chalk.blue(`Verification interval: ${options.interval} hours`));
      console.log(chalk.gray('Press Ctrl+C to stop monitoring'));
      
      // This would start the actual monitoring in a real implementation
      console.log(chalk.yellow('Monitoring daemon started (demo mode)'));
      
      // Keep process alive
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nStopping monitoring daemon...'));
        process.exit(0);
      });
      
      // Simulate monitoring
      setInterval(() => {
        console.log(chalk.gray(`[${new Date().toISOString()}] Monitoring active...`));
      }, 60000); // Log every minute
      
    } catch (error) {
      console.error(chalk.red('Monitor failed to start:'), error.message);
      process.exit(1);
    }
  });

// Stats command - show detailed statistics
program
  .command('stats')
  .description('Show detailed backup and peer statistics')
  .action(async () => {
    try {
      const db = new Database();
      await db.initialize();
      
      const storageStats = await db.getStorageStats();
      const reputationStats = await db.getReputationStats();
      
      console.log(chalk.blue('BackupPeer Statistics'));
      console.log(chalk.gray('═'.repeat(40)));
      
      console.log(chalk.yellow('Storage:'));
      console.log(`  Total Backups: ${storageStats.totalBackups}`);
      console.log(`  Sent: ${storageStats.sentBackups} (${(storageStats.sentSize / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`  Received: ${storageStats.receivedBackups} (${(storageStats.receivedSize / 1024 / 1024).toFixed(1)} MB)`);
      
      console.log('');
      console.log(chalk.yellow('Peer Network:'));
      console.log(`  Total Peers: ${reputationStats.totalPeers}`);
      console.log(`  Trusted: ${reputationStats.trusted}`);
      console.log(`  Acceptable: ${reputationStats.acceptable}`);
      console.log(`  Suspicious: ${reputationStats.suspicious}`);
      console.log(`  Blacklisted: ${reputationStats.blacklisted}`);
      console.log(`  Average Reputation: ${reputationStats.averageScore.toFixed(3)}`);
      
      await db.close();
      
    } catch (error) {
      console.error(chalk.red('Stats command failed:'), error.message);
    }
  });

// Browse peers - THE SOVEREIGN MARKETPLACE!
program
  .command('browse')
  .description('🔥 Browse the decentralized peer network - FIGHT BIG TECH!')
  .option('-s, --server <url>', 'signaling server URL', 'wss://backup01.wiuf.net')
  .option('--min-trust <score>', 'minimum trust score (0-1)', '0.5')
  .option('--min-storage <gb>', 'minimum storage offered in GB', '1')
  .action(async (options) => {
    console.log(chalk.blue('🔥 LAUNCHING DIGITAL FREEDOM MARKETPLACE! 🔥'));
    console.log(chalk.green('Breaking the chains of Big Tech surveillance...'));
    
    try {
      // Initialize authentication system
      const screen = blessed.screen({ smartCSR: true, title: 'BackupPeer - Digital Sovereignty' });
      const auth = new TradeAuthenticator(screen);
      
      // Check Terms of Use acceptance
      const termsAccepted = await auth.checkTermsAcceptance();
      if (!termsAccepted) {
        const accepted = await auth.showTermsOfUse();
        if (!accepted) {
          console.log(chalk.red('\\n🚫 Terms rejected. Cannot browse peer network.'));
          console.log(chalk.yellow('Digital sovereignty requires accepting responsibility!'));
          process.exit(1);
        }
      }
      
      screen.destroy();
      console.log(chalk.green('✅ Terms accepted - Welcome to the sovereign network!'));
      
      // Fetch real peer data from marketplace API
      const serverUrl = options.server.replace('wss://', 'https://').replace('ws://', 'http://');
      
      const spinner = ora('Scanning the sovereign network for peers...').start();
      
      let availablePeers = [];
      try {
        const { default: fetch } = await import('node-fetch');
        const response = await fetch(`${serverUrl}/api/peers/browse`);
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        const allPeers = data.peers || [];
        
        const minTrust = parseFloat(options.minTrust);
        const minStorageBytes = parseInt(options.minStorage) * 1024 * 1024 * 1024;
        
        // Filter peers based on requirements
        availablePeers = allPeers.filter(peer => {
          const peerStorageBytes = typeof peer.storage === 'string' ? 
            parseInt(peer.storage.replace(/[^0-9]/g, '')) * 1024 * 1024 * 1024 : 
            peer.storage;
          
          return (peer.reputation || 0.5) >= minTrust && 
                 peerStorageBytes >= minStorageBytes;
        });
        
        spinner.succeed(`Found ${availablePeers.length} peers in the sovereign network!`);
        
      } catch (error) {
        spinner.warn('Could not reach marketplace API, using cached data...');
        console.log(chalk.yellow(`API Error: ${error.message}`));
        
        // Fallback to local database for cached peers
        try {
          const database = new Database();
          await database.initialize();
          const cachedPeers = await database.getCachedPeers();
          
          availablePeers = cachedPeers.map(peer => ({
            peerId: peer.peerIdHash,
            trustLevel: peer.trustLevel,
            reputation: peer.successRate || 0.5,
            storage: '10GB', // Default display
            location: 'Cached',
            expires: peer.lastSeen + (24 * 60 * 60 * 1000), // 24h from last seen
            description: 'Previously connected peer'
          }));
          
          await database.close();
        } catch (dbError) {
          console.log(chalk.red(`Database error: ${dbError.message}`));
          availablePeers = [];
        }
      }
      
      if (availablePeers.length === 0) {
        console.log(chalk.yellow('\\n🔍 No peers found matching your criteria'));
        console.log(chalk.blue('Help the network: backup-peer host --storage 50GB'));
        return;
      }
      
      console.log(chalk.green(`\\n✊ Found ${availablePeers.length} freedom fighters ready to trade!`));
      console.log(chalk.gray('═'.repeat(80)));
      
      availablePeers.forEach((peer, index) => {
        const trustIcon = {
          'trusted': '🟢',
          'acceptable': '🟡', 
          'suspicious': '🟠',
          'untrusted': '🔴'
        }[peer.trustLevel] || '⚪';
        
        const storageGB = (peer.storage / 1024 / 1024 / 1024).toFixed(1);
        const timeLeft = Math.max(0, peer.expires - Date.now());
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        
        console.log(`\\n${index + 1}. ${trustIcon} Peer: ${peer.peerId}`);
        console.log(`   Trust: ${(peer.reputation * 100).toFixed(0)}% | Storage: ${storageGB}GB | Location: ${peer.location}`);
        console.log(`   Available: ${hoursLeft}h | ${peer.description}`);
        console.log(chalk.gray(`   Connect: backup-peer connect ${peer.peerId}`));
      });
      
      console.log(chalk.blue('\\n🚀 Ready to connect! Use: backup-peer connect <peer-id>'));
      console.log(chalk.green('Every encrypted backup is a victory against surveillance! 🔐'));
      
    } catch (error) {
      console.error(chalk.red('Failed to browse sovereign network:'), error.message);
      console.log(chalk.yellow('💡 Try: backup-peer host --storage 50GB to help the network'));
    }
  });

// Host backup slot - BECOME A FREEDOM FIGHTER!
program
  .command('host')
  .description('🛡️ Host backup storage - JOIN THE RESISTANCE!')
  .option('-s, --server <url>', 'signaling server URL', 'wss://backup01.wiuf.net')
  .option('-i, --id <peerId>', 'custom peer ID (default: auto-generated)')
  .option('--storage <gb>', 'storage to offer in GB', '10')
  .option('--duration <hours>', 'hours to stay available', '2')
  .option('--location <location>', 'your general location', 'Sovereign Territory')
  .option('--log-file <path>', 'path to save log file')
  .option('--accept-terms', 'automatically accept terms of use (for testing)')
  .action(async (options) => {
    if (options.logFile) {
      setupLogger(options.logFile);
    }
    console.log(chalk.blue('🔥 JOINING THE DIGITAL RESISTANCE! 🔥'));
    console.log(chalk.green('Hosting backup slot to liberate human data...'));
    
    try {
      // Handle terms acceptance
      if (options.acceptTerms) {
        console.log(chalk.green('✅ Terms automatically accepted (testing mode)'));
      } else {
        // Initialize authentication
        const screen = blessed.screen({ smartCSR: true, title: 'BackupPeer - Digital Sovereignty' });
        const auth = new TradeAuthenticator(screen);
        
        const termsAccepted = await auth.checkTermsAcceptance();
        if (!termsAccepted) {
          const accepted = await auth.showTermsOfUse();
          if (!accepted) {
            screen.destroy();
            console.log(chalk.red('🚫 Terms rejected. Cannot host sovereign storage.'));
            process.exit(1);
          }
        }
        
        screen.destroy();
      }
      
      console.log(chalk.green('✅ Terms accepted - Becoming a freedom fighter!'));
      
      // Use P2PConnection to properly handle hosting
      const peerId = options.id || `host-${Date.now()}-freedom`;
      const connection = new P2PConnection({
        peerId: peerId,
        signalingUrl: options.server,
        requirements: {
          storage: parseInt(options.storage) * 1024 * 1024 * 1024
        }
      });
      
      console.log(chalk.blue(`\\n🛡️ SOVEREIGNTY SLOT ACTIVE!`));
      console.log(chalk.blue(`Peer ID: ${connection.peerId}`));
      console.log(chalk.blue(`Storage: ${options.storage}GB for the resistance`));
      console.log(chalk.blue(`Duration: ${options.duration} hours`));
      console.log(chalk.blue(`Location: ${options.location}`));
      
      // Set up connection event handlers BEFORE hosting
      connection.on('connection_request', (data) => {
        console.log(chalk.yellow(`📡 Connection request from: ${data.requesterPeerId}`));
        // Auto-accept for now (in production, show auth dialog)
        console.log(chalk.green('✅ Auto-accepting connection request'));
      });
      
      connection.on('matched', (data) => {
        console.log(chalk.green(`🤝 Matched with peer: ${data.peerId}`));
      });
      
      connection.on('connected', () => {
        console.log(chalk.green('🔐 P2P connection established!'));
        console.log(chalk.cyan('Ready to receive backups!'));
      });
      
      connection.on('error', (error) => {
        console.error(chalk.red('Connection error:'), error);
      });
      
      // Host the slot using P2P connection's hostSlot method
      await connection.hostSlot(
        parseInt(options.storage) * 1024 * 1024 * 1024,
        parseInt(options.duration) * 60 * 60 * 1000,
        options.location
      );
      
      console.log(chalk.green('✅ Hosting sovereign backup slot!'));
      console.log(chalk.gray('Press Ctrl+C to stop hosting'));
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n🛑 Shutting down freedom slot...'));
        console.log(chalk.blue('Thank you for fighting for digital sovereignty! ✊'));
        await connection.close();
        process.exit(0);
      });
      
    } catch (error) {
      console.error(chalk.red('Failed to host freedom slot:'), error.message);
    }
  });

// Connect to peer - LIBERATION MOMENT!
program
  .command('connect [peerId]')
  .description('🤝 Connect to sovereign peer - BREAK FREE!')
  .option('-s, --server <url>', 'signaling server URL', 'wss://backup01.wiuf.net')
  .option('--storage <gb>', 'storage you need in GB', '10')
  .option('--log-file <path>', 'path to save log file')
  .option('--auto', 'automatically connect to first available peer')
  .option('--min-trust <score>', 'minimum trust score for auto mode (0-1)', '0.5')
  .option('--min-storage <gb>', 'minimum storage for auto mode in GB', '1')
  .option('--accept-terms', 'automatically accept terms of use (for testing)')
  .action(async (peerId, options) => {
    // Handle auto-discovery mode
    if (options.auto || !peerId) {
      if (!options.auto && !peerId) {
        console.error(chalk.red('Error: Must provide peerId or use --auto flag'));
        console.log(chalk.yellow('Usage: backup-peer connect <peerId> OR backup-peer connect --auto'));
        process.exit(1);
      }
      
      console.log(chalk.blue('🔍 Auto-discovering available peers...'));
      
      // Perform peer discovery (similar to browse command)
      const serverUrl = options.server.replace('wss://', 'https://').replace('ws://', 'http://');
      let availablePeers = [];
      
      try {
        const response = await fetch(`${serverUrl}/api/peers/browse`);
        if (response.ok) {
          const data = await response.json();
          const allPeers = data.peers || [];
          
          const minTrust = parseFloat(options.minTrust);
          const minStorageBytes = parseInt(options.minStorage) * 1024 * 1024 * 1024;
          
          // Filter peers based on requirements
          availablePeers = allPeers.filter(peer => {
            const peerStorageBytes = typeof peer.storage === 'string' ? 
              parseInt(peer.storage.replace(/[^0-9]/g, '')) * 1024 * 1024 * 1024 : 
              peer.storage;
            return (peer.reputation || 0.5) >= minTrust && 
                   peerStorageBytes >= minStorageBytes;
          });
        }
      } catch (error) {
        console.log(chalk.yellow(`API Error: ${error.message}`));
        // Fallback to local database for cached peers
        try {
          const Database = require('./database');
          const database = new Database();
          await database.initialize();
          const cachedPeers = await database.getCachedPeers();
          
          availablePeers = cachedPeers.map(peer => ({
            peerId: peer.peerIdHash,
            reputation: peer.reputation || 0.5,
            storage: 10 * 1024 * 1024 * 1024, // Default 10GB
            trustLevel: peer.trustLevel || 'acceptable'
          }));
          
          await database.close();
        } catch (dbError) {
          console.log(chalk.red(`Database error: ${dbError.message}`));
          availablePeers = [];
        }
      }
      
      if (availablePeers.length === 0) {
        console.log(chalk.yellow('🔍 No suitable peers found for auto-connect'));
        console.log(chalk.blue('💡 Try: backup-peer browse to see all available peers'));
        process.exit(1);
      }
      
      // Select the first available peer
      const selectedPeer = availablePeers[0];
      peerId = selectedPeer.peerId;
      
      console.log(chalk.green(`🎯 Auto-selected peer: ${peerId.slice(0, 16)}...`));
      console.log(chalk.gray(`   Trust: ${(selectedPeer.reputation * 100).toFixed(0)}% | Storage: ${(selectedPeer.storage / 1024 / 1024 / 1024).toFixed(1)}GB`));
    }
    if (options.logFile) {
      setupLogger(options.logFile);
    }
    console.log(chalk.blue(`🤝 Connecting to freedom fighter: ${peerId.slice(0, 16)}...`));
    console.log(chalk.green('Escaping Big Tech surveillance prison...'));
    
    try {
      // Initialize authentication
      const screen = blessed.screen({ smartCSR: true, title: 'BackupPeer - Peer Authentication' });
      const auth = new TradeAuthenticator(screen);
      
      // Handle terms acceptance
      if (options.acceptTerms) {
        console.log(chalk.green('✅ Terms automatically accepted (testing mode)'));
      } else {
        const termsAccepted = await auth.checkTermsAcceptance();
        if (!termsAccepted) {
          const accepted = await auth.showTermsOfUse();
          if (!accepted) {
            screen.destroy();
            console.log(chalk.red('🚫 Terms rejected. Cannot connect to peers.'));
            process.exit(1);
          }
        }
      }
      
      // Fetch real peer info from marketplace API or database
      const serverUrl = options.server.replace('wss://', 'https://').replace('ws://', 'http://');
      let peerInfo = null;
      
      try {
        const { default: fetch } = await import('node-fetch');
        // Try to get peer info from marketplace API
        const response = await fetch(`${serverUrl}/api/peers/browse`);
        if (response.ok) {
          const data = await response.json();
          peerInfo = data.peers.find(p => p.peerId === peerId);
        }
        
        // Fallback to local database
        if (!peerInfo) {
          const database = new Database();
          await database.initialize();
          const cachedPeers = await database.getCachedPeers();
          const cachedPeer = cachedPeers.find(p => p.peerIdHash === peerId);
          
          if (cachedPeer) {
            peerInfo = {
              peerId: cachedPeer.peerIdHash,
              trustLevel: cachedPeer.trustLevel,
              reputation: cachedPeer.successRate || 0.5,
              location: 'Previously Connected',
              lastSeen: cachedPeer.lastSeen,
              server: options.server,
              totalConnections: cachedPeer.connection_attempts || 1,
              successfulConnections: cachedPeer.successful_connections || 0,
              totalChallenges: 0,
              successfulChallenges: 0
            };
          }
          
          await database.close();
        }
        
      } catch (error) {
        console.log(chalk.yellow(`Could not fetch peer info: ${error.message}`));
      }
      
      // Default peer info if not found
      if (!peerInfo) {
        peerInfo = {
          peerId,
          trustLevel: 'unknown',
          reputation: 0.5,
          location: 'Unknown',
          lastSeen: Date.now(),
          server: options.server,
          totalConnections: 0,
          successfulConnections: 0,
          totalChallenges: 0,
          successfulChallenges: 0
        };
      }
      
      // Create trade request
      const tradeRequest = {
        storageOffered: 10 * 1024 * 1024 * 1024,
        storageNeeded: parseInt(options.storage) * 1024 * 1024 * 1024,
        duration: '2 hours',
        description: 'Mutual backup for digital freedom'
      };
      
      // Show authentication dialog or auto-accept for testing
      let authResult;
      if (options.acceptTerms) {
        // Auto-accept for testing
        authResult = { action: 'accept' };
        console.log(chalk.green('🤖 Trade automatically accepted (testing mode)'));
      } else {
        authResult = await auth.authenticateTrade(peerInfo, tradeRequest);
      }
      screen.destroy();
      
      if (authResult.action === 'accept') {
        console.log(chalk.green('\\n🎉 TRADE ACCEPTED - ESTABLISHING P2P CONNECTION!'));
        
        // Initialize real P2P connection
        const spinner = ora('Establishing secure peer connection...').start();
        
        try {
          const crypto = new BackupCrypto();
          await crypto.initializeKeys();
          const connection = new P2PConnection({
            peerId: `connect-${Date.now()}`,
            signalingUrl: options.server,
            requirements: {
              storage: parseInt(options.storage) * 1024 * 1024 * 1024
            }
          });
          
          // Set up connection event handlers
          connection.on('waiting', () => {
            spinner.text = 'Negotiating with signaling server...';
          });
          
          connection.on('matched', (peer) => {
            spinner.text = `Matched with ${peer.peerId}, establishing WebRTC...`;
          });
          
          connection.on('connected', async () => {
            spinner.succeed('P2P connection established!');
            
            // Save ICE data for future reconnection
            if (connection.peer && connection.peer._pc) {
              const iceData = {
                localDescription: connection.peer._pc.localDescription,
                remoteDescription: connection.peer._pc.remoteDescription,
                iceGatheringState: connection.peer._pc.iceGatheringState,
                connectionState: connection.peer._pc.connectionState
              };
              
              await connection.cachePeerConnection(
                peerId,
                iceData,
                'software-verified',
                connection.peerIdentity?.publicKey || 'unknown'
              );
            }
            
            console.log(chalk.blue(`Connected to: ${peerId.slice(0, 24)}...`));
            console.log(chalk.cyan('🔐 Secure encrypted channel ready!'));
            console.log(chalk.yellow('You can now backup files with:'));
            console.log(chalk.gray(`backup-peer backup ./your-sovereign-files/*`));
            
            // Keep connection alive
            console.log(chalk.gray('\\nConnection active. Press Ctrl+C to disconnect.'));
          });
          
          connection.on('error', (error) => {
            spinner.fail('Connection failed');
            console.log(chalk.red(`Error: ${error.message}`));
            process.exit(1);
          });
          
          connection.on('disconnected', () => {
            console.log(chalk.yellow('\\n📡 Peer disconnected'));
            console.log(chalk.blue('Digital sovereignty preserved! ✊'));
            process.exit(0);
          });
          
          // Start connection using connect-to-peer instead of announce
          await connection.connectToPeer(peerId);
          
          process.on('SIGINT', async () => {
            console.log(chalk.yellow('\\n📡 Disconnecting from peer...'));
            await connection.close();
            console.log(chalk.blue('Digital sovereignty preserved! ✊'));
            process.exit(0);
          });
          
        } catch (error) {
          spinner.fail('Connection failed');
          console.log(chalk.red(`Failed to connect: ${error.message}`));
          process.exit(1);
        }
        
      } else if (authResult.action === 'modify') {
        console.log(chalk.yellow('\\n📝 Counter-offer sent to peer'));
        console.log(chalk.blue('Waiting for peer response to trade modification...'));
      } else {
        console.log(chalk.red('\\n❌ Connection rejected'));
        console.log(chalk.yellow('Try another freedom fighter: backup-peer browse'));
      }
      
    } catch (error) {
      console.error(chalk.red('Connection to sovereign peer failed:'), error.message);
    }
  });

// TUI command - launch terminal user interface
program
  .command('ui')
  .description('Launch interactive Terminal User Interface')
  .action(async () => {
    try {
      console.log(chalk.blue('Starting BackupPeer TUI...'));
      
      const tui = new BackupPeerTUI();
      await tui.run();
      
    } catch (error) {
      console.error(chalk.red('TUI failed to start:'), error.message);
      process.exit(1);
    }
  });

// Helper functions for service management
async function startService() {
  const { spawn } = require('child_process');
  const servicePath = path.join(__dirname, 'service.js');
  
  console.log(chalk.blue('Starting BackupPeer service...'));
  
  const service = spawn('node', [servicePath], {
    detached: true,
    stdio: 'ignore'
  });
  
  service.unref();
  
  // Wait for service to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if service started successfully
  const ServiceClient = require('./service-client');
  const client = new ServiceClient();
  try {
    await client.connect();
    console.log(chalk.green('✓ BackupPeer service started successfully'));
  } catch (error) {
    console.error(chalk.red('Failed to start service:'), error.message);
  } finally {
    client.close();
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.join(' ') || '< 1m';
}

function getStatusIcon(status) {
  const icons = {
    'active': '🟢',
    'paused': '🟡',
    'error': '🔴',
    'completed': '✅',
    'cancelled': '❌',
    'initializing': '🔵'
  };
  return icons[status] || '⚪';
}

function createProgressBar(progress) {
  const width = 30;
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'-'.repeat(empty)}] ${progress}`;
}

function displayBackupProgress(progress) {
  console.log(chalk.blue(`Backup Progress: ${progress.backupId}`));
  console.log(chalk.gray('═'.repeat(60)));
  console.log(`Status: ${getStatusIcon(progress.status)} ${progress.status}`);
  console.log(`Progress: ${createProgressBar(progress.progress)}%`);
  console.log(`Current File: ${progress.currentFile || 'N/A'}`);
  console.log(`Files: ${progress.completedFiles}/${progress.totalFiles}`);
  console.log(`Data: ${formatBytes(progress.bytesTransferred)}/${formatBytes(progress.totalBytes)}`);
  console.log(`Started: ${new Date(progress.startTime).toLocaleString()}`);
  
  if (progress.isPaused) {
    console.log(chalk.yellow('\n⏸️  Backup is paused'));
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

async function watchBackupProgress(client, backupId) {
  const updateInterval = setInterval(async () => {
    try {
      const progress = await client.sendCommand('get_progress', { backupId });
      
      // Clear console and redraw
      console.clear();
      displayBackupProgress(progress);
      
      if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
        clearInterval(updateInterval);
        console.log(chalk.green('\n✅ Backup finished!'));
      }
      
    } catch (error) {
      clearInterval(updateInterval);
      console.error(chalk.red('Lost connection to service'));
    }
  }, 1000);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(updateInterval);
    console.log(chalk.yellow('\nStopped watching (backup continues in background)'));
    process.exit(0);
  });
}

program.parse();

// Handle SIGINT gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\nShutting down gracefully...'));
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled rejection:'), reason);
  process.exit(1);
});
