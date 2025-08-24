// Semantic Scholar Integration Module
class ScholarIntegration {
    constructor(semanticScholarId = '2372230806') {
        this.semanticScholarId = semanticScholarId;
        this.apiUrl = 'https://api.semanticscholar.org/graph/v1/author';
        this.cache = new Map();
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    }

    // Fetch author profile data from Semantic Scholar
    async fetchAuthorProfile() {
        const cacheKey = `profile_${this.semanticScholarId}`;
        const cached = this.getFromCache(cacheKey);
        
        if (cached) {
            console.log('Using cached Semantic Scholar data');
            return cached;
        }

        console.log('Fetching fresh data from Semantic Scholar API...');
        const profileData = await this.fetchFromSemanticScholar();
        
        this.setCache(cacheKey, profileData);
        return profileData;
    }

    // Fetch data from Semantic Scholar API
    async fetchFromSemanticScholar() {
        const fields = 'name,affiliations,homepage,paperCount,citationCount,hIndex,papers.title,papers.authors,papers.venue,papers.year,papers.citationCount,papers.url,papers.openAccessPdf,papers.paperId';
        const url = `${this.apiUrl}/${this.semanticScholarId}?fields=${fields}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Semantic Scholar API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Semantic Scholar data received:', data);
        
        return this.processData(data);
    }

    // Process Semantic Scholar data
    processData(data) {
        console.log('Processing', data.papers?.length || 0, 'papers from Semantic Scholar');
        
        // Calculate i10-index
        const i10Index = data.papers ? 
            data.papers.filter(paper => paper.citationCount >= 10).length : 0;

        // Extract research interests from paper titles
        const interests = this.extractInterests(data.papers || []);
        
        // Extract coauthors from papers
        const coauthors = this.extractCoauthors(data.papers || [], data.name);

        const processedPublications = (data.papers || []).map(paper => ({
            title: paper.title,
            authors: paper.authors?.map(author => author.name).join(', ') || 'Unknown',
            publication: paper.venue || 'Unknown Venue',
            citedBy: paper.citationCount || 0,
            year: paper.year,
            link: paper.openAccessPdf?.url || paper.url || '#',
            publicationUrl: paper.url || '#',
            semanticScholarUrl: paper.paperId ? 
                `https://www.semanticscholar.org/paper/${paper.paperId}` : '#'
        }));

        return {
            name: data.name || 'Niklas Bubeck',
            affiliation: data.affiliations?.[0]?.name || 'Technical University of Munich',
            homepage: data.homepage || '',
            interests: interests,
            citationStats: {
                totalCitations: data.citationCount || 0,
                hIndex: data.hIndex || 0,
                i10Index: i10Index,
                paperCount: data.paperCount || 0
            },
            publications: processedPublications,
            coauthors: coauthors
        };
    }

    // Extract research interests from publications
    extractInterests(papers) {
        const keywords = new Set();
        const terms = ['machine', 'learning', 'neural', 'deep', 'artificial', 'intelligence', 
                      'computer', 'vision', 'algorithm', 'optimization', 'data'];
        
        papers.forEach(paper => {
            const title = paper.title?.toLowerCase() || '';
            const venue = paper.venue?.toLowerCase() || '';
            
            terms.forEach(term => {
                if (title.includes(term) || venue.includes(term)) {
                    keywords.add(term.charAt(0).toUpperCase() + term.slice(1));
                }
            });
        });
        
        return Array.from(keywords).slice(0, 3);
    }

    // Extract top coauthors from publications
    extractCoauthors(papers, authorName) {
        const coauthorData = new Map();
        
        papers.forEach(paper => {
            if (paper.authors) {
                paper.authors.forEach(author => {
                    // Skip the main author
                    if (author.name && author.name !== authorName) {
                        const name = author.name;
                        const authorId = author.authorId;
                        
                        if (coauthorData.has(name)) {
                            coauthorData.get(name).count += 1;
                        } else {
                            coauthorData.set(name, {
                                name: name,
                                count: 1,
                                authorId: authorId
                            });
                        }
                    }
                });
            }
        });
        
        // Sort by collaboration count and get top 6
        return Array.from(coauthorData.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
    }



    // Cache management
    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }

    // Update the webpage with Semantic Scholar data
    async updateWebpage() {
        try {
            const profileData = await this.fetchAuthorProfile();
            
            this.updateProfileInfo(profileData);
            this.updateStatistics(profileData.citationStats);
            this.updatePublications(profileData.publications);
            this.updateCoauthors(profileData.coauthors);
            
            console.log('Webpage updated with Semantic Scholar data');
            
        } catch (error) {
            console.error('Failed to update webpage:', error);
        }
    }

    // Update profile information
    updateProfileInfo(profileData) {
        const navLogo = document.querySelector('.nav-logo h2');
        if (navLogo) navLogo.textContent = profileData.name;

        const heroName = document.querySelector('.name');
        if (heroName) heroName.textContent = profileData.name;

        const heroDescription = document.querySelector('.hero-description');
        if (heroDescription && profileData.affiliation) {
            heroDescription.innerHTML = `
                Researcher at ${profileData.affiliation}, advancing knowledge through 
                innovative research, collaborative projects, and academic excellence.
            `;
        }
    }

    // Update statistics with animation
    updateStatistics(citationStats) {
        const statNumbers = document.querySelectorAll('.stat-number');
        const statLabels = document.querySelectorAll('.stat-label');

        if (statNumbers.length >= 3) {
            // Update labels first
            if (statLabels.length >= 3) {
                statLabels[0].textContent = 'Total Citations';
                statLabels[1].textContent = 'h-index';
                statLabels[2].textContent = 'i10-index';
                if (statLabels[3]) statLabels[3].textContent = 'Papers';
            }
            
            // Animate to the real values
            this.animateStatistic(statNumbers[0], citationStats.totalCitations);
            this.animateStatistic(statNumbers[1], citationStats.hIndex);
            this.animateStatistic(statNumbers[2], citationStats.i10Index);
            if (statNumbers[3]) this.animateStatistic(statNumbers[3], citationStats.paperCount);
            
            console.log('Statistics updated:', citationStats);
        }
    }

    // Animate individual statistic
    animateStatistic(element, targetValue) {
        if (!element) return;
        
        const startValue = 0;
        const duration = 1000; // 1 second animation
        const startTime = Date.now();
        
        const animateValue = () => {
            const currentTime = Date.now();
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth animation
            const easeProgress = progress * (2 - progress);
            const currentValue = Math.floor(startValue + (targetValue - startValue) * easeProgress);
            
            element.textContent = currentValue;
            
            if (progress < 1) {
                requestAnimationFrame(animateValue);
            } else {
                element.textContent = targetValue; // Ensure we end with exact value
            }
        };
        
        requestAnimationFrame(animateValue);
    }

    // Update publications section
    updatePublications(publications) {
        const publicationsList = document.querySelector('.publications-list');
        if (!publicationsList) {
            console.error('Publications list element not found!');
            return;
        }

        publicationsList.innerHTML = '';
        console.log(`Displaying ${publications.length} publications from Semantic Scholar`);
        
        publications.forEach(pub => {
            const element = this.createPublicationElement(pub);
            publicationsList.appendChild(element);
        });
        
        // Force refresh to ensure elements are visible
        setTimeout(() => {
            const items = publicationsList.querySelectorAll('.publication-item');
            items.forEach(item => {
                item.classList.add('visible');
            });
            
            // Reinitialize publication filters after publications are loaded
            this.initPublicationFilters();
        }, 100);
    }

    // Initialize publication filters for dynamically loaded content
    initPublicationFilters() {
        console.log('Initializing advanced publication filters...');
        
        const filterButtons = document.querySelectorAll('.filter-btn');
        const sortDropdown = document.getElementById('sort-select');
        const searchInput = document.getElementById('search-publications');
        const clearButton = document.getElementById('clear-search');
        const resultsCount = document.getElementById('results-count');
        
        // Debug: Check if elements exist
        console.log('Found elements:');
        console.log('- Filter buttons:', filterButtons.length);
        console.log('- Sort dropdown:', sortDropdown);
        console.log('- Search input:', searchInput);
        console.log('- Clear button:', clearButton);
        console.log('- Results count:', resultsCount);
        
        // Initialize publications array for sorting/filtering
        this.allPublications = [];
        this.filteredPublications = [];
        this.currentFilter = 'all';
        this.currentSort = 'newest';
        this.currentSearch = '';
        
        // Pagination settings
        this.itemsPerPage = 3;
        this.currentPage = 1;
        this.totalPages = 1;
        
        // Store original publications data
        const publicationItems = document.querySelectorAll('.publication-item');
        publicationItems.forEach(item => {
            const yearElement = item.querySelector('.publication-year');
            const citationsElement = item.querySelector('.publication-citations');
            // Try multiple selectors for title (publications use h4 tags)
            const titleElement = item.querySelector('h4') || item.querySelector('h3') || item.querySelector('.publication-title');
            const authorsElement = item.querySelector('.publication-authors');
            const venueElement = item.querySelector('.publication-venue');
            
            // Debug: Log what we find for each publication
            console.log('Processing publication item:', item);
            console.log('  Title element found:', titleElement);
            console.log('  Title text:', titleElement ? titleElement.textContent.trim() : 'NOT FOUND');
            console.log('  Authors element:', authorsElement);
            console.log('  Venue element:', venueElement);
            
            const pubData = {
                element: item,
                title: titleElement ? titleElement.textContent.trim() : '',
                year: yearElement ? parseInt(yearElement.textContent) || 0 : 0,
                citations: citationsElement ? parseInt(citationsElement.textContent.replace(/\D/g, '')) || 0 : 0,
                category: item.getAttribute('data-category') || 'journal',
                authors: authorsElement ? authorsElement.textContent.trim() : '',
                venue: venueElement ? venueElement.textContent.trim() : ''
            };
            
            console.log('  Final pubData:', pubData);
            this.allPublications.push(pubData);
        });
        
        // Remove existing event listeners by cloning buttons
        filterButtons.forEach(button => {
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
        });
        
        // Type filter buttons
        const newFilterButtons = document.querySelectorAll('.filter-btn');
        newFilterButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                
                newFilterButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                this.currentFilter = button.getAttribute('data-filter');
                this.applyFiltersAndSort();
            });
        });
        
        // Sort dropdown
        if (sortDropdown) {
            sortDropdown.addEventListener('change', (e) => {
                this.currentSort = e.target.value;
                this.applyFiltersAndSort();
            });
        }
        
        // Search input
        if (searchInput) {
            console.log('Setting up search input listener...');
            searchInput.addEventListener('input', (e) => {
                this.currentSearch = e.target.value.toLowerCase();
                console.log('Search query:', this.currentSearch);
                this.applyFiltersAndSort();
            });
        } else {
            console.error('Search input element not found!');
        }
        
        // Clear search button
        if (clearButton) {
            clearButton.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    this.currentSearch = '';
                    this.applyFiltersAndSort();
                }
            });
        }
        
        // Pagination controls
        const prevButton = document.getElementById('prev-page');
        const nextButton = document.getElementById('next-page');
        
        if (prevButton) {
            prevButton.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.updatePublicationDisplay();
                    this.updatePaginationControls();
                }
            });
        }
        
        if (nextButton) {
            nextButton.addEventListener('click', () => {
                if (this.currentPage < this.totalPages) {
                    this.currentPage++;
                    this.updatePublicationDisplay();
                    this.updatePaginationControls();
                }
            });
        }
        
        // Initial filter and count
        this.applyFiltersAndSort();
        
        console.log('Advanced publication filters initialized successfully');
    }
    
    applyFiltersAndSort() {
        // Start with all publications
        this.filteredPublications = [...this.allPublications];
        
        // Apply type filter
        if (this.currentFilter !== 'all') {
            this.filteredPublications = this.filteredPublications.filter(pub => 
                pub.category === this.currentFilter
            );
        }
        
        // Apply search filter
        if (this.currentSearch) {
            console.log('Applying search filter for:', this.currentSearch);
            console.log('Before search filter:', this.filteredPublications.length, 'publications');
            
            this.filteredPublications = this.filteredPublications.filter(pub => {
                // Debug: Show what we're searching through
                console.log('Searching in publication:');
                console.log('  Title:', `"${pub.title}"`);
                console.log('  Authors:', `"${pub.authors}"`);
                console.log('  Venue:', `"${pub.venue}"`);
                
                const titleMatch = pub.title.toLowerCase().includes(this.currentSearch);
                const authorsMatch = pub.authors.toLowerCase().includes(this.currentSearch);
                const venueMatch = pub.venue.toLowerCase().includes(this.currentSearch);
                const matches = titleMatch || authorsMatch || venueMatch;
                
                console.log('  Matches - Title:', titleMatch, 'Authors:', authorsMatch, 'Venue:', venueMatch);
                
                if (matches) {
                    console.log('✅ Match found in:', pub.title);
                }
                
                return matches;
            });
            
            console.log('After search filter:', this.filteredPublications.length, 'publications');
        }
        
        // Apply sorting
        this.filteredPublications.sort((a, b) => {
            switch (this.currentSort) {
                case 'newest':
                    return b.year - a.year;
                case 'oldest':
                    return a.year - b.year;
                case 'citations-desc':
                    return b.citations - a.citations;
                case 'citations-asc':
                    return a.citations - b.citations;
                case 'title-asc':
                    return a.title.localeCompare(b.title);
                case 'title-desc':
                    return b.title.localeCompare(a.title);
                default:
                    return b.year - a.year;
            }
        });
        
        // Reset to first page when filters change
        this.currentPage = 1;
        this.totalPages = Math.ceil(this.filteredPublications.length / this.itemsPerPage);
        
        // Update display
        this.updatePublicationDisplay();
        this.updateResultsCount();
        this.updatePaginationControls();
    }
    
    updatePublicationDisplay() {
        const publicationsContainer = document.querySelector('.publications-list');
        if (!publicationsContainer) return;
        
        // Hide all publications first
        this.allPublications.forEach(pub => {
            pub.element.style.display = 'none';
            pub.element.classList.remove('visible');
        });
        
        // Calculate pagination
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pagePublications = this.filteredPublications.slice(startIndex, endIndex);
        
        console.log(`Displaying page ${this.currentPage}: items ${startIndex + 1}-${Math.min(endIndex, this.filteredPublications.length)} of ${this.filteredPublications.length}`);
        
        // Clear container and re-add current page publications
        publicationsContainer.innerHTML = '';
        
        pagePublications.forEach((pub, index) => {
            pub.element.style.display = 'block';
            pub.element.classList.add('visible');
            pub.element.style.opacity = '0';
            pub.element.style.transform = 'translateY(20px)';
            publicationsContainer.appendChild(pub.element);
            
            // Add staggered animation
            setTimeout(() => {
                pub.element.style.opacity = '1';
                pub.element.style.transform = 'translateY(0)';
                pub.element.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            }, index * 100);
        });
        
        // Scroll to top of publications container
        const container = document.querySelector('.publications-container');
        if (container) {
            container.scrollTop = 0;
        }
    }
    
    updateResultsCount() {
        const resultsCount = document.getElementById('results-count');
        if (resultsCount) {
            const count = this.filteredPublications.length;
            const total = this.allPublications.length;
            
            if (this.currentFilter === 'all' && !this.currentSearch) {
                resultsCount.textContent = `${count} publications`;
            } else {
                resultsCount.textContent = `${count} of ${total} publications`;
            }
        }
    }
    
    updatePaginationControls() {
        const prevButton = document.getElementById('prev-page');
        const nextButton = document.getElementById('next-page');
        const currentPageSpan = document.getElementById('current-page');
        const totalPagesSpan = document.getElementById('total-pages');
        
        // Update page numbers
        if (currentPageSpan) {
            currentPageSpan.textContent = this.currentPage;
        }
        if (totalPagesSpan) {
            totalPagesSpan.textContent = this.totalPages;
        }
        
        // Update button states
        if (prevButton) {
            prevButton.disabled = this.currentPage <= 1;
        }
        if (nextButton) {
            nextButton.disabled = this.currentPage >= this.totalPages;
        }
        
        // Hide pagination if only one page
        const paginationControls = document.querySelector('.pagination-controls');
        if (paginationControls) {
            paginationControls.style.display = this.totalPages <= 1 ? 'none' : 'flex';
        }
        
        console.log(`Pagination: Page ${this.currentPage} of ${this.totalPages}`);
    }

    // Create publication element
    createPublicationElement(publication) {
        console.log('Creating element for publication:', publication.title);
        
        const pubDiv = document.createElement('div');
        pubDiv.className = 'publication-item fade-in visible'; // Add 'visible' class immediately
        pubDiv.setAttribute('data-category', this.categorizePublication(publication.publication));
        pubDiv.style.display = 'block'; // Ensure it's visible

        pubDiv.innerHTML = `
            <div class="publication-content">
                <h4>${publication.title || 'Untitled'}</h4>
                <p class="publication-authors">${this.highlightAuthorName(publication.authors || 'Unknown authors')}</p>
                <p class="publication-venue">${publication.publication || 'Unknown venue'}${publication.year ? `, ${publication.year}` : ''}</p>
                <p class="publication-citations">
                    <i class="fas fa-quote-left"></i> 
                    Cited by ${publication.citedBy || 0} 
                    ${publication.year ? `• ${new Date().getFullYear() - publication.year} years ago` : ''}
                </p>
                <div class="publication-links">
                    ${publication.link !== '#' ? `<a href="${publication.link}" class="pub-link" target="_blank">
                        <i class="fas fa-file-pdf"></i> PDF
                    </a>` : ''}
                    ${publication.semanticScholarUrl !== '#' ? `<a href="${publication.semanticScholarUrl}" class="pub-link" target="_blank">
                        <i class="fas fa-brain"></i> Semantic Scholar
                    </a>` : ''}
                </div>
            </div>
        `;

        console.log('Created publication element:', pubDiv);
        return pubDiv;
    }

    // Highlight author name in publication
    highlightAuthorName(authors) {
        const variations = ['Niklas Bubeck', 'N. Bubeck', 'N Bubeck'];
        let highlightedAuthors = authors;
        
        variations.forEach(name => {
            const regex = new RegExp(`\\b${name}\\b`, 'gi');
            highlightedAuthors = highlightedAuthors.replace(regex, `<strong>${name}</strong>`);
        });

        return highlightedAuthors;
    }

    // Categorize publication for filtering
    categorizePublication(venue) {
        const lowerVenue = venue.toLowerCase();
        console.log(`Categorizing venue: "${venue}" -> "${lowerVenue}"`);
        
        let category;
        if (lowerVenue.includes('conference') || lowerVenue.includes('proceedings') || 
            lowerVenue.includes('workshop') || lowerVenue.includes('symposium') ||
            lowerVenue.includes('cvpr') || lowerVenue.includes('iclr') || lowerVenue.includes('neurips') ||
            lowerVenue.includes('icml') || lowerVenue.includes('iccv') || lowerVenue.includes('eccv')) {
            category = 'conference';
        } else if (lowerVenue.includes('arxiv') || lowerVenue.includes('preprint') || 
                   lowerVenue.includes('biorxiv') || lowerVenue.includes('medrxiv') ||
                   lowerVenue === 'arxiv.org') {
            category = 'preprint';
        } else {
            // Default to journal for unknown venues, journals, and published papers
            category = 'journal';
        }
        
        console.log(`"${venue}" categorized as: ${category}`);
        return category;
    }

    // Update coauthors section
    updateCoauthors(coauthors) {
        const coauthorsList = document.querySelector('.coauthors-list');
        if (!coauthorsList) {
            console.error('Coauthors list element not found!');
            return;
        }

        if (!coauthors || coauthors.length === 0) {
            coauthorsList.innerHTML = '<div class="coauthor-loading">No coauthors found</div>';
            return;
        }

        // Clear loading message and populate with coauthors
        coauthorsList.innerHTML = '';
        console.log(`Displaying top ${coauthors.length} coauthors from Semantic Scholar`);
        
        coauthors.forEach(coauthor => {
            const coauthorDiv = document.createElement('div');
            coauthorDiv.className = 'coauthor-item';
            
            if (coauthor.authorId) {
                // Create clickable link to Semantic Scholar profile
                const link = document.createElement('a');
                link.href = `https://www.semanticscholar.org/author/${coauthor.authorId}`;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = `${coauthor.name} (${coauthor.count})`;
                link.style.color = 'inherit';
                link.style.textDecoration = 'none';
                coauthorDiv.appendChild(link);
            } else {
                // Fallback for authors without ID
                coauthorDiv.textContent = `${coauthor.name} (${coauthor.count})`;
            }
            
            coauthorsList.appendChild(coauthorDiv);
        });
    }

    // Setup automatic updates
    setupAutoUpdate() {
        this.updateWebpage();
        setInterval(() => this.updateWebpage(), 60 * 60 * 1000); // Update every hour
    }
}

