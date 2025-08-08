#!/bin/bash
echo "🔐 Setting up BackupPeer client..."

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed. Please install Node.js and npm first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies. Please check your npm configuration."
    exit 1
fi

# Create config directory
CONFIG_DIR="$HOME/.backup-peer"
echo "📁 Creating config directory at $CONFIG_DIR..."
mkdir -p "$CONFIG_DIR"

# Create default .backupignore
echo "📝 Creating default .backupignore template..."
cat > "$CONFIG_DIR/.backupignore" << 'EOF'
# BackupPeer ignore file
# Add patterns for files/folders to exclude from backup

# System files
.DS_Store
Thumbs.db
desktop.ini

# Temporary files
*.tmp
*.temp
*.log
*.cache

# Development
node_modules/
.git/
.svn/
.hg/
.vscode/
.idea/

# Large media (customize as needed)
*.mp4
*.avi
*.mov
*.mkv
*.wmv
*.flv
*.webm

# Archives (usually don't need backup of backups)
*.zip
*.tar
*.tar.gz
*.rar
*.7z

# Virtual machines
*.vmdk
*.vdi
*.vhd
*.qcow2

# Add your custom patterns below:
EOF

# Set permissions
chmod 755 "$CONFIG_DIR"
chmod 644 "$CONFIG_DIR/.backupignore"

# Create bin symlink if it doesn't exist
BIN_PATH="./bin/backup-peer"
if [ ! -f "$BIN_PATH" ]; then
    echo "🔗 Creating executable symlink..."
    mkdir -p bin
    cat > "$BIN_PATH" << 'EOF'
#!/usr/bin/env node
require('../lib/cli.js');
EOF
    chmod +x "$BIN_PATH"
fi

# Create systemd service file (for Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]] && command -v systemctl &> /dev/null; then
    echo "📝 Creating systemd service file..."
    
    SERVICE_FILE="/tmp/backuppeer.service"
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=BackupPeer P2P Backup Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node $PWD/lib/service.js
Restart=on-failure
RestartSec=10
StandardOutput=append:$HOME/.backup-peer/service.log
StandardError=append:$HOME/.backup-peer/service.log
Environment="NODE_ENV=production"
User=$USER

[Install]
WantedBy=multi-user.target
EOF

    echo "To install as system service, run:"
    echo "  sudo cp $SERVICE_FILE /etc/systemd/system/"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl enable backuppeer"
    echo "  sudo systemctl start backuppeer"
fi

# Create launchd plist (for macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "📝 Creating launchd plist..."
    
    PLIST_FILE="$HOME/Library/LaunchAgents/net.backuppeer.service.plist"
    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>net.backuppeer.service</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$PWD/lib/service.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/.backup-peer/service.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.backup-peer/service.log</string>
</dict>
</plist>
EOF

    echo "To install as launch agent, run:"
    echo "  launchctl load $PLIST_FILE"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎯 Quick start:"
echo "   ./bin/backup-peer ui                 # Start TUI interface"
echo "   ./bin/backup-peer backup ~/Documents # Backup a folder"
echo "   ./bin/backup-peer status             # Show system status"
echo ""
echo "🚀 Service commands:"
echo "   ./bin/backup-peer service start    # Start background service"
echo "   ./bin/backup-peer service status   # Check service status"
echo "   ./bin/backup-peer service stop     # Stop service"
echo ""
echo "📊 Progress monitoring:"
echo "   ./bin/backup-peer progress         # Show all active backups"
echo "   ./bin/backup-peer progress <id>    # Show specific backup progress"
echo ""
echo "🔧 Background backups:"
echo "   ./bin/backup-peer backup -d ~/Documents  # Run in background"
echo "   ./bin/backup-peer backup -d -w ~/Files   # Background with live progress"
echo ""
echo "📖 Configuration:"
echo "   Edit ~/.backup-peer/.backupignore to customize which files to exclude"
echo "   Use --help with any command for detailed options"
echo ""
echo "🚀 Ready to liberate your data!"