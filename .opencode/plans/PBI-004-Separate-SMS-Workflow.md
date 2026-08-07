# PBI 004: Separate SMS Workflow with Separate Prompt and Runbook

## Problem Statement
The current system treats SMS and app notifications similarly, but they have fundamentally different characteristics. SMS messages require different processing logic, prompt engineering, and runbook rules than app notifications.

## Current State Analysis

### Current Unified Processing Flow
- **Single Pipeline**: SMS and app notifications go through identical processing
- **Same Prompts**: Use same AI prompts for extraction and classification
- **Same Runbook**: Apply same rules to both notification types
- **Limited SMS Optimization**: SMS-specific characteristics not properly addressed

### SMS-Specific Characteristics
1. **Data Source**: SMS uses `sms_sender`, `sms_rcv_sender`, `Type='sms'`
2. **Content Format**: Embedded account numbers, masked card numbers (****1234)
3. **Extraction Complexity**: Account info embedded in unstructured text
4. **Vendor Matching**: Relies heavily on account number extraction
5. **App Context**: No application metadata, pure text messages

### App Notification Characteristics
1. **Data Source**: Uses `notif_pkg`, `action='notif_post'`
2. **Content Format**: Cleaner, app-specific formatting
3. **Extraction Simplicity**: More structured data
4. **Vendor Matching**: Often cleaner vendor identification
5. **App Context**: Rich application metadata available

## Technical Requirements

### Core Separation Requirements
1. **Dual Pipeline Architecture**: Separate processing flows for SMS vs app notifications
2. **SMS-Specific Prompts**: Tailored prompts for SMS extraction and classification
3. **SMS-Specific Runbook**: Rules optimized for SMS characteristics
4. **Type Detection**: Automatic detection of notification type at ingestion
5. **Parallel Processing**: Both pipelines can run concurrently
6. **Shared Infrastructure**: Keep embedding, vector search, transaction creation shared

### SMS-Specific Processing Needs
1. **Enhanced Extraction**: Better account number/name extraction from SMS text
2. **Mask Handling**: Special handling for masked numbers (****1234)
3. **SMS Sender Analysis**: Better analysis of SMS sender patterns
4. **Transfer Detection**: SMS-specific transfer detection logic
5. **Confidence Thresholds**: Different confidence levels for SMS classification

## Implementation Design

### Architecture Changes

**Current Architecture**:
```
Incoming Hook → PhoneHookMessages → IngestionService → Single Processing Pipeline → PendingIngestions
```

**Proposed Architecture**:
```
Incoming Hook → PhoneHookMessages → Type Detection → SMS Pipeline OR App Pipeline → PendingIngestions
```

### Component Structure

#### 1. **Type Detection Service**
```python
class NotificationTypeDetector:
    def detect_type(self, hook: PhoneHookMessage) -> str:
        if hook.action == 'sms' or 'sms_' in hook.raw_payload:
            return 'sms'
        elif hook.action == 'notif_post' or 'notif_pkg' in hook.raw_payload:
            return 'app'
        else:
            # Heuristic detection based on content
            return self._detect_by_content(hook.raw_msg)
```

#### 2. **SMS Processing Service**
```python
class SmsProcessingService(IngestionService):
    def __init__(self):
        super().__init__()
        self.sms_extraction_prompt = SMS_EXTRACTION_PROMPT
        self.sms_classification_prompt = SMS_CLASSIFICATION_PROMPT
        self.sms_runbook_content = ""  # SMS-specific runbook
        
    async def process_hook_async(self, hook: PhoneHookMessage):
        # SMS-specific preprocessing
        # SMS-specific classification
        # SMS-specific auto-confirmation rules
```

#### 3. **App Notification Processing Service**
```python
class AppNotificationProcessingService(IngestionService):
    def __init__(self):
        super().__init__()
        self.app_extraction_prompt = APP_EXTRACTION_PROMPT
        self.app_classification_prompt = APP_CLASSIFICATION_PROMPT
        self.app_runbook_content = ""  # App-specific runbook
        
    async def process_hook_async(self, hook: PhoneHookMessage):
        # App-specific preprocessing
        # App-specific classification
        # App-specific auto-confirmation rules
```

### Data Model Changes

#### 1. **Enhanced PhoneHookMessage Model**
```python
class PhoneHookMessage(BaseModel):
    # Existing fields
    id: str
    UserId: str
    received_at: datetime
    action: str
    raw_payload: dict
    raw_msg: str
    status: str
    
    # New fields
    notification_type: str = "unknown"  # 'sms', 'app', 'email', 'image'
    processing_metadata: dict = {}  # Type-specific metadata
```

