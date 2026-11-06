// OpenBox integration: this is the whole thing.
// 1. <script src="/openbox-checkout.js"></script>
// 2. a <div class="checkout"> in each product card
// 3. this:
document.querySelectorAll("[data-sku]").forEach((card) => {
  OpenBox.mount(card.querySelector(".checkout"), {
    publishableKey: "pk_demo_openbox", // safe in the browser
    sku: card.dataset.sku,             // price from your catalog
    apiBase: window.OPENBOX_API,
    trackBase: window.OPENBOX_WEB,     // buyer tracking page
    wallet: "passkey",                 // no wallet popup
    demoFund: true,                    // testnet: auto top-up
    onPaid: ({ ref, explorerUrl }) => {
      console.log("paid", ref, explorerUrl); // mark paid in your DB
    },
  });
});
// Webhooks: POST /webhooks/openbox
// signed X-OpenBox-Signature: t=…,v1=HMAC-SHA256
