# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React (Vite) + Tailwind CSS + Shadcn (Frontend)
Azure Functions (.NET 10 + Python) + CosmosDB (Backend)

## Users
Individuals seeking a clean, organized, and mobile-first way to manage their daily financial transactions and monitor their overall financial health.

## Product Purpose
Historically track income, expenses, and account balances as a robust personal accounting tool, prioritizing quick data entry and easily digestible financial overviews, with strictly no forward-looking budgeting.

## Positioning
Automated data capture via phone notifications (SMS/App notifications) classified and auto-confirmed by Gemini AI using text embeddings and cosine-similarity matches of historical transaction vectors.

## Operating Context
Daily transactions logged on-the-go via a mobile bottom sheet, pending ingestions reviewed and corrected inline, and monthly financial summaries analyzed via chronological lists, a calendar grid, and category history drill-downs.

## Capabilities and Constraints
- Dual mode entry: Simple Mode (Expense, Income, Transfer) and Advanced Mode (Journal entries with splits and direct debits/credits).
- Currency: Philippine Peso (₱).
- ID Generation: Time-sortable UUID v7.
- Database: CosmosDB with strict partitioning by `/UserId` or `/partition_key`.
- Nightly timer-triggered functions for recurring transaction templates.

## Brand Commitments
- OLED-First styling guidelines (dark mode optimized, high contrast, vibrant colors, premium feel).
- Minimum touch target height of 44px on all interactive elements.
- Lucide React icons exclusively (no emojis in UI).

## Evidence on Hand
- Detailed system specifications located in [spec.md](file:///d:/Users/adolf/source/repos/Finance/spec.md).

## Product Principles
- **Mobile-First Utility**: Interfaces optimized for compact screen sizes, quick data entry, and touch interactions.
- **Double-Entry Integrity**: All logged data translates to underlying dual-entry ledger rows ensuring absolute balance consistency.
- **AI as a Copilot**: Ingestion pipeline automates tedious entry steps but leaves ultimate classification authority with the user.

## Accessibility & Inclusion
- Minimum WCAG AA compliance (focus states, labels, element contrast).
