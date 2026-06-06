import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web公開向け設定。
// Vercel / Cloudflare Pages は base: "/" のままでOK。
// GitHub Pagesのサブパス公開だけは VITE_BASE_PATH=/リポジトリ名/ を指定する。
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});
