// Loading screen for the live 3D booth hero: a colored backdrop with a spinning status ring,
// shown until the embedded studio says its first frames are drawn (or after a time limit).
(() => {
  const hero = document.querySelector(".page-hero.hero-3d"), frame = hero && hero.querySelector(".hero-3d-frame"); if (!frame) return;
  const box = document.createElement("div"); box.className = "hero-3d-load"; box.setAttribute("role", "status");
  box.innerHTML = '<div class="h3l-in"><span class="h3l-ring" aria-hidden="true"><i></i></span><b>Loading the 3D booth</b><small>Setting up the show floor…</small></div>';
  frame.after(box);
  let done = false;
  const finish = () => { if (done) return; done = true; box.classList.add("gone"); setTimeout(() => box.remove(), 900); };
  addEventListener("message", e => { if (e.origin === location.origin && e.data && e.data.boothvue === "embed-ready") finish(); });
  setTimeout(finish, 20000);
})();

// Spin / Stop button: starts and stops the booth's slow turn inside the embedded studio.
(() => {
  const hero = document.querySelector(".page-hero.hero-3d"), frame = hero && hero.querySelector(".hero-3d-frame"); if (!frame) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const b = document.createElement("button"); b.type = "button"; b.className = "hero-3d-spin";
  let on = !still;
  const draw = () => { b.setAttribute("aria-pressed", on); b.innerHTML = on
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg><span>Stop</span>'
    : '<svg class="turn" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg><span>Spin</span>'; b.title = on ? "Stop the booth turning" : "Turn the booth slowly"; };
  draw(); hero.append(b);
  b.addEventListener("click", () => { on = !on; draw(); frame.contentWindow && frame.contentWindow.postMessage({ boothvue: "spin", on }, location.origin); });
  addEventListener("message", e => { if (e.origin === location.origin && e.data && e.data.boothvue === "spin-state") { on = !!e.data.on; draw(); } });
})();

// The 3D studio is heavy, so it starts loading only after the rest of the page has finished.
(() => {
  const frame = document.querySelector(".page-hero.hero-3d .hero-3d-frame[data-src]"); if (!frame) return;
  const go = () => { if (!frame.src) frame.src = frame.dataset.src; };
  if (document.readyState === "complete") setTimeout(go, 50); else addEventListener("load", () => setTimeout(go, 50));
})();
