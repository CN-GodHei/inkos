# InkOS · Personal Fork

This repository is a **personal fork** of [Narcooo/inkos](https://github.com/Narcooo/inkos), with some targeted adjustments for personal use. It is not the official build.

For all original features, documentation, and screenshots, please refer to the upstream repository:

👉 **https://github.com/Narcooo/inkos**

## Main adjustments in this fork

- Import of GBK / GB18030 encoded webnovel `.txt` files (downloads from txt80, 笔趣阁, etc.)
- Real-time progress during canon import, plus dedup by content fingerprint and resume of interrupted imports
- Local retrieval falls back to LIKE search on Node builds without the FTS5 extension
- Cross-platform `dev` scripts (`pnpm dev` works on Windows directly)

## Usage

Please follow the [upstream README](https://github.com/Narcooo/inkos#readme).