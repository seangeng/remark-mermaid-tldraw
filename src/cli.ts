#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pruneOrphans, renderDiagrams, type RenderOptions } from "./render.js";

interface Args {
  content?: string[];
  out?: string;
  padding?: number;
  watch: boolean;
  clean: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { watch: false, clean: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    const next = (): string => argv[++i] ?? "";
    if (a === "--watch" || a === "-w") args.watch = true;
    else if (a === "--clean") args.clean = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--content" || a === "-c") (args.content ??= []).push(next());
    else if (a === "--out" || a === "-o") args.out = next();
    else if (a === "--padding" || a === "-p") args.padding = Number(next());
    else if (a === "render") continue; // optional verb
    else if (a.startsWith("--content=")) (args.content ??= []).push(a.slice(10));
    else if (a.startsWith("--out=")) args.out = a.slice(6);
    else if (a.startsWith("--padding=")) args.padding = Number(a.slice(10));
    else if (!a.startsWith("-")) (args.content ??= []).push(a);
  }
  return args;
}

const HELP = `remark-mermaid-tldraw — pre-render mermaid diagrams as tldraw SVGs

Usage:
  remark-mermaid-tldraw [render] [options]

Options:
  -c, --content <glob>   markdown/MDX glob to scan (repeatable)
                         default: src/**/*.md, src/**/*.mdx
  -o, --out <dir>        output directory for SVGs   (default: public/diagrams)
  -p, --padding <px>     padding around shapes in the SVG   (default: 16)
  -w, --watch            re-render on content changes
      --clean            prune SVGs no diagram references anymore, then render
  -h, --help             show this help

Examples:
  remark-mermaid-tldraw --content "src/content/**/*.md" --out public/diagrams
  remark-mermaid-tldraw --watch
  remark-mermaid-tldraw --clean`;

function tag(message: string): void {
  console.log(`[mermaid] ${message}`);
}

/** Minimal debounced recursive watcher — no extra deps. */
function watch(roots: string[], onChange: () => void): void {
  const debounced = debounce(onChange, 200);
  for (const root of roots) {
    try {
      fs.watch(root, { recursive: true }, (_event, file) => {
        if (file && /\.mdx?$/.test(file)) debounced();
      });
    } catch {
      // recursive watch unsupported on this platform/path — skip silently.
    }
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let t: NodeJS.Timeout | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

/** Best-effort: derive watchable root dirs from the content globs. */
function watchRoots(content: string[] | undefined, cwd: string): string[] {
  const globs = content ?? ["src"];
  const roots = new Set<string>();
  for (const g of globs) {
    const base = g.split(/[*?[{]/)[0] ?? "";
    const dir = base.endsWith("/") ? base : path.dirname(base);
    roots.add(path.resolve(cwd, dir || "."));
  }
  return [...roots].filter((dir) => fs.existsSync(dir));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const cwd = process.cwd();
  const options: RenderOptions = { log: tag, cwd };
  if (args.content) options.content = args.content;
  if (args.out !== undefined) options.outDir = args.out;
  if (args.padding !== undefined) options.padding = args.padding;

  if (args.clean) {
    const pruned = await pruneOrphans(options);
    tag(pruned ? `pruned ${pruned} orphan(s)` : "no orphans to prune");
  }

  const run = async () => {
    const { total, rendered } = await renderDiagrams(options);
    if (!total) tag("no mermaid diagrams found");
    else if (!rendered) tag(`${total} diagram(s) already cached, nothing to render`);
    else tag(`done — rendered ${rendered}/${total}`);
  };

  await run();

  if (args.watch) {
    const roots = watchRoots(args.content, cwd);
    tag(`watching ${roots.length} dir(s) for changes — ctrl-c to stop`);
    let running = Promise.resolve();
    watch(roots, () => {
      running = running.then(run).catch((err) => tag(`render failed: ${(err as Error).message}`));
    });
    await new Promise(() => {}); // keep alive
  }
}

main().catch((err) => {
  console.error("[mermaid] render failed:", err);
  process.exit(1);
});
