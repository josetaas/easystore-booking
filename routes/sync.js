const express = require('express');
const router = express.Router();
const { getSyncEngine } = require('../lib/sync-engine');
const dataAccess = require('../lib/data-access');

// Middleware for request validation
const validateRequest = (requiredFields) => {
    return (req, res, next) => {
        const missingFields = requiredFields.filter(field => !req.body[field]);
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_FIELDS',
                    message: `Missing required fields: ${missingFields.join(', ')}`,
                    fields: missingFields
                }
            });
        }
        next();
    };
};

// Order processing locks to prevent concurrent processing
const processingLocks = new Map();

const lockOrder = (orderId) => {
    if (processingLocks.has(orderId)) {
        return false;
    }
    processingLocks.set(orderId, Date.now());
    return true;
};

const unlockOrder = (orderId) => {
    processingLocks.delete(orderId);
};

// Clean up stale locks after 5 minutes
setInterval(() => {
    const now = Date.now();
    const staleTime = 5 * 60 * 1000; // 5 minutes
    
    for (const [orderId, timestamp] of processingLocks.entries()) {
        if (now - timestamp > staleTime) {
            processingLocks.delete(orderId);
        }
    }
}, 60000); // Check every minute

/**
 * POST /api/sync-order
 * Sync a specific order (frontend trigger)
 */
router.post('/sync-order', validateRequest(['orderId']), async (req, res) => {
    const { orderId, orderNumber } = req.body;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[${requestId}] Sync request for order ${orderId}`);
    
    try {
        // Check if order is already being processed
        if (!lockOrder(orderId)) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'ORDER_LOCKED',
                    message: 'Order is already being processed',
                    details: { orderId }
                }
            });
        }
        
        // Initialize sync engine
        const syncEngine = getSyncEngine({
            calendarId: process.env.CALENDAR_ID || 'primary',
            timezone: process.env.TIMEZONE || 'Asia/Manila',
            sessionDuration: parseInt(process.env.SESSION_DURATION) || 60,
            bufferTime: parseInt(process.env.BUFFER_TIME) || 15
        });
        
        await syncEngine.initialize();
        
        // Sync the specific order
        const result = await syncEngine.syncOrder(orderId, {
            force: false, // Don't force if already processed
            allowUnpaid: false, // Only sync paid orders
            syncSource: 'frontend_trigger'
        });
        
        if (result.success) {
            // Extract calendar event details
            const eventDetails = result.bookings && result.bookings.length > 0
                ? result.bookings.map(b => ({
                    productName: b.productName,
                    bookingDate: b.bookingDate,
                    bookingTime: b.bookingTime,
                    calendarEventId: b.calendarEventId,
                    calendarEventLink: b.calendarEventLink
                }))
                : [];
            
            res.json({
                success: true,
                message: 'Order synchronized successfully',
                orderId: result.orderId,
                orderNumber: result.orderNumber,
                events: eventDetails
            });
        } else {
            // Determine appropriate error code
            let errorCode = 'SYNC_FAILED';
            if (result.errors.includes('Order is not paid')) {
                errorCode = 'ORDER_NOT_PAID';
            } else if (result.errors.includes('No booking data found in order')) {
                errorCode = 'NO_BOOKING_DATA';
            } else if (result.skipped) {
                errorCode = 'ALREADY_PROCESSED';
            }
            
            res.status(400).json({
                success: false,
                error: {
                    code: errorCode,
                    message: result.errors.join('; ') || 'Order sync failed',
                    details: {
                        orderId: result.orderId,
                        orderNumber: result.orderNumber,
                        errors: result.errors
                    }
                }
            });
        }
        
    } catch (error) {
        console.error(`[${requestId}] Error syncing order:`, error);
        
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'An error occurred while syncing the order',
                details: {
                    orderId,
                    error: error.message
                }
            }
        });
        
    } finally {
        unlockOrder(orderId);
    }
});

/**
 * POST /api/sync-orders
 * Batch sync orders
 */
router.post('/sync-orders', async (req, res) => {
    const { since, limit = 50, dryRun = false } = req.body;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[${requestId}] Batch sync request - since: ${since}, limit: ${limit}, dryRun: ${dryRun}`);
    
    try {
        // Initialize sync engine
        const syncEngine = getSyncEngine({
            calendarId: process.env.CALENDAR_ID || 'primary',
            timezone: process.env.TIMEZONE || 'Asia/Manila',
            sessionDuration: parseInt(process.env.SESSION_DURATION) || 60,
            bufferTime: parseInt(process.env.BUFFER_TIME) || 15,
            batchSize: Math.min(limit, 100) // Cap at 100 for safety
        });
        
        await syncEngine.initialize();
        
        if (dryRun) {
            // For dry run, just fetch and analyze orders without processing
            const { getEasyStoreService } = require('../lib/easystore-service');
            const easyStoreService = getEasyStoreService();
            
            const fetchResult = await easyStoreService.fetchNewPaidOrders(since);
            
            res.json({
                success: true,
                dryRun: true,
                totalOrders: fetchResult.totalOrders,
                ordersWithBookings: fetchResult.processableOrders,
                orders: fetchResult.orders.map(o => ({
                    orderId: o.order.id,
                    orderNumber: o.order.order_number,
                    bookings: o.bookings.map(b => ({
                        product: b.productName,
                        date: b.bookingDate,
                        time: b.bookingTime
                    }))
                }))
            });
        } else {
            // Run actual sync
            const result = await syncEngine.runFullSync({ since });
            
            res.json({
                success: result.failedOrders === 0,
                ordersChecked: result.totalOrders,
                ordersProcessed: result.processedOrders,
                ordersSuccessful: result.successfulOrders,
                ordersFailed: result.failedOrders,
                ordersSkipped: result.skippedOrders,
                duration: result.endTime 
                    ? Math.round((result.endTime - result.startTime) / 1000) 
                    : null,
                errors: result.failedOrders > 0 
                    ? 'Check sync logs for detailed error information' 
                    : null
            });
        }
        
    } catch (error) {
        console.error(`[${requestId}] Error in batch sync:`, error);
        
        res.status(500).json({
            success: false,
            error: {
                code: 'BATCH_SYNC_FAILED',
                message: 'Failed to execute batch synchronization',
                details: {
                    error: error.message
                }
            }
        });
    }
});

