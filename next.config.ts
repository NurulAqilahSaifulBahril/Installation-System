import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.0.32", "192.168.*.*"],
  distDir: ".next-build",
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackBuildWorker: false,
    useTypeScriptCli: true,
  },
  // Inventory Management app (PWA): the service worker is never cached, so phones pick up a new
  // version straight away.
  async headers() {
    return [
      {
        source: "/warehouse-sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/warehouse" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

};

export default nextConfig;
