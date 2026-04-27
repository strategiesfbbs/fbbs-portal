#!/bin/bash
# FBBS Portal - Mac/Linux Launcher
# Double-click this file (Mac) or run from a terminal.

cd "$(dirname "$0")"

echo ""
echo "================================================================"
echo "  FBBS Market Intelligence Portal"
echo "================================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo ""
    echo "Install the LTS version from https://nodejs.org and try again."
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# Install dependencies on first run
if [ ! -d "node_modules" ]; then
    echo "First-time setup: installing dependencies..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "ERROR: npm install failed. See output above."
        read -p "Press Enter to exit..."
        exit 1
    fi
    echo ""
fi

echo "Starting portal..."
echo "Once running, open your browser to: http://localhost:3000"
echo "Press Ctrl+C in this window to stop."
echo ""

node server/server.js
