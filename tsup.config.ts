import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/render.ts", "src/astro.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node18",
  platform: "node",
  splitting: false,
  // Build-time deps stay external; the harness is shipped as raw source.
  external: ["playwright", "vite", "@vitejs/plugin-react", "tldraw", "@tldraw/mermaid", "react", "react-dom"],
  banner: { js: "" },
  esbuildOptions(opts) {
    // CLI needs a shebang; tsup keeps the one in the source file.
    opts.charset = "utf8";
  },
});
