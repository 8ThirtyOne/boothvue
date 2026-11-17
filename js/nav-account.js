// Top bar account state for the site pages. When the visitor is signed in (same sign-in as the studio),
// "Sign In" becomes a small account button (green check + "Account") with a dropdown: the email,
// Account & pass, Open the studio, Sign out. Reads the saved session only; the sign-in library is
// loaded just when "Sign out" is pressed.
(() => {
  const link = document.querySelector("header.nav .nav-signin"); if (!link) return;
  let key = null, user = null;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^sb-.+-auth-token$/.test(k)) { const s = JSON.parse(localStorage.getItem(k)); if (s && s.user && s.refresh_token) { key = k; user = s.user; } } } } catch {}
  if (!user) return;
  const g = document.createElement("div"); g.className = "nav-group nav-acct-group";
  g.innerHTML = '<button type="button" class="nav-acct" aria-expanded="false"><span class="nav-ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.6 3.6 7.4-8"/></svg></span><span class="nav-acct-name">Account</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>'
    + '<div class="nav-menu right"><div class="nm-mail"></div><a href="/app/#signin"><b>Account &amp; pass</b><small>Your pass and credits</small></a><a href="/app/"><b>Open the studio</b><small>Pick up your designs</small></a><button type="button" class="nm-out">Sign out</button></div>';
  g.querySelector(".nm-mail").textContent = "Signed in as " + (user.email || "your account");
  link.replaceWith(g);
  const out = g.querySelector(".nm-out"), foot = document.querySelector(".nav-m-foot .btn-ghost"); if (foot) { foot.textContent = "Sign out"; foot.href = "#"; }
  const load = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); });
  const signOut = async e => { e.preventDefault(); out.disabled = true; out.textContent = "Signing out…";
    try { await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js"); await load("/js/config.js"); await load("/js/accounts.js"); if (window.bvAuth) await window.bvAuth.signOut(); } catch {}
    try { localStorage.removeItem(key); } catch {}
    location.reload(); };
  out.addEventListener("click", signOut); if (foot) foot.addEventListener("click", signOut);
})();
