/** The one checkout integration snippet, shared by the landing page and the merchant Quickstart so they never drift. */
export const CHECKOUT_SNIPPET_HTML = `<script src="https://cdn.openbox.dev/openbox-checkout.js"></script>
<div id="checkout"></div>
<script>
  OpenBox.mount("#checkout", {
    publishableKey: "pk_demo_openbox",   // safe in the browser
    sku: "aurora-x1",                    // price from your catalog
    wallet: "passkey",                   // embedded key, no popup
    onPaid: ({ ref }) => markPaid(ref),
  });
</script>`;
