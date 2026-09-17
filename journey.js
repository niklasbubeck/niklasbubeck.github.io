/* ============================================================
   Planet Journey — core: track, input, progress and events.
   Public API on window.journey; events on document:
   journey:ready, journey:progress, journey:arrive, journey:modechange
   (--journey-p / --journey-v live on the injected .journey-sky)
   ============================================================ */
(function () {
    'use strict';

    var root = document.documentElement;
    var NAV_H = 70;
    var SETTLE_MS = 180;
    var JOURNEY_MQ = '(min-width: 821px) and (min-height: 560px)';
    var REDUCED_MQ = '(prefers-reduced-motion: reduce)';
    /* threshold 40: a Firefox pixel-mode notch is ~48-57px; trackpad tails stay below it */
    var WHEEL = { tail: 4, threshold: 40, lock: 850, arm: 350, decay: 200 };
    var FIELDS = 'input, textarea, select, [contenteditable]';
    var CAROUSELS = '.publications-viewport, .github-projects-viewport'; /* native horizontal scrollers */
    var CUE_H = '<span>Scroll, swipe or press → to launch</span><i class="fas fa-chevron-right"></i>';

    var journey = window.journey = {
        active: false,
        mode: null,
        index: 0,
        count: 0,
        stops: [],
        goTo: goTo,
        goToId: goToId,
        progress: progress,
        velocity: velocity
    };

    var track = document.getElementById('journey-track');
    if (!track || !root.classList.contains('journey')) { return; }

    var mode = root.classList.contains('journey-h') ? 'h' : 'v';
    var stops = [];
    var panels = track.querySelectorAll('.panel[data-planet]');
    for (var i = 0; i < panels.length; i++) {
        var card = null;
        for (var c = panels[i].firstElementChild; c; c = c.nextElementSibling) {
            if (c.classList.contains('panel-card')) { card = c; break; }
        }
        stops.push({ id: panels[i].id, planet: panels[i].getAttribute('data-planet'),
                     stop: panels[i].getAttribute('data-stop'), el: panels[i], card: card });
    }
    if (!stops.length) { return; }

    var navbar = document.getElementById('navbar');
    var backToTop = document.getElementById('back-to-top');
    var sky = null; /* injected backdrop; carries the per-frame --journey-p/--journey-v */
    var cue = document.querySelector('.hero .scroll-indicator');
    var cueHtml = cue ? cue.innerHTML : '';
    var mqJourney = window.matchMedia(JOURNEY_MQ);
    var mqReduced = window.matchMedia(REDUCED_MQ);

    var arrivedIndex = -1;
    var initialIndex = indexOf(location.hash.slice(1)); /* stop named by the URL at load */
    var settleTimer = 0;
    var travelling = false; /* the track is moving: cards drop their blur */
    var resizeTimer = 0;
    var rafId = 0;
    var lastPos = -1;
    var vel = 0;
    var lockUntil = 0;
    var edgeArmedUntil = 0;
    var acc = 0;
    var lastWheelAt = 0;

    /* ---- helpers ---- */
    function emit(name, detail) {
        document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    }

    function clamp(i) {
        return Math.max(0, Math.min(stops.length - 1, i | 0));
    }

    function indexOf(id) {
        for (var k = 0; k < stops.length; k++) { if (stops[k].id === id) { return k; } }
        return -1;
    }

    function closest(node, sel) {
        return node && node.closest ? node.closest(sel) : null;
    }

    function docHeight() {
        return Math.max(root.scrollHeight, document.body.scrollHeight);
    }

    function posOf() {
        return mode === 'h' ? track.scrollLeft : window.pageYOffset;
    }

    function maxPos() {
        return mode === 'h' ? track.scrollWidth - track.clientWidth : docHeight() - window.innerHeight;
    }

    function progress() {
        var m = maxPos();
        return m > 0 ? Math.max(0, Math.min(1, posOf() / m)) : 0;
    }

    function velocity() {
        return vel;
    }

    function canScroll(card, dir) {
        if (!card || mode !== 'h') { return false; }
        return dir < 0 ? card.scrollTop > 0 : card.scrollTop + card.clientHeight < card.scrollHeight - 1;
    }

    function indexFromPos() {
        if (mode === 'h') {
            return clamp(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
        }
        var y = window.pageYOffset;
        if (y + window.innerHeight >= docHeight() - 2) { return stops.length - 1; }
        /* the stop owning the line a quarter of the way down the viewport (below the navbar) */
        var probe = y + NAV_H + (window.innerHeight - NAV_H) * 0.25;
        var idx = 0;
        for (var k = 0; k < stops.length; k++) {
            if (stops[k].el.offsetTop <= probe) { idx = k; }
        }
        return idx;
    }

    /* ---- DOM injected only when the journey is active ---- */
    function injectSky() {
        sky = document.createElement('div');
        sky.className = 'journey-sky';
        sky.setAttribute('aria-hidden', 'true');
        sky.innerHTML = '<div class="journey-sky-base"></div><div class="journey-sky-far"></div><div class="journey-sky-near"></div>';
        document.body.insertBefore(sky, document.body.firstChild);
    }

    function injectMore() {
        for (var k = 0; k < stops.length; k++) {
            if (!stops[k].card) { continue; }
            var more = document.createElement('div');
            more.className = 'panel-more';
            more.setAttribute('aria-hidden', 'true');
            more.innerHTML = '<i class="fas fa-chevron-down"></i>';
            stops[k].card.appendChild(more);
        }
    }

    function applyCue() {
        if (cue) { cue.innerHTML = mode === 'h' ? CUE_H : cueHtml; }
    }

    /* ---- state ---- */
    function setIndex(i) {
        journey.index = i;
        if (mode === 'h') {
            if (navbar) { navbar.classList.toggle('scrolled', i > 0); }
            if (backToTop) { backToTop.classList.toggle('visible', i >= 1); }
        }
    }

    function updateNav(id) {
        var links = document.querySelectorAll('.nav-link');
        for (var k = 0; k < links.length; k++) {
            var on = links[k].getAttribute('href') === '#' + id;
            links[k].classList.toggle('active', on);
            if (on) { links[k].setAttribute('aria-current', 'location'); }
            else { links[k].removeAttribute('aria-current'); }
        }
    }

    /* A card that scrolls is also a Tab stop (a scrollable region needs keyboard access) */
    function updateHasMoreFor(card) {
        var scrolls = mode === 'h' && card.scrollHeight > card.clientHeight + 1;
        card.classList.toggle('has-more', scrolls && card.scrollHeight - card.clientHeight - card.scrollTop > 8);
        if (scrolls && card.getAttribute('tabindex') !== '0') {
            var h2 = card.querySelector('h2');
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'region');
            if (h2) { card.setAttribute('aria-label', h2.textContent.trim()); }
        } else if (!scrolls && card.getAttribute('tabindex') === '0') {
            card.removeAttribute('tabindex');
            card.removeAttribute('role');
            card.removeAttribute('aria-label');
        }
    }

    function updateHasMore() {
        for (var k = 0; k < stops.length; k++) {
            if (stops[k].card) { updateHasMoreFor(stops[k].card); }
        }
    }

    /* Any card movement (wheel, keys, native scroll over a form field) starts the
       edge guard, so the next wheel notch cannot fly off the moment the card stops */
    function onCardScroll(e) {
        edgeArmedUntil = Date.now() + WHEEL.arm;
        acc = 0;
        updateHasMoreFor(e.currentTarget);
    }

    /* 'auto' must be an instant jump; html { scroll-behavior: smooth } would
       smooth it for the window, so that one is overridden for the call */
    function jumpWindow(top) {
        var prev = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo({ top: top, behavior: 'auto' });
        root.style.scrollBehavior = prev;
    }

    function goTo(i, opts) {
        if (!journey.active) { return; }
        i = clamp(i);
        var instant = !!(opts && opts.behavior === 'auto');
        /* a stop opens at its top (its card is still off screen here) — unless focus
           is already inside it, i.e. Tab brought a deeper element into view */
        var card = i !== journey.index ? stops[i].card : null;
        if (card && card.scrollTop && !stops[i].el.contains(document.activeElement)) {
            card.scrollTop = 0;
        }
        setIndex(i);
        if (mode === 'h') {
            track.scrollTo({ left: i * track.clientWidth, behavior: instant ? 'auto' : 'smooth' });
        } else if (instant) {
            jumpWindow(Math.max(0, stops[i].el.offsetTop - NAV_H));
        } else {
            window.scrollTo({ top: Math.max(0, stops[i].el.offsetTop - NAV_H), behavior: 'smooth' });
        }
        armSettle();
    }

    function goToId(id) {
        var i = indexOf(id);
        if (i >= 0) { goTo(i); }
    }

    function armSettle() {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, SETTLE_MS);
    }

    function settle() {
        clearTimeout(settleTimer);
        settleTimer = 0;
        travelling = false;
        root.classList.remove('journey-travelling');
        if (!journey.active) { return; }
        /* the first arrive trusts the deep link: async content may still be shifting offsets */
        var i = arrivedIndex < 0 && initialIndex >= 0 ? initialIndex : indexFromPos();
        setIndex(i);
        updateHasMore();
        if (i === arrivedIndex) { return; }
        var initial = arrivedIndex < 0;
        arrivedIndex = i;
        var s = stops[i];
        updateNav(s.id);
        try {
            history.replaceState(null, '', i ? '#' + s.id : location.pathname + location.search);
        } catch (e) { /* sandboxed / file: origins */ }
        emit('journey:arrive', { index: i, id: s.id, planet: s.planet, stop: s.stop, initial: initial });
    }

    /* ---- progress loop: runs only while the position changes or v decays ---- */
    function kick() {
        if (!rafId) { rafId = requestAnimationFrame(tick); }
    }

    function tick() {
        rafId = 0;
        var pos = posOf();
        var delta = lastPos < 0 ? 0 : Math.abs(pos - lastPos);
        lastPos = pos;
        vel = vel * 0.7 + delta * 0.3;
        if (vel < 0.05) { vel = 0; }
        var p = progress();
        /* written on the sky, not <html>: a custom property on the root invalidates
           the whole document's style every frame (~6 ms); the sky is its only consumer */
        if (sky) {
            sky.style.setProperty('--journey-p', p.toFixed(4));
            sky.style.setProperty('--journey-v', Math.min(1, vel / 60).toFixed(3));
        }
        emit('journey:progress', { p: p, v: vel, index: journey.index, mode: mode });
        if (delta > 0 || vel > 0) { rafId = requestAnimationFrame(tick); }
    }

    function onScroll() {
        if (!journey.active) { return; }
        /* The glass cards drop their backdrop blur while the sky is moving: the
           filter costs a compositing pass per frame (its radius does not matter)
           and nobody reads a card mid-flight. settle() puts it back. */
        if (!travelling) {
            travelling = true;
            root.classList.add('journey-travelling');
        }
        kick();
        armSettle();
    }

    /* ---- input (horizontal mode) ---- */
    /* Vertical wheel scrolls the card first, then pages; horizontal wheel (trackpad
       swipe, tilt wheel) pages too, since a short native swipe would only snap back.
       Form fields and the carousels (native horizontal scrollers) keep their wheel. */
    function onWheel(e) {
        if (!journey.active || mode !== 'h') { return; }
        if (e.ctrlKey || e.metaKey) { return; } /* pinch-zoom arrives as a wheel event */
        var horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (closest(e.target, horizontal ? CAROUSELS : FIELDS)) { return; }
        var now = Date.now();
        var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        var d = (horizontal ? e.deltaX : e.deltaY) * unit;
        if (now < lockUntil) { e.preventDefault(); return; }
        var card = stops[journey.index].card;
        if (!horizontal && canScroll(card, d)) {
            if (!card.contains(e.target)) {
                e.preventDefault();
                card.scrollBy({ top: d });
            }
            edgeArmedUntil = now + WHEEL.arm;
            acc = 0;
            return;
        }
        e.preventDefault();
        if (now < edgeArmedUntil || Math.abs(d) < WHEEL.tail) { return; }
        if (now - lastWheelAt > WHEEL.decay) { acc = 0; }
        lastWheelAt = now;
        /* a line/page-mode notch (Firefox mouse wheel) is a whole step, never a tail */
        acc += e.deltaMode ? (d > 0 ? 1 : -1) * WHEEL.threshold : d;
        if (Math.abs(acc) >= WHEEL.threshold) {
            goTo(journey.index + (acc > 0 ? 1 : -1));
            lockUntil = now + WHEEL.lock;
            acc = 0;
        }
    }

    function onKey(e) {
        if (!journey.active || mode !== 'h' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) { return; }
        var t = e.target;
        if (closest(t, FIELDS)) { return; }
        var key = e.key === ' ' || e.key === 'Spacebar' ? 'Space' : e.key;
        if (key === 'Space' && closest(t, 'button, [role="button"], summary')) { return; }
        var card = stops[journey.index].card;
        var dir = 0;
        var amount = 0;
        switch (key) {
            case 'ArrowRight':
            case 'ArrowLeft':
                if (closest(t, '[aria-roledescription="carousel"]')) { return; }
                e.preventDefault();
                goTo(journey.index + (key === 'ArrowRight' ? 1 : -1));
                return;
            case 'Home':
                e.preventDefault();
                goTo(0);
                return;
            case 'End':
                e.preventDefault();
                goTo(stops.length - 1);
                return;
            case 'ArrowDown': dir = 1; amount = 80; break;
            case 'ArrowUp': dir = -1; amount = 80; break;
            case 'PageDown': dir = 1; break;
            case 'PageUp': dir = -1; break;
            case 'Space': dir = e.shiftKey ? -1 : 1; break;
            default: return;
        }
        e.preventDefault();
        if (canScroll(card, dir)) {
            card.scrollBy({ top: dir * (amount || card.clientHeight * 0.85), behavior: 'smooth' });
        } else {
            goTo(journey.index + dir);
        }
    }

    function onClick(e) {
        if (!journey.active || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
        var a = closest(e.target, 'a[href^="#"]');
        if (!a || a.classList.contains('nav-link')) { return; }
        var id = a.getAttribute('href').slice(1);
        if (indexOf(id) < 0) { return; }
        e.preventDefault();
        goToId(id);
    }

    function onHashChange() {
        if (!journey.active) { return; }
        var id = location.hash.slice(1);
        if (!id) { goTo(0); } /* Back to the bare URL is Home */
        else if (indexOf(id) >= 0) { goToId(id); }
    }

    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (!journey.active) { return; }
            if (mode === 'h') { goTo(journey.index, { behavior: 'auto' }); }
            updateHasMore();
        }, 120);
    }

    /* ---- modes ---- */
    function setMode(next) {
        mode = journey.mode = next;
        root.classList.remove('journey-h', 'journey-v');
        root.classList.add(next === 'h' ? 'journey-h' : 'journey-v');
        applyCue();
        lastPos = -1;
        requestAnimationFrame(function () {
            if (!journey.active) { return; }
            goTo(journey.index, { behavior: 'auto' });
            updateHasMore();
            kick();
            emit('journey:modechange', { mode: next });
        });
    }

    function onMediaChange() {
        if (!journey.active) { return; }
        var next = mqJourney.matches ? 'h' : 'v';
        if (next !== mode) { setMode(next); }
    }

    function onReducedChange() {
        if (!journey.active || !mqReduced.matches) { return; }
        journey.active = false;
        journey.mode = null;
        clearTimeout(settleTimer);
        root.classList.remove('journey', 'journey-h', 'journey-v', 'journey-ready');
        if (cue) { cue.innerHTML = cueHtml; }
        updateHasMore();
        jumpWindow(Math.max(0, stops[journey.index].el.offsetTop - NAV_H));
    }

    function listen(mq, fn) {
        if (mq.addEventListener) { mq.addEventListener('change', fn); } else { mq.addListener(fn); }
    }

    /* ---- init ---- */
    journey.active = true;
    journey.mode = mode;
    journey.count = stops.length;
    journey.stops = stops;

    injectSky();
    injectMore();
    applyCue();

    track.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('scrollend', settle);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', settle);
    track.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('resize', onResize);
    window.addEventListener('load', function () {
        updateHasMore();
        /* like the browser's own fragment scroll: re-land the deep link once the page has loaded */
        if (journey.active && initialIndex >= 0 && (arrivedIndex < 0 || arrivedIndex === initialIndex)) {
            goTo(initialIndex, { behavior: 'auto' });
        }
    });
    listen(mqJourney, onMediaChange);
    listen(mqReduced, onReducedChange);
    for (var k = 0; k < stops.length; k++) {
        if (stops[k].card) {
            stops[k].card.addEventListener('scroll', onCardScroll, { passive: true });
            if (window.ResizeObserver) {
                (function (card) {
                    new ResizeObserver(function () { updateHasMoreFor(card); }).observe(card.firstElementChild || card);
                })(stops[k].card);
            }
        }
    }

    if (initialIndex >= 0) {
        goTo(initialIndex, { behavior: 'auto' });
    } else {
        setIndex(indexFromPos());
        armSettle();
    }
    updateHasMore();
    root.classList.add('journey-ready');
    kick();
    emit('journey:ready', { mode: mode });
})();


