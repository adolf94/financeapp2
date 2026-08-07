# PBI 005: Email Ingestion via Azure Function Scheduled Task

## Problem Statement
Users cannot ingest email transactions automatically. Currently, financial information in emails must be manually transcribed into the system. Users want automated email ingestion with:
1. Scheduled fetching of unread emails from Gmail
2. Separate AI prompts optimized for email content
3. Separate runbook rules for email classification
4. Separate review workflow for email transactions

## Current Gap Analysis
- **No Email Integration**: System only handles SMS and app notifications
- **Manual Process Required**: Users must read emails and manually enter transactions
-\ \*Missing Infrastructure**: No email fetching, parsing, or ingestion capabilities
– **AI Prompt Gap**: Current prompts not optimized for email structure/language
– **Runbook Gap**: No email-specific classification rules

## Technical Requirements

### Core Requirements
1. **Gmail Integration**: OAuth2 authentication and email fetching
2. **Scheduled Azure Function**: Regular email polling (e.g., every 5 minutes)
3. **Email Parsing**: Extract financial information from email body
4. **Email-Specific AI Prompts**: Optimized for email language and structure
5. **Email-Specific Runbook**: Rules for email classification patterns
6. **Separate Review Workflow**: Email-specific review interface
7. **Email Metadata Handling**: Sender, subject, attachments, etc.

### Email-Specific Processing Needs
1. **HTML/Text Parsing**: Handle both HTML and plain text emails
2. **Attachment Processing**: Extract data from PDF statements, images
3. **Sender Analysis**: Classify email senders (banks, merchants, services)
4. **Subject Pattern Matching**: Identify transaction patterns in subjects
5. **Email Thread Handling**: Deal with conversation threads
6. **Unread Management**: Track processed vs unread emails
7. **Error Recovery**: Handle email service interruptions

## Architecture Design

### Overall Architecture
```
Gmail API → Azure Function (Timer Trigger) → Email Parser → Notification Pipeline → Email Processing Service → PendingIngestions
```

### Component Structure

#### 1. **Email Fetching Service**
```python
class EmailFetchingService:
    def __init__(self, credentials: dict):
        self.gmail_service = build_gmail_service(credentials)
        
    async def fetch_unread_emails(self) -> List[EmailMessage]:
        # Query Gmail API for unread emails
        # Filter for likely financial emails
        # Return structured email objects
```

#### 2. **Email Parsing Service**
```python
class EmailParsingService:
    async def parse_email(self, email: EmailMessage) -> Dict[str, Any]:
        # Extract sender, subject, body
        # Parse HTML/plain text
        # Extract potential financial data
        # Identify email type (receipt, statement, notification)
```

#### 3. **Email Processing Service**
```python
class EmailProcessingService(IngestionService):
    def __init__(self):
        super().__init__()
        self.email_extraction_prompt = EMAIL_EXTRACTION_PROMPT
        self.email_classification_prompt = EMAIL_CLASSIFICATION_PROMPT
        self.email_runbook_content = ""  # Email-specific runbook
        
    async def process_email(self, email_data: Dict) -> PendingIngestion:
        # Email-specific preprocessing
        # Email-specific classification
        # Email-specific auto-confirmation
```

#### 4. **Azure Function (Timer Trigger)**
```python
@app.timer_trigger(schedule="0 */5 * * * *", arg_name="timer")
async def EmailFetchingFunction(timer: func.TimerRequest):
    # Fetch unread emails
    # Process each email
    # Mark as processed in Gmail
    # Create pending ingestions
```

### Data Model Enhancements

#### 1. **Email Message Model**
```python
class EmailMessage(BaseModel):
    id: str
    user_id: str
    gmail_id: str
    sender: str
    recipient: str
    subject: str
    body_text: str
    body_html: Optional[str]
    received_date: datetime
    labels: List[str]
    attachments: List[EmailAttachment]
    processed: bool = False
    processing_metadata: Dict = {}
```

