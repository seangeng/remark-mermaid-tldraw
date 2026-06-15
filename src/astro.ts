import { type RenderOptions, renderDiagrams } from "./render.js";

export interface AstroMermaidTldrawOptions extends RenderOptions {}

/**
 * Minimal structural type for an Astro integration — declared locally so this
 * package doesn't take a hard dependency on `astro`. It is assignable to
 * `import("astro").AstroIntegration` in an Astro project.
 */
interface AstroIntegration {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: Record<string, (arg: any) => unknown>;
}

interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}
interface DevServerLike {
  watcher: { on: (event: string, cb: (file: string) => void) => void };
  ws: { send: (payload: { type: string }) => void };
}

function isContentMarkdown(file: string, content: string[]): boolean {
  const normalized = file.replace(/\\/g, "/");
  return /\.mdx?$/.test(normalized) && (content.length === 0 || normalized.includes("/src/"));
}

/**
 * Astro integration that keeps the rendered SVGs in sync with your content:
 *
 * - `astro:config:setup` renders once before every dev start and build, so the
 *   SVGs the remark plugin points at always exist (the headless browser only
 *   launches if something is actually stale).
 * - `astro:server:setup` watches content in dev and re-renders on edit, then
 *   forces a reload so a freshly produced diagram shows without a manual refresh.
 *
 * Pair it with the `remarkMermaidTldraw` remark plugin in your Astro config's
 * `markdown.remarkPlugins`. Filenames are content-hashed and never auto-pruned,
 * so an existing diagram URL always resolves even against a stale render cache.
 */
export function mermaidTldraw(options: AstroMermaidTldrawOptions = {}): AstroIntegration {
  const content = options.content ? (Array.isArray(options.content) ? options.content : [options.content]) : [];
  return {
    name: "remark-mermaid-tldraw",
    hooks: {
      "astro:config:setup": async ({ logger }: { logger: Logger }) => {
        const { total, rendered } = await renderDiagrams({ ...options, log: (m) => logger.info(m) });
        if (!total) return;
        logger.info(rendered ? `rendered ${rendered}/${total} diagram(s)` : `${total} diagram(s) cached`);
      },
      "astro:server:setup": ({ server, logger }: { server: DevServerLike; logger: Logger }) => {
        let running = Promise.resolve();
        const onChange = (file: string) => {
          if (!isContentMarkdown(file, content)) return;
          // Serialise renders so overlapping edits don't launch two browsers.
          running = running
            .then(() => renderDiagrams({ ...options, log: (m) => logger.info(m) }))
            .then(({ rendered }) => {
              if (rendered) {
                logger.info(`re-rendered ${rendered} diagram(s), reloading`);
                server.ws.send({ type: "full-reload" });
              }
            })
            .catch((err) => logger.error(`render failed: ${(err as Error).message}`));
        };
        server.watcher.on("change", onChange);
        server.watcher.on("add", onChange);
      },
    },
  };
}

export default mermaidTldraw;
