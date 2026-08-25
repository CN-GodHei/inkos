# InkOS · Personal Fork

This repository is a **personal fork** of [Narcooo/inkos](https://github.com/Narcooo/inkos), with some targeted adjustments for personal use. It is not the official build.

For all original features, documentation, and screenshots, please refer to the upstream repository:

👉 **https://github.com/Narcooo/inkos**

## Main adjustments in this fork

### Import & Encoding

- Import of GBK / GB18030 encoded webnovel `.txt` files (downloads from txt80, 笔趣阁, etc.)
- Real-time progress during canon import, plus dedup by content fingerprint and resume of interrupted imports
- Local retrieval falls back to LIKE search on Node builds without the FTS5 extension

### Writing Pipeline

- Batch-write N consecutive chapters from the book detail page
- Interrupted chapter writes resume from a disk checkpoint (draft, control input, length spec)
- On LLM failure the planner memo and context compression degrade gracefully instead of aborting the chapter
- Chapter titles are constrained to 5-10 characters; REPAIR verdicts no longer lock chapters into state-degraded
- auditor / exporter sub-agents can be called without an extra instruction
- Less terminal log noise, plus per-stage timing for pipeline phases
- Whole-project archive export / import (zip); export failures surface clearly instead of downloading an error JSON

### Studio UI

- Mobile-friendly: the UI shell and pages work on phones
- Reading mode
- Chapter copy actions and reader navigation fixes
- Chapter list defaults to newest-first with a sort toggle
- The chat-selected model is persisted and used as the default for pipeline operations (writing / imitation / side-story / canon import, etc.)

### Cross-device State Sync

- Confirmed production tasks (book setup / writing / short fiction, etc.) run as background tasks: you can keep chatting in parallel while a task runs, with the task card showing stages and logs live
- PC and mobile stay in sync in real time: another device / tab sees running task cards and chat turns live, and restores them after a refresh
- Stale "interrupted" requests are reconciled on session load so old commands are never mistaken for currently running work

### Engineering & Compatibility

- Cross-platform `dev` scripts (`pnpm dev` works on Windows directly)
- Persisted paths normalized across platforms; pnpm 9 builds compatible

## Usage

Please follow the [upstream README](https://github.com/Narcooo/inkos#readme).