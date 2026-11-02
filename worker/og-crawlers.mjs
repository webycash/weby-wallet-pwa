// Link-preview crawlers that get the payment-link OG card instead of the
// wallet. One list, shared by the wallet Worker (which routes them to the
// OG card Worker) and the OG card Worker itself.
export const OG_CRAWLERS =
  /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|Applebot|iMessageLinkPreviews|Googlebot|bingbot/i;

/**
 * Does this wallet request belong to the OG card Worker? The card images
 * (`<base>/og-card.png`, `<base>/og.png`) and a crawler fetching a payment
 * link (`?amount=`) do; everything else is the wallet.
 * @param {URL} url
 * @param {string} userAgent
 * @param {string} base  the tier's WALLET_BASE_PATH, e.g. `/wallet`
 */
export function isOgRequest(url, userAgent, base) {
  if (url.pathname === `${base}/og-card.png` || url.pathname === `${base}/og.png`) return true;
  return url.searchParams.has('amount') && OG_CRAWLERS.test(userAgent ?? '');
}