/* ============================================================
   Planet Journey — rocket module: the pilot rocket that hovers beside
   the hero Earth, lifts off into the sky band and cruises to Neptune
   (h), or flies down the right edge (v); plus the "Return to Earth"
   back-to-top label. Reads window.journey and its events only.
   ============================================================ */
(function () {
    'use strict';

    var journey = window.journey;
    if (!journey || !journey.active) { return; }

    var NAV_H = 70;
    var ROCKET_W = 60;
    var ROCKET_H = 120;
    var FIN = 15;                 /* fins stick out 15px on each side of the body */
    var LAUNCH_END = 0.15;        /* p over which the launch puffs burn */
    /* One pose per stop, as fractions of the viewport, so the rocket wanders the
       sky instead of sliding along a rail: it is somewhere different at every
       planet and swings across the screen in between. Stop 0 is the parked pose
       measured beside the hero Earth. */
    var STOP_POSES = [
        null,                            /* Earth: parked (measured) */
        { x: 0.075, y: 0.20, a: 65 },    /* Mars: left gutter, high */
        { x: 0.855, y: 0.62, a: 145 },   /* Jupiter: right, diving */
        { x: 0.26, y: 0.09, a: 100 },    /* Saturn: the sky band, left of centre */
        { x: 0.065, y: 0.58, a: 30 },    /* Uranus: left gutter, low, climbing */
        { x: 0.80, y: 0.10, a: 118 },    /* Neptune: high on the right */
        { x: 0.46, y: 0.74, a: 20 }      /* Beyond: under the last card, heading out */
    ];
    var V_TOP = 0.18;             /* vh (vertical journey) */
    var V_BOTTOM = 0.62;          /* vh — ends beside the Beyond card, clear of the back-to-top button */
    var V_HIDDEN_P = 0.03;        /* v: the pilot only appears once the hero starts to scroll */
    var MAX_V = 60;               /* px/frame that counts as full thrust (same scale as --journey-v) */
    var IDLE_FLAME = 44;          /* px of exhaust below the body at zero thrust */
    var DOCK_MS = 300;
    var PUFF_MS = 1100;           /* keep .is-launching at least this long so the puffs finish */
    var MARGIN = 6;
    /* Parked poses: upright, hovering beside the Earth (offset of the body box from
       the Earth's right edge / centre line). The first pose that covers nothing wins;
       if every pose collides (very short viewports) the parked rocket stays hidden. */
    var POSES = [
        { dx: 25, dy: 0 }, { dx: 25, dy: -40 }, { dx: 25, dy: 40 }, { dx: 25, dy: -80 },
        { dx: -285, dy: 0 }, { dx: -285, dy: -40 }, { dx: -285, dy: 40 }
    ];
    /* hero elements the parked rocket must not cover: the text blocks, the
       individual buttons and social icons (their wrappers span the whole column) */
    var OBSTACLES = '.hero-text > :not(.hero-buttons):not(.social-links), .hero-buttons > *, ' +
                    '.social-links > *, .hero-image, .space-motto, .scroll-indicator';

    var hero = journey.stops[0] ? journey.stops[0].el : null;
    var backToTop = document.getElementById('back-to-top');
    var backLabel = backToTop ? backToTop.getAttribute('aria-label') : null;
    var mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var pilot = build();
    var geo = { dirty: true, vw: 0, vh: 0, laneY: 0, stand: null };
    var lastP = 0;
    var dockTimer = 0;
    var launchTimer = 0;
    var launchSince = 0;
    var resizeTimer = 0;

    /* ---- helpers ---- */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function easeOut(t) {
        t = Math.max(0, Math.min(1, t));
        return 1 - Math.pow(1 - t, 3);
    }

    /* smootherstep: the rocket leaves and reaches each pose at rest */
    function ease(t) {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
    }

    /* A stop's pose in px. Stop 0 is the parked spot beside the Earth when it
       could be measured; otherwise it falls back to the first travelling pose. */
    function poseAt(i) {
        var pose = STOP_POSES[Math.max(0, Math.min(STOP_POSES.length - 1, i))];
        if (!pose) {
            return geo.stand || { x: STOP_POSES[1].x * geo.vw, y: STOP_POSES[1].y * geo.vh, a: STOP_POSES[1].a };
        }
        return { x: pose.x * geo.vw, y: pose.y * geo.vh, a: pose.a };
    }

    function listen(mq, fn) {
        if (mq.addEventListener) { mq.addEventListener('change', fn); } else { mq.addListener(fn); }
    }

    function build() {
        var el = document.createElement('div');
        el.className = 'jr-pilot is-docked';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
            '<div class="jr-bob">' +
                '<div class="space-rocket">' +
                    '<div class="rocket-body"></div>' +
                    '<div class="rocket-window"></div>' +
                    '<div class="rocket-fin-left"></div>' +
                    '<div class="rocket-fin-right"></div>' +
                    '<div class="rocket-exhaust"></div>' +
                '</div>' +
                '<ul class="jr-fumes"><li></li><li></li><li></li><li></li><li></li></ul>' +
            '</div>';
        return el;
    }

    /* ---- geometry (measured lazily: resize, load and mode changes mark it dirty) ---- */
    function parkByEarth() {
        var earth = hero ? hero.querySelector('.space-earth') : null;
        if (!earth) { return null; }
        var hr = hero.getBoundingClientRect();
        var er = earth.getBoundingClientRect();
        if (!er.width || !er.height) { return null; }
        /* everything relative to the hero panel, so a scrolled track does not matter */
        var right = er.right - hr.left;
        var cy = er.top - hr.top + er.height / 2;
        var blocks = [];
        var els = hero.querySelectorAll(OBSTACLES);
        for (var i = 0; i < els.length; i++) {
            var b = els[i].getBoundingClientRect();
            if (b.width && b.height) {
                blocks.push({ l: b.left - hr.left, t: b.top - hr.top, r: b.right - hr.left, b: b.bottom - hr.top });
            }
        }
        /* the panel's edges count too (the flame's faint tip may leave at the bottom) */
        blocks.push({ l: -1e4, t: -1e4, r: 0, b: 1e4 });
        blocks.push({ l: -1e4, t: hr.height + 12, r: 1e4, b: 1e4 });
        var best = null;
        for (var k = 0; k < POSES.length; k++) {
            var x = right + POSES[k].dx;
            var y = cy + POSES[k].dy;
            /* box of the upright rocket, fins and idle flame included */
            var l = x - FIN - MARGIN;
            var r = x + ROCKET_W + FIN + MARGIN;
            var t = y - MARGIN;
            var bt = y + ROCKET_H + IDLE_FLAME + MARGIN;
            var overlap = 0;
            for (var j = 0; j < blocks.length; j++) {
                overlap += Math.max(0, Math.min(r, blocks[j].r) - Math.max(l, blocks[j].l)) *
                           Math.max(0, Math.min(bt, blocks[j].b) - Math.max(t, blocks[j].t));
            }
            if (!best || overlap < best.overlap) {
                best = { x: x, y: y, a: 0, overlap: overlap };
            }
            if (!overlap) { break; }
        }
        return best;
    }

    function measure() {
        geo.dirty = false;
        geo.vw = window.innerWidth;
        geo.vh = window.innerHeight;
        /* lane centre = half-way between the navbar and the card top (nav-h + sky-band / 2);
           read from the About card so the lane follows journey.css, with the token as fallback */
        var cardTop = NAV_H + Math.min(120, Math.max(88, geo.vh * 0.12));
        var card = journey.mode === 'h' && journey.stops[1] ? journey.stops[1].card : null;
        if (card) {
            var r = card.getBoundingClientRect();
            if (r.height > 0) { cardTop = r.top; }
        }
        geo.laneY = (NAV_H + cardTop) / 2 - ROCKET_H / 2;
        geo.stand = journey.mode === 'h' ? parkByEarth() : null;
    }

    /* ---- choreography ---- */
    /* .is-launching follows p ∈ (0, 0.15] but stays on for PUFF_MS so the puffs
       can finish; landing back on Earth (grounded) clears it at once */
    function setLaunching(on, grounded) {
        var now = Date.now();
        if (on) {
            clearTimeout(launchTimer);
            launchTimer = 0;
            if (!pilot.classList.contains('is-launching')) {
                pilot.classList.add('is-launching');
                launchSince = now;
            }
            return;
        }
        if (!pilot.classList.contains('is-launching')) { return; }
        var left = grounded ? 0 : PUFF_MS - (now - launchSince);
        if (left <= 0) {
            clearTimeout(launchTimer);
            launchTimer = 0;
            pilot.classList.remove('is-launching');
        } else if (!launchTimer) {
            launchTimer = setTimeout(function () {
                launchTimer = 0;
                pilot.classList.remove('is-launching');
            }, left);
        }
    }

    function setThrust(v) {
        pilot.style.setProperty('--jr-thrust', Math.min(1, v / MAX_V).toFixed(3));
        if (v > 0) {
            clearTimeout(dockTimer);
            dockTimer = 0;
            pilot.classList.remove('is-docked');
        } else if (!dockTimer && !pilot.classList.contains('is-docked')) {
            dockTimer = setTimeout(function () {
                dockTimer = 0;
                pilot.classList.add('is-docked');
            }, DOCK_MS);
        }
    }

    function place(p, mode) {
        if (!mode) { return; }
        if (geo.dirty) { measure(); }
        var x, y, a;
        var tucked = false;
        if (mode === 'h') {
            /* between the poses of the two stops either side of p */
            var legs = Math.max(1, STOP_POSES.length - 1);
            var t = Math.max(0, Math.min(legs, p * legs));
            var i = Math.min(legs - 1, Math.floor(t));
            var e = ease(t - i);
            var from = poseAt(i);
            var to = poseAt(i + 1);
            x = lerp(from.x, to.x, e);
            y = lerp(from.y, to.y, e);
            a = lerp(from.a, to.a, e);
        } else {
            x = 0;
            y = geo.vh * lerp(V_TOP, V_BOTTOM, p);
            a = 180;
            tucked = p < V_HIDDEN_P; /* it launches out of the hero on the first scroll */
        }
        pilot.style.setProperty('--jr-x', x.toFixed(1) + 'px');
        pilot.style.setProperty('--jr-y', y.toFixed(1) + 'px');
        pilot.style.setProperty('--jr-a', a.toFixed(1) + 'deg');
        var grounded = mode === 'h' && p === 0;
        if (grounded && (!geo.stand || geo.stand.overlap > 0)) { tucked = true; } /* no room to park */
        pilot.classList.toggle('is-grounded', grounded);
        pilot.classList.toggle('is-tucked', tucked);
        setLaunching(mode === 'h' && p > 0 && p <= LAUNCH_END, grounded);
    }

    function applyLabel(mode) {
        if (!backToTop) { return; }
        if (mode === 'h') {
            backToTop.setAttribute('aria-label', 'Return to Earth');
        } else if (backLabel !== null) {
            backToTop.setAttribute('aria-label', backLabel);
        } else {
            backToTop.removeAttribute('aria-label');
        }
    }

    function replace() {
        if (!journey.active) { return; }
        geo.dirty = true;
        place(journey.progress(), journey.mode);
    }

    /* ---- events ---- */
    function onProgress(e) {
        if (!journey.active) { return; }
        var d = e.detail;
        lastP = d.p;
        setThrust(d.v);
        place(d.p, d.mode);
    }

    function onModeChange(e) {
        applyLabel(e.detail.mode);
        replace();
    }

    function onResize() {
        geo.dirty = true;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (journey.active) { place(lastP, journey.mode); }
        }, 150);
    }

    function onReducedChange() {
        /* core has already switched the plain page on; the pilot hides through the html.journey gate */
        if (mqReduced.matches) {
            clearTimeout(dockTimer);
            clearTimeout(launchTimer);
            applyLabel(null);
        }
    }

    /* ---- init ---- */
    lastP = journey.progress();
    setThrust(0);
    place(lastP, journey.mode);
    applyLabel(journey.mode);
    document.body.appendChild(pilot);

    document.addEventListener('journey:progress', onProgress);
    document.addEventListener('journey:modechange', onModeChange);
    window.addEventListener('resize', onResize);
    window.addEventListener('load', replace);
    listen(mqReduced, onReducedChange);
})();


