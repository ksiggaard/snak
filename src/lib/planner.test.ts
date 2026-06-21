import { describe, expect, it } from "vitest";
import {
  buildCriticRequest,
  buildCriticSystemPrompt,
  parseCriticResponse,
  parsePlan,
  scoreModelForStep,
  validateSteps,
} from "@/lib/planner";
import type { ProviderMeta } from "@/lib/providers";
import type { Model, Provider } from "@/types/db";

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
