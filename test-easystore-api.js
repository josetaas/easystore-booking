require('dotenv').config();
const { EasyStoreAPI, QueryBuilder } = require('./lib/easystore-api');

async function testEasyStoreAPI() {
    console.log('Testing EasyStore API Integration...\n');
    
    // Check if credentials are configured
    if (!process.env.EASYSTORE_API_URL || !process.env.EASYSTORE_ACCESS_TOKEN) {
        console.error('❌ Missing EasyStore credentials in .env file');
        console.log('\nPlease add the following to your .env file:');
        console.log('EASYSTORE_API_URL=https://yourstorename.easy.co');
        console.log('EASYSTORE_ACCESS_TOKEN=your-api-token');
        return;
    }
    
    // Initialize API client
    const api = new EasyStoreAPI({
        storeUrl: process.env.EASYSTORE_API_URL,
        accessToken: process.env.EASYSTORE_ACCESS_TOKEN,
        debug: true
    });
    
    try {
        // Test 1: Health check
        console.log('1. Testing API connection...');
        const health = await api.healthCheck();
        console.log(health.healthy ? '✅ API connection successful' : `❌ API connection failed: ${health.error}`);
        console.log('');
        
        if (!health.healthy) {
            return;
        }
        
        // Test 2: Fetch recent orders
        console.log('2. Fetching recent orders (limit 5)...');
        const recentOrders = await api.fetchOrders({ limit: 5 });
        console.log(`✅ Found ${recentOrders.length} orders`);
        
        if (recentOrders.length > 0) {
            console.log('\nFirst order summary:');
            const order = recentOrders[0];
            console.log(`- Order #${order.order_number}`);
            console.log(`- Customer: ${order.customer?.name || 'N/A'}`);
            console.log(`- Status: ${order.financial_status}`);
            console.log(`- Total: ${order.currency} ${order.total_price}`);
        }
        console.log('');
        
        // Test 3: Test pagination
        console.log('3. Testing pagination...');
        let pageCount = 0;
        let totalOrders = 0;
        
        for await (const orders of api.paginateOrders({ limit: 10 })) {
            pageCount++;
            totalOrders += orders.length;
            console.log(`  Page ${pageCount}: ${orders.length} orders`);
            
            // Only fetch first 3 pages for testing
            if (pageCount >= 3) break;
        }
        console.log(`✅ Pagination working - fetched ${totalOrders} orders across ${pageCount} pages`);
        console.log('');
        
        // Test 4: Test query builders
        console.log('4. Testing query builders...');
        
        // Test paid orders query
        const paidQuery = QueryBuilder.buildPaidOrdersQuery(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
        console.log('Paid orders query:', paidQuery);
        
        const paidOrders = await api.fetchOrders(paidQuery);
        console.log(`✅ Found ${paidOrders.length} paid orders from last 7 days`);
        console.log('');
        
        // Test 5: Check for booking properties
        console.log('5. Checking for orders with booking properties...');
        let bookingOrdersFound = 0;
        
        for (const order of recentOrders) {
            if (order.line_items) {
                for (const item of order.line_items) {
                    if (item.properties) {
                        const bookingDate = item.properties.find(p => p.name === 'Booking Date');
                        const bookingTime = item.properties.find(p => p.name === 'Booking Time');
                        
                        if (bookingDate || bookingTime) {
                            bookingOrdersFound++;
                            console.log(`  Order #${order.order_number}:`);
                            console.log(`    - Product: ${item.name}`);
                            if (bookingDate) console.log(`    - Booking Date: ${bookingDate.value}`);
                            if (bookingTime) console.log(`    - Booking Time: ${bookingTime.value}`);
                        }
                    }
                }
            }
        }
        
        if (bookingOrdersFound > 0) {
            console.log(`✅ Found ${bookingOrdersFound} orders with booking properties`);
        } else {
            console.log('ℹ️  No orders with booking properties found in recent orders');
        }
        console.log('');
        
        // Test 6: Rate limiting test
        console.log('6. Testing rate limiting (making 5 rapid requests)...');
        const startTime = Date.now();
        const promises = [];
        
        for (let i = 0; i < 5; i++) {
            promises.push(api.fetchOrders({ limit: 1 }));
        }
        
        await Promise.all(promises);
        const duration = Date.now() - startTime;
        console.log(`✅ Completed 5 requests in ${duration}ms (expected ~2000ms with rate limiting)`);
        
        console.log('\n✅ All tests completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.statusCode) {
            console.error(`   Status code: ${error.statusCode}`);
        }
        if (error.response) {
            console.error('   Response:', error.response);
        }
    }
}

// Run tests
testEasyStoreAPI().catch(console.error);