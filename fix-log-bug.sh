#!/bin/bash
# fix-log-bug.sh - Quick fix for the 'log is not defined' bug

echo "🔧 Fixing Bug #1: 'log is not defined' in cli.js"
echo "==============================================="

# Fix in the main project
if [ -f "client/lib/cli.js" ]; then
    echo "Fixing in main project..."
    sed -i 's/log(chalk\./console.log(chalk./g' client/lib/cli.js
    echo "✅ Fixed main project cli.js"
fi

# Fix in test peers if they exist
for peer in peer1 peer2; do
    CLI_FILE="$HOME/Desktop/BackupPeer_Testing/$peer/client/lib/cli.js"
    if [ -f "$CLI_FILE" ]; then
        echo "Fixing in test $peer..."
        sed -i 's/log(chalk\./console.log(chalk./g' "$CLI_FILE"
        echo "✅ Fixed $peer cli.js"
    fi
done

echo ""
echo "🎯 Bug Fix Applied!"
echo "The 'log is not defined' error should now be resolved."
echo "Re-run tests to verify the fix works."