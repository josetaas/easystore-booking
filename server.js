// Google Calendar Availability Backend
// This handles checking availability against Google Calendar

require('dotenv').config();

const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from scripts directory
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

// Development route for inject.js with no-cache headers
app.get('/inject.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'scripts', 'inject.js'));
});

// Configuration - Update these values
const CONFIG = {
    // Google Calendar configuration
    calendar: {
        // Your Google Calendar ID (usually your email or 'primary')
        calendarId: process.env.CALENDAR_ID || 'primary',
        
        serviceAccountEmail: process.env.GOOGLE_CLIENT_EMAIL,
        serviceAccountPrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    
    // Business hours - must match your frontend configuration
    businessHours: {
        'Monday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        'Tuesday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        'Wednesday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        'Thursday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        'Friday': ['9:00 AM', '11:00 AM', '1:00 PM', '3:00 PM', '5:00 PM'],
        'Saturday': ['10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM'],
        'Sunday': [] // Closed on Sundays
    },
    
    // Session duration in minutes
    sessionDuration: 60,
    
    // Timezone
    timezone: 'Asia/Manila', // Update to your timezone
    
    // Buffer time between sessions (minutes)
    bufferTime: 15
};

// Initialize Google Calendar API
let calendar;

async function initGoogleCalendar() {
    try {
        let auth;
        
        if (CONFIG.calendar.serviceAccountKeyFile) {
            // Using service account key file
            auth = new google.auth.GoogleAuth({
                keyFile: CONFIG.calendar.serviceAccountKeyFile,
                scopes: ['https://www.googleapis.com/auth/calendar']
            });
        } else {
            // Using environment variables
            auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: CONFIG.calendar.serviceAccountEmail,
                    private_key: CONFIG.calendar.serviceAccountPrivateKey,
                },
                scopes: ['https://www.googleapis.com/auth/calendar']
            });
        }
        
        calendar = google.calendar({ version: 'v3', auth });
        console.log('✅ Google Calendar API initialized successfully');
        
        // Test the connection
        await testCalendarConnection();
        
    } catch (error) {
        console.error('❌ Error initializing Google Calendar:', error.message);
        throw error;
    }
}

// Test calendar connection
async function testCalendarConnection() {
    try {
        const response = await calendar.calendars.get({
            calendarId: CONFIG.calendar.calendarId
        });
        console.log(`✅ Connected to calendar: ${response.data.summary}`);
    } catch (error) {
        console.error('❌ Calendar connection test failed:', error.message);
        if (error.message === 'Not Found') {
            console.error(`
⚠️  The service account doesn't have access to the calendar.
   
   To fix this:
   1. Share the calendar with the service account email: ${CONFIG.calendar.serviceAccountEmail}
   2. Or set CALENDAR_ID to the service account's calendar ID in .env file
   3. Current calendar ID: ${CONFIG.calendar.calendarId}
            `);
        }
        throw error;
    }
}

// Convert time string to minutes since midnight
function timeToMinutes(timeStr) {
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    let totalMinutes = (hours % 12) * 60 + minutes;
    if (period === 'PM' && hours !== 12) totalMinutes += 12 * 60;
    if (period === 'AM' && hours === 12) totalMinutes = minutes;
    return totalMinutes;
}

// Convert minutes to time string
function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// Create datetime from date and time
function createDateTime(dateStr, timeStr) {
    const date = new Date(dateStr);
    const minutes = timeToMinutes(timeStr);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    date.setHours(hours, mins, 0, 0);
    return date;
}

// Get existing calendar events for a date range
async function getCalendarEvents(startDate, endDate) {
    try {
        const response = await calendar.events.list({
            calendarId: CONFIG.calendar.calendarId,
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            timeZone: CONFIG.timezone
        });
        
        return response.data.items || [];
    } catch (error) {
        console.error('Error fetching calendar events:', error);
        throw error;
    }
}

// Check if a time slot conflicts with existing events
function hasConflict(slotStart, slotEnd, events) {
    return events.some(event => {
        if (!event.start || !event.end) return false;
        
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        
        // Check for overlap
        return slotStart < eventEnd && slotEnd > eventStart;
    });
}

// Get available time slots for a specific date
async function getAvailableSlots(dateStr) {
    try {
        const date = new Date(dateStr);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const businessHours = CONFIG.businessHours[dayName] || [];
        
        if (businessHours.length === 0) {
            return []; // Closed on this day
        }
        
        // Get calendar events for this day
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        const events = await getCalendarEvents(startOfDay, endOfDay);
        
        // Check each business hour slot
        const availableSlots = [];
        
        for (const timeSlot of businessHours) {
            const slotStart = createDateTime(dateStr, timeSlot);
            const slotEnd = new Date(slotStart.getTime() + (CONFIG.sessionDuration + CONFIG.bufferTime) * 60000);
            
            // Check if this slot conflicts with any existing events
            if (!hasConflict(slotStart, slotEnd, events)) {
                availableSlots.push(timeSlot);
            }
        }
        
        return availableSlots;
        
    } catch (error) {
        console.error(`Error checking availability for ${dateStr}:`, error);
        throw error;
    }
}