/**
 * GET /api/sync-status
 * Get current sync status
 */
router.get('/sync-status', async (req, res) => {
    try {
        const status = await dataAccess.getSyncStatus();
        const metrics = status.metrics || {};
        
        // Calculate sync health
        let syncHealth = 'healthy';
        if (metrics.total_orders > 0) {
            const successRate = metrics.successful_orders / metrics.total_orders;
            if (successRate < 0.5) {
                syncHealth = 'failing';
            } else if (successRate < 0.9) {
                syncHealth = 'degraded';
            }
        }
        
        // Calculate last sync time
        const lastSyncTime = status.lastSync?.completed_at || status.lastSync?.started_at;
        const timeSinceLastSync = lastSyncTime 
            ? Math.round((Date.now() - new Date(lastSyncTime).getTime()) / 1000 / 60) // minutes
            : null;
        
        res.json({
            success: true,
            lastSync: lastSyncTime,
            lastSyncStatus: status.lastSync?.status || 'never',
            timeSinceLastSync: timeSinceLastSync ? `${timeSinceLastSync} minutes` : 'never',
            ordersProcessed: status.processedOrders || 0,
            pendingRetries: status.retryQueueSize || 0,
            syncHealth,
            metrics: {
                totalSyncs: metrics.total_syncs || 0,
                successfulSyncs: metrics.successful_syncs || 0,
                failedSyncs: metrics.failed_syncs || 0,
                totalOrders: metrics.total_orders || 0,
                successfulOrders: metrics.successful_orders || 0,
                failedOrders: metrics.failed_orders || 0,
                successRate: metrics.total_orders > 0 
                    ? Math.round((metrics.successful_orders / metrics.total_orders) * 100) 
                    : 0
            }
        });
        
    } catch (error) {
        console.error('Error fetching sync status:', error);
        
        res.status(500).json({
            success: false,
            error: {
                code: 'STATUS_FETCH_FAILED',
                message: 'Failed to fetch sync status',
                details: {
                    error: error.message
                }
            }
        });
    }
});

