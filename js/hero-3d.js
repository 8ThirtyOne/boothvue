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
