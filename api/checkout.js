// POST /api/checkout -> { url } of a Stripe Checkout page.
//   { plan: "week" | "month" | "year" }        a pass, bought from the website
//   { items: { ai, image, video } }             extra credits in one cart (each 0..20), bought from the app by a signed-in customer
//                                               with an active pass (Authorization: Bearer <access token>)
// Needs STRIPE_SECRET_KEY in Vercel (sk_test_... while testing, sk_live_... at launch).
import { ADDONS, ADDON_MAX_QTY, PLANS } from "./_plans.js";
import { activePass, dbConfigured, userFromToken } from "./_db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed" });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(503).json({ code: "not_configured", message: "Checkout isn't set up yet." });

  const body = req.body || {};
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  let form;

  if (body.addon != null || body.items != null) {
    // One cart: { items: { ai: n, image: n, video: n } } (old single form { addon, qty } still works).
    const raw = body.items && typeof body.items === "object" ? body.items : { [String(body.addon)]: body.qty };
    const cart = Object.entries(raw).map(([k, q]) => [k, Math.floor(Number(q)) || 0]).filter(([, q]) => q > 0);
    if (!cart.length || cart.some(([k, q]) => !ADDONS[k] || q > ADDON_MAX_QTY)) return res.status(400).json({ code: "bad_request", message: `Choose images, videos or AI Build actions, 1 to ${ADDON_MAX_QTY} each.` });
    if (!dbConfigured()) return res.status(503).json({ code: "not_configured", message: "Buying extra credits isn't set up yet." });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await userFromToken(token).catch(() => null);
    if (!user) return res.status(401).json({ code: "sign_in_required", message: "Sign in to buy extra credits." });
    const pass = await activePass(user.email).catch(() => null);
    if (!pass) return res.status(402).json({ code: "pass_required", message: "Extra credits are added to an active pass. Buy a pass first." });
    const until = new Date(pass.ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    form = new URLSearchParams({
      mode: "payment",
      "invoice_creation[enabled]": "true", // a PDF invoice for every purchase; Stripe emails it with the receipt
      customer_email: user.email,
      "metadata[items]": cart.map(([k, q]) => `${k}:${q}`).join(","),
      "metadata[addon]": cart.map(([k]) => k).join(","),
      "metadata[pass_id]": pass.id,
      "payment_intent_data[metadata][items]": cart.map(([k, q]) => `${k}:${q}`).join(","),
      success_url: `${origin}/app/?credits=added&kind=${cart[0][0]}`,
      cancel_url: `${origin}/app/`,
    });
    cart.forEach(([k, q], i) => {
      const addon = ADDONS[k], p = `line_items[${i}]`;
      form.set(`${p}[quantity]`, String(q));
      form.set(`${p}[price_data][currency]`, "usd");
      form.set(`${p}[price_data][unit_amount]`, String(addon.amount));
      form.set(`${p}[price_data][product_data][name]`, `BoothVue ${addon.name}`);
      form.set(`${p}[price_data][product_data][description]`, k === "ai"
        ? `Each pack adds 10 AI Build actions to your pass (AI Build, photo to 3D, prompt writing). Use them by ${until}, when your pass ends.`
        : `Added to your pass for photo-realistic AI Render ${k === "video" ? "10-second videos" : "images"}. Use them by ${until}, when your pass ends.`);
    });
  } else {
    const planId = String(body.plan || "");
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ code: "bad_request", message: "Unknown pass." });
    form = new URLSearchParams({
      mode: "payment",
      "invoice_creation[enabled]": "true", // a PDF invoice for every purchase; Stripe emails it with the receipt
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(plan.amount),
      "line_items[0][price_data][product_data][name]": `BoothVue ${plan.name}`,
      "line_items[0][price_data][product_data][description]": `${plan.days} days of full access, ${plan.ai} AI Build actions, ${plan.images} AI images and ${plan.videos} 10-second AI video${plan.videos === 1 ? "" : "s"}. One-time payment, no subscription.`,
      customer_creation: "always",
      billing_address_collection: "auto",
      "metadata[plan]": planId,
      "payment_intent_data[metadata][plan]": planId,
      success_url: `${origin}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing/`,
    });
  }

  // Sales tax: Stripe Tax adds it at checkout where BoothVue is registered (Texas first). Off until STRIPE_AUTOMATIC_TAX=1
  // is set in Vercel. Prices are tax-exclusive (tax is added on top); the tax code comes from the Stripe Tax default (SaaS).
  if (process.env.STRIPE_AUTOMATIC_TAX === "1") {
    form.set("automatic_tax[enabled]", "true");
    form.set("billing_address_collection", "required");
    for (let i = 0; form.has(`line_items[${i}][quantity]`); i++) form.set(`line_items[${i}][price_data][tax_behavior]`, "exclusive");
  }

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("stripe checkout error", r.status, data?.error?.type, data?.error?.message);
      return res.status(502).json({ code: "stripe_error", message: "Checkout couldn't start. Please try again." });
    }
    return res.status(200).json({ url: data.url });
  } catch (err) {
    console.error("stripe checkout request failed", err?.message);
    return res.status(502).json({ code: "network", message: "Couldn't reach the payment service." });
  }
}