/* ============================================================
   Planet Journey — planets module: injects the five planets, the
   Beyond decor and the Galilean dots on the research cards, and
   gates planet animation on nearby panels (.is-near).
   Reads window.journey only; does nothing on the plain page.
   ============================================================ */
(function () {
    'use strict';

    var journey = window.journey;
    if (!journey || !journey.active) { return; }

    var DISC = '<div class="jp-disc"></div>';
    var RINGS_BACK = '<div class="jp-ring jp-ring-back"></div>';
    var RINGS_FRONT = '<div class="jp-ring jp-ring-front"></div>';
    var GALILEAN = ['io', 'europa', 'ganymede', 'callisto'];
    var PLANETS = {
        mars: DISC + moon('phobos') + moon('deimos'),
        jupiter: '<div class="jp-orbit"></div>' + DISC + GALILEAN.map(moon).join(''),
        saturn: RINGS_BACK + DISC + RINGS_FRONT,
        uranus: RINGS_BACK + DISC + RINGS_FRONT,
        neptune: DISC + moon('triton')
    };
    var BEYOND = '<div class="jp-beyond">' +
        '<span class="jp-pale-dot"></span>' +
        '<p class="jp-caption">EARTH · 29 AU BEHIND YOU</p>' +
        '<p class="jp-motto">STILL REACHING</p>' +
        '</div>';

    var observer = null;
    var planetPanels = [];

    function moon(name) {
        return '<div class="jp-moon jp-moon-' + name + '"></div>';
    }

    /* ---- DOM: planet as the panel's first child, decor into #beyond ---- */
    function inject() {
        var stops = journey.stops;
        for (var i = 0; i < stops.length; i++) {
            var s = stops[i];
            if (PLANETS[s.planet]) {
                if (!s.el.querySelector('.jp-planet')) {
                    var planet = document.createElement('div');
                    planet.className = 'jp-planet jp-' + s.planet;
                    planet.setAttribute('aria-hidden', 'true');
                    planet.innerHTML = '<div class="jp-body">' + PLANETS[s.planet] + '</div>';
                    s.el.insertBefore(planet, s.el.firstChild);
                }
                planetPanels.push(s.el);
            } else if (s.planet === 'beyond') {
                var decor = s.el.querySelector('.beyond-decor');
                if (decor && !decor.firstElementChild) { decor.innerHTML = BEYOND; }
            }
        }
    }

    /* ---- Galilean dot per research card; hover lights the orbit moon ---- */
    function light(name, on) {
        var orbitMoon = document.querySelector('#research .jp-moon-' + name);
        if (orbitMoon) { orbitMoon.classList.toggle('is-lit', on); }
    }

    function injectMoonDots() {
        var cards = document.querySelectorAll('#research .research-card');
        for (var i = 0; i < cards.length && i < GALILEAN.length; i++) {
            bindDot(cards[i], GALILEAN[i]);
        }
    }

    function bindDot(card, name) {
        if (card.querySelector('.jp-moon-dot')) { return; }
        var dot = document.createElement('span');
        dot.className = 'jp-moon-dot jp-moon-dot-' + name;
        dot.setAttribute('aria-hidden', 'true');
        card.appendChild(dot);
        card.addEventListener('mouseenter', function () { light(name, true); });
        card.addEventListener('mouseleave', function () { light(name, false); });
    }

    /* ---- .is-near: planets animate only while their panel is near ---- */
    function observe() {
        if (observer) { observer.disconnect(); observer = null; }
        if (!window.IntersectionObserver) {
            for (var k = 0; k < planetPanels.length; k++) { planetPanels[k].classList.add('is-near'); }
            return;
        }
        observer = new IntersectionObserver(function (entries) {
            for (var k = 0; k < entries.length; k++) {
                entries[k].target.classList.toggle('is-near', entries[k].isIntersecting);
            }
        }, { root: journey.mode === 'h' ? document.getElementById('journey-track') : null, rootMargin: '100%' });
        for (var i = 0; i < planetPanels.length; i++) { observer.observe(planetPanels[i]); }
    }

    function onModeChange() {
        if (!journey.active || !journey.mode) { return; }
        observe();
    }

    /* ---- init ---- */
    inject();
    injectMoonDots();
    observe();
    document.addEventListener('journey:modechange', onModeChange);
})();


