#!/bin/bash

# Start the Google Calendar thermal printer scheduler
echo "Starting Google Calendar thermal printer scheduler..."
echo "Agenda will be printed every weekday at 8:00 AM MST"
echo "Press Ctrl+C to stop"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the scheduler
node index.js 