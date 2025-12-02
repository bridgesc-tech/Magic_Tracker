// Storage key for collection data
const STORAGE_KEY = 'magic-tracker-collection';

// API endpoint for Scryfall
const SCRYFALL_API = 'https://api.scryfall.com/cards/search';

// Set configurations
const SETS = {
    tla: {
        code: 'tla',
        name: 'Avatar: The Last Airbender',
        missingCards: [363, 393, 394],
        totalCards: 394, // Expected total card count
        placeholderCards: [
            { number: 287, name: "Plains" },
            { number: 288, name: "Island" },
            { number: 289, name: "Swamp" },
            { number: 290, name: "Mountain" },
            { number: 291, name: "Forest" },
            { number: 292, name: "Plains" },
            { number: 293, name: "Island" },
            { number: 294, name: "Swamp" },
            { number: 295, name: "Mountain" },
            { number: 296, name: "Forest" }
        ] // Array of {number: X, name: "Card Name"} for cards not in Scryfall
    },
    tle: {
        code: 'tle',
        name: 'Avatar: The Last Airbender Eternal',
        missingCards: [], // Will be determined if needed
        totalCards: 317, // Expected total card count
        placeholderCards: [] // Array of {number: X, name: "Card Name"} for cards not in Scryfall
    }
};

// Current state
let currentSet = 'tla';
let cards = [];
let searchTerm = ''; // Current search term
let collectionState = {}; // Will be organized by set: { tla: {...}, tle: {...} }
let cardsCache = {}; // Cache cards by set code

// Initialize app
async function init() {
    // Display current version
    displayVersion();
    
    // Set up update checking
    setupUpdateChecking();
    
    // Load saved collection state
    loadCollectionState();
    
    // Set up tab switching
    setupTabs();
    
    // Set up search functionality
    setupSearch();
    
    // Load initial set
    await loadSet(currentSet);
}

// Load collection state from localStorage
function loadCollectionState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            
            // Check if it's old format (flat structure) or new format (organized by set)
            if (parsed.tla || parsed.tle) {
                // New format: organized by set
                collectionState = parsed;
            } else {
                // Old format: migrate to new format (assume TLA)
                collectionState = { tla: {}, tle: {} };
                for (const [key, value] of Object.entries(parsed)) {
                    if (typeof value === 'boolean') {
                        collectionState.tla[key] = { collected: value, foil: false };
                    } else {
                        collectionState.tla[key] = value;
                    }
                }
                saveCollectionState(); // Save migrated format
            }
        } catch (e) {
            console.error('Error loading collection state:', e);
            collectionState = { tla: {}, tle: {} };
        }
    } else {
        collectionState = { tla: {}, tle: {} };
    }
}

// Save collection state to localStorage
function saveCollectionState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectionState));
    } catch (e) {
        console.error('Error saving collection state:', e);
    }
}

// Set up tab switching
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const setCode = button.dataset.set;
            switchToSet(setCode);
        });
    });
}

// Set up search functionality
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    
    if (!searchInput || !clearSearchBtn) return;
    
    // Search as user types
    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        updateClearButton();
        renderCards();
    });
    
    // Clear search button
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchTerm = '';
        updateClearButton();
        renderCards();
    });
    
    // Update clear button visibility
    function updateClearButton() {
        if (searchTerm) {
            clearSearchBtn.classList.remove('hidden');
        } else {
            clearSearchBtn.classList.add('hidden');
        }
    }
}

// Switch to a different set
async function switchToSet(setCode) {
    if (setCode === currentSet) return;
    
    // Clear search when switching sets
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (searchInput) {
        searchInput.value = '';
        searchTerm = '';
        if (clearSearchBtn) {
            clearSearchBtn.classList.add('hidden');
        }
    }
    
    // Update active tab
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.set === setCode);
    });
    
    // Update subtitle
    const subtitle = document.getElementById('set-subtitle');
    subtitle.textContent = SETS[setCode].name;
    
    currentSet = setCode;
    
    // Load set (from cache or fetch)
    await loadSet(setCode);
}

// Load a set (from cache or fetch)
async function loadSet(setCode) {
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'block';
    loadingEl.textContent = 'Loading cards...';
    
    // Check cache first
    if (cardsCache[setCode]) {
        cards = cardsCache[setCode];
        renderCards();
        updateStats();
        loadingEl.style.display = 'none';
        return;
    }
    
    // Reset cards array for fresh load
    cards = [];
    
    // Fetch cards (this will also call fetchVariantCards which updates stats at the end)
    await fetchCards(setCode);
    
    // Cache the cards (after all cards including variants are loaded)
    cardsCache[setCode] = cards;
    
    // Render and update (in case fetchVariantCards didn't call them)
    renderCards();
    updateStats();
    loadingEl.style.display = 'none';
}

