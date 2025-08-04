const dataAccess = require('./data-access');

class OrderProcessor {
    constructor(calendarService) {
        if (!calendarService) {
            throw new Error('Calendar service is required');
        }
        this.calendarService = calendarService;
    }
    
    // Check if an order contains booking items
    isBookingOrder(order) {
        if (!order.line_items || order.line_items.length === 0) {
            return false;
        }
        
        // Check if any line item has booking properties
        return order.line_items.some(item => {
            if (!item.properties || item.properties.length === 0) {
                return false;
            }
            
            const hasBookingDate = item.properties.some(p => p.name === 'Booking Date');
            const hasBookingTime = item.properties.some(p => p.name === 'Booking Time');
            
            return hasBookingDate && hasBookingTime;
        });
    }
    
    // Extract booking data from an order
    extractBookingData(order) {
        const bookings = [];
        
        if (!this.isBookingOrder(order)) {
            return bookings;
        }
        
        // Extract customer information
        const customer = {
            name: this.extractCustomerName(order),
            email: order.customer?.email || order.email || '',
            phone: order.customer?.phone || order.phone || ''
        };
        
        // Process each line item
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
                    productName: item.name || item.title || 'Unknown Product',
                    productId: item.product_id,
                    variantId: item.variant_id,
                    quantity: item.quantity || 1,
                    bookingDate: bookingDate.value,
                    bookingTime: bookingTime.value,
                    customer: customer,
                    financialStatus: order.financial_status,
                    fulfillmentStatus: order.fulfillment_status,
                    totalPrice: order.total_price,
                    currency: order.currency || 'MYR',
                    createdAt: order.created_at,
                    updatedAt: order.updated_at,
                    lineItemId: item.id
                });
            }
        }
        
        return bookings;
    }
    
    // Extract customer name from various sources
    extractCustomerName(order) {
        // Try customer object first
        if (order.customer) {
            if (order.customer.name) {
                return order.customer.name;
            }
            if (order.customer.first_name || order.customer.last_name) {
                return `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim();
            }
        }
        
        // Try billing address
        if (order.billing_address) {
            if (order.billing_address.name) {
                return order.billing_address.name;
            }
            if (order.billing_address.first_name || order.billing_address.last_name) {
                return `${order.billing_address.first_name || ''} ${order.billing_address.last_name || ''}`.trim();
            }
        }
        
        // Try shipping address
        if (order.shipping_address) {
            if (order.shipping_address.name) {
                return order.shipping_address.name;
            }
            if (order.shipping_address.first_name || order.shipping_address.last_name) {
                return `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim();
            }
        }
        
        return 'Customer';
    }
    
    // Validate booking data
    validateBookingData(booking) {
        const errors = [];
        
        // Check required fields
        if (!booking.bookingDate) {
            errors.push('Booking date is required');
        }
        
        if (!booking.bookingTime) {
            errors.push('Booking time is required');
        }
        
        if (!booking.productName) {
            errors.push('Product name is required');
        }
        
        if (!booking.customer.email) {
            errors.push('Customer email is required');
        }
        
        // Validate date format (YYYY-MM-DD)
        if (booking.bookingDate) {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(booking.bookingDate)) {
                errors.push('Invalid booking date format. Expected YYYY-MM-DD');
            } else {
                // Check if date is in the future
                const bookingDateObj = new Date(booking.bookingDate + 'T00:00:00');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                if (bookingDateObj < today) {
                    errors.push('Booking date cannot be in the past');
                }
            }
        }
        
        // Validate time format (H:MM AM/PM)
        if (booking.bookingTime) {
            const timeRegex = /^(1[0-2]|[1-9]):[0-5][0-9]\s*(AM|PM)$/i;
            if (!timeRegex.test(booking.bookingTime)) {
                errors.push('Invalid booking time format. Expected H:MM AM/PM');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
    
    // Process a single order
    async processOrder(order, options = {}) {
        const results = {
            orderId: order.id.toString(),
            orderNumber: order.order_number,
            success: false,
            bookings: [],
            errors: []
        };
        
        try {
            // Check if order is already processed
            if (!options.force) {
                const isProcessed = await dataAccess.isOrderProcessed(order.id.toString());
                if (isProcessed) {
                    results.success = true;
                    results.skipped = true;
                    results.message = 'Order already processed';
                    return results;
                }
            }
            
            // Check if order is paid
            if (order.financial_status !== 'paid' && !options.allowUnpaid) {
                results.errors.push('Order is not paid');
                return results;
            }
            
            // Extract booking data
            const bookings = this.extractBookingData(order);
            if (bookings.length === 0) {
                results.errors.push('No booking data found in order');
                return results;
            }
            
            // Process each booking
            for (const booking of bookings) {
                const bookingResult = await this.processBooking(booking, options);
                results.bookings.push(bookingResult);
                
                if (!bookingResult.success) {
                    results.errors.push(...bookingResult.errors);
                }
            }
            
            // Check if all bookings were successful
            results.success = results.bookings.every(b => b.success);
            
            // Mark order as processed if successful
            if (results.success) {
                for (const booking of bookings) {
                    await dataAccess.markOrderProcessed({
                        orderId: booking.orderId,
                        orderNumber: booking.orderNumber,
                        paymentStatus: order.financial_status,
                        bookingDate: booking.bookingDate,
                        bookingTime: booking.bookingTime,
                        bookingProduct: booking.productName,
                        customerName: booking.customer.name,
                        customerEmail: booking.customer.email,
                        calendarEventId: results.bookings.find(b => b.lineItemId === booking.lineItemId)?.calendarEventId,
                        syncSource: options.syncSource || 'manual'
                    });
                }
            } else if (options.queueOnFailure) {
                // Queue for retry
                await dataAccess.addToRetryQueue({
                    orderId: order.id.toString(),
                    orderData: JSON.stringify(order),
                    errorMessage: results.errors.join('; '),
                    source: options.syncSource || 'manual'
                });
            }
            
        } catch (error) {
            results.errors.push(`Processing error: ${error.message}`);
        }
        
        return results;
    }
    
    // Process a single booking
    async processBooking(booking, options = {}) {
        const result = {
            lineItemId: booking.lineItemId,
            productName: booking.productName,
            bookingDate: booking.bookingDate,
            bookingTime: booking.bookingTime,
            success: false,
            errors: []
        };
        
        try {
            // Validate booking data
            const validation = this.validateBookingData(booking);
            if (!validation.valid) {
                result.errors = validation.errors;
                return result;
            }
            
            // Check availability (unless forced)
            if (!options.skipAvailabilityCheck) {
                const isAvailable = await this.calendarService.checkAvailability(
                    booking.bookingDate,
                    booking.bookingTime,
                    booking.productName
                );
                
                if (!isAvailable) {
                    result.errors.push('Time slot is not available');
                    return result;
                }
            }
            
            // Create calendar event
            const eventData = this.buildCalendarEvent(booking);
            const calendarResult = await this.calendarService.createEvent(eventData);
            
            if (calendarResult.success) {
                result.success = true;
                result.calendarEventId = calendarResult.eventId;
                result.calendarEventLink = calendarResult.eventLink;
            } else {
                result.errors.push(`Calendar error: ${calendarResult.error}`);
            }
            
        } catch (error) {
            result.errors.push(`Booking error: ${error.message}`);
        }
        
        return result;
    }
    
    // Build calendar event data
    buildCalendarEvent(booking) {
        return {
            summary: `${booking.productName} - ${booking.customer.name}`,
            description: this.buildEventDescription(booking),
            date: booking.bookingDate,
            time: booking.bookingTime,
            customerName: booking.customer.name,
            customerEmail: booking.customer.email,
            productName: booking.productName,
            metadata: {
                orderId: booking.orderId,
                orderNumber: booking.orderNumber,
                lineItemId: booking.lineItemId,
                source: 'easystore_sync'
            }
        };
    }
    
    // Build event description
    buildEventDescription(booking) {
        const lines = [
            `Photography session booking`,
            `Order: #${booking.orderNumber}`,
            `Product: ${booking.productName}`,
            `Customer: ${booking.customer.name}`,
            `Email: ${booking.customer.email}`
        ];
        
        if (booking.customer.phone) {
            lines.push(`Phone: ${booking.customer.phone}`);
        }
        
        if (booking.quantity > 1) {
            lines.push(`Quantity: ${booking.quantity}`);
        }
        
        lines.push('', 'Booked via EasyStore');
        
        return lines.join('\\n');
    }
    
    // Process multiple orders in batch
    async processOrderBatch(orders, options = {}) {
        const results = {
            total: orders.length,
            processed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            errors: [],
            orderResults: []
        };
        
        // Process orders sequentially to avoid overwhelming the calendar API
        for (const order of orders) {
            try {
                const orderResult = await this.processOrder(order, options);
                results.orderResults.push(orderResult);
                results.processed++;
                
                if (orderResult.success) {
                    if (orderResult.skipped) {
                        results.skipped++;
                    } else {
                        results.successful++;
                    }
                } else {
                    results.failed++;
                    results.errors.push({
                        orderId: order.id,
                        orderNumber: order.order_number,
                        errors: orderResult.errors
                    });
                }
                
                // Update progress callback if provided
                if (options.onProgress) {
                    options.onProgress({
                        current: results.processed,
                        total: results.total,
                        orderResult: orderResult
                    });
                }
                
                // Add delay between orders to respect rate limits
                if (options.delayBetweenOrders) {
                    await new Promise(resolve => setTimeout(resolve, options.delayBetweenOrders));
                }
                
            } catch (error) {
                results.failed++;
                results.errors.push({
                    orderId: order.id,
                    orderNumber: order.order_number,
                    errors: [`Unexpected error: ${error.message}`]
                });
            }
        }
        
        return results;
    }
    
    // Get processing statistics
    async getProcessingStats() {
        try {
            const stats = await dataAccess.getSyncMetrics();
            return stats;
        } catch (error) {
            console.error('Error getting processing stats:', error);
            throw error;
        }
    }
}

module.exports = OrderProcessor;