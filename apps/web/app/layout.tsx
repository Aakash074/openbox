import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

// Inter (variable, with the optical-size axis so `font-optical-sizing: auto` tightens display sizes)
// and JetBrains Mono for refs/hashes (slashed zero via font-feature-settings "zero", see globals.css).
const inter = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://openbox-checkout.vercel.app"),
  title: { default: "OpenBox · Checkout with verified release", template: "%s · OpenBox" },
  description: "Payment held until delivery is verified. Settled in USDT on Whitechain.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F766E" };

// Panes inside /demo load with ?embed=1: mark <html> before paint so the app bar never flashes.
const EMBED = `try{if(new URLSearchParams(location.search).has("embed"))document.documentElement.setAttribute("data-embed","")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: EMBED }} /></head>
      <body>{children}</body>
    </html>
  );
}
