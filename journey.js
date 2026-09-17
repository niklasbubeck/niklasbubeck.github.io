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
    /* threshold 40: a Firefox pixel-mode notch is ~48-57px; trackpad tails stay
       below it. `lock` is only long enough to stop one notch firing twice — a
       trackpad's momentum tail is held off by `quiet` instead, which waits for
       the wheel to actually stop rather than for a fixed time to elapse. That
       is what keeps a deliberate second scroll responsive: the old fixed 850ms
       lock swallowed it, so the page felt like it was ignoring you. */
    var WHEEL = { tail: 4, threshold: 40, lock: 180, arm: 180, decay: 200, quiet: 120 };
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
    var resizeTimer = 0;
    var rafId = 0;
    var lastPos = -1;
    var vel = 0;
    var lockUntil = 0;
    var edgeArmedUntil = 0;
    var acc = 0;
    var lastWheelAt = 0;
    var quietUntil = 0;   /* a gesture is still running: wait for it to stop */
    var quietTimer = 0;

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
        sky.innerHTML = '<div class="journey-sky-base"></div>' +
                        '<div class="journey-sky-far"><canvas class="journey-stars"></canvas></div>' +
                        '<div class="journey-sky-near"><canvas class="journey-stars"></canvas></div>';
        document.body.insertBefore(sky, document.body.firstChild);
        paintSky();
    }

    /* ---- the starfield ----------------------------------------------------
       Painted once into two canvases instead of tiling a five-dot gradient:
       the old sky repeated its ten stars about 150 times per screen in two
       square grids, which is what made it read as wallpaper. Each layer is
       wider (taller, on phones) than the viewport by its parallax range, so
       travelling uncovers sky you have not seen rather than resliding the
       same stars. Seeded, so a resize repaints the same sky.             */

    function rng(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    /* far: many small dim stars, moves least. near: fewer, bigger, brighter. */
    var SKY_LAYERS = [
        { sel: '.journey-sky-far', seed: 0x51AB3, over: 0.34, per: 2600, rMin: 0.32, rMax: 1.05, aMin: 0.16, aMax: 0.62 },
        { sel: '.journey-sky-near', seed: 0xB0A7E, over: 0.70, per: 6200, rMin: 0.45, rMax: 1.70, aMin: 0.35, aMax: 1.00 }
    ];

    function paintSky() {
        if (!sky) { return; }
        var horizontal = mode === 'h';
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        for (var i = 0; i < SKY_LAYERS.length; i++) {
            var spec = SKY_LAYERS[i];
            var layer = sky.querySelector(spec.sel);
            var canvas = layer ? layer.firstElementChild : null;
            if (!canvas || !canvas.getContext) { continue; }
            /* the layer overhangs the viewport along the direction of travel */
            var w = Math.ceil(horizontal ? vw * (1 + spec.over) : vw);
            var h = Math.ceil(horizontal ? vh : vh * (1 + spec.over * 0.5));
            layer.style.width = w + 'px';
            layer.style.height = h + 'px';
            layer.style.setProperty('--sky-shift', -(horizontal ? w - vw : h - vh) + 'px');
            paintField(canvas, w, h, spec, horizontal);
        }
        seedTwinkles();
    }

    /* Eight stars that breathe. Anything more and the page never idles; this
       is cheap (opacity only) and it keeps the sky from looking like a print. */
    function seedTwinkles() {
        var near = sky.querySelector('.journey-sky-near');
        if (!near) { return; }
        var old = near.querySelectorAll('.journey-twinkle');
        for (var k = 0; k < old.length; k++) { old[k].remove(); }
        var rnd = rng(0x7C1A9);
        for (var i = 0; i < 8; i++) {
            var dot = document.createElement('span');
            dot.className = 'journey-twinkle';
            dot.style.left = (rnd() * 96 + 2).toFixed(2) + '%';
            dot.style.top = (rnd() * 92 + 4).toFixed(2) + '%';
            dot.style.animationDuration = (4.5 + rnd() * 5).toFixed(1) + 's';
            dot.style.animationDelay = (-rnd() * 8).toFixed(1) + 's';
            near.appendChild(dot);
        }
    }

    function paintField(canvas, w, h, spec, horizontal) {
        var ctx = canvas.getContext('2d');
        canvas.width = w;
        canvas.height = h;
        var rnd = rng(spec.seed);

        /* a soft galactic band on a slow diagonal, so the field has structure
           the eye can read as depth instead of uniform noise */
        var bandAt = function (x) { return h * (0.28 + 0.34 * (x / w)); };
        var sigma = h * 0.17;
        ctx.globalCompositeOperation = 'lighter';
        for (var k = 0; k < 9; k++) {
            var bx = (k + 0.5) / 9 * w;
            var by = bandAt(bx) + (rnd() - 0.5) * h * 0.1;
            var rad = h * (0.30 + rnd() * 0.22);
            var g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
            g.addColorStop(0, 'rgba(152, 170, 214, 0.045)');
            g.addColorStop(1, 'rgba(152, 170, 214, 0)');
            ctx.save();
            ctx.translate(bx, by);
            ctx.scale(1.9, 0.55);
            ctx.translate(-bx, -by);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(bx, by, rad, 0, 6.2832);
            ctx.fill();
            ctx.restore();
        }
        ctx.globalCompositeOperation = 'source-over';

        var count = Math.round(w * h / spec.per);
        for (var n = 0; n < count; n++) {
            var x = rnd() * w;
            var y = rnd() * h;
            /* thinning out as the trip leaves the inner system behind */
            var t = horizontal ? x / w : y / h;
            var band = Math.exp(-Math.pow((y - bandAt(x)) / sigma, 2));
            if (rnd() > (1 - 0.45 * t) * (0.5 + 0.7 * band)) { continue; }

            var u = rnd();
            var r = spec.rMin + Math.pow(u, 3) * (spec.rMax - spec.rMin);
            var a = spec.aMin + rnd() * (spec.aMax - spec.aMin);
            var c = rnd();
            var col = c < 0.07 ? '255, 214, 170' : c < 0.13 ? '188, 212, 255' : '255, 251, 244';

            if (u > 0.988) { /* the handful of bright ones carry a small halo */
                var hr = r * 6;
                var hg = ctx.createRadialGradient(x, y, 0, x, y, hr);
                hg.addColorStop(0, 'rgba(' + col + ', ' + (a * 0.32).toFixed(3) + ')');
                hg.addColorStop(1, 'rgba(' + col + ', 0)');
                ctx.fillStyle = hg;
                ctx.beginPath();
                ctx.arc(x, y, hr, 0, 6.2832);
                ctx.fill();
                r *= 1.5;
                a = Math.min(1, a * 1.3);
            }
            ctx.fillStyle = 'rgba(' + col + ', ' + a.toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 6.2832);
            ctx.fill();
        }
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

    /* ---- keep only the visible embeds alive --------------------------------
       The publication slides embed a PDF viewer each and the project slides
       embed the project's own live site — twelve nested documents, every one
       with its own style engine, layers and scripts. `loading="lazy"` defers
       them, but in a horizontal track every panel sits within a viewport of
       the fold, so they all wake and then stay awake. This parks the src of
       any embed that is not on screen and restores it when it scrolls back. */
    function tameFrames() {
        if (!window.IntersectionObserver) { return; }
        var frames = document.querySelectorAll('.publications-viewport iframe, .github-projects-viewport iframe');
        for (var k = 0; k < frames.length; k++) {
            var f = frames[k];
            if (f.getAttribute('data-tamed')) { continue; }
            f.setAttribute('data-tamed', '1');
            var scroller = closest(f, '.publications-viewport, .github-projects-viewport');
            new IntersectionObserver(onFrameSeen, { root: scroller, threshold: 0.01 }).observe(f);
        }
    }

    function onFrameSeen(entries) {
        for (var k = 0; k < entries.length; k++) {
            entries[k].target.__inCarousel = entries[k].isIntersecting;
            applyFrame(entries[k].target);
        }
    }

    /* live only when it is both the carousel's current slide and on the planet
       you are actually standing on, so reading About runs no PDF viewer and no
       embedded site at all */
    function applyFrame(f) {
        var panel = closest(f, '.panel');
        var here = panel && stops[journey.index] && stops[journey.index].el === panel;
        if (f.__inCarousel && here) {
            var parked = f.getAttribute('data-src');
            if (parked) {
                f.removeAttribute('data-src');
                f.src = parked;
            }
        } else if (f.src && f.src !== 'about:blank') {
            f.setAttribute('data-src', f.src);
            f.src = 'about:blank';
        }
    }

    function applyFrames() {
        tameFrames();
        var frames = document.querySelectorAll('.publications-viewport iframe, .github-projects-viewport iframe');
        for (var k = 0; k < frames.length; k++) { applyFrame(frames[k]); }
    }

    /* ---- the dark forest ---------------------------------------------------
       Ten seconds without a touch and the stars go out, because the ones still
       shining are the ones that have not learned to hide yet. Any input at all
       brings them back. Only the sky dims — the cards you are reading do not. */
    var FOREST_MS = 10000;
    var forestTimer = 0;
    var forestArmedAt = 0;
    var forest = null;

    function buildForest() {
        forest = document.createElement('p');
        forest.className = 'journey-forest';
        forest.setAttribute('aria-hidden', 'true');
        forest.textContent = 'The universe is a dark forest.';
        document.body.appendChild(forest);
    }

    function enterForest() {
        forestTimer = 0;
        if (journey.active) { root.classList.add('journey-dark'); }
    }

    function stirForest() {
        if (root.classList.contains('journey-dark')) {
            root.classList.remove('journey-dark');
        }
        /* pointermove fires per frame: only re-arm the timer a few times a second */
        var t = stamp();
        if (forestTimer && t - forestArmedAt < 400) { return; }
        forestArmedAt = t;
        clearTimeout(forestTimer);
        forestTimer = setTimeout(enterForest, FOREST_MS);
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
            flyTo(i * track.clientWidth, instant);
        } else if (instant) {
            jumpWindow(Math.max(0, stops[i].el.offsetTop - NAV_H));
        } else {
            window.scrollTo({ top: Math.max(0, stops[i].el.offsetTop - NAV_H), behavior: 'smooth' });
        }
        armSettle();
    }

    /* The browser's own smooth scroll takes ~700ms to cross a panel, which is
       most of what made travelling feel heavy. This tween is ~400ms and can be
       re-aimed mid-flight, so a second gesture redirects the trip instead of
       queueing behind it. Snapping is suspended while it runs — otherwise the
       snap container fights every frame we set scrollLeft — and restored at the
       end, which also re-snaps if the tween is interrupted. */
    var FLY_MS = 400;
    var fly = null;

    function flyTo(left, instant) {
        var from = track.scrollLeft;
        var max = track.scrollWidth - track.clientWidth;
        var to = Math.max(0, Math.min(max, left));
        if (instant || Math.abs(to - from) < 2 || mqReduced.matches) {
            endFly();
            track.scrollLeft = to;
            return;
        }
        if (!fly) { track.style.scrollSnapType = 'none'; }
        fly = { from: from, to: to, t0: stamp(), raf: fly ? fly.raf : 0 };
        if (!fly.raf) { fly.raf = requestAnimationFrame(flyStep); }
    }

    function flyStep() {
        if (!fly) { return; }
        var k = Math.min(1, (stamp() - fly.t0) / FLY_MS);
        var e = 1 - Math.pow(1 - k, 3);   /* ease-out cubic */
        track.scrollLeft = fly.from + (fly.to - fly.from) * e;
        if (k < 1) {
            fly.raf = requestAnimationFrame(flyStep);
        } else {
            endFly();
        }
    }

    function endFly() {
        if (fly) {
            cancelAnimationFrame(fly.raf);
            fly = null;
            track.style.scrollSnapType = '';
        }
    }

    function stamp() {
        return window.performance && performance.now ? performance.now() : Date.now();
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
        /* after a page, ignore the rest of this gesture: every further event
           pushes the quiet deadline out, so the momentum tail never pages
           again, but a real pause of `quiet` ms hands control straight back */
        if (quietUntil) {
            e.preventDefault();
            quietUntil = now + WHEEL.quiet;
            clearTimeout(quietTimer);
            quietTimer = setTimeout(releaseWheel, WHEEL.quiet);
            return;
        }
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
            quietUntil = now + WHEEL.quiet;
            clearTimeout(quietTimer);
            quietTimer = setTimeout(releaseWheel, WHEEL.quiet);
            acc = 0;
        }
    }

    function releaseWheel() {
        quietTimer = 0;
        quietUntil = 0;
        acc = 0;
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
            paintSky();
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
            paintSky();
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
    track.addEventListener('touchstart', endFly, { passive: true });
    buildForest();
    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin'].forEach(function (evt) {
        window.addEventListener(evt, stirForest, { passive: true });
    });
    track.addEventListener('scroll', stirForest, { passive: true });
    window.addEventListener('scroll', stirForest, { passive: true });
    stirForest();
    /* the carousels render after their fetches, so watch for the embeds arriving */
    if (window.MutationObserver) {
        new MutationObserver(tameFrames).observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('journey:arrive', applyFrames);
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
    /* The waypoints sit on an arc rather than being scattered freely: a path
       that doubles back turns through 100 degrees at the hairpin however well
       you spline it. Sweeping from beside the Earth up and over to the left
       keeps every turn gentle while still putting each planet's rocket in a
       clearly different place. `a` is the parked angle only — in flight the
       nose follows the path. */
    var STOP_POSES = [
        null,                             /* Earth: parked (measured) */
        { x: 0.573, y: 0.774, a: 65 },    /* Mars */
        { x: 0.787, y: 0.666, a: 65 },    /* Jupiter */
        { x: 0.879, y: 0.467, a: 65 },    /* Saturn */
        { x: 0.811, y: 0.261, a: 65 },    /* Uranus */
        { x: 0.611, y: 0.134, a: 65 },    /* Neptune */
        { x: 0.364, y: 0.142, a: 65 }     /* Beyond */
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
    var lastAngle = 0;    /* keeps the nose from spinning the long way round */
    var heading = 1;      /* +1 outbound, -1 heading home */
    var prevP = -1;       /* place() gets called with lastP already updated */
    var turnRaf = 0;
    var resizeTimer = 0;

    /* ---- helpers ---- */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /* smootherstep: the rocket leaves and reaches each pose at rest */
    function ease(t) {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
    }

    /* ---- the flight path -------------------------------------------------
       The stop poses are waypoints, not corners: the rocket follows a
       cubic Hermite spline through them, so it banks through each planet
       instead of turning on the spot. The nose follows the tangent, so it
       always flies forwards. */

    var PATH_TENSION = 0.42;   /* 0.5 is plain Catmull-Rom; lower keeps the arcs tighter */

    /* Cubic Hermite with shared tangents at the knots. Catmull-Rom's centripetal
       form is smoother as a shape, but it is only C1 in its own knot spacing —
       driven by scroll position it kinks by ~95 degrees as it crosses a waypoint.
       Sharing one tangent per waypoint makes the curve C1 in the parameter we
       actually drive, so the rocket banks through each planet continuously. */
    function tangentAt(pts, i) {
        var prev = pts[Math.max(0, i - 1)];
        var next = pts[Math.min(pts.length - 1, i + 1)];
        var k = (i === 0 || i === pts.length - 1) ? 1 : PATH_TENSION;
        return { x: (next.x - prev.x) * k, y: (next.y - prev.y) * k };
    }

    function crAt(pts, i, u) {
        var p1 = pts[i];
        var p2 = pts[Math.min(pts.length - 1, i + 1)];
        var m1 = tangentAt(pts, i);
        var m2 = tangentAt(pts, Math.min(pts.length - 1, i + 1));
        var u2 = u * u;
        var u3 = u2 * u;
        var h00 = 2 * u3 - 3 * u2 + 1;
        var h10 = u3 - 2 * u2 + u;
        var h01 = -2 * u3 + 3 * u2;
        var h11 = u3 - u2;
        return {
            x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
            y: h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y
        };
    }

    /* s runs 0..legs across the whole trip */
    function pathAt(pts, s) {
        var legs = pts.length - 1;
        s = Math.max(0, Math.min(legs, s));
        var i = Math.min(legs - 1, Math.floor(s));
        return crAt(pts, i, s - i);
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
        /* which way are we actually going? scrolling back turns the ship round */
        if (prevP >= 0 && Math.abs(p - prevP) > 0.0004) { heading = p > prevP ? 1 : -1; }
        prevP = p;
        if (mode === 'h') {
            var pts = [];
            for (var k = 0; k < STOP_POSES.length; k++) { pts.push(poseAt(k)); }
            var legs = Math.max(1, pts.length - 1);
            var s = Math.max(0, Math.min(legs, p * legs));
            var at = pathAt(pts, s);
            x = at.x;
            y = at.y;
            /* nose along the path: sample a little either side and take the heading */
            var step = 0.015;
            var back = pathAt(pts, s - step);
            var fwd = pathAt(pts, s + step);
            var dx = fwd.x - back.x;
            var dy = fwd.y - back.y;
            a = Math.hypot(dx, dy) < 0.05 ? lastAngle
                : Math.atan2(dy, dx) * 180 / Math.PI + 90;
            /* the tangent always points up-trip, so flip it when flying home */
            if (heading < 0) { a += 180; }
            /* it leaves the pad upright and rolls onto its heading as it climbs —
               and rolls back upright on the way down, however it arrives */
            if (p < LAUNCH_END) { a = lerp(poseAt(0).a, shortOf(a, poseAt(0).a), ease(p / LAUNCH_END)); }
            a = turnTowards(a);
        } else {
            x = 0;
            y = geo.vh * lerp(V_TOP, V_BOTTOM, p);
            a = turnTowards(heading < 0 ? 0 : 180);  /* nose down going out, up coming back */
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

    /* Bring `a` into the half-turn nearest `ref`, so no rotation takes the long
       way round the dial. */
    function shortOf(a, ref) {
        while (a - ref > 180) { a -= 360; }
        while (ref - a > 180) { a += 360; }
        return a;
    }

    /* Ease onto the heading instead of snapping to it: a reversal is a 180
       degree turn, and the ship should be seen to make it. Scrolling can stop
       mid-turn, so this keeps its own frames coming until it has settled. */
    function turnTowards(target) {
        target = shortOf(target, lastAngle);
        var d = target - lastAngle;
        lastAngle += d * 0.2;
        if (Math.abs(d) > 0.4) {
            if (!turnRaf) {
                turnRaf = requestAnimationFrame(function () {
                    turnRaf = 0;
                    if (journey.active) { place(lastP, journey.mode); }
                });
            }
        }
        return lastAngle;
    }

    /* ---- the pilot's call sign ---------------------------------------------
       The rocket flies behind the glass with pointer-events off, so nothing can
       hover it in the usual way. Instead the pointer's distance to its current
       box is checked on a rAF tick, and the label is placed beside the nose.
       Decorative and aria-hidden; it hides itself while the rocket is moving. */
    var CALL_SIGN = 'ROCINANTE';
    var sign = null;
    var pointer = null;
    var signRaf = 0;

    function buildSign() {
        sign = document.createElement('span');
        sign.className = 'jr-callsign';
        sign.setAttribute('aria-hidden', 'true');
        sign.textContent = CALL_SIGN;
        document.body.appendChild(sign);
    }

    function onPointer(e) {
        pointer = { x: e.clientX, y: e.clientY };
        if (!signRaf) { signRaf = requestAnimationFrame(checkSign); }
    }

    function checkSign() {
        signRaf = 0;
        if (!sign || !pointer || !journey.active || journey.mode !== 'h') { return; }
        var r = pilot.getBoundingClientRect();
        var pad = 14;
        var near = pointer.x > r.left - pad && pointer.x < r.right + pad &&
                   pointer.y > r.top - pad && pointer.y < r.bottom + pad;
        if (near && !pilot.classList.contains('is-tucked')) {
            sign.style.left = Math.round(r.left + r.width / 2) + 'px';
            sign.style.top = Math.round(r.bottom + 10) + 'px';
            sign.classList.add('is-shown');
        } else {
            sign.classList.remove('is-shown');
        }
    }

    function hideSign() {
        if (sign) { sign.classList.remove('is-shown'); }
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
        if (e && e.detail && e.detail.v > 0.4) { hideSign(); }
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
    buildSign();
    window.addEventListener('pointermove', onPointer, { passive: true });
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
    /* Pluto carries its heart — Tombaugh Regio, the nitrogen-ice plain — and
       Charon, which is half its size, so the pair orbit a point outside Pluto
       itself. It is small on purpose: at this stop, that is the point. */
    var PLUTO = '<div class="jp-disc"><span class="jp-heart"></span></div>' + moon('charon');

    /* The Kuiper belt as the near half of a ring: a scattered arc of icy rocks
       below Pluto, seeded so it is the same belt on every repaint. */
    function prng(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function kuiper(count) {
        var rnd = prng(0x4B1E5);
        var html = '';
        for (var i = 0; i < count; i++) {
            var th = Math.PI * (i + rnd() * 0.7) / count;   /* 0..180deg: the near half */
            var spread = 1 + (rnd() - 0.5) * 0.17;          /* a band, not a wire */
            var x = 48 + 47 * Math.cos(th) * spread;
            var y = 66 + 21 * Math.sin(th) * spread;
            var w = 2 + Math.pow(rnd(), 2.2) * 7;
            var h = w * (0.55 + rnd() * 0.5);
            var fade = Math.sin(th);                        /* the ends of the arc trail off */
            var a = (0.28 + rnd() * 0.55) * (0.4 + 0.6 * fade);
            var tone = rnd();
            var col = tone < 0.18 ? '196, 186, 206' : tone < 0.4 ? '208, 186, 164' : '198, 194, 188';
            html += '<span class="jp-rock" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) +
                '%;width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) +
                'px;opacity:' + a.toFixed(2) +
                ';background:rgb(' + col + ')' +
                ';border-radius:' + (35 + rnd() * 30).toFixed(0) + '% ' + (40 + rnd() * 30).toFixed(0) + '% ' +
                (35 + rnd() * 30).toFixed(0) + '% ' + (45 + rnd() * 30).toFixed(0) + '% / ' +
                (40 + rnd() * 25).toFixed(0) + '% ' + (35 + rnd() * 30).toFixed(0) + '% ' +
                (45 + rnd() * 25).toFixed(0) + '% ' + (40 + rnd() * 30).toFixed(0) + '%' +
                ';transform:rotate(' + (rnd() * 180).toFixed(0) + 'deg)"></span>';
        }
        /* one rock is not a rock: the OPA's split circle, turning very slowly */
        html += '<span class="jp-opa"></span>';
        return '<div class="jp-belt-hit" aria-hidden="true"></div>' +
               '<div class="jp-kuiper">' + html + '</div>';
    }

    /* The droplet: Trisolaris's probe, a teardrop of strong-interaction matter
       polished to a perfect mirror. It hangs on the left of About, motionless,
       which is exactly what it does right up until it stops being motionless. */
    var DROPLET = '<div class="jp-droplet" aria-hidden="true">' +
        '<svg viewBox="0 0 132 56" width="132" height="56" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
        '<linearGradient id="jpDropSkin" x1="0.12" y1="0" x2="0.82" y2="1">' +
        '<stop offset="0" stop-color="#F4F7FA"/>' +
        '<stop offset="0.18" stop-color="#AEBECE"/>' +
        '<stop offset="0.44" stop-color="#4E5F74"/>' +
        '<stop offset="0.68" stop-color="#1E2836"/>' +
        '<stop offset="0.88" stop-color="#3B4B5F"/>' +
        '<stop offset="1" stop-color="#8CA0B4"/>' +
        '</linearGradient>' +
        '<radialGradient id="jpDropSpec" cx="0.5" cy="0.5" r="0.5">' +
        '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/>' +
        '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>' +
        '</radialGradient>' +
        '</defs>' +
        '<path d="M 130 28 C 100 9, 62 2, 28 2 A 26 26 0 1 0 28 54 C 62 54, 100 47, 130 28 Z" fill="url(#jpDropSkin)"/>' +
        '<ellipse cx="22" cy="17" rx="11" ry="6" fill="url(#jpDropSpec)"/>' +
        '<ellipse cx="74" cy="40" rx="20" ry="3" fill="#FFFFFF" opacity="0.13"/>' +
        '</svg></div>';

    /* James Webb, parked in the lower left of Research: eighteen gold segments
       over the five-layer sunshield, looking the other way. */
    var WEBB = '<div class="jp-webb" aria-hidden="true">' +
        '<svg viewBox="0 0 192 168" width="192" height="168" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
        '<linearGradient id="jwShield" x1="0" y1="0" x2="0.4" y2="1">' +
        '<stop offset="0" stop-color="#A7B0C6"/><stop offset="0.5" stop-color="#69728A"/>' +
        '<stop offset="1" stop-color="#3C4357"/></linearGradient>' +
        '<linearGradient id="jwGold" x1="0" y1="0" x2="0.6" y2="1">' +
        '<stop offset="0" stop-color="#F0C85A"/><stop offset="0.55" stop-color="#C79A2C"/>' +
        '<stop offset="1" stop-color="#8C6A1B"/></linearGradient>' +
        '</defs>' +
        /* five-layer sunshield, the kite it always flies behind */
        '<g opacity="0.9">' +
        '<path d="M 96 96 L 186 130 L 96 164 L 6 130 Z" fill="url(#jwShield)"/>' +
        '<path d="M 96 101 L 172 130 L 96 158 L 20 130 Z" fill="none" stroke="#C3CBDC" stroke-opacity="0.35" stroke-width="0.9"/>' +
        '<path d="M 96 108 L 156 130 L 96 151 L 36 130 Z" fill="none" stroke="#C3CBDC" stroke-opacity="0.28" stroke-width="0.9"/>' +
        '<path d="M 96 115 L 139 130 L 96 145 L 53 130 Z" fill="none" stroke="#C3CBDC" stroke-opacity="0.22" stroke-width="0.9"/>' +
        '</g>' +
        /* the boom out to the secondary */
        '<g stroke="#7E879B" stroke-width="1.4" fill="none">' +
        '<path d="M 70 34 L 96 6 L 122 34"/><path d="M 96 52 L 96 6"/>' +
        '</g>' +
        '<circle cx="96" cy="6" r="5.2" fill="#B9A46A" stroke="#6E6244" stroke-width="0.8"/>' +
        /* eighteen gold segments: an empty centre, a ring of six, a ring of twelve */
        '<g fill="url(#jwGold)" stroke="#6B5417" stroke-width="0.6">' +
        '<polygon points="86.8,58.1 95.4,63.0 95.4,72.8 86.8,77.8 78.3,72.8 78.3,63.0"/><polygon points="105.2,58.1 113.7,63.0 113.7,72.8 105.2,77.8 96.6,72.8 96.6,63.0"/><polygon points="114.4,42.1 122.9,47.1 122.9,56.9 114.4,61.9 105.8,56.9 105.8,47.1"/><polygon points="105.2,26.2 113.7,31.2 113.7,41.0 105.2,46.0 96.6,41.0 96.6,31.2"/><polygon points="86.8,26.2 95.4,31.2 95.4,41.0 86.8,46.0 78.3,41.0 78.3,31.2"/><polygon points="77.6,42.1 86.2,47.1 86.2,56.9 77.6,61.9 69.1,56.9 69.1,47.1"/><polygon points="77.6,74.0 86.2,78.9 86.2,88.7 77.6,93.6 69.1,88.7 69.1,78.9"/><polygon points="96.0,74.0 104.5,78.9 104.5,88.7 96.0,93.6 87.5,88.7 87.5,78.9"/><polygon points="114.4,74.0 122.9,78.9 122.9,88.7 114.4,93.6 105.8,88.7 105.8,78.9"/><polygon points="123.5,58.1 132.1,63.0 132.1,72.8 123.5,77.8 115.0,72.8 115.0,63.0"/><polygon points="132.7,42.1 141.2,47.1 141.2,56.9 132.7,61.9 124.2,56.9 124.2,47.1"/><polygon points="123.5,26.2 132.1,31.2 132.1,41.0 123.5,46.0 115.0,41.0 115.0,31.2"/><polygon points="114.4,10.4 122.9,15.3 122.9,25.1 114.4,30.1 105.8,25.1 105.8,15.3"/><polygon points="96.0,10.4 104.5,15.3 104.5,25.1 96.0,30.1 87.5,25.1 87.5,15.3"/><polygon points="77.6,10.4 86.2,15.3 86.2,25.1 77.6,30.1 69.1,25.1 69.1,15.3"/><polygon points="68.5,26.2 77.0,31.2 77.0,41.0 68.5,46.0 59.9,41.0 59.9,31.2"/><polygon points="59.3,42.1 67.8,47.1 67.8,56.9 59.3,61.9 50.8,56.9 50.8,47.1"/><polygon points="68.5,58.1 77.0,63.0 77.0,72.8 68.5,77.8 59.9,72.8 59.9,63.0"/>' +
        '</g>' +
        /* the aft optics housing that fills the array's empty middle */
        '<polygon points="96.0,43.0 103.8,47.5 103.8,56.5 96.0,61.0 88.2,56.5 88.2,47.5" fill="#22201C" stroke="#4A443A" stroke-width="0.6"/>' +
        '</svg>' + '</div>';

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
                if (s.planet === 'mars' && !s.el.querySelector('.jp-droplet')) {
                    s.el.insertAdjacentHTML('afterbegin', DROPLET);
                }
                if (s.planet === 'jupiter' && !s.el.querySelector('.jp-webb')) {
                    s.el.insertAdjacentHTML('afterbegin', WEBB);
                }
                if (!s.el.querySelector('.jp-planet')) {
                    var planet = document.createElement('div');
                    planet.className = 'jp-planet jp-' + s.planet;
                    planet.setAttribute('aria-hidden', 'true');
                    planet.innerHTML = '<div class="jp-body">' + PLANETS[s.planet] + '</div>';
                    s.el.insertBefore(planet, s.el.firstChild);
                }
                planetPanels.push(s.el);
            } else if (s.planet === 'beyond') {
                if (!s.el.querySelector('.jp-planet')) {
                    var far = document.createElement('div');
                    far.className = 'jp-planet jp-pluto';
                    far.setAttribute('aria-hidden', 'true');
                    far.innerHTML = kuiper(96) + '<div class="jp-body">' + PLUTO + '</div>';
                    s.el.insertBefore(far, s.el.firstChild);
                }
                planetPanels.push(s.el);
                var decor = s.el.querySelector('.beyond-decor');
                if (decor && !decor.firstElementChild) { decor.innerHTML = BEYOND; }
                bindBelt();
            }
        }
    }

    /* ---- Oye, beltalowda ---------------------------------------------------
       The Kuiper belt is the one place on the trip where a Belter joke is
       astronomically correct, so clicking it flips the last stop's captions
       into Creole and brings the rocks up. Decorative throughout: the whole
       block is aria-hidden, so nothing reaches a crawler or a screen reader. */
    var BELTER = {
        '.jp-caption': ['EARTH · 29 AU BEHIND YOU', 'OYE, BELTALOWDA!'],
        '.jp-motto': ['STILL REACHING', 'STILL REACHING · SASA KE?']
    };

    function speakBelter(on) {
        var belt = document.querySelector('#beyond .jp-kuiper');
        if (belt) { belt.classList.toggle('is-belter', on); }
        for (var sel in BELTER) {
            if (!BELTER.hasOwnProperty(sel)) { continue; }
            var el = document.querySelector('#beyond ' + sel);
            if (el) { el.textContent = BELTER[sel][on ? 1 : 0]; }
        }
    }

    function bindBelt() {
        var hit = document.querySelector('#beyond .jp-belt-hit');
        if (!hit || hit.getAttribute('data-bound')) { return; }
        hit.setAttribute('data-bound', '1');
        /* A pointer that can hover just sweeps over the belt; a finger taps it.
           Keyed off the pointer's own type rather than a (hover: hover) query,
           which some browsers answer wrongly for a plain mouse. */
        var kind = 'mouse';
        hit.addEventListener('pointerenter', function (e) {
            kind = e.pointerType || 'mouse';
            if (kind !== 'touch') { speakBelter(true); }
        });
        hit.addEventListener('pointerleave', function (e) {
            if ((e.pointerType || 'mouse') !== 'touch') { speakBelter(false); }
        });
        hit.addEventListener('click', function () {
            if (kind !== 'touch') { return; }
            var belt = document.querySelector('#beyond .jp-kuiper');
            speakBelter(!(belt && belt.classList.contains('is-belter')));
        });
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
