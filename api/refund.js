// POST /api/refund (Authorization: Bearer <access token>) -> { ok: true } or { code, message }
// Self-serve refund for a signed-in customer's current pass, following the Refund Policy:
// within 48 hours of purchase, and only if no AI Build or AI Render has been used.
// Passes with extra credits bought on top are left to support. The refund itself is issued in Stripe; the pass
// ends right away here, and the charge.refunded webhook then sends the owner notice (Stripe sends the customer receipt).
import { PLANS } from "./_plans.js";
import { activePass, dbConfigured, endPassForRefund, userFromToken } from "./_db.js";

const WINDOW_MS = 48 * 60 * 60 * 1000;

export function refundBlock(pass, now = Date.now()) {
  if (!pass) return { code: "no_pass", message: "There's no active pass on this account to refund." };
  if (pass.refunded_at) return { code: "already_refunded", message: "This pass has already been refunded." };
  if (now - new Date(pass.starts_at).getTime() > WINDOW_MS) return { code: "too_late", message: "Self-serve refunds are available for 48 hours after purchase. Email support@boothvue.co and we'll take a look." };
  if (pass.ai_used > 0 || pass.images_used > 0 || pass.videos_used > 0) return { code: "used", message: "Refunds are available only before any AI Build or AI Render has been used. Email support@boothvue.co if something went wrong." };
  const plan = PLANS[pass.plan];
  if (!plan || pass.ai_total > plan.ai || pass.images_total > plan.images || pass.videos_total > plan.videos) return { code: "extras", message: "This pass has extra credits on it, so we'll handle the refund by hand. Email support@boothvue.co." };
  if (!pass.stripe_session) return { code: "no_payment", message: "We couldn't find the payment for this pass. Email support@boothvue.co." };
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "method_not_allowed" });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !dbConfigured()) return res.status(503).json({ code: "not_configured", message: "Refunds aren't available right now." });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token).catch(() => null);
  if (!user) return res.status(401).json({ code: "sign_in_required", message: "Sign in to request a refund." });

  const pass = await activePass(user.email).catch(() => null);
  const block = refundBlock(pass);
  if (block) return res.status(400).json(block);

  const stripe = (path, init) => fetch(`https://api.stripe.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", ...(init?.headers || {}) } }).then(r => r.json());
  try {
    const session = await stripe(`checkout/sessions/${encodeURIComponent(pass.stripe_session)}`);
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!pi) return res.status(400).json({ code: "no_payment", message: "We couldn't find the payment for this pass. Email support@boothvue.co." });
    const refund = await stripe("refunds", {
      method: "POST",
      headers: { "Idempotency-Key": `self-refund-${pass.id}` },
      body: new URLSearchParams({ payment_intent: pi, reason: "requested_by_customer", "metadata[source]": "self_serve", "metadata[pass_id]": pass.id }),
    });
    if (refund.error) {
      console.error("self refund error", refund.error.type, refund.error.message);
      return res.status(502).json({ code: "stripe_error", message: "The refund couldn't be issued. Email support@boothvue.co and we'll sort it out." });
    }
    await endPassForRefund(pass.id).catch(() => null);   // access ends now; the webhook will find it already handled
    console.log("self refund", JSON.stringify({ pass: pass.id, plan: pass.plan, refund: refund.id, status: refund.status }));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("self refund failed", err?.message);
    return res.status(502).json({ code: "network", message: "Couldn't reach the payment service. Try again in a minute." });
  }
}
