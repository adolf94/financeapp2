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
1. **Image Upload API**: A POST endpoint (`/api/images/upload`) accepting multipart image files.
2. **Multimodal AI Integration**: Upgrade `AiService` to accept and send raw image bytes/MIME types directly to the Gemini API.
3. **Single-Stage Extraction & Classification**: The multimodal prompt will instruct the AI to extract key details (amount, date, vendor, transaction type) and perform account classification against user accounts and RUNBOOK.md in a single inference call.
4. **Structured JSON Output**: The AI must return a structured payload matching the standard `AiParsedData` schema.
5. **UI Preview & Confirm**: A client interface allowing users to upload images, view the image preview, and review the resulting parsed ingestion details side-by-side.

### Supported Formats & Capabilities
- **Formats**: PNG, JPEG, WEBP, and PDF.
- **Layout Robustness**: Handled naturally by the LLM (no manual table parser or bounding-box mapping needed).
- **Handwriting Support**: Inherent to the multimodal model.
- **Multi-page/Multiple images**: Handled by passing multiple image blocks/pages directly to the multimodal prompt.

---

## Architecture Design

### Overall Architecture
```
[Client App] --(Image File)--> [POST /images/upload]
                                      ↓
                               [AiService] (Multimodal Prompt with Image Bytes)
                                      ↓
                               [Gemini API] (Direct visual parsing)
                                      ↓
                        [PendingIngestion (JSON)]
                                      ↓
                        [CosmosDB / PendingIngestions]
```

### Component Structure

#### 1. **Image Ingestion Handler (`notif-ingester/function_app.py`)**
- Receives the multipart form-data.
- Extracts the file, validates the MIME type (image/png, image/jpeg, etc.) and size.
- Resolves the user ID via JWT Bearer auth.
- Invokes the `IngestionService.process_image_async()`.

#### 2. **AI Service Enhancement (`notif-ingester/services/ai_service.py`)**
- Utilizes the GenAI client's ability to receive media files alongside text prompts.
- Passes the image content (raw bytes + mime-type) along with a specialized multimodal prompt and context (accounts list, similar vectors, `RUNBOOK.md`).

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

### Multimodal Extraction & Classification Prompt
```
You are a financial parsing agent. You are given an image of a financial document (receipt, invoice, bank statement, or screenshot) and user context.

Analyze the image visually to extract:
1. The transaction date (ISO format).
2. The merchant/vendor name.
3. The total transaction amount (ignoring subtotals/change).
4. The transaction type (Income, Expense, Transfer).

Using the provided accounts, runbook rules, and transaction history, classify the transaction:
- Debit Account ID: [ID]
- Credit Account ID: [ID]

Return the response in the following JSON format:
{
  "vendor": "...",
  "amount": 0.0,
  "transaction_type": "...",
  "debit_account_id": "...",
  "credit_account_id": "...",
  "is_financial": true,
  "notes": "..."
}
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