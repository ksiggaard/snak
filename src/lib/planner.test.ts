import { describe, expect, it } from "vitest";
import {
  buildCriticRequest,
  buildCriticSystemPrompt,
  executePlan,
  MAX_PLAN_STEPS,
  parseCriticResponse,
  parsePlan,
  resolveStepVariables,
  scoreModelForStep,
  topologicalSort,
  validateSteps,
} from "@/lib/planner";
import type { Plan, PlanStep, StepResult } from "@/lib/planner";
import type { ProviderMeta } from "@/lib/providers";
import type { Model, Provider } from "@/types/db";

const EMPTY_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
};

/** A minimal plan step for execution/ordering tests. */
function makeStep(id: string, depends_on: string[] = []): PlanStep {
  return {
    id,
    description: id,
    provider: "anthropic" as Provider,
    model: "claude-opus-4-8",
    prompt: `do ${id}`,
    depends_on,
  };
}

/** A passthrough runStep that records call order and echoes a result. */
function makeRunner(
  ran: string[],
  behavior: (step: PlanStep, resolved: string) => string | never = (s) =>
    `${s.id}-ok`,
) {
  return async (step: PlanStep, resolved: string): Promise<StepResult> => {
    ran.push(step.id);
    return {
      stepId: step.id,
      description: step.description,
      provider: step.provider,
      model: step.model,
      content: behavior(step, resolved),
      usage: EMPTY_USAGE,
    };
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProvider(id: Provider, defaultModel: string): ProviderMeta {
  return { id, label: id, defaultModel, keyHint: "" };
}

function makeModel(
  id: number,
  provider: Provider,
  model_id: string,
  label: string,
  notes = "",
): Model {
  return { id, provider, model_id, label, sort_order: id, notes };
}

const anthropic = makeProvider("anthropic", "claude-opus-4-8");
const openai = makeProvider("openai", "gpt-4o");
const mistral = makeProvider("mistral", "mistral-large-latest");
const providers = [anthropic, openai, mistral];

const claudeOpus = makeModel(1, "anthropic", "claude-opus-4-8", "Opus 4.8", "Best for complex reasoning and long-form writing.");
const claudeSonnet = makeModel(2, "anthropic", "claude-sonnet-4-6", "Sonnet 4.6", "Balanced speed and intelligence for coding.");
const claudeHaiku = makeModel(3, "anthropic", "claude-haiku-4-5", "Haiku 4.5", "Fast and cheap for simple tasks.");
const gpt4o = makeModel(4, "openai", "gpt-4o", "GPT-4o", "Great all-rounder with strong multimodal.");
const mistralLarge = makeModel(5, "mistral", "mistral-large-latest", "Mistral Large", "Strong reasoning at competitive price.");

const allModels = [claudeOpus, claudeSonnet, claudeHaiku, gpt4o, mistralLarge];

// Providers that have API keys (or are keyless). OpenAI is NOT keyed — simulating a
// provider with models in the DB but no saved API key.
const keyedProviders = new Set<Provider>(["anthropic", "mistral"]);

// ---------------------------------------------------------------------------
// scoreModelForStep
// ---------------------------------------------------------------------------

describe("scoreModelForStep", () => {
  it("returns 100 for exact model_id match", () => {
    expect(scoreModelForStep("claude-opus-4-8", "do something", claudeOpus)).toBe(100);
  });

  it("returns 90 for exact label match", () => {
    expect(scoreModelForStep("Opus 4.8", "do something", claudeOpus)).toBe(90);
  });

  it("scores substring in model_id", () => {
    expect(scoreModelForStep("opus", "do something", claudeOpus)).toBeGreaterThanOrEqual(50);
  });

  it("scores substring in label", () => {
    expect(scoreModelForStep("Sonnet", "do something", claudeSonnet)).toBeGreaterThanOrEqual(40);
  });

  it("scores shared words", () => {
    const s = scoreModelForStep("claude-sonnet-4-5", "do something", claudeSonnet);
    expect(s).toBeGreaterThanOrEqual(20);
  });

  it("adds notes keyword overlap with step context", () => {
    const s = scoreModelForStep("fast-model", "do a simple fast task", claudeHaiku);
    // Haiku notes: "Fast and cheap for simple tasks."
    // "fast" and "simple" overlap with context
    expect(s).toBeGreaterThanOrEqual(10);
  });

  it("returns low score for no match", () => {
    const s = scoreModelForStep("xyz-nonexistent", "do something", claudeOpus);
    expect(s).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// validateSteps
// ---------------------------------------------------------------------------

describe("validateSteps", () => {
  it("passes through exact provider+model match", () => {
    const steps = [{ id: "1", description: "test", provider: "anthropic" as Provider, model: "claude-sonnet-4-6", prompt: "do it", depends_on: [] }];
    const { steps: corrected, warnings } = validateSteps(steps, allModels, providers, keyedProviders);
    expect(corrected).toEqual(steps);
    expect(warnings).toHaveLength(0);
  });

  it("fuzzy-corrects hallucinated model for valid provider", () => {
    const steps = [{ id: "1", description: "test", provider: "anthropic" as Provider, model: "claude-sonnet-4-5", prompt: "do it", depends_on: [] }];
    const { steps: corrected, warnings } = validateSteps(steps, allModels, providers, keyedProviders);
    expect(corrected[0].model).toBe("claude-sonnet-4-6");
    expect(corrected[0].provider).toBe("anthropic");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain("claude-sonnet-4-5");
    expect(warnings[0]).toContain("claude-sonnet-4-6");
  });

  it("falls back to provider default when no model matches", () => {
    const steps = [{ id: "1", description: "test", provider: "anthropic" as Provider, model: "no-such-model-xyz", prompt: "do it", depends_on: [] }];
    const { steps: corrected, warnings } = validateSteps(steps, allModels, providers, keyedProviders);
    expect(corrected[0].model).toBe("claude-opus-4-8"); // default
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("cross-matches unknown provider across all keyed providers", () => {
    // "cohere" is unknown, OpenAI is not keyed → only anthropic + mistral considered.
    // "gpt-4o" has no close match in those, so falls back to first keyed provider default.
    const steps = [{ id: "1", description: "test", provider: "cohere" as Provider, model: "gpt-4o", prompt: "do it", depends_on: [] }];
    const { steps: corrected, warnings } = validateSteps(steps, allModels, providers, keyedProviders);
    expect(corrected[0].provider).toBe("anthropic");
    expect(corrected[0].model).toBe("claude-opus-4-8");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not match to unkeyed provider when keyed ones exist", () => {
    // Planner hallucinates "gpt4" — should not route to unkeyed OpenAI.
    const steps = [{ id: "1", description: "test", provider: "unknown" as Provider, model: "gpt4", prompt: "do it", depends_on: [] }];
    const { steps: corrected, warnings } = validateSteps(steps, allModels, providers, keyedProviders);
    // Should NOT be OpenAI (unkeyed). Should fall back to a keyed provider.
    expect(corrected[0].provider).not.toBe("openai");
    expect(keyedProviders.has(corrected[0].provider)).toBe(true);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty steps array", () => {
    const { steps: corrected, warnings } = validateSteps([], allModels, providers, keyedProviders);
    expect(corrected).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("uses notes relevance when choosing between candidates", () => {
    const steps = [{ id: "1", description: "Do a complex reasoning task", provider: "anthropic" as Provider, model: "claude", prompt: "think hard", depends_on: [] }];
    const { steps: corrected } = validateSteps(steps, allModels, providers, keyedProviders);
    // "claude" matches all three Anthropic models equally by name, but "complex reasoning" in context
    // should boost claudeOpus ("Best for complex reasoning and long-form writing.")
    expect(corrected[0].model).toBe("claude-opus-4-8");
  });
});

// ---------------------------------------------------------------------------
// parsePlan
// ---------------------------------------------------------------------------

describe("parsePlan", () => {
  it("returns validated plan with no warnings for exact matches", () => {
    const planJson = `\`\`\`json
{
  "strategy": "route",
  "reasoning": "delegate to claude",
  "steps": [{
    "id": "1",
    "description": "think",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "prompt": "think about it",
    "depends_on": []
  }]
}
\`\`\``;
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    expect(result!.plan.strategy).toBe("route");
    expect(result!.warnings).toHaveLength(0);
  });

  it("corrects hallucinated model and returns warnings", () => {
    const planJson = `\`\`\`json
{
  "strategy": "route",
  "reasoning": "",
  "steps": [{
    "id": "1",
    "description": "think",
    "provider": "anthropic",
    "model": "claude-5",
    "prompt": "",
    "depends_on": []
  }]
}
\`\`\``;
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    expect(result!.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result!.plan.steps[0].model).not.toBe("claude-5");
  });

  it("handles unknown provider by preferring keyed providers", () => {
    const planJson = `\`\`\`json
{
  "strategy": "route",
  "reasoning": "",
  "steps": [{
    "id": "1",
    "description": "think",
    "provider": "unknown",
    "model": "mistral",
    "prompt": "",
    "depends_on": []
  }]
}
\`\`\``;
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    // "mistral" fuzzy-matches mistral-large-latest in the keyed mistral provider.
    expect(result!.plan.steps[0].provider).toBe("mistral");
    expect(result!.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null for unparseable JSON", () => {
    expect(parsePlan("just some text with no plan", allModels, providers, keyedProviders)).toBeNull();
  });

  it("returns null for JSON without strategy field", () => {
    const planJson = '```json\n{"reasoning": "nope"}\n```';
    expect(parsePlan(planJson, allModels, providers, keyedProviders)).toBeNull();
  });

  it("returns plan for direct strategy with empty steps", () => {
    const planJson = '```json\n{"strategy": "direct", "reasoning": "simple", "steps": []}\n```';
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    expect(result!.plan.strategy).toBe("direct");
    expect(result!.plan.steps).toHaveLength(0);
  });

  it("works with raw JSON (no fence)", () => {
    const planJson = '{"strategy": "direct", "reasoning": "", "steps": []}';
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    expect(result!.plan.strategy).toBe("direct");
  });
});

// ---------------------------------------------------------------------------
// buildCriticSystemPrompt
// ---------------------------------------------------------------------------

describe("buildCriticSystemPrompt", () => {
  it("returns non-empty string", () => {
    expect(buildCriticSystemPrompt().length).toBeGreaterThan(0);
  });

  it("includes approval criteria", () => {
    const prompt = buildCriticSystemPrompt();
    expect(prompt).toContain("approved");
    expect(prompt).toContain("issues");
    expect(prompt).toContain("Model availability");
  });
});

// ---------------------------------------------------------------------------
// parseCriticResponse
// ---------------------------------------------------------------------------

describe("parseCriticResponse", () => {
  it("parses approved response", () => {
    const json = '```json\n{"approved": true, "issues": []}\n```';
    const result = parseCriticResponse(json);
    expect(result).not.toBeNull();
    expect(result!.approved).toBe(true);
    expect(result!.issues).toEqual([]);
  });

  it("parses not-approved with issues", () => {
    const json = '```json\n{"approved": false, "issues": ["model missing", "bad prompt"]}\n```';
    const result = parseCriticResponse(json);
    expect(result).not.toBeNull();
    expect(result!.approved).toBe(false);
    expect(result!.issues).toEqual(["model missing", "bad prompt"]);
  });

  it("rejects malformed JSON", () => {
    expect(parseCriticResponse("not json at all")).toBeNull();
  });

  it("rejects JSON without boolean approved", () => {
    expect(parseCriticResponse('```json\n{"approved": "yes", "issues": []}\n```')).toBeNull();
  });

  it("parses raw JSON without fence", () => {
    const json = '{"approved": false, "issues": ["bad"]}';
    const result = parseCriticResponse(json);
    expect(result).not.toBeNull();
    expect(result!.approved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildCriticRequest
// ---------------------------------------------------------------------------

describe("buildCriticRequest", () => {
  it("includes original request and plan JSON", () => {
    const plan = { strategy: "route" as const, reasoning: "test", steps: [] };
    const req = buildCriticRequest("Hello world", plan);
    expect(req).toContain("Hello world");
    expect(req).toContain('"strategy"');
  });
});

// ---------------------------------------------------------------------------
// resolveStepVariables
// ---------------------------------------------------------------------------

describe("resolveStepVariables", () => {
  it("substitutes a known placeholder", () => {
    const { prompt, missing } = resolveStepVariables(
      "use {a} now",
      new Map([["a", "RESULT"]]),
    );
    expect(prompt).toBe("use RESULT now");
    expect(missing).toEqual([]);
  });

  it("resolves hyphenated step ids", () => {
    const { prompt, missing } = resolveStepVariables(
      "based on {research-a}",
      new Map([["research-a", "DATA"]]),
    );
    expect(prompt).toBe("based on DATA");
    expect(missing).toEqual([]);
  });

  it("leaves unknown placeholders intact and reports them as missing", () => {
    const { prompt, missing } = resolveStepVariables(
      "use {a} and {b}",
      new Map([["a", "X"]]),
    );
    expect(prompt).toBe("use X and {b}");
    expect(missing).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe("topologicalSort", () => {
  it("groups independent steps into wave 0 and dependents after", () => {
    const waves = topologicalSort([
      makeStep("a"),
      makeStep("b"),
      makeStep("c", ["a", "b"]),
    ]);
    expect(waves[0].map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(waves[1].map((s) => s.id)).toEqual(["c"]);
  });

  it("omits steps caught in a dependency cycle", () => {
    const waves = topologicalSort([makeStep("a", ["b"]), makeStep("b", ["a"])]);
    expect(waves.flat()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// executePlan
// ---------------------------------------------------------------------------

describe("executePlan", () => {
  it("runs steps in dependency order, threading results into later prompts", async () => {
    const plan: Plan = {
      strategy: "multi_step",
      reasoning: "",
      steps: [makeStep("a"), { ...makeStep("b", ["a"]), prompt: "use {a}" }],
    };
    const seen: Record<string, string> = {};
    await executePlan(plan, async (step, resolved) => {
      seen[step.id] = resolved;
      return {
        stepId: step.id,
        description: step.id,
        provider: step.provider,
        model: step.model,
        content: step.id === "a" ? "AAA" : "",
        usage: EMPTY_USAGE,
      };
    });
    expect(seen["b"]).toBe("use AAA");
  });

  it("isolates a failing step so siblings and the synthesis still run", async () => {
    const plan: Plan = {
      strategy: "multi_step",
      reasoning: "",
      steps: [makeStep("a"), makeStep("b"), makeStep("synth", ["a", "b"])],
    };
    const ran: string[] = [];
    const { results } = await executePlan(
      plan,
      makeRunner(ran, (s) => {
        if (s.id === "a") throw new Error("boom");
        return `${s.id}-ok`;
      }),
    );
    expect(ran).toContain("b");
    expect(ran).toContain("synth");
    expect(results.find((r) => r.stepId === "synth")?.content).toBe("synth-ok");
    // The failed step resolves to empty content, not a thrown rejection.
    expect(results.find((r) => r.stepId === "a")?.content).toBe("");
  });

  it("runs steps with dangling dependencies anyway and reports them as dropped", async () => {
    const plan: Plan = {
      strategy: "multi_step",
      reasoning: "",
      steps: [makeStep("a"), makeStep("b", ["ghost"])],
    };
    const ran: string[] = [];
    const { dropped } = await executePlan(plan, makeRunner(ran));
    expect(dropped).toContain("b");
    expect(ran).toContain("b");
  });
});

// ---------------------------------------------------------------------------
// parsePlan — robustness guards
// ---------------------------------------------------------------------------

describe("parsePlan robustness", () => {
  it("filters non-string entries out of depends_on", () => {
    const planJson = `\`\`\`json
{
  "strategy": "multi_step",
  "reasoning": "",
  "steps": [
    { "id": "a", "description": "x", "provider": "anthropic", "model": "claude-opus-4-8", "prompt": "p", "depends_on": [] },
    { "id": "b", "description": "y", "provider": "anthropic", "model": "claude-opus-4-8", "prompt": "q", "depends_on": ["a", 5, null] }
  ]
}
\`\`\``;
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    const b = result!.plan.steps.find((s) => s.id === "b");
    expect(b?.depends_on).toEqual(["a"]);
  });

  it("caps oversized plans at MAX_PLAN_STEPS with a warning", () => {
    const steps = Array.from({ length: MAX_PLAN_STEPS + 5 }, (_, i) => ({
      id: `s${i}`,
      description: "x",
      provider: "anthropic",
      model: "claude-opus-4-8",
      prompt: "p",
      depends_on: [],
    }));
    const planJson =
      "```json\n" +
      JSON.stringify({ strategy: "multi_step", reasoning: "", steps }) +
      "\n```";
    const result = parsePlan(planJson, allModels, providers, keyedProviders);
    expect(result).not.toBeNull();
    expect(result!.plan.steps).toHaveLength(MAX_PLAN_STEPS);
    expect(result!.warnings.some((w) => /step/i.test(w))).toBe(true);
  });
});
