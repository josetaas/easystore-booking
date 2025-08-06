#!/usr/bin/env node

// Test script for payment detection functionality
// Run this to verify that the payment detection is working correctly

const fs = require('fs');
const path = require('path');

console.log('=== Payment Detection Test Script ===\n');

// Read the inject.js file
const injectPath = path.join(__dirname, 'scripts', 'inject.js');
const injectContent = fs.readFileSync(injectPath, 'utf8');

// Check for payment detection module
console.log('1. Checking for PaymentDetector module...');
if (injectContent.includes('const PaymentDetector')) {
    console.log('✅ PaymentDetector module found');
} else {
    console.log('❌ PaymentDetector module NOT found');
}

// Check for configuration
console.log('\n2. Checking configuration...');
if (injectContent.includes('enablePaymentDetection')) {
    console.log('✅ Payment detection configuration found');
} else {
    console.log('❌ Payment detection configuration NOT found');
}

// Check for API key configuration
console.log('\n3. Checking API key configuration...');
if (injectContent.includes('apiKey:')) {
    console.log('✅ API key configuration found');
    console.log('⚠️  WARNING: API key is hardcoded in the script. Consider using a more secure method in production.');
} else {
    console.log('❌ API key configuration NOT found');
}

// Check for sync endpoint
console.log('\n4. Checking sync endpoint...');
if (injectContent.includes('/api/sync-order')) {
    console.log('✅ Sync endpoint configured');
} else {
    console.log('❌ Sync endpoint NOT configured');
}

// Check for order detection patterns
console.log('\n5. Checking order detection patterns...');
const patterns = [
    'isOrderSuccessPage',
    'extractOrderId',
    'extractOrderNumber',
    'triggerSync'
];

patterns.forEach(pattern => {
    if (injectContent.includes(pattern)) {
        console.log(`✅ ${pattern} function found`);
    } else {
        console.log(`❌ ${pattern} function NOT found`);
    }
});

// Show test URLs
console.log('\n=== Test URLs ===');
console.log('\nTo test the payment detection, visit these URLs after placing an order:');
console.log('1. https://yourstorename.easy.co/orders/{order-id}?payment_type=sf_gateway_return');
console.log('2. https://yourstorename.easy.co/orders/{order-id}');
console.log('\nReplace {order-id} with an actual order ID.');

// Show console debugging
console.log('\n=== Debugging ===');
console.log('\nOpen browser console on the order success page to see:');
console.log('- [PaymentDetector] messages for debugging');
console.log('- Network tab to see sync API calls');
console.log('- sessionStorage to check sync_triggered_{orderId} flags');

console.log('\n=== Configuration in inject.js ===');
console.log('\nMake sure these are configured correctly:');
console.log('- backendUrl: Should point to your backend server');
console.log('- apiKey: Should match the API_KEY in your .env file');
console.log('- enablePaymentDetection: Should be true');

console.log('\n✅ Test script completed!');