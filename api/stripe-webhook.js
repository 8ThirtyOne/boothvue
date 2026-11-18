// POST /api/stripe-webhook — Stripe calls this when a payment completes.
// Needs STRIPE_WEBHOOK_SECRET (whsec_...) from the webhook endpoint in Stripe.
// Every notice is checked against Stripe's signature before it is trusted.
// For now a completed purchase is logged and emailed to CONTACT_TO; once accounts exist,
// this is where the buyer's pass and credits get switched on.
import crypto from "node:crypto";
import { ADDONS, PLANS } from "./_plans.js";
import { brandedEmail, esc, sendToCustomer, sendToOwner } from "./_email.js";
import { addAiActions, addMediaCredits, dbConfigured, endPassForRefund, passById, passBySession, recordPass, recordTopup, takeBackTopup, topupsBySession } from "./_db.js";

const TOLERANCE_SECONDS = 300;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Stripe's scheme: header "t=<unix>,v1=<hex hmac>"; HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret.
function verify(raw, header, secret) {
  const parts = Object.fromEntries(String(header || "").split(",").map(p => p.split("=", 2)).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = String(header || "").split(",").filter(p => p.trim().startsWith("v1=")).map(p => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(raw).digest("hex");
  const exp = Buffer.from(expected, "hex");
  return sigs.some(s => { const b = Buffer.from(s, "hex"); return b.length === exp.length && crypto.timingSafeEqual(b, exp); });
}


export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "not_configured" });

  const raw = await readRawBody(req);
  if (!verify(raw, req.headers["stripe-signature"], secret)) return res.status(400).json({ error: "bad_signature" });

  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "bad_json" }); }

  if (event.type === "charge.refunded") return handleRefund(res, event);

  if (event.type === "checkout.session.completed") {
    const s = event.data?.object || {};
    if (s.metadata?.addon || s.metadata?.items) return handleTopup(req, res, event, s);
    const plan = PLANS[s.metadata?.plan];
    const email = s.customer_details?.email || "unknown";
    const paid = s.amount_total != null ? `$${(s.amount_total / 100).toFixed(2)} ${String(s.currency || "").toUpperCase()}` : "unknown";
    const mode = event.livemode ? "LIVE" : "TEST";
    console.log("purchase", JSON.stringify({ mode, plan: s.metadata?.plan, email, paid, session: s.id, status: s.payment_status }));
    let recorded = false, newRow = null;
    if (s.payment_status === "paid" && plan && email !== "unknown" && dbConfigured()) {
      try {
        newRow = await recordPass({ email, plan: s.metadata.plan, days: plan.days, images: plan.images, videos: plan.videos, ai: plan.ai, amountCents: s.amount_total ?? null, livemode: !!event.livemode, stripeSession: s.id });
        recorded = true;
      } catch (err) {
        console.error("record pass failed", err?.message);
        return res.status(500).json({ error: "record_failed" }); // Stripe retries later
      }
    }
    // Only email the first time a pass is recorded, so a resent Stripe notice doesn't send duplicates.
    const firstTime = !dbConfigured() || !!newRow;
    if (s.payment_status === "paid" && firstTime) {
      const passName = plan ? plan.name : s.metadata?.plan || "Pass";
      const test = !event.livemode;
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      const dashboard = `https://dashboard.stripe.com/${test ? "test/" : ""}${pi ? `payments/${pi}` : "payments"}`;
      const rows = [
        ["Pass", esc(passName)],
        ["Amount", esc(paid)],
        ["Customer", `<a href="mailto:${esc(email)}" style="color:#2563eb;text-decoration:none">${esc(email)}</a>`],
      ];
      if (plan) rows.push(["Includes", esc(`${plan.days} days, ${plan.ai} AI Build actions, ${plan.images} AI images, ${plan.videos} 10-second AI video${plan.videos === 1 ? "" : "s"}`)]);
      rows.push(["Mode", test ? "Test payment" : "Live payment"]);
      const html = brandedEmail({
        eyebrow: test ? "Payment received · test" : "Payment received",
        title: `${passName} purchased for ${paid}`,
        rows,
        panelHtml: recorded ? "The pass is switched on. The customer can sign in to the app with this email to use it." : "This pass couldn't be switched on automatically, so it still needs to be activated by hand.",
        button: { href: dashboard, label: "View in Stripe" },
        footer: `Stripe session ${s.id}`,
      });
      const text = [`${mode} purchase on BoothVue`, "", `Pass: ${passName}`, `Amount: ${paid}`, `Customer: ${email}`, `Stripe: ${dashboard}`, "", recorded ? "The pass is switched on." : "This pass still needs to be activated by hand."].join("\n");
      await sendToOwner({ subject: `${test ? "[Test] " : ""}New purchase: ${passName} (${paid})`, text, html, replyTo: email !== "unknown" ? email : undefined });

      // Confirmation to the customer
      if (plan && email !== "unknown") {
        const site = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
        const endsAt = newRow?.ends_at ? new Date(newRow.ends_at) : new Date(Date.now() + plan.days * 864e5);
        const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
        const includes = `${plan.days} days of full access, ${plan.ai} AI Build actions, ${plan.images} AI images, ${plan.videos} 10-second AI video${plan.videos === 1 ? "" : "s"}`;
        const steps = recorded
          ? `1. Open the app and click <b>Sign in</b>.<br>2. Enter <b>${esc(email)}</b> and open the sign-in link we email you.<br>3. Your pass and credits appear under <b>Account</b>.`
          : "Your pass is being switched on and will be ready shortly. We'll be in touch if anything is needed.";
        const custHtml = brandedEmail({
          eyebrow: test ? "Payment confirmed · test" : "Payment confirmed",
          title: `Your ${passName} is ready`,
          rows: [
            ["Pass", esc(passName)],
            ["Amount paid", esc(paid)],
            ["Includes", esc(includes)],
            ["Active until", esc(until)],
            ["Account email", esc(email)],
          ],
          panelHtml: steps,
          button: { href: `${site}/app/#signin`, label: "Open BoothVue" },
          footer: "Thanks for choosing BoothVue. Your invoice and card receipt come separately from Stripe. Questions? Just reply to this email.",
        });
        const custText = [
          `Your ${passName} is ready${test ? " (test purchase)" : ""}.`, "",
          `Pass: ${passName}`, `Amount paid: ${paid}`, `Includes: ${includes}`, `Active until: ${until}`, `Account email: ${email}`, "",
          recorded ? `Open ${site}/app/ and sign in with ${email} to start designing.` : "Your pass is being switched on and will be ready shortly.",
          "", "Your invoice and card receipt come separately from Stripe. Questions? Just reply to this email.",
        ].join("\n");
        await sendToCustomer({ to: email, subject: `${test ? "[Test] " : ""}Your BoothVue ${passName} is ready`, text: custText, html: custHtml });
      }

    }
  }

  return res.status(200).json({ received: true });
}

