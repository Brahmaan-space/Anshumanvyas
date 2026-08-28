/* Slim entry for interior pages. No WebGL: a 2D starfield behind the content,
   scroll reveals, and a reading-progress rail. Keeps project pages light. */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------- starfield */
(function sky() {
  const cv = document.getElementById('sky');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, stars = [], t = 0, raf = null;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = [];
    const n = Math.min(420, Math.round(W * H / 5600));
    for (let i = 0; i < n; i++) {
      const layer = i % 3;
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: [0.6, 0.95, 1.4][layer] * (0.7 + Math.random() * 0.6),
        a: [0.18, 0.34, 0.6][layer] * (0.6 + Math.random() * 0.5),
        ph: Math.random() * 6.283,
        sp: 0.4 + Math.random() * 0.9
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = reduce ? 1 : 0.78 + 0.22 * Math.sin(t * 0.02 * s.sp + s.ph);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = '#E8EDF7';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function loop() { t += 1; draw(); raf = requestAnimationFrame(loop); }

  window.addEventListener('resize', () => { fit(); draw(); }, { passive: true });
  fit();
  if (reduce) draw();
  else loop();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
    else if (!document.hidden && !raf && !reduce) loop();
  });
})();

/* ------------------------------------------------------------- reveals */
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
  document.querySelectorAll('[data-rev]').forEach((el) => io.observe(el));
} else {
  document.querySelectorAll('[data-rev]').forEach((el) => el.classList.add('in'));
}

/* --------------------------------------------- reading progress + section rail */
(function rail() {
  const bar = document.getElementById('progress');
  const links = Array.from(document.querySelectorAll('.toc a'));
  const secs = links.map((l) => document.querySelector(l.getAttribute('href'))).filter(Boolean);
  let raf = 0;

  function place() {
    raf = 0;
    if (bar) {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(1, window.scrollY / h) * 100 : 0).toFixed(2) + '%';
    }
    let active = -1;
    const line = window.innerHeight * 0.34;
    for (let i = 0; i < secs.length; i++) {
      if (secs[i].getBoundingClientRect().top <= line) active = i;
    }
    links.forEach((l, i) => l.classList.toggle('on', i === active));
  }

  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(place); }, { passive: true });
  window.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(place); }, { passive: true });
  place();
})();

/* ------------------------------------------- embedded mission viewer, if any */
// An IntersectionObserver inside an iframe only sees the iframe's own viewport,
// so the viewer cannot tell whether it is on screen. The parent watches for it
// and posts the answer in.
(function viewerVisibility() {
  const frame = document.getElementById('mission-viewer');
  if (!frame) return;

  let sent = null;
  function tell(visible) {
    if (visible === sent) return;
    sent = visible;
    try {
      frame.contentWindow.postMessage({ type: 'viewer-visibility', visible: visible }, '*');
    } catch (e) { /* not loaded yet; the load handler below retries */ }
  }

  function onScreen() {
    const r = frame.getBoundingClientRect();
    return r.bottom > window.innerHeight * 0.15 && r.top < window.innerHeight * 0.85;
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (es) => es.forEach((e) => tell(e.isIntersecting)),
      { threshold: 0.3 }
    ).observe(frame);
  } else {
    window.addEventListener('scroll', () => tell(onScreen()), { passive: true });
  }

  // Lazy-loaded, so the first message can land before there is anything to
  // receive it. Repeat the current state once the document is actually there.
  frame.addEventListener('load', () => { sent = null; tell(onScreen()); });
})();