// Get availability for multiple dates
async function getAvailabilityForDateRange(startDateStr, endDateStr) {
    try {
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        const results = [];
        
        // Get events for entire range (more efficient than day-by-day)
        const rangeStart = new Date(startDate);
        rangeStart.setHours(0, 0, 0, 0);
        
        const rangeEnd = new Date(endDate);
        rangeEnd.setHours(23, 59, 59, 999);
        
        const allEvents = await getCalendarEvents(rangeStart, rangeEnd);
        
        // Check each date
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
            const businessHours = CONFIG.businessHours[dayName] || [];
            
            if (businessHours.length === 0) {
                // Closed on this day
                results.push({
                    date: dateStr,
                    available: false,
                    slots: []
                });
            } else {
                // Filter events for this specific date
                const dayStart = new Date(currentDate);
                dayStart.setHours(0, 0, 0, 0);
                
                const dayEnd = new Date(currentDate);
                dayEnd.setHours(23, 59, 59, 999);
                
                const dayEvents = allEvents.filter(event => {
                    const eventStart = new Date(event.start.dateTime || event.start.date);
                    return eventStart >= dayStart && eventStart <= dayEnd;
                });
                
                // Check availability for each slot
                const availableSlots = [];
                
                for (const timeSlot of businessHours) {
                    const slotStart = createDateTime(dateStr, timeSlot);
                    const slotEnd = new Date(slotStart.getTime() + (CONFIG.sessionDuration + CONFIG.bufferTime) * 60000);
                    
                    if (!hasConflict(slotStart, slotEnd, dayEvents)) {
                        availableSlots.push(timeSlot);
                    }
                }
                
                results.push({
                    date: dateStr,
                    available: availableSlots.length > 0,
                    slots: availableSlots
                });
            }
            
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        return results;
        
    } catch (error) {
        console.error('Error getting availability for date range:', error);
        throw error;
    }
}

// API Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        calendar: calendar ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Get availability for date range or specific date
app.get('/api/availability', async (req, res) => {
    try {
        const { start, end, date } = req.query;
        
        if (date) {
            // Single date request
            const slots = await getAvailableSlots(date);
            res.json({
                date,
                available: slots.length > 0,
                slots,
                businessHours: CONFIG.businessHours
            });
        } else if (start && end) {
            // Date range request
            const dates = await getAvailabilityForDateRange(start, end);
            res.json({ 
                dates,
                businessHours: CONFIG.businessHours 
            });
        } else {
            res.status(400).json({ 
                error: 'Please provide either "date" parameter or both "start" and "end" parameters' 
            });
        }
        
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            message: error.message 
        });
    }
});

// Create a calendar event (for testing)
app.post('/api/booking/create', async (req, res) => {
    try {
        const { date, time, customerName, customerEmail, sessionType = 'Photography Session' } = req.body;
        
        if (!date || !time || !customerName || !customerEmail) {
            return res.status(400).json({ 
                error: 'Missing required fields: date, time, customerName, customerEmail' 
            });
        }
        
        const startDateTime = createDateTime(date, time);
        const endDateTime = new Date(startDateTime.getTime() + CONFIG.sessionDuration * 60000);
        
        const event = {
            summary: `${sessionType} - ${customerName}`,
            description: `Photography session booking\nCustomer: ${customerName}\nEmail: ${customerEmail}`,
            start: {
                dateTime: startDateTime.toISOString(),
                timeZone: CONFIG.timezone
            },
            end: {
                dateTime: endDateTime.toISOString(),
                timeZone: CONFIG.timezone
            },
            attendees: [
                { email: customerEmail }
            ],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 }, // 1 day before
                    { method: 'email', minutes: 60 }        // 1 hour before
                ]
            }
        };
        
        const response = await calendar.events.insert({
            calendarId: CONFIG.calendar.calendarId,
            resource: event,
            sendUpdates: 'all' // Send email notifications
        });
        
        res.json({
            success: true,
            eventId: response.data.id,
            eventLink: response.data.htmlLink,
            message: 'Booking created successfully'
        });
        
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ 
            error: 'Failed to create booking',
            message: error.message 
        });
    }
});

// Get existing bookings (for admin/debugging)
app.get('/api/bookings', async (req, res) => {
    try {
        const { start, end } = req.query;
        const startDate = start ? new Date(start) : new Date();
        const endDate = end ? new Date(end) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead
        
        const events = await getCalendarEvents(startDate, endDate);
        
        const bookings = events.map(event => ({
            id: event.id,
            title: event.summary,
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            description: event.description,
            attendees: event.attendees?.map(a => a.email) || []
        }));
        
        res.json({ bookings });
        
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            message: error.message 
        });
    }
});

// Configuration endpoint (for debugging)
app.get('/api/config', (req, res) => {
    res.json({
        businessHours: CONFIG.businessHours,
        sessionDuration: CONFIG.sessionDuration,
        bufferTime: CONFIG.bufferTime,
        timezone: CONFIG.timezone
    });
});

// Initialize and start server
async function startServer() {
    try {
        await initGoogleCalendar();
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📅 Calendar integration active`);
            console.log(`🌐 API endpoints:`);
            console.log(`   GET  /api/availability?date=YYYY-MM-DD`);
            console.log(`   GET  /api/availability?start=YYYY-MM-DD&end=YYYY-MM-DD`);
            console.log(`   POST /api/booking/create`);
            console.log(`   GET  /api/bookings`);
            console.log(`   GET  /health`);
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();
