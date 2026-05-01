import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nodePolyfills } from "vite-plugin-node-polyfills";

const host = process.env.TAURI_DEV_HOST;

const __dirname = dirname(fileURLToPath(import.meta.url));

function guardCefRelListSupportsPlugin(): PluginOption {
  return {
    name: "openhuman:guard-cef-rel-list-supports",
    enforce: "post",
    renderChunk(code) {
      const unsafe =
        'relList && relList.supports && relList.supports("modulepreload")';
      const guarded =
        'relList && typeof relList.supports === "function" && relList.supports("modulepreload")';
      const next = code.split(unsafe).join(guarded);
      return next === code ? null : { code: next, map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  root: "src",
  publicDir: "../public",
  // Read env files from the repo root (not `app/src/`, which is the vite
  // `root` and would be the default `envDir`). Lets `pnpm dev:app` pick up
  // `VITE_BACKEND_URL` / `VITE_OPENHUMAN_APP_ENV` from the same root `.env`
  // the Rust shell uses, instead of needing a separate `app/.env.local`.
  // Without this, `import.meta.env.VITE_*` is empty in dev (Vite does not
  // inherit `process.env` for VITE_-prefixed vars), so `BACKEND_URL` falls
  // through to the production fallback in `src/utils/config.ts` even when
  // the shell exports staging URLs.
  envDir: resolve(__dirname, ".."),
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Desktop CEF has surfaced a runtime where `link.relList.supports` is
    // truthy but not callable. Vite calls it both in the modulepreload
    // polyfill and the dynamic-import preload helper, before React mounts.
    modulePreload: false,
    sourcemap: true,
  },
  plugins: [
    nodePolyfills({
      include: ["buffer", "process", "util", "os", "crypto", "stream"],
      globals: {
        Buffer: true,
        process: true,
        global: true,
      },
    }),
    guardCefRelListSupportsPlugin(),
    react(),
  ] as PluginOption[],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    allowedHosts: [
      "frontend-runner-openhuman-git-main-vezuresxyz.vercel.app",
    ],
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : {
          // Tauri CEF loads the app from tauri.localhost; without this the
          // HMR client tries ws://tauri.localhost/ and gets ERR_CONNECTION_REFUSED.
          // Force the client to connect to the Vite dev server directly.
          protocol: "ws",
          host: "localhost",
          port: 1420,
          clientPort: 1420,
        },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` directory (includes src-tauri/ai)
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      buffer: "buffer",
      process: "process/browser",
      util: "util",
      os: "os-browserify/browser",
    },
  },
  optimizeDeps: {
    include: ["buffer", "process", "util", "os-browserify"],
  },
}));
