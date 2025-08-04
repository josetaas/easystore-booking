#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'booking.db');

if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('✅ Database deleted');
} else {
    console.log('ℹ️  Database file not found');
}

console.log('Please restart the application to create a fresh database.');