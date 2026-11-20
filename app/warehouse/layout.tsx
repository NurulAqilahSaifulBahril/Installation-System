import type { Metadata, Viewport } from "next";

// page.tsx is a client component and cannot export metadata itself, so
// this layout overrides the root "Installation System" title.
//
// It also makes Inventory Management an installable app (PWA): its own manifest (start and
// scope /warehouse, so the Installation dashboard at / is not part of it), icons for Android and
// iPhone home screens, and the gold theme colour. The service worker is registered by page.tsx.
export const metadata: Metadata = {
  title: "Inventory Management",
  description: "Eternalgy stock, deliveries, and inventory planning.",
  manifest: "/warehouse.webmanifest",
  icons: {
    icon: [
      { url: "/warehouse-icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/warehouse-icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/warehouse-icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Inventory",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#bf9000",
};

export default function WarehouseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
