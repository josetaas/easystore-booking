// Photography Studio Booking Calendar Widget
// Inject this script in easystore's head section

(function() {
    'use strict';
    
    // Configuration - Update these values
    const CONFIG = {
        // Your backend API endpoint for checking availability
        // Update this to your actual backend URL (ngrok or hosted service)
        availabilityEndpoint: 'https://stepsandstories.ngrok.app/api/availability',
        
        // How many days ahead to show bookings
        daysAhead: 30,
        
        // Minimum days ahead for booking (e.g., 2 = can't book same day or next day)
        minDaysAhead: 2
    };
    
    let selectedDate = null;
    let selectedTime = null;
    let availabilityCache = {};
    let businessHours = null; // Will be populated from API
    
    // Wait for DOM to be ready
    function ready(fn) {
        if (document.readyState !== 'loading') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }
    
    // Initialize the booking widget
    function initBookingWidget() {
        const buyNowButton = document.getElementById('BuyNowButton');
        if (!buyNowButton) {
            console.log('BuyNowButton not found, retrying in 1 second...');
            setTimeout(initBookingWidget, 1000);
            return;
        }
        
        createBookingWidget(buyNowButton);
        addCustomStyles();
        disableBuyNowButton();
    }
    
    // Create the main booking widget
    function createBookingWidget(buyNowButton) {
        const bookingContainer = document.createElement('div');
        bookingContainer.id = 'booking-widget';
        bookingContainer.innerHTML = `
            <div class="booking-widget-container">
                <h3 class="booking-title">Select Your Booking Date & Time</h3>
                
                <div class="booking-step" id="date-selection">
                    <h4>Step 1: Choose a Date</h4>
                    <div id="calendar-container">
                        <div class="calendar-header">
                            <button id="prev-month" class="nav-button">&lt;</button>
                            <span id="current-month"></span>
                            <button id="next-month" class="nav-button">&gt;</button>
                        </div>
                        <div id="calendar-grid"></div>
                    </div>
                    <div id="availability-loading" class="loading-indicator" style="display: none;">
                        Checking availability...
                    </div>
                </div>
                
                <div class="booking-step" id="time-selection" style="display: none;">
                    <h4>Step 2: Choose a Time</h4>
                    <div id="time-slots"></div>
                    <button id="change-date" class="secondary-button">← Change Date</button>
                </div>
                
                <div class="booking-summary" id="booking-summary" style="display: none;">
                    <div class="summary-content">
                        <strong>Selected Booking:</strong>
                        <div id="selected-booking-details"></div>
                    </div>
                </div>
            </div>
        `;
        
        // Insert before the Buy Now button
        buyNowButton.parentNode.insertBefore(bookingContainer, buyNowButton);
        
        // Initialize calendar
        initCalendar();
        setupEventListeners();
    }
    
    // Initialize calendar display
    function initCalendar() {
        const today = new Date();
        const minDate = new Date(today);
        minDate.setDate(today.getDate() + CONFIG.minDaysAhead);
        
        displayCalendar(minDate);
    }
    
    // Display calendar for given month
    function displayCalendar(date) {
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        
        const currentMonth = document.getElementById('current-month');
        const calendarGrid = document.getElementById('calendar-grid');
        
        currentMonth.textContent = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
        
        // Clear previous calendar
        calendarGrid.innerHTML = '';
        
        // Add day headers
        const headerRow = document.createElement('div');
        headerRow.className = 'calendar-row calendar-header-row';
        dayNames.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'calendar-day-header';
            dayHeader.textContent = day;
            headerRow.appendChild(dayHeader);
        });
        calendarGrid.appendChild(headerRow);
        
        // Get first day of month and number of days
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());
        
        const today = new Date();
        const minBookingDate = new Date(today);
        minBookingDate.setDate(today.getDate() + CONFIG.minDaysAhead);
        
        // Create calendar days
        let currentDate = new Date(startDate);
        while (currentDate <= lastDay || currentDate.getDay() !== 0) {
            const row = document.createElement('div');
            row.className = 'calendar-row';
            
            for (let i = 0; i < 7; i++) {
                const dayElement = document.createElement('div');
                dayElement.className = 'calendar-day';
                
                const isCurrentMonth = currentDate.getMonth() === date.getMonth();
                const isPastDate = currentDate < minBookingDate;
                const isTooFarAhead = currentDate > new Date(today.getFullYear(), today.getMonth(), today.getDate() + CONFIG.daysAhead);
                
                if (!isCurrentMonth) {
                    dayElement.classList.add('other-month');
                } else if (isPastDate || isTooFarAhead) {
                    dayElement.classList.add('disabled');
                } else {
                    dayElement.classList.add('available-date');
                    dayElement.addEventListener('click', () => selectDate(new Date(currentDate)));
                }
                
                dayElement.textContent = currentDate.getDate();
                dayElement.dataset.date = currentDate.toISOString().split('T')[0];
                
                row.appendChild(dayElement);
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            calendarGrid.appendChild(row);
        }
        
        // Load availability for visible dates
        loadAvailabilityForMonth(date);
    }
    
    // Load availability for all dates in the month
    async function loadAvailabilityForMonth(date) {
        const loadingIndicator = document.getElementById('availability-loading');
        loadingIndicator.style.display = 'block';
        
        try {
            const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
            const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            
            const response = await fetch(`${CONFIG.availabilityEndpoint}?start=${startDate.toISOString().split('T')[0]}&end=${endDate.toISOString().split('T')[0]}`);
            const availability = await response.json();
            
            // Store business hours from API if not already stored
            if (!businessHours && availability.businessHours) {
                businessHours = availability.businessHours;
            }
            
            // Update calendar with availability
            availability.dates.forEach(dateInfo => {
                const dayElement = document.querySelector(`[data-date="${dateInfo.date}"]`);
                if (dayElement && dayElement.classList.contains('available-date')) {
                    if (dateInfo.available) {
                        dayElement.classList.add('has-availability');
                    } else {
                        dayElement.classList.add('fully-booked');
                    }
                }
            });
            
            // Cache the availability
            availability.dates.forEach(dateInfo => {
                availabilityCache[dateInfo.date] = dateInfo.slots;
            });
            
        } catch (error) {
            console.error('Error loading availability:', error);
            // Fallback: assume all dates are available
            document.querySelectorAll('.available-date').forEach(day => {
                day.classList.add('has-availability');
            });
        }
        
        loadingIndicator.style.display = 'none';
    }
    
    // Handle date selection
    async function selectDate(date) {
        const dateStr = date.toISOString().split('T')[0];
        selectedDate = dateStr;
        
        // Highlight selected date
        document.querySelectorAll('.calendar-day').forEach(day => {
            day.classList.remove('selected');
        });
        document.querySelector(`[data-date="${dateStr}"]`).classList.add('selected');
        
        // Load time slots
        await loadTimeSlots(date);
        
        // Show time selection step
        document.getElementById('date-selection').style.display = 'none';
        document.getElementById('time-selection').style.display = 'block';
    }
    
    // Load available time slots for selected date
    async function loadTimeSlots(date) {
        const timeSlotsContainer = document.getElementById('time-slots');
        timeSlotsContainer.innerHTML = '<div class="loading">Loading available times...</div>';
        
        try {
            // Get availability from cache or API
            const dateStr = date.toISOString().split('T')[0];
            let availableSlots = availabilityCache[dateStr];
            
            if (!availableSlots) {
                const response = await fetch(`${CONFIG.availabilityEndpoint}?date=${dateStr}`);
                const data = await response.json();
                availableSlots = data.slots;
                
                // Store business hours from API if not already stored
                if (!businessHours && data.businessHours) {
                    businessHours = data.businessHours;
                }
            }
            
            // Get business hours for this day
            const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
            const dayBusinessHours = businessHours ? businessHours[dayName] || [] : [];
            
            if (dayBusinessHours.length === 0) {
                timeSlotsContainer.innerHTML = '<div class="no-slots">Sorry, we\'re closed on this day.</div>';
                return;
            }
            
            // Create time slot buttons
            timeSlotsContainer.innerHTML = '';
            let hasAvailableSlots = false;
            
            dayBusinessHours.forEach(time => {
                const slotButton = document.createElement('button');
                slotButton.className = 'time-slot';
                slotButton.textContent = time;
                
                const isAvailable = !availableSlots || availableSlots.includes(time);
                
                if (isAvailable) {
                    hasAvailableSlots = true;
                    slotButton.classList.add('available');
                    slotButton.addEventListener('click', () => selectTime(time));
                } else {
                    slotButton.classList.add('booked');
                    slotButton.disabled = true;
                }
                
                timeSlotsContainer.appendChild(slotButton);
            });
            
            if (!hasAvailableSlots) {
                const noSlotsMsg = document.createElement('div');
                noSlotsMsg.className = 'no-slots';
                noSlotsMsg.textContent = 'Sorry, no time slots available on this date.';
                timeSlotsContainer.appendChild(noSlotsMsg);
            }
            
        } catch (error) {
            console.error('Error loading time slots:', error);
            timeSlotsContainer.innerHTML = '<div class="error">Error loading times. Please try again.</div>';
        }
    }
    
    // Handle time selection
    function selectTime(time) {
        selectedTime = time;
        
        // Highlight selected time
        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.classList.remove('selected');
        });
        event.target.classList.add('selected');
        
        // Update booking summary
        updateBookingSummary();
        
        // Enable buy now button
        enableBuyNowButton();
    }
    
    // Update booking summary display
    function updateBookingSummary() {
        const summaryContainer = document.getElementById('booking-summary');
        const detailsContainer = document.getElementById('selected-booking-details');
        
        if (selectedDate && selectedTime) {
            const date = new Date(selectedDate);
            const formattedDate = date.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            
            detailsContainer.innerHTML = `
                <div class="booking-detail">📅 ${formattedDate}</div>
                <div class="booking-detail">🕐 ${selectedTime}</div>
            `;
            
            summaryContainer.style.display = 'block';
            
            // Update easystore form with booking details
            updateEasyStoreForm();
        }
    }
    
    // Update easystore form with booking details
    function updateEasyStoreForm() {
        // Add hidden inputs for booking details
        let bookingDateInput = document.querySelector('input[name="properties[Booking Date]"]');
        let bookingTimeInput = document.querySelector('input[name="properties[Booking Time]"]');
        
        if (!bookingDateInput) {
            bookingDateInput = document.createElement('input');
            bookingDateInput.type = 'hidden';
            bookingDateInput.name = 'properties[Booking Date]';
            document.body.appendChild(bookingDateInput);
        }
        
        if (!bookingTimeInput) {
            bookingTimeInput = document.createElement('input');
            bookingTimeInput.type = 'hidden';
            bookingTimeInput.name = 'properties[Booking Time]';
            document.body.appendChild(bookingTimeInput);
        }
        
        bookingDateInput.value = selectedDate;
        bookingTimeInput.value = selectedTime;
    }
    
    // Set up event listeners
    function setupEventListeners() {
        // Calendar navigation
        document.getElementById('prev-month').addEventListener('click', () => {
            const currentMonth = document.getElementById('current-month').textContent;
            const [monthName, year] = currentMonth.split(' ');
            const monthIndex = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"].indexOf(monthName);
            const newDate = new Date(parseInt(year), monthIndex - 1, 1);
            displayCalendar(newDate);
        });
        
        document.getElementById('next-month').addEventListener('click', () => {
            const currentMonth = document.getElementById('current-month').textContent;
            const [monthName, year] = currentMonth.split(' ');
            const monthIndex = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"].indexOf(monthName);
            const newDate = new Date(parseInt(year), monthIndex + 1, 1);
            displayCalendar(newDate);
        });
        
        // Change date button
        document.getElementById('change-date').addEventListener('click', () => {
            document.getElementById('time-selection').style.display = 'none';
            document.getElementById('date-selection').style.display = 'block';
            selectedTime = null;
            disableBuyNowButton();
            document.getElementById('booking-summary').style.display = 'none';
        });
    }
    
    // Disable buy now button initially
    function disableBuyNowButton() {
        const buyNowButton = document.getElementById('BuyNowButton');
        if (buyNowButton) {
            buyNowButton.disabled = true;
            buyNowButton.style.opacity = '0.5';
            buyNowButton.style.cursor = 'not-allowed';
            
            // Add overlay message
            let overlay = document.getElementById('booking-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'booking-overlay';
                overlay.innerHTML = 'Please select a date and time above';
                buyNowButton.parentNode.appendChild(overlay);
            }
        }
    }
    
    // Enable buy now button when booking is selected
    function enableBuyNowButton() {
        const buyNowButton = document.getElementById('BuyNowButton');
        const overlay = document.getElementById('booking-overlay');
        
        if (buyNowButton) {
            buyNowButton.disabled = false;
            buyNowButton.style.opacity = '1';
            buyNowButton.style.cursor = 'pointer';
        }
        
        if (overlay) {
            overlay.remove();
        }
    }
    
    // Add custom styles
    function addCustomStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .booking-widget-container {
                background: #f9f9f9;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                font-family: Arial, sans-serif;
            }
            
            .booking-title {
                color: #333;
                margin-bottom: 20px;
                text-align: center;
            }
            
            .booking-step h4 {
                color: #555;
                margin-bottom: 15px;
            }
            
            .calendar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }
            
            .nav-button {
                background: #007cba;
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
            }
            
            .nav-button:hover {
                background: #005a87;
            }
            
            #current-month {
                font-weight: bold;
                font-size: 18px;
            }
            
            .calendar-row {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                gap: 2px;
                margin-bottom: 2px;
            }
            
            .calendar-day-header {
                text-align: center;
                font-weight: bold;
                padding: 8px;
                background: #eee;
                font-size: 12px;
            }
            
            .calendar-day {
                text-align: center;
                padding: 12px 8px;
                border: 1px solid #eee;
                background: white;
                cursor: pointer;
                min-height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .calendar-day.other-month {
                color: #ccc;
                background: #f5f5f5;
                cursor: default;
            }
            
            .calendar-day.disabled {
                color: #ccc;
                background: #f0f0f0;
                cursor: not-allowed;
            }
            
            .calendar-day.has-availability {
                background: #e8f5e8;
                border-color: #4CAF50;
            }
            
            .calendar-day.has-availability:hover {
                background: #d4edda;
            }
            
            .calendar-day.fully-booked {
                background: #ffe6e6;
                border-color: #f44336;
                cursor: not-allowed;
            }
            
            .calendar-day.selected {
                background: #007cba !important;
                color: white;
                font-weight: bold;
            }
            
            #time-slots {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 10px;
                margin: 15px 0;
            }
            
            .time-slot {
                padding: 12px 16px;
                border: 2px solid #ddd;
                background: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }
            
            .time-slot.available:hover {
                border-color: #007cba;
                background: #f0f8ff;
            }
            
            .time-slot.selected {
                background: #007cba;
                color: white;
                border-color: #005a87;
            }
            
            .time-slot.booked {
                background: #f5f5f5;
                color: #999;
                cursor: not-allowed;
                border-color: #ccc;
            }
            
            .secondary-button {
                background: #6c757d;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                margin-top: 15px;
            }
            
            .secondary-button:hover {
                background: #545b62;
            }
            
            .booking-summary {
                background: #e8f5e8;
                border: 1px solid #4CAF50;
                border-radius: 6px;
                padding: 15px;
                margin-top: 20px;
            }
            
            .booking-detail {
                margin: 5px 0;
                font-size: 16px;
            }
            
            .loading-indicator, .loading, .error, .no-slots {
                text-align: center;
                padding: 20px;
                color: #666;
                font-style: italic;
            }
            
            .error {
                color: #d32f2f;
            }
            
            #booking-overlay {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 10px 15px;
                border-radius: 4px;
                font-size: 14px;
                pointer-events: none;
                z-index: 10;
            }
            
            #BuyNowButton {
                position: relative;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Initialize when ready
    ready(initBookingWidget);
    
})();
