// Phone/tablet menu card (like FoldVue's) and the top bar that turns light once the dark hero scrolls away.
(() => {
  const nav = document.querySelector("header.nav");
  if (!nav) return;
  const ic = d => `<i><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg></i>`;
  const I = window.BV_ICONS = {
    workflow: '<circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.2 6h9.6M6.1 8l4.8 8M17.9 8l-4.8 8"/>',
    features: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    types: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M12 12l8-4.6M12 12v9.2M12 12L4 7.4"/>',
    pricing: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    faq: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8"/><path d="M12 17.2h.01"/>',
    contact: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.2l8.5 6 8.5-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  const here = location.pathname.replace(/index\.html$/, "");
  const item = (href, icon, title, sub) => `<a href="${href}"${here === href ? ' class="cur" aria-current="page"' : ""}>${ic(I[icon])}<span><b>${title}</b><small>${sub}</small></span></a>`;
  const logo = nav.querySelector(".brand .logo-sq");
  const panel = document.createElement("nav");
  panel.className = "mpanel";
  panel.setAttribute("aria-label", "Site menu");
  panel.innerHTML =
    `<a class="mp-home" href="/">${logo ? logo.outerHTML : ""}<span><b>Booth<em>Vue</em></b><small>See your booth before it&rsquo;s built.</small></span></a>` +
    `<div class="mp-list">` +
    item("/workflow/", "workflow", "Workflow", "Brand to 3D to photo-real render") +
    item("/features/", "features", "Features", "AI build, 3D editor, renders") +
    item("/booth-types/", "types", "Booth Types", "Inline to island, all sizes") +
    item("/pricing/", "pricing", "Pricing", "7-day, 30-day and annual passes") +
    `<p class="mp-group">Help</p>` +
    item("/faq/", "faq", "FAQ", "Common questions") +
    item("/contact/", "contact", "Contact", "We reply in one business day") +
    `</div>` +
    `<div class="mp-cta"><a class="btn btn-primary" href="/app/">Start Designing</a></div>` +
    `<a class="mp-acct" href="/app/#signin">${ic(I.user)}<span><b>Sign in</b><small>Use the email from your pass</small></span><em aria-hidden="true">&rarr;</em></a>`;
  nav.appendChild(panel);

  const close = () => { nav.classList.remove("open"); document.documentElement.classList.remove("menu-open"); const t = nav.querySelector(".nav-toggle"); if (t) t.setAttribute("aria-expanded", "false"); };
  panel.addEventListener("click", e => { if (e.target.closest("a")) close(); });
  document.addEventListener("click", e => { if (nav.classList.contains("open") && !e.target.closest("header.nav")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

  // Dark over the opening hero, light once it has scrolled under the bar
  const hero = document.querySelector("main > section.hero, main > section.page-hero, body > section.hero, .hero, .page-hero");
  const sync = () => {
    const dark = hero && hero.getBoundingClientRect().bottom > nav.offsetHeight + 4;
    nav.classList.toggle("on-light", !dark);
  };
  addEventListener("scroll", sync, { passive: true });
  addEventListener("resize", sync);
  sync();
})();