// Fetch cards from Scryfall API
async function fetchCards(setCode = currentSet) {
    const loadingEl = document.getElementById('loading');
    loadingEl.textContent = 'Loading cards from Scryfall...';
    
    const setConfig = SETS[setCode];
    const setCodeUpper = setCode.toUpperCase();
    
    try {
        // First, get information about the set to see if there are related sets
        const setInfoResponse = await fetch(`https://api.scryfall.com/sets/${setCode}`);
        let relatedSetCodes = [setCode]; // Start with main set
        
        if (setInfoResponse.ok) {
            const setInfo = await setInfoResponse.json();
            console.log('Set info:', setInfo.name, 'Card count:', setInfo.card_count);
            
            // Check if there are parent or child sets
            if (setInfo.parent_set_code) {
                relatedSetCodes.push(setInfo.parent_set_code);
            }
            // Note: Scryfall API doesn't directly list child sets, but we can try common variant codes
        }
        
        // Query for ALL cards from the set and any related sets
        // Try multiple queries to get all variants
        console.log(`Querying Scryfall for all ${setConfig.name} cards...`);
        
        // Main query - get all cards from the set
        let response = await fetch(`${SCRYFALL_API}?q=set:${setCode}`);
        
        if (!response.ok) {
            console.log('Set query failed, trying alternative...');
            response = await fetch(`${SCRYFALL_API}?q=s:${setCode}`);
        }
        
        // Check for API errors
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (errorData.code === 'not_found' || response.status === 404) {
                // Try alternative search methods
                await fetchCardsAlternative(setCode);
                return;
            }
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check for API errors in response
        if (data.object === 'error') {
            console.error('Scryfall API error:', data);
            await fetchCardsAlternative(setCode);
            return;
        }
        
        if (data.data && data.data.length > 0) {
            console.log(`Loaded ${data.data.length} cards from ${setCodeUpper} set`);
            console.log(`API reports total_cards: ${data.total_cards}`);
            console.log(`Has more pages: ${data.has_more}`);
            
            // Process cards and sort by collector number
            cards = data.data
                .filter(card => {
                    // Handle both regular cards and double-faced cards
                    if (card.image_uris && card.image_uris.normal) {
                        return true;
                    }
                    // Check if it's a double-faced card
                    if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                        return true;
                    }
                    return false;
                })
                .sort((a, b) => {
                    // Sort by collector number if available
                    const numA = parseInt(a.collector_number) || 0;
                    const numB = parseInt(b.collector_number) || 0;
                    return numA - numB;
                });
            
            // Handle pagination if needed
            if (data.has_more && data.next_page) {
                console.log('Fetching additional pages...');
                await fetchMoreCards(data.next_page);
            }
            
            // After loading main set, try to find additional cards from related sets or variants
            // Query for cards that might be variants (showcase, extended art, borderless, etc.)
            console.log(`Main set loaded: ${cards.length} cards. Checking for variants...`);
            await fetchVariantCards(setCode);
            
            // Re-sort all cards after all fetching is complete
            cards.sort((a, b) => {
                const numA = parseInt(a.collector_number) || 0;
                const numB = parseInt(b.collector_number) || 0;
                return numA - numB;
            });
            
            console.log(`Total cards loaded: ${cards.length}`);
            
            // Don't render or update stats here - wait for fetchVariantCards to complete
        } else {
            // Fallback: try alternative search
            await fetchCardsAlternative(setCode);
        }
        
        // Note: renderCards() and updateStats() will be called after fetchVariantCards completes
        // or from loadSet() after fetchCards completes
    } catch (error) {
        console.error('Error fetching cards:', error);
        loadingEl.textContent = 'Error loading cards. Please check your connection.';
        // Try alternative method
        await fetchCardsAlternative(setCode);
    }
}

