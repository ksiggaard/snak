import { describe, it, expect } from "vitest";
import type { StreamEvent } from "@/lib/chat";
import {
  applyToolEvent,
  imageDataUrl,
  persistableToolCall,
  TOOL_OUTPUT_PERSIST_BUDGET,
  type MessageImage,
  type MessageToolCall,
} from "@/lib/messages";

describe("imageDataUrl", () => {
  it("formats a base64 image as a data URL", () => {
    const img: MessageImage = { media_type: "image/jpeg", data: "AAAA" };
    expect(imageDataUrl(img)).toBe("data:image/jpeg;base64,AAAA");
  });

  it("preserves the media type for PNGs", () => {
    const img: MessageImage = { media_type: "image/png", data: "QkM=" };
    expect(imageDataUrl(img)).toBe("data:image/png;base64,QkM=");
  });

  it("handles an empty payload", () => {
    const img: MessageImage = { media_type: "image/webp", data: "" };
    expect(imageDataUrl(img)).toBe("data:image/webp;base64,");
  });
});

describe("applyToolEvent", () => {
  const ev = (e: Partial<StreamEvent>): StreamEvent => e;

  it("starts a running tool call from a toolCall event", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(
      ev({ toolCall: { id: "c1", name: "sys__run_diagnostic", command: "ps aux" } }),
      calls,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: "c1",
      name: "sys__run_diagnostic",
      command: "ps aux",
      output: "",
      running: true,
    });
  });

  it("appends streamed output lines to the matching call", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(ev({ toolCall: { id: "c1", name: "t" } }), calls);
    applyToolEvent(ev({ toolOutput: { id: "c1", chunk: "line 1" } }), calls);
    applyToolEvent(ev({ toolOutput: { id: "c1", chunk: "line 2" } }), calls);
    expect(calls[0].output).toBe("line 1\nline 2\n");
  });

  it("stops the spinner and records ok on toolDone", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(ev({ toolCall: { id: "c1", name: "t" } }), calls);
    applyToolEvent(ev({ toolDone: { id: "c1", ok: false } }), calls);
    expect(calls[0].running).toBe(false);
    expect(calls[0].ok).toBe(false);
  });

  it("ignores output/done events for an unknown id", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(ev({ toolOutput: { id: "ghost", chunk: "x" } }), calls);
    applyToolEvent(ev({ toolDone: { id: "ghost", ok: true } }), calls);
    expect(calls).toHaveLength(0);
  });

  it("folds web sources onto the matching call (and accumulates batches)", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(ev({ toolCall: { id: "c1", name: "web__search_web" } }), calls);
    applyToolEvent(
      ev({
        toolSources: {
          id: "c1",
          sources: [{ url: "https://a.com", title: "A", snippet: "first" }],
        },
      }),
      calls,
    );
    applyToolEvent(
      ev({ toolSources: { id: "c1", sources: [{ url: "https://b.com" }] } }),
      calls,
    );
    expect(calls[0].sources).toEqual([
      { url: "https://a.com", title: "A", snippet: "first" },
      { url: "https://b.com" },
    ]);
  });

  it("ignores source events for an unknown id", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(
      ev({ toolSources: { id: "ghost", sources: [{ url: "https://x" }] } }),
      calls,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("persistableToolCall", () => {
  it("drops the transient running flag and empty output", () => {
    const persisted = persistableToolCall({
      id: "c1",
      name: "t",
      output: "",
      running: true,
    });
    expect(persisted).not.toHaveProperty("running");
    expect(persisted.output).toBeUndefined();
  });

  it("caps oversized output with a truncation marker", () => {
    const big = "x".repeat(TOOL_OUTPUT_PERSIST_BUDGET + 100);
    const persisted = persistableToolCall({ id: "c1", name: "t", output: big });
    expect(persisted.output!.length).toBeLessThan(big.length);
    expect(persisted.output!.endsWith("[… truncated]")).toBe(true);
  });

  it("preserves command, url, and ok", () => {
    const persisted = persistableToolCall({
      id: "c1",
      name: "t",
      command: "df -h",
      url: "https://x.com",
      ok: true,
      output: "ok",
    });
    expect(persisted).toMatchObject({
      command: "df -h",
      url: "https://x.com",
      ok: true,
      output: "ok",
    });
  });

  it("preserves non-empty web sources and drops an empty list", () => {
    const sources = [{ url: "https://a.com", title: "A", snippet: "s" }];
    expect(
      persistableToolCall({ id: "c1", name: "web__search_web", sources }).sources,
    ).toEqual(sources);
    expect(
      persistableToolCall({ id: "c1", name: "t", sources: [] }).sources,
    ).toBeUndefined();
  });
});
