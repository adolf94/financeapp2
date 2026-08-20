import datetime
import email
from email.policy import default
from email.utils import parsedate_to_datetime
import imaplib
import logging
import os
import re
import bs4
from bs4 import BeautifulSoup
import bleach
from bleach.css_sanitizer import CSSSanitizer
from markdownify import markdownify as md

IMAP_SERVER = 'imap.gmail.com'

def get_primary_accounts():
    i = 0
    data = []
    while os.environ.get(f"PRIMARY_EMAILS__{i}", "") != "":
        data.append(os.environ.get(f"PRIMARY_EMAILS__{i}", ""))
        i = i + 1
    return data

def smart_html_to_markdown(html_content):
    soup = bs4.BeautifulSoup(html_content, 'html.parser')

    # 1. Preliminary Cleaning
    for element in soup(["script", "style", "noscript", "header", "footer"]):
        element.decompose()

    # 2. DETECTOR: Is this a "Table Hell" layout?
    table_cells = soup.find_all('td')
    is_messy_layout = len(table_cells) > 40 

    if is_messy_layout:
        for tag in soup.find_all(['table', 'tr', 'td', 'div']):
            tag.insert_before('\n')
            tag.insert_after('\n')
        clean_html = str(soup).replace('\xa0', ' ')
    else:
        clean_html = str(soup)

    # 3. Convert to Markdown
    markdown_text = md(
        clean_html, 
        heading_style="atx", 
        bullets="- ",
        strip=['img', 'a']
    )

    # 4. POST-PROCESS: Clean up pipes
    cleaned_lines = []
    for line in markdown_text.splitlines():
        stripped = line.strip()
        if re.match(r'^[| \-\xa0\t]+$', stripped):
            continue
        line = re.sub(r'^\|+|\|+$', '', line).strip()
        if line:
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines)

def sanitize_html(html_content: str) -> str:
    ALLOWED_TAGS = [
        'a', 'abbr', 'acronym', 'b', 'blockquote', 'code', 'em', 'i', 'li', 'ol', 
        'p', 'strong', 'ul', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'tbody', 'thead', 'tr', 'td', 'th', 'img', 'center', 'font'
    ]

    ALLOWED_ATTRIBUTES = {
        '*': ['class', 'id', 'style'],
        'a': ['href', 'title', 'target'], 
        'img': ['src', 'alt', 'width', 'height'],
        'font': ['color', 'face']
    }

    ALLOWED_CSS_PROPERTIES = [
        'color', 'background-color', 'font-size', 'font-weight', 'text-align', 
        'margin', 'padding', 'border', 'line-height', 'border-collapse'
    ]

    css_sanitizer = CSSSanitizer(allowed_css_properties=ALLOWED_CSS_PROPERTIES)

    cleaned_html = bleach.clean(
        html_content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        css_sanitizer=css_sanitizer,
        strip=False
    )
    return cleaned_html

def get_ai_ready_body(msg):
    output = {
        "plain_text": None,
        "html_content": None,
        "default": None
    }

    for part in msg.walk():
        ctype = part.get_content_type()
        cdispo = str(part.get('Content-Disposition'))

        if 'attachment' in cdispo:
            continue

        try:
            charset = part.get_content_charset() or 'utf-8'
            payload = part.get_payload(decode=True).decode(charset, 'replace') 
        except Exception:
            continue

        if ctype == 'text/plain':
            output["plain_text"] = payload
        elif ctype == 'text/html':
            output["html_content"] = payload

    if output.get("html_content"):
        logging.info("Processing text/html content (Priority 1: HTML-to-Markdown).")
        try:
            output["markdown_content"] = smart_html_to_markdown(output["html_content"])
        except Exception as e:
            logging.warning(f"HTML parsing failed ({e}). Falling back to plain text.")
            if output.get("plain_text") and len(output["plain_text"].strip()) > 50:
                logging.info("Using text/plain content (Fallback).")
                output["markdown_content"] = output["plain_text"]
            else:
                output["markdown_content"] = "[Email body is empty or unreadable]"

    elif output.get("plain_text") and len(output["plain_text"].strip()) > 50:
        logging.info("Using text/plain content (Fallback).")
        output["markdown_content"] = output["plain_text"]
    else:
        output["markdown_content"] = "[Email body is empty or unreadable]"
        
    return output
def get_original_sent_time(msg):
    original_date_headers = ['X-Original-Date', 'Original-Date', 'X-Forwarded-Date']
    original_date_str = None
    for header in original_date_headers:
        if msg.get(header):
            original_date_str = msg.get(header)
            break
            
    if original_date_str:
        try:
            return parsedate_to_datetime(original_date_str)
        except (TypeError, ValueError):
            pass

    standard_date_str = msg.get('Date')
    if standard_date_str:
        try:
            return parsedate_to_datetime(standard_date_str)
        except (TypeError, ValueError):
            return None
    return None

