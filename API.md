# Booking System API Documentation

## Authentication

All API endpoints (except `/health`) require authentication using an API key.

### Headers
```
x-api-key: your-secret-api-key
```

### Environment Variable
Set `API_KEY` in your `.env` file.

## Endpoints

### 1. Sync Specific Order
Synchronize a specific order from EasyStore to Google Calendar.

**Endpoint:** `POST /api/sync-order`

**Request Body:**
```json
{
  "orderId": "89966528",
  "orderNumber": "#1008" // optional
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Order synchronized successfully",
  "orderId": "89966528",
  "orderNumber": "#1008",
  "events": [
    {
      "productName": "Selfie Station",
      "bookingDate": "2025-08-06",
      "bookingTime": "1:00 PM",
      "calendarEventId": "abc123",
      "calendarEventLink": "https://calendar.google.com/..."
    }
  ]
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "ORDER_NOT_PAID",
    "message": "Order is not paid",
    "details": {
      "orderId": "89966528",
      "orderNumber": "#1008"
    }
  }
}
```

**Error Codes:**
- `MISSING_FIELDS` - Required fields missing
- `ORDER_LOCKED` - Order is already being processed
- `ORDER_NOT_PAID` - Order status is not paid
- `NO_BOOKING_DATA` - Order has no booking properties
- `ALREADY_PROCESSED` - Order was already synced
- `SYNC_FAILED` - General sync failure

### 2. Batch Sync Orders
Synchronize multiple orders in batch.

**Endpoint:** `POST /api/sync-orders`

**Request Body:**
```json
{
  "since": "2025-08-01T00:00:00Z", // optional, ISO timestamp
  "limit": 50,                      // optional, max 100
  "dryRun": false                   // optional, preview without processing
}
```

**Success Response (200):**
```json
{
  "success": true,
  "ordersChecked": 10,
  "ordersProcessed": 8,
  "ordersSuccessful": 7,
  "ordersFailed": 1,
  "ordersSkipped": 2,
  "duration": 15
}
```

**Dry Run Response:**
```json
{
  "success": true,
  "dryRun": true,
  "totalOrders": 10,
  "ordersWithBookings": 8,
  "orders": [
    {
      "orderId": "89966528",
      "orderNumber": "#1008",
      "bookings": [
        {
          "product": "Selfie Station",
          "date": "2025-08-06",
          "time": "1:00 PM"
        }
      ]
    }
  ]
}
```

### 3. Get Sync Status
Get the current synchronization status and health.

**Endpoint:** `GET /api/sync-status`

**Success Response (200):**
```json
{
  "success": true,
  "lastSync": "2025-08-04T10:30:00Z",
  "lastSyncStatus": "completed",
  "timeSinceLastSync": "45 minutes",
  "ordersProcessed": 156,
  "pendingRetries": 2,
  "syncHealth": "healthy",
  "metrics": {
    "totalSyncs": 25,
    "successfulSyncs": 24,
    "failedSyncs": 1,
    "totalOrders": 156,
    "successfulOrders": 152,
    "failedOrders": 4,
    "successRate": 97
  }
}
```

**Sync Health Values:**
- `healthy` - Success rate >= 90%
- `degraded` - Success rate 50-89%
- `failing` - Success rate < 50%

### 4. Retry Failed Orders
Retry orders that failed during previous sync attempts.

**Endpoint:** `POST /api/retry-failed-orders`

**Request Body:**
```json
{
  "orderIds": ["89966528", "89966529"] // optional, retry specific orders
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Retry completed: 2 successful, 1 failed",
  "retriedCount": 3,
  "successful": 2,
  "failed": 1
}
```

### 5. Get Sync History
Get recently processed orders.

**Endpoint:** `GET /api/sync-history`

**Query Parameters:**
- `limit` - Number of records to return (default: 10)

**Success Response (200):**
```json
{
  "success": true,
  "orders": [
    {
      "orderId": "89966528",
      "orderNumber": "#1008",
      "processedAt": "2025-08-04T10:30:00Z",
      "bookingDate": "2025-08-06",
      "bookingTime": "1:00 PM",
      "product": "Selfie Station",
      "customer": "Jose Francisco Taas",
      "calendarEventId": "abc123",
      "syncSource": "frontend_trigger"
    }
  ]
}
```

### 6. Health Check
Check if the service is healthy (no authentication required).

**Endpoint:** `GET /health`

**Success Response (200):**
```json
{
  "status": "healthy",
  "calendar": "connected",
  "database": "connected",
  "timestamp": "2025-08-04T10:30:00Z"
}
```

## Rate Limiting

API endpoints are rate limited to prevent abuse:
- **Limit:** 100 requests per minute per IP
- **Headers:** Rate limit info is included in response headers
  - `X-RateLimit-Limit`: Total allowed requests
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: When the limit resets

**Rate Limit Error (429):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later.",
    "retryAfter": 45
  }
}
```

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      // Additional context
    }
  }
}
```

## Integration Examples

### Frontend Payment Confirmation
```javascript
// After payment is confirmed
fetch('/api/sync-order', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-api-key'
  },
  body: JSON.stringify({
    orderId: order.id
  })
})
.then(res => res.json())
.then(data => {
  if (data.success) {
    console.log('Booking synced:', data.events[0].calendarEventLink);
  } else {
    console.error('Sync failed:', data.error.message);
  }
});
```

### Scheduled Backend Sync
```javascript
// Run every 5 minutes
setInterval(async () => {
  const response = await fetch('/api/sync-orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.API_KEY
    },
    body: JSON.stringify({
      limit: 50
    })
  });
  
  const result = await response.json();
  console.log(`Synced ${result.ordersSuccessful} orders`);
}, 5 * 60 * 1000);
```