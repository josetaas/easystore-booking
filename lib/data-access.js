const db = require('./database');

/**
 * Data Access Layer
 * Provides a simplified interface for database operations
 */
class DataAccess {
    async initialize() {
        await db.initialize();
    }

    // Order operations
    async isOrderProcessed(orderId) {
        return await db.isOrderProcessed(orderId);
    }

    async markOrderProcessed(orderId, data) {
        return await db.markOrderProcessed(orderId, data);
    }

    async getProcessedOrder(orderId) {
        return await db.getProcessedOrder(orderId);
    }

    async getRecentProcessedOrders(limit = 10) {
        return await db.getRecentProcessedOrders(limit);
    }

    // Sync state operations
    async getLastSyncTimestamp() {
        return await db.getLastSyncTimestamp();
    }

    async updateLastSyncTimestamp(timestamp = new Date().toISOString()) {
        return await db.updateLastSyncTimestamp(timestamp);
    }

    async getLastProcessedOrderId() {
        return await db.getLastProcessedOrderId();
    }

    // Failure and retry operations
    async addSyncFailure(orderId, reason) {
        return await db.addSyncFailure(orderId, reason);
    }

    async addToRetryQueue(orderId, orderData, failureReason, failureCategory = 'temporary') {
        return await db.addToRetryQueue(orderId, orderData, failureReason, failureCategory);
    }

    async getRetryableFailures() {
        return await db.getRetryableFailures();
    }

    async updateRetryStatus(orderId, success = false, error = null) {
        return await db.updateRetryStatus(orderId, success, error);
    }

    // Metrics operations
    async startSyncMetric(source = 'backend_poll') {
        return await db.startSyncMetric(source);
    }

    async completeSyncMetric(syncId, data) {
        return await db.completeSyncMetric(syncId, data);
    }

    async getSyncStatus() {
        return await db.getSyncStatus();
    }
    
    async getRetryQueue(limit = 100) {
        return await db.getRetryableFailures(limit);
    }
    
    async removeFromRetryQueue(orderId) {
        return await db.removeFromRetryQueue(orderId);
    }
    
    async updateRetryCount(orderId, newCount) {
        return await db.updateRetryCount(orderId, newCount);
    }
    
    async getSyncMetrics() {
        return await db.getSyncMetrics();
    }
    
    // Sync lock operations
    async acquireSyncLock() {
        return await db.acquireSyncLock();
    }
    
    async releaseSyncLock() {
        return await db.releaseSyncLock();
    }
    
    async getSyncLock() {
        return await db.getSyncLock();
    }
    
    // Sync status operations
    async updateSyncStatus(status) {
        return await db.updateSyncStatus(status);
    }
    
    async recordSyncError(error) {
        return await db.recordSyncError(error);
    }

    // Transaction support
    async runTransaction(callback) {
        try {
            await db.db.exec('BEGIN TRANSACTION');
            const result = await callback();
            await db.db.exec('COMMIT');
            return result;
        } catch (error) {
            await db.db.exec('ROLLBACK');
            throw error;
        }
    }

    // Utility methods
    async healthCheck() {
        try {
            const result = await db.db.get('SELECT 1 as ok');
            return result?.ok === 1;
        } catch (error) {
            return false;
        }
    }

    async close() {
        await db.close();
    }
}

// Export singleton instance
module.exports = new DataAccess();