import { visit } from "unist-util-visit";
import { DEFAULT_PUBLIC_PREFIX, hashMermaid } from "./shared.js";

export interface RemarkMermaidTldrawOptions {
  /**
   * URL prefix the rendered SVGs are served from. Must line up with where the
   * renderer writes them (a `public/diagrams` outDir is served at `/diagrams`).
   * @default "/diagrams"
   */
  publicPrefix?: string;
  /** Class on the wrapping `<figure>`. @default "mermaid-diagram" */
  figureClassName?: string;
  /** Class on the light-variant `<img>`. @default "mermaid-light" */
  lightClassName?: string;
  /** Class on the dark-variant `<img>`. @default "mermaid-dark" */
  darkClassName?: string;
  /** `alt` text for both images. @default "Diagram" */
  alt?: string;
  /**
   * Append `not-prose` to the figure class (handy with Tailwind Typography so
   * the diagram isn't restyled as prose). @default true
   */
  notProse?: boolean;
  /**
   * Which variants to emit. `"both"` ships a light and a dark `<img>` and you
   * swap them in CSS. On a single-theme site emit just one so the browser never
   * fetches the variant it can't show. @default "both"
   */
  theme?: "both" | "light" | "dark";
}

interface CodeNode {
  type: "code";
  lang?: string | null;
  meta?: string | null;
  value: string;
}

interface HtmlNode {
  type: "html";
  value: string;
}

interface Parent {
  children: Array<{ type: string }>;
}

/**
 * Parse `key=value` options from a code fence's meta string, e.g.
 * ```` ```mermaid width=380 ```` -> `{ width: "380" }`.
 */
function parseMeta(meta: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of (meta ?? "").matchAll(/(\w+)=("[^"]*"|'[^']*'|\S+)/g)) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) out[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return out;
}

/** Turn a width option into a CSS length (bare numbers become px). */
function toCssLength(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
}

/** Escape a string for safe interpolation into an HTML attribute value. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Replaces ```mermaid fenced code blocks with paired light/dark `<img>`s
 * pointing at the SVGs the renderer produces. Both the plugin and the renderer
 * derive the filename from `hashMermaid(source)`, so they always line up with
 * no shared manifest.
 *
 * Per-diagram sizing is configurable from the post via fence meta, e.g.
 * ```` ```mermaid width=380 ```` caps the rendered width (handy for tall
 * top-down flowcharts).
 *
 * This plugin only rewrites the markdown — run the renderer (CLI, programmatic
 * `renderDiagrams`, or the Astro integration) to actually produce the SVGs.
 */
export function remarkMermaidTldraw(options: RemarkMermaidTldrawOptions = {}) {
  const publicPrefix = (options.publicPrefix ?? DEFAULT_PUBLIC_PREFIX).replace(/\/$/, "");
  const figureClassName = options.figureClassName ?? "mermaid-diagram";
  const lightClassName = options.lightClassName ?? "mermaid-light";
  const darkClassName = options.darkClassName ?? "mermaid-dark";
  const alt = escapeAttr(options.alt ?? "Diagram");
  const notProse = options.notProse ?? true;
  const figureClass = notProse ? `${figureClassName} not-prose` : figureClassName;
  const theme = options.theme ?? "both";

  return (tree: unknown) => {
    visit(tree as never, "code", (node: CodeNode, index: number | undefined, parent: Parent | undefined) => {
      if (node.lang !== "mermaid" || parent === undefined || index === undefined) return;

      const hash = hashMermaid(node.value);
      const opts = parseMeta(node.meta);
      const maxWidth = toCssLength(opts["width"]);
      const style = maxWidth ? ` style="max-width:${escapeAttr(maxWidth)}"` : "";

      const img = (variant: string, suffix: string) =>
        `<img class="${variant}" src="${publicPrefix}/${hash}${suffix}.svg"` +
        ` alt="${alt}" loading="lazy" decoding="async" />`;

      const imgs =
        theme === "light"
          ? img(lightClassName, "")
          : theme === "dark"
            ? img(darkClassName, ".dark")
            : img(lightClassName, "") + img(darkClassName, ".dark");

      const html: HtmlNode = {
        type: "html",
        value: `<figure class="${figureClass}"${style}>` + imgs + `</figure>`,
      };

      parent.children[index] = html;
    });
  };
}

export default remarkMermaidTldraw;