// Fetch variant cards (showcase, extended art, promos, etc.)
async function fetchVariantCards(setCode = currentSet) {
    const setConfig = SETS[setCode];
    try {
        // Query for cards that are variants or have special treatments from the set
        // Try querying by set name to catch all related cards
        const setCodeUpper = setCode.toUpperCase();
        
        // First, try to use Scryfall's set cards endpoint to get ALL cards
        // This endpoint returns all cards including all variants
        console.log(`Querying for ALL cards from ${setCodeUpper} set using set cards endpoint...`);
        try {
            // Try the set cards endpoint: /sets/{code}/cards
            const setCardsResponse = await fetch(`https://api.scryfall.com/sets/${setCode}/cards`);
            if (setCardsResponse.ok) {
                const setCardsData = await setCardsResponse.json();
                if (setCardsData.data && setCardsData.data.length > 0) {
                    const allNewCards = setCardsData.data.filter(card => {
                        if (existingCardIds.has(card.id)) {
                            return false;
                        }
                        if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                            return false;
                        }
                        if (card.image_uris && card.image_uris.normal) {
                            return true;
                        }
                        if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                            return true;
                        }
                        return false;
                    });
                    
                    if (allNewCards.length > 0) {
                        console.log(`Found ${allNewCards.length} additional cards from set cards endpoint (response had ${setCardsData.data.length} cards, total_cards: ${setCardsData.total_cards || 'unknown'})`);
                        cards = [...cards, ...allNewCards];
                        allNewCards.forEach(card => existingCardIds.add(card.id));
                        foundNewCards = true;
                        
                        // Handle pagination for set cards endpoint
                        if (setCardsData.has_more && setCardsData.next_page) {
                            console.log(`Set cards endpoint has pagination, fetching all pages...`);
                            let nextPage = setCardsData.next_page;
                            while (nextPage) {
                                try {
                                    const pageResponse = await fetch(nextPage);
                                    if (pageResponse.ok) {
                                        const pageData = await pageResponse.json();
                                        if (pageData.data && pageData.data.length > 0) {
                                            const moreNewCards = pageData.data.filter(card => {
                                                if (existingCardIds.has(card.id)) {
                                                    return false;
                                                }
                                                if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                                                    return false;
                                                }
                                                if (card.image_uris && card.image_uris.normal) {
                                                    return true;
                                                }
                                                if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                                    return true;
                                                }
                                                return false;
                                            });
                                            
                                            if (moreNewCards.length > 0) {
                                                console.log(`Found ${moreNewCards.length} more cards from set cards pagination`);
                                                cards = [...cards, ...moreNewCards];
                                                moreNewCards.forEach(card => existingCardIds.add(card.id));
                                            }
                                            
                                            nextPage = pageData.has_more ? pageData.next_page : null;
                                        } else {
                                            nextPage = null;
                                        }
                                    } else {
                                        nextPage = null;
                                    }
                                } catch (err) {
                                    console.error('Error fetching set cards pagination:', err);
                                    nextPage = null;
                                }
                            }
                        }
                    }
                }
            } else {
                // Fallback to search query if set endpoint doesn't work
                console.log(`Set cards endpoint returned ${setCardsResponse.status}, trying search query...`);
                const allCardsResponse = await fetch(`${SCRYFALL_API}?q=set:${setCode}&unique=prints`);
                if (allCardsResponse.ok) {
                    const allCardsData = await allCardsResponse.json();
                    if (allCardsData.data && allCardsData.data.length > 0) {
                        const allNewCards = allCardsData.data.filter(card => {
                            if (existingCardIds.has(card.id)) {
                                return false;
                            }
                            if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                                return false;
                            }
                            if (card.image_uris && card.image_uris.normal) {
                                return true;
                            }
                            if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                return true;
                            }
                            return false;
                        });
                        
                        if (allNewCards.length > 0) {
                            console.log(`Found ${allNewCards.length} additional cards from search query with unique=prints (response had ${allCardsData.data.length} cards)`);
                            cards = [...cards, ...allNewCards];
                            allNewCards.forEach(card => existingCardIds.add(card.id));
                            foundNewCards = true;
                            
                            // Handle pagination
                            if (allCardsData.has_more && allCardsData.next_page) {
                                let nextPage = allCardsData.next_page;
                                while (nextPage) {
                                    try {
                                        const pageResponse = await fetch(nextPage);
                                        if (pageResponse.ok) {
                                            const pageData = await pageResponse.json();
                                            if (pageData.data && pageData.data.length > 0) {
                                                const moreNewCards = pageData.data.filter(card => {
                                                    if (existingCardIds.has(card.id)) {
                                                        return false;
                                                    }
                                                    if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                                                        return false;
                                                    }
                                                    if (card.image_uris && card.image_uris.normal) {
                                                        return true;
                                                    }
                                                    if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                                        return true;
                                                    }
                                                    return false;
                                                });
                                                
                                                if (moreNewCards.length > 0) {
                                                    cards = [...cards, ...moreNewCards];
                                                    moreNewCards.forEach(card => existingCardIds.add(card.id));
                                                }
                                                
                                                nextPage = pageData.has_more ? pageData.next_page : null;
                                            } else {
                                                nextPage = null;
                                            }
                                        } else {
                                            nextPage = null;
                                        }
                                    } catch (err) {
                                        console.error('Error fetching search pagination:', err);
                                        nextPage = null;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.log('Set cards endpoint query failed, continuing with variant queries...', err);
        }
        
        // Then try specific variant queries to catch any remaining cards
        const variantQueries = [
            `set:${setCode} (is:showcase or is:extendedart or is:borderless or is:promo)`,
            `set:${setCode} frame:showcase`,
            `set:${setCode} frame:extendedart`,
            `set:${setCode} frame:borderless`,
            // Try to catch borderless battle pose cards
            `set:${setCode} borderless`,
            `set:${setCode} (borderless or "battle pose" or "neon")`
        ];
        
        const existingCardIds = new Set(cards.map(card => card.id));
        let foundNewCards = false;
        
        for (const query of variantQueries) {
            try {
                // Use unique=prints to get all printings including variants
                const queryUrl = `${SCRYFALL_API}?q=${encodeURIComponent(query)}&unique=prints`;
                const response = await fetch(queryUrl);
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.object === 'error') {
                        console.log(`Query "${query}" returned error:`, data);
                        continue;
                    }
                    
                    if (data.data && data.data.length > 0) {
                        const newCards = data.data.filter(card => {
                            // Only add cards we don't already have
                            if (existingCardIds.has(card.id)) {
                                return false;
                            }
                            
                            // Only include cards from the current set
                            if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                                return false;
                            }
                            
                            // Handle both regular cards and double-faced cards
                            if (card.image_uris && card.image_uris.normal) {
                                return true;
                            }
                            if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                return true;
                            }
                            return false;
                        });
                        
                        if (newCards.length > 0) {
                            console.log(`Found ${newCards.length} additional cards from query: ${query} (total in response: ${data.data.length}, has_more: ${data.has_more}, total_cards: ${data.total_cards || 'unknown'})`);
                            cards = [...cards, ...newCards];
                            newCards.forEach(card => existingCardIds.add(card.id));
                            foundNewCards = true;
                            
                            // If this is the main set query (set:tla), handle all pagination
                            if (query === `set:${setCode}` && data.has_more && data.next_page) {
                                console.log(`Main set variant query has pagination, fetching all pages...`);
                                let nextPage = data.next_page;
                                while (nextPage) {
                                    try {
                                        const pageResponse = await fetch(nextPage);
                                        if (pageResponse.ok) {
                                            const pageData = await pageResponse.json();
                                            if (pageData.data && pageData.data.length > 0) {
                                                const moreNewCards = pageData.data.filter(card => {
                                                    if (existingCardIds.has(card.id)) {
                                                        return false;
                                                    }
                                                    if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                                                        return false;
                                                    }
                                                    if (card.image_uris && card.image_uris.normal) {
                                                        return true;
                                                    }
                                                    if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                                        return true;
                                                    }
                                                    return false;
                                                });
                                                
                                                if (moreNewCards.length > 0) {
                                                    console.log(`Found ${moreNewCards.length} more cards from main set pagination`);
                                                    cards = [...cards, ...moreNewCards];
                                                    moreNewCards.forEach(card => existingCardIds.add(card.id));
                                                }
                                                
                                                nextPage = pageData.has_more ? pageData.next_page : null;
                                            } else {
                                                nextPage = null;
                                            }
                                        } else {
                                            nextPage = null;
                                        }
                                    } catch (err) {
                                        console.error('Error fetching main set pagination:', err);
                                        nextPage = null;
                                    }
                                }
                            }
                            
                            // Handle pagination for variants - keep fetching until all pages are loaded
                            if (data.has_more && data.next_page) {
                                console.log(`Variant query has more pages. Fetching additional variant cards...`);
                                let nextPage = data.next_page;
                                while (nextPage) {
                                    try {
                                        const pageResponse = await fetch(nextPage);
                                        if (pageResponse.ok) {
                                            const pageData = await pageResponse.json();
                                            if (pageData.data && pageData.data.length > 0) {
                                                const moreNewCards = pageData.data.filter(card => {
                                                    // Only add cards we don't already have
                                                    if (existingCardIds.has(card.id)) {
                                                        return false;
                                                    }
                                                    
                                                    // Only include cards from the current set
                                                    if (card.set && card.set.toLowerCase() !== setCode.toLowerCase()) {
                                                        return false;
                                                    }
                                                    
                                                    if (card.image_uris && card.image_uris.normal) {
                                                        return true;
                                                    }
                                                    if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                                        return true;
                                                    }
                                                    return false;
                                                });
                                                
                                                if (moreNewCards.length > 0) {
                                                    console.log(`Found ${moreNewCards.length} more variant cards from pagination`);
                                                    cards = [...cards, ...moreNewCards];
                                                    moreNewCards.forEach(card => existingCardIds.add(card.id));
                                                }
                                                
                                                nextPage = pageData.has_more ? pageData.next_page : null;
                                            } else {
                                                nextPage = null;
                                            }
                                        } else {
                                            nextPage = null;
                                        }
                                    } catch (err) {
                                        console.error('Error fetching variant pagination:', err);
                                        nextPage = null;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.log(`Variant query "${query}" failed:`, err);
                continue;
            }
        }
        
        // Specifically look for the missing cards by collector number (if any)
        // First check which ones are actually missing
        if (setConfig.missingCards && setConfig.missingCards.length > 0) {
            const actuallyMissing = setConfig.missingCards.filter(num => {
                const found = cards.some(card => parseInt(card.collector_number) === num);
                if (found) {
                    console.log(`Card #${num} is already in the main set, skipping search`);
                }
                return !found;
            });
            
            if (actuallyMissing.length > 0) {
                console.log(`Looking for specific missing cards (${actuallyMissing.join(', ')})...`);
                await fetchSpecificCards(actuallyMissing, existingCardIds, setCode);
                
                // Also try a broader search for any cards with these numbers that mention Avatar
                await fetchCardsByNumberAndName(actuallyMissing, existingCardIds, setCode);
            } else {
                console.log('All specified missing cards are already in the main set');
            }
        }
        
        // Re-sort all cards after all fetching is complete
        cards.sort((a, b) => {
            const numA = parseInt(a.collector_number) || 0;
            const numB = parseInt(b.collector_number) || 0;
            return numA - numB;
        });
        
        // Remove any duplicate cards (by ID) just to be safe
        const uniqueCards = [];
        const seenIds = new Set();
        for (const card of cards) {
            if (!seenIds.has(card.id)) {
                seenIds.add(card.id);
                uniqueCards.push(card);
            }
        }
        
        if (uniqueCards.length !== cards.length) {
            console.log(`Removed ${cards.length - uniqueCards.length} duplicate cards`);
            cards = uniqueCards;
        }
        
        // Add placeholder cards for missing cards
        addPlaceholderCards(setCode);
        
        // Re-sort after adding placeholders
        cards.sort((a, b) => {
            const numA = parseInt(a.collector_number) || 0;
            const numB = parseInt(b.collector_number) || 0;
            return numA - numB;
        });
        
        // Final update after all cards are loaded
        console.log(`Final total: ${cards.length} cards loaded (expected: ${setCode === 'tla' ? 394 : setCode === 'tle' ? 317 : 'unknown'})`);
        
        // Render and update stats with final count
        renderCards();
        updateStats();
    } catch (error) {
        console.error('Error fetching variant cards:', error);
    }
}

