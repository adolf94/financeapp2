# PBI 009: Chain of Thoughts Streaming for Reclassification & Runbook Chat

## Current State Analysis

### Current Functionality
- **Reclassification**: Re-run AI classification for ingestion is currently done via a standard blocking `POST` to `/ingestions/{ingestion_id}/reclassify` and returns the final parsed JSON response when complete.
- **Runbook Chat**: Conversing with the AI to update the runbook is done via a blocking `POST` to `/runbook/review/chat` and returns the final updated session document.
- **AI Reasoning**: The reasoning/thoughts of the LLM are only displayed once the request finishes.

### User Experience Issues
1. **Long Wait Times**: Classification and chat prompts take several seconds to complete, leaving the user with a generic loading spinner.
2. **Lack of Transparency**: The user cannot see the intermediate thinking process (Chain of Thoughts) that the AI goes through before arriving at the final classification or runbook recommendations.

To support real-time features, we will implement a SignalR Pub/Sub architecture. When triggering a reclassification, the frontend will generate a `uuidv7` as an `operationId` and pass it in the HTTP request. The backend will broadcast progress updates to the hub including this `operationId`. The frontend will listen to specific progress events for that `operationId`, preventing cross-connection stream leakage.

### 1. Backend changes in `notif-ingester`
- Secure the `/negotiate` endpoint to require token authentication.
- Accept an optional `operationId` parameter in the `/ingestions/{ingestion_id}/reclassify` route.
- Stream generated token chunks by calling `generate_stream` on the LLM provider, publishing progress to the hub via REST API with the `operationId`.

### 2. Frontend changes
- Add the `@microsoft/signalr` package.
- Implement a custom React hook `useSignalR` that connects to the negotiate endpoint.
- In `IngestionReviewPanel`, generate a UUIDv7 `operationId` on reclassify button click, pass it in the mutation request, and subscribe to connection events matching that `operationId`.

## Files to Modify

### Backend (`notif-ingester`)
1. `function_app.py` - add `/negotiate` authentication, accept `operationId` in reclassify
2. `services/ai_service.py` - support streaming LLM response chunks with `operationId` to SignalR
3. `services/llm_provider.py` - add `generate_stream` async generator support for Gemini and OpenAI

### Frontend
1. `frontend/src/hooks/useSignalR.ts` - implement connection and dispatch progress events by `operationId`
2. `frontend/src/hooks/useIngestions.ts` - update reclassify mutation to accept and send `operationId`
3. `frontend/src/components/AddTransaction/IngestionReviewPanel.tsx` - generate `operationId` and render stream based on it
