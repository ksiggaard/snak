// Planner orchestration engine: sends a user request to a planner model,
// parses its JSON plan, and dispatches worker steps (parallel where possible).
// The planner only runs when a planner model is configured and planner mode is
// active on the current chat.

import type { Provider, Model } from "@/types/db";
import type { ProviderMeta } from "@/lib/providers";
import type { ChatUsage } from "@/lib/chat";

// ---------------------------------------------------------------------------
// Planner model config
// ---------------------------------------------------------------------------

/** User-configured capabilities per model, stored as JSON in the settings
 *  table under key `"planner_model_config"`. Key = `"provider::model_id"`.
 *  When absent or empty, all configured models are available to the planner. */
export interface PlannerModelConfig {
  [key: string]: {
    /** Toggle this model on/off for the planner. Default true when absent. */
    enabled?: boolean;
    /** Capability tags the model advertises (e.g. `image_in`, `tool_use`). */
    capabilities?: string[];
  };
}

/** Known capability tags the user can toggle in settings. Order = display order. */
export const PLANNER_CAPABILITIES = [
  { id: "audio_in", label: "Audio In", icon: "🎤" },
  { id: "audio_out", label: "Audio Out", icon: "🔊" },
  { id: "image_in", label: "Image In", icon: "🖼" },
  { id: "image_out", label: "Image Out", icon: "📷" },
  { id: "video_in", label: "Video In", icon: "🎬" },
  { id: "video_out", label: "Video Out", icon: "📹" },
  { id: "reasoning", label: "Reasoning", icon: "🧠" },
  { id: "tool_use", label: "Tool use", icon: "🔧" },
] as const;

/** Information the frontend passes to the Rust `list_models` tool. */
export interface PlannerModelEntry {
  provider: string;
  model_id: string;
  label: string;
  notes?: string | null;
  capabilities?: string[];
}

/**
 * Build the plannerModels list from the full models store, filtered by the
 * user's planner_model_config. If the config is absent or all models are
 * disabled, ALL configured models are returned (empty restriction = no
 * restriction). Capabilities are attached from the config when present.
 */
export function buildPlannerModels(
  models: Model[],
  config: PlannerModelConfig | null,
): PlannerModelEntry[] {
  const anyEnabled = config
    ? Object.values(config).some((c) => c.enabled !== false)
    : false;
  // No config or nothing explicitly enabled → allow all.
  const allowAll = !config || !anyEnabled;

  return models
    .filter((m) => {
      if (allowAll) return true;
      const key = `${m.provider}::${m.model_id}`;
      return config![key]?.enabled !== false;
    })
    .map((m) => {
      const key = `${m.provider}::${m.model_id}`;
      const caps = config?.[key]?.capabilities;
      return {
        provider: m.provider,
        model_id: m.model_id,
        label: m.label,
        notes: m.notes || undefined,
        capabilities: caps && caps.length > 0 ? caps : undefined,
      };
    });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: string;
  description: string;
  provider: Provider;
  model: string;
  prompt: string;
  depends_on: string[];
}

export interface Plan {
  strategy: "direct" | "route" | "multi_step";
  reasoning: string;
  steps: PlanStep[];
}

export interface StepResult {
  stepId: string;
  description: string;
  provider: Provider;
  model: string;
  content: string;
  usage: ChatUsage;
}

/** Result of parsing and validating a plan, including any model corrections. */
export interface PlanResult {
  plan: Plan;
  warnings: string[];
}

