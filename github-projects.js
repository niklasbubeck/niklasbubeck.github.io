/**
 * Loads public repositories with GitHub Pages enabled via the GitHub REST API
 * and shows them in a horizontal sliding carousel (one project per slide).
 */
(function () {
    const GITHUB_USER = 'niklasbubeck';
    const EXCLUDE_REPOS = new Set(['niklasbubeck.github.io']);
    const CACHE_KEY = 'github_pages_projects_v1';
    const CACHE_MS = 60 * 60 * 1000;

    function getCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const { t, data } = JSON.parse(raw);
            if (Date.now() - t > CACHE_MS) return null;
            return data;
        } catch {
            return null;
        }
    }

    function setCache(data) {
        try {
            sessionStorage.setItem(
                CACHE_KEY,
                JSON.stringify({ t: Date.now(), data })
            );
        } catch {
            /* ignore quota */
        }
    }

    async function fetchAllRepos() {
        const repos = [];
        let page = 1;
        while (true) {
            const url = `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated&page=${page}`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`GitHub API error: ${res.status}`);
            }
            const batch = await res.json();
            if (!Array.isArray(batch) || batch.length === 0) break;
            repos.push(...batch);
            if (batch.length < 100) break;
            page += 1;
        }
        return repos;
    }

    function resolveSiteUrl(repo) {
        const h = (repo.homepage || '').trim();
        if (h && /^https?:\/\//i.test(h)) return h;
        return `https://${GITHUB_USER}.github.io/${repo.name}/`;
    }

    function prettifyRepoName(name) {
        return name
            .split(/[-_]/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }

    function buildProjects(repos) {
        return repos
            .filter((r) => r.fork === false)
            .filter((r) => r.has_pages === true)
            .filter((r) => !EXCLUDE_REPOS.has(r.name))
            .map((r) => ({
                name: r.name,
                title: prettifyRepoName(r.name),
                description:
                    r.description ||
                    'Project site published with GitHub Pages.',
                siteUrl: resolveSiteUrl(r),
                repoUrl: r.html_url,
                language: r.language,
                topics: Array.isArray(r.topics) ? r.topics.slice(0, 5) : [],
                pushedAt: r.pushed_at,
            }))
            .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt));
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function renderSlide(p, index, total) {
        const pushed = p.pushedAt
            ? new Date(p.pushedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
              })
            : '';

        const topicsHtml =
            p.topics.length > 0
                ? `<ul class="research-tags github-project-tags">${p.topics
                      .map((t) => `<li>${escapeHtml(t)}</li>`)
                      .join('')}</ul>`
                : '';

        const langHtml = p.language
            ? `<span class="github-project-lang">${escapeHtml(
                  p.language
              )}</span>`
            : '';

        const label = `Project ${index + 1} of ${total}: ${p.title}`;

        return `
<article class="github-project-slide" role="group" aria-roledescription="slide" aria-label="${escapeHtml(label)}">
    <div class="github-project-slide-inner">
        <div class="research-card github-project-card">
            <div class="research-icon github-project-icon">
                <i class="fab fa-github-alt" aria-hidden="true"></i>
            </div>
            <h3>${escapeHtml(p.title)}</h3>
            <p>${escapeHtml(p.description)}</p>
            <div class="github-project-meta">
                ${langHtml}
                ${pushed ? `<span class="github-project-pushed">Updated ${escapeHtml(pushed)}</span>` : ''}
            </div>
            ${topicsHtml}
            <div class="github-project-actions">
                <a href="${escapeHtml(p.siteUrl)}" class="btn btn-primary github-project-btn" target="_blank" rel="noopener noreferrer">View site</a>
                <a href="${escapeHtml(p.repoUrl)}" class="btn btn-secondary github-project-btn" target="_blank" rel="noopener noreferrer">Repository</a>
            </div>
        </div>
    </div>
</article>`;
    }

    function buildCarouselHtml(projects) {
        const total = projects.length;
        const slides = projects
            .map((p, i) => renderSlide(p, i, total))
            .join('');
        return `
<div class="github-projects-carousel" id="github-projects-carousel" role="region" aria-roledescription="carousel" aria-label="GitHub project sites" tabindex="0">
    <div class="github-carousel-row">
        <button type="button" class="github-carousel-btn github-carousel-prev" aria-label="Previous project">
            <i class="fas fa-chevron-left" aria-hidden="true"></i>
        </button>
        <div class="github-projects-viewport">
            ${slides}
        </div>
        <button type="button" class="github-carousel-btn github-carousel-next" aria-label="Next project">
            <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
    </div>
    <div class="github-carousel-footer">
        <div class="github-carousel-dots" id="github-carousel-dots"></div>
        <p class="github-carousel-counter" id="github-carousel-counter" aria-live="polite"></p>
    </div>
</div>`;
    }

    function initCarousel(carousel) {
        const viewport = carousel.querySelector('.github-projects-viewport');
        const prev = carousel.querySelector('.github-carousel-prev');
        const next = carousel.querySelector('.github-carousel-next');
        const dotsContainer = carousel.querySelector('.github-carousel-dots');
        const counter = carousel.querySelector('.github-carousel-counter');
        const slides = viewport.querySelectorAll('.github-project-slide');
        const n = slides.length;

        if (n <= 1) {
            carousel.classList.add('github-carousel-single');
        }

        function slideWidth() {
            return viewport.clientWidth || 1;
        }

        function currentIndex() {
            const w = slideWidth();
            return Math.min(
                n - 1,
                Math.max(0, Math.round(viewport.scrollLeft / w))
            );
        }

        function goTo(i) {
            const clamped = Math.max(0, Math.min(n - 1, i));
            viewport.scrollTo({
                left: clamped * slideWidth(),
                behavior: 'smooth',
            });
        }

        function updateUI() {
            const i = currentIndex();
            prev.disabled = i <= 0;
            next.disabled = i >= n - 1;
            counter.textContent = `${i + 1} / ${n}`;
            dotsContainer.querySelectorAll('.github-carousel-dot').forEach((btn, idx) => {
                const active = idx === i;
                btn.classList.toggle('github-carousel-dot-active', active);
                btn.setAttribute('aria-current', active ? 'true' : 'false');
            });
        }

        dotsContainer.innerHTML = slides
            .length
            ? Array.from(slides, (_, i) => {
                  return `<button type="button" class="github-carousel-dot" aria-label="Go to project ${i + 1}" aria-current="${i === 0 ? 'true' : 'false'}"></button>`;
              }).join('')
            : '';

        dotsContainer.querySelectorAll('.github-carousel-dot').forEach((btn, i) => {
            btn.addEventListener('click', () => goTo(i));
        });

        prev.addEventListener('click', () => goTo(currentIndex() - 1));
        next.addEventListener('click', () => goTo(currentIndex() + 1));

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
                viewport.scrollTo({
                    left: i * slideWidth(),
                    behavior: 'auto',
                });
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

    function render(root, projects, errorMessage) {
        if (errorMessage) {
            root.innerHTML = `<p class="github-projects-message github-projects-error" role="alert">${escapeHtml(errorMessage)}</p>`;
            return;
        }
        if (projects.length === 0) {
            root.innerHTML =
                '<p class="github-projects-message">No GitHub Pages project sites found yet.</p>';
            return;
        }
        root.innerHTML = buildCarouselHtml(projects);
        const carousel = root.querySelector('.github-projects-carousel');
        if (carousel) initCarousel(carousel);
    }

    async function init() {
        const root = document.getElementById('github-projects-root');
        if (!root) return;

        const cached = getCache();
        if (cached) {
            render(root, cached, null);
            return;
        }

        try {
            const repos = await fetchAllRepos();
            const projects = buildProjects(repos);
            setCache(projects);
            render(root, projects, null);
        } catch (err) {
            console.error('GitHub projects:', err);
            render(
                root,
                [],
                'Could not load projects from GitHub. Please try again later.'
            );
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