#### 2. **Enhanced PhoneHookMessage (or new model)**
```python
class EmailHookMessage(PhoneHookMessage):
    notification_type: str = "email"
    email_metadata: EmailMetadata
    email_parsed_data: EmailParsedData
    
class EmailMetadata(BaseModel):
    sender_domain: str
    email_type: str  # 'receipt', 'statement', 'notification', 'marketing'
    is_automated: bool
    has_attachments: bool
    
class EmailParsedData(BaseModel):
    extracted_amounts: List[float]
    extracted_dates: List[datetime]
    vendor_candidates: List[str]
    account_references: List[str]
```

#### 3. **Email-Specific Runbook Storage**
```
Settings container:
- id="runbook-email" → Email-specific runbook
- id="email-sender-rules" → Sender-specific classification rules
-p id="email-patterns" → Subject/body pattern recognition rules
```

## Implementation Plan

### Phase 1: Foundation (Gmail Integration & Infrastructure)
1. **OAuth2 Setup**
   - Google Cloud Console project setup
   - OAuth2 credentials configuration
   - Token storage and refresh management
   - User email authorization flow

2. **Azure Function Timer Setup**
   - Create timer-triggered Azure Function
   - Environment configuration for schedules
   - Error handling and retry logic
   - Logging and monitoring setup

3. **Basic Email Models**
   - EmailMessage data model
   - Email processing state tracking
   - Email-to-hook conversion logic

### Phase 2: Email Processing Pipeline
1. **Email Fetching Service**
   - Gmail API integration
   - Unread email querying
   - Email filtering (financial vs non-financial)
   - Batch processing logic

2. **Email Parsing Service**
   - HTML/plain text parsing
   - Financial data extraction
   - Sender/domain analysis
   - Email type classification

3. **Email-to-Hook Conversion**
   - Convert email data to hook format
   - Preserve email metadata
   - Handle email-specific fields
   - Integration with existing hook system

### Phase 3: Email-Specific AI Processing
1. **Email Extraction Prompt Development**
   - Optimized for email language/structure
   - Email-specific data extraction
   - Sender context consideration
   - Attachment content handling

2. **Email Classification Prompt Development**
   - Email-specific transaction classification
   - Email sender reputation consideration
   - Email format patterns (receipts, statements)
   - Email confidence scoring

3. **Email Processing Service**
   - Extend base IngestionService
   - Email-specific preprocessing
   - Email-specific classification
   - Email auto-confirmation rules

### Phase 4: Email-Specific Runbook & Review
1. **Email Runbook Development**
   - Initial email runbook template
   - Sender-specific rules
   - Email pattern recognition rules
   - Email confidence thresholds

2. **Email Review Interface**
   - Email-specific review modal
   - Email metadata display
   - Email source verification
   - Separate email correction workflow

3. **Email Management UI**
   - Email source configuration
   - Email processing settings
   - Email history viewing
   - Email error handling

## Files to Create

### New Components
1. `notif-ingester/services/email_fetching_service.py`
2. `notif-ingester/services/email_parsing_service.py`
3. `notif-ingester/services/email_processing_service.py`
4. `notif-ingester/email_function.py` (Timer-triggered Azure Function)
5. `notif-ingester/models/email_message.py`
6. `notif-ingester/prompts/email_prompts.py`
7. `notif-ingester/runbooks/email_runbook.md`

### Modified Components
1. `notif-ingester/function_app.py` (Add email endpoints)
2. `notif-ingester/services/ingestion_service.py` (Base class for email service)
3. `notif-ingester/services/ai_service.py` (Email prompt integration)
4. `frontend/src/components/EmailReviewModal.tsx` (New)
5. `frontend/src/pages/EmailSettings.tsx` (New)

### Configuration Files
1. `notif-ingester/.env` (Gmail OAuth2 credentials)
2. `notif-ingester/local.settings.json` (Timer schedule)
3. `notif-ingester/requirements.txt` (Gmail API libraries)

