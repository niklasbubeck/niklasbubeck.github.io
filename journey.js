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
