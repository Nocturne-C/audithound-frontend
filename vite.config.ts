import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { createAuditDataPlugin } from "./server/data";

export default defineConfig({
  plugins: [react(), createAuditDataPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          icons: ["lucide-react"],
          markdown: ["react-markdown", "remark-gfm"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
