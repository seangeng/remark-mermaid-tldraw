import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { type ViteDevServer, createServer } from "vite";
import { glob } from "tinyglobby";
import {
  DEFAULT_OUT_DIR,
  extractMermaidBlocks,
  hashMermaid,
  renderMarker,
} from "./shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// The harness ships as raw source under `<pkg>/harness` (served by Vite, not
// bundled). From `dist/render.js` that resolves to `../harness`.
const HARNESS_ROOT = path.resolve(here, "..", "harness");

export interface RenderOptions {
  /**
   * Glob(s) of markdown/MDX files to scan for ```mermaid blocks.
   * @default ["src/**\/*.md", "src/**\/*.mdx"]
   */
  content?: string | string[];
  /** Working directory globs resolve against. @default process.cwd() */
  cwd?: string;
  /** Directory the SVGs are written to. @default "public/diagrams" */
  outDir?: string;
  /** Padding (px) around the shapes in the exported SVG. @default 16 */
  padding?: number;
  /** Log callback. @default console.log */
  log?: (message: string) => void;
  /** ms to wait for the tldraw editor to mount in the harness. @default 30000 */
  mountTimeout?: number;
}

export interface RenderSummary {
  /** Distinct diagrams found across all content. */
  total: number;
  /** How many were (re)rendered this run. */
  rendered: number;
}

interface Diagram {
  hash: string;
  source: string;
  file: string;
}

interface ResolvedOptions {
  content: string[];
  cwd: string;
  outDir: string;
  padding: number;
  log: (message: string) => void;
  mountTimeout: number;
}

function resolveOptions(options: RenderOptions = {}): ResolvedOptions {
  const cwd = options.cwd ?? process.cwd();
  const content = options.content
    ? Array.isArray(options.content)
      ? options.content
      : [options.content]
    : ["src/**/*.md", "src/**/*.mdx"];
  return {
    content,
    cwd,
    outDir: path.resolve(cwd, options.outDir ?? DEFAULT_OUT_DIR),
    padding: options.padding ?? 16,
    log: options.log ?? ((m) => console.log(m)),
    mountTimeout: options.mountTimeout ?? 30_000,
  };
}

async function collectDiagrams(opts: ResolvedOptions): Promise<Diagram[]> {
  const files = await glob(opts.content, { cwd: opts.cwd, absolute: true });
  const diagrams: Diagram[] = [];
  const seen = new Set<string>();
  for (const file of files.sort()) {
    let markdown: string;
    try {
      markdown = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const source of extractMermaidBlocks(markdown)) {
      const hash = hashMermaid(source);
      if (seen.has(hash)) continue;
      seen.add(hash);
      diagrams.push({ hash, source, file: path.relative(opts.cwd, file) });
    }
  }
  return diagrams;
}

function variantPaths(outDir: string, hash: string): { light: string; dark: string } {
  return {
    light: path.join(outDir, `${hash}.svg`),
    dark: path.join(outDir, `${hash}.dark.svg`),
  };
}

async function hasMarker(file: string): Promise<boolean> {
  try {
    return (await fs.readFile(file, "utf8")).includes(renderMarker());
  } catch {
    return false;
  }
}

/**
 * A diagram is up to date when both theme variants exist and carry the current
 * render marker. A source edit changes the filename (missing file → render); a
 * render-logic change bumps the marker (stale marker → render in place).
 */
async function isUpToDate(outDir: string, hash: string): Promise<boolean> {
  const { light, dark } = variantPaths(outDir, hash);
  return (await hasMarker(light)) && (await hasMarker(dark));
}

/**
 * Remove rendered SVGs no diagram references anymore. Not part of a normal
 * render: a stale framework render cache can still point at an old filename, and
 * deleting it would 404. Call explicitly (`--clean`) when you want to GC.
 */
export async function pruneOrphans(options: RenderOptions = {}): Promise<number> {
  const opts = resolveOptions(options);
  const keep = new Set((await collectDiagrams(opts)).map((d) => d.hash));
  let files: string[];
  try {
    files = await fs.readdir(opts.outDir);
  } catch {
    return 0;
  }
  let pruned = 0;
  for (const name of files) {
    if (!name.endsWith(".svg")) continue;
    const hash = name.replace(/\.dark\.svg$/, "").replace(/\.svg$/, "");
    if (!keep.has(hash)) {
      await fs.rm(path.join(opts.outDir, name));
      opts.log(`pruned orphan ${name}`);
      pruned++;
    }
  }
  return pruned;
}

async function renderPending(pending: Diagram[], opts: ResolvedOptions): Promise<void> {
  let server: ViteDevServer | undefined;
  let browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>> | undefined;
  try {
    const { chromium } = await import("playwright");
    server = await createServer({
      root: HARNESS_ROOT,
      configFile: false,
      plugins: [react()],
      logLevel: "warn",
      server: { host: "127.0.0.1" },
      optimizeDeps: { include: ["react", "react-dom/client", "tldraw", "@tldraw/mermaid"] },
    });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("vite did not report a local url");

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    page.on("pageerror", (err) => opts.log(`[harness pageerror] ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") opts.log(`[harness console] ${msg.text()}`);
    });

    await page.goto(new URL("harness.html", base).href);
    await page.waitForFunction(() => Boolean((window as { __tldrawEditor?: unknown }).__tldrawEditor), {
      timeout: opts.mountTimeout,
    });

    for (const diagram of pending) {
      const result = await page.evaluate(
        ({ source, padding }) =>
          (
            window as unknown as {
              renderMermaid: (s: string, o: { padding: number }) => Promise<{ light: string; dark: string }>;
            }
          ).renderMermaid(source, { padding }),
        { source: diagram.source, padding: opts.padding },
      );
      const { light, dark } = variantPaths(opts.outDir, diagram.hash);
      await fs.writeFile(light, `${renderMarker()}\n${result.light}`, "utf8");
      await fs.writeFile(dark, `${renderMarker()}\n${result.dark}`, "utf8");
      opts.log(`rendered ${diagram.hash}.svg (+dark)  (${diagram.file})`);
    }
  } finally {
    await browser?.close();
    await server?.close();
  }
}

/**
 * Ensure every mermaid diagram in the matched content has an up-to-date pair of
 * light/dark SVGs in `outDir`. Returns how many were (re)rendered so callers can
 * decide whether to trigger a reload. The headless browser launches only when
 * something is actually pending.
 */
export async function renderDiagrams(options: RenderOptions = {}): Promise<RenderSummary> {
  const opts = resolveOptions(options);
  const diagrams = await collectDiagrams(opts);
  if (!diagrams.length) return { total: 0, rendered: 0 };

  await fs.mkdir(opts.outDir, { recursive: true });

  const pending: Diagram[] = [];
  for (const diagram of diagrams) {
    if (await isUpToDate(opts.outDir, diagram.hash)) continue;
    pending.push(diagram);
  }

  if (pending.length) {
    opts.log(`rendering ${pending.length} of ${diagrams.length} diagram(s)...`);
    await renderPending(pending, opts);
  }

  return { total: diagrams.length, rendered: pending.length };
}
