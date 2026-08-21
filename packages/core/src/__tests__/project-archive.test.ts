import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildProjectArchive,
  extractProjectArchive,
  PROJECT_ARCHIVE_INCLUDE_DIRS,
} from "../utils/project-archive.js";

describe("project archive", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function fixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "inkos-project-archive-"));
    roots.push(root);
    await mkdir(join(root, "books", "novel-a", "chapters"), { recursive: true });
    await mkdir(join(root, "worlds", "play-x", "runs", "main"), { recursive: true });
    await mkdir(join(root, ".inkos", "materials"), { recursive: true });
    await writeFile(join(root, "inkos.json"), JSON.stringify({ name: "p" }), "utf-8");
    await writeFile(join(root, "books", "novel-a", "book.json"), JSON.stringify({ id: "novel-a" }), "utf-8");
    await writeFile(join(root, "books", "novel-a", "chapters", "0001_Start.md"), "# Start\n", "utf-8");
    await writeFile(join(root, "worlds", "play-x", "runs", "main", "state.md"), "# State\n", "utf-8");
    await writeFile(join(root, ".inkos", "materials", "m.md"), "# Mat\n", "utf-8");
    await mkdir(join(root, "node_modules", "junk"), { recursive: true });
    await writeFile(join(root, "node_modules", "junk", "x.js"), "junk", "utf-8");
    return root;
  }

  it("archives runtime dirs and config, skipping non-project content", async () => {
    const root = await fixture();
    const archive = await buildProjectArchive(root);
    const zip = await JSZip.loadAsync(archive);

    expect(zip.file("inkos.json")).toBeTruthy();
    expect(zip.file("books/novel-a/book.json")).toBeTruthy();
    expect(zip.file("books/novel-a/chapters/0001_Start.md")).toBeTruthy();
    expect(zip.file("worlds/play-x/runs/main/state.md")).toBeTruthy();
    expect(zip.file(".inkos/materials/m.md")).toBeTruthy();
    // node_modules is not a runtime dir and must never be archived.
    expect(zip.file("node_modules/junk/x.js")).toBeNull();
  });

  it("restores an archive back into a fresh project root", async () => {
    const source = await fixture();
    const archive = await buildProjectArchive(source);

    const target = await mkdtemp(join(tmpdir(), "inkos-project-restore-"));
    roots.push(target);
    const result = await extractProjectArchive(target, archive);

    expect(result.filesWritten).toBe(5);
    await expect(readFile(join(target, "inkos.json"), "utf-8")).resolves.toBe(JSON.stringify({ name: "p" }));
    await expect(readFile(join(target, "books", "novel-a", "chapters", "0001_Start.md"), "utf-8")).resolves.toBe("# Start\n");
    await expect(readFile(join(target, "worlds", "play-x", "runs", "main", "state.md"), "utf-8")).resolves.toBe("# State\n");
  });

  it("ignores unknown or unsafe archive paths on extraction", async () => {
    const target = await mkdtemp(join(tmpdir(), "inkos-project-restore-"));
    roots.push(target);
    const zip = new JSZip();
    zip.file("inkos.json", "{}");
    zip.file("books/evil.md", "book");
    zip.file("../escape.md", "escape");
    zip.file("node_modules/x.js", "junk");
    zip.file(".git/config", "git");
    zip.file("books/ok/book.json", "{}");
    const archive = await zip.generateAsync({ type: "uint8array" });

    const result = await extractProjectArchive(target, archive);

    expect(result.filesWritten).toBe(3); // inkos.json + books/evil.md + books/ok/book.json
    await expect(readFile(join(target, "inkos.json"), "utf-8")).resolves.toBe("{}");
    await expect(readFile(join(target, "books", "evil.md"), "utf-8")).resolves.toBe("book");
    await expect(readFile(join(target, "books", "ok", "book.json"), "utf-8")).resolves.toBe("{}");
    // Path traversal / non-runtime dirs must not be written.
    await expect(readFile(join(target, "..", "escape.md")).catch(() => null)).resolves.toBeNull();
    await expect(readFile(join(target, "node_modules", "x.js")).catch(() => null)).resolves.toBeNull();
    await expect(readFile(join(target, ".git", "config")).catch(() => null)).resolves.toBeNull();
    expect(PROJECT_ARCHIVE_INCLUDE_DIRS).toContain("books");
  });
});