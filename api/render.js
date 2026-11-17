// AI Render: turns the customer's booth into ultra photo-realistic images and videos with fal.ai.
//   POST /api/render { kind: "image"|"video", mode?: "upgrade"|"faithful", image?: <base64 JPEG>, sourceUrl?: <one of our stored AI images>,
//                      direction?: string, brand?: { company, tagline, colors[], bg, font, size, type, tone, style },
//                      logos?: [<base64 JPEG>] the customer's logo artwork, up to 2 }  -> { id }
// Every prompt ends with the brand lock (see brandLock): logo, typeface and colors are reproduced exactly, in every mode.
//   GET  /api/render?id=<render id>  -> the render, checking fal.ai for progress and finishing it when ready
//   GET  /api/render                 -> the customer's renders, newest first
// Needs FAL_KEY in Vercel. One image or video credit is reserved when a render starts and given back if it fails.
//
// Modes for images:
//   upgrade  (default) the 3D render is a layout and brand reference; the AI designs and photographs a premium, custom-built version.
//   faithful           the AI keeps the design exactly and only makes it look real.
// Videos animate a finished AI image when one is given (sourceUrl), so the motion starts from a photo-realistic frame.
import { activePass, dbConfigured, getRender, insertRender, listRenders, refundMediaCredit, storeResult, updateRender, useMediaCredit, userFromToken } from "./_db.js";

const MODELS = {
  // Gemini 3 Pro Image: strongest for design upgrades and crisp brand text. $0.15 per image at 1K, $0.30 at 2K.
  image: process.env.FAL_IMAGE_MODEL || "fal-ai/nano-banana-pro/edit",
  video: process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video",
};
const IMAGE_RESOLUTION = process.env.FAL_IMAGE_RESOLUTION || "2K";

