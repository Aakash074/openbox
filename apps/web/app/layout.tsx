import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "OpenBox · pay on proof", description: "Checkout with verified release, settled in USDT on Whitechain" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
