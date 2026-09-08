import { describe, expect, it } from "vitest";

import { decodeEntities, htmlToMarkdown } from "./html";

describe("htmlToMarkdown", () => {
  it("converts GitHub inline HTML to markdown", () => {
    expect(
      htmlToMarkdown(
        '<strong>Ready</strong> by <a href="https://github.com/octocat">octocat</a>',
      ),
    ).toBe("**Ready** by [octocat](https://github.com/octocat)");
  });

  it("leaves tags inside fenced code unchanged", () => {
    const source = "```html\n<details><summary>Example</summary></details>\n```";

    expect(htmlToMarkdown(source)).toContain(source);
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("A &amp; B &#35;1 &#x2713;")).toBe("A & B #1 \u2713");
  });
});
