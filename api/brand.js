// Brand from a website.
//   POST /api/brand { url }      -> { site, company, tagline, primary, secondary, accent, bg, graphicStyle, lightStyle, tone, style, logo }
//                                   Reads the public page and its stylesheets, then asks Claude to pick the brand values. Uses 1 AI Build action.
//   GET  /api/brand?logo=<url>   -> the logo image bytes (so the studio can place it; other sites rarely allow direct loading).
// Only public http(s) addresses are fetched: local and private network addresses are refused at every redirect hop.
import Anthropic from "@anthropic-ai/sdk";
import dns from "node:dns/promises";
import net from "node:net";
import { activePass, dbConfigured, useAiAction, userFromToken } from "./_db.js";

const client = new Anthropic({ timeout: 40_000, maxRetries: 1 });
const MODEL = "claude-opus-5-5";
const UA = "Mozilla/5.0 (compatible; BoothVueBrandReader/1.0)";
const HEX = /^#[0-9a-f]{6}$/i;

// ── Safe fetching ─────────────────────────────────────────────────────────────
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error("bad protocol"), { code: "bad_url" });
  if (u.username || u.password) throw Object.assign(new Error("credentials in url"), { code: "bad_url" });
  if (u.port && !["80", "443"].includes(u.port)) throw Object.assign(new Error("port"), { code: "bad_url" });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw Object.assign(new Error("local host"), { code: "bad_url" });
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(r => r.address);
  if (!ips.length) throw Object.assign(new Error("no dns"), { code: "not_found" });
  if (ips.some(privateIp)) throw Object.assign(new Error("private address"), { code: "bad_url" });
}
// Fetches a public URL, following up to 4 redirects with the address re-checked each time, and stops reading at maxBytes.
async function safeFetch(url, { maxBytes, accept, timeoutMs = 9000 }) {
  let u = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(u);
    const r = await fetch(u, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location"), u); continue; }
    if (!r.ok) throw Object.assign(new Error("status " + r.status), { code: "unreachable", status: r.status });
    const reader = r.body.getReader(), chunks = []; let n = 0;
    while (n < maxBytes) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
    reader.cancel().catch(() => {});
    return { url: u.href, type: (r.headers.get("content-type") || "").toLowerCase(), bytes: Buffer.concat(chunks).subarray(0, maxBytes) };
  }
  throw Object.assign(new Error("too many redirects"), { code: "unreachable" });
}