// Fetch specific cards by collector number that might be in different sets
async function fetchSpecificCards(collectorNumbers, existingCardIds, setCode = currentSet) {
    const setConfig = SETS[setCode];
    try {
        for (const number of collectorNumbers) {
            // Query for cards with this collector number in the set
            // Try multiple query formats to catch cards in different sections
            const queries = [
                `set:${setCode} number:${number}`,
                `set:"${setConfig.name}" number:${number}`,
                `setname:"Avatar" number:${number}`,
                `number:${number} set:${setCode}`,
                `cn:${number} set:${setCode}`,
                `collector:${number} set:${setCode}`
            ];
            
            let found = false;
            for (const query of queries) {
                try {
                    const response = await fetch(`${SCRYFALL_API}?q=${encodeURIComponent(query)}`);
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        if (data.object === 'error') {
                            continue;
                        }
                        
                        if (data.data && data.data.length > 0) {
                            const newCards = data.data.filter(card => {
                                // Check if collector number matches
                                const cardNum = parseInt(card.collector_number);
                                if (cardNum !== number) {
                                    return false;
                                }
                                
                                // Must be from the current set
                                if (!card.set || card.set.toLowerCase() !== setCode.toLowerCase()) {
                                    return false;
                                }
                                
                                // Only add if we don't have it and it has an image
                                if (existingCardIds.has(card.id)) {
                                    return false;
                                }
                                
                                if (card.image_uris && card.image_uris.normal) {
                                    return true;
                                }
                                if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                    return true;
                                }
                                return false;
                            });
                            
                            if (newCards.length > 0) {
                                console.log(`Found card #${number}: ${newCards[0].name || 'Unknown'} (Set: ${newCards[0].set || 'Unknown'})`);
                                cards = [...cards, ...newCards];
                                newCards.forEach(card => existingCardIds.add(card.id));
                                found = true;
                                
                                // Handle pagination
                                if (data.has_more && data.next_page) {
                                    await fetchMoreCards(data.next_page, existingCardIds);
                                }
                                break; // Found it, move to next number
                            }
                        }
                    }
                } catch (err) {
                    continue;
                }
            }
            
            if (!found) {
                console.log(`Warning: Could not find card #${number} in Avatar set`);
            }
        }
        
        // Cards will be sorted and displayed at the end of fetchVariantCards
    } catch (error) {
        console.error('Error fetching specific cards:', error);
    }
}

