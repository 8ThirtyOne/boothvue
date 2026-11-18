// Workflow page, steps 2–5: short looping demos built from real studio frames.
// Each runs only while it is on screen; with reduced motion turned on, each shows its finished state.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Runs fn in a loop while el is visible. fn gets a "live" check so it can stop mid-way.
  function whileVisible(el, fn) {
    let on = false, running = false;
    const live = () => on;
    new IntersectionObserver(es => { on = es[0].isIntersecting; if (on && !running) { running = true; (async () => { while (on) await fn(live); running = false; })(); } }, { threshold: .25 }).observe(el);
  }
  async function typeIn(el, text, live, ms = 28) { el.textContent = ''; for (const ch of text) { if (!live()) return; el.textContent += ch; await wait(ms); } }

  // Step 2: a sentence types into AI Build, the button presses, the empty floor becomes a booth.
  const build = document.querySelector('.demo-build');
  if (build) {
    const media = build.closest('.walk-media'), type = build.querySelector('.dm-type'), btn = build.querySelector('.dm-btn'), after = media.querySelector('.ba-after');
    if (still) { type.textContent = type.dataset.text; after.classList.add('on'); }
    else whileVisible(media, async live => {
      after.classList.remove('on'); build.classList.remove('busy', 'done'); btn.classList.remove('press'); type.textContent = '';
      await wait(800); await typeIn(type, type.dataset.text, live); if (!live()) return;
      await wait(500); btn.classList.add('press'); await wait(200); btn.classList.remove('press'); build.classList.add('busy');
      await wait(1500); build.classList.remove('busy'); build.classList.add('done'); after.classList.add('on');
      await wait(4200);
    });
  }

  // Step 3: the cursor drags the sofa across the floor; the frames follow it.
  const drag = document.querySelector('.demo-drag');
  if (drag) {
    const frames = [...drag.querySelectorAll('img')], cur = drag.querySelector('.dm-cursor');
    const pts = drag.dataset.pts.split(' ').map(p => p.split(',').map(Number));
    const show = i => frames.forEach((f, k) => f.classList.toggle('on', k === i));
    const at = (p, ms) => { cur.style.transition = ms ? `left ${ms}ms ease-in-out, top ${ms}ms ease-in-out` : 'none'; cur.style.left = p[0] * 100 + '%'; cur.style.top = p[1] * 100 + '%'; };
    if (still) { show(frames.length - 1); at(pts[pts.length - 1], 0); cur.classList.add('on'); }
    else whileVisible(drag, async live => {
      show(0); at([pts[0][0] - .12, pts[0][1] + .14], 0); cur.classList.remove('on', 'grab'); await wait(500);
      cur.classList.add('on'); at(pts[0], 700); await wait(900);
      cur.classList.add('grab'); await wait(300);
      for (let i = 1; i < pts.length; i++) { if (!live()) return; at(pts[i], 900); await wait(450); show(i); await wait(550); }
      cur.classList.remove('grab'); await wait(2800);
      cur.classList.remove('on'); await wait(500);
    });
  }

  // Step 4: the view bar steps through 3D, Front, Plan and Eye, then a 4K render is saved.
  const views = document.querySelector('.demo-views');
  if (views) {
    const frames = [...views.querySelectorAll('.dm-stack > img')], tabs = [...views.querySelectorAll('.dm-bar i')], saved = views.querySelector('.dm-saved');
    const show = i => { frames.forEach((f, k) => f.classList.toggle('on', k === i)); tabs.forEach((t, k) => t.classList.toggle('on', k === i)); };
    if (still) show(0);
    else whileVisible(views, async live => {
      saved.classList.remove('on');
      for (let i = 0; i < frames.length; i++) { if (!live()) return; show(i); await wait(1700); }
      show(0); await wait(600); saved.classList.add('on'); await wait(2200);
    });
  }

  // Step 5: AI Render turns the 3D view into a photo-realistic image.
  const render = document.querySelector('.demo-render');
  if (render) {
    const box = render.querySelector('.dm-render'), after = render.querySelector('img.ba-after'), tag = render.querySelector('.dm-tag');
    const anim = render.querySelector('.dm-anim'), vid = render.querySelector('.ba-video');
    if (still) { after.classList.add('on'); tag.classList.add('on'); box.classList.add('gone'); }
    else whileVisible(render, async live => {
      vid.classList.remove('on'); vid.pause(); anim.className = 'dm-render dm-anim gone';
      after.classList.remove('on'); tag.classList.remove('on'); tag.textContent = 'AI image'; box.className = 'dm-render'; await wait(900);
      box.classList.add('press'); await wait(250); box.classList.remove('press'); box.classList.add('busy');
      await wait(2200); if (!live()) return;
      box.classList.remove('busy'); box.classList.add('gone'); after.classList.add('on'); await wait(600); tag.classList.add('on');
      vid.preload = 'auto'; await wait(3200); if (!live()) return;
      // Then one click animates it into the 10-second video.
      anim.classList.remove('gone'); await wait(700);
      anim.classList.add('press'); await wait(250); anim.classList.remove('press'); anim.classList.add('busy');
      await wait(2200); if (!live()) return;
      anim.classList.add('gone'); vid.currentTime = 0; try { await vid.play(); } catch {}
      vid.classList.add('on'); tag.textContent = 'AI video · 10 sec';
      await wait(10000);
    });
  }
})();
