#!/usr/bin/env node
require('dotenv').config();
const { getSyncEngine } = require('./lib/sync-engine');
const { EasyStoreAPI } = require('./lib/easystore-api');
const dataAccess = require('./lib/data-access');

async function testOrderSync() {
    console.log('🔍 EasyStore Order to Calendar Sync Test\n');
    
    try {
        // Initialize
        await dataAccess.initialize();
        const api = new EasyStoreAPI({
            storeUrl: process.env.EASYSTORE_API_URL,
            accessToken: process.env.EASYSTORE_ACCESS_TOKEN
        });
        
        // Step 1: Show recent orders
        console.log('📦 Recent Orders from EasyStore:');
        console.log('─'.repeat(50));
        
        const orders = await api.fetchOrders({ limit: 10 });
        const ordersWithBookings = [];
        
        orders.forEach(order => {
            let hasBooking = false;
            if (order.line_items) {
                order.line_items.forEach(item => {
                    if (item.properties?.length > 0) {
                        const bookingDate = item.properties.find(p => p.name === 'Booking Date');
                        const bookingTime = item.properties.find(p => p.name === 'Booking Time');
                        if (bookingDate && bookingTime) {
                            hasBooking = true;
                            ordersWithBookings.push({
                                id: order.id,
                                number: order.order_number,
                                status: order.financial_status,
                                date: bookingDate.value,
                                time: bookingTime.value,
                                product: item.name
                            });
                        }
                    }
                });
            }
            
            console.log(`${hasBooking ? '📅' : '  '} Order #${order.order_number} (${order.financial_status}) - ID: ${order.id}`);
        });
        
        if (ordersWithBookings.length === 0) {
            console.log('\n❌ No orders with booking properties found!');
            console.log('Please place an order with booking date/time selected.');
            return;
        }
        
        // Step 2: Show orders with bookings
        console.log('\n📅 Orders with Booking Properties:');
        console.log('─'.repeat(50));
        ordersWithBookings.forEach(order => {
            console.log(`Order #${order.number}: ${order.product} on ${order.date} at ${order.time} (${order.status})`);
        });
        
        // Step 3: Ask which order to sync
        const paidOrders = ordersWithBookings.filter(o => o.status === 'paid');
        const orderToSync = paidOrders.length > 0 ? paidOrders[0] : ordersWithBookings[0];
        
        console.log(`\n🔄 Syncing Order #${orderToSync.number} (ID: ${orderToSync.id})...`);
        
        // Step 4: Initialize sync engine
        const syncEngine = getSyncEngine({
            calendarId: process.env.CALENDAR_ID || 'primary',
            timezone: 'Asia/Manila',
            sessionDuration: 60,
            bufferTime: 15
        });
        await syncEngine.initialize();
        
        // Step 5: Sync the order
        const syncOptions = {
            force: true, // Force sync even if already processed
            allowUnpaid: orderToSync.status !== 'paid' // Allow unpaid if needed
        };
        
        const result = await syncEngine.syncOrder(orderToSync.id.toString(), syncOptions);
        
        // Step 6: Show results
        console.log('\n📊 Sync Results:');
        console.log('─'.repeat(50));
        
        if (result.success) {
            console.log('✅ Order synced successfully!');
            
            if (result.bookings && result.bookings.length > 0) {
                console.log('\n📅 Calendar Events Created:');
                result.bookings.forEach(booking => {
                    console.log(`- ${booking.productName}`);
                    console.log(`  Date: ${booking.bookingDate}`);
                    console.log(`  Time: ${booking.bookingTime}`);
                    if (booking.calendarEventLink) {
                        console.log(`  📎 View in Calendar: ${booking.calendarEventLink}`);
                    }
                });
            }
        } else {
            console.log('❌ Sync failed!');
            console.log('Errors:', result.errors);
        }
        
        // Step 7: Show database status
        console.log('\n💾 Database Status:');
        console.log('─'.repeat(50));
        const dbStatus = await dataAccess.getSyncStatus();
        console.log(`Processed Orders: ${dbStatus.processedOrders}`);
        console.log(`Orders in Retry Queue: ${dbStatus.retryQueueSize}`);
        if (dbStatus.metrics) {
            console.log(`Success Rate: ${dbStatus.metrics.total_orders > 0 ? 
                Math.round((dbStatus.metrics.successful_orders / dbStatus.metrics.total_orders) * 100) : 0}%`);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
    } finally {
        await dataAccess.close();
    }
}

// Run the test
testOrderSync();