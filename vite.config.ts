import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Fully static client-side app. No server, no API routes, no env needed.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
  },
});
