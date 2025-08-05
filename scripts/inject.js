// Photography Studio Booking Calendar Widget
// Inject this script in easystore's head section

(function() {
    'use strict';
    
    // Configuration - Update these values
    const CONFIG = {
        // Your backend API endpoint for checking availability
        // Update this to your actual backend URL (ngrok or hosted service)
        // For development: Use same domain as the script is loaded from
        availabilityEndpoint: window.location.hostname.includes('ngrok') 
            ? `${window.location.protocol}//${window.location.hostname}/api/availability`
            : 'https://stepsandstories.ngrok.app/api/availability',
        
        // Backend URL for sync operations
        backendUrl: window.location.hostname.includes('ngrok') 
            ? `${window.location.protocol}//${window.location.hostname}`
            : 'https://stepsandstories.ngrok.app',
        
        // API Key for sync operations (should be stored securely in production)
        apiKey: 'aajE%991',
        
        // Enable payment detection
        enablePaymentDetection: true,
        
        // How many days ahead to show bookings
        daysAhead: 30,
        
        // Minimum days ahead for booking (e.g., 0 = can book same day, 1 = can't book same day)
        minDaysAhead: 1
    };
    
    let selectedDate = null;
    let selectedTime = null;
    let availabilityCache = {};
    let businessHours = null; // Will be populated from API
    let productName = null; // Will be detected from page
    
    // Wait for DOM to be ready
    function ready(fn) {
        if (document.readyState !== 'loading') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }
    
    // Detect product name from the page
    function detectProductName() {
        // Try multiple selectors common in EasyStore
        const selectors = [
            'h1.product__title',
            '.product__title',
            'h1.product-single__title',
            '.product-single__title',
            'h1[itemprop="name"]',
            '[data-product-title]',
            'h1'
        ];
        
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent) {
                return element.textContent.trim();
            }
        }
        
        return null;
    }
    
    // Initialize the booking widget
    function initBookingWidget() {
        const buyNowButton = document.getElementById('BuyNowButton');
        if (!buyNowButton) {
            console.log('BuyNowButton not found, retrying in 1 second...');
            setTimeout(initBookingWidget, 1000);
            return;
        }
        
        // Detect product name
        productName = detectProductName();
        console.log('Detected product name:', productName);
        
        // Disable buy now button immediately
        buyNowButton.disabled = true;
        buyNowButton.style.opacity = '0.5';
        buyNowButton.style.cursor = 'not-allowed';
        
        // Hide Add to Cart button
        hideAddToCartButton();
        
        // Hide and set quantity
        hideAndSetQuantity();
        
        createBookingWidget(buyNowButton);
        addCustomStyles();
        
        // Ensure button stays disabled
        setTimeout(() => disableBuyNowButton(), 100);
    }
    
    // Create the main booking widget
    function createBookingWidget(buyNowButton) {
        const bookingContainer = document.createElement('div');
        bookingContainer.id = 'booking-widget';
        bookingContainer.innerHTML = `
            <div class="booking-widget-container">
                <div class="booking-step" id="date-selection">
                    <div id="calendar-container">
                        <div class="calendar-header">
                            <button id="prev-month" class="nav-button">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="15 18 9 12 15 6"></polyline>
                                </svg>
                            </button>
                            <span id="current-month"></span>
                            <button id="next-month" class="nav-button">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </button>
                        </div>
                        <div id="calendar-grid"></div>
                    </div>
                    <div id="availability-loading" class="loading-indicator" style="display: none;">
                        <div class="spinner"></div>
                        <div>Checking availability...</div>
                    </div>
                </div>
                
                <div class="booking-step" id="time-selection" style="display: none;">
                    <div id="time-slots"></div>
                    <button id="change-date" class="secondary-button">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                        Change Date
                    </button>
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
                // Compare dates at start of day to allow same-day bookings
                const currentDateStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
                const minDateStart = new Date(minBookingDate.getFullYear(), minBookingDate.getMonth(), minBookingDate.getDate());
                const isPastDate = currentDateStart < minDateStart;
                const isTooFarAhead = currentDate > new Date(today.getFullYear(), today.getMonth(), today.getDate() + CONFIG.daysAhead);
                
                if (!isCurrentMonth) {
                    dayElement.classList.add('other-month');
                } else if (isPastDate || isTooFarAhead) {
                    dayElement.classList.add('disabled');
                } else {
                    dayElement.classList.add('available-date');
                    // Create a closure to capture the current date value
                    (function(capturedDate) {
                        dayElement.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            selectDate(new Date(capturedDate));
                        });
                    })(new Date(currentDate));
                }
                
                dayElement.textContent = currentDate.getDate();
                // Format date in local timezone to avoid UTC shift
                const year = currentDate.getFullYear();
                const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                const day = String(currentDate.getDate()).padStart(2, '0');
                const localDateStr = `${year}-${month}-${day}`;
                dayElement.dataset.date = localDateStr;
                
                // Debug: Add day name as title
                const debugDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()];
                dayElement.title = `${localDateStr} (${debugDayName})`;
                
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
            
            const url = new URL(CONFIG.availabilityEndpoint);
            url.searchParams.append('start', startDate.toISOString().split('T')[0]);
            url.searchParams.append('end', endDate.toISOString().split('T')[0]);
            if (productName) {
                url.searchParams.append('product', productName);
            }
            const response = await fetch(url.toString());
            const availability = await response.json();
            
            // Store business hours from API
            if (availability.businessHours) {
                businessHours = availability.businessHours;
                console.log('Stored business hours from month view:', businessHours);
            }
            
            // Update calendar with availability
            availability.dates.forEach(dateInfo => {
                const dayElement = document.querySelector(`[data-date="${dateInfo.date}"]`);
                if (dayElement && dayElement.classList.contains('available-date')) {
                    // Debug log
                    const [year, month, day] = dateInfo.date.split('-').map(Number);
                    const checkDate = new Date(year, month - 1, day);
                    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][checkDate.getDay()];
                    console.log(`Processing ${dateInfo.date} (${dayName}): available=${dateInfo.available}, slots=${dateInfo.slots?.length || 0}`);
                    
                    if (dateInfo.available && dateInfo.slots && dateInfo.slots.length > 0) {
                        // Has availability
                        dayElement.classList.add('has-availability');
                    } else if (!dateInfo.available || (dateInfo.slots && dateInfo.slots.length === 0)) {
                        // Not available - check if closed or booked
                        const dayBusinessHours = businessHours[dayName] || [];
                        
                        if (dayBusinessHours.length === 0) {
                            // We're closed this day
                            dayElement.classList.add('closed-day');
                        } else {
                            // We have hours but no availability - actually booked
                            dayElement.classList.add('fully-booked');
                        }
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
        // Format date in local timezone to avoid UTC shift
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        selectedDate = dateStr;
        
        // Highlight selected date
        document.querySelectorAll('.calendar-day').forEach(day => {
            day.classList.remove('selected');
        });
        const selectedDay = document.querySelector(`[data-date="${dateStr}"]`);
        if (selectedDay) {
            selectedDay.classList.add('selected');
        }
        
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
            // Format date in local timezone to avoid UTC shift
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            let availableSlots = availabilityCache[dateStr];
            
            if (!availableSlots || !businessHours) {
                console.log('Fetching availability for date:', dateStr);
                const url = new URL(CONFIG.availabilityEndpoint);
                url.searchParams.append('date', dateStr);
                if (productName) {
                    url.searchParams.append('product', productName);
                }
                const response = await fetch(url.toString());
                const data = await response.json();
                console.log('API response:', data);
                
                availableSlots = data.slots || [];
                
                // Store business hours from API if not already stored
                if (data.businessHours) {
                    businessHours = data.businessHours;
                    console.log('Loaded business hours from API:', businessHours);
                }
            }
            
            // Get business hours for this day
            const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
            
            // Debug - check if businessHours exists
            if (!businessHours) {
                console.error('Business hours not loaded! This should not happen.');
                timeSlotsContainer.innerHTML = '<div class="error">Error: Business hours not loaded. Please refresh and try again.</div>';
                return;
            }
            
            const dayBusinessHours = businessHours[dayName] || [];
            console.log(`Time slots for ${dayName}:`, dayBusinessHours);
            
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
                    slotButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectTime(time, e);
                    });
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
    function selectTime(time, event) {
        selectedTime = time;
        
        // Highlight selected time
        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.classList.remove('selected');
        });
        if (event && event.target) {
            event.target.classList.add('selected');
        }
        
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
                <div class="booking-detail">${formattedDate}</div>
                <div class="booking-detail">${selectedTime}</div>
            `;
            
            summaryContainer.style.display = 'block';
            
            // Update easystore form with booking details
            updateEasyStoreForm();
        }
    }
    
    // Update easystore form with booking details
    function updateEasyStoreForm() {
        const form = document.getElementById('BuyNowButton')?.closest('form');
        if (!form) return;
        
        // Add hidden inputs for booking details to the form
        let bookingDateInput = form.querySelector('input[name="properties[Booking Date]"]');
        let bookingTimeInput = form.querySelector('input[name="properties[Booking Time]"]');
        let bookingProductInput = form.querySelector('input[name="properties[Booking Product]"]');
        
        if (!bookingDateInput) {
            bookingDateInput = document.createElement('input');
            bookingDateInput.type = 'hidden';
            bookingDateInput.name = 'properties[Booking Date]';
            form.appendChild(bookingDateInput);
        }
        
        if (!bookingTimeInput) {
            bookingTimeInput = document.createElement('input');
            bookingTimeInput.type = 'hidden';
            bookingTimeInput.name = 'properties[Booking Time]';
            form.appendChild(bookingTimeInput);
        }
        
        if (!bookingProductInput && productName) {
            bookingProductInput = document.createElement('input');
            bookingProductInput.type = 'hidden';
            bookingProductInput.name = 'properties[Booking Product]';
            form.appendChild(bookingProductInput);
        }
        
        bookingDateInput.value = selectedDate;
        bookingTimeInput.value = selectedTime;
        if (bookingProductInput && productName) {
            bookingProductInput.value = productName;
        }
    }
    
    // Set up event listeners
    function setupEventListeners() {
        // Calendar navigation
        document.getElementById('prev-month').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentMonth = document.getElementById('current-month').textContent;
            const [monthName, year] = currentMonth.split(' ');
            const monthIndex = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"].indexOf(monthName);
            const newDate = new Date(parseInt(year), monthIndex - 1, 1);
            displayCalendar(newDate);
        });
        
        document.getElementById('next-month').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentMonth = document.getElementById('current-month').textContent;
            const [monthName, year] = currentMonth.split(' ');
            const monthIndex = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"].indexOf(monthName);
            const newDate = new Date(parseInt(year), monthIndex + 1, 1);
            displayCalendar(newDate);
        });
        
        // Change date button
        document.getElementById('change-date').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.getElementById('time-selection').style.display = 'none';
            document.getElementById('date-selection').style.display = 'block';
            selectedTime = null;
            disableBuyNowButton();
            document.getElementById('booking-summary').style.display = 'none';
        });
    }
    
    // Hide and set quantity input
    function hideAndSetQuantity() {
        const quantityInput = document.getElementById('Quantity');
        if (quantityInput) {
            quantityInput.value = '1';
            quantityInput.style.display = 'none';
            
            // Also hide the quantity container/wrapper if it exists
            const quantityContainer = quantityInput.closest('.product-form__quantity') || 
                                    quantityInput.closest('.quantity-selector') ||
                                    quantityInput.closest('.quantity') ||
                                    quantityInput.closest('quantity-input');
            if (quantityContainer) {
                quantityContainer.style.display = 'none';
            }
            
            // Hide any label associated with quantity
            const quantityLabel = document.querySelector('label[for="Quantity"]');
            if (quantityLabel) {
                quantityLabel.style.display = 'none';
            }
            
            console.log('Hidden quantity input and set to 1');
        }
        
        // Hide quantity-input custom element
        const quantityInputElements = document.querySelectorAll('quantity-input');
        quantityInputElements.forEach(element => {
            element.style.display = 'none';
            // Set inner input to 1
            const input = element.querySelector('input[name="quantity"]');
            if (input) {
                input.value = '1';
            }
        });
        
        // Also hide quantity buttons if they exist
        const quantityButtons = document.querySelectorAll('.quantity-button, .quantity__button, [data-quantity-button]');
        quantityButtons.forEach(button => {
            button.style.display = 'none';
        });
        
        // Watch for dynamically loaded quantity elements
        const quantityObserver = new MutationObserver((mutations) => {
            // Check for quantity input by ID
            const quantity = document.getElementById('Quantity');
            if (quantity && quantity.style.display !== 'none') {
                quantity.value = '1';
                quantity.style.display = 'none';
                const container = quantity.closest('.product-form__quantity') || 
                                quantity.closest('.quantity-selector') ||
                                quantity.closest('.quantity') ||
                                quantity.closest('quantity-input');
                if (container) {
                    container.style.display = 'none';
                }
                console.log('Hidden dynamically loaded quantity input');
            }
            
            // Also check for quantity-input custom element
            const quantityInputs = document.querySelectorAll('quantity-input');
            quantityInputs.forEach(qInput => {
                if (qInput.style.display !== 'none') {
                    qInput.style.display = 'none';
                    // Also ensure the input inside is set to 1
                    const input = qInput.querySelector('input[name="quantity"]');
                    if (input) {
                        input.value = '1';
                    }
                    console.log('Hidden dynamically loaded quantity-input element');
                }
            });
            
            // Hide any visible quantity buttons
            const quantityButtons = document.querySelectorAll('.quantity__button:not([style*="display: none"])');
            quantityButtons.forEach(button => {
                button.style.display = 'none';
            });
        });
        
        quantityObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Hide Add to Cart button
    function hideAddToCartButton() {
        // Specifically target the AddToCart button by ID
        const addToCartButton = document.getElementById('AddToCart');
        if (addToCartButton) {
            addToCartButton.style.display = 'none';
            console.log('Hidden AddToCart button');
            
            // Also hide its parent container if it only contains this button
            const parent = addToCartButton.parentElement;
            if (parent && parent.children.length === 1) {
                parent.style.display = 'none';
            }
        }
        
        // Try other common selectors as fallback
        const addToCartSelectors = [
            '#AddToCartButton',
            'button[name="add"]:not(#BuyNowButton)',
            'input[name="add"]:not(#BuyNowButton)',
            'button[type="submit"]:not(#BuyNowButton)',
            '.product-form__cart-submit:not(#BuyNowButton)',
            '.btn--add-to-cart'
        ];
        
        addToCartSelectors.forEach(selector => {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach(button => {
                // Make sure we're not hiding the Buy Now button
                if (button.id !== 'BuyNowButton' && !button.classList.contains('buy-now')) {
                    button.style.display = 'none';
                    console.log('Hidden button:', selector);
                }
            });
        });
        
        // If AddToCart button appears later (dynamic loading), hide it
        const observer = new MutationObserver((mutations) => {
            const addToCart = document.getElementById('AddToCart');
            if (addToCart && addToCart.style.display !== 'none') {
                addToCart.style.display = 'none';
                console.log('Hidden dynamically loaded AddToCart button');
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Disable buy now button initially
    function disableBuyNowButton() {
        const buyNowButton = document.getElementById('BuyNowButton');
        if (buyNowButton) {
            buyNowButton.disabled = true;
            buyNowButton.setAttribute('disabled', 'disabled');
            buyNowButton.style.opacity = '0.5';
            buyNowButton.style.cursor = 'not-allowed';
            buyNowButton.style.pointerEvents = 'none';
            
            // Add click prevention
            buyNowButton.onclick = function(e) {
                if (!selectedDate || !selectedTime) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            };
        }
    }
    
    // Enable buy now button when booking is selected
    function enableBuyNowButton() {
        // Only enable if both date and time are selected
        if (selectedDate && selectedTime) {
            const buyNowButton = document.getElementById('BuyNowButton');
            
            if (buyNowButton) {
                buyNowButton.disabled = false;
                buyNowButton.removeAttribute('disabled');
                buyNowButton.style.opacity = '1';
                buyNowButton.style.cursor = 'pointer';
                buyNowButton.style.pointerEvents = 'auto';
                
                // Intercept Buy Now to clear cart first
                const originalType = buyNowButton.type;
                buyNowButton.type = 'button'; // Prevent default submit
                
                buyNowButton.addEventListener('click', function handleBuyNow(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Show loading state
                    buyNowButton.classList.add('btn--loading');
                    buyNowButton.disabled = true;
                    
                    console.log('Intercepting Buy Now to clear cart first...');
                    
                    // Ensure booking properties are in form
                    updateEasyStoreForm();
                    
                    // Check if cart has items
                    fetch('/new_cart', {
                        method: 'GET',
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest',
                            'Accept': 'application/json'
                        }
                    })
                    .then(response => response.json())
                    .then(cartData => {
                        const cart = cartData.cart || cartData;
                        
                        if (cart && cart.items && cart.items.length > 0) {
                            console.log('Found ' + cart.items.length + ' items in cart, removing them...');
                            
                            // Remove each item using the correct API format
                            let itemsToRemove = cart.items.length;
                            let itemsProcessed = 0;
                            let allSuccess = true;
                            
                            // Function to proceed after all removals
                            function proceedWithBuyNow() {
                                // Verify cart is actually empty
                                fetch('/new_cart', {
                                    method: 'GET',
                                    headers: {
                                        'X-Requested-With': 'XMLHttpRequest',
                                        'Accept': 'application/json'
                                    }
                                })
                                .then(response => response.json())
                                .then(verifyData => {
                                    const verifyCart = verifyData.cart || verifyData;
                                    const remainingItems = verifyCart.items ? verifyCart.items.length : 0;
                                    
                                    console.log('Cart verification - remaining items:', remainingItems);
                                    
                                    // Remove loading state
                                    buyNowButton.classList.remove('btn--loading');
                                    buyNowButton.disabled = false;
                                    
                                    // Temporarily remove our handler
                                    buyNowButton.removeEventListener('click', handleBuyNow);
                                    
                                    // Restore original type
                                    buyNowButton.type = originalType;
                                    
                                    // Add a longer delay to ensure cart is fully updated
                                    setTimeout(() => {
                                        console.log('Triggering original Buy Now...');
                                        
                                        if (window.jQuery) {
                                            window.jQuery('#BuyNowButton').click();
                                        } else {
                                            buyNowButton.click();
                                        }
                                        
                                        // Re-add our handler after a delay
                                        setTimeout(() => {
                                            buyNowButton.type = 'button';
                                            buyNowButton.addEventListener('click', handleBuyNow);
                                        }, 3000);
                                    }, 1000);
                                })
                                .catch(error => {
                                    console.error('Error verifying cart:', error);
                                    // Continue anyway
                                    buyNowButton.classList.remove('btn--loading');
                                    buyNowButton.disabled = false;
                                    buyNowButton.removeEventListener('click', handleBuyNow);
                                    buyNowButton.type = originalType;
                                    
                                    setTimeout(() => {
                                        if (window.jQuery) {
                                            window.jQuery('#BuyNowButton').click();
                                        } else {
                                            buyNowButton.click();
                                        }
                                    }, 500);
                                });
                            }
                            
                            // Remove all items
                            const removalPromises = cart.items.map(item => {
                                const variantId = item.variant_id || (item.variant && item.variant.id);
                                
                                return fetch('/cart/remove_item_quantity', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'X-Requested-With': 'XMLHttpRequest'
                                    },
                                    body: JSON.stringify({
                                        variant_id: variantId.toString(),
                                        item_id: item.id.toString(),
                                        quantity: item.quantity.toString()
                                    })
                                })
                                .then(response => response.json())
                                .then(result => {
                                    console.log(`Removed item ${item.id}`);
                                    return true;
                                })
                                .catch(error => {
                                    console.error('Error removing item:', error);
                                    allSuccess = false;
                                    return false;
                                });
                            });
                            
                            // Wait for all removals to complete
                            Promise.all(removalPromises).then(results => {
                                console.log('All removal requests completed');
                                // Add extra delay to ensure server has processed everything
                                setTimeout(proceedWithBuyNow, 500);
                            });
                        } else {
                            console.log('Cart is empty, proceeding with Buy Now...');
                            
                            // Remove loading state
                            buyNowButton.classList.remove('btn--loading');
                            buyNowButton.disabled = false;
                            
                            // Temporarily remove our handler
                            buyNowButton.removeEventListener('click', handleBuyNow);
                            
                            // Restore original type
                            buyNowButton.type = originalType;
                            
                            // Trigger the original Buy Now
                            if (window.jQuery) {
                                window.jQuery('#BuyNowButton').click();
                            } else {
                                buyNowButton.click();
                            }
                            
                            // Re-add our handler
                            setTimeout(() => {
                                buyNowButton.type = 'button';
                                buyNowButton.addEventListener('click', handleBuyNow);
                            }, 2000);
                        }
                    })
                    .catch(error => {
                        console.error('Error retrieving cart:', error);
                        
                        // Continue anyway
                        buyNowButton.classList.remove('btn--loading');
                        buyNowButton.disabled = false;
                        
                        // Just trigger the original Buy Now
                        buyNowButton.removeEventListener('click', handleBuyNow);
                        buyNowButton.type = originalType;
                        
                        if (window.jQuery) {
                            window.jQuery('#BuyNowButton').click();
                        } else {
                            buyNowButton.click();
                        }
                    });
                });
            }
        }
    }
    
    // Add custom styles
    function addCustomStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .booking-widget-container {
                background: #ffffff;
                border: none;
                border-radius: 12px;
                padding: 32px;
                margin: 24px 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            }
            
            .booking-step {
                padding-top: 0;
            }
            
            .calendar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 28px;
            }
            
            .nav-button {
                background: transparent;
                color: #1a1a1a;
                border: none;
                padding: 8px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 20px;
                transition: all 0.2s ease;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .nav-button:hover {
                background: #f5f5f5;
            }
            
            #current-month {
                font-weight: 600;
                font-size: 18px;
                color: #1a1a1a;
            }
            
            .calendar-row {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                gap: 4px;
                margin-bottom: 4px;
            }
            
            .calendar-day-header {
                text-align: center;
                font-weight: 600;
                padding: 12px 4px;
                font-size: 12px;
                color: #666;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .calendar-day {
                text-align: center;
                padding: 0;
                background: transparent;
                cursor: pointer;
                min-height: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                color: #1a1a1a;
                transition: all 0.15s ease;
                border-radius: 8px;
                position: relative;
                font-weight: 500;
            }
            
            .calendar-day.other-month {
                color: #ccc;
                cursor: default;
            }
            
            .calendar-day.disabled {
                color: #ccc;
                cursor: not-allowed;
            }
            
            .calendar-day.has-availability {
                color: #333;
                font-weight: normal;
            }
            
            .calendar-day.has-availability:hover {
                background: #f5f5f5;
                cursor: pointer;
            }
            
            .calendar-day.fully-booked {
                color: #ccc;
                cursor: not-allowed;
                text-decoration: line-through;
            }
            
            .calendar-day.closed-day {
                color: #ccc;
                cursor: not-allowed;
                /* No strikethrough for closed days */
            }
            
            .calendar-day.selected {
                background: #ff6b35 !important;
                color: white;
                font-weight: 600;
            }
            
            #time-slots {
                display: flex;
                flex-direction: column;
                gap: 12px;
                margin: 24px 0;
            }
            
            .time-slot {
                padding: 16px 20px;
                border: 2px solid #e5e7eb;
                background: white;
                border-radius: 10px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 500;
                transition: all 0.15s ease;
                text-align: center;
                color: #1a1a1a;
            }
            
            .time-slot.available:hover {
                border-color: #ff6b35;
                background: #ffede6;
            }
            
            .time-slot.selected {
                background: #ff6b35;
                color: white;
                border-color: #ff6b35;
            }
            
            .time-slot.booked {
                background: #f9fafb;
                color: #9ca3af;
                cursor: not-allowed;
                border-color: #e5e7eb;
            }
            
            .secondary-button {
                background: transparent;
                color: #6b7280;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                cursor: pointer;
                margin-top: 20px;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.15s ease;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            
            .secondary-button:hover {
                background: #f5f5f5;
                color: #1a1a1a;
            }
            
            .booking-summary {
                background: #fff5f0;
                border: 2px solid #ff6b35;
                border-radius: 10px;
                padding: 20px;
                margin-top: 24px;
            }
            
            .booking-detail {
                margin: 8px 0;
                font-size: 16px;
                color: #1a1a1a;
                font-weight: 500;
            }
            
            .loading-indicator, .loading, .error, .no-slots {
                text-align: center;
                padding: 20px;
                color: #999;
                font-size: 14px;
            }
            
            .loading-indicator {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                padding: 30px;
            }
            
            .spinner {
                width: 32px;
                height: 32px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #ff6b35;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .error {
                color: #d32f2f;
            }
            
            #BuyNowButton {
                position: relative;
            }
            
            /* Calendar grid styling */
            #calendar-grid {
                border: none;
                border-radius: 12px;
                overflow: visible;
                background: transparent;
            }
            
            /* Modern calendar header styling */
            .calendar-header-row {
                margin-bottom: 16px;
            }
            
            /* Prevent form submission from widget clicks */
            #booking-widget button:not(#BuyNowButton) {
                type: button !important;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Hide cart button
    function hideCartButton() {
        const cartButton = document.getElementById('cart-icon-bubble');
        if (cartButton) {
            cartButton.style.display = 'none';
            console.log('Hidden cart button');
        }
        
        // Also check for dynamically loaded cart buttons
        const observer = new MutationObserver((mutations) => {
            const cartBtn = document.getElementById('cart-icon-bubble');
            if (cartBtn && cartBtn.style.display !== 'none') {
                cartBtn.style.display = 'none';
                console.log('Hidden dynamically loaded cart button');
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Payment Success Detection Module
    const PaymentDetector = {
        init() {
            if (!CONFIG.enablePaymentDetection) {
                console.log('[PaymentDetector] Disabled in configuration');
                return;
            }
            
            if (this.shouldDetectPayment()) {
                console.log('[PaymentDetector] Order success page detected, initiating sync...');
                this.detectAndSync();
            }
        },
        
        shouldDetectPayment() {
            const isSuccessPage = this.isOrderSuccessPage();
            const notAlreadyTriggered = !this.hasAlreadyTriggered();
            
            console.log('[PaymentDetector] Success page:', isSuccessPage, 'Not triggered:', notAlreadyTriggered);
            return isSuccessPage && notAlreadyTriggered;
        },
        
        isOrderSuccessPage() {
            const path = window.location.pathname;
            const params = new URLSearchParams(window.location.search);
            
            // Check URL pattern for order success page
            const hasOrderPath = path.includes('/orders/');
            const hasPaymentParam = params.get('payment_type') === 'sf_gateway_return';
            
            // Additional DOM confirmation
            const hasThankYou = document.querySelector('h1')?.textContent?.toLowerCase().includes('thank') ||
                                document.querySelector('h2')?.textContent?.toLowerCase().includes('thank');
            
            const hasOrderNumber = Array.from(document.querySelectorAll('*')).some(el => 
                el.textContent?.includes('Order Number:') || 
                el.textContent?.includes('Order #')
            );
            
            return hasOrderPath && (hasPaymentParam || hasThankYou || hasOrderNumber);
        },
        
        hasAlreadyTriggered() {
            const orderId = this.extractOrderId();
            if (!orderId) return false;
            
            const triggered = sessionStorage.getItem(`sync_triggered_${orderId}`);
            return triggered === 'true';
        },
        
        extractOrderId() {
            // Extract from URL path
            const path = window.location.pathname;
            const matches = path.match(/\/orders\/([a-zA-Z0-9-]+)/);
            return matches ? matches[1] : null;
        },
        
        extractOrderNumber() {
            // Try to find order number in the page
            const patterns = [
                /Order #(\d+)/,
                /Order Number:\s*(\d+)/,
                /#(\d+)/
            ];
            
            const pageText = document.body.innerText;
            for (const pattern of patterns) {
                const match = pageText.match(pattern);
                if (match) {
                    return match[1];
                }
            }
            
            return null;
        },
        
        extractOrderData() {
            const orderId = this.extractOrderId();
            const orderNumber = this.extractOrderNumber();
            
            if (!orderId) {
                console.error('[PaymentDetector] Could not extract order ID from URL');
                return null;
            }
            
            // Try to extract booking details from the order summary
            const bookingDetails = this.extractBookingDetails();
            
            const orderData = {
                orderId: orderId,
                orderNumber: orderNumber ? `#${orderNumber}` : null,
                timestamp: new Date().toISOString(),
                pageUrl: window.location.href,
                source: 'frontend-detection'
            };
            
            if (bookingDetails) {
                orderData.bookingDetails = bookingDetails;
            }
            
            console.log('[PaymentDetector] Extracted order data:', orderData);
            return orderData;
        },
        
        extractBookingDetails() {
            // Try to find booking date and time in the order summary
            const details = {};
            
            // Look for booking date
            const datePatterns = [
                /Booking Date[:\s]+([^\n,]+)/i,
                /Date[:\s]+([^\n,]+)/i,
                /Appointment[:\s]+([^\n,]+)/i
            ];
            
            const timePatterns = [
                /Booking Time[:\s]+([^\n,]+)/i,
                /Time[:\s]+([^\n,]+)/i,
                /Slot[:\s]+([^\n,]+)/i
            ];
            
            const pageText = document.body.innerText;
            
            for (const pattern of datePatterns) {
                const match = pageText.match(pattern);
                if (match) {
                    details.date = match[1].trim();
                    break;
                }
            }
            
            for (const pattern of timePatterns) {
                const match = pageText.match(pattern);
                if (match) {
                    details.time = match[1].trim();
                    break;
                }
            }
            
            return Object.keys(details).length > 0 ? details : null;
        },
        
        async detectAndSync() {
            const orderData = this.extractOrderData();
            if (!orderData) {
                console.error('[PaymentDetector] Could not extract order data');
                return;
            }
            
            try {
                await this.triggerSync(orderData);
                this.markAsTriggered(orderData.orderId);
                console.log('[PaymentDetector] Sync triggered successfully for order:', orderData.orderId);
            } catch (error) {
                console.error('[PaymentDetector] Failed to trigger sync:', error);
                // Don't mark as triggered on error, so it can be retried
            }
        },
        
        async triggerSync(orderData) {
            const syncUrl = `${CONFIG.backendUrl}/api/sync-order`;
            
            console.log('[PaymentDetector] Triggering sync to:', syncUrl);
            
            const response = await fetch(syncUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Source': 'frontend-detection',
                    'x-api-key': CONFIG.apiKey
                },
                body: JSON.stringify(orderData)
            });
            
            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`Sync failed: ${response.status} ${response.statusText} - ${errorData}`);
            }
            
            const result = await response.json();
            console.log('[PaymentDetector] Sync response:', result);
            
            // Show success indicator if possible
            this.showSyncStatus(result);
            
            return result;
        },
        
        showSyncStatus(result) {
            // Try to show a subtle indicator that sync was successful
            if (result.success && result.events && result.events.length > 0) {
                const event = result.events[0];
                console.log('[PaymentDetector] Calendar event created:', event.calendarEventLink);
                
                // You could add a subtle notification here if desired
                // For now, just log it
            }
        },
        
        markAsTriggered(orderId) {
            sessionStorage.setItem(`sync_triggered_${orderId}`, 'true');
            console.log('[PaymentDetector] Marked order as synced:', orderId);
        }
    };
    
    // Initialize when ready
    ready(function() {
        // Initialize booking widget only on product pages
        if (!PaymentDetector.isOrderSuccessPage()) {
            initBookingWidget();
            hideCartButton();
        }
        
        // Initialize payment detector
        PaymentDetector.init();
    });
    
})();
