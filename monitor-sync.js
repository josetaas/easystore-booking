#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function monitorSync() {
    const db = await open({
        filename: path.join(__dirname, 'data', 'booking.db'),
        driver: sqlite3.Database
    });

    console.clear();
    console.log('📊 SYNC MONITORING DASHBOARD');
    console.log('=' .repeat(50));
    console.log(`Last updated: ${new Date().toLocaleString()}\n`);

    // Get sync statistics
    const stats = await db.get(`
        SELECT 
            COUNT(*) as total_orders,
            COUNT(DISTINCT order_id) as unique_orders,
            COUNT(CASE WHEN calendar_event_id IS NOT NULL THEN 1 END) as with_calendar,
            COUNT(CASE WHEN calendar_event_id IS NULL THEN 1 END) as without_calendar
        FROM processed_orders
    `);

    console.log('📈 Overall Statistics:');
    console.log(`  Total Processed Entries: ${stats.total_orders}`);
    console.log(`  Unique Orders: ${stats.unique_orders}`);
    console.log(`  With Calendar Events: ${stats.with_calendar}`);
    console.log(`  Without Calendar Events: ${stats.without_calendar}`);
    
    if (stats.total_orders > stats.unique_orders) {
        console.log(`  ⚠️  DUPLICATES DETECTED: ${stats.total_orders - stats.unique_orders} duplicate entries`);
    }

    // Get today's activity
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await db.get(`
        SELECT COUNT(*) as count
        FROM processed_orders
        WHERE DATE(processed_at) = DATE('${today}')
    `);
    
    console.log(`\n📅 Today's Activity (${today}):`);
    console.log(`  Orders Processed Today: ${todayStats.count}`);

    // Get last 5 processed orders
    console.log('\n🕐 Last 5 Processed Orders:');
    const recent = await db.all(`
        SELECT 
            order_number,
            customer_name,
            booking_date,
            booking_time,
            processed_at,
            calendar_event_id,
            sync_source
        FROM processed_orders 
        ORDER BY processed_at DESC 
        LIMIT 5
    `);
    
    recent.forEach(row => {
        const time = new Date(row.processed_at).toLocaleString();
        const cal = row.calendar_event_id ? '📅' : '❌';
        console.log(`  ${cal} #${row.order_number} - ${row.customer_name}`);
        console.log(`     Booking: ${row.booking_date} at ${row.booking_time}`);
        console.log(`     Processed: ${time} via ${row.sync_source}`);
    });

    // Check for recent failures
    const failures = await db.all(`
        SELECT 
            order_id,
            failure_reason,
            retry_count,
            last_attempt_at
        FROM retry_queue
        WHERE resolved_at IS NULL
        ORDER BY last_attempt_at DESC
        LIMIT 5
    `);

    if (failures.length > 0) {
        console.log('\n⚠️  Recent Failed Orders:');
        failures.forEach(row => {
            console.log(`  Order ${row.order_id}: ${row.failure_reason}`);
            console.log(`    Retries: ${row.retry_count}, Last attempt: ${row.last_attempt_at}`);
        });
    }

    // Get sync lock status
    const lockStatus = await db.get(`
        SELECT locked, locked_at, expires_at
        FROM sync_lock
        WHERE id = 1
    `);

    console.log('\n🔒 Sync Lock Status:');
    if (lockStatus.locked) {
        console.log(`  Status: LOCKED since ${lockStatus.locked_at}`);
        console.log(`  Expires: ${lockStatus.expires_at}`);
    } else {
        console.log('  Status: UNLOCKED (ready for sync)');
    }

    await db.close();
}

// Run once or continuously
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
    console.log('Starting monitoring in watch mode (updates every 5 seconds)...\n');
    setInterval(async () => {
        await monitorSync().catch(console.error);
    }, 5000);
} else {
    monitorSync().catch(console.error);
}