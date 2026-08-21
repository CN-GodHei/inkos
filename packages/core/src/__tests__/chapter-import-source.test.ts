import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadChaptersFromPath } from "../agent/chapter-import-source.js";

describe("loadChaptersFromPath", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("loads unpadded chapter files in natural numeric order", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-chapter-import-"));
    roots.push(root);
    const source = join(root, "chapters");
    await mkdir(source);
    await Promise.all([
      writeFile(join(source, "10_终局.md"), "ten"),
      writeFile(join(source, "2_转折.md"), "two"),
      writeFile(join(source, "1_开端.md"), "one"),
    ]);

    const chapters = await loadChaptersFromPath(source);

    expect(chapters.map((chapter) => chapter.title)).toEqual(["开端", "转折", "终局"]);
    expect(chapters.map((chapter) => chapter.content)).toEqual(["one", "two", "ten"]);
  });

  it("splits a GBK-encoded single file into chapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-chapter-import-"));
    roots.push(root);
    const source = join(root, "novel.txt");
    const gbkBytes = Uint8Array.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb2, 0xe2, 0xca, 0xd4, 0x0a,
      0xd5, 0xe2, 0xca, 0xc7, 0xc4, 0xda, 0xc8, 0xdd, 0xa1, 0xa3, 0x0a,
      0xb5, 0xda, 0xb6, 0xfe, 0xd5, 0xc2, 0x20, 0xbc, 0xcc, 0xd0, 0xf8, 0x0a,
      0xc8, 0xbb, 0xba, 0xf3, 0xca, 0xc7, 0xb5, 0xda, 0xb6, 0xfe, 0xb6, 0xce, 0xa1, 0xa3,
    ]);
    await writeFile(source, Buffer.from(gbkBytes));

    const chapters = await loadChaptersFromPath(source);

    expect(chapters.map((chapter) => chapter.title)).toEqual(["测试", "继续"]);
    expect(chapters.map((chapter) => chapter.content)).toEqual(["这是内容。", "然后是第二段。"]);
  });
});
