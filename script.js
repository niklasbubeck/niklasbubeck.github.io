// Dark Mode functionality
function initDarkMode() {
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const body = document.body;
    const icon = darkModeToggle.querySelector('i');
    
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        body.classList.add('dark-mode');
        icon.className = 'fas fa-sun';
    } else {
        body.classList.remove('dark-mode');
        icon.className = 'fas fa-moon';
    }
    
    // Toggle dark mode
    darkModeToggle.addEventListener('click', function() {
        body.classList.toggle('dark-mode');
        
        if (body.classList.contains('dark-mode')) {
            icon.className = 'fas fa-sun';
            localStorage.setItem('theme', 'dark');
        } else {
            icon.className = 'fas fa-moon';
            localStorage.setItem('theme', 'light');
        }
    });
}

// DOM Content Loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize all functionality
    initDarkMode();
    initNavigation();
    initScrollEffects();
    initAnimations();
    initContactForm();
    initPublicationFilters();
    // initStatsCounter(); // Removed - handled by Semantic Scholar integration
    initBackToTop();
    initTimeline();
    updateLastModified();
});

// Navigation functionality
function initNavigation() {
    const navbar = document.getElementById('navbar');
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    // Mobile menu toggle
    hamburger.addEventListener('click', function() {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });

    // Close mobile menu when clicking on a link
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });

    // Navbar scroll effect
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Active navigation highlighting
    window.addEventListener('scroll', updateActiveNavigation);
    
    // Smooth scrolling for navigation links
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetSection = document.getElementById(targetId);
            
            if (targetSection) {
                const offsetTop = targetSection.offsetTop - 70; // Account for navbar height
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Update active navigation item based on scroll position
function updateActiveNavigation() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let currentSection = '';
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop - 100;
        const sectionHeight = section.clientHeight;
        
        if (window.scrollY >= sectionTop && window.scrollY < sectionTop + sectionHeight) {
            currentSection = section.getAttribute('id');
        }
    });
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSection}`) {
            link.classList.add('active');
        }
    });
}

// Scroll effects and animations
function initScrollEffects() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    // Observe all elements that should animate on scroll
    const animatedElements = document.querySelectorAll('.research-card, .project-card, .publication-item, .highlight-item, .stat-item');
    animatedElements.forEach(el => {
        el.classList.add('fade-in');
        observer.observe(el);
    });
}

// Initialize animations
function initAnimations() {
    // Typing animation disabled - name is updated dynamically by Semantic Scholar integration

    // Parallax effect for hero section
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero');
        if (hero) {
            const rate = scrolled * -0.5;
            hero.style.transform = `translateY(${rate}px)`;
        }
    });

    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    // Observe all fade-in elements
    const fadeInElements = document.querySelectorAll('.fade-in');
    fadeInElements.forEach(element => {
        observer.observe(element);
    });

    console.log(`Observing ${fadeInElements.length} fade-in elements for animations`);
}

// Contact form functionality
function initContactForm() {
    const contactForm = document.getElementById('contact-form');
    
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(contactForm);
            const name = formData.get('name');
            const email = formData.get('email');
            const subject = formData.get('subject');
            const message = formData.get('message');
            
            // Basic validation
            if (!name || !email || !subject || !message) {
                showNotification('Please fill in all fields.', 'error');
                return;
            }
            
            if (!isValidEmail(email)) {
                showNotification('Please enter a valid email address.', 'error');
                return;
            }
            
            // Create mailto link with form data
            const recipientEmail = 'niklas.bubeck@gmail.com';
            const mailtoLink = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
                `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
            )}`;
            
            // Open email client
            window.location.href = mailtoLink;
            
            // Show success notification
            showNotification('Opening your email client to send the message...', 'success');
            contactForm.reset();
        });
    }
}

// Email validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Show notification
function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    // Add to body
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Publication filters
function initPublicationFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const publicationItems = document.querySelectorAll('.publication-item');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.getAttribute('data-filter');
            
            // Update active button
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Filter publications
            publicationItems.forEach(item => {
                const category = item.getAttribute('data-category');
                
                if (filter === 'all' || category === filter) {
                    item.style.display = 'block';
                    item.style.animation = 'fadeIn 0.5s ease forwards';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    });
}

// Stats counter animation
function initStatsCounter() {
    const statNumbers = document.querySelectorAll('.stat-number');
    let hasAnimated = false;
    
    const animateStats = function() {
        if (hasAnimated) return;
        
        statNumbers.forEach(stat => {
            const target = parseInt(stat.getAttribute('data-count'));
            const increment = target / 100;
            let current = 0;
            
            const updateCount = function() {
                if (current < target) {
                    current += increment;
                    stat.textContent = Math.floor(current);
                    requestAnimationFrame(updateCount);
                } else {
                    stat.textContent = target;
                }
            };
            
            updateCount();
        });
        
        hasAnimated = true;
    };
    
    // Trigger animation when stats section is visible
    const statsSection = document.querySelector('.about-stats');
    if (statsSection) {
        const observer = new IntersectionObserver(function(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateStats();
                }
            });
        }, { threshold: 0.5 });
        
        observer.observe(statsSection);
    }
}

// Back to top button
function initBackToTop() {
    const backToTopButton = document.getElementById('back-to-top');
    
    if (backToTopButton) {
        window.addEventListener('scroll', function() {
            if (window.scrollY > 300) {
                backToTopButton.classList.add('visible');
            } else {
                backToTopButton.classList.remove('visible');
            }
        });
        
        backToTopButton.addEventListener('click', function() {
            // Add launching class to trigger rocket animation
            backToTopButton.classList.add('launching');
            
            // Start scrolling to top
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            
            // Remove launching class after animation completes
            setTimeout(() => {
                backToTopButton.classList.remove('launching');
            }, 2000); // Match the 2s animation duration
        });
    }
}

// Update last modified date
function updateLastModified() {
    const lastUpdatedElement = document.getElementById('last-updated');
    if (lastUpdatedElement) {
        const today = new Date();
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        lastUpdatedElement.textContent = today.toLocaleDateString('en-US', options);
    }
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Add smooth reveal animation for sections
function addRevealAnimation() {
    const revealElements = document.querySelectorAll('section');
    
    const revealObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });
    
    revealElements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(50px)';
        element.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
        revealObserver.observe(element);
    });
}

// Initialize reveal animation after DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(addRevealAnimation, 500);
});

// Enhanced smooth scrolling for older browsers
function smoothScrollTo(element, duration = 1000) {
    const targetPosition = element.offsetTop - 70;
    const startPosition = window.pageYOffset;
    const distance = targetPosition - startPosition;
    let startTime = null;
    
    function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const run = ease(timeElapsed, startPosition, distance, duration);
        window.scrollTo(0, run);
        if (timeElapsed < duration) requestAnimationFrame(animation);
    }
    
    function ease(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }
    
    requestAnimationFrame(animation);
}



// Research card tilt effect
document.addEventListener('DOMContentLoaded', function() {
    const researchCards = document.querySelectorAll('.research-card');
    
    researchCards.forEach(card => {
        card.addEventListener('mousemove', function(e) {
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = (y - centerY) / 10;
            const rotateY = (centerX - x) / 10;
            
            this.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateZ(0)';
        });
    });
});

// Add loading animation
window.addEventListener('load', function() {
    document.body.classList.add('loaded');
});

// Performance optimization: Lazy load images
document.addEventListener('DOMContentLoaded', function() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver(function(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.classList.remove('lazy');
                    imageObserver.unobserve(img);
                }
            });
        });
        
        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => imageObserver.observe(img));
    }
});

// Timeline functionality
function initTimeline() {
    let currentStep = 0;
    const totalSteps = 4;
    
    const navButtons = document.querySelectorAll('.timeline-nav-btn');
    const contentItems = document.querySelectorAll('.timeline-content-item');
    
    // Initialize timeline
    updateTimeline();
    
    // Navigation button clicks
    navButtons.forEach((btn, index) => {
        btn.addEventListener('click', () => {
            currentStep = index;
            updateTimeline();
        });
    });
    
    // Update timeline display
    function updateTimeline() {
        // Update navigation buttons
        navButtons.forEach((btn, index) => {
            btn.classList.toggle('active', index === currentStep);
        });
        
        // Update content items
        contentItems.forEach((item, index) => {
            item.classList.toggle('active', index === currentStep);
        });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' && currentStep > 0) {
            currentStep--;
            updateTimeline();
        } else if (e.key === 'ArrowRight' && currentStep < totalSteps - 1) {
            currentStep++;
            updateTimeline();
        }
    });
    
    console.log('Timeline initialized with', totalSteps, 'steps');
}


