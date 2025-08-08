const fs = require('fs-extra');
const path = require('path');
const minimatch = require('minimatch');

class BackupIgnore {
  constructor() {
    this.patterns = [];
    this.defaultPatterns = [
      'node_modules/**',
      '*.tmp',
      '*.temp',
      '.git/**',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      '*.cache',
      '.vscode/**',
      '.idea/**',
      '*.swp',
      '*.swo',
      '*~'
    ];
  }

  async loadIgnoreFile(directory) {
    const ignorePath = path.join(directory, '.backupignore');
    
    try {
      if (await fs.pathExists(ignorePath)) {
        const content = await fs.readFile(ignorePath, 'utf8');
        this.patterns = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
      }
    } catch (error) {
      console.warn('Could not load .backupignore:', error.message);
    }
    
    // Merge with defaults, removing duplicates
    this.patterns = [...new Set([...this.patterns, ...this.defaultPatterns])];
  }

  shouldIgnore(filePath) {
    return this.patterns.some(pattern => 
      minimatch(filePath, pattern, { dot: true })
    );
  }

  getPatterns() {
    return this.patterns;
  }

  addPattern(pattern) {
    if (!this.patterns.includes(pattern)) {
      this.patterns.push(pattern);
    }
  }

  removePattern(pattern) {
    this.patterns = this.patterns.filter(p => p !== pattern);
  }

  async saveIgnoreFile(directory) {
    const ignorePath = path.join(directory, '.backupignore');
    const content = [
      '# BackupPeer ignore file',
      '# Add patterns for files/folders to exclude from backup',
      '',
      '# System files',
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',
      '',
      '# Temporary files',
      '*.tmp',
      '*.temp',
      '*.log',
      '*.cache',
      '',
      '# Development',
      'node_modules/',
      '.git/',
      '.svn/',
      '.hg/',
      '.vscode/',
      '.idea/',
      '',
      '# Large media (customize as needed)',
      '*.mp4',
      '*.avi',
      '*.mov',
      '',
      '# Add your custom patterns below:',
      ...this.patterns.filter(p => !this.defaultPatterns.includes(p))
    ].join('\n');

    await fs.writeFile(ignorePath, content, 'utf8');
  }
}

module.exports = BackupIgnore;