#### 2. **Separate Runbook Storage**
```
Settings container:
- id="runbook-sms" → SMS-specific runbook
- id="runbook-app" → App-specific runbook
- id="runbook-email" → Email-specific runbook
- id="runbook-image" → Image-specific runbook
```

### AI Prompt Engineering

#### 1. **SMS Extraction Prompt**
```python
SMS_EXTRACTION_PROMPT = """
You are analyzing an SMS banking notification. SMS messages have these characteristics:
1. Account numbers often embedded in message text
2. Masked card numbers (****1234) common
3. Informal language and abbreviations
4. Bank-specific formatting patterns

Extract from this SMS: {raw_msg}

Focus especially on:
- Account numbers (even partial/masked)
- Recipient names (often individuals, not businesses)
- Transfer indicators ("sent to", "received from")
- Bank-specific patterns
"""
```

#### 2. **SMS Classification Prompt**
```python
SMS_CLASSIFICATION_PROMPT = """
You are classifying an SMS banking transaction. Consider these SMS-specific factors:

1. SMS CONTEXT: {sms_context}
2. SMS-SPECIFIC RUNBOOK: {sms_runbook_content}
3. EXTRACTED DATA: {extracted_data}

SMS-specific considerations:
- SMS transfers often between individuals
- SMS payments may be informal (person-to-person)
- Bank SMS may have different confidence thresholds
- Masked numbers require special handling

Apply SMS-specific runbook rules before general rules.
"""
```

#### 3. **SMS-Specific Runbook Template**
```markdown
# SMS Classification Rules

## SMS-Specific Vendor Rules
1. **Individual Transfers**: If SMS mentions person name → vendor=Individual
2. **Bank Transfers**: If SMS mentions bank name only → vendor=Bank
3. **Masked Numbers**: ****1234 patterns should match to card accounts

## SMS Confidence Thresholds
.
.
.
- SMS auto-confirm confidence: 90% (higher than app notifications)
- SMS requires explicit account number match

## SMS Transfer Detection
1. SMS with "sent to" → likely Transfer
2. SMS with "received from" → likely Income
3. SMS with bank name only → likely Transfer between accounts
```

## Implementation Plan

### Phase 1: Foundation (Type Detection & Routing)
1. **Enhance PhoneHookMessage Model**
   - Add `notification_type` field
   - Add `processing_metadata` for type-specific data

2. **Create Type Detection Service**
   - Detect SMS vs app notifications
   - Store type in database
   - Update existing hooks with type detection

3. **Update Ingestion Pipeline**
   - Route hooks to appropriate pipeline
   - Maintain backward compatibility
   - Add type logging for analytics

### Phase 2: SMS-Specific Processing
1. **Create SMSProcessingService**
   - Extend base IngestionService
   - Override preprocessing methods
   - Implement SMS-specific extraction

2. **Develop SMS-Specific Prompts**
   - SMS extraction prompt
   - SMS classification prompt
   - SMS vendor matching logic

3. **Create SMS-Specific Runbook**
   - Initial SMS runbook template
   - SMS-specific rule definitions
   - SMS confidence thresholds

### Phase 3: App Notification Refinement
1. **Create AppNotificationProcessingService**
   - Extend base IngestionService
   - App-specific optimizations
   - Cleaner data handling

2. **Develop App-Specific Prompts**
   - App notification extraction
   - App classification with app context
   - App vendor matching

3. **Create App-Specific Runbook**
   - App-specific rule definitions
   - App confidence thresholds
   - App metadata utilization

### Phase 4: Integration & Migration
1. **Dual Pipeline Integration**
   - Concurrent processing support
   - Shared resource management
   - Error handling per pipeline

2. **Historical Data Migration**
   - Classify historical hooks by type
   - Migrate to appropriate pipelines
   - Update runbook corrections by type

3. **Frontend Updates**
   - Display notification type in UI
   - Type-specific review interfaces
   - Separate correction workflows

## Files to Create/Modify

### New Components
1. `notif-ingester/services/notification_type_detector.py`
2. `notif-ingester/services/sms_processing_service.py`
3. `notif-ingester/services/app_processing_service.py`
4. `notif-ingester/prompts/sms_prompts.py`
5. `notif-ingester/prompts/app_prompts.py`

### Modified Components
1. `notif-ingester/models/phone_hook.py` (enhance model)
2. `notif-ingester/function_app.py` (update routing)
3. `notif-ingester/services/ingestion_service.py` (refactor as base class)
4. `notif-ingester/services/ai_service.py` (type-specific prompt selection)
5. `frontend/src/components/*` (display notification type)

