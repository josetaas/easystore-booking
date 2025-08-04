const { google } = require('googleapis');

class CalendarService {
    constructor(config = {}) {
        this.config = {
            calendarId: config.calendarId || process.env.CALENDAR_ID || 'primary',
            timezone: config.timezone || 'Asia/Manila',
            sessionDuration: config.sessionDuration || 60,
            bufferTime: config.bufferTime || 15,
            ...config
        };
        
        this.calendar = null;
        this.initialized = false;
    }
    
    // Initialize Google Calendar API
    async initialize() {
        if (this.initialized) {
            return;
        }
        
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: process.env.GOOGLE_CLIENT_EMAIL,
                    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                },
                scopes: ['https://www.googleapis.com/auth/calendar']
            });
            
            this.calendar = google.calendar({ version: 'v3', auth });
            this.initialized = true;
            
            // Test connection
            if (this.config.calendarId) {
                await this.calendar.calendars.get({
                    calendarId: this.config.calendarId
                });
            }
            
        } catch (error) {
            console.error('Failed to initialize calendar service:', error);
            throw error;
        }
    }
    
    // Ensure service is initialized
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }
    
    // Convert time string to minutes since midnight
    timeToMinutes(timeStr) {
        const [time, period] = timeStr.split(' ');
        const [hours, minutes] = time.split(':').map(Number);
        let totalMinutes = (hours % 12) * 60 + minutes;
        if (period === 'PM' && hours !== 12) totalMinutes += 12 * 60;
        if (period === 'AM' && hours === 12) totalMinutes = minutes;
        return totalMinutes;
    }
    
    // Create datetime from date and time in the configured timezone
    createDateTime(dateStr, timeStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const minutes = this.timeToMinutes(timeStr);
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        
        // Create date in the configured timezone
        const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
        
        // For Asia/Manila (UTC+8)
        const date = new Date(isoString + '+08:00');
        
        return date;
    }
    
    // Check if a time slot is available
    async checkAvailability(dateStr, timeStr, productName = null) {
        await this.ensureInitialized();
        
        try {
            const slotStart = this.createDateTime(dateStr, timeStr);
            const slotEnd = new Date(slotStart.getTime() + (this.config.sessionDuration + this.config.bufferTime) * 60000);
            
            // Get events for this day
            const startOfDay = new Date(slotStart);
            startOfDay.setHours(0, 0, 0, 0);
            
            const endOfDay = new Date(slotStart);
            endOfDay.setHours(23, 59, 59, 999);
            
            const response = await this.calendar.events.list({
                calendarId: this.config.calendarId,
                timeMin: startOfDay.toISOString(),
                timeMax: endOfDay.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                timeZone: this.config.timezone
            });
            
            const events = response.data.items || [];
            
            // Check for conflicts
            return !this.hasConflict(slotStart, slotEnd, events, productName);
            
        } catch (error) {
            console.error('Error checking availability:', error);
            throw error;
        }
    }
    
    // Check if a time slot conflicts with existing events
    hasConflict(slotStart, slotEnd, events, productName = null) {
        return events.some(event => {
            if (!event.start || !event.end) return false;
            
            const eventStart = new Date(event.start.dateTime || event.start.date);
            const eventEnd = new Date(event.end.dateTime || event.end.date);
            
            // Check for time overlap
            const hasTimeOverlap = slotStart < eventEnd && slotEnd > eventStart;
            if (!hasTimeOverlap) return false;
            
            // Check if this is a "Closed" event
            if (event.summary) {
                const eventTitle = event.summary.trim().toLowerCase();
                if (eventTitle === 'closed' || eventTitle.startsWith('closed ') || eventTitle.startsWith('closed:')) {
                    return true; // Closed events block all products
                }
            }
            
            // If productName is specified, only check conflicts with same product
            if (productName && event.summary) {
                const eventProductMatch = event.summary.match(/^(.+?)\s*-\s*/);
                const eventProductName = eventProductMatch ? eventProductMatch[1].trim() : event.summary.trim();
                
                if (eventProductName.toLowerCase() !== productName.toLowerCase()) {
                    return false; // Different product, no conflict
                }
            }
            
            return true; // Same product or no product specified
        });
    }
    
    // Create a calendar event
    async createEvent(eventData) {
        await this.ensureInitialized();
        
        try {
            const startDateTime = this.createDateTime(eventData.date, eventData.time);
            const endDateTime = new Date(startDateTime.getTime() + this.config.sessionDuration * 60000);
            
            const event = {
                summary: eventData.summary,
                description: eventData.description,
                start: {
                    dateTime: startDateTime.toISOString(),
                    timeZone: this.config.timezone
                },
                end: {
                    dateTime: endDateTime.toISOString(),
                    timeZone: this.config.timezone
                },
                // Note: Service accounts cannot invite attendees without Domain-Wide Delegation
                // attendees: eventData.customerEmail ? [{ email: eventData.customerEmail }] : [],
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 24 * 60 }, // 1 day before
                        { method: 'email', minutes: 60 }        // 1 hour before
                    ]
                }
            };
            
            // Add extended properties for tracking
            if (eventData.metadata) {
                event.extendedProperties = {
                    private: eventData.metadata
                };
            }
            
            const response = await this.calendar.events.insert({
                calendarId: this.config.calendarId,
                resource: event,
                sendUpdates: 'none' // Don't send notifications (service account limitation)
            });
            
            return {
                success: true,
                eventId: response.data.id,
                eventLink: response.data.htmlLink
            };
            
        } catch (error) {
            console.error('Error creating calendar event:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Check if an event already exists for an order
    async findEventByOrderId(orderId) {
        await this.ensureInitialized();
        
        try {
            // Search for events with the order ID in extended properties
            // Note: Google Calendar API doesn't support searching by extended properties directly
            // We'll need to search by date range and filter locally
            
            const now = new Date();
            const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const oneMonthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            
            const response = await this.calendar.events.list({
                calendarId: this.config.calendarId,
                timeMin: oneMonthAgo.toISOString(),
                timeMax: oneMonthAhead.toISOString(),
                singleEvents: true,
                maxResults: 2500 // Maximum allowed
            });
            
            const events = response.data.items || [];
            
            // Find events with matching order ID
            const matchingEvents = events.filter(event => {
                if (!event.extendedProperties?.private?.orderId) {
                    return false;
                }
                return event.extendedProperties.private.orderId === orderId.toString();
            });
            
            return matchingEvents.length > 0 ? matchingEvents[0] : null;
            
        } catch (error) {
            console.error('Error finding event by order ID:', error);
            return null;
        }
    }
    
    // Delete a calendar event
    async deleteEvent(eventId) {
        await this.ensureInitialized();
        
        try {
            await this.calendar.events.delete({
                calendarId: this.config.calendarId,
                eventId: eventId
            });
            
            return { success: true };
            
        } catch (error) {
            console.error('Error deleting calendar event:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Update a calendar event
    async updateEvent(eventId, eventData) {
        await this.ensureInitialized();
        
        try {
            // Get existing event first
            const existing = await this.calendar.events.get({
                calendarId: this.config.calendarId,
                eventId: eventId
            });
            
            // Update fields
            const event = existing.data;
            
            if (eventData.summary) event.summary = eventData.summary;
            if (eventData.description) event.description = eventData.description;
            
            if (eventData.date && eventData.time) {
                const startDateTime = this.createDateTime(eventData.date, eventData.time);
                const endDateTime = new Date(startDateTime.getTime() + this.config.sessionDuration * 60000);
                
                event.start = {
                    dateTime: startDateTime.toISOString(),
                    timeZone: this.config.timezone
                };
                event.end = {
                    dateTime: endDateTime.toISOString(),
                    timeZone: this.config.timezone
                };
            }
            
            const response = await this.calendar.events.update({
                calendarId: this.config.calendarId,
                eventId: eventId,
                resource: event
            });
            
            return {
                success: true,
                eventId: response.data.id,
                eventLink: response.data.htmlLink
            };
            
        } catch (error) {
            console.error('Error updating calendar event:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // Health check
    async healthCheck() {
        try {
            await this.ensureInitialized();
            const response = await this.calendar.calendars.get({
                calendarId: this.config.calendarId
            });
            
            return {
                healthy: true,
                calendarName: response.data.summary,
                timezone: response.data.timeZone
            };
            
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

// Create singleton instance
let serviceInstance = null;

function getCalendarService(config = {}) {
    if (!serviceInstance) {
        serviceInstance = new CalendarService(config);
    }
    return serviceInstance;
}

module.exports = {
    CalendarService,
    getCalendarService
};