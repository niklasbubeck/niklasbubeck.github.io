/* ============================================================
   Planet Journey — core: track, input, progress and events.
   Public API on window.journey; events on document:
   journey:ready, journey:progress, journey:arrive, journey:modechange
   ============================================================ */
(function () {
    'use strict';

    var root = document.documentElement;
    var NAV_H = 70;
    var SETTLE_MS = 180;
    var JOURNEY_MQ = '(min-width: 821px) and (min-height: 560px)';
    var REDUCED_MQ = '(prefers-reduced-motion: reduce)';
    var WHEEL = { tail: 4, threshold: 60, lock: 850, arm: 350, decay: 200 };
    var WHEEL_NATIVE = '.publications-viewport, .github-projects-viewport, input, textarea, select, [contenteditable]';
    var FIELDS = 'input, textarea, select, [contenteditable]';
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

    var track = document.getElementById('journey');
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
    var cue = document.querySelector('.hero .scroll-indicator');
    var cueHtml = cue ? cue.innerHTML : '';
    var mqJourney = window.matchMedia(JOURNEY_MQ);
    var mqReduced = window.matchMedia(REDUCED_MQ);

    var arrivedIndex = -1;
    var initialIndex = indexOf(location.hash.slice(1)); /* stop named by the URL at load */
    var settleTimer = 0;
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
        var sky = document.createElement('div');
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

    function updateHasMore() {
        for (var k = 0; k < stops.length; k++) {
            var card = stops[k].card;
            if (card) {
                card.classList.toggle('has-more', mode === 'h' && card.scrollHeight - card.clientHeight - card.scrollTop > 8);
            }
        }
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
        root.style.setProperty('--journey-p', p.toFixed(4));
        root.style.setProperty('--journey-v', Math.min(1, vel / 60).toFixed(3));
        emit('journey:progress', { p: p, v: vel, index: journey.index, mode: mode });
        if (delta > 0 || vel > 0) { rafId = requestAnimationFrame(tick); }
    }

    function onScroll() {
        if (!journey.active) { return; }
        kick();
        armSettle();
    }

    /* ---- input (horizontal mode) ---- */
    function onWheel(e) {
        if (!journey.active || mode !== 'h') { return; }
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { return; }
        if (closest(e.target, WHEEL_NATIVE)) { return; }
        var now = Date.now();
        var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
        if (now < lockUntil) { e.preventDefault(); return; }
        var card = stops[journey.index].card;
        if (canScroll(card, dy)) {
            if (!card.contains(e.target)) {
                e.preventDefault();
                card.scrollBy({ top: dy });
            }
            edgeArmedUntil = now + WHEEL.arm;
            acc = 0;
            return;
        }
        e.preventDefault();
        if (now < edgeArmedUntil || Math.abs(dy) < WHEEL.tail) { return; }
        if (now - lastWheelAt > WHEEL.decay) { acc = 0; }
        lastWheelAt = now;
        acc += dy;
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
        if (!journey.active || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
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
        if (indexOf(id) >= 0) { goToId(id); }
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
            stops[k].card.addEventListener('scroll', updateHasMore, { passive: true });
            if (window.ResizeObserver) {
                new ResizeObserver(updateHasMore).observe(stops[k].card.firstElementChild || stops[k].card);
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
   Planet Journey — rocket module: the pilot rocket that stands on the
   hero Earth, lifts off into the sky band and cruises to Neptune
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
    var LAUNCH_END = 0.15;        /* p at which the lift-off tween reaches the lane */
    var LANE_START = 0.20;        /* vw */
    var LANE_END = 0.64;          /* vw */
    var V_TOP = 0.18;             /* vh (vertical journey) */
    var V_BOTTOM = 0.78;          /* vh */
    var MAX_V = 60;               /* px/frame that counts as full thrust (same scale as --journey-v) */
    var DOCK_MS = 300;
    var PUFF_MS = 1100;           /* keep .is-launching at least this long so the puffs finish */
    var MARGIN = 6;
    /* Standing poses: angle on Earth's rim, clockwise from the top. The contract
       pose (top centre, nose up) comes first; the others are the fallbacks used
       when the hero text sits over Earth's top (buttons/social links). */
    var POSES = [0, -30, 30, -45, 45, -60, 60, -75, 75, -90, 90];
    /* hero elements the standing rocket must not cover: the text blocks, the
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
    function standOnEarth() {
        var earth = hero ? hero.querySelector('.space-earth') : null;
        if (!earth) { return null; }
        var hr = hero.getBoundingClientRect();
        var er = earth.getBoundingClientRect();
        if (!er.width || !er.height) { return null; }
        /* everything relative to the hero panel, so a scrolled track does not matter */
        var cx = er.left - hr.left + er.width / 2;
        var cy = er.top - hr.top + er.height / 2;
        var reach = er.width / 2 + ROCKET_H / 2; /* rim + half a rocket = the rocket's centre */
        var blocks = [];
        var els = hero.querySelectorAll(OBSTACLES);
        for (var i = 0; i < els.length; i++) {
            var b = els[i].getBoundingClientRect();
            if (b.width && b.height) {
                blocks.push({ l: b.left - hr.left, t: b.top - hr.top, r: b.right - hr.left, b: b.bottom - hr.top });
            }
        }
        var best = null;
        for (var k = 0; k < POSES.length; k++) {
            var a = POSES[k];
            var sin = Math.sin(a * Math.PI / 180);
            var cos = Math.cos(a * Math.PI / 180);
            var mx = cx + reach * sin;
            var my = cy - reach * cos;
            /* axis-aligned box of the rotated rocket (fins included) */
            var hx = ((ROCKET_W + 2 * FIN) * Math.abs(cos) + ROCKET_H * Math.abs(sin)) / 2 + MARGIN;
            var hy = ((ROCKET_W + 2 * FIN) * Math.abs(sin) + ROCKET_H * Math.abs(cos)) / 2 + MARGIN;
            var overlap = 0;
            for (var j = 0; j < blocks.length; j++) {
                overlap += Math.max(0, Math.min(mx + hx, blocks[j].r) - Math.max(mx - hx, blocks[j].l)) *
                           Math.max(0, Math.min(my + hy, blocks[j].b) - Math.max(my - hy, blocks[j].t));
            }
            if (!best || overlap < best.overlap) {
                best = { x: mx - ROCKET_W / 2, y: my - ROCKET_H / 2, a: a, overlap: overlap };
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
        geo.stand = journey.mode === 'h' ? standOnEarth() : null;
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
        if (mode === 'h') {
            var stand = geo.stand;
            /* the lane starts at 20vw, or straight above the standing spot when Earth's rim is further right */
            var laneX = Math.max(LANE_START * geo.vw, stand ? stand.x : 0);
            if (stand && p <= LAUNCH_END) {
                var e = easeOut(p / LAUNCH_END);
                x = lerp(stand.x, laneX, e);
                y = lerp(stand.y, geo.laneY, e);
                a = lerp(stand.a, 90, e);
            } else {
                x = lerp(laneX, LANE_END * geo.vw, Math.max(0, (p - LAUNCH_END) / (1 - LAUNCH_END)));
                y = geo.laneY;
                a = 90;
            }
        } else {
            x = 0;
            y = geo.vh * lerp(V_TOP, V_BOTTOM, p);
            a = 180;
        }
        pilot.style.setProperty('--jr-x', x.toFixed(1) + 'px');
        pilot.style.setProperty('--jr-y', y.toFixed(1) + 'px');
        pilot.style.setProperty('--jr-a', a.toFixed(1) + 'deg');
        var grounded = mode === 'h' && p === 0;
        pilot.classList.toggle('is-grounded', grounded);
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
        }, { root: journey.mode === 'h' ? document.getElementById('journey') : null, rootMargin: '100%' });
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
    var JOURNEY_MQ = '(min-width: 821px) and (min-height: 560px)';
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
            location.reload();
        });
        controls.insertBefore(b, darkToggle && darkToggle.parentNode === controls ? darkToggle : controls.firstChild);
        return b;
    }

    /* ---- journey active ---- */
    function initJourney() {
        var journey = window.journey;
        if (started || !journey || !journey.active || !navbar) { return; }
        started = true;

        var stops = journey.stops;
        var n = stops.length;
        var labels = [];
        var stopEls = [];
        var current = -1;
        var byKeyboard = false; /* last input was a key (for the heading focus ring) */

        /* flight path */
        var path = document.createElement('div');
        path.className = 'jn-path';
        path.setAttribute('role', 'group');
        path.setAttribute('aria-label', 'Flight path');
        path.style.setProperty('--jn-n', String(Math.max(1, n - 1)));
        var rail = document.createElement('div');
        rail.className = 'jn-rail';
        rail.innerHTML = '<span class="jn-line" aria-hidden="true"></span><span class="jn-fill" aria-hidden="true"></span>';
        for (var i = 0; i < n; i++) {
            labels[i] = labelOf(stops[i]);
            var a = document.createElement('a');
            a.className = 'jn-stop';
            a.href = '#' + stops[i].id;
            a.setAttribute('aria-label', labels[i]);
            a.style.setProperty('--jn-i', String(i));
            a.innerHTML = '<span class="jn-dot"></span><span class="jn-tip" aria-hidden="true"></span>';
            a.lastChild.textContent = labels[i];
            rail.appendChild(a);
            stopEls.push(a);
        }
        path.appendChild(rail);
        navbar.appendChild(path);

        /* live region */
        var live = document.createElement('div');
        live.className = 'jn-live';
        live.setAttribute('aria-live', 'polite');
        live.setAttribute('aria-atomic', 'true');
        document.body.appendChild(live);

        if (controls) { makeToggle(false); }

        function setCurrent(i) {
            if (i === current) { return; }
            current = i;
            for (var k = 0; k < n; k++) {
                stopEls[k].classList.toggle('jn-passed', k < i);
                if (k === i) { stopEls[k].setAttribute('aria-current', 'true'); }
                else { stopEls[k].removeAttribute('aria-current'); }
            }
        }

        /* the arrived stop's heading (the card's h2, the hero's h1, else the card
           itself) takes focus unless focus is already inside the panel — Tab
           travelling into it must not be bounced back to the heading. The focus
           ring only shows when the trip was driven from the keyboard */
        function focusHeading(stop) {
            var scope = stop.card || stop.el;
            var el = scope.querySelector('h1, h2, h3') || stop.card;
            if (!el || stop.el.contains(document.activeElement)) { return; }
            if (!el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '-1'); }
            el.setAttribute('data-jn-focus', '');
            el.classList.toggle('jn-ring', byKeyboard);
            try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
        }

        function onKeyDown() { byKeyboard = true; }
        function onPointer() { byKeyboard = false; }

        function onArrive(e) {
            var d = e.detail;
            setCurrent(d.index);
            if (d.initial || !journey.active) { return; }
            live.textContent = 'Arrived at ' + labels[d.index] + ', ' + (d.index + 1) + ' of ' + n;
            if (journey.mode === 'h') { focusHeading(stops[d.index]); }
        }

        /* Tab into a panel that is not on screen → fly there */
        function onFocusIn(e) {
            if (!journey.active || journey.mode !== 'h') { return; }
            var panel = closest(e.target, '.panel');
            if (!panel) { return; }
            for (var k = 0; k < n; k++) {
                if (stops[k].el === panel) {
                    if (k !== journey.index) { journey.goTo(k); }
                    return;
                }
            }
        }

        function onStopClick(e) {
            if (!journey.active || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
            var a = closest(e.target, '.jn-stop');
            if (!a) { return; }
            e.preventDefault();
            journey.goTo(stopEls.indexOf(a));
        }

        /* h: the fill follows --journey-p (1/6 per stop). v: stops are not evenly
           spaced in scroll space, so interpolate between the stops' tops so the
           fill still ends on the current dot at rest */
        function onProgress() {
            if (journey.mode !== 'v') {
                if (path.style.getPropertyValue('--jn-p')) { path.style.removeProperty('--jn-p'); }
                return;
            }
            var y = window.pageYOffset;
            var maxY = Math.max(1, Math.max(root.scrollHeight, document.body.scrollHeight) - window.innerHeight);
            var last = n - 1;
            var prev = 0;
            var p = 1;
            for (var k = 1; k <= last; k++) {
                var anchor = k === last ? maxY : Math.min(maxY, stops[k].el.offsetTop - NAV_H);
                if (y < anchor) {
                    p = (k - 1 + (anchor > prev ? (y - prev) / (anchor - prev) : 1)) / last;
                    break;
                }
                prev = anchor;
            }
            path.style.setProperty('--jn-p', Math.max(0, Math.min(1, p)).toFixed(4));
        }

        setCurrent(journey.index);
        onProgress();
        path.addEventListener('click', onStopClick);
        document.addEventListener('journey:arrive', onArrive);
        document.addEventListener('journey:progress', onProgress);
        document.addEventListener('journey:modechange', onProgress);
        document.addEventListener('focusin', onFocusIn);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pointerdown', onPointer, true);
        window.addEventListener('wheel', onPointer, { capture: true, passive: true });
    }

    /* ---- plain page: offer the way back for visitors who chose the list ---- */
    function initPlain() {
        if (!controls || storage(function (ls) { return ls.getItem('layout'); }) !== 'list') { return; }
        var mqJourney = window.matchMedia(JOURNEY_MQ);
        var mqReduced = window.matchMedia(REDUCED_MQ);
        var btn = makeToggle(true);
        function update() { btn.hidden = !mqJourney.matches || mqReduced.matches; }
        update();
        listen(mqJourney, update);
        listen(mqReduced, update);
    }

    if (window.journey && window.journey.active) {
        initJourney();
    } else {
        document.addEventListener('journey:ready', initJourney);
        initPlain();
    }
})();
