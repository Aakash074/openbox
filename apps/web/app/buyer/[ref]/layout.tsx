import type { ReactNode } from "react";
import type { Metadata } from "next";
export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const { ref } = await params;
  return { title: { absolute: `Order ${ref} · Northwind Gadgets` } };
}
export default function Layout({ children }: { children: ReactNode }) { return children; }
