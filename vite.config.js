import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