/** Parsed critic response — whether the plan is approved and what issues remain. */
export interface CriticResult {
  approved: boolean;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Planner system prompt
// ---------------------------------------------------------------------------

/** Build the planner's system prompt.
 *  If `instructions` is non-empty it is appended as a user preference block. */
export function buildPlannerSystemPrompt(
  _models: Model[],
  _providerMetas: ProviderMeta[],
  instructions?: string,
): string {
  // The static model snapshot is intentionally omitted — the planner MUST
  // call the list_available_models tool to get authoritative model IDs.
  return `You are a planning assistant with access to multiple AI models. Your job is to analyze the user's request and decide how best to handle it.

## Available Models
You have a \`list_available_models\` tool (no arguments). **You MUST call it first** before building any delegation plan. You have NO other way to know which models exist — the tool is your sole source of truth for provider IDs, model IDs, labels, and capabilities. Never guess, shorten, or invent model or provider names.

Each model returned by the tool has capabilities (e.g. \`image_in\`, \`reasoning\`, \`tool_use\`). Match capabilities to subtask needs: use an \`image_in\`-capable model for image analysis, \`tool_use\` for web search, etc.

## Instructions
1. Analyze the user's request. Is it simple and single-faceted, or complex and multi-faceted?
2. **"direct" for simple questions.** Use "direct" for brief facts, straightforward explanations, simple code snippets, conversational replies, quick translations, or anything a single model can handle well in one pass. When using "direct", write the complete, substantive answer as your conversational response BEFORE the JSON plan block — the user sees this text as your final reply.
3. **"multi_step" — your primary mode for complex work.** Use "multi_step" when the request has multiple dimensions, requires research from different angles, has clearly independent subtasks, or would produce a better result through decomposition and synthesis. Use the capabilities each model advertises to match subtasks to the right model. The last step must synthesize all results into a coherent final answer. This is your core purpose — break down complex tasks and delegate.
4. **"route" — a single delegation.** Use "route" (one step) when another model has a clear capability advantage for the entire task you cannot match: vision/image analysis, extremely long context, or a specialized domain you are demonstrably weaker at.

## Response Format
For "direct" strategy: write the full answer to the user first (as you normally would), then append the plan JSON. The text before the JSON is the final answer the user sees.
For "route" and "multi_step": write a brief explanation of your approach, then append the plan JSON. The worker steps will produce the actual answer you outline.

Examples:

Direct (the conversational text IS the answer):
The Z2 Extreme handheld market currently has three major contenders...

\`\`\`json
{
  "strategy": "direct",
  "reasoning": "...",
  "steps": []
}
\`\`\`

Route / multi_step (the conversational text is a brief explanation):
I'll research this from multiple angles and synthesize a comprehensive comparison.

\`\`\`json
{
  "strategy": "multi_step",
  "reasoning": "...",
  "steps": [...]
}
\`\`\`

For delegation or multi-step plans, fill in the steps array. Each step has:
- id: a short string identifier (e.g. "1", "research_claude", "synthesis")
- description: what this step does (shown to the user)
- provider: the provider id from the list above
- model: the model id from the list above
- prompt: the exact prompt to send to that model. Use {step_id} to reference results from earlier steps (e.g. "Based on this research: {step_1} ...")
- depends_on: array of step ids this step must wait for (empty = can run in parallel)

## Rules
- The last step of a multi_step plan must be a synthesis step that writes the final response based on all worker results.
- "route" uses exactly one step.
- Keep step prompts self-contained — include all necessary context.
- Never include a step that calls yourself (the planner).
- Only output ONE JSON code block.${
  instructions
    ? `\n\n## User Preferences\n${instructions}`
    : ""
}`;
}

// ---------------------------------------------------------------------------
// Model validation helpers
// ---------------------------------------------------------------------------

/**
 * Score how well a candidate model matches a hallucinated step model name and
 * step context. Higher = better match. Used to pick the best fallback when the
 * planner model invents a model id not in the configured list.
 */
export function scoreModelForStep(
  stepModel: string,
  stepContext: string,
  candidate: Model,
): number {
  let score = 0;
  const sm = stepModel.toLowerCase().trim();
  const cid = candidate.model_id.toLowerCase();
  const cl = candidate.label.toLowerCase();

  if (sm === cid) return 100;
  if (sm === cl) return 90;

  if (cid.includes(sm) || sm.includes(cid)) score += 50;
  if (cl.includes(sm) || sm.includes(cl)) score += 40;

  const stepWords = new Set(sm.split(/[\s\-_./:]+/).filter((w) => w.length > 2));
  const modelWords = new Set(`${cid} ${cl}`.split(/[\s\-_./:]+/));
  for (const w of stepWords) {
    if (modelWords.has(w)) score += 20;
  }

  if (candidate.notes) {
    const notesLower = candidate.notes.toLowerCase();
    const ctx = stepContext.toLowerCase();
    const noteKeywords = notesLower.split(/[\s,.;:!?()]+/).filter((w) => w.length > 3);
    for (const kw of noteKeywords) {
      if (ctx.includes(kw)) score += 5;
    }
  }

  return score;
}

/**
 * Validate and correct plan steps against the configured models list.
 * Each step's provider and model are checked; hallucinations are fuzzy-matched
 * to the best available candidate, or fallen back to the provider's default.
 * `keyedProviders` is the set of provider IDs that have API keys (or are
 * keyless like Ollama); cross-matching for unknown providers only considers
 * these to avoid routing steps to providers that can't be called.
 */
export function validateSteps(
  steps: PlanStep[],
  models: Model[],
  providerMetas: ProviderMeta[],
  keyedProviders: Set<Provider>,
): { steps: PlanStep[]; warnings: string[] } {
  const warnings: string[] = [];

  /** Pick the first keyed provider that has models as a fallback. */
  const findKeyedFallback = (): ProviderMeta | undefined =>
    providerMetas.find(
      (p) => keyedProviders.has(p.id) && models.some((m) => m.provider === p.id),
    );

  const corrected = steps.map((step) => {
    const context = `${step.description} ${step.prompt}`;
    const providerMeta = providerMetas.find((p) => p.id === step.provider);

    // Check if the model exists for this provider.
    const providerModels = models.filter((m) => m.provider === step.provider);
    const exactMatch = providerModels.find((m) => m.model_id === step.model);

    if (exactMatch) return step;

    // Model doesn't match — try to find a replacement.
    let candidates: Model[];
    let fallbackModel: string | undefined;

    if (providerMeta && providerModels.length > 0) {
      // Valid provider — search within it.
      candidates = providerModels;
      fallbackModel = providerMeta.defaultModel;
    } else if (providerMeta && providerModels.length === 0) {
      // Valid provider but no models — use default.
      const newModel = providerMeta.defaultModel;
      warnings.push(
        `Step "${step.id}": no models configured for provider "${step.provider}", ` +
          `using default model "${newModel}".`,
      );
      return { ...step, model: newModel };
    } else {
      // Unknown provider — search across keyed providers first.
      const keyedModels = models.filter((m) => keyedProviders.has(m.provider));
      const keyedMeta = findKeyedFallback();
      if (keyedModels.length > 0) {
        candidates = keyedModels;
        fallbackModel = keyedMeta?.defaultModel;
      } else {
        // No keyed provider at all — fall back to all models as last resort.
        candidates = [...models];
        fallbackModel =
          providerMetas.length > 0
            ? providerMetas[0].defaultModel
            : undefined;
      }
    }

    // Score all candidates.
    let bestScore = -1;
    let bestModel: Model | null = null;
    for (const c of candidates) {
      const s = scoreModelForStep(step.model, context, c);
      if (s > bestScore) {
        bestScore = s;
        bestModel = c;
      }
    }

    if (bestModel && bestScore > 0) {
      const from = `${step.provider}/${step.model}`;
      const to = `${bestModel.provider}/${bestModel.model_id}`;
      warnings.push(`Step "${step.id}": corrected model ${from} → ${to} (${bestModel.label}).`);
      return {
        ...step,
        provider: bestModel.provider,
        model: bestModel.model_id,
      };
    }

    if (fallbackModel) {
      const fallbackProvider = providerMeta
        ? providerMeta.id
        : findKeyedFallback()?.id ?? providerMetas[0]?.id ?? step.provider;
      warnings.push(
        `Step "${step.id}": could not match model "${step.model}", ` +
          `falling back to ${fallbackProvider}/${fallbackModel}.`,
      );
      return { ...step, provider: fallbackProvider as Provider, model: fallbackModel };
    }

    // Last resort: keep the step as-is (it will likely fail at the API).
    warnings.push(
      `Step "${step.id}": unknown provider "${step.provider}" with model "${step.model}" ` +
        `— no fallback available. The step was left unchanged and may fail.`,
    );
    return step;
  });

  return { steps: corrected, warnings };
}

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

/**
 * Parse the plan from the planner's output and validate all model references
 * against the configured models list. Returns the corrected plan with warnings
 * about any fixed hallucinations.
 */
export function parsePlan(
  text: string,
  models: Model[],
  providerMetas: ProviderMeta[],
  keyedProviders: Set<Provider>,
): PlanResult | null {
  const plan = extractPlan(text);
  if (!plan) return null;
  const { steps, warnings } = validateSteps(plan.steps, models, providerMetas, keyedProviders);
  return { plan: { ...plan, steps }, warnings };
}

/** Extract the raw plan JSON (without validation). */
function extractPlan(text: string): Plan | null {
  const fenceRe = /```json\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    const plan = tryParsePlan(match[1]);
    if (plan) return plan;
  }

  const jsonRe = /\{[\s\S]*"strategy"[\s\S]*\}/;
  const rawMatch = text.match(jsonRe);
  if (rawMatch) {
    const plan = tryParsePlan(rawMatch[0]);
    if (plan) return plan;
  }

  return null;
}

