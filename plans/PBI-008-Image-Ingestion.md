---
github_issue: 8
github_url: https://github.com/adolf94/financeapp2/issues/8
status: closed
---
# PBI 006: Multimodal Image Ingestion via POST Route

## Problem Statement
Users cannot ingest financial information directly from images (receipts, bank statements, mobile app screenshots). Currently, they must manually transcribe this data. 

To solve this efficiently, we want to create a `POST` route for image uploads. Instead of using separate, fragile OCR pipelines (like Tesseract, layout parser libraries, or third-party OCR engines) and passing the resultant noisy text to an LLM, the system will fully leverage the multimodal capabilities of modern AI services (like Google Gemini). The AI will process the raw image data directly to extract and classify the transaction details in a single step.

## Current Gap Analysis
- **No Image Processing**: The system cannot handle binary image files.
- **Fragile Legacy OCR Path (Avoided)**: Traditional OCR requires complex pre-processing (deskewing, contrast adjustment), struggles with unstructured layout or handwriting, and introduces character translation errors (e.g., Confusing `0` and `O`).
- **No Multimodal AI Integration**: The current `AiService` only supports text prompts.
- **UI Gap**: No interface to drop, upload, or preview images on mobile or desktop.

## Technical Requirements

### Core Requirements
1. **Image Upload API**: A `POST /api/images/upload` endpoint accepting a **single multipart image file** per request.
2. **One file per call**: Multi-image scenarios require multiple sequential POST calls from the client.
3. **Assume Financial**: No `is_financial` pre-check step. All manually uploaded images are assumed to represent a financial document. The AI classification prompt gates `is_financial: false` only if it cannot extract a meaningful transaction from the image.
4. **Non-blocking response**: The endpoint returns an `ingestion_id` immediately (HTTP 202 Accepted). Processing happens asynchronously.
5. **Optional SignalR progress**: If the request body includes `operation_id` (and optionally `connection_id`), the endpoint will broadcast progress via the existing `notificationHub` SignalR pattern. If `operation_id` is absent, no broadcast is sent — the client polls normally.
6. **Multimodal AI Integration**: Extend `AiService` with a `classify_image_async()` method accepting raw image bytes + MIME type alongside text context (accounts, runbook, vendors, similar vectors).
7. **Single-Stage Extraction & Classification**: Prompt extracts and classifies in one inference call, returning the full `AiParsedData` JSON schema (see AI Prompt section).
8. **UI Preview & Confirm**: `ImageUploadModal` — upload + preview. Review uses the **existing `IngestionReviewPanel`** (no new review component).

### Supported Formats & Capabilities
- **Formats**: PNG, JPEG, WEBP only. **PDF is out of scope** for this PBI.
- **Size limit**: TBD at implementation (enforce client-side resize before upload).
- **Layout Robustness**: Handled naturally by the LLM (no manual table parser or bounding-box mapping needed).
- **Handwriting Support**: Inherent to the multimodal model.

---

## Architecture Design

### Overall Architecture
```
[Client App] --(Image File + optional operation_id)--> [POST /images/upload]
                    ↓ HTTP 202 (ingestion_id)
         [IngestionService.process_image_async()]
                    ↓ (async)
         [AiService.classify_image_async()]
                    ↓
         [Gemini API (multimodal)]
                    ↓
         [PendingIngestion saved to CosmosDB]
                    ↓ (if operation_id present)
         [SignalR broadcast → notificationHub]
```

### Component Structure

#### 1. **Image Ingestion Handler (`notif-ingester/function_app.py`)**
- `POST /api/images/upload` — accepts `multipart/form-data` with one image file.
- Reads optional `operation_id` and `connection_id` from form fields.
- Validates MIME type (allowed: `image/png`, `image/jpeg`, `image/webp`).
- Resolves `user_id` via JWT Bearer auth.
- Returns HTTP 202 with `{ "ingestion_id": "...", "status": "processing" }` immediately.
- Spawns `IngestionService.process_image_async()` as a background task.

#### 2. **`IngestionService.process_image_async()`**
- Fetches accounts, runbook, vendors, similar vectors (same as other pipelines).
- Calls `AiService.classify_image_async()`.
- Saves `PendingIngestion` to CosmosDB.
- If `operation_id` provided, broadcasts completion via SignalR (same pattern as reclassify).

