const db = require('./database');

// Wrapper for sync state management
const syncState = {
    async updateSyncState(data) {
        // Get current sync state or create new one
        let currentState = await db.db.get(
            'SELECT * FROM sync_state WHERE id = 1'
        );
        
        if (!currentState) {
            // Create initial state
            await db.db.run(`
                INSERT INTO sync_state (
                    id, status, started_at
                ) VALUES (1, ?, ?)
            `, data.status || 'idle', data.startedAt || new Date().toISOString());
        }
        
        // Build update query dynamically based on provided data
        const updates = [];
        const values = [];
        
        if (data.status !== undefined) {
            updates.push('status = ?');
            values.push(data.status);
        }
        if (data.startedAt !== undefined) {
            updates.push('started_at = ?');
            values.push(data.startedAt.toISOString());
        }
        if (data.completedAt !== undefined) {
            updates.push('completed_at = ?');
            values.push(data.completedAt.toISOString());
        }
        if (data.lastOrderId !== undefined) {
            updates.push('last_order_id = ?');
            values.push(data.lastOrderId);
        }
        if (data.lastSyncTime !== undefined) {
            updates.push('last_sync_time = ?');
            values.push(data.lastSyncTime.toISOString());
        }
        if (data.ordersProcessed !== undefined) {
            updates.push('orders_processed = ?');
            values.push(data.ordersProcessed);
        }
        if (data.ordersSuccessful !== undefined) {
            updates.push('orders_successful = ?');
            values.push(data.ordersSuccessful);
        }
        if (data.ordersFailed !== undefined) {
            updates.push('orders_failed = ?');
            values.push(data.ordersFailed);
        }
        if (data.errorMessage !== undefined) {
            updates.push('error_message = ?');
            values.push(data.errorMessage);
        }
        
        if (updates.length > 0) {
            values.push(1); // WHERE id = 1
            await db.db.run(
                `UPDATE sync_state SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ...values
            );
        }
    },
    
    async updateSyncMetrics(delta) {
        // Get current metrics or create new ones
        let metrics = await db.db.get(
            'SELECT * FROM sync_metrics WHERE id = 1'
        );
        
        if (!metrics) {
            // Create initial metrics
            await db.db.run(`
                INSERT INTO sync_metrics (
                    id, total_syncs, successful_syncs, failed_syncs,
                    total_orders, successful_orders, failed_orders
                ) VALUES (1, 0, 0, 0, 0, 0, 0)
            `);
            metrics = {
                total_syncs: 0,
                successful_syncs: 0,
                failed_syncs: 0,
                total_orders: 0,
                successful_orders: 0,
                failed_orders: 0
            };
        }
        
        // Update metrics with deltas
        await db.db.run(`
            UPDATE sync_metrics SET
                total_syncs = total_syncs + ?,
                successful_syncs = successful_syncs + ?,
                failed_syncs = failed_syncs + ?,
                total_orders = total_orders + ?,
                successful_orders = successful_orders + ?,
                failed_orders = failed_orders + ?,
                last_sync_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `,
            delta.totalSyncs || 0,
            delta.successfulSyncs || 0,
            delta.failedSyncs || 0,
            delta.totalOrders || 0,
            delta.successfulOrders || 0,
            delta.failedOrders || 0
        );
    }
};

module.exports = syncState;