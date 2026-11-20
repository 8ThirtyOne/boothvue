// 3D → AI Render hero: the live 3D booth turns for a few seconds, then the photo-real AI video of the same booth
// fades in over it, plays once and fades back. Shows visitors the jump from their design to the AI result.
// Markup: <section class="hero-3d" data-ai-video="/img/x.mp4" data-ai-poster="/img/x.jpg">
(() => {
  const hero = document.querySelector(".hero-3d[data-ai-video]");
  if (!hero || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const v = document.createElement("video");
  Object.assign(v, { muted: true, playsInline: true, preload: "auto", src: hero.dataset.aiVideo });
  v.className = "hero-ai"; v.setAttribute("aria-hidden", "true"); v.setAttribute("muted", "");
  if (hero.dataset.aiPoster) v.poster = hero.dataset.aiPoster;
  const tag = document.createElement("div");
  tag.className = "hero-ai-tag"; tag.setAttribute("aria-live", "polite");
  tag.innerHTML = '<span class="s3d">Your 3D design</span><span class="sai">AI Render</span>';
  const frame = hero.querySelector(".hero-3d-frame");
  frame.after(v); hero.append(tag);

  const SHOW_3D = 5000;
  let timer = null, stopped = false;
  const set = ai => { hero.classList.toggle("ai-on", ai); };
  const to3D = () => { set(false); clearTimeout(timer); if (!stopped) timer = setTimeout(toAI, SHOW_3D); };
  const toAI = () => { if (stopped) return; v.currentTime = 0; const p = v.play(); if (p) p.catch(() => {}); set(true); };
  v.addEventListener("ended", to3D);
  v.addEventListener("error", () => { stopped = true; set(false); tag.remove(); });

  // Someone dragging the booth wants the 3D: stay there.
  addEventListener("message", e => {
    if (e.origin === location.origin && e.data && e.data.boothvue === "spin-state" && !e.data.on) { stopped = true; clearTimeout(timer); set(false); v.pause(); }
  });
  let started = false;
  const start = () => { if (started) return; started = true; to3D(); };
  addEventListener("message", e => { if (e.origin === location.origin && e.data && e.data.boothvue === "embed-ready") start(); });
  setTimeout(start, 9000);   // if the 3D is slow, start the cycle anyway
  document.addEventListener("visibilitychange", () => { if (document.hidden) v.pause(); else if (hero.classList.contains("ai-on")) v.play().catch(() => {}); });
})();
