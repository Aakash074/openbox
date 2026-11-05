// ── OpenBox integration: this is the whole thing ─────────────────────────────
// 1. <script src="/openbox-checkout.js"></script>   2. a <div id="checkout">   3. this:
document.querySelectorAll("[data-sku]").forEach((card) => {
  OpenBox.mount(card.querySelector(".checkout"), {
    publishableKey: "pk_demo_openbox",          // safe in the browser
    sku: card.dataset.sku,                       // price comes from your catalog
    apiBase: window.OPENBOX_API,                 // OpenBox API
    trackBase: window.OPENBOX_WEB,               // buyer tracking page
    wallet: "passkey",                           // embedded key, no wallet popup
    demoFund: true,                              // testnet only: auto top-up USDT
    onPaid: ({ ref, explorerUrl }) => {
      console.log("paid", ref, explorerUrl);     // mark the order paid in your DB
    },
  });
});
// Webhooks (order.paid, order.settled, buyer.refunded, …) arrive at
// POST /webhooks/openbox, signed: X-OpenBox-Signature: t=…,v1=HMAC-SHA256
// ─────────────────────────────────────────────────────────────────────────────
