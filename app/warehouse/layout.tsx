import type { Metadata } from "next";

// page.tsx is a client component and cannot export metadata itself, so
// this layout overrides the root "Scheduling Operations" title.
export const metadata: Metadata = {
  title: "Inventory Management",
  description: "Eternalgy stock, deliveries, and inventory planning.",
};

export default function WarehouseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
