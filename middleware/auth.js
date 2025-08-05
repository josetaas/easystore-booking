/**
 * Simple authentication middleware
 * In production, replace with proper authentication (JWT, OAuth, etc.)
 */

const authenticate = (req, res, next) => {
    // Check for API key in header or query
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    const expectedKey = process.env.API_KEY || 'your-secret-api-key';
    
    // Allow requests from localhost in development
    if (process.env.NODE_ENV === 'development' && req.hostname === 'localhost') {
        return next();
    }
    
    // Check API key
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'API key required'
            }
        });
    }
    
    if (apiKey !== expectedKey) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'INVALID_API_KEY',
                message: 'Invalid API key'
            }
        });
    }
    
    // Add user info to request (for logging)
    req.user = {
        apiKey: apiKey.substring(0, 8) + '...',
        authenticated: true
    };
    
    next();
};

/**
 * Rate limiting middleware
 * Simple in-memory rate limiter
 */
const rateLimitStore = new Map();

const rateLimit = (options = {}) => {
    const {
        windowMs = 60 * 1000, // 1 minute
        max = 100, // limit each IP to 100 requests per windowMs
        message = 'Too many requests, please try again later.'
    } = options;
    
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        // Clean up old entries
        for (const [ip, data] of rateLimitStore.entries()) {
            if (now - data.resetTime > windowMs) {
                rateLimitStore.delete(ip);
            }
        }
        
        // Get or create rate limit data for this IP
        let limitData = rateLimitStore.get(key);
        if (!limitData || now - limitData.resetTime > windowMs) {
            limitData = {
                count: 0,
                resetTime: now
            };
            rateLimitStore.set(key, limitData);
        }
        
        // Increment counter
        limitData.count++;
        
        // Check if limit exceeded
        if (limitData.count > max) {
            return res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message,
                    retryAfter: Math.ceil((limitData.resetTime + windowMs - now) / 1000)
                }
            });
        }
        
        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', max - limitData.count);
        res.setHeader('X-RateLimit-Reset', new Date(limitData.resetTime + windowMs).toISOString());
        
        next();
    };
};

/**
 * Request logging middleware
 */
const logRequest = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    req.requestId = requestId;
    
    const start = Date.now();
    
    // Log request
    console.log(`[${requestId}] ${req.method} ${req.path} - ${req.ip}`);
    
    // Log response
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - start;
        console.log(`[${requestId}] ${res.statusCode} - ${duration}ms`);
        originalSend.call(this, data);
    };
    
    next();
};

module.exports = {
    authenticate,
    rateLimit,
    logRequest
};