#!/usr/bin/env node

require('dotenv').config();

const { getScheduler } = require('./lib/scheduler');
const dataAccess = require('./lib/data-access');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testScheduler() {
    log('\n=== Testing Order Sync Scheduler ===\n', 'blue');
    
    try {
        // Initialize database
        log('Initializing database...', 'yellow');
        await dataAccess.initialize();
        log('✅ Database initialized', 'green');
        
        // Test 1: Create scheduler instance
        log('\n1. Testing scheduler creation...', 'yellow');
        const scheduler = getScheduler({
            interval: '*/1 * * * *', // Every minute for testing
            enabled: true
        });
        log('✅ Scheduler created successfully', 'green');
        
        // Test 2: Get scheduler status
        log('\n2. Testing scheduler status...', 'yellow');
        const status = await scheduler.getStatus();
        console.log('Scheduler status:', JSON.stringify(status, null, 2));
        log('✅ Scheduler status retrieved', 'green');
        
        // Test 3: Test sync lock mechanism
        log('\n3. Testing sync lock mechanism...', 'yellow');
        const lockAcquired = await dataAccess.acquireSyncLock();
        log(`Lock acquired: ${lockAcquired}`, lockAcquired ? 'green' : 'red');
        
        // Try to acquire lock again (should fail)
        const secondLock = await dataAccess.acquireSyncLock();
        log(`Second lock attempt: ${secondLock} (should be false)`, !secondLock ? 'green' : 'red');
        
        // Release lock
        await dataAccess.releaseSyncLock();
        log('✅ Lock released', 'green');
        
        // Test 4: Test metrics
        log('\n4. Testing metrics...', 'yellow');
        const metrics = scheduler.getMetrics();
        console.log('Scheduler metrics:', JSON.stringify(metrics, null, 2));
        log('✅ Metrics retrieved', 'green');
        
        // Test 5: Test manual sync run
        log('\n5. Testing manual sync run...', 'yellow');
        log('Running sync (this may take a moment)...', 'yellow');
        
        // Override config for faster testing
        scheduler.config.maxSyncDuration = 30000; // 30 seconds
        
        await scheduler.runSync();
        log('✅ Manual sync completed', 'green');
        
        // Get updated metrics
        const updatedMetrics = scheduler.getMetrics();
        console.log('Updated metrics:', JSON.stringify(updatedMetrics, null, 2));
        
        // Test 6: Test scheduler start/stop
        log('\n6. Testing scheduler start/stop...', 'yellow');
        await scheduler.start();
        log('✅ Scheduler started', 'green');
        
        // Let it run for a few seconds
        log('Letting scheduler run for 5 seconds...', 'yellow');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        scheduler.stop();
        log('✅ Scheduler stopped', 'green');
        
        // Test 7: Check sync status from database
        log('\n7. Testing sync status from database...', 'yellow');
        const syncStatus = await dataAccess.getSyncStatus();
        console.log('Sync status:', JSON.stringify(syncStatus, null, 2));
        log('✅ Sync status retrieved from database', 'green');
        
        // Test 8: Test health check
        log('\n8. Testing health check...', 'yellow');
        const finalStatus = await scheduler.getStatus();
        log(`Health: ${finalStatus.health}`, 
            finalStatus.health === 'healthy' ? 'green' : 
            finalStatus.health === 'degraded' ? 'yellow' : 'red');
        
        log('\n✅ All scheduler tests completed successfully!', 'green');
        
    } catch (error) {
        log(`\n❌ Test failed: ${error.message}`, 'red');
        console.error(error);
    } finally {
        await dataAccess.close();
    }
}

// Command line options
const args = process.argv.slice(2);
const command = args[0];

if (command === '--continuous') {
    // Run scheduler continuously for testing
    log('\n=== Running Scheduler Continuously ===\n', 'blue');
    log('Press Ctrl+C to stop\n', 'yellow');
    
    (async () => {
        try {
            await dataAccess.initialize();
            const scheduler = getScheduler({
                interval: '*/1 * * * *', // Every minute
                enabled: true
            });
            
            await scheduler.start();
            log('✅ Scheduler started, running every minute', 'green');
            
            // Keep process alive
            process.stdin.resume();
            
            // Graceful shutdown
            process.on('SIGINT', async () => {
                log('\n\nStopping scheduler...', 'yellow');
                scheduler.stop();
                await dataAccess.close();
                log('✅ Scheduler stopped', 'green');
                process.exit(0);
            });
            
        } catch (error) {
            log(`❌ Error: ${error.message}`, 'red');
            process.exit(1);
        }
    })();
} else if (command === '--status') {
    // Just show current status
    (async () => {
        try {
            await dataAccess.initialize();
            const scheduler = getScheduler();
            const status = await scheduler.getStatus();
            
            log('\n=== Current Scheduler Status ===\n', 'blue');
            console.log(JSON.stringify(status, null, 2));
            
            await dataAccess.close();
        } catch (error) {
            log(`❌ Error: ${error.message}`, 'red');
            process.exit(1);
        }
    })();
} else {
    // Run tests
    testScheduler();
}

// Help text
if (command === '--help' || command === '-h') {
    console.log(`
Usage: node test-scheduler.js [command]

Commands:
  (no command)    Run scheduler tests
  --continuous    Run scheduler continuously (every minute)
  --status        Show current scheduler status
  --help, -h      Show this help message

Examples:
  node test-scheduler.js              # Run tests
  node test-scheduler.js --continuous # Run scheduler continuously
  node test-scheduler.js --status     # Show status
`);
    process.exit(0);
}