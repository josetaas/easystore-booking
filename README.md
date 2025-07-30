# Photography Booking System

A calendar integration system for EasyStore that allows customers to book photography sessions by checking real-time availability against Google Calendar.

## Features

- 📅 **Real-time Availability**: Syncs with Google Calendar to show available time slots
- 🛒 **EasyStore Integration**: Seamlessly integrates with EasyStore checkout process
- 📱 **Responsive Calendar Widget**: Visual calendar interface for date selection
- ⏰ **Time Slot Management**: Configurable business hours and session duration
- 🚫 **Conflict Prevention**: Automatically prevents double-booking
- 🔄 **Buffer Time**: Configurable break time between sessions

## Architecture

### Backend (`server.js`)
- Node.js/Express server that connects to Google Calendar API
- Provides REST endpoints for availability checking
- Handles authentication via Google Service Account

### Frontend (`scripts/inject.js`)
- JavaScript widget that injects into EasyStore product pages
- Displays interactive calendar with availability indicators
- Manages booking date/time selection before checkout

## Prerequisites

- Node.js (v14 or higher)
- Google Cloud Project with Calendar API enabled
- Google Service Account with calendar access
- EasyStore account with ability to add custom scripts

## Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd booking-system
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your Google credentials:
```env
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
CALENDAR_ID=your-calendar-id@gmail.com
PORT=3000
```

4. Set up Google Calendar access:
   - Share your Google Calendar with the service account email
   - Grant "Make changes to events" permission

## Configuration

### Backend Configuration (`server.js`)
```javascript
const CONFIG = {
    businessHours: {
        'Monday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        'Tuesday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        // ... configure for each day
    },
    sessionDuration: 60,      // Session length in minutes
    bufferTime: 15,          // Break between sessions
    timezone: 'Asia/Manila'  // Your timezone
};
```

### Frontend Configuration (`scripts/inject.js`)
Update the API endpoint to match your backend URL:
```javascript
const CONFIG = {
    availabilityEndpoint: 'https://your-backend-url/api/availability',
    daysAhead: 30,      // How many days ahead customers can book
    minDaysAhead: 2     // Minimum advance booking (e.g., 2 = no same/next day)
};
```

## Running the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### Using ngrok for testing
```bash
ngrok http 3000
```
Then update `inject.js` with your ngrok URL.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with calendar connection status |
| `/api/availability?date=YYYY-MM-DD` | GET | Get available slots for specific date |
| `/api/availability?start=YYYY-MM-DD&end=YYYY-MM-DD` | GET | Get availability for date range |
| `/api/booking/create` | POST | Create a booking (testing endpoint) |
| `/api/bookings` | GET | List all bookings |
| `/api/config` | GET | Get current configuration |

## EasyStore Integration

### Method 1: GitHub Pages
1. Enable GitHub Pages for your repository
2. Add to EasyStore theme:
```html
<script src="https://[username].github.io/[repo]/scripts/inject.js"></script>
```

### Method 2: jsDelivr CDN (Recommended)
```html
<script src="https://cdn.jsdelivr.net/gh/[username]/[repo]@main/scripts/inject.js"></script>
```

Add the script tag to your EasyStore theme's `<head>` section or before the closing `</body>` tag.

## How It Works

1. **Customer visits product page**: The inject.js script loads and finds the "Buy Now" button
2. **Calendar widget appears**: Shows available dates with visual indicators
3. **Date selection**: Customer clicks an available date (green = available, red = booked)
4. **Time slot selection**: Available time slots are displayed for the selected date
5. **Booking confirmation**: Selected date/time are added as product properties
6. **Checkout enabled**: Buy Now button becomes active only after selection

## Troubleshooting

### "Calendar connection test failed: Not Found"
- Ensure the calendar is shared with your service account email
- Check that CALENDAR_ID is correct in your .env file
- Try using 'primary' as CALENDAR_ID for testing

### Frontend not loading
- Check browser console for CORS errors
- Ensure backend is running and accessible
- Verify the API endpoint URL in inject.js matches your backend

### No available slots showing
- Verify business hours are configured correctly
- Check that your Google Calendar doesn't have conflicting events
- Ensure timezone settings match between frontend and backend

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_CLIENT_EMAIL` | Service account email | `booking-bot@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Service account private key | `"-----BEGIN PRIVATE KEY-----..."` |
| `CALENDAR_ID` | Google Calendar ID | `your-email@gmail.com` or `primary` |
| `PORT` | Server port | `3000` |

## Security Considerations

- Never commit `.env` file or service account credentials
- Use environment variables for all sensitive data
- Consider implementing rate limiting for production
- Add authentication if API will be publicly accessible

## License

[Your chosen license]

## Support

For issues or questions, please [create an issue](https://github.com/[username]/[repo]/issues) on GitHub.