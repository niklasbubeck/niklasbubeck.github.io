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
        const fields = 'name,affiliations,homepage,paperCount,citationCount,hIndex,papers.title,papers.authors,papers.venue,papers.year,papers.citationCount,papers.url,papers.openAccessPdf,papers.paperId,papers.corpusId,papers.externalIds';
        const url = `${this.apiUrl}/${this.semanticScholarId}?fields=${fields}`;
        
        console.log('Making API request to:', url);
        
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
        
        // Calculate citation statistics manually from paper data
        const citationStats = this.calculateCitationStats(data.papers || []);
        
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
            paperId: paper.paperId || null,
            corpusId: paper.corpusId || null,
            arxivId: paper.externalIds?.ArXiv || null,
            semanticScholarUrl: paper.paperId ?
                `https://www.semanticscholar.org/paper/${paper.paperId}` : '#',
            tldr: null,
            figureUrl: null
        }));

        return {
            name: data.name || 'Niklas Bubeck',
            affiliation: data.affiliations?.[0]?.name || 'Technical University of Munich',
            homepage: data.homepage || '',
            interests: interests,
            citationStats: citationStats,
            publications: processedPublications,
            coauthors: coauthors
        };
    }

    // Calculate citation statistics manually from paper data
    calculateCitationStats(papers) {
        if (!papers || papers.length === 0) {
            return {
                totalCitations: 0,
                hIndex: 0,
                i10Index: 0,
                paperCount: 0
            };
        }

        // Calculate total citations by summing individual paper citations
        const totalCitations = papers.reduce((sum, paper) => sum + (paper.citationCount || 0), 0);
        
        // Calculate h-index
        // Sort papers by citation count in descending order
        const sortedPapers = papers
            .map(paper => paper.citationCount || 0)
            .sort((a, b) => b - a);
        
        let hIndex = 0;
        for (let i = 0; i < sortedPapers.length; i++) {
            if (sortedPapers[i] >= i + 1) {
                hIndex = i + 1;
            } else {
                break;
            }
        }
        
        // Calculate i10-index (papers with at least 10 citations)
        const i10Index = papers.filter(paper => (paper.citationCount || 0) >= 10).length;
        
        console.log('Calculated citation stats:', {
            totalCitations,
            hIndex,
            i10Index,
            paperCount: papers.length,
            paperCitations: papers.map(p => p.citationCount || 0)
        });

        return {
            totalCitations,
            hIndex,
            i10Index,
            paperCount: papers.length
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

    // Extract paper ID from Semantic Scholar URL
    extractPaperIdFromUrl(url) {
        const match = url.match(/\/paper\/([^\/\?]+)/);
        return match ? match[1] : null;
    }

    // Fetch TL;DR and abstract for a specific paper
    async fetchPaperDetails(paperId) {
        const paperUrl = `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=tldr,abstract`;
        
        try {
            const response = await fetch(paperUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            return {
                tldr: data.tldr?.text || null,
                abstract: data.abstract || null
            };
        } catch (error) {
            console.log(`Failed to fetch details for paper ${paperId}:`, error.message);
            return { tldr: null, abstract: null };
        }
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



    // Animate individual statistic (fallback)
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

    // Update publications section — render as slideshow
    async updatePublications(publications) {
        const viewport = document.getElementById('publications-viewport');
        if (!viewport) {
            console.error('Publications viewport not found!');
            return;
        }

        // Sort newest first by default
        const sorted = [...publications].sort((a, b) => (b.year || 0) - (a.year || 0));

        viewport.innerHTML = '';
        sorted.forEach((pub, i) => {
            viewport.appendChild(this.createPublicationSlide(pub, i, sorted.length));
        });

        this.initPublicationsCarousel(sorted.length);

        // Lazy-load TL;DRs + figures
        this.loadSlideDetails(sorted);
    }

    // Build a single slide
    createPublicationSlide(pub, index, total) {
        const slide = document.createElement('article');
        slide.className = 'publication-slide';
        slide.setAttribute('data-index', String(index));
        slide.setAttribute('aria-roledescription', 'slide');
        slide.setAttribute('aria-label', `Publication ${index + 1} of ${total}`);

        const venueLine = pub.publication && pub.publication !== 'Unknown Venue'
            ? `${this.escapeHtml(pub.publication)}${pub.year ? ` · ${pub.year}` : ''}`
            : (pub.year ? String(pub.year) : '');

        const venueAcronym = this.venueAcronym(pub.publication);
        const links = [];
        if (pub.link && pub.link !== '#') {
            links.push(`<a href="${this.escapeAttr(pub.link)}" class="pub-slide-link pub-slide-link-primary" target="_blank" rel="noopener">
                <i class="fas fa-file-pdf" aria-hidden="true"></i> PDF
            </a>`);
        }
        if (pub.semanticScholarUrl && pub.semanticScholarUrl !== '#') {
            links.push(`<a href="${this.escapeAttr(pub.semanticScholarUrl)}" class="pub-slide-link" target="_blank" rel="noopener">
                <i class="fas fa-external-link-alt" aria-hidden="true"></i> Semantic Scholar
            </a>`);
        }

        slide.innerHTML = `
            <div class="publication-slide-figure" data-slide-figure>
                <div class="publication-slide-figure-placeholder">
                    <span class="publication-slide-venue-acronym">${this.escapeHtml(venueAcronym)}</span>
                    ${pub.year ? `<span class="publication-slide-figure-year">${pub.year}</span>` : ''}
                </div>
            </div>
            <div class="publication-slide-content">
                <p class="publication-slide-meta">${this.escapeHtml(venueLine)}</p>
                <h3 class="publication-slide-title">${this.escapeHtml(pub.title || 'Untitled')}</h3>
                <p class="publication-slide-authors">${this.highlightAuthorName(pub.authors || '')}</p>
                <p class="publication-slide-tldr" data-slide-tldr>
                    <span class="publication-slide-tldr-loading">Loading summary…</span>
                </p>
                <div class="publication-slide-footer">
                    <span class="publication-slide-citations">
                        <i class="fas fa-quote-left" aria-hidden="true"></i> ${pub.citedBy || 0} citation${(pub.citedBy || 0) === 1 ? '' : 's'}
                    </span>
                    <div class="publication-slide-links">${links.join('')}</div>
                </div>
            </div>
        `;
        return slide;
    }

    // Carousel behaviour (mirrors github-projects.js pattern)
    initPublicationsCarousel(total) {
        const carousel = document.getElementById('publications-carousel');
        if (!carousel) return;
        const viewport = carousel.querySelector('.publications-viewport');
        const prev = carousel.querySelector('.publications-carousel-prev');
        const next = carousel.querySelector('.publications-carousel-next');
        const dotsContainer = carousel.querySelector('.publications-carousel-dots');
        const counter = carousel.querySelector('.publications-carousel-counter');
        if (!viewport || !prev || !next) return;

        if (total <= 1) {
            carousel.classList.add('publications-carousel-single');
        } else {
            carousel.classList.remove('publications-carousel-single');
        }

        const slideWidth = () => viewport.clientWidth || 1;
        const currentIndex = () => Math.min(
            total - 1,
            Math.max(0, Math.round(viewport.scrollLeft / slideWidth()))
        );
        const goTo = (i) => {
            const clamped = Math.max(0, Math.min(total - 1, i));
            viewport.scrollTo({ left: clamped * slideWidth(), behavior: 'smooth' });
        };
        const updateUI = () => {
            const i = currentIndex();
            prev.disabled = i <= 0;
            next.disabled = i >= total - 1;
            if (counter) counter.textContent = `${i + 1} / ${total}`;
            dotsContainer.querySelectorAll('.publications-carousel-dot').forEach((btn, idx) => {
                const active = idx === i;
                btn.classList.toggle('publications-carousel-dot-active', active);
                btn.setAttribute('aria-current', active ? 'true' : 'false');
            });
        };

        dotsContainer.innerHTML = total
            ? Array.from({ length: total }, (_, i) =>
                `<button type="button" class="publications-carousel-dot" aria-label="Go to publication ${i + 1}" aria-current="${i === 0 ? 'true' : 'false'}"></button>`
            ).join('')
            : '';
        dotsContainer.querySelectorAll('.publications-carousel-dot').forEach((btn, i) => {
            btn.addEventListener('click', () => goTo(i));
        });

        // Replace listeners on prev/next so we don't stack them on re-render
        const newPrev = prev.cloneNode(true);
        const newNext = next.cloneNode(true);
        prev.parentNode.replaceChild(newPrev, prev);
        next.parentNode.replaceChild(newNext, next);
        newPrev.addEventListener('click', () => goTo(currentIndex() - 1));
        newNext.addEventListener('click', () => goTo(currentIndex() + 1));

        let scrollEndTimer;
        viewport.addEventListener('scroll', () => {
            clearTimeout(scrollEndTimer);
            scrollEndTimer = setTimeout(updateUI, 80);
        });
        if ('onscrollend' in window) {
            viewport.addEventListener('scrollend', updateUI);
        }

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const i = currentIndex();
                viewport.scrollTo({ left: i * slideWidth(), behavior: 'auto' });
                updateUI();
            }, 100);
        });

        carousel.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goTo(currentIndex() - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                goTo(currentIndex() + 1);
            }
        });

        updateUI();
    }

    // Fetch TL;DR + figure for each slide. Two independent queues so that
    // a slow PDF render doesn't block the next S2 call (and vice versa).
    //   - S2 queue: serialized with >=1.1s spacing (unauth rate limit is ~1/s)
    //   - PDF queue: serialized so we don't slam the free CORS proxies
    async loadSlideDetails(publications) {
        const slides = document.querySelectorAll('.publication-slide');

        const s2Queue = (async () => {
            for (let i = 0; i < publications.length; i++) {
                const pub = publications[i];
                const slide = slides[i];
                if (!slide || !pub.paperId) continue;
                if (i > 0) await this._sleep(1100);
                await this._loadSlideTldr(pub, slide).catch(() => {});
            }
        })();

        const pdfQueue = (async () => {
            for (let i = 0; i < publications.length; i++) {
                const pub = publications[i];
                const slide = slides[i];
                if (!slide) continue;
                await this.renderPdfThumbnail(pub, slide).catch(() => {});
            }
        })();

        await Promise.all([s2Queue, pdfQueue]);
    }

    async _loadSlideTldr(pub, slide) {
        const tldrEl = slide.querySelector('[data-slide-tldr]');
        if (!tldrEl) return;
        try {
            const details = await this.fetchPaperDetails(pub.paperId);
            if (details.tldr) {
                tldrEl.textContent = details.tldr;
            } else if (details.abstract) {
                const trimmed = details.abstract.length > 360
                    ? details.abstract.slice(0, 357).trimEnd() + '…'
                    : details.abstract;
                tldrEl.textContent = trimmed;
            } else {
                tldrEl.textContent = '';
                tldrEl.classList.add('publication-slide-tldr-empty');
            }
        } catch (e) {
            tldrEl.textContent = '';
        }
    }

    _sleep(ms) {
        return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
    }

    // Resolve the best PDF URL for a publication.
    pdfUrlFor(pub) {
        if (pub.link && pub.link !== '#' && /\.pdf($|\?)|\/pdf\//i.test(pub.link)) {
            return pub.link;
        }
        // arXiv: convert abs URL or arxiv id to direct PDF
        if (pub.arxivId) {
            return `https://arxiv.org/pdf/${pub.arxivId}.pdf`;
        }
        if (pub.link && /arxiv\.org\/abs\//i.test(pub.link)) {
            return pub.link.replace('/abs/', '/pdf/') + (pub.link.endsWith('.pdf') ? '' : '.pdf');
        }
        return null;
    }

    // Show the first page of the PDF using a native browser iframe.
    // Browsers fetch PDF iframes themselves (not JS) so no CORS is involved.
    // URL fragment hints (#view=FitH&toolbar=0) ask the built-in viewer to
    // show page 1 fitted to width with no toolbar.
    async renderPdfThumbnail(pub, slide) {
        const pdfUrl = this.pdfUrlFor(pub);
        if (!pdfUrl) return;
        const figEl = slide.querySelector('[data-slide-figure]');
        if (!figEl) return;

        const iframe = document.createElement('iframe');
        iframe.src = `${pdfUrl}#view=FitH&toolbar=0&navpanes=0&scrollbar=0&page=1`;
        iframe.className = 'publication-slide-figure-pdf';
        iframe.loading = 'lazy';
        iframe.title = pub.title || 'Paper preview';
        iframe.setAttribute('aria-hidden', 'true');

        // Replace placeholder once iframe says it's loaded. If it never
        // fires (rare — e.g. blocked download), we leave the placeholder.
        const wrap = document.createElement('div');
        wrap.className = 'publication-slide-figure-pdf-wrap';
        wrap.appendChild(iframe);
        figEl.appendChild(wrap);
    }

    venueAcronym(venue) {
        if (!venue || venue === 'Unknown Venue') return 'Paper';
        const trimmed = venue.trim();
        if (trimmed.length <= 8) return trimmed.toUpperCase();
        const acronym = trimmed.split(/\s+/).map(w => w[0]).join('').toUpperCase();
        return acronym.length >= 2 ? acronym.slice(0, 6) : trimmed.slice(0, 6).toUpperCase();
    }

    escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    escapeAttr(s) { return this.escapeHtml(s); }

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
    
    // Check if publications viewport exists
    const publicationsViewport = document.querySelector('.publications-viewport');
    if (!publicationsViewport) {
        console.error('Publications viewport not found! Retrying in 1 second...');
        setTimeout(initializeScholar, 1000);
        return;
    }

    console.log('Publications viewport found, starting integration...');
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScholarIntegration;
}
