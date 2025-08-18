#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function checkDuplicates() {
    // Open database
    const db = await open({
        filename: path.join(__dirname, 'data', 'booking.db'),
        driver: sqlite3.Database
    });

    console.log('🔍 Checking for duplicate orders in database...\n');

    // Check for duplicate order_id entries
    const duplicates = await db.all(`
        SELECT order_id, COUNT(*) as count, 
               GROUP_CONCAT(processed_at, ', ') as processed_times,
               GROUP_CONCAT(calendar_event_id, ', ') as event_ids
        FROM processed_orders 
        GROUP BY order_id 
        HAVING COUNT(*) > 1
    `);

    if (duplicates.length > 0) {
        console.log(`⚠️  Found ${duplicates.length} orders with duplicates:\n`);
        
        for (const dup of duplicates) {
            console.log(`Order ID: ${dup.order_id}`);
            console.log(`  Count: ${dup.count} entries`);
            console.log(`  Processed at: ${dup.processed_times}`);
            console.log(`  Calendar Event IDs: ${dup.event_ids}`);
            
            // Get full details
            const details = await db.all(
                'SELECT * FROM processed_orders WHERE order_id = ? ORDER BY processed_at',
                dup.order_id
            );
            
            console.log('  Details:');
            details.forEach((row, index) => {
                console.log(`    Entry ${index + 1}:`);
                console.log(`      Order Number: ${row.order_number}`);
                console.log(`      Customer: ${row.customer_name} (${row.customer_email})`);
                console.log(`      Booking: ${row.booking_date} at ${row.booking_time}`);
                console.log(`      Product: ${row.booking_product}`);
                console.log(`      Sync Source: ${row.sync_source}`);
                console.log(`      Processed: ${row.processed_at}`);
            });
            console.log('');
        }
        
        console.log('\n💡 To fix duplicates, you can:');
        console.log('1. Delete duplicate entries keeping only the first one');
        console.log('2. Run: node fix-duplicates.js');
    } else {
        console.log('✅ No duplicate orders found in the database');
    }

    // Check orders without calendar events
    const noCalendar = await db.all(`
        SELECT order_id, order_number, customer_name, booking_date, booking_time
        FROM processed_orders 
        WHERE calendar_event_id IS NULL OR calendar_event_id = ''
    `);

    if (noCalendar.length > 0) {
        console.log(`\n⚠️  Found ${noCalendar.length} orders without calendar events:`);
        noCalendar.forEach(row => {
            console.log(`  - Order ${row.order_number}: ${row.customer_name} on ${row.booking_date} at ${row.booking_time}`);
        });
    }

    // Show recent orders
    console.log('\n📊 Recent processed orders (last 5):');
    const recent = await db.all(`
        SELECT * FROM processed_orders 
        ORDER BY processed_at DESC 
        LIMIT 5
    `);
    
    recent.forEach(row => {
        console.log(`  ${row.order_number} - ${row.customer_name} - ${row.booking_date} ${row.booking_time} - Processed: ${row.processed_at}`);
    });

    await db.close();
}

checkDuplicates().catch(console.error);