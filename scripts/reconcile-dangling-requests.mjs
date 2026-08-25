#!/usr/bin/env node
// One-time cleanup for stale "dangling" transcript requests.
//
// Interrupted free-text turns can leave a `request_started` event with no
// matching `request_committed` / `request_failed` in a session transcript
// (server restarted / request cancelled mid-flight). The UI then treats the
// newest dangling request as "in progress" on every refresh. The server
// reconciles these lazily when a session is opened; this script cleans them
// all up in one pass.
//
// Usage:
//   node scripts/reconcile-dangling-requests.mjs [projectRoot] [--dry-run]
//
// Default projectRoot is the current working directory. With --dry-run it only
// prints what would be reconciled without writing anything.

import { readdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ROOT = args.find((arg) => !arg.startsWith("--")) ?? process.cwd();
const SESSIONS_DIR = join(ROOT, ".inkos", "sessions");
const FAILED_MESSAGE =
  "任务已中断：服务在运行期间重启或请求被取消。请重新发起。";

async function main() {
  let files;
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    console.log(`No sessions dir at ${SESSIONS_DIR}`);
    return;
  }

  let sessionsTouched = 0;
  let reconciled = 0;

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.slice(0, -".jsonl".length);
    const path = join(SESSIONS_DIR, file);

    let events;
    try {
      const raw = await readFile(path, "utf-8");
      events = raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
    } catch {
      console.log(`skip unreadable transcript: ${sessionId}`);
      continue;
    }

    const finished = new Set(
      events
        .filter((event) => event.type === "request_committed" || event.type === "request_failed")
        .map((event) => event.requestId),
    );
    const dangling = events
      .filter((event) => event.type === "request_started" && !finished.has(event.requestId))
      .sort((a, b) => a.seq - b.seq);

    if (dangling.length === 0) continue;

    const nextSeq = events.reduce((max, event) => Math.max(max, event.seq ?? 0), 0) + 1;
    const failedLines = dangling.map((event, index) =>
      JSON.stringify({
        type: "request_failed",
        version: 1,
        sessionId,
        requestId: event.requestId,
        seq: nextSeq + index,
        // 用原请求的开始时间作为失败时间，避免清理动作把会话"顶"成最新更新。
        timestamp: event.timestamp,
        error: FAILED_MESSAGE,
      }),
    );

    if (dryRun) {
      console.log(`[dry-run] ${sessionId}: ${dangling.length} dangling request(s)`);
    } else {
      await appendFile(path, `${failedLines.join("\n")}\n`, "utf-8");
      console.log(`reconciled ${dangling.length} dangling request(s) in ${sessionId}`);
    }
    sessionsTouched += 1;
    reconciled += dangling.length;
  }

  console.log(
    dryRun
      ? `Dry-run: ${sessionsTouched} session(s), ${reconciled} dangling request(s) would be marked as failed.`
      : `Done: ${sessionsTouched} session(s), ${reconciled} dangling request(s) marked as failed.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});