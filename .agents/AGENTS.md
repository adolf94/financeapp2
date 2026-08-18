# Agent Instructions & Guidelines

This document provides rules and context for AI agents operating within the Personal Finance App repository.

## 1. Global Operating Rules
- **NPM Execution:** ALWAYS use `npm.cmd` instead of just `npm` when running node package commands on this Windows environment.
- **Batch Scripts:** Use `cmd /c` when running `.bat` or batch scripts.
- **Component Versions:** Verify that the version of Tailwind and UI components you are implementing aligns with the version specified in `package.json`.
- **Imports:** Always double-check imports to prevent "Reference Error" in React.
- **Data Fetching:** No direct `fetch()` calls. All network requests MUST go through the configured Axios instance.

## 2. Technology Stack
### Frontend
- **Core:** React 18+ with TypeScript, built with Vite.
- **Routing:** `@tanstack/react-router`.
- **State/Fetching:** `@tanstack/react-query` and `axios`.
- **UI Framework:** Tailwind CSS + Headless UI (e.g., Shadcn/Radix).
- **Icons:** `lucide-react`.

### Backend
- **Core:** Azure Functions (.NET 10 / 9.0).
- **Database:** CosmosDB with Entity Framework Core (`Microsoft.EntityFrameworkCore.Cosmos`).
- **Architecture:** Strict layered structure (Function -> Service -> Repository). All dependencies MUST be injected via interfaces.

## 3. Brand Identity & UX
All UI implementations must strictly adhere to the guidelines in `design-system/MASTER.md`.
- **Icons:** Use **Lucide React** with a `24x24` viewBox (`w-6 h-6`) and `1.5px` stroke weight. NO EMOJIS in UI.
- **Mobile-First:** Ensure all layouts are responsive, prioritizing 375px mobile viewports with bottom navigation.

## 4. Architecture & Implementation Notes
- **Theme Generation:** The Tailwind configuration (`tailwind.config.ts`) and Shadcn theme must follow the standard professional color palette defined in the design system.
- **CosmosDB Partitioning:** All collections must be partitioned by `/UserId` without exception.

## 5. Skills and Workflow
- **Project Specifications:** ALWAYS read `spec.md` at the start of tasks to understand architecture and requirements. When making architectural, database, API, or feature changes, use the `spec-updater` skill to keep `spec.md` synchronized. also if there is a `todo.md`, suggest this if we are in the implementing stage and the I am happy with the progress.
- **Testing Requirements:** Whenever updating features or adding new logic, use the `finance-test-scaffold` skill to generate necessary unit and integration tests across both the React frontend and .NET backend.
- **Component & Module Decomposition:** Whenever modifying or adding complex UI sections, repeating JSX patterns, or components exceeding ~200 lines, automatically activate the `modularizer` skill to extract clean, single-responsibility sub-components.