// Fetch cards by collector number that might be in related sets (like Secret Lair)
async function fetchCardsByNumberAndName(collectorNumbers, existingCardIds, setCode = currentSet) {
    const setConfig = SETS[setCode];
    try {
        // These cards might be in a related set like Secret Lair or a promo set
        // Search for cards with these numbers that are associated with Avatar
        for (const number of collectorNumbers) {
            const queries = [
                `cn:${number} (set:${setCode} or setname:"Avatar")`,
                `number:${number} (set:${setCode} or setname:"Avatar")`,
                `collector:${number} (set:${setCode} or setname:"Avatar")`,
                // Also try searching by the actual card names if we can find them
                `cn:${number}`
            ];
            
            for (const query of queries) {
                try {
                    const response = await fetch(`${SCRYFALL_API}?q=${encodeURIComponent(query)}`);
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        if (data.object === 'error') {
                            continue;
                        }
                        
                        if (data.data && data.data.length > 0) {
                            // Filter for cards that match the collector number and are from the current set
                            const newCards = data.data.filter(card => {
                                const cardNum = parseInt(card.collector_number);
                                if (cardNum !== number) {
                                    return false;
                                }
                                
                                // Must be from the current set
                                if (!card.set || card.set.toLowerCase() !== setCode.toLowerCase()) {
                                    return false;
                                }
                                
                                // Only add if we don't have it
                                if (existingCardIds.has(card.id)) {
                                    return false;
                                }
                                
                                if (card.image_uris && card.image_uris.normal) {
                                    return true;
                                }
                                if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                    return true;
                                }
                                return false;
                            });
                            
                            if (newCards.length > 0) {
                                console.log(`Found card #${number} in related set: ${newCards[0].name || 'Unknown'} (Set: ${newCards[0].set_name || newCards[0].set || 'Unknown'})`);
                                cards = [...cards, ...newCards];
                                newCards.forEach(card => existingCardIds.add(card.id));
                                
                                // Handle pagination
                                if (data.has_more && data.next_page) {
                                    await fetchMoreCards(data.next_page, existingCardIds);
                                }
                                break; // Found it
                            }
                        }
                    }
                } catch (err) {
                    continue;
                }
            }
        }
        
        // Cards will be sorted and displayed at the end of fetchVariantCards
    } catch (error) {
        console.error('Error fetching cards by number and name:', error);
    }
}

// Fetch more cards if paginated
async function fetchMoreCards(nextPageUrl, existingCardIds = null) {
    try {
        const response = await fetch(nextPageUrl);
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            console.log(`Loading page: ${data.data.length} more cards...`);
            
            let moreCards = data.data.filter(card => {
                // Handle both regular cards and double-faced cards
                if (card.image_uris && card.image_uris.normal) {
                    return true;
                }
                if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                    return true;
                }
                return false;
            });
            
            // If we have existing card IDs (from variant fetch), filter out duplicates
            if (existingCardIds) {
                moreCards = moreCards.filter(card => !existingCardIds.has(card.id));
                moreCards.forEach(card => existingCardIds.add(card.id));
            }
            
            if (moreCards.length > 0) {
                moreCards.sort((a, b) => {
                    const numA = parseInt(a.collector_number) || 0;
                    const numB = parseInt(b.collector_number) || 0;
                    return numA - numB;
                });
                
                cards = [...cards, ...moreCards].sort((a, b) => {
                    const numA = parseInt(a.collector_number) || 0;
                    const numB = parseInt(b.collector_number) || 0;
                    return numA - numB;
                });
            }
            
            console.log(`Total cards so far: ${cards.length} (has_more: ${data.has_more})`);
            
            if (data.has_more && data.next_page) {
                await fetchMoreCards(data.next_page, existingCardIds);
            } else {
                console.log(`Finished loading page. Total cards: ${cards.length}`);
            }
        }
    } catch (error) {
        console.error('Error fetching more cards:', error);
    }
}

