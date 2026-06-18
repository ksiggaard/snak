// Planner orchestration engine: sends a user request to a planner model,
// parses its JSON plan, and dispatches worker steps (parallel where possible).
// The planner only runs when a planner model is configured and planner mode is
// active on the current chat.

import type { Provider, Model } from "@/types/db";
import type { ProviderMeta } from "@/lib/providers";
import type { ChatUsage } from "@/lib/chat";

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

// ---------------------------------------------------------------------------
// Planner system prompt
// ---------------------------------------------------------------------------

/** Build the planner's system prompt, listing available models with their notes. */
export function buildPlannerSystemPrompt(
  models: Model[],
  providerMetas: ProviderMeta[],
): string {
  const modelLines = models.map((m) => {
    const p = providerMetas.find((pm) => pm.id === m.provider);
    const label = p ? `${p.label} · ${m.label}` : `${m.provider} · ${m.label}`;
    const note = m.notes ? ` — ${m.notes}` : "";
    return `- ${label} (provider: "${m.provider}", model: "${m.model_id}")${note}`;
  });

  return `You are a planning assistant with access to multiple AI models. Your job is to analyze the user's request and decide how best to handle it.

## Available Models
${modelLines.join("\n")}

## Instructions
1. Analyze the user's request.
2. If the request is simple and you can answer directly, set strategy to "direct".
3. If another model would be better suited, delegate to it (strategy: "route", one step).
4. If the task benefits from being split into parallel subtasks (e.g. researching multiple topics simultaneously, or combining different models' strengths), use strategy "multi_step".

## Response Format
Always respond in a conversational tone first, then include your plan as a JSON code block:

\`\`\`json
{
  "strategy": "direct",
  "reasoning": "This is a simple greeting — no delegation needed.",
  "steps": []
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
- The last step of a multi_step plan should always be a synthesis step that writes the final response based on all worker results.
- Use "route" when exactly one other model should handle the task — the routing step is the only step.
- Keep step prompts self-contained — include all necessary context.
- Never include a step that calls yourself (the planner).
- Only output ONE JSON code block — it contains the entire plan.`;
}

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

/** Extract and parse a JSON plan from the planner's output text.
 *  Looks for a ```json fence first, then falls back to raw JSON in the text.
 *  Returns null if no valid plan is found (treat as a direct answer). */
export function parsePlan(text: string): Plan | null {
  // Try extracting from ```json fences.
  const fenceRe = /```json\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = fenceRe.exec(text)) !== null) {
    const plan = tryParsePlan(match[1]);
    if (plan) return plan;
  }

  // Try finding a raw JSON object in the text.
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
      // Validate each step.
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
