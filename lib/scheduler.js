const cron = require('node-cron');
const dataAccess = require('./data-access');
const { getSyncEngine } = require('./sync-engine');
const { getEasyStoreService } = require('./easystore-service');

class OrderSyncScheduler {
    constructor(config = {}) {
        this.config = {
            interval: config.interval || process.env.SYNC_INTERVAL || '*/5 * * * *', // Every 5 minutes
            batchSize: parseInt(config.batchSize || process.env.SYNC_BATCH_SIZE || 50),
            overlapMinutes: parseInt(config.overlapMinutes || 5),
            maxSyncDuration: parseInt(config.maxSyncDuration || 10 * 60 * 1000), // 10 minutes
            retryAttempts: parseInt(config.retryAttempts || 3),
            retryDelay: parseInt(config.retryDelay || 60 * 1000), // 1 minute
            enabled: config.enabled !== false && process.env.SYNC_ENABLED !== 'false'
        };
        
        this.task = null;
        this.isRunning = false;
        this.syncStartTime = null;
        this.syncTimeout = null;
        this.metrics = {
            totalSyncs: 0,
            successfulSyncs: 0,
            failedSyncs: 0,
            totalOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            lastSyncDuration: null,
            averageSyncDuration: null
        };
    }
    
    async start() {
        if (!this.config.enabled) {
            console.log('[Scheduler] Sync scheduler is disabled');
            return;
        }
        
        if (this.task) {
            console.log('[Scheduler] Scheduler already started');
            return;
        }
        
        console.log(`[Scheduler] Starting sync scheduler with interval: ${this.config.interval}`);
        
        // Run initial sync
        await this.runSync();
        
        // Schedule recurring syncs
        this.task = cron.schedule(this.config.interval, async () => {
            await this.runSync();
        });
        
        console.log('[Scheduler] Sync scheduler started successfully');
    }
    
