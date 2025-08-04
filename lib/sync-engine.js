const { getEasyStoreService } = require('./easystore-service');
const { getCalendarService } = require('./calendar-service');
const OrderProcessor = require('./order-processor');
const dataAccess = require('./data-access');
const syncState = require('./sync-state');

class SyncEngine {
    constructor(config = {}) {
        this.config = {
            batchSize: config.batchSize || 50,
            delayBetweenOrders: config.delayBetweenOrders || 1000, // 1 second
            maxRetries: config.maxRetries || 3,
            ...config
        };
        
        this.easyStoreService = null;
        this.calendarService = null;
        this.orderProcessor = null;
        this.isRunning = false;
        this.syncStats = {
            startTime: null,
            endTime: null,
            totalOrders: 0,
            processedOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            skippedOrders: 0
        };
    }
    
    // Initialize services
    async initialize() {
        try {
            // Initialize EasyStore service
            this.easyStoreService = getEasyStoreService();
            
            // Initialize Calendar service
            this.calendarService = getCalendarService({
                calendarId: this.config.calendarId,
                timezone: this.config.timezone,
                sessionDuration: this.config.sessionDuration,
                bufferTime: this.config.bufferTime
            });
            await this.calendarService.initialize();
            
            // Initialize Order Processor
            this.orderProcessor = new OrderProcessor(this.calendarService);
            
            console.log('✅ Sync engine initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize sync engine:', error);
            throw error;
        }
    }
    
    // Run full synchronization
    async runFullSync(options = {}) {
        if (this.isRunning) {
            throw new Error('Sync is already running');
        }
        
        this.isRunning = true;
        this.resetStats();
        this.syncStats.startTime = new Date();
        
        try {
            console.log('🔄 Starting full synchronization...');
            
            // Get last sync state
            const lastSync = await dataAccess.getSyncStatus();
            const since = options.since || lastSync?.lastSync?.last_order_id || null;
            
            // Update sync state
            await syncState.updateSyncState({
                status: 'running',
                startedAt: new Date()
            });
            
            // Fetch new paid orders
            console.log('📥 Fetching new paid orders...');
            const fetchResult = await this.easyStoreService.fetchNewPaidOrders(since);
            
            console.log(`Found ${fetchResult.totalOrders} orders, ${fetchResult.processableOrders} with bookings`);
            this.syncStats.totalOrders = fetchResult.totalOrders;
            
            // Process orders in batches
            const orders = fetchResult.orders;
            let processedCount = 0;
            
            for (let i = 0; i < orders.length; i += this.config.batchSize) {
                const batch = orders.slice(i, i + this.config.batchSize);
                console.log(`\nProcessing batch ${Math.floor(i / this.config.batchSize) + 1} (${batch.length} orders)...`);
                
                const batchResult = await this.orderProcessor.processOrderBatch(
                    batch.map(o => o.order),
                    {
                        syncSource: 'full_sync',
                        delayBetweenOrders: this.config.delayBetweenOrders,
                        queueOnFailure: true,
                        onProgress: (progress) => {
                            processedCount++;
                            if (progress.orderResult.success) {
                                if (progress.orderResult.skipped) {
                                    console.log(`⏭️  Order #${progress.orderResult.orderNumber} - Already processed`);
                                } else {
                                    console.log(`✅ Order #${progress.orderResult.orderNumber} - Synced successfully`);
                                }
                            } else {
                                console.log(`❌ Order #${progress.orderResult.orderNumber} - Failed: ${progress.orderResult.errors.join(', ')}`);
                            }
                        }
                    }
                );
                
                // Update stats
                this.syncStats.processedOrders += batchResult.processed;
                this.syncStats.successfulOrders += batchResult.successful;
                this.syncStats.failedOrders += batchResult.failed;
                this.syncStats.skippedOrders += batchResult.skipped;
                
                // Update sync state with progress
                if (batch.length > 0) {
                    const lastOrder = batch[batch.length - 1].order;
                    await syncState.updateSyncState({
                        lastOrderId: lastOrder.id.toString(),
                        lastSyncTime: new Date(lastOrder.updated_at),
                        ordersProcessed: this.syncStats.processedOrders
                    });
                }
            }
            
            // Process retry queue
            await this.processRetryQueue();
            
            // Update final sync state
            this.syncStats.endTime = new Date();
            await syncState.updateSyncState({
                status: 'completed',
                completedAt: this.syncStats.endTime,
                ordersProcessed: this.syncStats.processedOrders,
                ordersSuccessful: this.syncStats.successfulOrders,
                ordersFailed: this.syncStats.failedOrders
            });
            
            // Update metrics
            await syncState.updateSyncMetrics({
                totalSyncs: 1,
                successfulSyncs: this.syncStats.failedOrders === 0 ? 1 : 0,
                failedSyncs: this.syncStats.failedOrders > 0 ? 1 : 0,
                totalOrders: this.syncStats.processedOrders,
                successfulOrders: this.syncStats.successfulOrders,
                failedOrders: this.syncStats.failedOrders
            });
            
            console.log('\n✅ Synchronization completed!');
            console.log(this.getSyncSummary());
            
            return this.syncStats;
            
        } catch (error) {
            console.error('❌ Sync failed:', error);
            
            // Update sync state
            await syncState.updateSyncState({
                status: 'failed',
                errorMessage: error.message,
                completedAt: new Date()
            });
            
            throw error;
            
        } finally {
            this.isRunning = false;
        }
    }
    
