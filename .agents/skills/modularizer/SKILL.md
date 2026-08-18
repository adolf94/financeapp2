---
name: modularizer
description: Automatically use when creating, editing, or refactoring React components, hooks, or backend modules that exceed ~200 lines, contain repeated JSX structures, complex multi-field form controls, or whenever modularization, decomposition, or clean code extraction is requested or appropriate.
---

# Modularizer Skill

Guidelines and procedures for refactoring and decomposing monolithic UI components and services into clean, cohesive modules.

## Principles

1. **Single Responsibility Principle (SRP):** Each extracted component or hook should have one clear purpose (e.g. form field rendering, calculation, specific section layout).
2. **Context & Props Cleanliness:**
   - Prefer passing pure, typed props for leaf components to maximize reuse and ease of testing.
   - For deeply coupled sub-components within a specific flow (e.g., AddTransaction), co-locate them in a dedicated folder (e.g., components/AddTransaction/) and leverage Context or hook state where appropriate.
3. **No Breaking Changes:** Refactoring must not change external interfaces, behavior, or cause regression in tests and builds.
4. **Preserve Types & Lint Cleanliness:** All extracted components must define explicit TypeScript interfaces and avoid loose `any` types.

## Workflow

1. **Identify Extraction Targets:**
   - Repeating UI chunks (e.g. grouped dropdowns, custom input fields, summary pills).
   - High cyclomatic complexity / deeply nested JSX blocks.
   - State slices or side effects that can become custom hooks.
2. **Determine File Placement:**
   - **Feature-specific components:** `src/components/<FeatureName>/<SubComponent>.tsx`
   - **Generic / shared UI primitives:** `src/components/ui/<Component>.tsx`
   - **Domain logic / Custom hooks:** `src/components/<FeatureName>/hooks/<useHook>.ts` or `src/hooks/<useHook>.ts`
3. **Extract & Verify:**
   - Create the sub-component with explicit TypeScript interface.
   - Replace the inline implementation with the newly extracted component.
   - Clean up orphaned imports, state, and memoized variables in the parent component.
   - Run tests: `npm.cmd test <path-to-tests>`
   - Run build: `npm.cmd run build` in `frontend/`
