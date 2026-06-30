# ADR-0007: Runtime plugins are executable, trusted JS

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-30

## Context and Problem Statement

[ADR-0004](./0004-plugins-are-declarative.md) established a **declarative** plugin model: a manifest plus static assets, with all behavior built-in and keyed by manifest `id`/language, so a third-party plugin can never run code. That bounds the attack surface but also bounds capability — a declarative plugin can only configure behavior the host already implements, so genuinely new functionality (a custom fenced-block renderer, a new settings panel, an LLM hook) is impossible without a core change. We need a way for a plugin to ship *new behavior*, and must decide how much isolation that earns.

## Decision Drivers

* Real extensibility — plugins must be able to add behavior the host doesn't already have
* Implementation cost — a true sandbox (WASM/subprocess + capability broker) is a large build
* Honesty about the trust model — whatever we ship, the security story must be stated plainly, not implied
* Keep the declarative model intact for the cases it already serves well

## Considered Options

* **Option 1:** Runtime plugins as unsandboxed, **trusted** JS — an ESM module the host imports and executes, alongside (not replacing) the declarative model
* **Option 2:** Stay declarative-only — extend the `contributes` taxonomy whenever a new capability is needed
* **Option 3:** Sandboxed executable plugins (WASM or an isolated worker) with a real permission broker

## Decision Outcome

Chosen option: **Option 1 — runtime plugins as unsandboxed trusted JS**, because it unlocks arbitrary plugin behavior at near-zero host cost while leaving the declarative model ([ADR-0004](./0004-plugins-are-declarative.md)) untouched for built-ins. A runtime plugin is a manifest with an `entry` field pointing at a compiled ESM module that exports `activate(ctx)`. The loader (`src/lib/pluginLoader.ts`) reads the entry source via the `read_plugin_entry` command, wraps it in a `Blob`, `await import(/* @vite-ignore */ url)`s it, and calls `activate` with a host-built `PluginContext` (`contextFor` in `src/lib/pluginHost.ts`). Everything a plugin can do flows through `ctx` (`src/types/pluginApi.ts`): `ui.registerRenderer`, `ui.registerUi`, a per-plugin `storage` KV store (`plugin_storage` table, migration `031`). The `permissions` field is **advisory ergonomics** — the host simply declines to populate undeclared parts of `ctx` — and is explicitly **not** a security boundary. What *is* enforced (in Rust, `src-tauri/src/plugins/runtime.rs`) is filesystem hygiene: zip-slip-safe, size-capped extraction and entry reads confined to the plugin's own folder.

### Consequences

* **Positive:** Plugins can ship genuinely new behavior (e.g. the bundled `com.snak.mermaid`/`com.snak.charts`/`com.snak.maps` renderers register via `ctx.ui.registerRenderer`). No sandbox to build. The declarative path still exists for the 5 built-ins that don't need code, so the two models coexist; consumers read runtime contributions from `useContributions` (`src/store/contributions.ts`) and declarative ones from the `HostRegistry`.
* **Negative:** Installing a runtime plugin means **trusting its author with the app's full privileges** — there is no isolation, and `permissions` cannot stop trusted JS from reaching globals. This shifts the safety burden to install-time trust (and, for bundled built-ins, to us). The naming overlap with the still-declarative built-ins is a documentation hazard ([AGENTS.md §Plugin system](../../AGENTS.md) spells out which is which). A real sandbox remains future work, gated by `apiVersion`.

## Pros and Cons of the Options

### Option 1 — Runtime plugins as trusted JS

* **Good:** Arbitrary new behavior with no sandbox to build; declarative model stays intact for built-ins.
* **Good:** Clean author API — a plugin is one self-contained ESM file coding only against `ctx`.
* **Bad:** Unsandboxed — a malicious/buggy plugin has full app privileges; `permissions` is advisory only.

### Option 2 — Declarative-only forever

* **Good:** Worst case stays a static manifest ([ADR-0004](./0004-plugins-are-declarative.md)).
* **Bad:** Every new capability requires a core change; plugins can never add novel behavior.

### Option 3 — Sandboxed executable plugins

* **Good:** Arbitrary behavior *and* bounded risk — the ideal end state.
* **Bad:** Large build (WASM/worker host + capability broker + permission UI) for no present need; deferred.