/* ============================================================
   Planet Journey — nav module: flight path in the navbar,
   arrival announcements, focus management and the list-view
   toggle. Reads window.journey only; on the plain page it only
   offers the "journey view" button to visitors who opted out.
   ============================================================ */
(function () {
    'use strict';

    var root = document.documentElement;
    var NAV_H = 70;
    var REDUCED_MQ = '(prefers-reduced-motion: reduce)';
    var NAMES = { beyond: 'Footer' }; /* stops without a menu link */

    var navbar = document.getElementById('navbar');
    var controls = navbar ? navbar.querySelector('.nav-controls') : null;
    var started = false;

    function storage(fn) {
        try { return fn(window.localStorage); } catch (e) { return null; }
    }

    function listen(mq, fn) {
        if (mq.addEventListener) { mq.addEventListener('change', fn); } else { mq.addListener(fn); }
    }

    function closest(node, sel) {
        return node && node.closest ? node.closest(sel) : null;
    }

    /* "Mars — About": planet from data-stop, section name from the menu */
    function labelOf(stop) {
        var link = document.querySelector('.nav-link[href="#' + stop.id + '"]');
        var name = (link && link.textContent.trim()) || NAMES[stop.id] || stop.id;
        return stop.stop + ' — ' + name;
    }

    function makeToggle(toJourney) {
        var darkToggle = document.getElementById('dark-mode-toggle');
        var b = document.createElement('button');
        b.className = 'jn-list-toggle dark-mode-btn ' + (toJourney ? 'jn-to-journey' : 'jn-to-list');
        b.type = 'button';
        b.setAttribute('aria-label', toJourney ? 'Switch to journey view' : 'Switch to list view');
        b.title = toJourney ? 'Journey view' : 'List view';
        b.innerHTML = '<i class="fas ' + (toJourney ? 'fa-rocket' : 'fa-list') + '" aria-hidden="true"></i>';
        b.addEventListener('click', function () {
            storage(function (ls) {
                if (toJourney) { ls.removeItem('layout'); } else { ls.setItem('layout', 'list'); }
            });
            /* the reloaded page lands on the URL's stop, not on the restored scroll offset */
            try { history.scrollRestoration = 'manual'; } catch (e) { /* older browsers */ }
            location.reload();
        });
        controls.insertBefore(b, darkToggle && darkToggle.parentNode === controls ? darkToggle : controls.firstChild);
        controls.classList.add('jn-has-toggle'); /* phones dock the two buttons beside the hamburger */
        return b;
    }

    /* ---- journey active ---- */
    function initJourney() {
        var journey = window.journey;
        if (started || !journey || !journey.active || !navbar) { return; }
        started = true;

        var stops = journey.stops;
        var track = document.getElementById('journey-track');
        var n = stops.length;
        var labels = [];
        for (var i = 0; i < n; i++) { labels[i] = labelOf(stops[i]); }

        /* No progress rail: the navbar's own menu already says where you are.
           This module keeps the arrival announcements, focus handling and the
           list-view toggle. */

        /* live region */
        var live = document.createElement('div');
        live.className = 'jn-live';
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        document.body.appendChild(live);

        if (controls) { makeToggle(false); }

        /* the arrived stop's heading (the card's h2, the hero's h1, else the card
           itself) takes focus unless focus is already inside the panel — Tab
           travelling into it must not be bounced back to the heading. This is
           programmatic focus for AT: it never draws a ring (Tab-driven focus keeps
           the browser's own ring on the element that was tabbed to) */
        function focusHeading(stop) {
            var scope = stop.card || stop.el;
            var el = scope.querySelector('h1, h2, h3') || stop.card;
            if (!el || stop.el.contains(document.activeElement)) { return; }
            if (!el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '-1'); }
            el.setAttribute('data-jn-focus', '');
            try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
        }

        function onArrive(e) {
            var d = e.detail;
            if (d.initial || !journey.active) { return; }
            live.textContent = 'Arrived at ' + labels[d.index] + ', ' + (d.index + 1) + ' of ' + n;
            if (journey.mode === 'h') { focusHeading(stops[d.index]); }
        }

        /* Tab into a panel that is not on screen → fly there. The browser has
           already snapped the track onto that panel before focusin fires, so put
           it back on the current stop first and let goTo animate the flight */
        function onFocusIn(e) {
            if (!journey.active || journey.mode !== 'h') { return; }
            var panel = closest(e.target, '.panel');
            if (!panel) { return; }
            for (var k = 0; k < n; k++) {
                if (stops[k].el === panel) {
                    if (k !== journey.index) {
                        if (track) { track.scrollLeft = journey.index * track.clientWidth; }
                        journey.goTo(k);
                    }
                    return;
                }
            }
        }

        document.addEventListener('journey:arrive', onArrive);
        document.addEventListener('focusin', onFocusIn);
    }

    /* ---- plain page: offer the way back for visitors who chose the list ---- */
    function initPlain() {
        if (!controls || storage(function (ls) { return ls.getItem('layout'); }) !== 'list') { return; }
        var mqReduced = window.matchMedia(REDUCED_MQ);
        var btn = makeToggle(true);
        /* both h and v are journeys, so only reduced motion hides the way back */
        function update() { btn.hidden = mqReduced.matches; }
        update();
        listen(mqReduced, update);
        /* the list view opened from the journey keeps its stop in the URL; land on it
           when the browser did not (scroll restoration wins over the fragment on reload) */
        window.addEventListener('load', function () {
            var target = location.hash.length > 1 ? document.getElementById(location.hash.slice(1)) : null;
            if (target && !window.pageYOffset) {
                var prev = root.style.scrollBehavior;
                root.style.scrollBehavior = 'auto';
                window.scrollTo(0, Math.max(0, target.offsetTop - NAV_H));
                root.style.scrollBehavior = prev;
            }
        });
    }

    if (window.journey && window.journey.active) {
        initJourney();
    } else {
        initPlain();
    }
})();
