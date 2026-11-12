// AI-generated with Claude Code, 2026-10-09, reviewed by Hyun Park
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) =>
  mode === "viewer"
    ? {
        // Second entry: the view-only viewer for Share › Export. One classic script (iife) plus one stylesheet, so an
        // exported copy also opens from file:// (module scripts do not load there)
        plugins: [react()],
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: {
          outDir: "../dist/viewer",
          emptyOutDir: true,
          copyPublicDir: false,
          lib: { entry: "src/viewerMain.tsx", formats: ["iife"], name: "EaselViewer", fileName: () => "viewer.js", cssFileName: "viewer" },
        },
      }
    : {
        plugins: [react()],
        // App files go under /_app/ so they do not collide with the design folder's /assets/ (images)
        base: "/_app/",
        build: { outDir: "../dist", emptyOutDir: true },
      },
);
