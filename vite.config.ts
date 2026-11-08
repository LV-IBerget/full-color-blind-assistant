import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The app says photos stay on the device. This policy makes the browser enforce it: built pages can
// only talk to their own origin, so nothing can send a photo elsewhere, whatever the code does.
// It is left out of the dev server, whose hot reloading needs inline styles and a websocket.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  // Relative paths, so the build works from any folder, including a GitHub Pages project path.
  base: "./",
  plugins: [contentSecurityPolicy()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
