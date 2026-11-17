// Top bar account state for the site pages. When the visitor is signed in (same sign-in as the studio),
// "Sign In" becomes a green check, "<Name>'s Account" and "Sign out". Reads the saved session only;
// the sign-in library is loaded just when "Sign out" is pressed.
(() => {
  const link = document.querySelector("header.nav .nav-signin"); if (!link) return;
  let key = null, user = null;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^sb-.+-auth-token$/.test(k)) { const s = JSON.parse(localStorage.getItem(k)); if (s && s.user && s.refresh_token) { key = k; user = s.user; } } } } catch {}
  if (!user) return;
  const meta = user.user_metadata || {}, raw = (meta.full_name || meta.name || (user.email || "").split("@")[0] || "").trim().split(/[\s._-]+/)[0];
  const first = raw ? raw[0].toUpperCase() + raw.slice(1) : "";
  const label = first ? `${first}’s Account` : "My Account";
  link.className = "nav-acct"; link.href = "/app/#signin"; link.title = user.email || "";
  link.innerHTML = '<span class="nav-ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 12.5l3.6 3.6 7.4-8"/></svg></span><span class="nav-acct-name"></span>';
  link.querySelector(".nav-acct-name").textContent = label;
  const out = document.createElement("button"); out.type = "button"; out.className = "nav-signout"; out.textContent = "Sign out"; link.after(out);
  const foot = document.querySelector(".nav-m-foot .btn-ghost"); if (foot) { foot.textContent = "Sign out"; foot.href = "#"; }
  const load = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); });
  const signOut = async e => { e.preventDefault(); out.disabled = true; out.textContent = "Signing out…";
    try { await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js"); await load("/js/config.js"); await load("/js/accounts.js"); if (window.bvAuth) await window.bvAuth.signOut(); } catch {}
    try { localStorage.removeItem(key); } catch {}
    location.reload(); };
  out.addEventListener("click", signOut); if (foot) foot.addEventListener("click", signOut);
})();
