// "Share BoothVue" popup (LinkedIn, X, Bluesky, Facebook, Reddit, Email, copy link) + lazy background video in the share band.
(() => {
  const URL_ = "https://boothvue.co/", TEXT = "See your trade show booth before it's built: design it in 3D, then get photo-real AI images and video.";
  const e = encodeURIComponent, u = e(URL_), t = e(TEXT);
  const ic = {
    linkedin: '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="3" fill="#0A66C2"/><path fill="#fff" d="M7 9.5h2.6V18H7zM8.3 5.6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM11.2 9.5h2.5v1.2c.4-.7 1.3-1.4 2.6-1.4 2.7 0 3.2 1.8 3.2 4.1V18h-2.6v-4.1c0-1 0-2.2-1.4-2.2s-1.6 1.1-1.6 2.1V18h-2.7z"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>',
    bluesky: '<svg viewBox="0 0 24 24"><path fill="#1185FE" d="M5.2 3.6C7.9 5.6 10.8 9.7 12 12c1.2-2.3 4.1-6.4 6.8-8.4 2-1.4 5.2-2.6 5.2 1 0 .7-.4 6-.7 6.8-.9 3-4 3.8-6.7 3.3 4.8.8 6 3.5 3.4 6.3-5 5.1-7.1-1.3-7.7-3l-.3-.8-.3.8c-.6 1.7-2.7 8.1-7.7 3-2.6-2.8-1.4-5.5 3.4-6.3-2.7.5-5.8-.3-6.7-3.3C.4 10.6 0 5.3 0 4.6c0-3.6 3.2-2.4 5.2-1z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#fff" d="M13.4 24v-8.6h2.9l.4-3.4h-3.3V9.9c0-1 .3-1.6 1.7-1.6h1.8v-3a23 23 0 0 0-2.6-.1c-2.6 0-4.4 1.6-4.4 4.5V12H7v3.4h2.9V24z"/></svg>',
    reddit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#FF4500"/><path fill="#fff" d="M19.6 12a1.7 1.7 0 0 0-2.9-1.2 8.4 8.4 0 0 0-4.5-1.4l.8-3.6 2.5.5a1.2 1.2 0 1 0 .1-.7l-2.8-.6a.4.4 0 0 0-.4.3l-.9 4.1a8.4 8.4 0 0 0-4.6 1.4A1.7 1.7 0 1 0 5 13.3a3.3 3.3 0 0 0 0 .5c0 2.6 3.1 4.7 7 4.7s7-2.1 7-4.7v-.5a1.7 1.7 0 0 0 .6-1.3zM8 13.2a1.2 1.2 0 1 1 1.2 1.2A1.2 1.2 0 0 1 8 13.2zm6.9 3.3a4.6 4.6 0 0 1-2.9.9 4.6 4.6 0 0 1-2.9-.9.3.3 0 0 1 .4-.4 4 4 0 0 0 2.5.7 4 4 0 0 0 2.5-.7.3.3 0 1 1 .4.4zm-.2-2.1a1.2 1.2 0 1 1 1.2-1.2 1.2 1.2 0 0 1-1.2 1.2z"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>'
  };
  const links = [
    ["LinkedIn", ic.linkedin, `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ["X", ic.x, `https://x.com/intent/post?text=${t}&url=${u}`],
    ["Bluesky", ic.bluesky, `https://bsky.app/intent/compose?text=${t}%20${u}`],
    ["Facebook", ic.facebook, `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["Reddit", ic.reddit, `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ["Email", ic.email, `mailto:?subject=${e("Have a look at BoothVue")}&body=${t}%0A%0A${u}`]
  ];
  let dlg;
  const build = () => {
    dlg = document.createElement("dialog"); dlg.className = "share-dlg"; dlg.setAttribute("aria-labelledby", "share-title");
    dlg.innerHTML = `<button type="button" class="share-x" aria-label="Close">×</button><div class="share-eb">Share</div><h3 id="share-title">Share BoothVue</h3>
      <div class="share-grid">${links.map(([n, i, h]) => `<a href="${h}" target="_blank" rel="noopener">${i}<span>${n}</span></a>`).join("")}</div>
      <div class="share-copy"><input readonly value="${URL_}" aria-label="BoothVue link"><button type="button" class="share-copy-btn">Copy link</button></div>`;
    document.body.append(dlg);
    dlg.querySelector(".share-x").onclick = () => dlg.close();
    dlg.addEventListener("click", ev => { if (ev.target === dlg) dlg.close(); });
    const cb = dlg.querySelector(".share-copy-btn"), inp = dlg.querySelector(".share-copy input");
    cb.onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(URL_) : Promise.reject()).then(() => { cb.textContent = "Copied"; setTimeout(() => cb.textContent = "Copy link", 1600); }).catch(() => { inp.select(); });
  };
  document.addEventListener("click", ev => { const b = ev.target.closest("[data-share]"); if (!b) return; if (!dlg) build(); dlg.showModal(); });
  // Background video in the share band loads only when it comes into view
  const v = document.querySelector(".cta-bg[data-src]");
  if (v && !matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { v.src = v.dataset.src; v.play().catch(() => {}); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(v);
  }
})();