    stop() {
        if (this.task) {
            this.task.stop();
            this.task = null;
            console.log('[Scheduler] Sync scheduler stopped');
        }
        
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
            this.syncTimeout = null;
        }
    }
    
    async runSync() {
        console.log('[Scheduler] Starting sync job...');
        
        // Check if sync is already running
        if (await this.isSyncRunning()) {
            console.log('[Scheduler] Sync already in progress, skipping');
            return;
        }
        
        try {
            await this.markSyncRunning(true);
            this.syncStartTime = Date.now();
            
            // Set timeout for maximum sync duration
            this.syncTimeout = setTimeout(() => {
                console.error('[Scheduler] Sync exceeded maximum duration, marking as failed');
                this.handleSyncError(new Error('Sync exceeded maximum duration'));
            }, this.config.maxSyncDuration);
            
            // Get last sync timestamp
            const syncStatus = await dataAccess.getSyncStatus();
            let lastSync = syncStatus?.lastSync?.last_sync_time;
            
            // Convert to Date object if needed
            if (lastSync && typeof lastSync === 'string') {
                lastSync = new Date(lastSync);
            } else if (!lastSync) {
                lastSync = new Date(Date.now() - 24 * 60 * 60 * 1000);
            }
            
            // Add overlap for safety
            const syncFrom = new Date(lastSync.getTime() - (this.config.overlapMinutes * 60 * 1000));
            
            console.log(`[Scheduler] Syncing orders since: ${syncFrom.toISOString()}`);
            
            // Fetch and process orders
            const easyStore = getEasyStoreService();
            const ordersData = await easyStore.fetchNewPaidOrders(syncFrom);
            
            console.log(`[Scheduler] Found ${ordersData.totalOrders} orders, ${ordersData.processableOrders} need processing`);
            
            // Process orders in batches
            const result = await this.processBatch(ordersData.orders);
            
            // Update sync state
            await this.updateSyncState({
                lastSync: new Date(),
                ordersChecked: ordersData.totalOrders,
                ordersProcessed: result.processed,
                ordersSuccessful: result.successful,
                ordersFailed: result.failed,
                success: result.failed === 0
            });
            
            // Update metrics
            this.updateMetrics(true, result);
            
            console.log(`[Scheduler] Sync completed: ${result.successful} successful, ${result.failed} failed`);
            
        } catch (error) {
            await this.handleSyncError(error);
        } finally {
            if (this.syncTimeout) {
                clearTimeout(this.syncTimeout);
                this.syncTimeout = null;
            }
            await this.markSyncRunning(false);
        }
    }
    
    async processBatch(orders) {
        const result = {
            processed: 0,
            successful: 0,
            failed: 0,
            errors: []
        };
        
        // Initialize sync engine
        const syncEngine = getSyncEngine();
        await syncEngine.initialize();
        
        // Process each order individually
        for (const orderData of orders) {
            try {
                const { order } = orderData;
                console.log(`[Scheduler] Processing order ${order.id} (${order.order_number})`);
                
                const syncResult = await syncEngine.syncOrder(order.id.toString());
                
                result.processed++;
                if (syncResult.success) {
                    result.successful++;
                } else {
                    result.failed++;
                    result.errors.push({
                        orderId: order.id,
                        error: syncResult.error || 'Unknown error'
                    });
                }
                
            } catch (error) {
                console.error(`[Scheduler] Error processing order:`, error);
                result.failed++;
                result.errors.push({
                    error: error.message,
                    orderId: orderData.order?.id
                });
            }
        }
        
        return result;
    }
    
    async isSyncRunning() {
        const syncLock = await dataAccess.getSyncLock();
        
        if (!syncLock || !syncLock.locked) {
            return false;
        }
        
        // Check if lock is stale (older than max duration)
        const lockAge = Date.now() - new Date(syncLock.locked_at).getTime();
        if (lockAge > this.config.maxSyncDuration) {
            console.log('[Scheduler] Found stale lock, cleaning up');
            await dataAccess.releaseSyncLock();
            return false;
        }
        
        return true;
    }
    
    async markSyncRunning(running) {
        if (running) {
            await dataAccess.acquireSyncLock();
            this.isRunning = true;
        } else {
            await dataAccess.releaseSyncLock();
            this.isRunning = false;
        }
    }
    
    async updateSyncState(syncData) {
        const duration = Date.now() - this.syncStartTime;
        
        await dataAccess.updateSyncStatus({
            last_sync_time: syncData.lastSync,
            last_sync_status: syncData.success ? 'completed' : 'failed',
            orders_checked: syncData.ordersChecked,
            orders_processed: syncData.ordersProcessed,
            orders_successful: syncData.ordersSuccessful,
            orders_failed: syncData.ordersFailed,
            sync_duration: duration
        });
    }
    
    async handleSyncError(error) {
        console.error('[Scheduler] Sync error:', error);
        
        const duration = Date.now() - this.syncStartTime;
        
        await dataAccess.updateSyncStatus({
            last_sync_time: new Date(),
            last_sync_status: 'failed',
            last_sync_error: error.message,
            sync_duration: duration
        });
        
        await dataAccess.recordSyncError({
            error: error.message,
            stack: error.stack,
            context: 'scheduler'
        });
        
        this.updateMetrics(false, { failed: 1 });
    }
    
    updateMetrics(success, result = {}) {
        this.metrics.totalSyncs++;
        
        if (success) {
            this.metrics.successfulSyncs++;
        } else {
            this.metrics.failedSyncs++;
        }
        
        if (result.processed) {
            this.metrics.totalOrders += result.processed;
            this.metrics.successfulOrders += result.successful || 0;
            this.metrics.failedOrders += result.failed || 0;
        }
        
        const duration = Date.now() - this.syncStartTime;
        this.metrics.lastSyncDuration = duration;
        
        // Calculate average duration
        if (this.metrics.averageSyncDuration) {
            this.metrics.averageSyncDuration = 
                (this.metrics.averageSyncDuration * (this.metrics.totalSyncs - 1) + duration) / 
                this.metrics.totalSyncs;
        } else {
            this.metrics.averageSyncDuration = duration;
        }
    }
    
    getMetrics() {
        return {
            ...this.metrics,
            successRate: this.metrics.totalSyncs > 0 
                ? Math.round((this.metrics.successfulSyncs / this.metrics.totalSyncs) * 100) 
                : 0,
            isRunning: this.isRunning,
            nextRun: this.task ? this.task.nextDate() : null
        };
    }
    
    async getStatus() {
        const syncStatus = await dataAccess.getSyncStatus();
        const metrics = this.getMetrics();
        
        return {
            scheduler: {
                enabled: this.config.enabled,
                running: this.isRunning,
                interval: this.config.interval,
                nextRun: metrics.nextRun
            },
            lastSync: syncStatus?.lastSync,
            metrics,
            health: this.getHealth(metrics)
        };
    }
    
    getHealth(metrics) {
        if (!metrics.totalSyncs) {
            return 'unknown';
        }
        
        const successRate = metrics.successRate;
        
        if (successRate >= 90) {
            return 'healthy';
        } else if (successRate >= 50) {
            return 'degraded';
        } else {
            return 'failing';
        }
    }
}

// Create singleton instance
let schedulerInstance = null;

function getScheduler(config = {}) {
    if (!schedulerInstance) {
        schedulerInstance = new OrderSyncScheduler(config);
    }
    return schedulerInstance;
}

module.exports = {
    OrderSyncScheduler,
    getScheduler
};