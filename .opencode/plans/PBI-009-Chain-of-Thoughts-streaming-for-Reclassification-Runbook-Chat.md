# PBI 009: Chain of Thoughts Streaming for Reclassification & Runbook Chat

## Current State Analysis

### Current Functionality
- **Reclassification**: Re-run AI classification for ingestion is currently done via a standard blocking `POST` to `/ingestions/{ingestion_id}/reclassify` and returns the final parsed JSON response when complete.
- **Runbook Chat**: Conversing with the AI to update the runbook is done via a blocking `POST` to `/runbook/review/chat` and returns the final updated session document.
- **AI Reasoning**: The reasoning/thoughts of the LLM are only displayed once the request finishes.

### User Experience Issues
1. **Long Wait Times**: Classification and chat prompts take several seconds to complete, leaving the user with a generic loading spinner.
2. **Lack of Transparency**: The user cannot see the intermediate thinking process (Chain of Thoughts) that the AI goes through before arriving at the final classification or runbook recommendations.

## Proposed Architecture

To solve these issues, we will migrate the Python Azure Functions app to use `func.AsgiFunctionApp` wrapping a `FastAPI` application. This enables native ASGI mode app-wide and allows us to return FastAPI `StreamingResponse` for streaming endpoints. 

To avoid refactoring all 21 existing endpoints (which would introduce significant risk), we will implement a request/response adapter class `AzureHttpRequestAdapter` that wraps a FastAPI `Request` to look like a `func.HttpRequest`.

### 1. Backend changes in `notif-ingester`
- Use the Gemini Interactions API or stream the generation chunks from the `google-genai` SDK.
- Update `/ingestions/{ingestion_id}/reclassify` to stream the thinking/reasoning process (under a `thought` field) and the final structured object using Server-Sent Events (SSE).
- Update `/runbook/review/chat` to stream the conversational message, questions, and updating runbook.

### 2. Frontend changes
- Leverage custom ReadableStream readers on the React frontend to parse SSE chunks as they arrive.
- Update UI components to show the reasoning stream dynamically in real time.

## Files to Modify

### Backend (`notif-ingester`)
1. `requirements.txt` - add `fastapi`
2. `services/llm_provider.py` - add streaming generator support
3. `services/ai_service.py` - add streaming reclassification & chat response methods
4. `function_app.py` - wrap the app in `func.AsgiFunctionApp` using FastAPI, and expose streaming endpoints

### Frontend
1. `frontend/src/hooks/useIngestions.ts` & `useRunbookReview.ts` - add streaming hook logic
2. `frontend/src/components/AddTransactionModal.tsx` & `RunbookReviewModal.tsx` - implement real-time streaming displays