// Initialize Scholar integration
function initializeScholar() {
    console.log('Initializing Semantic Scholar integration...');
    
    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeScholar);
        return;
    }
    
    // Check if publications list exists
    const publicationsList = document.querySelector('.publications-list');
    if (!publicationsList) {
        console.error('Publications list element not found! Retrying in 1 second...');
        setTimeout(initializeScholar, 1000);
        return;
    }
    
    console.log('Publications list found, starting integration...');
    const scholarIntegration = new ScholarIntegration('2372230806');
    scholarIntegration.setupAutoUpdate();
    window.scholarIntegration = scholarIntegration;
}

// Start initialization
initializeScholar();

// Manual test function for debugging
window.testScholarAPI = async function() {
    console.log('=== MANUAL TEST START ===');
    try {
        if (!window.scholarIntegration) {
            console.error('Scholar integration not initialized!');
            return;
        }
        
        console.log('Testing API call...');
        const data = await window.scholarIntegration.fetchAuthorProfile();
        console.log('Data received:', data);
        
        console.log('Testing publications update...');
        window.scholarIntegration.updatePublications(data.publications);
        
        console.log('=== MANUAL TEST COMPLETE ===');
    } catch (error) {
        console.error('Manual test failed:', error);
    }
};

// Debug function to check DOM elements
window.debugDOM = function() {
    console.log('=== DOM DEBUG ===');
    const publicationsList = document.querySelector('.publications-list');
    console.log('Publications list element:', publicationsList);
    console.log('Publications list innerHTML:', publicationsList?.innerHTML);
    console.log('Publications section:', document.querySelector('#publications'));
    const items = document.querySelectorAll('.publication-item');
    console.log('All .publication-item elements:', items);
    
    // Check visibility of each publication
    items.forEach((item, index) => {
        const computedStyle = window.getComputedStyle(item);
        console.log(`Publication ${index + 1}:`, {
            element: item,
            classes: item.className,
            opacity: computedStyle.opacity,
            display: computedStyle.display,
            visibility: computedStyle.visibility
        });
    });
};

