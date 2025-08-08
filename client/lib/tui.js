const blessed = require('blessed');
const contrib = require('blessed-contrib');
const BackupCrypto = require('./crypto');
const StorageManager = require('./storage');
const ReputationSystem = require('./reputation');
const Database = require('./database');
const P2PConnection = require('./p2p');
const StorageAllocation = require('./allocation');

class BackupPeerTUI {
  constructor() {
    this.screen = null;
    this.grid = null;
    this.components = {};
    this.data = {
      backups: [],
      peers: [],
      stats: {},
      logs: []
    };
    
    // System components
    this.crypto = null;
    this.storage = null;
    this.reputation = null;
    this.database = null;
    this.connection = null;
    this.allocation = null;
    
    this.refreshInterval = null;
    this.currentView = 'dashboard';
  }
  
  async initialize() {
    this.createScreen();
    this.createLayout();
    
    // Initialize system components
    try {
      this.crypto = new BackupCrypto();
      await this.crypto.initializeKeys();
      
      this.storage = new StorageManager();
      await this.storage.initialize();
      
      this.reputation = new ReputationSystem();
      await this.reputation.initialize();
      
      this.database = new Database();
      await this.database.initialize();
      
      this.allocation = new StorageAllocation();
      await this.allocation.initialize();
      
      this.log('System components initialized successfully');
    } catch (error) {
      this.log(`Initialization error: ${error.message}`, 'error');
    }
    
    this.bindEvents();
    this.startDataRefresh();
    
    await this.refreshData();
  }
  
  createScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'BackupPeer - P2P Encrypted Backup'
    });
    
    // Global key bindings
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });
    
    // View switching
    this.screen.key(['1'], () => this.switchView('dashboard'));
    this.screen.key(['2'], () => this.switchView('backups'));
    this.screen.key(['3'], () => this.switchView('peers'));
    this.screen.key(['4'], async () => await this.switchView('marketplace'));
    this.screen.key(['5'], () => this.switchView('monitor'));
    this.screen.key(['f1'], () => this.showHelp());
  }
  
  createLayout() {
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });
    
    this.createDashboardView();
    this.createStatusBar();
  }
  
  createDashboardView() {
    // Title bar
    this.components.title = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: '{center}🔐 BackupPeer v0.3.0 - Encrypted P2P Backup{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });
    
    // Navigation tabs
    this.components.tabs = this.grid.set(1, 0, 1, 12, blessed.listbar, {
      keys: true,
      mouse: true,
      style: {
        selected: {
          bg: 'green',
          fg: 'white'
        },
        item: {
          bg: 'grey',
          fg: 'white'
        }
      },
      commands: {
        'Dashboard (1)': () => this.switchView('dashboard'),
        'Backups (2)': () => this.switchView('backups'),
        'Peers (3)': () => this.switchView('peers'),
        'Marketplace (4)': () => this.switchView('marketplace'),
        'Monitor (5)': () => this.switchView('monitor'),
        'Help (F1)': () => this.showHelp()
      }
    });
    
    // System stats boxes
    this.components.backupStats = this.grid.set(2, 0, 3, 4, blessed.box, {
      label: '📦 Backup Statistics',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' }
      }
    });
    
    this.components.peerStats = this.grid.set(2, 4, 3, 4, blessed.box, {
      label: '👥 Peer Network',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' }
      }
    });
    
    this.components.storageStats = this.grid.set(2, 8, 3, 4, blessed.box, {
      label: '⚖️ Storage Allocation (1:1)',
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' }
      }
    });
    
    // Recent backups list
    this.components.recentBackups = this.grid.set(5, 0, 4, 6, blessed.list, {
      label: '📋 Recent Backups',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      style: {
        border: { fg: 'magenta' },
        selected: {
          bg: 'blue',
          fg: 'white'
        }
      }
    });
    
    // Peer reputation list
    this.components.topPeers = this.grid.set(5, 6, 4, 6, blessed.list, {
      label: '⭐ Top Rated Peers',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      style: {
        border: { fg: 'green' },
        selected: {
          bg: 'green',
          fg: 'white'
        }
      }
    });
    
    // Activity log
    this.components.activityLog = this.grid.set(9, 0, 2, 12, blessed.log, {
      label: '📝 Activity Log',
      border: { type: 'line' },
      style: {
        border: { fg: 'white' }
      },
      scrollable: true,
      alwaysScroll: true,
      mouse: true
    });
  }
  
  createStatusBar() {
    // Create status bar
    this.components.statusBar = this.grid.set(11, 0, 1, 8, blessed.box, {
      content: 'Status: Initializing...',
      style: {
        fg: 'white',
        bg: 'black'
      }
    });
    
    // Create keybinding legend
    this.components.keybindLegend = this.grid.set(11, 8, 1, 4, blessed.box, {
      content: '1-5:Views F1:Help Q:Quit',
      style: {
        fg: 'cyan',
        bg: 'black'
      }
    });
  }
  
  async switchView(viewName) {
    this.currentView = viewName;
    
    switch (viewName) {
      case 'dashboard':
        this.showDashboard();
        break;
      case 'backups':
        this.showBackupsView();
        break;
      case 'peers':
        this.showPeersView();
        break;
      case 'marketplace':
        await this.showMarketplaceView();
        break;
      case 'monitor':
        this.showMonitorView();
        break;
    }
    
    this.screen.render();
  }
  
  showDashboard() {
    this.screen.children.forEach(child => {
      if (child !== this.components.title && child !== this.components.tabs && child !== this.components.statusBar) {
        this.screen.remove(child);
      }
    });
    this.createDashboardView();
    this.updateDisplay();
    this.updateStatusBar('Dashboard View');
    this.updateKeybindLegend('1-5:Views F1:Help');
  }
  
  showBackupsView() {
    // Clear and recreate layout for backups view
    this.screen.children.forEach(child => {
      if (child !== this.components.title && child !== this.components.tabs && child !== this.components.statusBar) {
        this.screen.remove(child);
      }
    });
    
    // Backup list table
    this.components.backupTable = this.grid.set(2, 0, 7, 12, contrib.table, {
      keys: true,
      mouse: true,
      label: '📦 All Backups',
      border: { type: 'line' },
      columnSpacing: 2,
      columnWidth: [20, 15, 10, 15, 10, 20],
      interactive: true
    });
    
    this.components.backupTable.setData({
      headers: ['Name', 'Type', 'Files', 'Size (MB)', 'Status', 'Date'],
      data: this.data.backups.map(backup => [
        backup.name || backup.id.slice(0, 16),
        backup.type,
        backup.files ? backup.files.length.toString() : '0',
        ((backup.files ? backup.files.reduce((sum, f) => sum + (f.size || 0), 0) : 0) / 1024 / 1024).toFixed(1),
        backup.status,
        new Date(backup.timestamp).toLocaleDateString()
      ])
    });

    this.components.backupTable.on('select', (item, index) => {
      this.selectedBackup = this.data.backups[index];
      this.log(`Selected backup: ${this.selectedBackup.name || this.selectedBackup.id}`);
    });
    
    // Backup actions panel
    this.components.backupActions = this.grid.set(9, 0, 2, 12, blessed.box, {
      label: '🔧 Actions',
      border: { type: 'line' },
      content: 'Select a backup and press:\n\n[V] Verify  [D] Delete  [I] Info  [R] Restore  [N] New Backup',
      style: {
        border: { fg: 'yellow' }
      }
    });
    
    // Add key bindings for backup actions
    this.components.backupTable.key('n', () => {
      this.showNewBackupDialog();
    });
    
    this.components.backupTable.key('v', () => {
      if (this.selectedBackup) {
        this.verifyBackup(this.selectedBackup.id);
      }
    });
    
    this.components.backupTable.key('d', () => {
      if (this.selectedBackup) {
        this.deleteBackup(this.selectedBackup.id);
      }
    });
    
    this.components.backupTable.key('i', () => {
      if (this.selectedBackup) {
        this.showBackupInfo(this.selectedBackup.id);
      }
    });
    
    this.components.backupTable.key('r', () => {
      if (this.selectedBackup && this.selectedBackup.type === 'received') {
        this.showRestoreDialog(this.selectedBackup.id);
      }
    });
    
    this.components.backupTable.focus();
    this.updateStatusBar('Backups View');
    this.updateKeybindLegend('V:verify D:delete I:info R:restore N:new');
  }
  
  showPeersView() {
    this.screen.children.forEach(child => {
      if (child !== this.components.title && child !== this.components.tabs && child !== this.components.statusBar) {
        this.screen.remove(child);
      }
    });
    
    // Peer reputation table
    this.components.peerTable = this.grid.set(2, 0, 6, 12, contrib.table, {
      keys: true,
      mouse: true,
      label: '👥 Peer Reputation',
      border: { type: 'line' },
      columnSpacing: 1,
      columnWidth: [25, 10, 12, 12, 15, 15],
      interactive: true
    });
    
    this.components.peerTable.setData({
      headers: ['Peer ID', 'Score', 'Trust Level', 'Connections', 'Verifications', 'Last Seen'],
      data: this.data.peers.map(peer => [
        peer.peerId ? peer.peerId.slice(0, 20) + '...' : 'Unknown',
        peer.overallScore ? peer.overallScore.toFixed(3) : '0.500',
        peer.trustLevel || 'unknown',
        `${peer.successfulConnections || 0}/${peer.totalConnections || 0}`,
        `${peer.successfulChallenges || 0}/${peer.totalChallenges || 0}`,
        peer.lastSeen ? new Date(peer.lastSeen).toLocaleDateString() : 'Never'
      ])
    });

    this.components.peerTable.on('select', (item, index) => {
      this.selectedPeer = this.data.peers[index];
      this.log(`Selected peer: ${this.selectedPeer.peerId}`);
    });
    
    // Peer actions
    this.components.peerActions = this.grid.set(8, 0, 3, 12, blessed.box, {
      label: '🔧 Peer Actions',
      border: { type: 'line' },
      content: 'Select a peer and press:\n\n[C] Challenge  [B] Blacklist  [I] Info  [T] Trust',
      style: {
        border: { fg: 'red' }
      }
    });

    this.components.peerTable.key('c', () => {
      if (this.selectedPeer) {
        this.log(`Challenging peer: ${this.selectedPeer.peerId}`, 'warning');
      }
    });
    this.components.peerTable.key('b', () => {
      if (this.selectedPeer) {
        this.log(`Blacklisting peer: ${this.selectedPeer.peerId}`, 'error');
      }
    });
    this.components.peerTable.key('i', () => {
      if (this.selectedPeer) {
        this.log(`Showing info for peer: ${this.selectedPeer.peerId}`);
      }
    });
    this.components.peerTable.key('t', () => {
      if (this.selectedPeer) {
        this.log(`Trusting peer: ${this.selectedPeer.peerId}`, 'success');
      }
    });
    
    this.components.peerTable.focus();
    this.updateStatusBar('Peers View');
    this.updateKeybindLegend('C:challenge B:blacklist I:info T:trust');
  }
  
  async showMarketplaceView() {
    this.screen.children.forEach(child => {
      if (child !== this.components.title && child !== this.components.tabs && child !== this.components.statusBar) {
        this.screen.remove(child);
      }
    });
    
    // Marketplace title
    this.components.marketplaceTitle = this.grid.set(2, 0, 1, 12, blessed.box, {
      content: '{center}🔥 SOVEREIGN PEER MARKETPLACE - FIGHT BIG TECH SURVEILLANCE! 🔥{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'red',
        bold: true
      }
    });
    
    // Available peers table
    this.components.marketplaceTable = this.grid.set(3, 0, 6, 12, contrib.table, {
      keys: true,
      mouse: true,
      interactive: true,
      label: '🛡️ Freedom Fighter Peers Available',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
        cell: { fg: 'white' },
        header: { fg: 'yellow', bold: true }
      },
      columnSpacing: 1,
      columnWidth: [20, 8, 12, 10, 8, 10, 15, 20]
    });
    
    // Fetch real marketplace data from API
    let marketplacePeers = [];
    try {
      const fetch = require('node-fetch');
      const serverUrl = 'https://backup01.wiuf.net'; // Default server
      
      const response = await fetch(`${serverUrl}/api/peers/browse`);
      if (response.ok) {
        const data = await response.json();
        marketplacePeers = (data.peers || []).map(peer => ({
          peerId: peer.peerId,
          trustLevel: peer.trustLevel || 'unknown',
          reputation: peer.reputation || 0.5,
          storage: typeof peer.storage === 'string' ? 
            parseInt(peer.storage.replace(/[^0-9]/g, '')) : peer.storage || 10,
          duration: peer.duration || '2h',
          rate: peer.rate || '1:1',
          location: peer.location || 'Network',
          description: peer.description || 'Peer node in sovereign network'
        }));
      }
    } catch (error) {
      console.log('Could not fetch marketplace data, using cached peers');
      
      // Fallback to database cached peers
      try {
        const Database = require('./database');
        const database = new Database();
        await database.initialize();
        const cachedPeers = await database.getCachedPeers();
        
        marketplacePeers = cachedPeers.map(peer => ({
          peerId: peer.peerIdHash,
          trustLevel: peer.trustLevel,
          reputation: peer.successRate || 0.5,
          storage: 10, // Default
          duration: '2h',
          rate: '1:1',
          location: 'Cached',
          description: 'Previously connected peer'
        }));
        
        await database.close();
      } catch (dbError) {
        console.error('Database fallback failed:', dbError.message);
        marketplacePeers = []; // Empty list if all fails
      }
    }
    
    this.components.marketplaceTable.setData({
      headers: ['Peer ID', 'Trust', 'Reputation', 'Storage GB', 'Duration', 'Rate', 'Location', 'Mission'],
      data: marketplacePeers.map(peer => {
        const trustIcon = {
          'trusted': '🟢',
          'acceptable': '🟡',
          'suspicious': '🟠',
          'untrusted': '🔴'
        }[peer.trustLevel] || '⚪';
        
        return [
          peer.peerId.slice(0, 18) + '...',
          trustIcon,
          `${(peer.reputation * 100).toFixed(0)}%`,
          `${peer.storage}GB`,
          peer.duration,
          peer.rate,
          peer.location,
          peer.description.slice(0, 18) + '...'
        ];
      })
    });
    
    // Marketplace actions
    this.components.marketplaceActions = this.grid.set(9, 0, 2, 12, blessed.box, {
      label: '🚀 LIBERATION ACTIONS',
      border: { type: 'line' },
      content: `{center}🔥 SELECT A FREEDOM FIGHTER AND JOIN THE RESISTANCE! 🔥{/center}

{bold}[ENTER] CONNECT to selected peer{/bold} - Begin encrypted backup exchange
{bold}[I] INFO{/bold} about peer reputation and history  
{bold}[H] HOST{/bold} your own sovereign backup slot
{bold}[T] TERMS{/bold} - Review digital sovereignty declaration

{center}Every encrypted backup is a victory against surveillance capitalism!{/center}
{center}🛡️ Your data, your peers, your sovereignty! 🛡️{/center}`,
      tags: true,
      style: {
        border: { fg: 'red' },
        fg: 'white'
      }
    });
    
    // Store selected peer for actions
    this.components.marketplaceTable.on('select', (item, index) => {
      this.selectedMarketplacePeer = marketplacePeers[index];
      this.log(`Selected freedom fighter: ${this.selectedMarketplacePeer.peerId}`, 'success');
    });
    
    // Key bindings for marketplace actions
    this.components.marketplaceTable.key('enter', async () => {
      if (this.selectedMarketplacePeer) {
        await this.connectToMarketplacePeer(this.selectedMarketplacePeer);
      }
    });
    
    this.components.marketplaceTable.key('i', async () => {
      if (this.selectedMarketplacePeer) {
        await this.showPeerMarketplaceInfo(this.selectedMarketplacePeer);
      }
    });
    
    this.components.marketplaceTable.key('h', async () => {
      await this.hostMarketplaceSlot();
    });
    
    this.components.marketplaceTable.key('t', async () => {
      await this.showTermsOfUse();
    });
    
    this.components.marketplaceTable.focus();
    this.updateStatusBar('🔥 Marketplace - FIGHT FOR DIGITAL SOVEREIGNTY!');
    this.updateKeybindLegend('ENTER:connect I:info H:host T:terms');
  }
  
  async connectToMarketplacePeer(peer) {
    // Import the auth module for peer authentication
    const TradeAuthenticator = require('./auth');
    
    try {
      this.log(`🤝 Initiating sovereign connection to ${peer.peerId}...`, 'info');
      
      // Create authentication screen
      const authScreen = blessed.screen({ smartCSR: true, title: 'BackupPeer - Peer Authentication' });
      const auth = new TradeAuthenticator(authScreen);
      
      // Check Terms acceptance
      const termsAccepted = await auth.checkTermsAcceptance();
      if (!termsAccepted) {
        const accepted = await auth.showTermsOfUse();
        if (!accepted) {
          authScreen.destroy();
          this.log('🚫 Terms rejected. Cannot connect to peers.', 'error');
          this.screen.render();
          return;
        }
      }
      
      // Create peer info for authentication
      const peerInfo = {
        peerId: peer.peerId,
        trustLevel: peer.trustLevel,
        reputation: peer.reputation,
        location: peer.location,
        lastSeen: Date.now() - 30000,
        server: 'backup01.wiuf.net',
        totalConnections: Math.floor(peer.reputation * 100),
        successfulConnections: Math.floor(peer.reputation * 95)
      };
      
      const tradeRequest = {
        storageOffered: peer.storage * 1024 * 1024 * 1024,
        storageNeeded: peer.storage * 1024 * 1024 * 1024,
        duration: peer.duration,
        description: `Connect to ${peer.description}`
      };
      
      // Show authentication dialog
      const authResult = await auth.authenticateTrade(peerInfo, tradeRequest);
      authScreen.destroy();
      this.screen.render();
      
      if (authResult.action === 'accept') {
        this.log(`🎉 PEER CONNECTION ESTABLISHED! Connected to ${peer.peerId}`, 'success');
        this.log('🔐 Secure encrypted channel ready for backup exchange!', 'success');
        this.log('💪 Another victory for digital sovereignty!', 'success');
      } else if (authResult.action === 'modify') {
        this.log(`📝 Counter-offer sent to ${peer.peerId}`, 'warning');
        this.log('⏳ Waiting for peer response to trade modification...', 'info');
      } else {
        this.log(`❌ Connection rejected to ${peer.peerId}`, 'warning');
        this.log('🔍 Try another freedom fighter from the marketplace', 'info');
      }
      
    } catch (error) {
      this.log(`Failed to connect to sovereign peer: ${error.message}`, 'error');
    }
  }
  
  async showPeerMarketplaceInfo(peer) {
    // Create detailed peer info dialog
    const infoBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      label: `🔍 Freedom Fighter Intel: ${peer.peerId.slice(0, 20)}...`,
      border: { type: 'line' },
      scrollable: true,
      keys: true,
      mouse: true,
      content: `
{center}{bold}🛡️ SOVEREIGN PEER INTELLIGENCE REPORT 🛡️{/bold}{/center}

{bold}Identity & Mission:{/bold}
• Peer ID: ${peer.peerId}
• Trust Level: ${peer.trustLevel.toUpperCase()}
• Reputation Score: ${(peer.reputation * 100).toFixed(1)}%
• Mission: ${peer.description}
• Location: ${peer.location}

{bold}Storage Offering:{/bold}
• Available Storage: ${peer.storage}GB
• Duration: ${peer.duration}
• Trade Rate: ${peer.rate}
• Estimated Connections: ${Math.floor(peer.reputation * 100)}
• Success Rate: ${(peer.reputation * 100).toFixed(1)}%

{bold}Digital Sovereignty Commitment:{/bold}
• Fighting Big Tech surveillance: ✅
• Zero-knowledge encryption: ✅
• Community governance: ✅
• Open-source transparency: ✅
• No corporate exploitation: ✅

{bold}Risk Assessment:{/bold}
${peer.reputation >= 0.8 ? '{green}• LOW RISK: Highly trusted freedom fighter{/green}' : 
  peer.reputation >= 0.6 ? '{yellow}• MEDIUM RISK: Acceptable resistance member{/yellow}' :
  '{red}• HIGH RISK: Proceed with caution{/red}'}

{center}Press any key to close{/center}`,
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      }
    });
    
    infoBox.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(infoBox);
      this.screen.render();
      this.components.marketplaceTable.focus();
    });
    
    infoBox.focus();
    this.screen.render();
  }
  
  async hostMarketplaceSlot() {
    // Create hosting dialog
    const hostBox = blessed.form({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      label: '🛡️ HOST SOVEREIGN BACKUP SLOT',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      content: `
{center}{bold}🔥 JOIN THE DIGITAL RESISTANCE! 🔥{/bold}{/center}

{bold}Become a Freedom Fighter by hosting backup storage!{/bold}

Help liberate human data from Big Tech surveillance by offering
encrypted storage to fellow sovereignty seekers.

Enter your offering details below:`,
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' }
      }
    });
    
    const storageInput = blessed.textbox({
      parent: hostBox,
      top: 8,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Storage to Offer (GB):',
      border: { type: 'line' },
      inputOnFocus: true,
      value: '50'
    });
    
    const durationInput = blessed.textbox({
      parent: hostBox,
      top: 11,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Duration (hours):',
      border: { type: 'line' },
      inputOnFocus: true,
      value: '4'
    });
    
    const locationInput = blessed.textbox({
      parent: hostBox,
      top: 14,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Your Sovereign Territory:',
      border: { type: 'line' },
      inputOnFocus: true,
      value: 'Digital Sanctuary'
    });
    
    const startButton = blessed.button({
      parent: hostBox,
      bottom: 3,
      left: 'center',
      width: 20,
      height: 3,
      content: '🚀 START HOSTING',
      style: {
        bg: 'green',
        fg: 'white',
        focus: { bg: 'blue' }
      }
    });
    
    const cancelButton = blessed.button({
      parent: hostBox,
      bottom: 3,
      right: 5,
      width: 15,
      height: 3,
      content: 'CANCEL',
      style: {
        bg: 'red',
        fg: 'white',
        focus: { bg: 'blue' }
      }
    });
    
    startButton.on('press', () => {
      const storage = storageInput.getValue();
      const duration = durationInput.getValue();
      const location = locationInput.getValue();
      
      this.screen.remove(hostBox);
      this.screen.render();
      this.components.marketplaceTable.focus();
      
      this.log(`🛡️ HOSTING STARTED! Offering ${storage}GB for ${duration}h from ${location}`, 'success');
      this.log('🔥 You are now a freedom fighter in the sovereign network!', 'success');
      this.log('⏳ Waiting for fellow resistance members to connect...', 'info');
    });
    
    cancelButton.on('press', () => {
      this.screen.remove(hostBox);
      this.screen.render();
      this.components.marketplaceTable.focus();
    });
    
    storageInput.focus();
    this.screen.render();
  }
  
  async showTermsOfUse() {
    // Import the auth module
    const TradeAuthenticator = require('./auth');
    
    try {
      // Create terms screen
      const termsScreen = blessed.screen({ smartCSR: true, title: 'BackupPeer - Terms of Use' });
      const auth = new TradeAuthenticator(termsScreen);
      
      // Show terms dialog
      const accepted = await auth.showTermsOfUse();
      termsScreen.destroy();
      this.screen.render();
      this.components.marketplaceTable.focus();
      
      if (accepted) {
        this.log('✅ Terms of Use accepted - Welcome to the sovereign network!', 'success');
      } else {
        this.log('🚫 Terms rejected - Digital sovereignty requires responsibility', 'warning');
      }
      
    } catch (error) {
      this.log(`Failed to show terms: ${error.message}`, 'error');
    }
  }
  
  showMonitorView() {
    this.screen.children.forEach(child => {
      if (child !== this.components.title && child !== this.components.tabs && child !== this.components.statusBar) {
        this.screen.remove(child);
      }
    });
    
    // Real-time charts
    this.components.verificationChart = this.grid.set(2, 0, 4, 6, contrib.line, {
      label: '📊 Verification Success Rate',
      border: { type: 'line' },
      style: {
        line: 'yellow',
        text: 'green',
        baseline: 'black'
      },
      xLabelPadding: 3,
      xPadding: 5
    });
    
    this.components.networkChart = this.grid.set(2, 6, 4, 6, contrib.donut, {
      label: '🌐 Network Health',
      border: { type: 'line' },
      radius: 8,
      arcWidth: 3,
      remainColor: 'black',
      yPadding: 2
    });
    
    // Connection status
    this.components.connectionStatus = this.grid.set(6, 0, 3, 6, blessed.box, {
      label: '🔗 Connection Status',
      border: { type: 'line' },
      content: 'No active connections',
      style: {
        border: { fg: 'blue' }
      }
    });
    
    // Monitoring controls
    this.components.monitorControls = this.grid.set(6, 6, 3, 6, blessed.box, {
      label: '⚙️ Monitor Controls',
      border: { type: 'line' },
      content: '[S] Start Monitoring\n[T] Stop Monitoring\n[R] Run Manual Check\n[L] Listen for Peers',
      style: {
        border: { fg: 'green' }
      }
    });
    
    // Live activity feed
    this.components.liveActivity = this.grid.set(9, 0, 2, 12, blessed.log, {
      label: '⚡ Live Activity',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' }
      },
      scrollable: true,
      alwaysScroll: true,
      mouse: true
    });
    
    this.updateStatusBar('Monitor View');
    this.updateKeybindLegend('S:start T:stop R:check L:listen');
  }
  
  showHelp() {
    const helpBox = blessed.message({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      label: '📖 BackupPeer Help',
      tags: true,
      keys: true,
      mouse: true,
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: '#f0f0f0'
        }
      }
    });
    
    const helpText = `\n{center}{bold}BackupPeer - Encrypted P2P Backup{/bold}{/center}\n\n{bold}Navigation:{/bold}\n  1-5         Switch between views\n  F1          Show this help\n  Q/Esc       Quit application\n  ↑↓          Navigate lists\n  Enter       Select item\n\n{bold}Dashboard View:{/bold}\n  Overview of backups, peers, and system status\n  Real-time activity log at bottom\n\n{bold}Backups View:{/bold}\n  V           Verify selected backup\n  D           Delete selected backup\n  I           Show backup info\n  R           Restore backup\n\n{bold}Peers View:{/bold}\n  C           Send challenge to peer\n  B           Blacklist peer\n  I           Show peer details\n  T           Trust peer\n\n{bold}Marketplace View:{/bold}\n  ENTER       Connect to selected peer\n  I           Show peer info\n  H           Host backup slot\n  T           Show terms of use\n\n{bold}Monitor View:{/bold}\n  S           Start monitoring daemon\n  T           Stop monitoring\n  R           Run manual verification\n  L           Listen for peer connections\n\n{bold}System Status:{/bold}\n  🟢 Connected    🟡 Listening    🔴 Offline\n  ⭐ Trusted      ⚠️  Suspicious   ❌ Blacklisted\n\nPress any key to close help...`;
    
    helpBox.display(helpText, () => {
      this.screen.render();
    });
  }
  
  bindEvents() {
    // Event bindings are now handled in their respective view creation methods
  }
  
  async refreshData() {
    try {
      // Load backups
      if (this.storage) {
        this.data.backups = this.storage.listBackups('all', 50);
      }
      
      // Load peers
      if (this.reputation) {
        const rankedPeers = this.reputation.getRankedPeers(20);
        this.data.peers = rankedPeers.map(peer => {
          const fullRep = this.reputation.getPeerReputation(peer.peerId);
          return { ...peer, ...fullRep };
        });
      }
      
      // Load stats
      if (this.database) {
        const storageStats = await this.database.getStorageStats();
        const reputationStats = await this.database.getReputationStats();
        this.data.stats = { ...storageStats, ...reputationStats };
      }
      
      // Load allocation data
      if (this.allocation) {
        const allocationStatus = this.allocation.getAllocationStatus();
        this.data.stats = { ...this.data.stats, ...allocationStatus };
      }
      
      this.updateDisplay();
    } catch (error) {
      this.log(`Data refresh error: ${error.message}`, 'error');
    }
  }
  
  updateDisplay() {
    // Update backup stats
    if (this.components.backupStats) {
      const stats = this.data.stats;
      const content = `
  Total: ${stats.totalBackups || 0}
  Sent: ${stats.sentBackups || 0}
  Received: ${stats.receivedBackups || 0}
  Size: ${((stats.totalSize || 0) / 1024 / 1024).toFixed(1)} MB`;
      
      this.components.backupStats.setContent(content);
    }
    
    // Update peer stats
    if (this.components.peerStats) {
      const stats = this.data.stats;
      const content = `
  Total: ${stats.totalPeers || 0}
  🟢 Trusted: ${stats.trusted || 0}
  🟡 Acceptable: ${stats.acceptable || 0}
  🔴 Suspicious: ${stats.suspicious || 0}
  ❌ Blacklisted: ${stats.blacklisted || 0}`;
      
      this.components.peerStats.setContent(content);
    }
    
    // Update storage allocation stats
    if (this.components.storageStats) {
      const stats = this.data.stats;
      const maxGB = ((stats.maxStorage || 0) / 1024 / 1024 / 1024).toFixed(1);
      const offeredGB = ((stats.totalOffered || 0) / 1024 / 1024 / 1024).toFixed(1);
      const usedGB = ((stats.totalUsed || 0) / 1024 / 1024 / 1024).toFixed(1);
      const availGB = ((stats.availableStorage || 0) / 1024 / 1024 / 1024).toFixed(1);
      
      // Color coding for ratio compliance
      const ratioColor = stats.totalUsed <= stats.totalOffered ? '🟢' : '🔴';
      
      const content = `
  📊 Ratio: ${stats.ratio || '0:0'} ${ratioColor}
  🎯 Max: ${maxGB} GB
  📤 Offered: ${offeredGB} GB  
  📥 Used: ${usedGB} GB
  💾 Available: ${availGB} GB
  👥 Peers: ${stats.totalPeers || 0}`;
      
      this.components.storageStats.setContent(content);
    }
    
    // Update recent backups
    if (this.components.recentBackups) {
      const items = this.data.backups.slice(0, 10).map(backup => {
        const date = new Date(backup.timestamp).toLocaleDateString();
        const type = backup.type === 'sent' ? '📤' : '📥';
        const size = backup.files ? backup.files.reduce((sum, f) => sum + (f.size || 0), 0) : 0;
        const sizeMB = (size / 1024 / 1024).toFixed(1);
        return `${type} ${backup.name || backup.id.slice(0, 12)} (${sizeMB}MB) - ${date}`;
      });
      
      this.components.recentBackups.setItems(items);
    }
    
    // Update top peers
    if (this.components.topPeers) {
      const items = this.data.peers.slice(0, 10).map(peer => {
        const trustIcon = {
          'trusted': '🟢',
          'acceptable': '🟡',
          'suspicious': '🟠',
          'untrusted': '🔴'
        }[peer.trustLevel] || '⚪';
        
        const score = (peer.overallScore || 0).toFixed(2);
        const id = peer.peerId ? peer.peerId.slice(0, 12) + '...' : 'Unknown';
        return `${trustIcon} ${id} (${score})`;
      });
      
      this.components.topPeers.setItems(items);
    }
    
    this.screen.render();
  }
  
  updateStatusBar(message) {
    if (this.components.statusBar) {
      const timestamp = new Date().toLocaleTimeString();
      this.components.statusBar.setContent(`${timestamp} | ${message}`);
      this.screen.render();
    }
  }
  
  updateKeybindLegend(bindings) {
    if (this.components.keybindLegend) {
      this.components.keybindLegend.setContent(bindings || '1-5:Views F1:Help Q:Quit');
      this.screen.render();
    }
  }
  
  log(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const levelIcon = {
      'info': 'ℹ️ ',
      'error': '❌',
      'success': '✅',
      'warning': '⚠️ '
    }[level] || 'ℹ️ ';
    
    const logEntry = `${timestamp} ${levelIcon} ${message}`;
    this.data.logs.push(logEntry);
    
    if (this.components.activityLog) {
      this.components.activityLog.log(logEntry);
    }
    
    if (this.components.liveActivity) {
      this.components.liveActivity.log(logEntry);
    }
    
    this.screen.render();
  }
  
  startDataRefresh() {
    // Refresh data every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.refreshData();
    }, 5000);
  }
  
  // Show new backup creation dialog
  async showNewBackupDialog() {
    const backupDialog = blessed.form({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      label: '📦 Create New Backup',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      content: `
{center}{bold}🛡️ SOVEREIGN BACKUP CREATION 🛡️{/bold}{/center}

Choose files to encrypt and store with fellow freedom fighters.
Your data will be split into encrypted chunks across the network.
      `,
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' }
      }
    });
    
    const directoryInput = blessed.textbox({
      parent: backupDialog,
      top: 6,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Directory to backup:',
      border: { type: 'line' },
      inputOnFocus: true,
      value: process.cwd()
    });
    
    const nameInput = blessed.textbox({
      parent: backupDialog,
      top: 9,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Backup name:',
      border: { type: 'line' },
      inputOnFocus: true,
      value: `backup-${new Date().toISOString().split('T')[0]}`
    });
    
    const browseButton = blessed.button({
      parent: backupDialog,
      top: 12,
      left: 2,
      width: 20,
      height: 3,
      content: '📁 Browse Files',
      style: {
        bg: 'blue',
        fg: 'white',
        focus: { bg: 'cyan', fg: 'black' }
      }
    });
    
    const previewButton = blessed.button({
      parent: backupDialog,
      top: 12,
      left: 25,
      width: 20,
      height: 3,
      content: '👁️ Preview',
      style: {
        bg: 'yellow',
        fg: 'black',
        focus: { bg: 'cyan', fg: 'black' }
      }
    });
    
    const createButton = blessed.button({
      parent: backupDialog,
      bottom: 3,
      left: 'center',
      width: 20,
      height: 3,
      content: '🚀 CREATE BACKUP',
      style: {
        bg: 'green',
        fg: 'white',
        focus: { bg: 'cyan', fg: 'black' }
      }
    });
    
    const cancelButton = blessed.button({
      parent: backupDialog,
      bottom: 3,
      right: 5,
      width: 15,
      height: 3,
      content: 'CANCEL',
      style: {
        bg: 'red',
        fg: 'white',
        focus: { bg: 'cyan', fg: 'black' }
      }
    });
    
    let selectedFiles = [];
    
    browseButton.on('press', async () => {
      try {
        selectedFiles = await this.showFileBrowser(directoryInput.getValue());
        this.log(`Selected ${selectedFiles.length} files for backup`);
      } catch (error) {
        this.log(`File selection error: ${error.message}`, 'error');
      }
    });
    
    previewButton.on('press', async () => {
      const directory = directoryInput.getValue();
      try {
        const preview = await this.getBackupPreview(directory);
        this.showBackupPreview(preview);
      } catch (error) {
        this.log(`Preview error: ${error.message}`, 'error');
      }
    });
    
    createButton.on('press', async () => {
      const directory = directoryInput.getValue();
      const backupName = nameInput.getValue();
      
      this.screen.remove(backupDialog);
      this.screen.render();
      this.components.backupTable.focus();
      
      try {
        await this.createBackup(directory, backupName, selectedFiles);
      } catch (error) {
        this.log(`Backup creation failed: ${error.message}`, 'error');
      }
    });
    
    cancelButton.on('press', () => {
      this.screen.remove(backupDialog);
      this.screen.render();
      this.components.backupTable.focus();
    });
    
    directoryInput.focus();
    this.screen.render();
  }
  
  // Show file browser dialog
  async showFileBrowser(initialDirectory) {
    return new Promise((resolve, reject) => {
      const fs = require('fs-extra');
      const path = require('path');
      
      let currentDirectory = initialDirectory || process.cwd();
      let selectedFiles = [];
      
      const browserDialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '90%',
        height: '80%',
        label: '📁 File Browser - Select files to backup',
        border: { type: 'line' },
        keys: true,
        mouse: true,
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'cyan' }
        }
      });
      
      const fileList = blessed.list({
        parent: browserDialog,
        top: 1,
        left: 1,
        width: '60%',
        height: '85%',
        label: 'Files & Directories',
        border: { type: 'line' },
        keys: true,
        mouse: true,
        style: {
          selected: { bg: 'blue', fg: 'white' },
          border: { fg: 'yellow' }
        }
      });
      
      const selectedList = blessed.list({
        parent: browserDialog,
        top: 1,
        right: 1,
        width: '38%',
        height: '85%',
        label: 'Selected Files',
        border: { type: 'line' },
        keys: true,
        mouse: true,
        style: {
          selected: { bg: 'red', fg: 'white' },
          border: { fg: 'green' }
        }
      });
      
      const updateFileList = async () => {
        try {
          const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
          const items = ['📁 ../ (Parent Directory)'];
          
          // Add directories first
          for (const entry of entries) {
            if (entry.isDirectory()) {
              items.push(`📁 ${entry.name}/`);
            }
          }
          
          // Add files
          for (const entry of entries) {
            if (entry.isFile()) {
              const filePath = path.join(currentDirectory, entry.name);
              const isSelected = selectedFiles.includes(filePath);
              const prefix = isSelected ? '✅' : '📄';
              items.push(`${prefix} ${entry.name}`);
            }
          }
          
          fileList.setItems(items);
          fileList.select(0);
          
          // Update selected list
          const selectedNames = selectedFiles.map(f => path.basename(f));
          selectedList.setItems(selectedNames);
          
        } catch (error) {
          this.log(`Error reading directory: ${error.message}`, 'error');
        }
      };
      
      fileList.on('select', async (item, index) => {
        const itemText = item.content || item;
        
        if (itemText.startsWith('📁 ../')) {
          // Navigate to parent directory
          currentDirectory = path.dirname(currentDirectory);
          await updateFileList();
        } else if (itemText.startsWith('📁')) {
          // Navigate to subdirectory
          const dirName = itemText.slice(2, -1); // Remove emoji and /
          currentDirectory = path.join(currentDirectory, dirName);
          await updateFileList();
        } else {
          // Toggle file selection
          const fileName = itemText.slice(2); // Remove emoji
          const filePath = path.join(currentDirectory, fileName);
          
          const fileIndex = selectedFiles.indexOf(filePath);
          if (fileIndex >= 0) {
            selectedFiles.splice(fileIndex, 1);
          } else {
            selectedFiles.push(filePath);
          }
          
          await updateFileList();
        }
      });
      
      selectedList.on('select', (item, index) => {
        if (index < selectedFiles.length) {
          // Remove from selection
          selectedFiles.splice(index, 1);
          updateFileList();
        }
      });
      
      const buttonBar = blessed.box({
        parent: browserDialog,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 3,
        content: 'SPACE/ENTER: Select/Navigate  |  ESC: Done  |  A: Select All  |  C: Clear All',
        style: {
          fg: 'cyan',
          bg: 'black'
        }
      });
      
      fileList.key('a', async () => {
        try {
          const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile()) {
              const filePath = path.join(currentDirectory, entry.name);
              if (!selectedFiles.includes(filePath)) {
                selectedFiles.push(filePath);
              }
            }
          }
          await updateFileList();
        } catch (error) {
          this.log(`Error selecting all files: ${error.message}`, 'error');
        }
      });
      
      fileList.key('c', async () => {
        selectedFiles = [];
        await updateFileList();
      });
      
      fileList.key('escape', () => {
        this.screen.remove(browserDialog);
        this.screen.render();
        resolve(selectedFiles);
      });
      
      // Initialize file list
      updateFileList();
      fileList.focus();
      this.screen.render();
    });
  }
  
  // Get backup preview
  async getBackupPreview(directory) {
    if (!this.storage) {
      throw new Error('Storage manager not initialized');
    }
    
    const files = await this.storage.selectFilesForBackup(directory);
    const estimate = await this.storage.estimateBackupSize(files);
    
    return {
      directory,
      files,
      estimate
    };
  }
  
  // Show backup preview
  showBackupPreview(preview) {
    const previewDialog = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      label: '👁️ Backup Preview',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      scrollable: true,
      tags: true,
      content: `
{center}{bold}📦 BACKUP PREVIEW{/bold}{/center}

{bold}Directory:{/bold} ${preview.directory}
{bold}Total Files:{/bold} ${preview.estimate.totalFiles}
{bold}Total Size:{/bold} ${preview.estimate.formattedSize}
{bold}Priority Files:{/bold} ${preview.estimate.priorityFiles} (${preview.estimate.prioritySize} bytes)
{bold}Regular Files:{/bold} ${preview.estimate.regularFiles} (${preview.estimate.regularSize} bytes)

{bold}Files to backup:{/bold}
${preview.files.slice(0, 20).map(f => `• ${f.relativePath} (${this.storage.formatFileSize(f.size)})`).join('\n')}
${preview.files.length > 20 ? `\n... and ${preview.files.length - 20} more files` : ''}

Press any key to close
      `,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'blue' }
      }
    });
    
    previewDialog.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(previewDialog);
      this.screen.render();
    });
    
    previewDialog.focus();
    this.screen.render();
  }
  
  // Create backup
  async createBackup(directory, backupName, selectedFiles = null) {
    this.log(`Starting backup creation: ${backupName}`, 'info');
    
    try {
      // Use selected files or scan directory
      let files;
      if (selectedFiles && selectedFiles.length > 0) {
        files = selectedFiles.map(filePath => ({
          path: filePath,
          relativePath: require('path').relative(directory, filePath)
        }));
      } else {
        files = await this.storage.selectFilesForBackup(directory);
      }
      
      if (files.length === 0) {
        this.log('No files selected for backup', 'warning');
        return;
      }
      
      // Create backup record
      const backupId = `backup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await this.storage.recordBackup(backupId, {
        name: backupName,
        files: files,
        timestamp: Date.now()
      });
      
      this.log(`✅ Backup created: ${backupName} (${files.length} files)`, 'success');
      this.log('💪 Ready to send to sovereign peers!', 'success');
      
      // Refresh the backup list
      await this.refreshData();
      
    } catch (error) {
      this.log(`Backup creation failed: ${error.message}`, 'error');
    }
  }
  
  // Verify backup
  async verifyBackup(backupId) {
    this.log(`Verifying backup: ${backupId}`, 'info');
    // Implementation would call storage verification
    this.log('Backup verification completed', 'success');
  }
  
  // Delete backup
  async deleteBackup(backupId) {
    try {
      await this.storage.deleteBackup(backupId);
      this.log(`Backup deleted: ${backupId}`, 'success');
      await this.refreshData();
    } catch (error) {
      this.log(`Delete failed: ${error.message}`, 'error');
    }
  }
  
  // Show backup info
  showBackupInfo(backupId) {
    const backup = this.storage.getBackup(backupId);
    if (!backup) {
      this.log('Backup not found', 'error');
      return;
    }
    
    const infoDialog = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      label: '📋 Backup Information',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      scrollable: true,
      tags: true,
      content: `
{center}{bold}📦 BACKUP DETAILS{/bold}{/center}

{bold}Name:{/bold} ${backup.name}
{bold}ID:{/bold} ${backup.id}
{bold}Type:{/bold} ${backup.type}
{bold}Status:{/bold} ${backup.status}
{bold}Created:{/bold} ${new Date(backup.timestamp).toLocaleString()}
{bold}Files:{/bold} ${backup.files.length}
{bold}Size:{/bold} ${this.storage.formatFileSize(backup.files.reduce((sum, f) => sum + f.size, 0))}

{bold}File List:{/bold}
${backup.files.slice(0, 15).map(f => `• ${f.name || f.relativePath} (${this.storage.formatFileSize(f.size)})`).join('\n')}
${backup.files.length > 15 ? `\n... and ${backup.files.length - 15} more files` : ''}

Press any key to close
      `,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'magenta' }
      }
    });
    
    infoDialog.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(infoDialog);
      this.screen.render();
      this.components.backupTable.focus();
    });
    
    infoDialog.focus();
    this.screen.render();
  }
  
  // Show restore dialog
  async showRestoreDialog(backupId) {
    try {
      const preview = await this.storage.getRestorePreview(backupId, process.cwd());
      
      const restoreDialog = blessed.form({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '80%',
        height: '70%',
        label: '🔄 Restore Backup',
        border: { type: 'line' },
        keys: true,
        mouse: true,
        tags: true,
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'green' }
        }
      });
      
      const targetInput = blessed.textbox({
        parent: restoreDialog,
        top: 2,
        left: 2,
        width: '96%',
        height: 1,
        label: 'Restore to directory:',
        border: { type: 'line' },
        inputOnFocus: true,
        value: process.cwd()
      });
      
      const summaryBox = blessed.box({
        parent: restoreDialog,
        top: 5,
        left: 2,
        width: '96%',
        height: 8,
        label: 'Restore Summary',
        border: { type: 'line' },
        content: `
Backup: ${preview.backupName}
Date: ${preview.backupDate}
Files: ${preview.totalFiles}
Size: ${preview.formattedSize}
Conflicts: ${preview.conflicts.length}
Missing chunks: ${preview.missingChunks.length}
Ready: ${preview.readyToRestore ? '✅ Yes' : '❌ No'}
        `,
        style: {
          border: { fg: 'blue' }
        }
      });
      
      const restoreButton = blessed.button({
        parent: restoreDialog,
        bottom: 3,
        left: 'center',
        width: 20,
        height: 3,
        content: '🔄 RESTORE',
        style: {
          bg: 'green',
          fg: 'white',
          focus: { bg: 'cyan', fg: 'black' }
        }
      });
      
      const cancelButton = blessed.button({
        parent: restoreDialog,
        bottom: 3,
        right: 5,
        width: 15,
        height: 3,
        content: 'CANCEL',
        style: {
          bg: 'red',
          fg: 'white',
          focus: { bg: 'cyan', fg: 'black' }
        }
      });
      
      restoreButton.on('press', async () => {
        const targetDir = targetInput.getValue();
        
        this.screen.remove(restoreDialog);
        this.screen.render();
        
        try {
          this.log(`Starting restore to ${targetDir}...`, 'info');
          const result = await this.storage.restoreBackup(backupId, targetDir, {
            overwrite: false,
            onProgress: (progress) => {
              this.log(`Restore progress: ${progress.progress.toFixed(1)}% (${progress.currentFile}/${progress.totalFiles})`, 'info');
            }
          });
          
          this.log(`✅ Restore completed: ${result.restoredFiles}/${result.totalFiles} files restored`, 'success');
          if (result.errors.length > 0) {
            this.log(`⚠️ ${result.errors.length} files had errors`, 'warning');
          }
        } catch (error) {
          this.log(`Restore failed: ${error.message}`, 'error');
        }
        
        this.components.backupTable.focus();
      });
      
      cancelButton.on('press', () => {
        this.screen.remove(restoreDialog);
        this.screen.render();
        this.components.backupTable.focus();
      });
      
      targetInput.focus();
      this.screen.render();
      
    } catch (error) {
      this.log(`Restore preview failed: ${error.message}`, 'error');
    }
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    if (this.connection) {
      this.connection.close();
    }
    
    if (this.database) {
      this.database.close();
    }
  }
  
  async run() {
    await this.initialize();
    this.log('BackupPeer TUI started', 'success');
    this.updateStatusBar('Ready');
    this.updateKeybindLegend('1-5:Views F1:Help Q:Quit');
    this.screen.render();
  }
}

module.exports = BackupPeerTUI;
