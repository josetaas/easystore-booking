require('dotenv').config();
const { getSyncEngine } = require('./lib/sync-engine');
const dataAccess = require('./lib/data-access');

async function testSyncEngine() {
    console.log('Testing Order Synchronization Engine...\n');
    
    try {
        // Initialize database
        console.log('1. Initializing database...');
        await dataAccess.initialize();
        console.log('✅ Database initialized\n');
        
        // Initialize sync engine
        console.log('2. Initializing sync engine...');
        const syncEngine = getSyncEngine({
            batchSize: 10,
            delayBetweenOrders: 500, // 500ms for testing
            calendarId: process.env.CALENDAR_ID || 'primary',
            timezone: 'Asia/Manila',
            sessionDuration: 60,
            bufferTime: 15
        });
        
        await syncEngine.initialize();
        console.log('✅ Sync engine initialized\n');
        
        // Health check
        console.log('3. Running health check...');
        const health = await syncEngine.healthCheck();
        console.log('Health check results:');
        console.log(`- EasyStore: ${health.services.easyStore.healthy ? '✅' : '❌'} ${health.services.easyStore.message || ''}`);
        console.log(`- Calendar: ${health.services.calendar.healthy ? '✅' : '❌'}`);
        console.log(`- Database: ${health.services.database ? '✅' : '❌'}`);
        console.log('');
        
        if (!health.healthy) {
            console.error('❌ Not all services are healthy. Please check your configuration.');
            return;
        }
        
        // Get current sync status
        console.log('4. Current sync status:');
        const syncStatus = await dataAccess.getSyncStatus();
        console.log(`- Total processed orders: ${syncStatus.processedOrders}`);
        console.log(`- Orders in retry queue: ${syncStatus.retryQueueSize}`);
        if (syncStatus.lastSync) {
            console.log(`- Last sync: ${new Date(syncStatus.lastSync.completed_at || syncStatus.lastSync.started_at).toLocaleString()}`);
            console.log(`- Last sync status: ${syncStatus.lastSync.status}`);
        }
        console.log('');
        
        // Ask user if they want to run sync
        console.log('5. Ready to run synchronization');
        console.log('This will:');
        console.log('- Fetch paid orders from EasyStore');
        console.log('- Extract booking information');
        console.log('- Create calendar events for new bookings');
        console.log('- Skip already processed orders');
        console.log('');
        
        // For testing, we'll run a limited sync
        console.log('Running test sync (limited to recent orders)...\n');
        
        // Run sync with a date limit for testing
        const testSince = new Date();
        testSince.setDate(testSince.getDate() - 7); // Last 7 days only
        
        const result = await syncEngine.runFullSync({
            since: testSince
        });
        
        console.log('\n✅ Test completed!');
        
        // Show final metrics
        console.log('\n6. Sync metrics:');
        const metrics = await dataAccess.getSyncMetrics();
        console.log(`- Total syncs run: ${metrics.total_syncs}`);
        console.log(`- Successful syncs: ${metrics.successful_syncs}`);
        console.log(`- Failed syncs: ${metrics.failed_syncs}`);
        console.log(`- Total orders processed: ${metrics.total_orders}`);
        console.log(`- Success rate: ${metrics.total_orders > 0 ? Math.round((metrics.successful_orders / metrics.total_orders) * 100) : 0}%`);
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.stack) {
            console.error('\nStack trace:', error.stack);
        }
    } finally {
        // Close database connection
        await dataAccess.close();
    }
}

// Command line interface
const args = process.argv.slice(2);
const command = args[0];

if (command === '--help' || command === '-h') {
    console.log(`
Order Synchronization Test Script

Usage:
  node test-sync-engine.js              Run test synchronization
  node test-sync-engine.js --order ID   Sync a specific order by ID
  node test-sync-engine.js --help       Show this help message

Environment variables required:
  GOOGLE_CLIENT_EMAIL     Google service account email
  GOOGLE_PRIVATE_KEY      Google service account private key
  CALENDAR_ID             Google Calendar ID (default: primary)
  EASYSTORE_API_URL       EasyStore API URL
  EASYSTORE_ACCESS_TOKEN  EasyStore API access token
`);
    process.exit(0);
}

if (command === '--order' && args[1]) {
    // Sync specific order
    (async () => {
        try {
            await dataAccess.initialize();
            const syncEngine = getSyncEngine({
                calendarId: process.env.CALENDAR_ID || 'primary',
                timezone: 'Asia/Manila',
                sessionDuration: 60,
                bufferTime: 15
            });
            await syncEngine.initialize();
            
            const orderId = args[1];
            console.log(`Syncing order ${orderId}...\n`);
            
            const result = await syncEngine.syncOrder(orderId, { force: true });
            
            if (result.success) {
                console.log('\n✅ Order synced successfully!');
                if (result.bookings && result.bookings.length > 0) {
                    console.log('\nBookings created:');
                    result.bookings.forEach(booking => {
                        console.log(`- ${booking.productName} on ${booking.bookingDate} at ${booking.bookingTime}`);
                        if (booking.calendarEventLink) {
                            console.log(`  Calendar event: ${booking.calendarEventLink}`);
                        }
                    });
                }
            } else {
                console.log('\n❌ Order sync failed');
                console.log('Errors:', result.errors);
            }
            
        } catch (error) {
            console.error('Error:', error.message);
        } finally {
            await dataAccess.close();
        }
    })();
} else {
    // Run full test
    testSyncEngine().catch(console.error);
}