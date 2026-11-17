import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/favicon-32.png"],
      manifest: {
        name: "FSL Sign Language Recognition",
        short_name: "FSL",
        description: "Real-time Filipino Sign Language recognition and translation",
        theme_color: "#7e14ff",
        background_color: "#ede6ff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // App is camera/recognition-driven and talks to a live backend — never
        // let the service worker serve stale API/AI responses. Only the static
        // app shell (JS/CSS/HTML/icons/sign images) gets precached for fast,
        // installable loads; everything under /api and /ai always hits the network.
        navigateFallbackDenylist: [/^\/api/, /^\/ai/],
        runtimeCaching: [
          {
            urlPattern: /^\/(api|ai)\//,
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        // lets you test install/offline behavior with `npm run dev` too
        enabled: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
      "/ai": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
