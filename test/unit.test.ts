import { describe, expect, it } from "vitest";
import { hashMermaid, extractMermaidBlocks } from "../src/shared.js";
import { remarkMermaidTldraw } from "../src/remark.js";

describe("hashMermaid", () => {
  it("is stable and 16 hex chars", () => {
    const h = hashMermaid("flowchart TD\n  A --> B");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashMermaid("flowchart TD\n  A --> B")).toBe(h);
  });

  it("ignores leading/trailing whitespace and CRLF", () => {
    expect(hashMermaid("  flowchart TD\r\n  A --> B  ")).toBe(hashMermaid("flowchart TD\n  A --> B"));
  });

  it("changes when the source changes", () => {
    expect(hashMermaid("flowchart TD\n A --> B")).not.toBe(hashMermaid("flowchart TD\n A --> C"));
  });
});

describe("extractMermaidBlocks", () => {
  it("pulls out only mermaid fences", () => {
    const md = ["```mermaid", "flowchart TD", "A --> B", "```", "", "```ts", "const x = 1;", "```"].join("\n");
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("flowchart TD");
  });

  it("returns [] when there are none", () => {
    expect(extractMermaidBlocks("# just prose")).toEqual([]);
  });
});

describe("remarkMermaidTldraw transform", () => {
  function run(value: string, meta: string | null = null, options = {}) {
    const tree = {
      type: "root",
      children: [{ type: "code", lang: "mermaid", meta, value }],
    };
    remarkMermaidTldraw(options)(tree);
    return tree.children[0] as { type: string; value: string };
  }

  it("replaces a mermaid fence with paired light/dark imgs", () => {
    const node = run("flowchart TD\n A --> B");
    expect(node.type).toBe("html");
    const hash = hashMermaid("flowchart TD\n A --> B");
    expect(node.value).toContain(`class="mermaid-light" src="/diagrams/${hash}.svg"`);
    expect(node.value).toContain(`class="mermaid-dark" src="/diagrams/${hash}.dark.svg"`);
    expect(node.value).toContain("not-prose");
  });

  it("honors width meta", () => {
    expect(run("flowchart TD\n A --> B", "width=380").value).toContain('style="max-width:380px"');
    expect(run("flowchart TD\n A --> B", "width=50%").value).toContain('style="max-width:50%"');
  });

  it("respects custom prefix and classes", () => {
    const node = run("flowchart TD\n A --> B", null, {
      publicPrefix: "/assets/d",
      lightClassName: "d-light",
      notProse: false,
    });
    expect(node.value).toContain('src="/assets/d/');
    expect(node.value).toContain('class="d-light"');
    expect(node.value).not.toContain("not-prose");
  });

  it("leaves non-mermaid code untouched", () => {
    const tree = { type: "root", children: [{ type: "code", lang: "ts", value: "const x = 1;" }] };
    remarkMermaidTldraw()(tree);
    expect((tree.children[0] as { type: string }).type).toBe("code");
  });
});

describe("theme option", () => {
  function run(value: string, options = {}) {
    const tree = { type: "root", children: [{ type: "code", lang: "mermaid", value }] };
    remarkMermaidTldraw(options)(tree);
    return (tree.children[0] as { value: string }).value;
  }
  it("emits both variants by default", () => {
    const v = run("flowchart TD\n A --> B");
    expect(v).toContain("mermaid-light");
    expect(v).toContain("mermaid-dark");
  });
  it("emits only the dark img when theme=dark", () => {
    const v = run("flowchart TD\n A --> B", { theme: "dark" });
    expect(v).not.toContain("mermaid-light");
    expect(v).toContain("mermaid-dark");
  });
  it("emits only the light img when theme=light", () => {
    const v = run("flowchart TD\n A --> B", { theme: "light" });
    expect(v).toContain("mermaid-light");
    expect(v).not.toContain("mermaid-dark");
  });
});