    // Process retry queue
    async processRetryQueue() {
        try {
            const retryItems = await dataAccess.getRetryQueue();
            
            if (retryItems.length === 0) {
                return;
            }
            
            console.log(`\n🔁 Processing ${retryItems.length} items from retry queue...`);
            
            for (const item of retryItems) {
                if (item.retry_count >= this.config.maxRetries) {
                    console.log(`⏭️  Order ${item.order_id} - Max retries exceeded`);
                    continue;
                }
                
                try {
                    const orderData = JSON.parse(item.order_data);
                    const result = await this.orderProcessor.processOrder(orderData, {
                        syncSource: 'retry_queue',
                        force: true // Try again even if marked as processed
                    });
                    
                    if (result.success) {
                        await dataAccess.removeFromRetryQueue(item.order_id);
                        console.log(`✅ Order #${result.orderNumber} - Retry successful`);
                        this.syncStats.successfulOrders++;
                        this.syncStats.failedOrders--;
                    } else {
                        await dataAccess.updateRetryCount(item.order_id, item.retry_count + 1);
                        console.log(`❌ Order #${result.orderNumber} - Retry failed`);
                    }
                    
                } catch (error) {
                    console.error(`Error processing retry for order ${item.order_id}:`, error);
                    await dataAccess.updateRetryCount(item.order_id, item.retry_count + 1);
                }
                
                // Delay between retries
                await new Promise(resolve => setTimeout(resolve, this.config.delayBetweenOrders));
            }
            
        } catch (error) {
            console.error('Error processing retry queue:', error);
        }
    }
    
    // Sync a specific order by ID
    async syncOrder(orderId, options = {}) {
        try {
            console.log(`🔄 Syncing order ${orderId}...`);
            
            // Fetch order from EasyStore
            const orderData = await this.easyStoreService.fetchOrderById(orderId);
            
            if (!orderData.order) {
                throw new Error('Order not found');
            }
            
            // Process the order
            const result = await this.orderProcessor.processOrder(orderData.order, {
                ...options,
                syncSource: 'manual_sync'
            });
            
            if (result.success) {
                console.log(`✅ Order #${result.orderNumber} synced successfully`);
            } else {
                console.log(`❌ Order #${result.orderNumber} sync failed: ${result.errors.join(', ')}`);
            }
            
            return result;
            
        } catch (error) {
            console.error(`Error syncing order ${orderId}:`, error);
            throw error;
        }
    }
    
    // Get sync summary
    getSyncSummary() {
        const duration = this.syncStats.endTime 
            ? Math.round((this.syncStats.endTime - this.syncStats.startTime) / 1000)
            : 0;
        
        return `
Sync Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Orders Found: ${this.syncStats.totalOrders}
Processed: ${this.syncStats.processedOrders}
Successful: ${this.syncStats.successfulOrders}
Failed: ${this.syncStats.failedOrders}
Skipped: ${this.syncStats.skippedOrders}
Duration: ${duration} seconds
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }
    
    // Reset statistics
    resetStats() {
        this.syncStats = {
            startTime: null,
            endTime: null,
            totalOrders: 0,
            processedOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            skippedOrders: 0
        };
    }
    
    // Health check
    async healthCheck() {
        const checks = {
            easyStore: { healthy: false },
            calendar: { healthy: false },
            database: { healthy: false }
        };
        
        try {
            // Check EasyStore
            if (this.easyStoreService) {
                checks.easyStore = await this.easyStoreService.healthCheck();
            }
            
            // Check Calendar
            if (this.calendarService) {
                checks.calendar = await this.calendarService.healthCheck();
            }
            
            // Check Database
            checks.database = await dataAccess.healthCheck();
            
        } catch (error) {
            console.error('Health check error:', error);
        }
        
        return {
            healthy: checks.easyStore.healthy && checks.calendar.healthy && checks.database,
            services: checks,
            isRunning: this.isRunning,
            lastSync: (await dataAccess.getSyncStatus()).lastSync
        };
    }
}

// Create singleton instance
let engineInstance = null;

function getSyncEngine(config = {}) {
    if (!engineInstance) {
        engineInstance = new SyncEngine(config);
    }
    return engineInstance;
}

module.exports = {
    SyncEngine,
    getSyncEngine
};