def is_validated_forward(msg, primary_accounts, gmail_user):
    GOOGLE_SERVER_PATTERN = re.compile(r'(google\.com|smtp\.gmail\.com|mail-by\d+\.google\.com|2002:a05|2002:a17|smtp id)', re.IGNORECASE)
    
    forwarded_to = msg.get('X-Forwarded-To', None)
    forwarded_for = msg.get('X-Forwarded-For', '')
    is_source_validated = False
    
    if forwarded_to and forwarded_to.lower() == gmail_user.lower():
        is_source_validated = True
    
    if not is_source_validated:
        for p_email in primary_accounts:
            if re.search(re.escape(p_email), forwarded_for, re.IGNORECASE):
                is_source_validated = True
                break
        
        if not is_source_validated:
            from_header = msg.get('From', '')
            for p_email in primary_accounts:
                if re.search(re.escape(p_email), from_header, re.IGNORECASE):
                    is_source_validated = True
                    break

    if not is_source_validated:
        return False

    received_headers = msg.get_all('Received')
    if received_headers:
        top_received = received_headers[0]
        if GOOGLE_SERVER_PATTERN.search(top_received):
            return True
    return False

def fetch_unread_emails():
    gmail_user = os.environ.get("SECONDARY_EMAIL", "")
    gmail_pw = os.environ.get("SECONDARY_EMAIL_PW", "")
    if not gmail_user or not gmail_pw:
        logging.warning("Gmail credentials missing. Skipping email check.")
        return []

    primary_accounts = get_primary_accounts()
    mail = imaplib.IMAP4_SSL(IMAP_SERVER)
    emails = []

    try:
        mail.login(gmail_user, gmail_pw)
        mail.select('inbox')
        status, messages = mail.search(None, 'UNSEEN') 
        email_ids = messages[0].split()
        
        if not email_ids:
            return []

        for e_id in email_ids:
            e_id_str = e_id.decode()
            status, msg_data = mail.fetch(e_id, '(RFC822)') 
            if status != 'OK':
                continue

            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email, policy=default)
            if not is_validated_forward(msg, primary_accounts, gmail_user):
                continue

            subject = msg['subject'] if msg['subject'] else "[No Subject]"
            sender = msg['from']
            body = get_ai_ready_body(msg)

            body["subject"] = subject
            body["sender"] = sender
            body["emailId"] = f"{e_id_str}|{gmail_user}"
            sent_time = get_original_sent_time(msg)
            if sent_time:
                sent_dt = sent_time if sent_time.tzinfo else sent_time.replace(tzinfo=datetime.timezone.utc)
                body["timestamp"] = sent_dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                body["timestamp"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            emails.append({
                "email_id": e_id,
                "data": body
            })
    except Exception as ex:
        logging.error(f"Error fetching emails: {ex}")
        raise ex
    finally:
        try:
            mail.close()
            mail.logout()
        except Exception:
            pass

    return emails


async def check_and_save_emails_async(user_id: str = "3575cfa0-ec94-40d2-8b25-ee9f0f135027") -> int:
    from models.phone_hook import PhoneHookMessage
    from repositories.hook_repository import CosmosHookRepository
    import pytz
    from datetime import datetime, timezone


    from services.ai_service import AiService
    from repositories.prompt_debug_repository import CosmosPromptDebugRepository, NoOpPromptDebugRepository

    prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
    debug_repo = CosmosPromptDebugRepository() if prompt_debug else NoOpPromptDebugRepository()
    ai_service = AiService(debug_repo=debug_repo)

    emails = fetch_unread_emails()
    if not emails:
        return 0

    hook_repo = CosmosHookRepository()
    tz_default = pytz.timezone(os.environ.get("TIMEZONE", "Asia/Manila"))
    saved_count = 0

    for item in emails:
        body = item["data"]
        timestamp_str = body.get("timestamp")
        try:
            if timestamp_str:
                dt = datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            else:
                dt = datetime.now(timezone.utc)
        except ValueError:
            dt = datetime.now(timezone.utc)
        
        month_key = dt.strftime("%Y-%m-01")
        
        existing = await hook_repo.get_by_notif_id_async(body["emailId"], month_key)
        if existing:
            continue

        markdown_content = body.get('markdown_content', 'Email received')
        ai_data = await ai_service.summarize_email_async(
            sender=body.get('sender', ''),
            subject=body.get('subject', ''),
            markdown_content=markdown_content
        )
        ai_summary = ai_data.get("summary", "Email received")
        
        # Save extraction data for skipping Preprocessing step
        body["extracted_info"] = {
            "account_numbers": ai_data.get("account_numbers", []),
            "account_names": ai_data.get("account_names", []),
            "potential_vendor_names": ai_data.get("potential_vendor_names", [])
        }

        body["action"] = "email_received"
        
        hook_msg = PhoneHookMessage(
            user_id=user_id,
            action="email_received",
            raw_payload=body,
            raw_msg=f"[EMAIL]: {ai_summary}",
            month_key=month_key,
            partition_key=month_key,
            notification_type="email"
        )
        hook_msg.raw_payload["notif_id"] = body["emailId"]
        
        await hook_repo.add_async(hook_msg)
        saved_count += 1
        logging.info(f"Saved email hook for emailId: {body['emailId']}")

    return saved_count


async def check_and_process_emails_stream_async(user_id: str = "3575cfa0-ec94-40d2-8b25-ee9f0f135027"):
    """
    Synchronously fetch and process unread emails, yielding SSE events for each processed email.
    Yields:
      ("start", {"total": count})
      ("item_processed", {"ingestion": ingestion_dict, "count": current_index, "total": total_count})
      ("done", {"processed_count": saved_count})
    """
    from models.phone_hook import PhoneHookMessage
    from repositories.hook_repository import CosmosHookRepository
    import pytz
    from datetime import datetime, timezone
    from services.ai_service import AiService
    from repositories.prompt_debug_repository import CosmosPromptDebugRepository, NoOpPromptDebugRepository
    from services.email_processing_service import EmailProcessingService
    from repositories.ingestion_repository import CosmosIngestionRepository
    from repositories.vector_repository import CosmosVectorRepository
    from services.embedding_service import EmbeddingService
    from services.vector_service import VectorService
    from services.finance_api_service import FinanceApiService

    prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
    debug_repo = CosmosPromptDebugRepository() if prompt_debug else NoOpPromptDebugRepository()
    ai_service = AiService(debug_repo=debug_repo)

    emails = fetch_unread_emails()
    if not emails:
        yield ("start", {"total": 0})
        yield ("done", {"processed_count": 0})
        return

    hook_repo = CosmosHookRepository()
    ingestion_repo = CosmosIngestionRepository()
    vector_repo = CosmosVectorRepository()
    embedding_service = EmbeddingService()
    vector_service = VectorService(vector_repo)
    finance_api_service = FinanceApiService()


    email_service = EmailProcessingService(
        ingestion_repo=ingestion_repo,
        embedding_service=embedding_service,
        vector_service=vector_service,
        ai_service=ai_service,
        finance_api_service=finance_api_service,
    )

    unprocessed_emails = []
    for item in emails:
        body = item["data"]
        timestamp_str = body.get("timestamp")
        try:
            if timestamp_str:
                dt = datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            else:
                dt = datetime.now(timezone.utc)
        except ValueError:
            dt = datetime.now(timezone.utc)
        month_key = dt.strftime("%Y-%m-01")
        existing = await hook_repo.get_by_notif_id_async(body["emailId"], month_key)
        if not existing:
            unprocessed_emails.append((item, body, month_key))

    total = len(unprocessed_emails)
    yield ("start", {"total": total})

    saved_count = 0
    for idx, (item, body, month_key) in enumerate(unprocessed_emails, start=1):
        markdown_content = body.get('markdown_content', 'Email received')
        ai_data = await ai_service.summarize_email_async(
            sender=body.get('sender', ''),
            subject=body.get('subject', ''),
            markdown_content=markdown_content
        )
        ai_summary = ai_data.get("summary", "Email received")

        body["extracted_info"] = {
            "account_numbers": ai_data.get("account_numbers", []),
            "account_names": ai_data.get("account_names", []),
            "potential_vendor_names": ai_data.get("potential_vendor_names", [])
        }
        body["action"] = "email_received"

        hook_msg = PhoneHookMessage(
            user_id=user_id,
            action="email_received",
            raw_payload=body,
            raw_msg=f"[EMAIL]: {ai_summary}",
            month_key=month_key,
            partition_key=month_key,
            notification_type="email",
            status="processed"  # Mark processed so change feed doesn't re-run
        )
        hook_msg.raw_payload["notif_id"] = body["emailId"]

        await hook_repo.add_async(hook_msg)

        # Process ingestion synchronously
        ingestion = await email_service.process_hook_async(hook_msg)
        saved_count += 1
        ingestion_dict = ingestion.model_dump(by_alias=True, mode="json") if ingestion else None

        # Real-time SignalR broadcast for live UI updates
        from services.signalr_publisher import publish_signalr_message
        try:
            await publish_signalr_message(
                "notificationHub",
                "checkEmailItem",
                [ingestion_dict, idx, total],
                user_id=user_id
            )
        except Exception as sig_err:
            logging.warning(f"Failed to publish checkEmailItem to SignalR: {sig_err}")

        yield ("item_processed", {
            "ingestion": ingestion_dict,
            "count": idx,
            "total": total
        })

    from services.signalr_publisher import publish_signalr_message
    try:
        await publish_signalr_message(
            "notificationHub",
            "checkEmailComplete",
            [saved_count],
            user_id=user_id
        )
    except Exception as sig_err:
        logging.warning(f"Failed to publish checkEmailComplete to SignalR: {sig_err}")

    yield ("done", {"processed_count": saved_count})