// ── Reading the page ──────────────────────────────────────────────────────────
const decode = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4]) : ""; };
const abs = (href, base) => { try { const u = new URL(href, base); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; } };
function meta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const t of tags) if ((attr(t, "property") || attr(t, "name")).toLowerCase() === key) return attr(t, "content");
  return "";
}
function normHex(c) {
  c = c.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) return "#" + [...c.slice(1)].map(x => x + x).join("");
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(0, 7);
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(c);
  return m ? "#" + m.slice(1, 4).map(v => Math.min(255, +v).toString(16).padStart(2, "0")).join("") : "";
}
function readSite(html, css, base) {
  const head = html.slice(0, 200_000);
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1]);
  const links = head.match(/<link\b[^>]*>/gi) || [];
  const icons = links.filter(l => /icon/i.test(attr(l, "rel"))).map(l => ({ url: abs(attr(l, "href"), base), rel: attr(l, "rel").toLowerCase(), sizes: attr(l, "sizes") })).filter(i => i.url);
  const imgs = (html.match(/<img\b[^>]*>/gi) || []).slice(0, 80).map(t => ({ url: abs(attr(t, "src") || attr(t, "data-src"), base), alt: attr(t, "alt"), cls: attr(t, "class") + " " + attr(t, "id") })).filter(i => i.url);
  const logos = imgs.filter(i => /logo|brand|wordmark/i.test(i.url + " " + i.alt + " " + i.cls)).slice(0, 6);
  // Colors: how often each appears, plus named CSS variables, which usually spell out the brand palette.
  const all = css + "\n" + (html.match(/style\s*=\s*"[^"]*"/gi) || []).join("\n");
  const count = new Map();
  for (const m of all.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,40}\)/g)) { const h = normHex(m[0]); if (h) count.set(h, (count.get(h) || 0) + 1); }
  const colors = [...count].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([c, n]) => `${c} ×${n}`);
  const vars = [];
  for (const m of all.matchAll(/(--[\w-]{2,40})\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]{5,40}\))/g)) { const h = normHex(m[2]); if (h && vars.length < 30 && !vars.some(v => v.startsWith(m[1] + ":"))) vars.push(`${m[1]}: ${h}`); }
  const fonts = new Map();
  for (const m of all.matchAll(/font-family\s*:\s*([^;}{]{2,120})/gi)) { const f = m[1].split(",")[0].replace(/["']/g, "").trim(); if (f && !/^(inherit|initial|var\(|system-ui|sans-serif|serif|monospace|-apple-system)/i.test(f)) fonts.set(f, (fonts.get(f) || 0) + 1); }
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<noscript[\s\S]*?<\/noscript>/gi, " ");
  const heads = (body.match(/<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>/gi) || []).slice(0, 10).map(h => decode(h.replace(/<[^>]+>/g, " "))).filter(Boolean);
  const text = decode(body.replace(/<[^>]+>/g, " ")).slice(0, 1400);
  return {
    title, siteName: meta(head, "og:site_name"), ogTitle: meta(head, "og:title"), description: meta(head, "description") || meta(head, "og:description"),
    themeColor: normHex(meta(head, "theme-color")), ogImage: abs(meta(head, "og:image"), base),
    icons, logos, colors, vars, fonts: [...fonts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(f => f[0]), heads, text,
  };
}

const jsonFrom = t => { try { return JSON.parse(t); } catch {} const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} } return null; };
const str = (v, n) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  // Signed-in customers with a pass, the same rule as the other AI features.
  let pass = null;
  if (process.env.AI_REQUIRE_PASS === "1") {
    if (!dbConfigured()) return res.status(503).json({ code: "not_configured", message: "Accounts aren't set up on this server yet." });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await userFromToken(token).catch(() => null);
    if (!user) return res.status(401).json({ code: "sign_in_required", message: "Sign in to read a brand from a website." });
    pass = await activePass(user.email).catch(() => null);
    if (!pass) return res.status(402).json({ code: "pass_required", message: "Reading a brand from a website needs an active pass." });
  }

  // The logo image, passed through so the studio can place it on the booth.
  if (req.method === "GET") {
    try {
      const f = await safeFetch(String(req.query?.logo || ""), { maxBytes: 3_000_000, accept: "image/*" });
      const type = f.type.split(";")[0] || (/\.svg(\?|$)/i.test(f.url) ? "image/svg+xml" : "");
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) return res.status(415).json({ code: "not_image", message: "That isn't an image." });
      res.setHeader("Content-Type", type); res.setHeader("Cache-Control", "private, max-age=600"); res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      return res.status(200).send(f.bytes);
    } catch (err) {
      return res.status(err.code === "bad_url" ? 400 : 502).json({ code: err.code || "unreachable", message: "Couldn't load that image." });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed", message: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ code: "not_configured", message: "AI features aren't set up on this server yet." });
  if (pass && pass.ai_used >= pass.ai_total) return res.status(429).json({ code: "ai_limit", message: `You've used all ${pass.ai_total} AI Build actions on your pass.` });

  let raw = str(req.body?.url, 300);
  if (!raw) return res.status(400).json({ code: "bad_request", message: "Enter your website address." });
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let start; try { start = new URL(raw); } catch { return res.status(400).json({ code: "bad_url", message: "That doesn't look like a website address." }); }

  let page, site;
  try {
    page = await safeFetch(start.href, { maxBytes: 600_000, accept: "text/html,application/xhtml+xml" });
    const html = page.bytes.toString("utf8");
    // Inline styles plus the first few stylesheets.
    let css = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).join("\n").slice(0, 300_000);
    const sheets = (html.match(/<link\b[^>]*>/gi) || []).filter(l => /stylesheet/i.test(attr(l, "rel"))).map(l => abs(attr(l, "href"), page.url)).filter(Boolean).slice(0, 4);
    const got = await Promise.allSettled(sheets.map(s => safeFetch(s, { maxBytes: 400_000, accept: "text/css,*/*", timeoutMs: 6000 })));
    for (const g of got) if (g.status === "fulfilled") css += "\n" + g.value.bytes.toString("utf8");
    site = readSite(html, css, page.url);
  } catch (err) {
    const msg = err.code === "bad_url" ? "That address can't be read. Use your public website address."
      : err.code === "not_found" ? "We couldn't find that website. Check the address."
      : "We couldn't read that website. It may block automated visitors; you can still set your brand by hand.";
    return res.status(err.code === "bad_url" ? 400 : 502).json({ code: err.code || "unreachable", message: msg });
  }

  const host = new URL(page.url).hostname.replace(/^www\./, "");
  const prompt = `You are setting up a trade show booth design tool with a company's brand, read from its website.
Website: ${page.url}
Page title: ${site.title}
Site name: ${site.siteName}
Share title: ${site.ogTitle}
Description: ${site.description}
Theme color: ${site.themeColor || "(none)"}
Headings: ${site.heads.join(" | ") || "(none)"}
Page text (start): ${site.text}
Named CSS colors: ${site.vars.join("; ") || "(none)"}
Most used CSS colors (color ×count): ${site.colors.join(", ") || "(none)"}
Fonts: ${site.fonts.join(", ") || "(none)"}
Logo image candidates: ${site.logos.map((l, i) => `[${i}] ${l.url} (alt "${l.alt}")`).join(" ; ") || "(none)"}
Icon candidates: ${site.icons.map((l, i) => `[${i}] ${l.url} (${l.rel} ${l.sizes})`).join(" ; ") || "(none)"}

Reply with only JSON:
{"company": the brand name as it should appear on a booth sign, at most 40 characters,
"tagline": the site's own tagline or headline, shortened if needed, at most 80 characters ("" if none),
"primary": "#rrggbb" the main brand color for the booth's large surfaces and structures,
"secondary": "#rrggbb" a supporting brand color for furniture and trim,
"accent": "#rrggbb" the color for lettering and highlights; it must read clearly on the primary color,
"bg": "#rrggbb" the base or backdrop color,
"graphicStyle": "solid" | "gradient" | "geometric" | "diagonal", whichever suits this brand's look,
"lightStyle": "warm" | "cool" | "daylight" | "accent" | "rgb",
"tone": the brand's voice in at most 12 words, e.g. "confident, scientific, premium",
"style": the visual style in at most 30 words, for an exhibit designer: palette mood, shapes, materials, imagery,
"logoIndex": index of the best logo image candidate, or -1,
"iconIndex": index of the best icon candidate (prefer SVG or the largest), or -1}
Use colors that really appear on the site. Ignore plain greys used only for body text or borders unless the brand is truly monochrome. Never invent a tagline.`;

  try {
    const response = await client.beta.messages.create({
      model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }],
      output_config: { effort: "medium" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return res.status(422).json({ code: "refused", message: "The AI declined to read that site." });
    const d = jsonFrom(response.content.filter(b => b.type === "text").map(b => b.text).join(""));
    if (!d) return res.status(502).json({ code: "invalid_json", message: "The AI's reply couldn't be read. Try again." });
    if (pass) await useAiAction(pass.id).catch(err => console.error("ai action count failed", err?.message));
    const hex = (v, def) => HEX.test(String(v || "")) ? String(v).toLowerCase() : def;
    const pick = (v, list, def) => list.includes(v) ? v : def;
    const logo = site.logos[d.logoIndex]?.url || site.icons[d.iconIndex]?.url || site.icons.find(i => /\.svg/i.test(i.url))?.url || site.icons[0]?.url || "";
    return res.status(200).json({
      site: host, company: str(d.company, 40) || site.siteName || host, tagline: str(d.tagline, 80),
      primary: hex(d.primary, "#1f2937"), secondary: hex(d.secondary, "#374151"), accent: hex(d.accent, "#ffffff"), bg: hex(d.bg, "#101820"),
      graphicStyle: pick(d.graphicStyle, ["solid", "gradient", "geometric", "diagonal"], "solid"),
      lightStyle: pick(d.lightStyle, ["warm", "cool", "daylight", "accent", "rgb"], "warm"),
      tone: str(d.tone, 120), style: str(d.style, 260), fonts: site.fonts.slice(0, 3), logo,
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ code: "rate_limited", message: "The AI is busy. Try again in a moment." });
    console.error("brand api error", err?.status, err?.name, err?.message);
    return res.status(502).json({ code: "server_error", message: "The AI service returned an error. Try again." });
  }
}

export const config = { maxDuration: 60 };
