import { describe, it, expect } from "vitest";
import {
  ARTIFACT_BRIDGE_SOURCE,
  assembleArtifact,
  buildArtifactsSystemText,
  extractArtifactBlock,
  guessMediaType,
  parseArtifact,
  serializeArtifact,
} from "@/lib/artifacts";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  skills: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
  audio: [],
});

describe("parseArtifact", () => {
  it("returns null until a file delimiter appears (streaming gate)", () => {
    expect(parseArtifact("")).toBeNull();
    expect(parseArtifact("title: Half-streamed\nstill loading")).toBeNull();
  });

  it("parses title and multiple files in declared order", () => {
    const out = parseArtifact(
      [
        "title: Todo App",
        "--- index.html ---",
        "<!doctype html><div id=app></div>",
        "--- style.css ---",
        "body { color: red; }",
        "--- script.js ---",
        "console.log('hi');",
      ].join("\n"),
    );
    expect(out).not.toBeNull();
    expect(out!.title).toBe("Todo App");
    expect(out!.files.map((f) => f.path)).toEqual([
      "index.html",
      "style.css",
      "script.js",
    ]);
    expect(out!.files[1].content).toBe("body { color: red; }");
  });

  it("derives a title from <title> when no title line is given", () => {
    const out = parseArtifact(
      "--- index.html ---\n<title>Snake Game</title><body></body>",
    );
    expect(out!.title).toBe("Snake Game");
  });

  it("falls back to 'Artifact' when no title is available", () => {
    const out = parseArtifact("--- main.js ---\nconsole.log(1);");
    expect(out!.title).toBe("Artifact");
  });

  it("preserves blank lines inside file content", () => {
    const out = parseArtifact("--- a.js ---\nline1\n\nline3");
    expect(out!.files[0].content).toBe("line1\n\nline3");
  });
});

describe("assembleArtifact", () => {
  it("inlines local stylesheet links and classic scripts", () => {
    const doc = assembleArtifact([
      {
        path: "index.html",
        content:
          '<html><head><link rel="stylesheet" href="style.css"></head>' +
          '<body><script src="script.js"></script></body></html>',
      },
      { path: "style.css", content: "body{color:red}" },
      { path: "script.js", content: "console.log(1)" },
    ]);
    expect(doc).toContain("<style>\nbody{color:red}\n</style>");
    expect(doc).toContain("<script>\nconsole.log(1)\n</script>");
    expect(doc).not.toContain('href="style.css"');
    expect(doc).not.toContain('src="script.js"');
  });

  it("leaves absolute/CDN URLs untouched", () => {
    const doc = assembleArtifact([
      {
        path: "index.html",
        content:
          '<html><head><link rel="stylesheet" href="https://cdn/x.css">' +
          '<script src="https://esm.sh/react"></script></head></html>',
      },
    ]);
    expect(doc).toContain('href="https://cdn/x.css"');
    expect(doc).toContain('src="https://esm.sh/react"');
  });

  it("rewrites local module imports to data: URLs", () => {
    const doc = assembleArtifact([
      {
        path: "index.html",
        content:
          '<html><body><script type="module" src="main.js"></script></body></html>',
      },
      { path: "main.js", content: "import { x } from './lib.js';\nx();" },
      { path: "lib.js", content: "export const x = () => {};" },
    ]);
    expect(doc).toContain('type="module"');
    expect(doc).toContain("from 'data:text/javascript;base64,");
    expect(doc).not.toContain("from './lib.js'");
  });

  it("injects the navigation bridge only when navBridge is set", () => {
    const files = [{ path: "index.html", content: "<body></body>" }];
    expect(assembleArtifact(files)).not.toContain(ARTIFACT_BRIDGE_SOURCE);
    const bridged = assembleArtifact(files, { navBridge: true });
    expect(bridged).toContain(ARTIFACT_BRIDGE_SOURCE);
    // Injected before the closing body tag.
    expect(bridged.indexOf(ARTIFACT_BRIDGE_SOURCE)).toBeLessThan(
      bridged.indexOf("</body>"),
    );
  });

  it("synthesizes an HTML wrapper when no html file is present", () => {
    const doc = assembleArtifact([
      { path: "style.css", content: "body{margin:0}" },
      { path: "app.js", content: "console.log('go')" },
    ]);
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain("body{margin:0}");
    expect(doc).toContain("console.log('go')");
  });
});

