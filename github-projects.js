/**
 * Loads public repositories with GitHub Pages enabled via the GitHub REST API
 * and shows them in a horizontal sliding carousel (one project per slide).
 */
(function () {
    const GITHUB_USER = 'niklasbubeck';
    const EXCLUDE_REPOS = new Set(['niklasbubeck.github.io']);
    const CACHE_KEY = 'github_pages_projects_v4';
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
                stars: r.stargazers_count || 0,
                forks: r.forks_count || 0,
                watchers: r.watchers_count || 0,
                openIssues: r.open_issues_count || 0,
                license: r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION'
                    ? r.license.spdx_id
                    : null,
            }))
            .sort((a, b) => {
                const sd = (b.stars || 0) - (a.stars || 0);
                if (sd !== 0) return sd;
                return new Date(b.pushedAt) - new Date(a.pushedAt);
            });
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function repoAcronym(name) {
        if (!name) return 'Repo';
        // First letters of segments (split on -/_), uppercase, max 6 chars
        const parts = name.split(/[-_]/).filter(Boolean);
        if (parts.length === 1) {
            return parts[0].slice(0, 6).toUpperCase();
        }
        const acronym = parts.map((p) => p[0]).join('').toUpperCase();
        return acronym.length >= 2 ? acronym.slice(0, 6) : parts[0].slice(0, 6).toUpperCase();
    }

    function formatCount(n) {
        if (!Number.isFinite(n)) return '0';
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
        return String(n);
    }

    function renderStats(p) {
        const stats = [
            { icon: 'fas fa-star', label: 'Stars', value: p.stars },
            { icon: 'fas fa-code-branch', label: 'Forks', value: p.forks },
            { icon: 'fas fa-eye', label: 'Watchers', value: p.watchers },
            { icon: 'fas fa-circle-exclamation', label: 'Open issues', value: p.openIssues },
        ];
        const items = stats
            .map(
                (s) => `
                <span class="github-project-slide-stat" title="${escapeHtml(s.label)}" aria-label="${escapeHtml(s.label)}: ${escapeHtml(String(s.value))}">
                    <i class="${s.icon}" aria-hidden="true"></i>
                    <span class="github-project-slide-stat-value">${escapeHtml(formatCount(s.value))}</span>
                </span>`
            )
            .join('');
        return `<div class="github-project-slide-stats" role="list">${items}</div>`;
    }

    function renderTopics(p) {
        if (!p.topics || p.topics.length === 0) return '';
        const chips = p.topics
            .map(
                (t) =>
                    `<span class="github-project-slide-topic">${escapeHtml(t)}</span>`
            )
            .join('');
        return `<div class="github-project-slide-topics" aria-label="Topics">${chips}</div>`;
    }

    function renderSlide(p, index, total) {
        const pushedDate = p.pushedAt ? new Date(p.pushedAt) : null;
        const pushedFmt = pushedDate
            ? pushedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
            : '';
        const metaParts = [];
        if (pushedFmt) metaParts.push(`Updated ${pushedFmt}`);
        if (p.language) metaParts.push(p.language);
        if (p.license) metaParts.push(p.license);
        const meta = metaParts.join(' · ');

        const label = `Project ${index + 1} of ${total}: ${p.title}`;

        return `
<article class="github-project-slide" role="group" aria-roledescription="slide" aria-label="${escapeHtml(label)}">
    <div class="github-project-slide-figure">
        <div class="github-project-slide-figure-placeholder">
            <span class="github-project-slide-name-acronym">${escapeHtml(repoAcronym(p.name))}</span>
            ${pushedDate ? `<span class="github-project-slide-figure-year">${pushedDate.getFullYear()}</span>` : ''}
        </div>
        <div class="github-project-slide-iframe-wrap">
            <iframe class="github-project-slide-iframe" src="${escapeHtml(p.siteUrl)}" loading="lazy" title="${escapeHtml(p.title)} preview" aria-hidden="true"></iframe>
        </div>
    </div>
    <div class="github-project-slide-content">
        ${meta ? `<p class="github-project-slide-meta">${escapeHtml(meta)}</p>` : ''}
        <h3 class="github-project-slide-title">${escapeHtml(p.title)}</h3>
        <p class="github-project-slide-description">${escapeHtml(p.description)}</p>
        ${renderStats(p)}
        ${renderTopics(p)}
        <div class="github-project-slide-footer">
            <span class="github-project-slide-repo-name">
                <i class="fab fa-github" aria-hidden="true"></i> ${escapeHtml(p.name)}
            </span>
            <div class="github-project-slide-links">
                <a href="${escapeHtml(p.siteUrl)}" class="pub-slide-link pub-slide-link-primary" target="_blank" rel="noopener noreferrer">
                    <i class="fas fa-external-link-alt" aria-hidden="true"></i> View site
                </a>
                <a href="${escapeHtml(p.repoUrl)}" class="pub-slide-link" target="_blank" rel="noopener noreferrer">
                    <i class="fab fa-github" aria-hidden="true"></i> Repository
                </a>
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