// Alternative fetch method if primary fails
async function fetchCardsAlternative(setCode = currentSet) {
    const setConfig = SETS[setCode];
    const loadingEl = document.getElementById('loading');
    try {
        // Try different queries to get all cards including variants
        // Query all printings without uniqueness constraints
        const endpoints = [
            `${SCRYFALL_API}?q=set:${setCode}`,
            `${SCRYFALL_API}?q=s:${setCode}`,
            `${SCRYFALL_API}?q=set:"${setConfig.name}"`,
            `${SCRYFALL_API}?q=set:"Avatar The Last Airbender"`
        ];
        
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint);
                
                if (response.ok) {
                    const data = await response.json();
                    
                    // Check for API errors
                    if (data.object === 'error') {
                        console.log(`Endpoint "${endpoint}" returned error:`, data);
                        continue;
                    }
                    
                    if (data.data && data.data.length > 0) {
                        console.log(`Successfully loaded ${data.data.length} cards using endpoint: ${endpoint} (total: ${data.total_cards || 'unknown'})`);
                        cards = data.data
                            .filter(card => {
                                // Handle both regular cards and cards with card_faces
                                if (card.image_uris && card.image_uris.normal) {
                                    return true;
                                }
                                // Check if it's a double-faced card
                                if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
                                    return true;
                                }
                                return false;
                            })
                            .sort((a, b) => {
                                const numA = parseInt(a.collector_number) || 0;
                                const numB = parseInt(b.collector_number) || 0;
                                return numA - numB;
                            });
                        
                        if (data.has_more && data.next_page) {
                            console.log('Fetching additional pages from alternative endpoint...');
                            await fetchMoreCards(data.next_page);
                        }
                        
                        console.log(`Total cards loaded: ${cards.length}`);
                        loadingEl.style.display = 'none';
                        return;
                    }
                }
            } catch (err) {
                console.log(`Endpoint "${endpoint}" failed, trying next...`, err);
                continue;
            }
        }
    } catch (error) {
        console.error('Alternative fetch also failed:', error);
    }
    
    // If all else fails, show error message
    loadingEl.textContent = 'Unable to load cards. Please check the set code or try again later.';
}

// Add placeholder cards for cards not found in Scryfall
function addPlaceholderCards(setCode) {
    const setConfig = SETS[setCode];
    if (!setConfig || !setConfig.placeholderCards || setConfig.placeholderCards.length === 0) {
        return;
    }
    
    const existingNumbers = new Set(cards.map(card => parseInt(card.collector_number)));
    
    setConfig.placeholderCards.forEach(placeholder => {
        const cardNumber = placeholder.number;
        
        // Only add if we don't already have this card number
        if (!existingNumbers.has(cardNumber)) {
            const placeholderCard = {
                id: `placeholder-${setCode}-${cardNumber}`,
                name: placeholder.name,
                collector_number: cardNumber.toString(),
                set: setCode,
                is_placeholder: true, // Flag to identify placeholder cards
                image_uris: null // No image for placeholders
            };
            
            cards.push(placeholderCard);
            existingNumbers.add(cardNumber);
            console.log(`Added placeholder card: #${cardNumber} - ${placeholder.name}`);
        }
    });
}