describe("parseArtifact / JSON fallback", () => {
  it("parses the {title, files:[{path, contents}]} JSON shape", () => {
    const out = parseArtifact(
      JSON.stringify({
        title: "My Website",
        files: [
          { path: "index.html", contents: "<!DOCTYPE html><h1>Hi</h1>" },
          { path: "style.css", contents: "h1{color:red}" },
        ],
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.title).toBe("My Website");
    expect(out!.files.map((f) => f.path)).toEqual(["index.html", "style.css"]);
    expect(out!.files[0].content).toContain("<h1>Hi</h1>");
  });

  it("accepts content/contents/code/source and path/name keys", () => {
    const out = parseArtifact(
      JSON.stringify({ files: [{ name: "app.js", code: "x()" }] }),
    );
    expect(out!.files[0]).toEqual({ path: "app.js", content: "x()" });
  });

  it("extracts JSON from surrounding prose or a ```json fence", () => {
    const prose =
      'Here is the site:\n```json\n{"files":[{"path":"a.html","content":"<p>a</p>"}]}\n```\nEnjoy!';
    expect(parseArtifact(prose)!.files[0].path).toBe("a.html");
  });

  it("returns null for non-artifact JSON and incomplete JSON", () => {
    expect(parseArtifact('{"foo": 1, "bar": [1,2,3]}')).toBeNull();
    expect(parseArtifact('{"files":[{"path":"a.js","content":"x"')).toBeNull();
  });
});

describe("serializeArtifact / round-trip", () => {
  it("round-trips through parseArtifact", () => {
    const files = [
      { path: "index.html", content: "<h1>Hi</h1>" },
      { path: "app.js", content: "const x = 1;\nconsole.log(x);" },
    ];
    const reparsed = parseArtifact(serializeArtifact("My App", files));
    expect(reparsed!.title).toBe("My App");
    expect(reparsed!.files).toEqual(files);
  });
});

describe("extractArtifactBlock", () => {
  it("returns null when no artifact fence is present", () => {
    expect(extractArtifactBlock("just some prose")).toBeNull();
    expect(extractArtifactBlock("```html\n<div></div>\n```")).toBeNull();
  });

  it("extracts the block body from surrounding prose", () => {
    const resp =
      "Sure! Here you go:\n\n```artifact\ntitle: X\n--- index.html ---\n<h1>Hi</h1>\n```\n\nEnjoy.";
    const body = extractArtifactBlock(resp);
    expect(body).toBe("title: X\n--- index.html ---\n<h1>Hi</h1>");
    expect(parseArtifact(body!)!.files[0].path).toBe("index.html");
  });

  it("extracts to end while still streaming (no closing fence yet)", () => {
    const body = extractArtifactBlock("```artifact\n--- a.js ---\ncon");
    expect(body).toBe("--- a.js ---\ncon");
  });
});

describe("guessMediaType", () => {
  it("maps known extensions", () => {
    expect(guessMediaType("index.html")).toBe("text/html");
    expect(guessMediaType("a/b/style.css")).toBe("text/css");
    expect(guessMediaType("script.mjs")).toBe("text/javascript");
    expect(guessMediaType("data.json")).toBe("application/json");
    expect(guessMediaType("README")).toBe("text/plain");
  });
});

describe("buildArtifactsSystemText", () => {
  it("returns empty string when the artifact renderer is disabled", () => {
    expect(buildArtifactsSystemText(registry([]))).toBe("");
    expect(buildArtifactsSystemText(registry(["mermaid"]))).toBe("");
  });

  it("returns the authoring instructions when enabled", () => {
    const out = buildArtifactsSystemText(registry(["artifact"]));
    expect(out).toContain("## Artifacts");
    expect(out).toContain("`artifact`");
    expect(out).toContain("--- <path> ---");
  });
});
