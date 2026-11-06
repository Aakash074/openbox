import type { IconName } from "./ui";

/** The four role apps of the demo. Each has a sample account so judges can hop between roles without signing in. */
export type Role = "merchant" | "household" | "courier" | "lender";

/** Display name of the demo lender (the address stays in tooltips and explorer links). */
export const LENDER_NAME = process.env.NEXT_PUBLIC_LENDER_NAME ?? "Harbor Credit";
/** Sample household: the home whose doorbell receives every demo parcel. */
export const HOUSEHOLD_NAME = "Mehta household";
export const HOUSEHOLD_OWNER = "Priya Mehta";

export type NavItem = { href: string; label: string; external?: boolean };
export type RoleApp = { role: Role; label: string; account: string; sub: string; home: string; icon: IconName; nav: NavItem[] };

const STORE = process.env.NEXT_PUBLIC_STORE_URL ?? "";

export const ROLE_APPS: Record<Role, RoleApp> = {
  merchant: {
    role: "merchant", label: "Merchant", account: "Northwind Gadgets", sub: "Seller dashboard", home: "/merchant", icon: "store",
    nav: [
      { href: "/merchant", label: "Orders" },
      { href: "/merchant/advances", label: "Get paid early" },
      { href: "/merchant/inspections", label: "Inspections" },
      { href: "/merchant/developers", label: "Developers" },
      ...(STORE ? [{ href: STORE, label: "Storefront", external: true }] : []),
    ],
  },
  household: {
    role: "household", label: "Household", account: HOUSEHOLD_NAME, sub: `Front door · ${HOUSEHOLD_OWNER}`, home: "/home", icon: "home",
    nav: [
      { href: "/home", label: "Deliveries" },
      { href: "/kiosk", label: "Doorbell" },
      { href: "/home/agent", label: "Household agent" },
      { href: "/home/approvals", label: "Approvals" },
    ],
  },
  courier: {
    role: "courier", label: "Courier", account: "Alice · courier", sub: "Verified courier", home: "/courier", icon: "truck",
    nav: [{ href: "/courier", label: "Check-in" }],
  },
  lender: {
    role: "lender", label: "Lender", account: LENDER_NAME, sub: "Receivables desk", home: "/lender", icon: "coins",
    nav: [
      { href: "/lender", label: "Marketplace" },
      { href: "/lender?view=active", label: "Active" },
      { href: "/lender?view=closed", label: "Closed" },
    ],
  },
};
export const ROLE_ORDER: Role[] = ["merchant", "household", "courier", "lender"];
