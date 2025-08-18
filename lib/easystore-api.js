const https = require('https');
const { URL } = require('url');

class EasyStoreAPI {
    constructor(config = {}) {
        if (!config.storeUrl || !config.accessToken) {
            throw new Error('EasyStore API requires storeUrl and accessToken');
        }
        
        this.storeUrl = config.storeUrl.replace(/\/$/, ''); // Remove trailing slash
        this.accessToken = config.accessToken;
        this.apiVersion = config.apiVersion || '3.0';
        this.timeout = config.timeout || 30000; // 30 seconds
        
        // Rate limiting: 2 requests per second
        this.rateLimitDelay = 500; // 500ms between requests
        this.lastRequestTime = 0;
        this.requestQueue = [];
        this.processing = false;
        
        // Retry configuration
        this.maxRetries = config.maxRetries || 3;
        this.retryDelay = config.retryDelay || 1000; // Start with 1 second
        
        // Request logging
        this.debug = config.debug || false;
    }
    
    // Rate limiting queue processor
    async processQueue() {
        if (this.processing || this.requestQueue.length === 0) {
            return;
        }
        
        this.processing = true;
        
        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < this.rateLimitDelay) {
                await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
            }
            
            const { resolve, reject, fn } = this.requestQueue.shift();
            this.lastRequestTime = Date.now();
            
            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.processing = false;
    }
    
    // Add request to rate limit queue
    async queueRequest(fn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ resolve, reject, fn });
            this.processQueue();
        });
    }
    
    // Sleep helper
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Make HTTP request with retries
    async makeRequest(path, options = {}) {
        return this.queueRequest(async () => {
            let lastError;
            
            for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
                try {
                    const result = await this.doRequest(path, options);
                    return result;
                } catch (error) {
                    lastError = error;
                    
                    // Don't retry on client errors (except 429)
                    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
                        throw error;
                    }
                    
                    if (attempt < this.maxRetries) {
                        const delay = this.retryDelay * Math.pow(2, attempt);
                        if (this.debug) {
                            console.log(`Retry attempt ${attempt + 1} after ${delay}ms for ${path}`);
                        }
                        await this.sleep(delay);
                    }
                }
            }
            
            throw lastError;
        });
    }
    
    // Perform actual HTTP request
    doRequest(path, options = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(`${this.storeUrl}/api/${this.apiVersion}${path}`);
            
            const requestOptions = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: {
                    'EasyStore-Access-Token': this.accessToken,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...options.headers
                },
                timeout: this.timeout
            };
            
            if (this.debug) {
                console.log(`[EasyStore API] ${requestOptions.method} ${requestOptions.path}`);
            }
            
            const req = https.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (this.debug) {
                        console.log(`[EasyStore API] Response ${res.statusCode} for ${requestOptions.path}`);
                    }
                    
                    try {
                        const responseData = data ? JSON.parse(data) : null;
                        
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(responseData);
                        } else {
                            const error = new Error(responseData?.message || `API request failed with status ${res.statusCode}`);
                            error.statusCode = res.statusCode;
                            error.response = responseData;
                            reject(error);
                        }
                    } catch (parseError) {
                        reject(new Error(`Failed to parse API response: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${this.timeout}ms`));
            });
            
            if (options.body) {
                req.write(JSON.stringify(options.body));
            }
            
            req.end();
        });
    }
    
    // Build query string from parameters
    buildQueryString(params) {
        const query = new URLSearchParams();
        
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    query.append(key, value.join(','));
                } else {
                    query.append(key, value);
                }
            }
        });
        
        return query.toString();
    }
    
    // Fetch orders with parameters
    async fetchOrders(params = {}) {
        const queryString = this.buildQueryString(params);
        const path = `/orders.json${queryString ? `?${queryString}` : ''}`;
        
        const response = await this.makeRequest(path);
        return response.orders || [];
    }
    
    // Fetch single order by ID
    async fetchOrder(orderId) {
        if (!orderId) {
            throw new Error('Order ID is required');
        }
        
        const path = `/orders/${orderId}.json`;
        const response = await this.makeRequest(path);
        return response.order;
    }
    
    // Fetch orders updated since a specific order ID
    async fetchOrdersSince(sinceId, params = {}) {
        return this.fetchOrders({
            ...params,
            since_id: sinceId
        });
    }
    
    // Fetch paid orders updated after a timestamp
    async fetchPaidOrdersUpdatedAfter(timestamp, params = {}) {
        const isoTimestamp = timestamp instanceof Date 
            ? timestamp.toISOString() 
            : new Date(timestamp).toISOString();
        
        return this.fetchOrders({
            ...params,
            financial_status: 'paid',
            updated_at_min: isoTimestamp,
            sort: 'updated_at.asc'
        });
    }
    
    // Generator function for paginating through orders
    async *paginateOrders(params = {}) {
        let page = 1;
        let hasMore = true;
        const limit = params.limit || 50;
        
        while (hasMore) {
            const orders = await this.fetchOrders({
                ...params,
                page,
                limit
            });
            
            if (orders.length > 0) {
                yield orders;
            }
            
            hasMore = orders.length === limit;
            page++;
        }
    }
    
    // Fetch all orders matching criteria (handles pagination automatically)
    async fetchAllOrders(params = {}) {
        const allOrders = [];
        
        for await (const orders of this.paginateOrders(params)) {
            allOrders.push(...orders);
        }
        
        return allOrders;
    }
    
    // Health check
    async healthCheck() {
        try {
            // Try to fetch a single order with limit 1 to test connection
            await this.fetchOrders({ limit: 1 });
            return { healthy: true, message: 'EasyStore API connection successful' };
        } catch (error) {
            return { 
                healthy: false, 
                message: 'EasyStore API connection failed',
                error: error.message 
            };
        }
    }
}

// Query builder helper functions
const QueryBuilder = {
    // Build query for paid orders
    buildPaidOrdersQuery(since, fields = ['items', 'customer']) {
        const query = {
            financial_status: 'paid',
            limit: 50,
            fields: fields.join(','),
            sort: 'updated_at.asc'
        };
        
        if (since) {
            // Check if it's a valid numeric order ID
            const numericSince = parseInt(since);
            if (!isNaN(numericSince) && numericSince > 0) {
                // Valid order ID
                query.since_id = numericSince;
            } else if (since instanceof Date || !isNaN(Date.parse(since))) {
                // If it's a date
                query.updated_at_min = since instanceof Date 
                    ? since.toISOString() 
                    : new Date(since).toISOString();
            }
        }
        
        return query;
    },
    
    // Build query for orders in date range
    buildDateRangeQuery(startDate, endDate, params = {}) {
        return {
            ...params,
            created_at_min: startDate instanceof Date 
                ? startDate.toISOString() 
                : new Date(startDate).toISOString(),
            created_at_max: endDate instanceof Date 
                ? endDate.toISOString() 
                : new Date(endDate).toISOString()
        };
    },
    
    // Build query for specific customer
    buildCustomerOrdersQuery(email, params = {}) {
        return {
            ...params,
            email,
            sort: 'created_at.desc'
        };
    }
};

// Export the API client and query builder
module.exports = { EasyStoreAPI, QueryBuilder };