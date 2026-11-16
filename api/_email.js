// Shared branded email layout and sender (Resend). Underscore name: not a public route.
// Table-based with inline styles so it looks the same in Gmail, Outlook and Apple Mail.
import { LOGO_PNG_BASE64 } from "./_logo.js";

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SANS = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif";
const MONO = "Menlo,Consolas,monospace";

// rows: [[label, valueHtml]], panelHtml: optional boxed block, button: { href, label }, footer: plain text
export function brandedEmail({ eyebrow, title, rows = [], panelHtml = "", button = null, footer = "" }) {
  const row = ([label, value]) => `<tr><td style="padding:6px 14px 6px 0;width:132px;vertical-align:top;font-family:${MONO};font-size:11px;line-height:1.6;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6b7280">${esc(label)}</td><td style="padding:6px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:#111827">${value}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
  ${emailHeader()}
  <tr><td style="padding:26px 24px 6px">
    <div style="font-family:${MONO};font-size:11px;line-height:1;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#2563eb">${esc(eyebrow)}</div>
    <div style="font-family:${SANS};font-size:22px;line-height:1.3;font-weight:700;color:#111827;margin-top:10px">${esc(title)}</div>
  </td></tr>
  ${rows.length ? `<tr><td style="padding:12px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(row).join("")}</table></td></tr>` : ""}
  ${panelHtml ? `<tr><td style="padding:12px 24px 4px"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;font-family:${SANS};font-size:15px;line-height:1.6;color:#111827">${panelHtml}</div></td></tr>` : ""}
  ${button ? `<tr><td style="padding:18px 24px 26px"><a href="${esc(button.href)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-family:${SANS};font-size:14px;line-height:1;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px">${esc(button.label)}</a></td></tr>` : `<tr><td style="padding:10px 24px"></td></tr>`}
  ${emailFooter({ note: footer })}
</table>
</td></tr></table></body></html>`;
}

export const LOGO_ATTACHMENT = { filename: "boothvue-logo.png", content: LOGO_PNG_BASE64, content_id: "bv-logo" };

// Sends a branded email to a customer from CONTACT_FROM. Replies go to SUPPORT_EMAIL (or the first CONTACT_TO).
export async function sendToCustomer({ to, subject, text, html }) {
  const { RESEND_API_KEY, CONTACT_TO, CONTACT_FROM, SUPPORT_EMAIL } = process.env;
  if (!RESEND_API_KEY || !CONTACT_FROM || !to) return false;
  const replyTo = (SUPPORT_EMAIL || String(CONTACT_TO || "").split(",")[0] || "").trim();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: CONTACT_FROM,
      to: [to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: String(subject).replace(/[\r\n]+/g, " ").slice(0, 150),
      text,
      html,
      attachments: [LOGO_ATTACHMENT],
    }),
  });
  if (!r.ok) console.error("resend customer email error", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

// Sends to CONTACT_TO from CONTACT_FROM. Returns true when Resend accepted it; false when not configured or rejected.
export async function sendToOwner({ subject, text, html, replyTo }) {
  const { RESEND_API_KEY, CONTACT_TO, CONTACT_FROM } = process.env;
  if (!RESEND_API_KEY || !CONTACT_TO || !CONTACT_FROM) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: CONTACT_FROM,
      to: CONTACT_TO.split(",").map(s => s.trim()).filter(Boolean),
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: String(subject).replace(/[\r\n]+/g, " ").slice(0, 150),
      text,
      ...(html ? { html, attachments: [LOGO_ATTACHMENT] } : {}),
    }),
  });
  if (!r.ok) console.error("resend error", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

// Shared dark footer for every BoothVue email, matching the FoldVue layout: centred logo and wordmark, tagline,
// three outline buttons, an optional note, support line, policy links and copyright. Returns one <tr> for the card.
export const SITE = (process.env.SITE_URL || "https://staging.boothvue.co").replace(/\/$/, "");
const FF = "Bricolage Grotesque,Arial,Helvetica,sans-serif";
const VUE = "#4f8cff";
export function emailFooter({ note = "", links = [] } = {}) {
  const site = SITE, host = site.replace(/^https?:\/\//, "");
  const btn = (href, label) => `<td style="padding:0 4px"><a href="${href}" style="display:inline-block;padding:7px 13px;border:1.5px solid #c5cbd6;border-radius:999px;font:700 10.5px/1 ${FF};color:#c5cbd6;text-decoration:none;white-space:nowrap">${label}</a></td>`;
  const a = ([label, href]) => `<a href="${href}" style="color:#ffffff;font-weight:700;text-decoration:none">${label}</a>`;
  const share = `mailto:?subject=${encodeURIComponent("Have a look at BoothVue")}&body=${encodeURIComponent("See your trade show booth before it's built: " + site)}`;
  const all = [...links, ["Privacy policy", site + "/privacy/"], ["Terms", site + "/terms/"]];
  return `<tr><td style="height:35px;line-height:35px;font-size:0">&nbsp;</td></tr><tr><td align="center" style="background:#0d1526;padding:49px 28px 30px;text-align:center">
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>
      <td style="vertical-align:middle"><a href="${site}" style="display:block;width:42px;height:42px;background:#2563eb;border-radius:10px;text-decoration:none"><img src="cid:bv-logo" width="27" height="26" alt="BoothVue" style="display:block;border:0;margin:0 auto;padding-top:8px"></a></td>
      <td style="vertical-align:middle;padding-left:11px"><a href="${site}" style="font:700 26px/1 ${FF};color:#ffffff;letter-spacing:-.02em;text-decoration:none">Booth<span style="color:${VUE}">Vue</span></a></td>
    </tr></table>
    <p style="margin:11px 0 18px;font:400 17px/1.3 ${FF};color:#ffffff;letter-spacing:-.01em">See your booth <b>before it&rsquo;s built</b></p>
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 35px"><tr>${btn(site + "/app/", "OPEN THE STUDIO")}${btn(share, "SHARE BOOTHVUE")}${btn(site + "/#contact", "CONTACT US")}</tr></table>
    ${note ? `<p style="margin:0 0 3px;font:11.5px/1.6 ${FF};color:#cfd6e3">${esc(note)}</p>` : ""}
    <p style="margin:0 0 3px;font:11.5px/1.6 ${FF};color:#cfd6e3">Questions? <a href="mailto:support@boothvue.co" style="color:#ffffff;text-decoration:none">support@boothvue.co</a> &middot; <a href="${site}" style="color:#ffffff;text-decoration:none">${host === "staging.boothvue.co" ? "boothvue.co" : host}</a></p>
    <p style="margin:15px 0 6px;font:11.5px/1.6 ${FF};color:#cfd6e3">${all.map(a).join(" &nbsp;|&nbsp; ")}</p>
    <p style="margin:12px 0 0;font:10.5px/1.6 ${FF};color:#8c95a6">&copy; ${new Date().getFullYear()} <b style="color:#cfd6e3">BoothVue&trade;</b>. All rights reserved. BoothVue and the BoothVue logo are trademarks of 8ThirtyOne.</p>
  </td></tr>`;
}

// Dark header for every BoothVue email, matching FoldVue: logo, wordmark with "Vue" in blue, tagline underneath.
export function emailHeader() {
  return `<tr><td style="background:#0d1526;padding:24px 28px 22px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:34px;vertical-align:top"><a href="${SITE}" style="display:block;width:34px;height:34px;background:#2563eb;border-radius:8px;text-decoration:none"><img src="cid:bv-logo" width="22" height="21" alt="BoothVue" style="display:block;border:0;margin:0 auto;padding-top:6px"></a></td>
    <td style="padding-left:10px;font:700 22px/1 ${FF};color:#ffffff;letter-spacing:-.02em">Booth<span style="color:${VUE}">Vue</span><div style="margin-top:5px;font:400 14px/1.3 ${FF};color:#aab3c3;letter-spacing:0">See your booth before it&rsquo;s built</div></td>
  </tr></table></td></tr>`;
}