## API Design

### New Endpoints
1. **Email Configuration Endpoints**
```python
@app.route(route="email/config", methods=["GET", "PUT"])
async def EmailConfigFunction(req: func.HttpRequest):
    # Get/update email configuration
    # OAuth2 setup and token management
```

2. **Email Processing Endpoint**
```python
@app.route(route="email/process", methods=["POST"])
async def ProcessEmailFunction(req: func.HttpRequest):
    # Manual email processing endpoint
    # For testing and direct email submission
```

3. **Email Status Endpoints**
```python
@app.route(route="email/status", methods=["GET"])
async def EmailStatusFunction(req: func.HttpRequest):
    # Get email processing status
    # Statistics and error reports
```

### Timer-Triggered Function
```python
@app.timer_trigger(schedule="0 */5 * * * *", arg_name="timer")
async def EmailFetchingFunction(timer: func.TimerRequest):
    # Main scheduled email processing
    # Fetch → Parse → Process → Ingest cycle
```

## AI Prompt Engineering

### Email Extraction Prompt
```python
EMAIL_EXTRACTION_PROMPT = """
You are analyzing an email for financial transaction information. Emails have these characteristics:
1. Formal/informal language mix
2. HTML/plain text formatting
3. Sender reputation matters (bank vs merchant vs person)
4. Often contain receipts, statements, or notifications

Email Context:
-B Sender: {sender}
- Subject: {subject}


Extract financial information considering:
1. Sender type (bank statements, merchant receipts, personal emails)
2. Email format (receipts have itemized lists, statements have tables)
3. Common patterns (amount due, payment received, transaction alert)
4. Date formats specific to email locale
"""
```

### Email Classification Prompt
```python
EMAIL_CLASSIFICATION_PROMPT = """
You are classifying a financial transaction from an email. Consider:

EMAIL SPECIFIC CONTEXT:
- Sender Type: {sender_type}
- Email Format: {email_format}
- Email-Specific Runbook: {email_runbook}
- Extracted Data: {extracted_data}

Email-specific considerations:
- Bank statement emails → often Transfers between accounts
- Merchant receipt emails → Expenses with clear vendor
- Payment notification emails → Income or Expense depending on direction
- Automated vs personal emails have different confidence levels

Apply email-specific runbook rules before general rules.
```

### Email-Specific Runbook Template
```markdown
# Email Classification Rules

## Sender-Based Rules
1. **Bank Senders (bank.com)**: 
   - Usually statements → Transfer type
   - High confidence for account matching
   - Vendor = Bank name
   
2. **Merchant Senders (store.com)**:
   - Usually receipts → Expense type
   - Match to existing vendor if possible
   - Check for loyalty/member references
   
3. **Payment Processor Senders (paypal.com)**:
   - Can be Income or Expense
   - Look for "received" vs "sent" language
   - Vendor = Payment processor

## Email Format Rules
1. **Statement Emails**:
   - Table format → multiple transactions
   - Need to identify individual line items
   - Date ranges important
   
2. **Receipt Emails**:
   - Itemized lists → single transaction
   - Tax/tip separate from amount
   - Store location may indicate tags
   
3. **Notification Emails**:
   - Simple transaction alerts
   - Often highest confidence
   - Quick auto-confirmation possible

## Confidence Thresholds
– Bank statements: 85% auto-confirm
- Merchant receipts: 80% auto-confirm  
- Payment notifications:的无90% auto-confirm
- Personal emails: 70% (require review)
```

## Security & Privacy Considerations

### OAuth2 Security
1. **Token Storage**: Secure token storage in Azure Key Vault
2. **Token Refresh**: Automatic refresh before expiration
3. **Scope Minimization**: Request minimal Gmail permissions
4. **User Consent**: Clear consent screens for email access

### Data Privacy
1. **Email Content**: Store only necessary extracted data
2. **Data Retention**: Configurable retention policies
3. **User Control**: Users can disconnect email access anytime
4. **Local Processing**: Process emails in user's context only

