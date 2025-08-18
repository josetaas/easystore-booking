#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function fixDuplicates() {
    // Open database
    const db = await open({
        filename: path.join(__dirname, 'data', 'booking.db'),
        driver: sqlite3.Database
    });

    console.log('🔧 Fixing duplicate orders in database...\n');

    // Find duplicates
    const duplicates = await db.all(`
        SELECT order_id, COUNT(*) as count
        FROM processed_orders 
        GROUP BY order_id 
        HAVING COUNT(*) > 1
    `);

    if (duplicates.length === 0) {
        console.log('✅ No duplicates found!');
        await db.close();
        return;
    }

    console.log(`Found ${duplicates.length} orders with duplicates\n`);

    // Fix each duplicate
    for (const dup of duplicates) {
        console.log(`Processing order ${dup.order_id} (${dup.count} entries)...`);
        
        // Get all entries for this order
        const entries = await db.all(
            'SELECT * FROM processed_orders WHERE order_id = ? ORDER BY processed_at ASC',
            dup.order_id
        );
        
        // Keep the first entry with a calendar event, or just the first entry
        let keepEntry = entries.find(e => e.calendar_event_id) || entries[0];
        
        console.log(`  Keeping entry processed at ${keepEntry.processed_at} with calendar event: ${keepEntry.calendar_event_id || 'none'}`);
        
        // Delete all other entries
        const deleteCount = await db.run(
            'DELETE FROM processed_orders WHERE order_id = ? AND id != ?',
            [dup.order_id, keepEntry.id]
        );
        
        console.log(`  Deleted ${deleteCount.changes} duplicate entries`);
    }

    console.log('\n✅ Duplicates fixed successfully!');
    
    // Verify no duplicates remain
    const remaining = await db.get(`
        SELECT COUNT(*) as count
        FROM (
            SELECT order_id, COUNT(*) as cnt
            FROM processed_orders 
            GROUP BY order_id 
            HAVING COUNT(*) > 1
        )
    `);
    
    if (remaining.count === 0) {
        console.log('✅ Verified: No duplicates remain in database');
    } else {
        console.log(`⚠️  Warning: ${remaining.count} duplicates still exist`);
    }

    await db.close();
}

// Add confirmation prompt
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('⚠️  WARNING: This will remove duplicate entries from the database.');
console.log('It will keep the first entry with a calendar event ID, or the oldest entry.\n');

rl.question('Do you want to continue? (yes/no): ', (answer) => {
    rl.close();
    
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        fixDuplicates().catch(console.error);
    } else {
        console.log('Operation cancelled.');
    }
});