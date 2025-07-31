#!/usr/bin/env node

const dataAccess = require('./lib/data-access');

async function testDatabase() {
    console.log('🧪 Testing database operations...\n');

    try {
        // Initialize database
        console.log('1. Initializing database...');
        await dataAccess.initialize();
        console.log('✅ Database initialized\n');

        // Test health check
        console.log('2. Testing health check...');
        const isHealthy = await dataAccess.healthCheck();
        console.log(`✅ Database health: ${isHealthy ? 'OK' : 'Failed'}\n`);

        // Test sync status
        console.log('3. Getting initial sync status...');
        const initialStatus = await dataAccess.getSyncStatus();
        console.log('✅ Sync status:', JSON.stringify(initialStatus, null, 2), '\n');

        // Test order processing
        console.log('4. Testing order processing...');
        const testOrderId = 'test-order-' + Date.now();
        const testOrderData = {
            orderNumber: '1001',
            paymentStatus: 'paid',
            calendarEventId: 'cal-event-123',
            bookingDate: '2025-08-15',
            bookingTime: '10:00 AM',
            bookingProduct: 'Selfie Station A',
            customerName: 'Test Customer',
            customerEmail: 'test@example.com',
            syncSource: 'test'
        };

        // Check if order is processed
        const isProcessedBefore = await dataAccess.isOrderProcessed(testOrderId);
        console.log(`   Order ${testOrderId} processed before: ${isProcessedBefore}`);

        // Mark order as processed
        await dataAccess.markOrderProcessed(testOrderId, testOrderData);
        console.log(`   ✅ Marked order as processed`);

        // Check again
        const isProcessedAfter = await dataAccess.isOrderProcessed(testOrderId);
        console.log(`   Order ${testOrderId} processed after: ${isProcessedAfter}\n`);

        // Get processed order details
        console.log('5. Retrieving processed order...');
        const processedOrder = await dataAccess.getProcessedOrder(testOrderId);
        console.log('✅ Retrieved order:', JSON.stringify(processedOrder, null, 2), '\n');

        // Test retry queue
        console.log('6. Testing retry queue...');
        const failedOrderId = 'failed-order-' + Date.now();
        await dataAccess.addToRetryQueue(
            failedOrderId,
            { id: failedOrderId, amount: 100 },
            'Network timeout',
            'temporary'
        );
        console.log('   ✅ Added order to retry queue');

        const retryableOrders = await dataAccess.getRetryableFailures();
        console.log(`   Found ${retryableOrders.length} orders in retry queue\n`);

        // Test metrics
        console.log('7. Testing sync metrics...');
        const syncId = await dataAccess.startSyncMetric('test');
        console.log(`   Started sync with ID: ${syncId}`);

        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work

        await dataAccess.completeSyncMetric(syncId, {
            ordersChecked: 10,
            ordersProcessed: 8,
            ordersFailed: 2,
            status: 'completed'
        });
        console.log('   ✅ Completed sync metric\n');

        // Get final status
        console.log('8. Getting final sync status...');
        const finalStatus = await dataAccess.getSyncStatus();
        console.log('✅ Final sync status:', JSON.stringify(finalStatus, null, 2), '\n');

        // Get recent orders
        console.log('9. Getting recent processed orders...');
        const recentOrders = await dataAccess.getRecentProcessedOrders(5);
        console.log(`✅ Found ${recentOrders.length} recent orders\n`);

        console.log('🎉 All database tests passed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await dataAccess.close();
        console.log('\n👋 Database connection closed');
    }
}

// Run tests
testDatabase();