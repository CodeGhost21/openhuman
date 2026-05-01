import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nodePolyfills } from "vite-plugin-node-polyfills";

const host = process.env.TAURI_DEV_HOST;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

// Canonical release tag — must match `SENTRY_RELEASE` exported from
// `app/src/utils/config.ts` (and the eventual Tauri-shell + Core tags) so
// events from every surface group under the same Sentry release.
function computeSentryRelease(): string {
  const raw = (process.env.SENTRY_RELEASE ?? "").trim();
  if (raw) return raw;
  const sha = (process.env.VITE_BUILD_SHA ?? "").trim().slice(0, 12);
  return sha
    ? `openhuman@${pkg.version}+${sha}`
    : `openhuman@${pkg.version}`;
}

// Source-map upload runs only when SENTRY_AUTH_TOKEN is set. SENTRY_PROJECT
// defaults to SENTRY_PROJECT_REACT so the same .env drives Vite (React) /
// sentry-cli (Tauri / Core) uploads without the caller having to remember
// to set SENTRY_PROJECT inline for the React build.
function maybeSentryPlugin(): PluginOption | null {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT || process.env.SENTRY_PROJECT_REACT;
  const release = computeSentryRelease();

  if (!authToken) {
    console.warn("[sentry-vite-plugin] skipped: SENTRY_AUTH_TOKEN not set");
    return null;
  }
  if (!org) {
    console.warn("[sentry-vite-plugin] skipped: SENTRY_ORG not set");
    return null;
  }
  if (!project) {
    console.warn(
      "[sentry-vite-plugin] skipped: SENTRY_PROJECT (or SENTRY_PROJECT_REACT) not set",
    );
    return null;
  }
  console.info(
    `[sentry-vite-plugin] uploading source maps to ${org}/${project} for release ${release}`,
  );

  return sentryVitePlugin({
    authToken,
    org,
    project,
    release: {
      name: release,
      // The frontend already passes this release into Sentry.init(); leaving
      // the plugin's virtual release-injection module on conflicts with the
      // node-polyfills transform under CEF and breaks bundle init order.
      // Debug-IDs are injected independently and don't depend on this flag.
      inject: false,
    },
    sourcemaps: {
      // Anchor at this config file's directory so cwd from `cargo tauri build`
      // (which invokes vite from `app/`) doesn't matter. Resolved by the
      // plugin against `process.cwd()` if relative, which previously caused
      // silent "no matching sources" upload failures.
      assets: [
        resolve(__dirname, "dist/**/*.js"),
        resolve(__dirname, "dist/**/*.map"),
      ],
      // Strip the .map files after upload so end users don't receive them.
      filesToDeleteAfterUpload: [resolve(__dirname, "dist/**/*.map")],
    },
    telemetry: false,
  });
}

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
    maybeSentryPlugin(),
  ].filter(Boolean) as PluginOption[],

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
