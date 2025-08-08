#!/bin/bash

# This script sets up the testing environment for BackupPeer.

# Define the testing directory on the Desktop
TESTING_DIR="$HOME/Desktop/BackupPeer_Testing"
REPO_URL="https://github.com/Fimeg/BackupPeer/"

# Create the main testing directory
echo "Creating testing directory at $TESTING_DIR..."
mkdir -p "$TESTING_DIR"
cd "$TESTING_DIR"

# Create peer directories and clone the repo
echo "Cloning repository into peer1 and peer2 directories..."
git clone "$REPO_URL" peer1
git clone "$REPO_URL" peer2

echo "Setup complete."
echo "You can now find the 'peer1' and 'peer2' directories in '$TESTING_DIR'."