// Render cards to the DOM
function renderCards() {
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    
    if (cards.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem;">No cards found.</p>';
        return;
    }
    
    // Filter cards based on search term
    let cardsToRender = cards;
    if (searchTerm) {
        cardsToRender = cards.filter(card => {
            const cardName = (card.name || (card.card_faces && card.card_faces[0] && card.card_faces[0].name) || '').toLowerCase();
            const collectorNumber = (card.collector_number || '').toString();
            
            return cardName.includes(searchTerm) || collectorNumber.includes(searchTerm);
        });
    }
    
    if (cardsToRender.length === 0) {
        container.innerHTML = `<p style="text-align: center; padding: 2rem;">No cards found matching "${searchTerm}".</p>`;
        return;
    }
    
    cardsToRender.forEach((card, index) => {
        const cardId = card.id || `card-${index}`;
        
        // Get collection state for current set
        if (!collectionState[currentSet]) {
            collectionState[currentSet] = {};
        }
        
        const cardState = collectionState[currentSet][cardId] || { collected: false, foil: false };
        const isCollected = cardState.collected === true;
        const isFoil = cardState.foil === true;
        const collectorNumber = card.collector_number || index + 1;
        
        // Handle both regular cards and double-faced cards
        // For placeholder cards, use a blank placeholder image
        let imageUrl = '';
        const isPlaceholder = card.is_placeholder === true;
        
        if (isPlaceholder) {
            // Create a blank placeholder image for cards not in Scryfall
            imageUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="280"%3E%3Crect fill="%23222" width="200" height="280"/%3E%3Crect fill="%23333" x="10" y="10" width="180" height="260" rx="5"/%3C/svg%3E';
        } else if (card.image_uris) {
            imageUrl = card.image_uris.normal || card.image_uris.large || '';
        } else if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
            // Use the front face of double-faced cards
            imageUrl = card.card_faces[0].image_uris.normal || card.card_faces[0].image_uris.large || '';
        }
        
        const cardElement = document.createElement('div');
        cardElement.className = `card-item ${isCollected ? 'collected' : ''} ${isPlaceholder ? 'placeholder' : ''}`;
        cardElement.dataset.cardId = cardId;
        cardElement.addEventListener('click', () => toggleCard(cardId));
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = card.name || `Card ${collectorNumber}`;
        img.className = 'card-image';
        img.loading = 'lazy';
        
        // Handle image load errors (only for non-placeholder cards)
        if (!isPlaceholder) {
            img.onerror = function() {
                this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="280"%3E%3Crect fill="%23333" width="200" height="280"/%3E%3Ctext fill="%23fff" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3EImage not available%3C/text%3E%3C/svg%3E';
            };
        }
        
        // Get card name (handle double-faced cards)
        const cardName = card.name || (card.card_faces && card.card_faces[0] && card.card_faces[0].name) || `Card ${collectorNumber}`;
        
        const infoLabel = document.createElement('div');
        infoLabel.className = 'card-info';
        
        const numberLabel = document.createElement('span');
        numberLabel.className = 'card-number';
        numberLabel.textContent = `#${collectorNumber}`;
        
        const nameLabel = document.createElement('span');
        nameLabel.className = 'card-name';
        nameLabel.textContent = cardName;
        
        infoLabel.appendChild(numberLabel);
        infoLabel.appendChild(nameLabel);
        
        cardElement.appendChild(img);
        cardElement.appendChild(infoLabel);
        
        // Add foil star icon for collected cards
        if (isCollected) {
            const foilStar = createFoilStar(cardId, isFoil);
            cardElement.appendChild(foilStar);
        }
        
        container.appendChild(cardElement);
    });
}

// Create foil star icon (9-pointed star)
function createFoilStar(cardId, isFoil) {
    const starContainer = document.createElement('div');
    starContainer.className = 'foil-star-container';
    starContainer.dataset.cardId = cardId;
    
    const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starSvg.setAttribute('viewBox', '0 0 100 100');
    starSvg.setAttribute('class', `foil-star ${isFoil ? 'foil' : ''}`);
    
    // Create 9-pointed star path
    const centerX = 50;
    const centerY = 50;
    const outerRadius = 40;
    const innerRadius = 20;
    const points = 9;
    let pathData = '';
    
    for (let i = 0; i < points * 2; i++) {
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        pathData += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
    }
    pathData += 'Z';
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', isFoil ? '#C0C0C0' : 'none');
    path.setAttribute('stroke', isFoil ? '#C0C0C0' : '#ffffff');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    
    starSvg.appendChild(path);
    starContainer.appendChild(starSvg);
    
    // Prevent card toggle when clicking star
    starContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFoil(cardId);
    });
    
    return starContainer;
}

// Toggle card collection state
function toggleCard(cardId) {
    // Get collection state for current set
    if (!collectionState[currentSet]) {
        collectionState[currentSet] = {};
    }
    
    const currentState = collectionState[currentSet][cardId] || { collected: false, foil: false };
    
    // If card is currently collected, ask for confirmation before deselecting
    if (currentState.collected) {
        const cardElement = document.querySelector(`[data-card-id="${cardId}"]`);
        const cardName = cardElement ? cardElement.querySelector('.card-name')?.textContent || 'this card' : 'this card';
        
        if (!confirm(`Are you sure you want to remove "${cardName}" from your collection?`)) {
            // User cancelled, don't deselect
            return;
        }
    }
    
    // Proceed with toggle
    collectionState[currentSet][cardId] = {
        collected: !currentState.collected,
        foil: currentState.collected ? currentState.foil : false // Reset foil if uncollecting
    };
    saveCollectionState();
    
    // Update UI
    const cardElement = document.querySelector(`[data-card-id="${cardId}"]`);
    if (cardElement) {
        if (collectionState[currentSet][cardId].collected) {
            cardElement.classList.add('collected');
            // Add foil star if not already present
            if (!cardElement.querySelector('.foil-star-container')) {
                const foilStar = createFoilStar(cardId, collectionState[currentSet][cardId].foil);
                cardElement.appendChild(foilStar);
            }
        } else {
            cardElement.classList.remove('collected');
            // Remove foil star
            const starContainer = cardElement.querySelector('.foil-star-container');
            if (starContainer) {
                starContainer.remove();
            }
        }
    }
    
    updateStats();
}

