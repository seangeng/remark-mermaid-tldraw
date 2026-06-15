export { remarkMermaidTldraw, default } from "./remark.js";
export type { RemarkMermaidTldrawOptions } from "./remark.js";

// Pure helpers — safe to import without pulling in the renderer (no vite /
// playwright at this entry).
export {
  hashMermaid,
  extractMermaidBlocks,
  RENDER_VERSION,
  renderMarker,
  DEFAULT_OUT_DIR,
  DEFAULT_PUBLIC_PREFIX,
} from "./shared.js";

// Renderer types only (no runtime import — that lives behind the `/render`
// entry so the remark plugin stays lightweight).
export type { RenderOptions, RenderSummary } from "./render.js";
