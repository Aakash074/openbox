import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "OpenBox · Checkout with verified release", template: "%s · OpenBox" },
  description: "Payment held until delivery is verified. Settled in USDT on Whitechain.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F766E" };

// Panes inside /demo load with ?embed=1: mark <html> before paint so the app bar never flashes.
const EMBED = `try{if(new URLSearchParams(location.search).has("embed"))document.documentElement.setAttribute("data-embed","")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: EMBED }} /></head>
      <body>{children}</body>
    </html>
  );
}
