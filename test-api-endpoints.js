#!/usr/bin/env node
require('dotenv').config();
const http = require('http');

const API_KEY = process.env.API_KEY || 'your-secret-api-key';
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

// Helper function to make HTTP requests
function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = {
                        status: res.statusCode,
                        headers: res.headers,
                        body: JSON.parse(body)
                    };
                    resolve(response);
                } catch (error) {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: body
                    });
                }
            });
        });
        
        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

async function testEndpoints() {
    console.log('🧪 Testing API Endpoints\n');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
    console.log('─'.repeat(50));
    
    const tests = [
        {
            name: 'Health Check (No Auth)',
            method: 'GET',
            path: '/health',
            headers: {}
        },
        {
            name: 'Sync Status (No API Key)',
            method: 'GET',
            path: '/api/sync-status',
            headers: {},
            expectStatus: 401
        },
        {
            name: 'Sync Status (With API Key)',
            method: 'GET',
            path: '/api/sync-status',
            headers: {
                'x-api-key': API_KEY
            }
        },
        {
            name: 'Sync History',
            method: 'GET',
            path: '/api/sync-history?limit=5',
            headers: {
                'x-api-key': API_KEY
            }
        },
        {
            name: 'Sync Order (Missing Fields)',
            method: 'POST',
            path: '/api/sync-order',
            headers: {
                'x-api-key': API_KEY,
                'content-type': 'application/json'
            },
            body: {},
            expectStatus: 400
        },
        {
            name: 'Sync Order (Valid)',
            method: 'POST',
            path: '/api/sync-order',
            headers: {
                'x-api-key': API_KEY,
                'content-type': 'application/json'
            },
            body: {
                orderId: '89966528' // Order #1008
            }
        },
        {
            name: 'Batch Sync (Dry Run)',
            method: 'POST',
            path: '/api/sync-orders',
            headers: {
                'x-api-key': API_KEY,
                'content-type': 'application/json'
            },
            body: {
                limit: 10,
                dryRun: true
            }
        },
        {
            name: 'Retry Failed Orders',
            method: 'POST',
            path: '/api/retry-failed-orders',
            headers: {
                'x-api-key': API_KEY,
                'content-type': 'application/json'
            },
            body: {}
        }
    ];
    
    for (const test of tests) {
        console.log(`\n📍 ${test.name}`);
        console.log(`${test.method} ${test.path}`);
        
        try {
            const url = new URL(BASE_URL + test.path);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: test.method,
                headers: test.headers
            };
            
            const response = await makeRequest(options, test.body);
            
            const expectedStatus = test.expectStatus || 200;
            const statusEmoji = response.status === expectedStatus ? '✅' : '❌';
            
            console.log(`${statusEmoji} Status: ${response.status}`);
            
            if (response.headers['x-ratelimit-limit']) {
                console.log(`   Rate Limit: ${response.headers['x-ratelimit-remaining']}/${response.headers['x-ratelimit-limit']}`);
            }
            
            if (response.body) {
                if (response.body.success !== undefined) {
                    console.log(`   Success: ${response.body.success}`);
                }
                if (response.body.error) {
                    console.log(`   Error: ${response.body.error.code} - ${response.body.error.message}`);
                }
                if (response.body.message) {
                    console.log(`   Message: ${response.body.message}`);
                }
                
                // Show specific data for some endpoints
                if (test.name === 'Sync Status (With API Key)' && response.body.success) {
                    console.log(`   Orders Processed: ${response.body.ordersProcessed}`);
                    console.log(`   Pending Retries: ${response.body.pendingRetries}`);
                    console.log(`   Sync Health: ${response.body.syncHealth}`);
                }
                
                if (test.name === 'Batch Sync (Dry Run)' && response.body.success) {
                    console.log(`   Total Orders: ${response.body.totalOrders}`);
                    console.log(`   Orders with Bookings: ${response.body.ordersWithBookings}`);
                }
            }
            
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        }
    }
    
    // Test rate limiting
    console.log('\n📍 Rate Limiting Test');
    console.log('Making 5 rapid requests...');
    
    const rateLimitPromises = [];
    for (let i = 0; i < 5; i++) {
        const options = {
            hostname: 'localhost',
            port: process.env.PORT || 3000,
            path: '/api/sync-status',
            method: 'GET',
            headers: {
                'x-api-key': API_KEY
            }
        };
        rateLimitPromises.push(makeRequest(options));
    }
    
    const rateLimitResults = await Promise.all(rateLimitPromises);
    const successCount = rateLimitResults.filter(r => r.status === 200).length;
    const rateLimitedCount = rateLimitResults.filter(r => r.status === 429).length;
    
    console.log(`✅ Successful: ${successCount}`);
    console.log(`🚫 Rate Limited: ${rateLimitedCount}`);
    
    console.log('\n✅ API endpoint tests completed!');
}

// Run tests
testEndpoints().catch(console.error);