const clean = (v, n) => String(v || "").replace(/[\r\n"]+/g, " ").trim().slice(0, n);
function brandLine(b = {}) {
  const company = clean(b.company, 60), tagline = clean(b.tagline, 100);
  const colors = (Array.isArray(b.colors) ? b.colors : []).map(c => clean(c, 9)).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4);
  const bg = /^#[0-9a-f]{6}$/i.test(clean(b.bg, 9)) ? clean(b.bg, 9) : "";
  return { company, tagline, colors, bg, font: clean(b.font, 60), size: clean(b.size, 30), type: clean(b.type, 20).toLowerCase(), tone: clean(b.tone, 120), style: clean(b.style, 260) };
}
// The brand lock. Logo, typeface and colors are the customer's and are never open to interpretation, in any mode.
// It goes last in every prompt so it has the final word over the style text before it.
function brandLock(b = {}, logoCount = 0) {
  const names = ["primary", "secondary", "accent"], cols = (b.colors || []).map((c, i) => `${names[i] || "brand"} ${c}`);
  if (b.bg) cols.push(`base ${b.bg}`);
  return [
    "BRAND LOCK. These rules are absolute and override every other instruction above, including the photo style:",
    logoCount
      ? `(1) LOGO: the ${logoCount === 1 ? "second attached image is" : "attached images after the first are"} the customer's real logo artwork, shown on a plain grey backing that is not part of the logo. Wherever the booth shows a logo, reproduce that artwork exactly: identical shapes, proportions, letterforms and colors.`
      : "(1) LOGO: wherever the booth in the attached image shows a logo, reproduce it exactly as it appears there: identical shapes, proportions, letterforms and colors.",
    "Never redraw, restyle, simplify, stretch, recolor, outline, bevel or re-letter the logo, never add words or a tagline to it, and never invent any other logo, emblem, icon or brand mark.",
    `(2) TYPEFACE: all brand lettering${b.company ? `, including the name "${b.company}"` : ""}${b.tagline ? ` and the tagline "${b.tagline}"` : ""}, must use exactly the typeface${b.font ? ` "${b.font}"` : ""} shown in the attached booth image: the same letter shapes, weight, width, case and spacing. Never substitute another font or a stylized variant. Any other wording on the booth must use that same typeface, and spell every word exactly as given.`,
    cols.length
      ? `(3) COLORS: the brand colors are exactly ${cols.join(", ")}. Use these exact colors for every branded surface, graphic, sign, light strip, LED edge, screen background and piece of colored furniture. Never shift their hue, saturation or brightness, and never introduce any other brand or accent color. Only neutral white, black, grey and natural material tones (wood, metal, glass, plants) may appear beside them.`
      : "(3) COLORS: keep the booth's colors exactly as they appear in the attached image. Never shift their hue, saturation or brightness, and never introduce any other brand or accent color.",
    "If any earlier instruction conflicts with the brand lock, follow the brand lock.",
  ].join(" ");
}

const PROMPTS = {
  upgrade: (dir, b) => [
    "You are a world-class exhibit designer and an award-winning architectural photographer.",
    "The attached image is only a rough 3D blockout of a trade show booth. Use it as a reference for the booth's footprint, size, open sides, overall layout, camera angle and brand colors, nothing more.",
    `Design and photograph the finished, premium, custom-built version of this booth${b.company ? ` for "${b.company}"` : ""}${b.tagline ? `, tagline "${b.tagline}"` : ""}${b.size ? `, a ${b.size}${b.type ? " " + b.type : ""} booth` : ""}.`,
    "Elevate every element far beyond the blockout: seamless backlit fabric (SEG) walls with soft rounded corners and crisp integrated LED edge lighting; the customer's own logo as a bold illuminated sign, unchanged;",
    "large-format brand graphics with real-looking lifestyle or product photography and short, punchy benefit messaging that fits this brand; a premium reception counter with a backlit branded front panel; a large digital screen with branded content; a slightly raised platform floor with a glowing LED edge; refined modern furniture, live plants and tasteful accent lighting.",
    b.colors.length ? `Use only the brand colors ${b.colors.join(", ")} as the palette, with neutral white surfaces where the design needs relief.` : "Use only the blockout's colors as the brand palette, with neutral white surfaces where the design needs relief.",
    "Make it an ultra photo-realistic, magazine-quality professional photograph from a three-quarter view close to the reference angle, in a real convention center with a high ceiling, truss lighting and neighboring exhibits softly out of focus, with realistic materials, reflections, shadows and depth of field.",
    "The result must look dramatically more enhanced, premium and ambitious than the blockout: a bold design upgrade by a top exhibit house, never a faithful copy of the rough 3D model. The upgrade applies to structure, materials, lighting and photography only: keep the brand name, logo, typeface, colors, footprint and camera angle exactly.",
    "Absolutely no 3D-render or CGI look, no mannequins or placeholder figures, no distorted or misspelled text.",
    b.style || b.tone ? `Match this brand's real look${b.tone ? ` (tone: ${b.tone})` : ""}${b.style ? `: ${b.style}` : ""}.` : "",
    dir ? `Photo style: ${dir}` : "",
    brandLock(b, b.logoCount),
  ].filter(Boolean).join(" "),
  faithful: (dir, b = {}) => [
    "Transform this computer-generated 3D render into a real photograph of a trade show booth, taken with a professional camera at a real convention center.",
    "The result must not look like a 3D render: replace every flat, synthetic surface with real materials, such as printed tension fabric graphics, brushed aluminum frames, real carpet texture, glossy laminate, wood grain and glass, with real reflections, soft shadows and natural light falloff.",
    "Replace the simple placeholder figures with realistic people in business attire, and make the surrounding booths and hall look like a real, detailed exhibition hall with a ceiling, lights and signage.",
    "Keep this booth exactly as designed: same camera angle, layout, size, structures, furniture positions, colors, logos and all wording.",
    dir ? `Photo style: ${dir}` : "",
    brandLock(b, b.logoCount),
  ].filter(Boolean).join(" "),
  video: (dir, fromPhoto) => [
    fromPhoto
      ? "Bring this photograph to life as real camera footage: a smooth, slow cinematic camera move toward the trade show booth at a busy convention center."
      : "Real camera footage, not a 3D animation: a smooth, slow cinematic camera move toward this trade show booth at a busy, real convention center.",
    "Real people in business attire stroll past at a relaxed, natural walking pace, in real time and not sped up or time-lapsed; a few stop to talk with staff at the booth. Movement is calm and lifelike, with no rushing or jerky motion. LED lighting and screens glow naturally.",
    "Keep the booth's design, structures, colors, logos and wording exactly as they are.",
    dir ? `Style: ${dir}` : "",
    "BRAND LOCK, absolute: every logo, every letter and every color stays exactly as in the first frame for the whole clip. Logos and lettering never morph, warp, flicker, blur into other shapes or change typeface; brand colors never shift; no new logos, words or colors appear.",
  ].filter(Boolean).join(" "),
};

const fal = (url, init = {}) => fetch(url, { ...init, headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });

async function currentUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return userFromToken(token).catch(() => null);
}

// Only images we stored ourselves (the customer's own finished AI images) may be animated by URL.
function ownStoredImage(url, userId) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  return typeof url === "string" && url.startsWith(`${base}/storage/v1/object/public/renders/${userId}/`) && /\.(jpe?g|png|webp)$/i.test(url);
}