### Runbook Files
1. `notif-ingester/runbooks/sms_runbook.md`
2. `notif-ingester/runbooks/app_runbook.md`
3. Database: Separate runbook storage per type

## API Design

### Enhanced Endpoints
1. **PhoneHookFunction Updates**
```python
@app.route(route="phone_hook", methods=["POST"])
async def PhoneHookFunction(req: func.HttpRequest):
    # Detect notification type
    # Store type metadata
    # Route to appropriate processing queue
```

2. **Type-Specific Classification**
```python
@app.route(route="ingestions/{id}/reclassify", methods=["POST"])
async def ReclassifyIngestionFunction(req: func.HttpRequest):
    # Use type-specific service
    # Apply type-specific prompts
    # Return type-aware results
```

3. **Runbook Management by Type**
```python
@app.route(route="runbook/{type}", methods=["GET", "PUT"])
async def RunbookByTypeFunction(req: func.HttpRequest):
    # Get/Put type-specific runbook
    # type = 'sms', 'app', 'email', 'image'
```

## Success Metrics

### Quantitative Metrics
1. **SMS Accuracy**: Improve SMS classification accuracy by 25%
2. **Processing Time**: Reduce SMS processing time by 30%
3. **Auto-confirm Rate**: Increase SMS auto-confirmation rate by 20%
4. **Error Reduction**: Reduce SMS-specific errors by 40%

### Qualitative Metrics
1. **User Satisfaction**: Better SMS classification experience
2. **Rule Precision**: More accurate SMS-specific rules
3. **Workflow Clarity**: Clear separation of SMS vs app processing
4. **Maintainability**: Easier to update SMS-specific logic

## Risks & Mitigations

### Technical Risks
1. **Pipeline Complexity**: Dual pipelines increase system complexity
   - Mitigation: Clear abstraction, shared core components
2. **Data Migration**: Historical data reclassification challenges
   - Mitigation: Gradual migration, backward compatibility
3. **Performance Impact**: Additional type detection overhead
   - Mitigation: Efficient detection, caching strategies

### Integration Risks
1. **Frontend Updates**: UI needs to display/handle notification types
   - Mitigation: Progressive enhancement, feature flags
2. **User Confusion**: Users may not understand type separation
   - Mitigation: Clear UI indicators, documentation
3. **Correction Workflow**: Corrections need type awareness
   - Mitigation: Type-specific correction handling

### Business Risks
1. **Development Time**: Significant refactoring required
   - Mitigation: Phased implementation, incremental value
2. **Testing Complexity**: Both pipelines need thorough testing
   - Mitigation: Comprehensive test suites, type-specific tests
3. **Maintenance Overhead**: Two pipelines to maintain
   - Mitigation: Shared core, clear separation of concerns

## Testing Strategy

### Unit Tests
1. Type detection accuracy for various notification formats
2. SMS-specific prompt effectiveness
3. App-specific processing correctness
4. Pipeline routing logic

### Integration Tests
1. End-to-end SMS processing flow
2. End-to-end app notification flow
3. Mixed type processing scenarios
4. Historical data migration scenarios

### Performance Tests
1. Dual pipeline throughput vs single pipeline
2. Type detection performance impact
3. SMS vs app processing time comparison
4. Memory usage with dual pipelines

### Manual Testing
1. Real SMS message processing
2. Real app notification processing
3. UI display of notification types
4. Type-specific correction workflows

## Timeline Estimate
- **Phase 1**: 15-20 hours (Foundation)
- **Phase 2**: 25-30 hours (SMS Processing)
- **Phase 3**: 15-20 hours (App Processing)
- **Phase 4**: 20-25 hours (Integration)
- **Total**: 75-95 hours

## Dependencies
1. **Current IngestionService**: Needs refactoring as base class
2. **AI Service**: Needs type-specific prompt selection
3. **Database Schema**: May need enhancements for type storage
4. **Frontend Components**: Need type display capabilities

## Related PBIs
1. **PBI 005**: Email ingestion (another notification type)
2. **PBI 006**: Image ingestion (another notification type)
3. **PBI 003**: Manual RUNBOOK editing (type-specific runbooks)
4. **PBI 002**: Vendor editing (type-specific vendor handling)

## Open Questions
1. Should we have more than two types? (SMS, App, Email, Image)
2. How to handle hybrid notifications? (SMS-like app notifications)
3. Should type detection be configurable per user?
4. How to handle notifications that change type over time?