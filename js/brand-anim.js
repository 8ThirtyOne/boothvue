// Workflow page, step 1: a short looping demo of Brand From Your Website.
// The address types itself in, Get Brand presses, the brand fills in and the booth switches from plain to branded.
(() => {
  const card = document.querySelector('.ba-card'), media = card && card.closest('.walk-media'); if (!card) return;
  const type = card.querySelector('.ba-type'), go = card.querySelector('.ba-go'), rows = [...card.querySelectorAll('.ba-r')], after = media.querySelector('.ba-after');
  const text = type.dataset.text, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const end = () => { type.textContent = text; rows.forEach(r => r.classList.add('on')); after.classList.add('on'); };
  if (still) { end(); return; }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let running = false;
  async function loop() {
    if (running) return; running = true;
    while (running) {
      type.textContent = ''; go.classList.remove('press', 'busy'); rows.forEach(r => r.classList.remove('on')); after.classList.remove('on'); card.classList.remove('done');
      await wait(900);
      for (const ch of text) { type.textContent += ch; await wait(85); }
      await wait(450); go.classList.add('press'); await wait(220); go.classList.remove('press'); go.classList.add('busy');
      await wait(900); go.classList.remove('busy'); after.classList.add('on');
      for (const r of rows) { r.classList.add('on'); await wait(260); }
      card.classList.add('done');
      await wait(4200);
    }
  }
  // Runs only while the step is on screen.
  new IntersectionObserver(es => { if (es[0].isIntersecting) loop(); else running = false; }, { threshold: .25 }).observe(media);
})();
