import type { ReactNode } from "react";
import "../styles/merchant.css";
import "../styles/household.css";

export const metadata = { title: { default: "Household", template: "%s · Household · OpenBox" } };
export default function Layout({ children }: { children: ReactNode }) { return children; }