// Extra credits (AI Render images and videos, AI Build actions in packs of 10), possibly several kinds in one cart:
// each kind is added to the pass it was bought for, once per Stripe session.
async function handleTopup(req, res, event, s) {
  const items = (s.metadata.items ? s.metadata.items.split(",").map(x => x.split(":")) : [[s.metadata.addon, s.metadata.qty]])
    .map(([k, q]) => [k, Math.floor(Number(q))]).filter(([k, q]) => ADDONS[k] && q > 0);
  const passId = String(s.metadata.pass_id || "");
  const email = s.customer_details?.email || s.customer_email || "unknown";
  const paid = s.amount_total != null ? `$${(s.amount_total / 100).toFixed(2)} ${String(s.currency || "").toUpperCase()}` : "unknown";
  const test = !event.livemode;
  console.log("topup", JSON.stringify({ mode: test ? "TEST" : "LIVE", items, email, paid, session: s.id, status: s.payment_status }));
  if (s.payment_status !== "paid" || !items.length || !passId || !dbConfigured()) return res.status(200).json({ received: true });

  const noun = k => k === "ai" ? "AI Build action" : k === "video" ? "10-second AI video" : "AI image";
  const lines = [];
  let allAdded = true, any = false;
  for (const [kind, qty] of items) {
    const units = kind === "ai" ? qty * (ADDONS.ai.per || 10) : qty; // AI Build actions are sold in packs
    lines.push({ kind, units, what: `${units} extra ${noun(kind)}${units === 1 ? "" : "s"}` });
    try {
      // One row per kind. A one-kind cart keeps the plain session id, as before.
      const key = items.length === 1 ? s.id : `${s.id}#${kind}`;
      const row = await recordTopup({ stripeSession: key, passId, email: email === "unknown" ? "" : email, kind, qty: units, amountCents: items.length === 1 ? (s.amount_total ?? null) : null, livemode: !!event.livemode });
      if (!row) continue; // already handled
      any = true;
      const ok = kind === "ai" ? await addAiActions(passId, units) : await addMediaCredits(passId, kind, qty);
      if (!ok) allAdded = false;
    } catch (err) {
      console.error("topup failed", kind, err?.message);
      return res.status(500).json({ error: "record_failed" }); // Stripe retries; kinds already recorded are skipped then
    }
  }
  if (!any) return res.status(200).json({ received: true, duplicate: true });
  const pass = await passById(passId).catch(() => null);

  const what = lines.map(l => l.what).join(", ");
  const plural = lines.length > 1 || lines[0].units !== 1;
  const leftOf = k => !pass ? null : k === "ai" ? pass.ai_total - pass.ai_used : k === "image" ? pass.images_total - pass.images_used : pass.videos_total - pass.videos_used;
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  const dashboard = `https://dashboard.stripe.com/${test ? "test/" : ""}${pi ? `payments/${pi}` : "payments"}`;
  const html = brandedEmail({
    eyebrow: test ? "Payment received · test" : "Payment received",
    title: `Extra credits purchased for ${paid}`,
    rows: [...lines.map(l => ["Credits", esc(l.what)]), ["Amount", esc(paid)], ["Customer", esc(email)], ["Mode", test ? "Test payment" : "Live payment"]],
    panelHtml: allAdded ? "The credits were added to the customer's pass." : "Some credits couldn't be added automatically, so they still need to be added by hand.",
    button: { href: dashboard, label: "View in Stripe" },
    footer: `Stripe session ${s.id}`,
  });
  await sendToOwner({ subject: `${test ? "[Test] " : ""}Extra credits: ${what} (${paid})`, text: `${what} for ${paid} from ${email}. ${allAdded ? "Added to the pass." : "Needs adding by hand."}\n${dashboard}`, html, replyTo: email !== "unknown" ? email : undefined });

  if (email !== "unknown") {
    const site = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const until = pass ? new Date(pass.ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
    const rows = [...lines.map(l => ["Added", esc(l.what)]), ["Amount paid", esc(paid)]];
    for (const l of lines) { const left = leftOf(l.kind); if (left != null) rows.push([l.kind === "ai" ? "AI Build actions now left" : l.kind === "image" ? "Images now left" : "Videos now left", String(left)]); }
    if (until) rows.push(["Use them by", esc(until)]);
    const where = lines.every(l => l.kind === "ai") ? "AI Build" : lines.some(l => l.kind === "ai") ? "AI Build or AI Render" : "AI Render";
    await sendToCustomer({
      to: email,
      subject: `${test ? "[Test] " : ""}Your extra credits ${plural ? "are" : "is"} ready`,
      text: `${what} ${plural ? "were" : "was"} added to your BoothVue pass${until ? `. Use ${plural ? "them" : "it"} by ${until}` : ""}.\nOpen ${site}/app/ and click ${where}.`,
      html: brandedEmail({
        eyebrow: test ? "Payment confirmed · test" : "Payment confirmed",
        title: `Your extra credits ${plural ? "are" : "is"} ready`,
        rows,
        panelHtml: allAdded ? `Already on your pass. Open the app and click <b>${where}</b> to use them.` : "They're being added to your pass and will be ready shortly.",
        button: { href: `${site}/app/`, label: "Open BoothVue" },
        footer: "Your invoice and card receipt come separately from Stripe. Questions? Just reply to this email.",
      }),
    });
  }
  return res.status(200).json({ received: true });
}

// Refunds. A full refund ends the pass right away, or takes back the extras that were bought.
// A partial refund changes nothing automatically; you get an email to decide.
async function handleRefund(res, event) {
  const ch = event.data?.object || {};
  const key = process.env.STRIPE_SECRET_KEY;
  const stripe = path => fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` } }).then(r => r.json());
  const idOf = v => (typeof v === "string" ? v : v?.id) || null;
  // Newer Stripe API versions can leave the payment intent off the refunded charge; fetch the charge itself if needed.
  let pi = idOf(ch.payment_intent);
  if (!pi && ch.id && key) { try { pi = idOf((await stripe(`charges/${encodeURIComponent(ch.id)}`))?.payment_intent); } catch {} }
  const full = ch.refunded === true || (ch.amount > 0 && ch.amount_refunded >= ch.amount), test = !event.livemode;
  const money = c => `$${(c / 100).toFixed(2)}`;
  console.log("refund", JSON.stringify({ mode: test ? "TEST" : "LIVE", charge: ch.id, pi, full, refunded: ch.amount_refunded, of: ch.amount, keys: Object.keys(ch).slice(0, 60) }));
  if (!key || !dbConfigured()) return res.status(200).json({ received: true, skipped: "not_configured" });
  if (!pi) return res.status(200).json({ received: true, skipped: "no_payment_intent", charge: ch.id || null });

  // Which purchase was this? Find its checkout session, then the pass or extras recorded for it.
  let session = null;
  try {
    const list = await stripe(`checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=1`);
    if (list?.error) console.error("refund session lookup error", list.error.message);
    session = list?.data?.[0] || null;
  } catch (err) { console.error("refund lookup failed", err?.message); return res.status(500).json({ error: "lookup_failed" }); }
  if (!session) return res.status(200).json({ received: true, skipped: "no_checkout_session", payment_intent: pi });

  let what = "", outcome = "";
  try {
    const pass = await passBySession(session.id), topups = pass ? [] : await topupsBySession(session.id);
    const topup = topups[0];
    const email = pass?.email || topup?.email || session.customer_details?.email || "unknown";
    if (pass) {
      what = `${PLANS[pass.plan]?.name || pass.plan} for ${email}`;
      if (!full) outcome = "Partial refund: the pass is still active. End it in Supabase if needed.";
      else outcome = (await endPassForRefund(pass.id)) ? "The pass has been ended, so the customer no longer has access." : "This refund was already handled.";
    } else if (topup) {
      const noun = k => k === "ai" ? "AI Build actions" : k === "video" ? "10-second AI videos" : "AI images";
      what = `${topups.map(t => `${t.qty} extra ${noun(t.kind)}`).join(", ")} for ${email}`;
      if (!full) outcome = "Partial refund: the extras are still on the pass.";
      else { let took = false; for (const t of topups) if (await takeBackTopup(t)) took = true;
        outcome = took ? "The extras were taken back from the pass (any already used stay used)." : "This refund was already handled."; }
    } else {
      return res.status(200).json({ received: true, skipped: "no_matching_purchase", session: session.id });
    }
  } catch (err) {
    console.error("refund failed", err?.message);
    return res.status(500).json({ error: "refund_failed" }); // Stripe retries later
  }

  const dashboard = `https://dashboard.stripe.com/${test ? "test/" : ""}payments/${pi}`;
  const amount = `${money(ch.amount_refunded || 0)} of ${money(ch.amount || 0)}`;
  await sendToOwner({
    subject: `${test ? "[Test] " : ""}Refund: ${what} (${amount})`,
    text: `${full ? "Full" : "Partial"} refund of ${amount}: ${what}.\n${outcome}\n${dashboard}`,
    html: brandedEmail({
      eyebrow: test ? "Refund · test" : "Refund",
      title: `${full ? "Refunded" : "Partly refunded"}: ${what}`,
      rows: [["Refunded", esc(amount)], ["Purchase", esc(what)], ["Mode", test ? "Test payment" : "Live payment"]],
      panelHtml: esc(outcome),
      button: { href: dashboard, label: "View in Stripe" },
      footer: `Stripe session ${session.id}`,
    }),
  });
  return res.status(200).json({ received: true, refund: full ? "full" : "partial", outcome });
}