#### 3. **`AiService.classify_image_async()`** (new method)
- Signature: `classify_image_async(image_bytes, mime_type, accounts, runbook_content, vendors, similar_vectors, operation_id=None, connection_id=None) -> AiParsedData`
- Sends raw image bytes + MIME type to Gemini multimodal API alongside the `IMAGE_CLASSIFICATION_PROMPT`.
- Returns parsed `AiParsedData`.

---

## Data Model Enhancements

We bypass complex intermediate `OcrResult` and `TextRegion` models entirely. The image metadata is simply logged inside the ingestion record.

```python
class ImageIngestionMetadata(BaseModel):
    original_filename: str
    file_format: str
    file_size: int
    uploaded_at: datetime
```

The parsed result maps directly to the existing, synced `AiParsedData` model:
- `vendor`
- `amount`
- `transaction_type`
- `debit_account_id`
- `credit_account_id`
- `notes` (e.g. "Parsed from receipt image: [Filename]")

---

## AI Prompt Engineering

### `IMAGE_CLASSIFICATION_PROMPT` (new prompt in `prompts/` — TBD exact location)

The prompt must return the **full `AiParsedData` schema** (same as SMS/app classification prompts) so downstream processing is identical. Key differences from SMS prompts:

- No `sender` / `app_name` context — use `"Image upload"` as application.
- `is_financial`: Set `false` only if the image contains no discernible transaction (e.g., a selfie, blank page). Otherwise `true`.
- `date`: Extract from the document if visible; if absent, omit (backend uses `received_at`).
- `reference_number`: Extract receipt/invoice/order number if present.
- `notes`: Include `"Parsed from uploaded image"` prefix.

```
You are a financial parsing agent. You are given an image of a financial document
(receipt, invoice, bank statement, or screenshot) and user account context.

If the image does not contain a financial transaction, return { "is_financial": false }.

Otherwise, analyze the image and return ONLY valid JSON matching this schema:
{
  "is_financial": true,
  "vendor": { "name": "...", "type": "Individual|Business|Internal", "matched": false, "is_recommendation": true, "lookups": [], "tags": [] },
  "amount": 0.0,
  "transaction_type": "Expense|Income|Transfer",
  "debit_account_id": "...",
  "credit_account_id": "...",
  "suggested_account_creation": [],
  "notes": "Parsed from uploaded image. ...",
  "summary": "...",
  "confidence": 0.0,
  "reference_number": "...",
  "date": "ISO8601 or null",
  "application": "Image upload",
  "why": "..."
}

Rules:
- amount = total paid (not subtotal, not before discounts).
- Use exact account IDs from the accounts list. If unsure, set to null and add to suggested_account_creation.
- Apply the User Runbook rules above everything else.

User Runbook:
{runbook_content}

Available accounts:
{accounts}

Existing Vendors:
{vendors}

Similar past transactions (for context):
{similar_context}
```

---

## Implementation Plan

### Phase 1: Multimodal AI Core Integration
1. Extend `AiService` to support multimodal requests.
2. Formulate and refine the visual parsing system prompt.
3. Add unit tests passing mock/test receipt images directly to the AI service to verify extraction accuracy.

### Phase 2: Ingester Upload Endpoint
1. Create `POST /images/upload` Azure function route.
2. Implement file type validation, size checks, and extraction of raw bytes.
3. Connect the endpoint to the multimodal AI processing pipeline.

### Phase 3: Frontend Upload & Side-by-Side Review UI
1. Create `ImageUploadModal` for selecting and uploading receipt/statement images.
2. Develop `ImageReviewModal` showing a side-by-side view: the uploaded image on the left, and the AI-parsed fields in an editable form on the right.
3. Integrate with the existing `confirm` and `reject` mutation hooks.

---

## Security and Privacy
1. **No Image Storage**: Image bytes are processed in memory and sent directly to the AI provider. No permanent image files are stored on disk or blob storage unless explicitly opted-in for audit logs, minimizing data footprint and leakage risks.
2. **Data Isolation**: Requests are scoped to the authenticated user ID (`sub` claim) to prevent cross-tenant exposure.

## Risks & Mitigations
- **Large Image Payloads**: Large files can slow down network requests and increase latency.
  - *Mitigation*: Compress/resize images on the client-side before upload.
- **Non-Financial Images**: Users uploading random documents or photos.
  - *Mitigation*: AI system prompt will identify non-financial images and immediately return `is_financial: false`.