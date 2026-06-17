import { describe, it, expect } from "vitest";
import type { StreamEvent } from "@/lib/chat";
import {
  applySubagentEvent,
  applyToolEvent,
  applyTraceEvent,
  imageDataUrl,
  isModelOutput,
  persistableSubagent,
  persistableToolCall,
  TOOL_ARGS_PERSIST_BUDGET,
  TOOL_OUTPUT_PERSIST_BUDGET,
  type ApiTraceEntry,
  type MessageImage,
  type MessageSubagent,
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
      ev({
        toolCall: { id: "c1", name: "sys__run_diagnostic", command: "ps aux" },
      }),
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
    applyToolEvent(
      ev({ toolCall: { id: "c1", name: "web__search_web" } }),
      calls,
    );
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
      persistableToolCall({ id: "c1", name: "web__search_web", sources })
        .sources,
    ).toEqual(sources);
    expect(
      persistableToolCall({ id: "c1", name: "t", sources: [] }).sources,
    ).toBeUndefined();
  });
});

describe("applySubagentEvent", () => {
  const ev = (e: Partial<StreamEvent>): StreamEvent => e;

  it("creates a card on the first event and updates it by id", () => {
    const subs: MessageSubagent[] = [];
    applySubagentEvent(
      ev({ subagent: { id: "s-0", phase: "dispatched", task: "find X" } }),
      subs,
    );
    expect(subs).toEqual([{ id: "s-0", task: "find X", status: "dispatched" }]);

    applySubagentEvent(ev({ subagent: { id: "s-0", phase: "running" } }), subs);
    expect(subs[0].status).toBe("running");
    // Task is preserved across events that don't resend it.
    expect(subs[0].task).toBe("find X");

    applySubagentEvent(
      ev({ subagent: { id: "s-0", phase: "done", summary: "X is 42." } }),
      subs,
    );
    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual({
      id: "s-0",
      task: "find X",
      status: "done",
      summary: "X is 42.",
    });
  });

  it("tracks multiple subagents independently and ignores non-subagent events", () => {
    const subs: MessageSubagent[] = [];
    applySubagentEvent(
      ev({ subagent: { id: "s-0", phase: "dispatched", task: "A" } }),
      subs,
    );
    applySubagentEvent(
      ev({ subagent: { id: "s-1", phase: "dispatched", task: "B" } }),
      subs,
    );
    applySubagentEvent(ev({ text: "hello" }), subs);
    expect(subs.map((s) => s.id)).toEqual(["s-0", "s-1"]);
    applySubagentEvent(
      ev({ subagent: { id: "s-1", phase: "failed", summary: "timed out" } }),
      subs,
    );
    expect(subs[1].status).toBe("failed");
    expect(subs[0].status).toBe("dispatched");
  });
});

describe("persistableSubagent", () => {
  it("keeps id/task/status/summary and drops an empty summary", () => {
    const done: MessageSubagent = {
      id: "s-0",
      task: "t",
      status: "done",
      summary: "found it",
    };
    expect(persistableSubagent(done)).toEqual(done);
    expect(
      persistableSubagent({ id: "s-1", task: "t", status: "running" }).summary,
    ).toBeUndefined();
  });
});

describe("applyToolEvent — arguments", () => {
  const ev = (e: Partial<StreamEvent>): StreamEvent => e;

  it("copies the model's tool arguments onto the call", () => {
    const calls: MessageToolCall[] = [];
    applyToolEvent(
      ev({ toolCall: { id: "c1", name: "t", arguments: { q: "hi", n: 3 } } }),
      calls,
    );
    expect(calls[0].arguments).toEqual({ q: "hi", n: 3 });
  });
});

describe("persistableToolCall — arguments", () => {
  it("keeps small arguments", () => {
    const persisted = persistableToolCall({
      id: "c1",
      name: "t",
      arguments: { url: "https://x.com" },
    });
    expect(persisted.arguments).toEqual({ url: "https://x.com" });
  });

  it("drops oversized arguments rather than bloating the row", () => {
    const big = { blob: "A".repeat(TOOL_ARGS_PERSIST_BUDGET + 1) };
    const persisted = persistableToolCall({
      id: "c1",
      name: "t",
      arguments: big,
    });
    expect(persisted.arguments).toBeUndefined();
  });
});

describe("applyTraceEvent", () => {
  const ev = (e: Partial<StreamEvent>): StreamEvent => e;

  it("appends request and response entries in arrival order", () => {
    const trace: ApiTraceEntry[] = [];
    applyTraceEvent(
      ev({ apiTrace: { phase: "request", round: 0, data: { model: "x" } } }),
      trace,
    );
    applyTraceEvent(
      ev({
        apiTrace: { phase: "response", round: 0, data: { finish: "end" } },
      }),
      trace,
    );
    expect(trace).toHaveLength(2);
    expect(trace[0].phase).toBe("request");
    expect(trace[1].phase).toBe("response");
    expect(trace[1].round).toBe(0);
  });

  it("ignores events without an apiTrace field", () => {
    const trace: ApiTraceEntry[] = [];
    applyTraceEvent(ev({ text: "hi" }), trace);
    expect(trace).toHaveLength(0);
  });
});

describe("isModelOutput", () => {
  const ev = (e: Partial<StreamEvent>): StreamEvent => e;

  it("is true for a text chunk", () => {
    expect(isModelOutput(ev({ text: "The" }))).toBe(true);
  });

  it("is true for a reasoning chunk", () => {
    expect(isModelOutput(ev({ reasoning: { text: "hmm" } }))).toBe(true);
  });

  it("is true for a tool call", () => {
    expect(
      isModelOutput(ev({ toolCall: { id: "1", name: "search" } })),
    ).toBe(true);
  });

  it("is false for the pre-request API-trace event (the loader bug)", () => {
    // The trace `request` entry arrives before the model has produced anything;
    // treating it as output hid "Thinking…" during a slow first token.
    expect(
      isModelOutput(ev({ apiTrace: { phase: "request", round: 0, data: {} } })),
    ).toBe(false);
  });

  it("is false for an approval request", () => {
    expect(
      isModelOutput(
        ev({
          approvalRequest: {
            id: "1",
            toolName: "sys",
            summary: "Read file",
            detail: "/etc/hosts",
          },
        }),
      ),
    ).toBe(false);
  });

  it("is false for an empty text chunk", () => {
    expect(isModelOutput(ev({ text: "" }))).toBe(false);
  });
});
