// Interactive hero background: a field of dots that ripples on its own, bends away from the pointer,
// lights up and links together near it, and sends out a ring when you click or tap.
(() => {
  const hero = document.querySelector(".page-hero[data-fx]"); if (!hero) return;
  const cv = document.createElement("canvas"); cv.className = "hero-fx"; cv.setAttribute("aria-hidden", "true"); hero.prepend(cv);
  const ctx = cv.getContext("2d"), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GAP = 34, R = 170; let w = 0, h = 0, dpr = 1, cols = 0, rows = 0, px = -9999, py = -9999, tx = -9999, ty = -9999, rings = [], raf = 0, seen = true;
  const size = () => { const r = hero.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cols = Math.ceil(w / GAP) + 2; rows = Math.ceil(h / GAP) + 2; if (still) draw(0); };
  const at = e => { const r = hero.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return [p.clientX - r.left, p.clientY - r.top]; };
  hero.addEventListener("pointermove", e => { [tx, ty] = at(e); if (px < -999) { px = tx; py = ty; } });
  hero.addEventListener("pointerleave", () => { tx = ty = -9999; });
  hero.addEventListener("pointerdown", e => { const [x, y] = at(e); rings.push({ x, y, t: performance.now() }); if (rings.length > 6) rings.shift(); });
  function draw(now) {
    const t = now / 1000; ctx.clearRect(0, 0, w, h);
    if (tx > -999) { px += (tx - px) * .16; py += (ty - py) * .16; } else px = py = -9999;
    rings = rings.filter(r => now - r.t < 1800);
    const pts = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let x = (i - .5) * GAP, y = (j - .5) * GAP, glow = 0;
      const wave = Math.sin(x * .012 + t * .9) + Math.cos(y * .016 - t * .7 + x * .004);     // idle ripple
      y += wave * 3.2; glow += Math.max(0, wave) * .12;
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      if (d < R) { const f = (1 - d / R) ** 2; x += (dx / (d || 1)) * f * 26; y += (dy / (d || 1)) * f * 26; glow += f * 1.1; }
      for (const r of rings) { const age = (now - r.t) / 1800, rad = age * 520, dd = Math.abs(Math.hypot(x - r.x, y - r.y) - rad); if (dd < 46) { const f = (1 - dd / 46) * (1 - age); glow += f * 1.2; y -= f * 9; } }
      pts.push(x, y, glow);
    }
    // links between lit neighbours
    ctx.lineWidth = 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3, g = pts[k + 2]; if (g < .25) continue;
      for (const n of [i + 1 < cols ? k + 3 : -1, j + 1 < rows ? k + cols * 3 : -1]) { if (n < 0) continue; const a = Math.min(g, pts[n + 2]); if (a < .2) continue;
        ctx.strokeStyle = `rgba(143,182,255,${Math.min(.75, a * .7)})`; ctx.beginPath(); ctx.moveTo(pts[k], pts[k + 1]); ctx.lineTo(pts[n], pts[n + 1]); ctx.stroke(); }
    }
    for (let k = 0; k < pts.length; k += 3) { const g = Math.min(1.4, pts[k + 2]);
      ctx.fillStyle = g > .5 ? `rgba(${200 + g * 40 | 0},${220 + g * 25 | 0},255,${Math.min(1, .35 + g * .6)})` : `rgba(143,182,255,${.16 + g * .5})`;
      ctx.beginPath(); ctx.arc(pts[k], pts[k + 1], 1.1 + g * 1.9, 0, 6.283); ctx.fill(); }
    if (px > -999) { const sp = ctx.createRadialGradient(px, py, 0, px, py, 260); sp.addColorStop(0, "rgba(79,140,255,.22)"); sp.addColorStop(1, "rgba(79,140,255,0)"); ctx.fillStyle = sp; ctx.fillRect(px - 260, py - 260, 520, 520); }
    if (!still && seen) raf = requestAnimationFrame(draw);
  }
  addEventListener("resize", size); size();
  if (!still) { new IntersectionObserver(es => { const v = es[0].isIntersecting; if (v && !seen) { seen = true; raf = requestAnimationFrame(draw); } seen = v; }).observe(hero); raf = requestAnimationFrame(draw); }
  // The picture leans toward the pointer
  const art = hero.querySelector(".page-hero-art img, .page-hero-art video");
  if (art && !still) hero.addEventListener("pointermove", e => { const r = hero.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width - .5, ny = (e.clientY - r.top) / r.height - .5; art.style.transform = `perspective(1400px) rotateY(${-7 + nx * 10}deg) rotateX(${2 - ny * 8}deg) translateZ(0)`; });
})();