export default async function handler(req, res) {
  if (!process.env.FAL_KEY || !dbConfigured()) return res.status(503).json({ code: "not_configured", message: "AI Render isn't set up on this server yet." });
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ code: "sign_in_required", message: "Sign in to use AI Render." });

  try {
    if (req.method === "GET") {
      const id = String(req.query?.id || "");
      if (!id) return res.status(200).json({ renders: await listRenders(user.id) });
      const r = await getRender(id, user.id);
      if (!r) return res.status(404).json({ code: "not_found", message: "That render wasn't found." });
      return res.status(200).json({ render: await advance(r) });
    }

    if (req.method === "POST") {
      const { kind, image, sourceUrl, direction, brand } = req.body || {};
      const logos = (Array.isArray(req.body?.logos) ? req.body.logos : []).filter(l => typeof l === "string" && l.length > 200 && l.length < 500_000 && /^[A-Za-z0-9+/=]+$/.test(l)).slice(0, 2);
      const mode = req.body?.mode === "faithful" ? "faithful" : "upgrade";
      if (!MODELS[kind]) return res.status(400).json({ code: "bad_request", message: "Choose image or video." });
      const fromPhoto = kind === "video" && ownStoredImage(sourceUrl, user.id);
      if (!fromPhoto && (typeof image !== "string" || image.length < 1000 || image.length > 3_000_000)) return res.status(400).json({ code: "bad_request", message: "The current view couldn't be captured. Try again." });
      const pass = await activePass(user.email);
      if (!pass) return res.status(402).json({ code: "pass_required", message: "AI Render needs an active pass. See passes and pricing on the website." });
      if (!(await useMediaCredit(pass.id, kind))) return res.status(429).json({ code: "no_credits", message: `You've used all the AI ${kind}s on your pass.` });

      const dir = clean(direction, 600), b = brandLine(brand);
      const multi = kind === "image" && MODELS.image.includes("nano-banana");   // this model takes several reference images
      b.logoCount = multi ? logos.length : 0;
      const prompt = kind === "video" ? PROMPTS.video(dir, fromPhoto) : PROMPTS[mode](dir, b);
      const imageUrl = fromPhoto ? sourceUrl : `data:image/jpeg;base64,${image}`;
      const input = kind === "video"
        ? { prompt, image_url: imageUrl, duration: "10" }
        : MODELS.image.includes("nano-banana")
          ? { prompt, image_urls: [imageUrl, ...logos.map(l => `data:image/jpeg;base64,${l}`)], num_images: 1, output_format: "jpeg", ...(MODELS.image.includes("pro") ? { resolution: IMAGE_RESOLUTION } : { limit_generations: true }) }
          : { prompt, image_url: imageUrl, output_format: "jpeg", guidance_scale: 5 };
      const sub = await fal(`https://queue.fal.run/${MODELS[kind]}`, { method: "POST", body: JSON.stringify(input) });
      const job = await sub.json().catch(() => ({}));
      if (!sub.ok || !job.request_id) {
        await refundMediaCredit(pass.id, kind);
        console.error("fal submit failed", sub.status, JSON.stringify(job).slice(0, 300));
        return res.status(502).json({ code: "render_failed", message: "AI Render couldn't start. Your credit was not used. Try again." });
      }
      const row = await insertRender({
        owner: user.id, pass_id: pass.id, kind, model: MODELS[kind], status: "queued",
        prompt: `${kind === "image" ? mode : fromPhoto ? "from-photo" : "from-view"}: ${dir}`.slice(0, 600),
        fal_request: JSON.stringify({ id: job.request_id, status: job.status_url, response: job.response_url }),
      });
      return res.status(200).json({ id: row.id });
    }

    return res.status(405).end();
  } catch (err) {
    console.error("render error", err?.message);
    return res.status(502).json({ code: "server_error", message: "Something went wrong with AI Render. Try again." });
  }
}

// Checks fal.ai once and moves a queued or running render forward. Finished files are copied to our storage.
async function advance(r) {
  if (r.status === "done" || r.status === "failed") return r;
  let job; try { job = JSON.parse(r.fal_request || "{}"); } catch { job = {}; }
  if (!job.status) return r;
  const st = await fal(job.status).then(x => x.json()).catch(() => null);
  if (!st) return r;
  if (st.status === "IN_QUEUE" || st.status === "IN_PROGRESS") {
    if (r.status !== "running" && st.status === "IN_PROGRESS") { await updateRender(r.id, { status: "running" }); r.status = "running"; }
    return r;
  }
  const out = await fal(job.response).then(async x => ({ ok: x.ok, body: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, body: {} }));
  const url = r.kind === "image" ? out.body?.images?.[0]?.url : out.body?.video?.url;
  if (!out.ok || !url) {
    const error = String(out.body?.detail?.[0]?.msg || out.body?.detail || "The AI service couldn't create this one.").slice(0, 300);
    await updateRender(r.id, { status: "failed", error });
    if (r.pass_id) await refundMediaCredit(r.pass_id, r.kind).catch(() => {});
    return { ...r, status: "failed", error };
  }
  let resultUrl = url;
  try {
    const file = await fetch(url);
    const type = file.headers.get("content-type") || (r.kind === "image" ? "image/jpeg" : "video/mp4");
    const ext = r.kind === "image" ? (type.includes("png") ? "png" : "jpg") : "mp4";
    resultUrl = await storeResult(`${r.owner}/${r.id}.${ext}`, Buffer.from(await file.arrayBuffer()), type);
  } catch (err) {
    console.error("storing render failed, keeping the AI service link", err?.message);
  }
  await updateRender(r.id, { status: "done", result_url: resultUrl });
  return { ...r, status: "done", result_url: resultUrl };
}

export const config = { maxDuration: 60 };