### Compliance
1. **GDPR**: Email data as personal data
2. **Financial Regulations**: Bank email handling considerations
3. **User Transparency**: Clear logging of email processing
4. **Audit Trail**: Complete processing audit trail

## Success Metrics

### Quantitative Metrics
1. **Email Processing Rate**: Process X emails per minute
2. **Accuracy Rate**: Y% accurate email classification
3. **Auto-confirm Rate**: Z% emails auto-confirmed
4. **Error Rate**: <5% email processing errors
5. **Coverage**: Support major email providers beyond Gmail

### Qualitative Metrics
1. **User Satisfaction**: Email automation reduces manual entry
2. **Completeness**: Handle diverse email types (receipts, statements, alerts)
3. **Reliability**: Consistent email processing without interruptions
4. **Transparency**: Users understand what emails are processed

## Risks & Mitigations

### Technical Risks
1. **Gmail API Rate Limits**: Throttling and quota management
   - Mitigation: Efficient batching, exponential backoff
2. **Email Format Diversity**: Thousands of email formats
   - Mitigation: Pattern learning, user feedback loops
3. **Attachment Processing**: PDFs, images, complex formats
   - Mitigation: Gradual rollout, focus on text first
4. **Service Interruptions**: Gmail API downtime
   - Mitigation: Retry logic, graceful degradation

### Security Risks
1. **OAuth2 Token Security**: Token theft/leakage
   - Mitigation: Azure Key Vault, short-lived tokens
2. **Email Data Exposure**: Sensitive financial data in emails
   - Mitigation: Minimal data extraction, encryption
3. **User Privacy**: Processing personal emails
   - Mitigation: Opt-in only, clear data policies

### User Experience Risks
1. **Email Overload**: Too many emails processed
   - Mitigation: Smart filtering, user configuration
2. **False Positives**: Non-financial emails processed
   - Mitigation: Confidence thresholds, user review
3. **Complex Setup**: OAuth2 configuration complexity
   - Mitigation: Simplified setup wizard, clear instructions

## Testing Strategy

### Unit Tests
1. Email fetching service (mock Gmail API)
2. Email parsing (various email formats)
3. Email-to-hook conversion
4. Email processing service logic

### Integration Tests
1. End-to-end email processing flow
2. OAuth2 token lifecycle
3. Timer trigger scheduling
4. Error handling and recovery

### Performance Tests
1. Email batch processing performance
2. Gmail API quota management
3. Memory usage with email attachments
4. Concurrent email processing

### Security Tests
1. OAuth2 token security
2. Email data encryption
3. Access control validation
4. Data retention compliance

### Manual Testing
1. Real Gmail account integration
2. Various email type processing
3. User configuration workflow
4. Error scenario handling

## Timeline Estimate
-m **Phase 1**: 25-30 hours (Gmail Integration)
- **Phase 2**: 20-25 hours (Email Processing)
- **Phase 3**: 15-20 hours (AI & Runbook)
- **Phase 4**: 20-25 hours (UI & Integration)
- **Total**: 80-100 hours

## Dependencies
1. **Google Cloud Project**: Requires Gmail API access
2. **Azure Functions**: Timer trigger capability
3. **OAuth2 Infrastructure**: Token management system
4. **Current Ingestion Pipeline**: Integration point
5. **PBI 004**: Notification type system foundation

## Related PBIs
1. **PBI 004**: Separate SMS workflow (similar pattern)
2. **PBI 006**: Image ingestion (attachment processing)
3. **PBI 003**: Manual RUNBOOK editing (email runbook management)
4. **PBI 002**: Vendor editing (email vendor handling)

## Open Questions
1. Should we support multiple email providers (Outlook, Yahoo, etc.)?
2. How to handle email attachments (PDF statements, images)?
3. Should email processing be real-time or batch?
4. How to deal with email threads vs individual messages?
5. What retention policy for processed emails?