const { EasyStoreAPI, QueryBuilder } = require('./easystore-api');
const dataAccess = require('./data-access');

class EasyStoreService {
    constructor(config = {}) {
        // Initialize API client from environment or config
        const apiConfig = {
            storeUrl: config.storeUrl || process.env.EASYSTORE_API_URL,
            accessToken: config.accessToken || process.env.EASYSTORE_ACCESS_TOKEN,
            debug: config.debug || false
        };
        
        if (!apiConfig.storeUrl || !apiConfig.accessToken) {
            throw new Error('EasyStore configuration missing. Please set EASYSTORE_API_URL and EASYSTORE_ACCESS_TOKEN');
        }
        
        this.api = new EasyStoreAPI(apiConfig);
        this.storeUrl = config.storeUrl || process.env.EASYSTORE_STORE_URL || apiConfig.storeUrl;
    }
    
    // Extract booking information from order line items
    extractBookingInfo(order) {
        const bookings = [];
        
        if (!order.line_items || order.line_items.length === 0) {
            return bookings;
        }
        
        for (const item of order.line_items) {
            if (!item.properties || item.properties.length === 0) {
                continue;
            }
            
            const bookingDate = item.properties.find(p => p.name === 'Booking Date');
            const bookingTime = item.properties.find(p => p.name === 'Booking Time');
            
            if (bookingDate && bookingTime) {
                bookings.push({
                    orderId: order.id.toString(),
                    orderNumber: order.order_number,
                    productName: item.name,
                    productId: item.product_id,
                    variantId: item.variant_id,
                    bookingDate: bookingDate.value,
                    bookingTime: bookingTime.value,
                    customerName: order.customer?.name || `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
                    customerEmail: order.customer?.email || order.email,
                    customerPhone: order.customer?.phone || order.phone,
                    financialStatus: order.financial_status,
                    fulfillmentStatus: order.fulfillment_status,
                    totalPrice: order.total_price,
                    currency: order.currency,
                    createdAt: order.created_at,
                    updatedAt: order.updated_at
                });
            }
        }
        
        return bookings;
    }
    
    // Check if an order needs processing
    async shouldProcessOrder(order) {
        // Only process paid orders
        if (order.financial_status !== 'paid') {
            return false;
        }
        
        // Check if already processed
        const isProcessed = await dataAccess.isOrderProcessed(order.id.toString());
        if (isProcessed) {
            return false;
        }
        
        // Check if order has booking properties
        const bookings = this.extractBookingInfo(order);
        return bookings.length > 0;
    }
    
    // Fetch and process new paid orders
    async fetchNewPaidOrders(since = null) {
        try {
            // Get last sync state if no since parameter provided
            if (!since) {
                const syncStatus = await dataAccess.getSyncStatus();
                since = syncStatus?.lastSync?.last_sync_time || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default to 7 days ago
            }
            
            // Build query for paid orders
            const query = QueryBuilder.buildPaidOrdersQuery(since, ['items', 'customer']);
            
            // Fetch orders
            const orders = await this.api.fetchAllOrders(query);
            
            const processableOrders = [];
            
            for (const order of orders) {
                if (await this.shouldProcessOrder(order)) {
                    const bookings = this.extractBookingInfo(order);
                    processableOrders.push({
                        order,
                        bookings
                    });
                }
            }
            
            return {
                totalOrders: orders.length,
                processableOrders: processableOrders.length,
                orders: processableOrders
            };
            
        } catch (error) {
            console.error('Error fetching new paid orders:', error);
            throw error;
        }
    }
    
    // Fetch a specific order by ID
    async fetchOrderById(orderId) {
        try {
            const order = await this.api.fetchOrder(orderId);
            const bookings = this.extractBookingInfo(order);
            
            return {
                order,
                bookings,
                hasBookings: bookings.length > 0,
                isPaid: order.financial_status === 'paid'
            };
        } catch (error) {
            console.error(`Error fetching order ${orderId}:`, error);
            throw error;
        }
    }
    
    // Process an order and mark it as processed
    async processOrder(orderData) {
        const { order, bookings } = orderData;
        
        if (bookings.length === 0) {
            throw new Error('No bookings found in order');
        }
        
        // Process each booking
        const results = [];
        
        for (const booking of bookings) {
            try {
                // Here you would typically create the calendar event
                // For now, we'll just mark it as processed in the database
                
                await dataAccess.markOrderProcessed({
                    orderId: order.id.toString(),
                    orderNumber: order.order_number,
                    paymentStatus: order.financial_status,
                    bookingDate: booking.bookingDate,
                    bookingTime: booking.bookingTime,
                    bookingProduct: booking.productName,
                    customerName: booking.customerName,
                    customerEmail: booking.customerEmail,
                    syncSource: 'backend_sync'
                });
                
                results.push({
                    success: true,
                    booking
                });
                
            } catch (error) {
                results.push({
                    success: false,
                    booking,
                    error: error.message
                });
            }
        }
        
        return results;
    }
    
    // Get order checkout URL
    getOrderCheckoutUrl(order) {
        if (!this.storeUrl) {
            return null;
        }
        
        const baseUrl = this.storeUrl.replace(/\/$/, '');
        return `${baseUrl}/pages/order-status/${order.id}`;
    }
    
    // Health check
    async healthCheck() {
        return await this.api.healthCheck();
    }
}

// Create singleton instance
let serviceInstance = null;

function getEasyStoreService(config = {}) {
    if (!serviceInstance) {
        serviceInstance = new EasyStoreService(config);
    }
    return serviceInstance;
}

module.exports = {
    EasyStoreService,
    getEasyStoreService
};