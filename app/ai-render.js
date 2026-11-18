// AI Render, live version: photo-realistic images and videos from the current view, using the customer's pass credits.
// Loaded after app.js on the hosted site. Replaces the preview AI Render window.
(function () {
  const auth = window.bvAuth;
  if (!auth) return; // not on the hosted site: keep the preview
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const live = { items: [], polling: new Map(), posters: new Map(), stamps: new Map(), loaded: false, mode: 'upgrade' };
  const brandInfo = () => {
    let size = '', type = '';
    try { size = getSZ().lbl; type = (BOOTH_TYPES[S.boothType] || '').toString(); } catch {}
    let font = ''; try { font = (typeof activeFont !== 'undefined' && activeFont && (fontList.find(f => f.family === activeFont)?.name || activeFont)) || ''; } catch {}
    return { company: S.brand.company || '', tagline: S.brand.tagline || '', colors: [S.brand.primary, S.brand.secondary, S.brand.accent].filter(Boolean), bg: S.brand.bg || '', font, size, type, tone: S.brand.tone || '', style: S.brand.style || '' };
  };
  // The uploaded logo artwork, sent alongside the view so AI Render copies the real logo instead of drawing its own.
  const brandLogos = () => {
    const out = [];
    try {
      artItems.filter(a => a.kind === 'logo' || a.kind === 'icon').slice(0, 2).forEach(a => {
        const iw = a.img.naturalWidth || 300, ih = a.img.naturalHeight || 300, k = Math.min(3, 640 / Math.max(iw, ih));
        const cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(iw * k)); cv.height = Math.max(2, Math.round(ih * k));
        const x = cv.getContext('2d'); x.fillStyle = '#8a8f98'; x.fillRect(0, 0, cv.width, cv.height);   // mid-grey so both light and dark logos show
        x.drawImage(a.img, 0, 0, cv.width, cv.height);
        const data = cv.toDataURL('image/jpeg', .9).split(',')[1]; if (data && data.length < 500000) out.push(data);
      });
    } catch {}
    return out;
  };
  // ── Exact logo ──
  // An image AI redraws everything, logos included, and cannot be trusted to copy one. So in Faithful mode the studio notes where
  // each uploaded logo sits in the view when the render starts, and when the picture comes back it puts the real logo file over
  // that spot, at the same angle. The AI's own version of the picture is kept too.
  function stampPlan() {
    try {
      if (typeof lastRenderBlob !== 'undefined' && lastRenderBlob) return [];   // the picture sent isn't the live view, so positions are unknown
      camera.updateMatrixWorld(); const out = [];
      artItems.filter(a => (a.kind === 'logo' || a.kind === 'icon') && a.mesh && a.img).forEach(a => {
        const m = a.mesh; m.updateMatrixWorld(true);
        const world = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld);
        const pts = [world(-.5, .5), world(.5, .5), world(.5, -.5), world(-.5, -.5)], center = world(0, 0);
        const n = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
        if (n.dot(camera.position.clone().sub(center).normalize()) < .12) return;                 // facing away or edge-on
        const quad = pts.map(p => { const v = p.clone().project(camera); return [(v.x + 1) / 2, (1 - v.y) / 2, v.z]; });
        if (quad.some(q => q[2] > 1 || q[0] < -.01 || q[0] > 1.01 || q[1] < -.01 || q[1] > 1.01)) return;   // partly out of frame
        let clear = 0;                                                                              // hidden behind something?
        [center, ...pts.map(p => p.clone().lerp(center, .25))].forEach(p => {
          const dir = p.clone().sub(camera.position), dist = dir.length();
          const rc = new THREE.Raycaster(camera.position.clone(), dir.normalize(), 0, Math.max(.01, dist - .06));
          const hit = rc.intersectObjects(boothG.children, true).find(h => { for (let q = h.object; q; q = q.parent) if (q.userData.artId) return false; return true; });
          if (!hit) clear++;
        });
        if (clear < 5) return;
        const area = Math.abs(quad.reduce((s, p, i) => { const q = quad[(i + 1) % 4]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
        if (area < .0008) return;                                                                   // too small in the frame to matter
        out.push({ quad: quad.map(q => [q[0], q[1]]), img: a.img, name: a.name });
      });
      return out;
    } catch { return []; }
  }
  const loadImg = (src, cors) => new Promise((ok, no) => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  // Maps the unit square onto a four-corner shape (a perspective warp).
  function squareToQuad(q) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q, dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9, g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
    return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
  }
  async function stampImage(url, plan) {
    const img = await loadImg(url, true), W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    for (const s of plan) {
      const full = s.quad.map(p => [p[0] * W, p[1] * H]), map = squareToQuad(full);
      const lw = s.img.naturalWidth || 300, lh = s.img.naturalHeight || 300, k = Math.min(4, 1024 / Math.max(lw, lh));
      const L = document.createElement('canvas'); L.width = Math.max(2, Math.round(lw * k)); L.height = Math.max(2, Math.round(lh * k));
      const lx = L.getContext('2d', { willReadFrequently: true }); lx.drawImage(s.img, 0, 0, L.width, L.height);
      // The part of the file that actually has ink (a tall "8" in a square file is much narrower than the file).
      let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
      try { const d = lx.getImageData(0, 0, L.width, L.height).data; let a = L.width, b = L.height, c2 = -1, e = -1;
        for (let yy = 0; yy < L.height; yy += 2) for (let xx = 0; xx < L.width; xx += 2) if (d[(yy * L.width + xx) * 4 + 3] > 24) { if (xx < a) a = xx; if (xx > c2) c2 = xx; if (yy < b) b = yy; if (yy > e) e = yy; }
        if (c2 > a && e > b) { u0 = a / L.width; u1 = (c2 + 2) / L.width; v0 = b / L.height; v1 = (e + 2) / L.height; } } catch {}
      const q = [map(u0, v0), map(u1, v0), map(u1, v1), map(u0, v1)], cx = q.reduce((t, p) => t + p[0], 0) / 4, cy = q.reduce((t, p) => t + p[1], 0) / 4;
      const grow = k => q.map(p => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]);
      const size = Math.max(...q.map(p => Math.hypot(p[0] - cx, p[1] - cy)));
      // The surface color just outside each edge of the logo (the middle value per edge, so stray pixels don't count).
      const ring = grow(1.16), edge = e => { const px = [];
        for (let t = 1; t < 12; t++) { const a = ring[e], b = ring[(e + 1) % 4], sx = Math.round(a[0] + (b[0] - a[0]) * t / 12), sy = Math.round(a[1] + (b[1] - a[1]) * t / 12);
          if (sx >= 0 && sy >= 0 && sx < W && sy < H) px.push(x.getImageData(sx, sy, 1, 1).data); }
        const mid = ch => { const v = px.map(p => p[ch]).sort((m, n) => m - n); return v.length ? v[v.length >> 1] : 255; };
        return `rgb(${mid(0)},${mid(1)},${mid(2)})`; };
      const [top, right, bottom, left] = [edge(0), edge(1), edge(2), edge(3)];
      // Cover whatever the AI drew there, keeping the surface's own light falloff: left-to-right, then top-to-bottom blended in.
      const cover = grow(1.08), path = () => { x.beginPath(); cover.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); };
      const mp = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L0 = mp(q[0], q[3]), R0 = mp(q[1], q[2]), T0 = mp(q[0], q[1]), B0 = mp(q[3], q[2]);
      x.save(); x.filter = `blur(${Math.max(1.5, size * .012).toFixed(1)}px)`;
      let g = x.createLinearGradient(L0[0], L0[1], R0[0], R0[1]); g.addColorStop(0, left); g.addColorStop(1, right); x.fillStyle = g; path(); x.fill();
      g = x.createLinearGradient(T0[0], T0[1], B0[0], B0[1]); g.addColorStop(0, top); g.addColorStop(1, bottom); x.globalAlpha = .5; x.fillStyle = g; path(); x.fill();
      x.restore();
      // The real logo, warped onto the spot in small triangles.
      const N = 8;
      const tri = (s0, s1, s2, d0, d1, d2) => {
        const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]); if (!den) return;
        const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den, b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
        const c2 = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den, d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
        const mx = (d0[0] + d1[0] + d2[0]) / 3, my = (d0[1] + d1[1] + d2[1]) / 3, out = p => { const dd = Math.hypot(p[0] - mx, p[1] - my) || 1; return [p[0] + (p[0] - mx) / dd * 1.6, p[1] + (p[1] - my) / dd * 1.6]; };   // each piece overlaps its neighbours, so no seams show
        const [o0, o1, o2] = [out(d0), out(d1), out(d2)];
        x.save(); x.beginPath(); x.moveTo(o0[0], o0[1]); x.lineTo(o1[0], o1[1]); x.lineTo(o2[0], o2[1]); x.closePath(); x.clip();
        x.transform(a, b, c2, d, d0[0] - a * s0[0] - c2 * s0[1], d0[1] - b * s0[0] - d * s0[1]); x.drawImage(L, 0, 0); x.restore();
      };
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N, S = (u, v) => [u * L.width, v * L.height];
        tri(S(u0, v0), S(u1, v0), S(u1, v1), map(u0, v0), map(u1, v0), map(u1, v1));
        tri(S(u0, v0), S(u1, v1), S(u0, v1), map(u0, v0), map(u1, v1), map(u0, v1));
      }
    }
    let data = cv.toDataURL('image/jpeg', .9).split(',')[1]; if (data.length > 3800000) data = cv.toDataURL('image/jpeg', .8).split(',')[1];
    return data;
  }
  // Stamps a finished render and stores the result. Returns the new address, or null when there was nothing to stamp or it failed.
  async function exactLogo(id, url) {
    const plan = live.stamps.get(id); if (!plan || !plan.length) return null;
    try {
      const image = await stampImage(url, plan);
      const r = await api('/api/render', { method: 'POST', body: JSON.stringify({ stampFor: id, image }) });
      return r && r.url ? r.url : null;
    } catch (e) { console.warn('exact logo skipped', e?.message || e); return null; }
  }
  const latestImage = () => live.items.find(r => r.kind === 'image' && r.status === 'done' && r.result_url);
  const POLL_MS = { image: 4000, video: 10000 };
  // One-click art direction styles. Picking one fills the box, which stays editable.
  const STYLES = [
    { id: 'flagship', only: 'upgrade', name: 'Award-winning flagship', text: 'Concept upgrade: reimagine this booth as a dramatically enhanced, award-winning flagship exhibit that goes far beyond the 3D model. Premium custom-built finishes, dramatic LED lighting, bold oversized brand graphics and striking architectural forms, shot like a design-award photo.' },
    { id: 'hero', name: 'Clean hero shot', text: 'Professional architectural photograph, wide-angle 24mm lens at eye level, bright even exhibition hall lighting, polished concrete aisle in the foreground, sharp focus, high detail.' },
    { id: 'minimal', only: 'upgrade', name: 'Premium and minimal', text: 'Sophisticated premium exhibit, minimalist luxury finishes, soft backlit glow, generous open space, high-end corporate feel.' },
    { id: 'busy', name: 'Busy show day', text: 'The busiest show day: crowds engaging with staff and screens, energetic atmosphere, bright lively hall lighting.' },
    { id: 'evening', name: 'Evening reception', text: 'Evening reception at the show: warm, low dramatic lighting, guests holding drinks, cinematic mood.' },
  ];

  async function api(path, init = {}) {
    const token = await auth.token();
    const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw { status: r.status, message: data.message || `AI Render returned an error (${r.status}).` };
    return data;
  }

  // Current view as a JPEG (longest side 1600 px), base64 without the data: prefix.
  async function captureView() {
    const blob = await currentViewBlob(), url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      live.aspect = c.width / c.height;
      return c.toDataURL('image/jpeg', 0.88).split(',')[1];
    } finally { URL.revokeObjectURL(url); }
  }

  function poll(id, kind) {
    if (live.polling.has(id)) return;
    const tick = async () => {
      try {
        const { render } = await api(`/api/render?id=${encodeURIComponent(id)}`);
        upsert(render);
        if (render.status === 'done' && render.result_url) {
          let orig = null;
          if (render.kind === 'image' && live.stamps.has(id)) {
            const st = document.getElementById('gen-status'); if (st) st.textContent = 'Placing your exact logo on the image…';
            const exact = await exactLogo(id, render.result_url); live.stamps.delete(id);
            if (exact) { orig = render.result_url; render.result_url = exact; upsert(render); if (st) st.textContent = 'Done. Your uploaded logo was placed on this image exactly as it is.'; }
            else if (st) st.textContent = 'Done.';
          }
          if (render.kind === 'image') { S.aiThumb = render.result_url; try { markDirty(); } catch {} }   // becomes the design's picture in Your Designs
          try { designFileAdd({ id: render.id, kind: render.kind, url: render.result_url, orig, poster: live.posters.get(id) || null, at: render.created_at }); } catch {}
        }
        if (render.status === 'done' || render.status === 'failed') { live.polling.delete(id); auth.refresh(); draw(); return; }
      } catch { /* try again next tick */ }
      live.polling.set(id, setTimeout(tick, POLL_MS[kind] || 6000));
      draw();
    };
    live.polling.set(id, setTimeout(tick, 1500));
  }
  function upsert(r) { const i = live.items.findIndex(x => x.id === r.id); if (i >= 0) live.items[i] = { ...live.items[i], ...r }; else live.items.unshift(r); }

  async function loadList() {
    try { const { renders } = await api('/api/render'); live.items = renders; live.loaded = true; renders.filter(r => r.status === 'queued' || r.status === 'running').forEach(r => poll(r.id, r.kind)); }
    catch { live.loaded = true; }
    draw();
  }

  function credits() {
    const r = acct.row;
    return r ? { img: r.images_total - r.images_used, imgTotal: r.images_total, vid: r.videos_total - r.videos_used, vidTotal: r.videos_total } : null;
  }

  function openRender() {
    const body = openModal('AI Render', true);
    const w = el('div'); w.style.cssText = 'display:grid;gap:12px'; body.append(w);
    if (!acct.signedIn) {
      w.innerHTML = `<p class="gen-note">Sign in with the email you bought your pass with to turn your design into photo-realistic images and videos.</p>`;
      const b = el('button', 'btn btn-primary', 'Sign in'); b.onclick = () => openAccount(); w.append(b); return;
    }
    const c = credits();
    if (!c) {
      w.innerHTML = `<p class="gen-note">AI Render is included with every pass: photo-realistic images and 10-second videos of your booth. Your account doesn't have an active pass yet.</p><a class="btn btn-primary" href="/pricing/" style="text-align:center">See passes and pricing</a>`;
      return;
    }
    w.innerHTML = `<div class="gen-top"><p style="margin:0;font-size:13px;color:var(--fg-muted);max-width:52ch;line-height:1.5"><b style="color:var(--fg)">AI Render photographs your finished design.</b> Frame the view you want in 3D, choose a style, then generate a photo-realistic image (1 image credit) or a 10-second video (1 video credit). To change the design itself, use <b style="color:var(--fg)">AI Build</b> or edit it by hand.</p>
        <div class="gen-credits"><div class="gen-chip"><b id="gen-img-left">${c.img} / ${c.imgTotal}</b><span>Images left</span></div><div class="gen-chip"><b id="gen-vid-left">${c.vid} / ${c.vidTotal}</b><span>Videos left</span></div></div></div>
      <div class="gen-mode" role="radiogroup" aria-label="Render style">
        <div class="gen-mode-btn" data-mode="upgrade" role="radio" tabindex="0"><b>Concept Upgrade</b><span>AI redesigns a much more enhanced, premium version of your booth, then photographs it. Expect a big step up from your 3D model.</span></div>
        <div class="gen-mode-btn" data-mode="faithful" role="radio" tabindex="0"><b>Faithful to My Design</b><span>Keeps your design exactly and makes it look real. Your uploaded logo is placed on the image exactly as it is.</span></div>
      </div>
      <div class="gen-styles" role="group" aria-label="Art direction styles">${STYLES.map(s => `<div class="gen-style" role="button" tabindex="0" data-style="${s.id}">${s.name}</div>`).join('')}</div>
      <textarea class="gen-dir" id="gen-dir" rows="3" aria-label="Art direction" placeholder="Art direction (optional), e.g. busy show hours, warm evening light"></textarea>
      <div class="gen-btns"><button class="btn btn-primary" id="gen-img">Generate image · 1 credit</button><button class="btn" id="gen-vid">Generate 10-sec video · 1 credit</button></div>
      <div class="gen-buy"><span class="gen-buy-lbl">Need more?<small>Images $5 · 10-sec videos $10 · 10 AI Build actions $5</small></span><button class="btn btn-sm" id="gen-buy-open">Buy extras</button></div>
      <div class="gen-status" id="gen-status" aria-live="polite">Images take about 30 seconds. 10-second videos animate your latest AI image and take 2–4 minutes; you can keep working meanwhile.</div>
      <div class="ss-title">Your Generations</div><div class="gen-grid" id="gen-grid"></div>`;
    const dirBox = document.getElementById('gen-dir'), styleBtns = [...w.querySelectorAll('.gen-style')];
    const markStyle = () => styleBtns.forEach(b => b.classList.toggle('on', STYLES.find(s => s.id === b.dataset.style)?.text === dirBox.value.trim()));
    const vp = document.getElementById('vp-dir'); dirBox.value = (live.dir ?? (vp ? vp.value : STYLES[0].text)).slice(0, 600);
    styleBtns.forEach(b => { const pick = () => { dirBox.value = STYLES.find(s => s.id === b.dataset.style).text; live.dir = dirBox.value; markStyle(); dirBox.focus(); };
      b.onclick = pick; b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }; });
    dirBox.oninput = () => { live.dir = dirBox.value; markStyle(); }; markStyle();
    const modeBtns = [...w.querySelectorAll('.gen-mode-btn')];
    const setMode = m => {
      live.mode = m; modeBtns.forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      // Styles that belong to the other mode are hidden, and their wording never stays behind in the box.
      const fits = s => !s.only || s.only === m;
      styleBtns.forEach(b => { b.hidden = !fits(STYLES.find(s => s.id === b.dataset.style)); });
      const cur = STYLES.find(s => s.text === dirBox.value.trim());
      if (cur && !fits(cur)) { dirBox.value = STYLES.find(s => s.id === 'hero').text; live.dir = dirBox.value; }
      else if (m === 'upgrade' && live.autoDir && dirBox.value.trim() === STYLES.find(s => s.id === 'hero').text) { dirBox.value = STYLES[0].text; live.dir = dirBox.value; }
      live.autoDir = !!(cur && !fits(cur)) || (live.autoDir && m !== 'upgrade');
      markStyle();
    };
    modeBtns.forEach(b => { b.onclick = () => setMode(b.dataset.mode); b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(b.dataset.mode); } }; }); setMode(live.mode);
    document.getElementById('gen-img').onclick = () => start('image');
    document.getElementById('gen-vid').onclick = () => start('video');
    document.getElementById('gen-buy-open').onclick = () => openBuyExtras();
    draw(); if (!live.loaded) loadList();
  }

  async function start(kind, sourceUrl) {
    const st = document.getElementById('gen-status'), btn = document.getElementById(kind === 'image' ? 'gen-img' : 'gen-vid');
    const c = credits(); if (!c || (kind === 'image' ? c.img : c.vid) <= 0) { st.textContent = `No ${kind} credits left on your pass. Buy more below.`; return; }
    btn.disabled = true;
    try {
      const src = kind === 'video' ? (sourceUrl || latestImage()?.result_url || null) : null;
      st.textContent = src ? 'Animating your latest AI image…' : 'Capturing the current view…';
      const image = src ? undefined : await captureView();
      const plan = kind === 'image' && live.mode === 'faithful' ? stampPlan() : [];
      st.textContent = 'Sending to AI Render…';
      const direction = (document.getElementById('gen-dir')?.value || '').trim();
      const { id } = await api('/api/render', { method: 'POST', body: JSON.stringify({ kind, mode: live.mode, image, sourceUrl: src || undefined, direction, brand: brandInfo(), logos: kind === 'image' ? brandLogos() : undefined, aspect: kind === 'image' && image ? live.aspect : undefined }) });
      if (plan.length) live.stamps.set(id, plan);
      if (src) live.posters.set(id, src);   // a video's picture in the Files tray is the image it was made from
      upsert({ id, kind, status: 'queued', created_at: new Date().toISOString() });
      poll(id, kind); auth.refresh();
      st.textContent = kind === 'image' ? 'Creating your image. It appears below in about 30 seconds.' : 'Creating your video. It appears below in 2–4 minutes; you can close this window and keep working.';
    } catch (e) { st.textContent = e?.message || "AI Render couldn't start. Try again."; }
    btn.disabled = false; draw();
  }

  // Buy extras: one window for AI Build packs, AI Render images and 10-second videos. Opens Stripe Checkout;
  // the extras are added to the pass when payment completes and last as long as the pass.
  const EXTRAS = [
    { kind: 'ai', name: 'AI Build actions', price: '$5 per pack of 10', unit: n => `${n * 10} actions`, what: 'Builds or changes your editable 3D booth: AI Build from words, photo to 3D, and prompt writing. One action per request.' },
    { kind: 'image', name: 'AI Render images', price: '$5 each', unit: n => `${n} image${n === 1 ? '' : 's'}`, what: 'Turns your current 3D view into one photo-realistic image.' },
    { kind: 'video', name: 'AI Render 10-sec videos', price: '$10 each', unit: n => `${n} video${n === 1 ? '' : 's'}`, what: 'Animates one of your AI images into a 10-second video clip.' },
  ];
  function openBuyExtras(focus) {
    const body = openModal('Buy Extras', false);
    const w = el('div', 'extras'); body.append(w);
    if (!acct.signedIn || !credits()) {
      w.innerHTML = `<p class="gen-note">Extras are added to an active pass. ${acct.signedIn ? 'Buy a pass first' : 'Sign in with the email you bought your pass with'}, then come back here.</p>`;
      const b = el('a', 'btn btn-primary', acct.signedIn ? 'See passes and pricing' : 'Sign in'); if (acct.signedIn) b.href = '/pricing/'; else b.onclick = () => openAccount(); w.append(b); return;
    }
    const msg = el('div', 'gen-status'); msg.setAttribute('aria-live', 'polite');
    if (focus === 'ai') msg.textContent = "You've used all the AI Build actions on your pass. Add a pack of 10 to keep building.", msg.classList.add('extra-alert'), w.append(msg);
    EXTRAS.forEach(x => {
      const row = el('div', 'extra-row' + (focus === x.kind ? ' on' : ''));
      row.innerHTML = `<div class="extra-txt"><b>${x.name}</b><span>${x.what}</span><em>${x.price}</em></div>`;
      const act = el('div', 'extra-act');
      const sel = el('select'); sel.setAttribute('aria-label', `How many: ${x.name}`);
      [1, 2, 3, 5, 10].forEach(n => { const o = el('option', null, x.kind === 'ai' ? `${n} pack${n === 1 ? '' : 's'} · ${n * 10}` : String(n)); o.value = n; sel.append(o); });
      const b = el('button', 'btn btn-primary btn-sm', 'Buy');
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Opening checkout…';
        try { const { url } = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ addon: x.kind, qty: +sel.value }) }); location.href = url; return; }
        catch (e) { msg.textContent = e?.message || "Couldn't open checkout. Try again."; }
        b.disabled = false; b.textContent = 'Buy';
      };
      act.append(sel, b); row.append(act); w.append(row);
    });
    if (!msg.isConnected) w.append(msg);
    w.append(el('p', 'extra-foot', 'Extras are added to your current pass and can be used until it ends.'));
  }
  window.openBuyExtras = openBuyExtras;

  function draw() {
    const c = credits(), a = document.getElementById('gen-img-left');
    if (a && c) { a.textContent = `${c.img} / ${c.imgTotal}`; document.getElementById('gen-vid-left').textContent = `${c.vid} / ${c.vidTotal}`; }
    const grid = document.getElementById('gen-grid'); if (!grid) return;
    grid.textContent = '';
    if (!live.loaded) { grid.append(el('div', 'gen-empty', 'Loading your generations…')); return; }
    if (!live.items.length) { const e = el('div', 'gen-empty', 'Your photo-realistic images and videos will appear here.'); e.style.gridColumn = '1/-1'; grid.append(e); return; }
    live.items.forEach(it => {
      const d = el('div', 'gen-item' + (it.status === 'done' ? ' done' : ''));
      if (it.status === 'done' && it.result_url) {
        if (it.kind === 'video') { const v = el('video'); v.src = it.result_url; v.controls = true; v.loop = true; v.muted = true; v.playsInline = true; v.preload = 'metadata'; d.append(v); }
        else { const im = el('img'); im.src = it.result_url; im.alt = 'Photo-realistic render of the booth'; im.loading = 'lazy'; d.append(im); }
        const open = el('a', 'gen-open', it.kind === 'video' ? 'Open video' : 'Open full size'); open.href = it.result_url; open.target = '_blank'; open.rel = 'noopener'; d.append(open);
        if (it.kind === 'image') { const an = el('button', 'gen-animate', 'Animate · 10-sec video'); an.onclick = () => start('video', it.result_url); d.append(an); }
      } else {
        const msg = it.status === 'failed' ? `Couldn't create this ${it.kind}. Your credit was returned.` : it.kind === 'video' ? 'Creating video… 2–4 minutes' : 'Creating image… about 30 seconds';
        const t = el('div', 'gen-wait' + (it.status === 'failed' ? ' failed' : ''), msg); d.append(t);
      }
      grid.append(d);
    });
  }

  // Replace the preview window and point the AI Render button at the live one.
  window.openGenerate = openRender;
  window.aiAnimate = url => { openRender(); start('video', url); };   // used by the Files tray
  const btn = document.querySelector('.cv-gen'); if (btn) btn.onclick = openRender;
  auth.onChange(st => { if (!st.user) { live.items = []; live.loaded = false; } draw(); });
})();

// Back from buying extra credits: show the AI Render window and pick up the new credits.
(function afterCreditPurchase() {
  const q = new URLSearchParams(location.search);
  if (q.get('credits') !== 'added' || !window.bvAuth) return;
  const kind = q.get('kind'); q.delete('credits'); q.delete('kind'); history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
  let shown = false;
  const show = () => {
    if (shown || !acct.signedIn) return; shown = true;
    if (kind === 'ai') { openAccount(); const m = document.getElementById('acct-msg'); if (m) m.textContent = 'Payment received. Your extra AI Build actions appear here in a few seconds.'; }
    else { window.openGenerate(); const st = document.getElementById('gen-status'); if (st) st.textContent = 'Payment received. Your extra credits appear here in a few seconds.'; }
    [3000, 8000, 15000].forEach(ms => setTimeout(() => window.bvAuth.refresh(), ms));
  };
  window.bvAuth.onChange(show); setTimeout(show, 1500);
})();
