import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestMaterial } from "../materials/ingest.js";

describe("material ingestion", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-material-ingest-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("archives a project text file as traceable markdown material", async () => {
    await writeFile(join(root, "brief.md"), "# Brief\n\n第一人称，县城冷库旧账。", "utf-8");

    const asset = await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "brief.md",
      mimeType: "text/markdown",
      purpose: "worldbuilding",
    }, {
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(asset.kind).toBe("text");
    expect(asset.markdownPath).toMatch(/^\.inkos\/materials\//);
    expect(asset.source).toBe("brief.md");
    expect(asset.excerpt).toContain("县城冷库旧账");
    const markdown = await readFile(join(root, asset.markdownPath), "utf-8");
    expect(markdown).toContain("## Metadata");
    expect(markdown).toContain("- purpose: worldbuilding");
    expect(markdown).toContain("第一人称，县城冷库旧账。");
    const manifest = JSON.parse(await readFile(join(root, asset.manifestPath), "utf-8")) as { markdownPath?: string };
    expect(manifest.markdownPath).toBe(asset.markdownPath);
  });

  it("decodes a GBK-encoded novel file instead of producing mojibake", async () => {
    const gbkBytes = Uint8Array.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb2, 0xe2, 0xca, 0xd4, 0x0a,
      0xd5, 0xe2, 0xca, 0xc7, 0xc4, 0xda, 0xc8, 0xdd, 0xa1, 0xa3,
    ]);
    await writeFile(join(root, "novel.txt"), Buffer.from(gbkBytes));

    const asset = await ingestMaterial(root, {
      sourceKind: "file",
      filePath: "novel.txt",
      mimeType: "text/plain",
      purpose: "reference",
    }, {
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(asset.excerpt).toContain("第一章 测试");
    expect(asset.excerpt).toContain("这是内容。");
    const markdown = await readFile(join(root, asset.markdownPath), "utf-8");
    expect(markdown).toContain("第一章 测试");
  });

  it("extracts and archives HTML fetched from a URL", async () => {
    const fetchImpl = async () => new Response(
      "<html><head><title>旧账资料</title><style>x{}</style></head><body><h1>冷库流程</h1><script>bad()</script><p>入库单需要签字。</p></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );

    const asset = await ingestMaterial(root, {
      sourceKind: "url",
      url: "https://example.com/cold-storage",
      purpose: "research",
    }, {
      fetch: fetchImpl as typeof fetch,
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(asset.kind).toBe("webpage");
    expect(asset.title).toBe("旧账资料");
    expect(asset.source).toBe("https://example.com/cold-storage");
    expect(asset.excerpt).toContain("入库单需要签字");
    expect(asset.excerpt).not.toContain("bad()");
  });
});