// Quick fix function
window.fixPublications = function() {
    console.log('=== FIXING PUBLICATIONS VISIBILITY ===');
    const items = document.querySelectorAll('.publication-item');
    items.forEach((item, index) => {
        item.classList.add('visible');
        item.style.opacity = '1';
        item.style.display = 'block';
        console.log(`Fixed publication ${index + 1}:`, item.querySelector('h4')?.textContent);
    });
};

// Test filtering function
window.testFiltering = function() {
    console.log('=== TESTING PUBLICATION FILTERING ===');
    const items = document.querySelectorAll('.publication-item');
    
    items.forEach((item, index) => {
        const title = item.querySelector('h3')?.textContent || item.querySelector('h4')?.textContent;
        const category = item.getAttribute('data-category');
        console.log(`Publication ${index + 1}: "${title}" -> Category: ${category}`);
    });
    
    // Test filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    console.log('Filter buttons:', filterButtons);
    
    filterButtons.forEach(btn => {
        console.log(`Filter button: ${btn.textContent} (data-filter: ${btn.getAttribute('data-filter')})`);
    });
    
    // Test search elements
    console.log('Search input:', document.getElementById('search-publications'));
    console.log('Sort dropdown:', document.getElementById('sort-select'));
    console.log('Clear button:', document.getElementById('clear-search'));
};

// Test search function
window.testSearch = function(query) {
    console.log('=== TESTING SEARCH FUNCTION ===');
    const searchInput = document.getElementById('search-publications');
    if (searchInput) {
        searchInput.value = query;
        searchInput.dispatchEvent(new Event('input'));
        console.log('Search triggered for:', query);
    } else {
        console.error('Search input not found!');
    }
};


// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScholarIntegration;
}