/**
 * POST /api/retry-failed-orders
 * Retry failed orders
 */
router.post('/retry-failed-orders', async (req, res) => {
    const { orderIds } = req.body;
    
    try {
        const retryQueue = await dataAccess.getRetryQueue();
        
        // Filter by specific order IDs if provided
        const ordersToRetry = orderIds 
            ? retryQueue.filter(item => orderIds.includes(item.order_id))
            : retryQueue;
        
        if (ordersToRetry.length === 0) {
            return res.json({
                success: true,
                message: 'No orders to retry',
                retriedCount: 0
            });
        }
        
        // Initialize sync engine
        const syncEngine = getSyncEngine({
            calendarId: process.env.CALENDAR_ID || 'primary',
            timezone: process.env.TIMEZONE || 'Asia/Manila',
            sessionDuration: parseInt(process.env.SESSION_DURATION) || 60,
            bufferTime: parseInt(process.env.BUFFER_TIME) || 15
        });
        
        await syncEngine.initialize();
        
        // Process retry queue
        const results = {
            total: ordersToRetry.length,
            successful: 0,
            failed: 0
        };
        
        for (const item of ordersToRetry) {
            try {
                const orderData = JSON.parse(item.order_data);
                const result = await syncEngine.orderProcessor.processOrder(orderData, {
                    syncSource: 'manual_retry',
                    force: true,
                    allowUnpaid: true // Allow retrying unpaid orders if they were queued
                });
                
                if (result.success) {
                    await dataAccess.removeFromRetryQueue(item.order_id);
                    results.successful++;
                } else {
                    await dataAccess.updateRetryCount(item.order_id, item.retry_count + 1);
                    results.failed++;
                }
                
            } catch (error) {
                console.error(`Error retrying order ${item.order_id}:`, error);
                results.failed++;
            }
        }
        
        res.json({
            success: true,
            message: `Retry completed: ${results.successful} successful, ${results.failed} failed`,
            retriedCount: results.total,
            successful: results.successful,
            failed: results.failed
        });
        
    } catch (error) {
        console.error('Error processing retry queue:', error);
        
        res.status(500).json({
            success: false,
            error: {
                code: 'RETRY_FAILED',
                message: 'Failed to retry orders',
                details: {
                    error: error.message
                }
            }
        });
    }
});

/**
 * GET /api/sync-history
 * Get recent sync history
 */
router.get('/sync-history', async (req, res) => {
    const { limit = 10 } = req.query;
    
    try {
        const recentOrders = await dataAccess.getRecentProcessedOrders(parseInt(limit));
        
        res.json({
            success: true,
            orders: recentOrders.map(order => ({
                orderId: order.order_id,
                orderNumber: order.order_number,
                processedAt: order.processed_at,
                bookingDate: order.booking_date,
                bookingTime: order.booking_time,
                product: order.booking_product,
                customer: order.customer_name,
                calendarEventId: order.calendar_event_id,
                syncSource: order.sync_source
            }))
        });
        
    } catch (error) {
        console.error('Error fetching sync history:', error);
        
        res.status(500).json({
            success: false,
            error: {
                code: 'HISTORY_FETCH_FAILED',
                message: 'Failed to fetch sync history',
                details: {
                    error: error.message
                }
            }
        });
    }
});

module.exports = router;