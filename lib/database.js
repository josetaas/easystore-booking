const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

class Database {
    constructor() {
        this.db = null;
        // Use local path if not in Docker container
        if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('/app/') && !fsSync.existsSync('/app')) {
            // Running locally but DATABASE_URL has Docker path
            this.dbPath = path.join(__dirname, '..', 'data', 'booking.db');
        } else {
            this.dbPath = process.env.DATABASE_URL?.replace('sqlite:', '') || path.join(__dirname, '..', 'data', 'booking.db');
        }
    }

    async initialize() {
        try {
            // Ensure directory exists
            const dir = path.dirname(this.dbPath);
            await fs.mkdir(dir, { recursive: true });

            // Open database connection
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });

            // Enable foreign keys
            await this.db.exec('PRAGMA foreign_keys = ON');

            // Create tables
            await this.createTables();

            console.log('✅ Database initialized successfully at:', this.dbPath);
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            throw error;
        }
    }

    async createTables() {
        // Create processed_orders table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS processed_orders (
                order_id VARCHAR(255) PRIMARY KEY,
                order_number VARCHAR(50),
                payment_status VARCHAR(50),
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                calendar_event_id VARCHAR(255),
                booking_date DATE,
                booking_time VARCHAR(20),
                booking_product VARCHAR(255),
                customer_name VARCHAR(255),
                customer_email VARCHAR(255),
                sync_source VARCHAR(50),
                retry_count INTEGER DEFAULT 0,
                last_error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for processed_orders
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_processed_orders_date ON processed_orders(booking_date);
            CREATE INDEX IF NOT EXISTS idx_processed_orders_product ON processed_orders(booking_product);
            CREATE INDEX IF NOT EXISTS idx_processed_orders_email ON processed_orders(customer_email);
        `);

        // Create sync_state table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY,
                status VARCHAR(50) DEFAULT 'idle',
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                last_order_id VARCHAR(255),
                last_sync_time TIMESTAMP,
                orders_processed INTEGER DEFAULT 0,
                orders_successful INTEGER DEFAULT 0,
                orders_failed INTEGER DEFAULT 0,
                error_message TEXT,
                last_sync_timestamp TIMESTAMP,
                last_processed_order_id VARCHAR(255),
                last_successful_sync TIMESTAMP,
                total_orders_processed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Initialize sync_state if empty
        const syncState = await this.db.get('SELECT COUNT(*) as count FROM sync_state');
        if (syncState.count === 0) {
            await this.db.run(`
                INSERT INTO sync_state (id, last_sync_timestamp, total_orders_processed)
                VALUES (1, datetime('now'), 0)
            `);
        }

        // Create sync_failures table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_failures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id VARCHAR(255),
                failure_reason TEXT,
                failure_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                retry_count INTEGER DEFAULT 0,
                next_retry_at TIMESTAMP,
                resolved_at TIMESTAMP,
                resolution VARCHAR(50)
            )
        `);

        // Create retry_queue table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS retry_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id VARCHAR(255) UNIQUE,
                order_data TEXT,
                failure_reason TEXT,
                failure_category VARCHAR(50),
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 5,
                last_attempt_at TIMESTAMP,
                next_retry_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP,
                resolution VARCHAR(50)
            )
        `);

        // Create sync_metrics table for monitoring
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_metrics (
                id INTEGER PRIMARY KEY,
                total_syncs INTEGER DEFAULT 0,
                successful_syncs INTEGER DEFAULT 0,
                failed_syncs INTEGER DEFAULT 0,
                total_orders INTEGER DEFAULT 0,
                successful_orders INTEGER DEFAULT 0,
                failed_orders INTEGER DEFAULT 0,
                last_sync_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create sync_lock table for preventing concurrent syncs
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_lock (
                id INTEGER PRIMARY KEY,
                locked BOOLEAN DEFAULT 0,
                locked_at TIMESTAMP,
                locked_by VARCHAR(255),
                process_id VARCHAR(255),
                expires_at TIMESTAMP
            )
        `);

        // Initialize sync_lock if empty
        const syncLock = await this.db.get('SELECT COUNT(*) as count FROM sync_lock');
        if (syncLock.count === 0) {
            await this.db.run('INSERT INTO sync_lock (id, locked) VALUES (1, 0)');
        }

        // Create sync_errors table for error tracking
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                error_message TEXT,
                error_stack TEXT,
                error_context VARCHAR(255),
                occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ All database tables created/verified');
    }

    // Order processing methods
    async isOrderProcessed(orderId) {
        const result = await this.db.get(
            'SELECT order_id FROM processed_orders WHERE order_id = ?',
            orderId
        );
        return !!result;
    }

    async markOrderProcessed(orderId, data) {
        const {
            orderNumber,
            paymentStatus,
            calendarEventId,
            bookingDate,
            bookingTime,
            bookingProduct,
            customerName,
            customerEmail,
            syncSource = 'backend_poll'
        } = data;

        await this.db.run(`
            INSERT INTO processed_orders (
                order_id, order_number, payment_status, calendar_event_id,
                booking_date, booking_time, booking_product,
                customer_name, customer_email, sync_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [orderId, orderNumber, paymentStatus, calendarEventId,
            bookingDate, bookingTime, bookingProduct,
            customerName, customerEmail, syncSource]);

        // Update sync state
        await this.updateSyncState(orderId);
    }

    async getProcessedOrder(orderId) {
        return await this.db.get(
            'SELECT * FROM processed_orders WHERE order_id = ?',
            orderId
        );
    }

    // Sync state methods
    async getLastSyncTimestamp() {
        const result = await this.db.get(
            'SELECT last_sync_timestamp FROM sync_state WHERE id = 1'
        );
        return result?.last_sync_timestamp || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // Default to 7 days ago
    }

    async updateLastSyncTimestamp(timestamp) {
        await this.db.run(`
            UPDATE sync_state 
            SET last_sync_timestamp = ?, 
                last_successful_sync = ?,
                updated_at = datetime('now')
            WHERE id = 1
        `, [timestamp, timestamp]);
    }

    async getLastProcessedOrderId() {
        const result = await this.db.get(
            'SELECT last_processed_order_id FROM sync_state WHERE id = 1'
        );
        return result?.last_processed_order_id;
    }

    async updateSyncState(lastOrderId) {
        await this.db.run(`
            UPDATE sync_state 
            SET last_processed_order_id = ?,
                total_orders_processed = total_orders_processed + 1,
                updated_at = datetime('now')
            WHERE id = 1
        `, [lastOrderId]);
    }

    // Failure tracking methods
    async addSyncFailure(orderId, reason) {
        await this.db.run(`
            INSERT INTO sync_failures (order_id, failure_reason)
            VALUES (?, ?)
        `, [orderId, reason]);
    }

    async getRetryableFailures() {
        return await this.db.all(`
            SELECT * FROM retry_queue 
            WHERE resolved_at IS NULL 
            AND retry_count < max_retries
            AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
            ORDER BY next_retry_at ASC
            LIMIT 10
        `);
    }

    async addToRetryQueue(orderId, orderData, failureReason, failureCategory = 'temporary') {
        const orderDataJson = JSON.stringify(orderData);
        const nextRetryAt = this.calculateNextRetryTime(0);

        await this.db.run(`
            INSERT OR REPLACE INTO retry_queue (
                order_id, order_data, failure_reason, failure_category,
                retry_count, next_retry_at
            ) VALUES (?, ?, ?, ?, 0, ?)
        `, [orderId, orderDataJson, failureReason, failureCategory, nextRetryAt]);
    }

    async updateRetryStatus(orderId, success = false, error = null) {
        if (success) {
            await this.db.run(`
                UPDATE retry_queue 
                SET resolved_at = datetime('now'),
                    resolution = 'success'
                WHERE order_id = ?
            `, [orderId]);
        } else {
            const result = await this.db.get(
                'SELECT retry_count FROM retry_queue WHERE order_id = ?',
                orderId
            );
            
            const newRetryCount = (result?.retry_count || 0) + 1;
            const nextRetryAt = this.calculateNextRetryTime(newRetryCount);

            await this.db.run(`
                UPDATE retry_queue 
                SET retry_count = ?,
                    last_attempt_at = datetime('now'),
                    next_retry_at = ?,
                    failure_reason = ?
                WHERE order_id = ?
            `, [newRetryCount, nextRetryAt, error, orderId]);
        }
    }

    calculateNextRetryTime(retryCount) {
        const baseDelay = 60 * 1000; // 1 minute
        const maxDelay = 24 * 60 * 60 * 1000; // 24 hours
        
        // Exponential backoff: 1min, 2min, 4min, 8min, 16min...
        const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * delay;
        
        const nextRetryTime = new Date(Date.now() + delay + jitter);
        return nextRetryTime.toISOString();
    }

    // Metrics methods
    async startSyncMetric(source = 'backend_poll') {
        // For the new structure, we just return a sync ID
        // Actual metrics are updated via updateSyncMetrics
        return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async completeSyncMetric(syncId, data) {
        // This is now handled by sync-state.updateSyncMetrics
        // Keeping for compatibility
        return;
    }

    // Utility methods
    async getRecentProcessedOrders(limit = 10) {
        return await this.db.all(`
            SELECT * FROM processed_orders 
            ORDER BY processed_at DESC 
            LIMIT ?
        `, [limit]);
    }

    async getSyncStatus() {
        const syncState = await this.db.get('SELECT * FROM sync_state WHERE id = 1');
        const pendingRetries = await this.db.get(
            'SELECT COUNT(*) as count FROM retry_queue WHERE retry_count < 3'
        );
        const metrics = await this.db.get('SELECT * FROM sync_metrics WHERE id = 1');
        
        return {
            lastSync: syncState,
            retryQueueSize: pendingRetries?.count || 0,
            processedOrders: syncState?.orders_processed || 0,
            metrics
        };
    }
    
    async removeFromRetryQueue(orderId) {
        await this.db.run(
            'DELETE FROM retry_queue WHERE order_id = ?',
            orderId
        );
    }
    
    async updateRetryCount(orderId, newCount) {
        await this.db.run(`
            UPDATE retry_queue 
            SET retry_count = ?, 
                last_retry_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE order_id = ?
        `, newCount, orderId);
    }
    
    async getSyncMetrics() {
        const metrics = await this.db.get('SELECT * FROM sync_metrics WHERE id = 1');
        return metrics || {
            total_syncs: 0,
            successful_syncs: 0,
            failed_syncs: 0,
            total_orders: 0,
            successful_orders: 0,
            failed_orders: 0
        };
    }

    // Sync lock methods
    async acquireSyncLock() {
        const processId = `${process.pid}_${Date.now()}`;
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        try {
            const result = await this.db.run(`
                UPDATE sync_lock 
                SET locked = 1,
                    locked_at = datetime('now'),
                    locked_by = 'scheduler',
                    process_id = ?,
                    expires_at = ?
                WHERE id = 1 AND (locked = 0 OR expires_at < datetime('now'))
            `, [processId, expiresAt]);

            return result.changes > 0;
        } catch (error) {
            console.error('Error acquiring sync lock:', error);
            return false;
        }
    }

    async releaseSyncLock() {
        try {
            await this.db.run(`
                UPDATE sync_lock 
                SET locked = 0,
                    locked_at = NULL,
                    locked_by = NULL,
                    process_id = NULL,
                    expires_at = NULL
                WHERE id = 1
            `);
        } catch (error) {
            console.error('Error releasing sync lock:', error);
        }
    }

    async getSyncLock() {
        return await this.db.get('SELECT * FROM sync_lock WHERE id = 1');
    }

    // Sync status methods
    async updateSyncStatus(status) {
        const {
            last_sync_time,
            last_sync_status,
            orders_checked = 0,
            orders_processed = 0,
            orders_successful = 0,
            orders_failed = 0,
            sync_duration = null,
            last_sync_error = null
        } = status;

        await this.db.run(`
            UPDATE sync_state 
            SET last_sync_time = ?,
                status = ?,
                orders_processed = orders_processed + ?,
                orders_successful = orders_successful + ?,
                orders_failed = orders_failed + ?,
                error_message = ?,
                updated_at = datetime('now')
            WHERE id = 1
        `, [
            last_sync_time?.toISOString ? last_sync_time.toISOString() : last_sync_time,
            last_sync_status,
            orders_processed,
            orders_successful,
            orders_failed,
            last_sync_error
        ]);

        // Update metrics
        await this.db.run(`
            INSERT INTO sync_metrics (id, total_syncs, successful_syncs, failed_syncs, 
                total_orders, successful_orders, failed_orders, last_sync_at)
            VALUES (1, 0, 0, 0, 0, 0, 0, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                total_syncs = total_syncs + 1,
                successful_syncs = successful_syncs + CASE WHEN ? = 'completed' THEN 1 ELSE 0 END,
                failed_syncs = failed_syncs + CASE WHEN ? = 'failed' THEN 1 ELSE 0 END,
                total_orders = total_orders + ?,
                successful_orders = successful_orders + ?,
                failed_orders = failed_orders + ?,
                last_sync_at = datetime('now'),
                updated_at = datetime('now')
        `, [last_sync_status, last_sync_status, orders_checked, orders_successful, orders_failed]);
    }

    async recordSyncError(error) {
        await this.db.run(`
            INSERT INTO sync_errors (error_message, error_stack, error_context)
            VALUES (?, ?, ?)
        `, [error.error || error.message, error.stack, error.context || 'unknown']);
    }

    async close() {
        if (this.db) {
            await this.db.close();
            console.log('Database connection closed');
        }
    }
}

// Export singleton instance
module.exports = new Database();