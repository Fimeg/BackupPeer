const blessed = require('blessed');
const fs = require('fs-extra');
const path = require('path');
const BackupCrypto = require('./crypto');

class TradeAuthenticator {
  constructor(screen) {
    this.screen = screen;
    this.acceptedTerms = false;
    this.termsTimestamp = null;
  }
  
  // Check if user has accepted Terms of Use
  async checkTermsAcceptance() {
    const configDir = path.join(require('os').homedir(), '.backup-peer');
    const termsFile = path.join(configDir, 'terms-accepted.json');
    
    try {
      if (await fs.pathExists(termsFile)) {
        const termsData = await fs.readJSON(termsFile);
        const acceptedTime = new Date(termsData.acceptedAt);
        const currentTime = new Date();
        
        // Terms acceptance expires after 1 year
        const oneYear = 365 * 24 * 60 * 60 * 1000;
        if (currentTime - acceptedTime < oneYear) {
          this.acceptedTerms = true;
          this.termsTimestamp = termsData.acceptedAt;
          return true;
        }
      }
    } catch (error) {
      console.warn('Could not check terms acceptance:', error.message);
    }
    
    return false;
  }
  
  // Display Terms of Use acceptance dialog
  async showTermsOfUse() {
    return new Promise((resolve) => {
      const termsBox = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '90%',
        height: '90%',
        label: '⚖️  BackupPeer Terms of Use & Digital Sovereignty Declaration',
        border: { type: 'line' },
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'yellow' },
          scrollbar: {
            bg: 'blue',
            fg: 'white'
          }
        }
      });
      
      const termsContent = `
{center}{bold}🛡️  DIGITAL SOVEREIGNTY DECLARATION 🛡️{/bold}{/center}

{bold}BackupPeer exists to break Big Tech surveillance and restore data sovereignty!{/bold}

{red}⚠️  CRITICAL LEGAL WARNINGS ⚠️{/red}

{bold}1. LAWFUL USE ONLY{/bold}
• You MUST NOT store illegal content (child exploitation, terrorism, etc.)
• You MUST NOT share copyrighted material without permission
• You MUST comply with all applicable laws
• YOU are solely responsible for your content

{bold}2. UNKNOWN PEER RISKS{/bold}
{red}• Using unknown peers is EXTREMELY RISKY{/red}
• May result in complete data loss
• Potential legal exposure if peer stores illegal content
• ONLY use peers with HIGH trust scores (0.8+ recommended)

{bold}3. PEER PROTECTION & PLAUSIBLE DENIABILITY{/bold}
• All data encrypted locally before transmission
• Peers store encrypted chunks only - cannot access your content
• Peers are NOT liable for content stored by others
• Zero-knowledge architecture provides plausible deniability

{bold}4. CORPORATE EXPLOITATION WARNING{/bold}
• Corporations may exploit network resources
• "Friends" may request more storage than they offer
• Use Accept/Modify/Reject flow for unequal trades
• Community governance protects against abuse

{bold}5. DEVELOPER NON-LIABILITY{/bold}
• BackupPeer is open-source software, not a service
• Developers collect no data and cannot monitor content
• No warranties or technical support provided
• Users assume all risks and legal liability

{bold}6. PRIVACY GUARANTEES{/bold}
• Client-side encryption with Ed25519/NaCl
• WebRTC direct connections - no server data storage
• Minimal signaling metadata - servers see only connection requests
• Distributed architecture - no central authority

{center}{bold}🚀 BY USING BACKUPPEER, YOU JOIN THE FIGHT FOR DIGITAL SOVEREIGNTY! 🚀{/bold}{/center}

{center}Press [A] to ACCEPT terms, [R] to REJECT and exit{/center}
{center}Press [S] to SCROLL, [V] to view full terms document{/center}`;
      
      termsBox.setContent(termsContent);
      
      const buttonBox = blessed.box({
        parent: this.screen,
        bottom: 3,
        left: 'center',
        width: 60,
        height: 3,
        border: { type: 'line' },
        style: {
          fg: 'white',
          bg: 'red',
          border: { fg: 'white' }
        }
      });
      
      buttonBox.setContent('{center}[A] ACCEPT TERMS  [R] REJECT & EXIT  [V] VIEW FULL{/center}');
      
      termsBox.key(['a', 'A'], async () => {
        // Save terms acceptance
        await this.saveTermsAcceptance();
        this.screen.remove(termsBox);
        this.screen.remove(buttonBox);
        this.screen.render();
        resolve(true);
      });
      
      termsBox.key(['r', 'R'], () => {
        this.screen.remove(termsBox);
        this.screen.remove(buttonBox);
        this.screen.render();
        console.log('\n🚫 Terms rejected. Exiting BackupPeer.');
        console.log('Digital sovereignty requires accepting responsibility!');
        resolve(false);
      });
      
      termsBox.key(['v', 'V'], () => {
        // TODO: Open full terms document
        termsBox.setContent(termsContent + '\n\n{center}Full terms available at: TERMS_OF_USE.md{/center}');
        this.screen.render();
      });
      
      termsBox.focus();
      this.screen.render();
    });
  }
  
  // Save terms acceptance to disk
  async saveTermsAcceptance() {
    const configDir = path.join(require('os').homedir(), '.backup-peer');
    const termsFile = path.join(configDir, 'terms-accepted.json');
    
    await fs.ensureDir(configDir);
    
    const termsData = {
      acceptedAt: new Date().toISOString(),
      version: '1.0',
      ipHash: require('crypto').createHash('sha256').update(require('os').hostname()).digest('hex').slice(0, 8)
    };
    
    await fs.writeJSON(termsFile, termsData, { spaces: 2 });
    
    this.acceptedTerms = true;
    this.termsTimestamp = termsData.acceptedAt;
  }
  
  // Show peer trade authentication dialog
  async authenticateTrade(peerInfo, tradeRequest) {
    return new Promise((resolve) => {
      const authBox = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '80%',
        height: '70%',
        label: '🤝 Peer Trade Authentication',
        border: { type: 'line' },
        keys: true,
        mouse: true,
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'green' }
        }
      });
      
      const peerTrustIcon = {
        'trusted': '🟢 TRUSTED',
        'acceptable': '🟡 ACCEPTABLE', 
        'suspicious': '🟠 SUSPICIOUS',
        'untrusted': '🔴 UNTRUSTED'
      }[peerInfo.trustLevel] || '⚪ UNKNOWN';
      
      const storageOffered = (tradeRequest.storageOffered / 1024 / 1024 / 1024).toFixed(1);
      const storageNeeded = (tradeRequest.storageNeeded / 1024 / 1024 / 1024).toFixed(1);
      const isEqualTrade = tradeRequest.storageOffered === tradeRequest.storageNeeded;
      const tradeRatio = (tradeRequest.storageNeeded / tradeRequest.storageOffered).toFixed(2);
      
      let riskWarning = '';
      if (peerInfo.trustLevel === 'untrusted' || peerInfo.trustLevel === 'suspicious') {
        riskWarning = '{red}⚠️  HIGH RISK: This peer has low trust score! Data loss possible!{/red}\n';
      }
      if (!isEqualTrade && tradeRatio > 1.5) {
        riskWarning += '{red}⚠️  UNEQUAL TRADE: Peer requesting much more storage than offering!{/red}\n';
      }
      
      const authContent = `
{center}{bold}🔐 SOVEREIGN PEER TRADE NEGOTIATION 🔐{/bold}{/center}

{bold}Peer Information:{/bold}
• ID: ${peerInfo.peerId.slice(0, 24)}...
• Trust Level: ${peerTrustIcon}
• Reputation Score: ${(peerInfo.reputation * 100).toFixed(0)}%
• Location: ${peerInfo.location || 'Unknown'}
• Last Seen: ${peerInfo.lastSeen ? new Date(peerInfo.lastSeen).toLocaleDateString() : 'Never'}
• Server: ${peerInfo.server || 'backup01.wiuf.net'}

{bold}Trade Proposal:{/bold}
• You Offer: ${storageOffered} GB
• They Need: ${storageNeeded} GB
• Trade Ratio: ${tradeRatio}:1 ${isEqualTrade ? '(Equal Trade)' : '(Unequal Trade)'}
• Duration: ${tradeRequest.duration || '2 hours'}
• Description: ${tradeRequest.description || 'Standard backup exchange'}

${riskWarning}
{bold}⚠️  REMEMBER:{/bold}
• You are responsible for lawful use only
• Unknown peers carry high risk of data loss
• This peer stores encrypted chunks - cannot access your files
• You can blacklist this peer if they misbehave

{center}{bold}WHAT DO YOU WANT TO DO?{/bold}{/center}

{center}[A] ACCEPT trade as proposed{/center}
{center}[M] MODIFY trade terms (counter-offer){/center}
{center}[R] REJECT trade and disconnect{/center}
{center}[I] MORE INFO about this peer{/center}`;
      
      authBox.setContent(authContent);
      
      const buttonBox = blessed.box({
        parent: this.screen,
        bottom: 2,
        left: 'center',
        width: 80,
        height: 3,
        border: { type: 'line' },
        style: {
          fg: 'white',
          bg: 'blue',
          border: { fg: 'white' }
        }
      });
      
      buttonBox.setContent('{center}[A] ACCEPT  [M] MODIFY  [R] REJECT  [I] MORE INFO{/center}');
      
      authBox.key(['a', 'A'], () => {
        this.screen.remove(authBox);
        this.screen.remove(buttonBox);
        this.screen.render();
        resolve({ action: 'accept', terms: tradeRequest });
      });
      
      authBox.key(['r', 'R'], () => {
        this.screen.remove(authBox);
        this.screen.remove(buttonBox);
        this.screen.render();
        resolve({ action: 'reject', reason: 'User rejected trade' });
      });
      
      authBox.key(['m', 'M'], () => {
        this.screen.remove(authBox);
        this.screen.remove(buttonBox);
        this.showModifyTradeDialog(peerInfo, tradeRequest, resolve);
      });
      
      authBox.key(['i', 'I'], () => {
        this.showPeerInfoDialog(peerInfo, () => {
          // Return to trade auth after info dialog
          this.screen.render();
        });
      });
      
      authBox.focus();
      this.screen.render();
    });
  }
  
  // Show modify trade dialog for counter-offers
  showModifyTradeDialog(peerInfo, originalRequest, resolve) {
    const modifyBox = blessed.form({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      label: '✏️  Modify Trade Terms - Counter Offer',
      border: { type: 'line' },
      keys: true,
      mouse: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' }
      }
    });
    
    const currentOffered = (originalRequest.storageOffered / 1024 / 1024 / 1024).toFixed(1);
    const currentNeeded = (originalRequest.storageNeeded / 1024 / 1024 / 1024).toFixed(1);
    
    modifyBox.setContent(`
{center}{bold}💱 SOVEREIGN TRADE NEGOTIATION 💱{/bold}{/center}

Current Proposal:
• You Offer: ${currentOffered} GB
• They Need: ${currentNeeded} GB

Enter Your Counter-Offer:
`);
    
    const storageInput = blessed.textbox({
      parent: modifyBox,
      top: 8,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Storage You Will Offer (GB):',
      border: { type: 'line' },
      inputOnFocus: true,
      value: currentOffered
    });
    
    const durationInput = blessed.textbox({
      parent: modifyBox,
      top: 11,
      left: 2,
      width: '96%',
      height: 1,
      label: 'Duration (hours):',
      border: { type: 'line' },
      inputOnFocus: true,
      value: '2'
    });
    
    const messageInput = blessed.textarea({
      parent: modifyBox,
      top: 14,
      left: 2,
      width: '96%',
      height: 4,
      label: 'Message to Peer:',
      border: { type: 'line' },
      inputOnFocus: true,
      value: 'Counter-offer for fair trade'
    });
    
    const submitButton = blessed.button({
      parent: modifyBox,
      bottom: 3,
      left: 'center',
      width: 20,
      height: 3,
      content: 'SEND COUNTER-OFFER',
      style: {
        bg: 'green',
        fg: 'white',
        focus: {
          bg: 'blue'
        }
      }
    });
    
    const cancelButton = blessed.button({
      parent: modifyBox,
      bottom: 3,
      right: 5,
      width: 15,
      height: 3,
      content: 'CANCEL',
      style: {
        bg: 'red',
        fg: 'white',
        focus: {
          bg: 'blue'
        }
      }
    });
    
    submitButton.on('press', () => {
      const modifiedRequest = {
        ...originalRequest,
        storageOffered: parseFloat(storageInput.getValue()) * 1024 * 1024 * 1024,
        duration: `${durationInput.getValue()} hours`,
        message: messageInput.getValue(),
        isCounterOffer: true
      };
      
      this.screen.remove(modifyBox);
      this.screen.render();
      resolve({ action: 'modify', terms: modifiedRequest });
    });
    
    cancelButton.on('press', () => {
      this.screen.remove(modifyBox);
      this.screen.render();
      resolve({ action: 'reject', reason: 'User cancelled modification' });
    });
    
    storageInput.focus();
    this.screen.render();
  }
  
  // Show detailed peer information dialog
  showPeerInfoDialog(peerInfo, callback) {
    const infoBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '80%',
      label: '🔍 Peer Intelligence Report',
      border: { type: 'line' },
      scrollable: true,
      keys: true,
      mouse: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      }
    });
    
    const trustIcon = {
      'trusted': '🟢',
      'acceptable': '🟡',
      'suspicious': '🟠',
      'untrusted': '🔴'
    }[peerInfo.trustLevel] || '⚪';
    
    const infoContent = `
{center}{bold}📊 PEER REPUTATION ANALYSIS 📊{/bold}{/center}

{bold}Identity & Trust:{/bold}
• Peer ID: ${peerInfo.peerId}
• Trust Level: ${trustIcon} ${peerInfo.trustLevel?.toUpperCase() || 'UNKNOWN'}
• Reputation Score: ${(peerInfo.reputation * 100).toFixed(1)}%
• Public Key: ${peerInfo.publicKey?.slice(0, 32) || 'Not available'}...

{bold}Connection History:{/bold}
• Total Connections: ${peerInfo.totalConnections || 0}
• Successful: ${peerInfo.successfulConnections || 0}
• Failed: ${(peerInfo.totalConnections || 0) - (peerInfo.successfulConnections || 0)}
• Success Rate: ${peerInfo.totalConnections ? ((peerInfo.successfulConnections / peerInfo.totalConnections) * 100).toFixed(1) : 0}%
• Average Response Time: ${peerInfo.averageResponseTime || 0}ms

{bold}Storage Verification:{/bold}
• Total Challenges: ${peerInfo.totalChallenges || 0}
• Successful Proofs: ${peerInfo.successfulChallenges || 0}
• Failed Proofs: ${(peerInfo.totalChallenges || 0) - (peerInfo.successfulChallenges || 0)}
• Verification Rate: ${peerInfo.totalChallenges ? ((peerInfo.successfulChallenges / peerInfo.totalChallenges) * 100).toFixed(1) : 0}%

{bold}Network Presence:{/bold}
• First Seen: ${peerInfo.firstSeen ? new Date(peerInfo.firstSeen).toLocaleDateString() : 'Unknown'}
• Last Seen: ${peerInfo.lastSeen ? new Date(peerInfo.lastSeen).toLocaleDateString() : 'Never'}
• Location: ${peerInfo.location || 'Unknown'}
• Uptime Score: ${((peerInfo.uptimeScore || 0.5) * 100).toFixed(1)}%

{bold}Data Integrity:{/bold}
• Files Transferred: ${peerInfo.totalFilesTransferred || 0}
• Corrupted Files: ${peerInfo.corruptedFiles || 0}
• Integrity Score: ${((peerInfo.dataIntegrityScore || 1.0) * 100).toFixed(1)}%

{bold}Risk Assessment:{/bold}`;
    
    let riskAssessment = '';
    if (peerInfo.reputation >= 0.8) {
      riskAssessment = '{green}• LOW RISK: Highly trusted peer with excellent track record{/green}';
    } else if (peerInfo.reputation >= 0.6) {
      riskAssessment = '{yellow}• MEDIUM RISK: Acceptable peer, monitor performance{/yellow}';
    } else if (peerInfo.reputation >= 0.4) {
      riskAssessment = '{red}• HIGH RISK: Suspicious activity, use extreme caution{/red}';
    } else {
      riskAssessment = '{red}• EXTREME RISK: Untrusted peer, strong chance of data loss{/red}';
    }
    
    if (peerInfo.blacklisted) {
      riskAssessment += '\n{red}• ⚠️  BLACKLISTED: This peer has been flagged by the community{/red}';
    }
    
    infoBox.setContent(infoContent + '\n' + riskAssessment + '\n\n{center}Press any key to close{/center}');
    
    infoBox.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(infoBox);
      this.screen.render();
      callback();
    });
    
    infoBox.focus();
    this.screen.render();
  }
}

module.exports = TradeAuthenticator;