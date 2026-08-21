import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import JSZip from "jszip";

/** Runtime data directories archived on project export. */
export const PROJECT_ARCHIVE_INCLUDE_DIRS = [
  "books",
  "worlds",
  "dramas",
  "storyboards",
  "shorts",
  "covers",
  "translations",
  "prompt",
  ".agents",
  ".inkos",
] as const;

/** Root-level files archived on project export. */
export const PROJECT_ARCHIVE_ROOT_FILES = ["inkos.json", ".env"] as const;

/**
 * Package the whole InkOS project (books, worlds, scripts, short fiction,
 * translations, prompt overrides, imported skills, sessions, materials and
 * secrets) into a single zip so it can be moved to another machine as-is.
 */
export async function buildProjectArchive(projectRoot: string): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of PROJECT_ARCHIVE_ROOT_FILES) {
    await addFileIfExists(zip, projectRoot, file);
  }
  for (const dir of PROJECT_ARCHIVE_INCLUDE_DIRS) {
    await addTree(zip, projectRoot, dir);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/**
 * Restore a project archive into the project root, merging over existing data.
 * Only whitelisted runtime paths are written, so a hand-made zip cannot smuggle
 * node_modules, dist, .git or arbitrary files into the project.
 */
export async function extractProjectArchive(
  projectRoot: string,
  archive: Buffer | Uint8Array,
): Promise<{ readonly filesWritten: number; readonly skippedFiles: number; readonly totalEntries: number }> {
  const zip = await JSZip.loadAsync(archive);
  let filesWritten = 0;
  let skippedFiles = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const relPath = normalizeArchivePath(entry.name);
    if (!relPath) {
      skippedFiles += 1;
      continue;
    }
    const topLevel = relPath.split("/")[0] as string;
    const allowedRootFile = (PROJECT_ARCHIVE_ROOT_FILES as readonly string[]).includes(topLevel);
    const allowedDir = (PROJECT_ARCHIVE_INCLUDE_DIRS as readonly string[]).includes(topLevel);
    if (!allowedRootFile && !allowedDir) {
      skippedFiles += 1;
      continue;
    }
    const content = Buffer.from(await entry.async("uint8array"));
    const dest = join(projectRoot, ...relPath.split("/"));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
    filesWritten += 1;
  }
  return { filesWritten, skippedFiles, totalEntries: Object.values(zip.files).filter((entry) => !entry.dir).length };
}

async function addFileIfExists(zip: JSZip, projectRoot: string, relPath: string): Promise<void> {
  const abs = join(projectRoot, relPath);
  try {
    await stat(abs);
  } catch {
    return;
  }
  zip.file(relPath, await readFile(abs));
}

async function addTree(zip: JSZip, projectRoot: string, relPath: string): Promise<void> {
  const abs = join(projectRoot, relPath);
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = `${relPath}/${entry.name}`;
    const childAbs = join(abs, entry.name);
    if (entry.isDirectory()) {
      await addTree(zip, projectRoot, childRel);
    } else if (entry.isFile()) {
      zip.file(childRel, await readFile(childAbs));
    }
  }
}

function normalizeArchivePath(name: string): string | null {
  if (!name) return null;
  const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === "..")) return null;
  if (/^[a-zA-Z]:/.test(segments[0] ?? "")) return null;
  return segments.join("/");
}