function tryParsePlan(raw: string): Plan | null {
  try {
    const obj = JSON.parse(raw);
    if (
      typeof obj.strategy === "string" &&
      ["direct", "route", "multi_step"].includes(obj.strategy) &&
      Array.isArray(obj.steps)
    ) {
      const steps: PlanStep[] = [];
      for (const s of obj.steps) {
        if (
          typeof s.id === "string" &&
          typeof s.description === "string" &&
          typeof s.provider === "string" &&
          typeof s.model === "string" &&
          typeof s.prompt === "string" &&
          Array.isArray(s.depends_on)
        ) {
          steps.push({
            id: s.id,
            description: s.description,
            provider: s.provider as Provider,
            model: s.model,
            prompt: s.prompt,
            depends_on: s.depends_on,
          });
        }
      }
      return {
        strategy: obj.strategy as Plan["strategy"],
        reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
        steps,
      };
    }
  } catch {
    // Invalid JSON — not a plan.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display cleanup
// ---------------------------------------------------------------------------

/**
 * Remove the last ```json fenced code block from planner output, so the raw
 * JSON isn't displayed redundantly alongside the structured PlanPanel.
 * Returns the content unchanged if no ```json fence is present.
 */
export function stripPlanJsonFence(content: string): string {
  const fence = "```json";
  const start = content.lastIndexOf(fence);
  if (start === -1) return content;

  // Trim whitespace before the fence.
  let prefixEnd = start;
  while (prefixEnd > 0 && /\s/.test(content[prefixEnd - 1])) {
    prefixEnd--;
  }

  // Find the closing ``` (the next occurrence after the start marker).
  const afterStart = start + fence.length;
  const closeStart = content.indexOf("```", afterStart);
  if (closeStart === -1) return content.slice(0, prefixEnd).trim();

  // The closing ``` can have trailing whitespace — skip it.
  let closeEnd = closeStart + 3;
  while (closeEnd < content.length && /\s/.test(content[closeEnd])) {
    closeEnd++;
  }

  return (content.slice(0, prefixEnd) + content.slice(closeEnd)).trim();
}

// ---------------------------------------------------------------------------
// Variable substitution
// ---------------------------------------------------------------------------

/** Replace {step_N} placeholders in a prompt with the actual step results. */
export function resolveStepVariables(
  prompt: string,
  results: Map<string, string>,
): string {
  return prompt.replace(/\{(\w+)\}/g, (_, id) => {
    return results.get(id) ?? `{${id}}`;
  });
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm) — groups steps by dependency level
// ---------------------------------------------------------------------------

/** Sort steps into dependency waves. Wave 0 has no dependencies and all its
 *  steps can run in parallel. Wave 1 depends only on wave 0, etc. */
export function topologicalSort(steps: PlanStep[]): PlanStep[][] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const s of steps) {
    inDegree.set(s.id, s.depends_on.length);
    for (const dep of s.depends_on) {
      const list = dependents.get(dep) ?? [];
      list.push(s.id);
      dependents.set(dep, list);
    }
  }

  const waves: PlanStep[][] = [];
  let current = steps.filter((s) => inDegree.get(s.id) === 0);

  while (current.length > 0) {
    waves.push(current);
    const next: PlanStep[] = [];
    for (const s of current) {
      for (const depId of dependents.get(s.id) ?? []) {
        const deg = (inDegree.get(depId) ?? 0) - 1;
        inDegree.set(depId, deg);
        if (deg === 0) {
          const step = stepMap.get(depId);
          if (step) next.push(step);
        }
      }
    }
    current = next;
  }

  return waves;
}

