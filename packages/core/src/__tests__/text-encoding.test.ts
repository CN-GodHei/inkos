import { describe, expect, it } from "vitest";
import { decodeTextBuffer } from "../utils/text-encoding.js";

describe("decodeTextBuffer", () => {
  it("decodes plain UTF-8 text", () => {
    const bytes = new TextEncoder().encode("第一章 测试\n这是内容。");
    expect(decodeTextBuffer(bytes)).toBe("第一章 测试\n这是内容。");
  });

  it("decodes GB18030 text that is not valid UTF-8", () => {
    const bytes = Uint8Array.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb2, 0xe2, 0xca, 0xd4, 0x0a,
      0xd5, 0xe2, 0xca, 0xc7, 0xc4, 0xda, 0xc8, 0xdd, 0xa1, 0xa3, 0x0a,
      0xb5, 0xda, 0xb6, 0xfe, 0xd5, 0xc2, 0x20, 0xbc, 0xcc, 0xd0, 0xf8, 0x0a,
      0xc8, 0xbb, 0xba, 0xf3, 0xca, 0xc7, 0xb5, 0xda, 0xb6, 0xfe, 0xb6, 0xce, 0xa1, 0xa3,
    ]);
    expect(decodeTextBuffer(bytes)).toBe("第一章 测试\n这是内容。\n第二章 继续\n然后是第二段。");
  });

  it("honors an explicit encoding override", () => {
    const bytes = Uint8Array.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb2, 0xe2, 0xca, 0xd4,
    ]);
    expect(decodeTextBuffer(bytes, "gb18030")).toBe("第一章 测试");
  });

  it("strips a UTF-8 byte-order mark", () => {
    const body = new TextEncoder().encode("正文");
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...body]);
    expect(decodeTextBuffer(withBom)).toBe("正文");
  });

  it("decodes UTF-16 LE with a BOM", () => {
    const le = Buffer.from("第一", "utf16le");
    const bytes = Uint8Array.from([0xff, 0xfe, ...le]);
    expect(decodeTextBuffer(bytes)).toBe("第一");
  });

  it("handles pure ASCII without a BOM", () => {
    expect(decodeTextBuffer(new TextEncoder().encode("hello world"))).toBe("hello world");
  });
});