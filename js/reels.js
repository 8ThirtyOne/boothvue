// Sample reels: each card plays the BoothVue story for one booth, 3D design, then AI image, then the 10-second AI video.
// Cards only load and play while on screen.
(() => {
  const cards = [...document.querySelectorAll('.reel-card')]; if (!cards.length) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  cards.forEach(card => {
    const imgs = card.querySelectorAll('.reel-img'), v = card.querySelector('video'), stage = card.querySelector('.reel-stage');
    const s3d = imgs.length > 1 ? imgs[0] : null, sAi = imgs[imgs.length - 1], n = s3d ? 1 : 0;   // a card without a 3D frame starts at the AI image
    if (still) { sAi.classList.add('on'); stage.textContent = 'AI image'; return; }
    let visible = false, running = false;
    const label = t => { stage.textContent = t; };
    async function loop() {
      if (running) return; running = true;
      while (visible) {
        v.classList.remove('on'); v.pause();
        if (s3d) { sAi.classList.remove('on'); s3d.classList.add('on'); label('1 · 3D design'); await wait(2400); if (!visible) break; }
        sAi.classList.add('on'); label(`${n + 1} · AI image`); v.preload = 'auto';
        await wait(2600); if (!visible) break;
        label(`${n + 2} · 10-sec AI video`); v.currentTime = 0;
        try { await v.play(); v.classList.add('on'); } catch { await wait(3000); continue; }
        await new Promise(r => { v.onended = r; const t = setInterval(() => { if (!visible) { clearInterval(t); r(); } }, 400); v.addEventListener('ended', () => clearInterval(t), { once: true }); });
      }
      v.pause(); running = false;
    }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }, { threshold: 0.35 }).observe(card);
  });
})();