// Toggle foil state
function toggleFoil(cardId) {
    // Get collection state for current set
    if (!collectionState[currentSet]) {
        collectionState[currentSet] = {};
    }
    
    const currentState = collectionState[currentSet][cardId] || { collected: false, foil: false };
    if (!currentState.collected) return; // Can't set foil if not collected
    
    collectionState[currentSet][cardId] = {
        collected: currentState.collected,
        foil: !currentState.foil
    };
    saveCollectionState();
    
    // Update UI
    const cardElement = document.querySelector(`[data-card-id="${cardId}"]`);
    if (cardElement) {
        const starSvg = cardElement.querySelector('.foil-star');
        if (starSvg) {
            const path = starSvg.querySelector('path');
            if (collectionState[currentSet][cardId].foil) {
                starSvg.classList.add('foil');
                if (path) {
                    path.setAttribute('fill', '#C0C0C0');
                    path.setAttribute('stroke', '#C0C0C0');
                }
            } else {
                starSvg.classList.remove('foil');
                if (path) {
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', '#ffffff');
                }
            }
        }
    }
}

// Update collection statistics
function updateStats() {
    // Use the expected total from set config, not the actual loaded count
    const setConfig = SETS[currentSet];
    const expectedTotal = setConfig ? setConfig.totalCards : cards.length;
    
    // Get collected count for current set
    if (!collectionState[currentSet]) {
        collectionState[currentSet] = {};
    }
    
    const collected = Object.values(collectionState[currentSet]).filter(v => 
        v && (v === true || (typeof v === 'object' && v.collected === true))
    ).length;
    
    const totalEl = document.getElementById('total-count');
    const collectedEl = document.getElementById('collected-count');
    
    if (totalEl) {
        totalEl.textContent = expectedTotal;
    }
    if (collectedEl) {
        collectedEl.textContent = collected;
    }
    
    console.log(`Stats updated: ${collected}/${expectedTotal} collected for ${currentSet.toUpperCase()} (${cards.length} cards loaded)`);
}

// Display current version
function displayVersion() {
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay && typeof APP_VERSION !== 'undefined') {
        versionDisplay.textContent = `v${APP_VERSION}`;
    }
}

// Set up update checking
function setupUpdateChecking() {
    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    
    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
            loadVersionInfo();
        });
    }
    
    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }
    
    // Close settings when clicking outside
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }
    
    // Check for updates button in settings
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', () => checkForUpdates(false));
    }
    
    // Update notification buttons
    const updateNowBtn = document.getElementById('update-now-btn');
    const updateLaterBtn = document.getElementById('update-later-btn');
    
    if (updateNowBtn) {
        updateNowBtn.addEventListener('click', performUpdate);
    }
    
    if (updateLaterBtn) {
        updateLaterBtn.addEventListener('click', () => {
            document.getElementById('update-notification').classList.add('hidden');
        });
    }
    
    // Check for updates on load (silently)
    checkForUpdates(true);
    
    // Check for updates periodically (every 30 minutes)
    setInterval(() => checkForUpdates(true), 30 * 60 * 1000);
}

// Load version information into settings
async function loadVersionInfo() {
    try {
        const response = await fetch('version.json?' + new Date().getTime());
        if (response.ok) {
            const versionInfo = await response.json();
            const releaseDateEl = document.getElementById('release-date');
            if (releaseDateEl && versionInfo.releaseDate) {
                releaseDateEl.textContent = versionInfo.releaseDate;
            }
        }
    } catch (error) {
        console.error('Error loading version info:', error);
    }
}

// Check for updates
async function checkForUpdates(silent = false) {
    try {
        const response = await fetch('version.json?' + new Date().getTime());
        if (!response.ok) {
            if (!silent) {
                alert('Unable to check for updates. Please try again later.');
            }
            return;
        }
        
        const versionInfo = await response.json();
        const currentVersion = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1.0.0';
        
        if (compareVersions(versionInfo.version, currentVersion) > 0) {
            // New version available
            showUpdateNotification(versionInfo);
            if (!silent) {
                showUpdateStatus('Update available! Version ' + versionInfo.version, 'info');
            }
        } else {
            if (!silent) {
                showUpdateStatus('You are using the latest version!', 'success');
            }
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
        if (!silent) {
            showUpdateStatus('Error checking for updates. Please check your connection.', 'error');
        }
    }
}

// Show update status in settings
function showUpdateStatus(message, type = 'info') {
    const statusEl = document.getElementById('update-status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = 'update-status ' + type;
        
        // Clear status after 5 seconds
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'update-status';
        }, 5000);
    }
}

// Compare version strings (returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal)
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;
        
        if (part1 > part2) return 1;
        if (part1 < part2) return -1;
    }
    
    return 0;
}

// Show update notification
function showUpdateNotification(versionInfo) {
    const notification = document.getElementById('update-notification');
    const message = document.getElementById('update-message');
    
    if (notification && message) {
        let messageHTML = `<strong>Version ${versionInfo.version} is available.</strong>`;
        if (versionInfo.changelog && versionInfo.changelog.length > 0) {
            messageHTML += '<br><br><strong>What\'s new:</strong><br>';
            messageHTML += versionInfo.changelog.slice(0, 5).map(item => `• ${item}`).join('<br>');
        }
        message.innerHTML = messageHTML;
        notification.classList.remove('hidden');
    }
}

// Perform update
function performUpdate() {
    // Clear caches to get fresh content
    if ('caches' in window) {
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => caches.delete(cacheName))
            );
        }).then(() => {
            // Unregister and re-register service worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    registrations.forEach(registration => {
                        registration.unregister().then(() => {
                            // Reload the page to get the latest version
                            window.location.reload(true);
                        });
                    });
                });
            } else {
                window.location.reload(true);
            }
        });
    } else {
        window.location.reload(true);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