// ---------------------------------------------------------------------------
// Plan execution
// ---------------------------------------------------------------------------

/**
 * Execute a plan by dispatching each step to its specified model. Steps in the
 * same dependency wave run in parallel via Promise.all. Results are collected
 * and returned, with later-step prompts having their placeholders resolved.
 *
 * `runStep` is a callback that calls chatStream for a given step; it receives
 * the resolved prompt (with placeholders filled) and must return a StepResult.
 */
export async function executePlan(
  plan: Plan,
  runStep: (step: PlanStep, resolvedPrompt: string) => Promise<StepResult>,
): Promise<StepResult[]> {
  const results = new Map<string, string>();
  const allResults: StepResult[] = [];
  const waves = topologicalSort(plan.steps);

  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(async (step) => {
        const resolvedPrompt = resolveStepVariables(step.prompt, results);
        const r = await runStep(step, resolvedPrompt);
        results.set(step.id, r.content);
        return r;
      }),
    );
    allResults.push(...waveResults);
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Critic — plan review loop
// ---------------------------------------------------------------------------

/** System prompt for the critic model that reviews plans. */
export function buildCriticSystemPrompt(): string {
  return `You are a plan reviewer. Your job is to examine a delegation plan produced by another AI and determine whether each step is well-formed and will succeed.

## Review Criteria
1. **Model availability**: Does each step reference a model that exists in the available models list?
2. **Step clarity**: Is each step's prompt self-contained and specific enough?
3. **Dependency correctness**: Do depends_on references point to real step ids? Are circular dependencies present?
4. **Synthesis step**: For multi_step plans, is the last step a synthesis step that combines worker outputs?
5. **Provider validity**: Is each provider one of the listed providers?

## Response Format
Respond conversationally first, then output your verdict as a JSON code block:

\`\`\`json
{
  "approved": false,
  "issues": [
    "Step 'research': model 'claude-5' is not in the available models list.",
    "Step 'synthesis': missing depends_on — it should wait for all workers."
  ]
}
\`\`\`

If the plan is perfect, set "approved": true and "issues": [].

## Rules
- Be strict but fair. Flag real problems, don't nitpick wording.
- If you suggest a replacement model, use one from the available models list.
- Only output ONE JSON code block.`;
}

/** Build the critic's request message, presenting the original user request and the plan. */
export function buildCriticRequest(originalRequest: string, plan: Plan): string {
  return `## Original User Request
${originalRequest}

## Proposed Plan
\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

Please review this plan for issues.`;
}

/** Parse the critic's JSON verdict from its output text. */
export function parseCriticResponse(text: string): CriticResult | null {
  const fenceRe = /```json\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    const result = tryParseCritic(match[1]);
    if (result) return result;
  }

  const jsonRe = /\{[\s\S]*"approved"[\s\S]*\}/;
  const rawMatch = text.match(jsonRe);
  if (rawMatch) {
    const result = tryParseCritic(rawMatch[0]);
    if (result) return result;
  }

  return null;
}

function tryParseCritic(raw: string): CriticResult | null {
  try {
    const obj = JSON.parse(raw);
    if (
      typeof obj.approved === "boolean" &&
      Array.isArray(obj.issues) &&
      obj.issues.every((i: unknown) => typeof i === "string")
    ) {
      return { approved: obj.approved, issues: obj.issues };
    }
  } catch {
    // Invalid JSON.
  }
  return null;
}
