import azure.functions as func
import os
import json
import logging
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
from models.phone_hook import PhoneHookMessage
from repositories.hook_repository import CosmosHookRepository
from repositories.ingestion_repository import CosmosIngestionRepository
from repositories.vector_repository import CosmosVectorRepository
from repositories.prompt_debug_repository import CosmosPromptDebugRepository, NoOpPromptDebugRepository
from services.hook_service import HookService
from services.embedding_service import EmbeddingService
from services.vector_service import VectorService
from services.ai_service import AiService
from services.finance_api_service import FinanceApiService
from services.ingestion_service import IngestionService
from services.sms_processing_service import SmsProcessingService
from services.notification_type_detector import NotificationTypeDetector
from services.email_fetching_service import check_and_save_emails_async
from ar_auth.client import ArAuthClient
from ar_auth.exceptions import TokenValidationError
from typing import Optional, Tuple

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# Shared auth client (caches JWKS)
_auth_client = ArAuthClient(authority="https://auth.adolfrey.com/api")

# Set to track notif_ids currently in-flight / being inserted to prevent duplicates
_processing_notif_ids = set()

def _require_auth(req: func.HttpRequest) -> Tuple[Optional[dict], Optional[func.HttpResponse]]:
    """Validate Bearer JWT. Returns (payload, None) on success, (None, error_response) on failure."""
    auth_header = req.headers.get("Authorization") or req.headers.get("authorization", "")
    if not auth_header:
        return None, func.HttpResponse(
            json.dumps({"error": "authorization_header_missing"}),
            status_code=401, mimetype="application/json"
        )
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None, func.HttpResponse(
            json.dumps({"error": "invalid_header", "description": "Expected: Bearer <token>"}),
            status_code=401, mimetype="application/json"
        )
    try:
        payload = _auth_client.verify_token(parts[1])
        return payload, None
    except TokenValidationError as e:
        return None, func.HttpResponse(
            json.dumps({"error": "invalid_token", "description": str(e)}),
            status_code=401, mimetype="application/json"
        )

# Setup dependencies
def get_hook_service():
    repo = CosmosHookRepository()
    return HookService(repo)

def get_ingestion_service():
    ingestion_repo = CosmosIngestionRepository()
    vector_repo = CosmosVectorRepository()
    embedding_service = EmbeddingService()
    vector_service = VectorService(vector_repo)
    # Only spin up the Cosmos debug repo when PROMPT_DEBUG is enabled
    prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
    debug_repo = CosmosPromptDebugRepository() if prompt_debug else NoOpPromptDebugRepository()
    ai_service = AiService(debug_repo=debug_repo)
    finance_api_service = FinanceApiService()
    
    return IngestionService(
        ingestion_repo=ingestion_repo,
        embedding_service=embedding_service,
        vector_service=vector_service,
        ai_service=ai_service,
        finance_api_service=finance_api_service
    )

def get_sms_ingestion_service():
    """Factory for the SMS-specific processing pipeline."""
    ingestion_repo = CosmosIngestionRepository()
    vector_repo = CosmosVectorRepository()
    embedding_service = EmbeddingService()
    vector_service = VectorService(vector_repo)
    prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
    debug_repo = CosmosPromptDebugRepository() if prompt_debug else NoOpPromptDebugRepository()
    ai_service = AiService(debug_repo=debug_repo)
    finance_api_service = FinanceApiService()

    return SmsProcessingService(
        ingestion_repo=ingestion_repo,
        embedding_service=embedding_service,
        vector_service=vector_service,
        ai_service=ai_service,
        finance_api_service=finance_api_service
    )

def get_email_ingestion_service():
    """Factory for the Email-specific processing pipeline."""
    ingestion_repo = CosmosIngestionRepository()
    vector_repo = CosmosVectorRepository()
    embedding_service = EmbeddingService()
    vector_service = VectorService(vector_repo)
    prompt_debug = os.environ.get("PROMPT_DEBUG", "").lower() == "true"
    debug_repo = CosmosPromptDebugRepository() if prompt_debug else NoOpPromptDebugRepository()
    ai_service = AiService(debug_repo=debug_repo)
    finance_api_service = FinanceApiService()

    from services.email_processing_service import EmailProcessingService
    return EmailProcessingService(
        ingestion_repo=ingestion_repo,
        embedding_service=embedding_service,
        vector_service=vector_service,
        ai_service=ai_service,
        finance_api_service=finance_api_service
    )

_type_detector = NotificationTypeDetector()

def validate_api_key(req: func.HttpRequest) -> bool:
    expected_key = os.environ.get("API_KEY")
    provided_key = req.headers.get("x-api-key")
    return bool(expected_key and provided_key and expected_key == provided_key)

# ── Function 1: PhoneHookFunction ──────────────────────────────────────────
@app.route(route="phone_hook", methods=["POST"])
async def PhoneHookFunction(req: func.HttpRequest) -> func.HttpResponse:
    if not validate_api_key(req):
        return func.HttpResponse(json.dumps({"message": "Unauthorized"}), status_code=401, mimetype="application/json")
        
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(json.dumps({"message": "Invalid JSON"}), status_code=400, mimetype="application/json")
        
    notif_id = body.get("notif_id")
    added_to_processing = False
    
    if notif_id:
        if notif_id in _processing_notif_ids:
            logging.warning(f"Duplicate post detected in-flight for notif_id: {notif_id}")
            return func.HttpResponse(
                json.dumps({"message": "Duplicate request in progress"}),
                status_code=202,
                mimetype="application/json"
            )
        _processing_notif_ids.add(notif_id)
        added_to_processing = True
        
    try:
        hook_service = get_hook_service()
        hook_msg = await hook_service.save_hook_async(body)
        return func.HttpResponse(
            json.dumps(hook_msg.model_dump(by_alias=True, mode="json")),
            status_code=201,
            mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error saving hook: {e}")
        return func.HttpResponse(json.dumps({"message": f"Internal server error: {e}"}), status_code=500, mimetype="application/json")
    finally:
        if added_to_processing and notif_id:
            _processing_notif_ids.discard(notif_id)

# ── Function 2: ClassifyNotificationFunction ────────────────────────────────
@app.cosmos_db_trigger(
    arg_name="documents",
    connection="CosmosConnectionString",
    database_name="%COSMOS_DB%",
    container_name="PhoneHookMessages",
    lease_container_name="PhoneHookMessages-leases",
    create_lease_container_if_not_exists=True,
)
async def ClassifyNotificationFunction(documents: func.DocumentList) -> None:
    if not documents:
        return

    app_ingestion_service = get_ingestion_service()
    sms_ingestion_service = get_sms_ingestion_service()
    email_ingestion_service = get_email_ingestion_service()
    hook_repo = CosmosHookRepository()

    for doc in documents:
        doc_dict = dict(doc)
        if doc_dict.get("status") != "received":
            continue

        try:
            hook_msg = PhoneHookMessage(**doc_dict)

            # Route to the appropriate pipeline based on notification type
            notif_type = _type_detector.detect_type(hook_msg)
            logging.info(f"[ClassifyNotificationFunction] Routing {hook_msg.id} as '{notif_type}'")

            if notif_type == "sms":
                await sms_ingestion_service.process_hook_async(hook_msg)
            elif notif_type == "email":
                await email_ingestion_service.process_hook_async(hook_msg)
            else:
                await app_ingestion_service.process_hook_async(hook_msg)

            # Mark hook as processed
            await hook_repo.update_status_async(
                hook_msg.id, "processed", hook_msg.user_id
            )
        except Exception as e:
            logging.error(f"Error processing document {doc_dict.get('id')}: {e}")
            await hook_repo.update_status_async(
                doc_dict.get("id"), "error", doc_dict.get("user_id", "default")
            )

# ── Function 3: LearnIngestionFunction ──────────────────────────────────
@app.route(route="ingestions/{ingestion_id}/learn", methods=["POST"])
async def LearnIngestionFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    ingestion_id = req.route_params.get("ingestion_id")
    body = {}
    try:
        body = req.get_json() or {}
    except ValueError:
        pass

    user_id = user.get("sub", "default")
    user_confirmed = {k: v for k, v in body.items() if k != "user_id"}

    ingestion_service = get_ingestion_service()
    try:
        learned = await ingestion_service.learn_ingestion_async(ingestion_id, user_id, user_confirmed)
        return func.HttpResponse(
            json.dumps(learned.model_dump(by_alias=True, mode="json")),
            status_code=200, mimetype="application/json"
        )
    except ValueError as e:
        return func.HttpResponse(str(e), status_code=404)
    except Exception as e:
        logging.error(f"Error learning ingestion: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)

# ── Function 3.1: GetPendingIngestionsFunction ──────────────────────────
@app.route(route="ingestions", methods=["GET"])
async def GetPendingIngestionsFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    status = req.params.get("status", "Pending")
    user_id = user.get("sub", "default")
    
    # Lazy-load only what's needed for this query — avoids initializing AI/embedding clients
    ingestion_repo = CosmosIngestionRepository()
    try:
        skip = int(req.params.get("$skip", 0))
        top = int(req.params.get("$top", 50))
    except (ValueError, TypeError):
        skip, top = 0, 50
        
    try:
        ingestions = await ingestion_repo.get_by_status_async(user_id, status, skip=skip, top=top)
        return func.HttpResponse(
            json.dumps([i.model_dump(by_alias=True, mode="json") for i in ingestions]),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error fetching ingestions: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)

# ── Function 3.1b: GetIngestionByIdFunction ──────────────────────────
@app.route(route="ingestions/{ingestion_id}", methods=["GET"])
async def GetIngestionByIdFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    ingestion_id = req.route_params.get("ingestion_id")
    user_id = user.get("sub", "default")
    
    ingestion_service = get_ingestion_service()
    try:
        ingestion = await ingestion_service.ingestion_repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            return func.HttpResponse("Ingestion not found", status_code=404)
            
        return func.HttpResponse(
            json.dumps(ingestion.model_dump(by_alias=True, mode="json")),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error fetching ingestion: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)


# ── Function 3.1c: ReclassifyIngestionFunction ─────────────────────────
@app.route(route="ingestions/{ingestion_id}/reclassify", methods=["POST"])
async def ReclassifyIngestionFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    ingestion_id = req.route_params.get("ingestion_id")
    user_id = user.get("sub", "default")

    ingestion_repo = CosmosIngestionRepository()
    try:
        ingestion = await ingestion_repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            return func.HttpResponse("Ingestion not found", status_code=404)
        
        notif_type = ingestion.notification_type
        if notif_type == "sms":
            service = get_sms_ingestion_service()
        elif notif_type == "email":
            service = get_email_ingestion_service()
        else:
            service = get_ingestion_service()

        reclassified = await service.reclassify_ingestion_async(ingestion_id, user_id)
        return func.HttpResponse(
            json.dumps(reclassified.model_dump(by_alias=True, mode="json")),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error reclassifying ingestion: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")


# ── Function 3.2: RejectIngestionFunction ──────────────────────────────
@app.route(route="ingestions/{ingestion_id}/reject", methods=["POST"])
async def RejectIngestionFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    ingestion_id = req.route_params.get("ingestion_id")
    user_id = user.get("sub", "default")
    
    ingestion_service = get_ingestion_service()
    try:
        ingestion = await ingestion_service.ingestion_repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            return func.HttpResponse("Ingestion not found", status_code=404)
            
        ingestion.status = "Rejected"
        await ingestion_service.ingestion_repo.update_async(ingestion)
        
        return func.HttpResponse(
            json.dumps({"id": ingestion_id, "status": "Rejected"}),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error rejecting ingestion: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)

# ── Function 3.3: ConfirmStatusFunction ────────────────────────────────
@app.route(route="ingestions/{ingestion_id}/confirm-status", methods=["POST"])
async def ConfirmStatusFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    ingestion_id = req.route_params.get("ingestion_id")
    user_id = user.get("sub", "default")
    
    try:
        body = req.get_json()
        transaction_id = body.get("transaction_id")
        user_confirmed = body.get("user_confirmed", {})
        skip_learning = body.get("skip_learning", False)
    except ValueError:
        return func.HttpResponse("Invalid JSON", status_code=400)
        
    ingestion_service = get_ingestion_service()
    try:
        ingestion = await ingestion_service.ingestion_repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            return func.HttpResponse("Ingestion not found", status_code=404)
            
        ingestion.status = "Confirmed"
        ingestion.transaction_id = transaction_id
        await ingestion_service.ingestion_repo.update_async(ingestion)
        
        # Trigger learning asynchronously if not skipped
        if not skip_learning:
            learned = await ingestion_service.learn_ingestion_async(ingestion_id, user_id, user_confirmed)
        else:
            learned = ingestion
        
        return func.HttpResponse(
            json.dumps(learned.model_dump(by_alias=True, mode="json")),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error confirming ingestion status: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)

# ── Function 4.5: PatchIngestionVendorFunction ──────────────────────────────
@app.route(route="ingestions/{ingestion_id}/vendor", methods=["PATCH"])
async def PatchIngestionVendorFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    ingestion_id = req.route_params.get("ingestion_id")
    user_id = user.get("sub", "default")
    
    try:
        body = req.get_json()
        new_vendor = body.get("vendor", "")
    except ValueError:
        return func.HttpResponse("Invalid JSON", status_code=400)
        
    if not new_vendor:
        return func.HttpResponse("Missing 'vendor' field", status_code=400)
        
    ingestion_service = get_ingestion_service()
    try:
        ingestion = await ingestion_service.ingestion_repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            return func.HttpResponse("Ingestion not found", status_code=404)
            
        ingestion.ai_parsed.vendor = new_vendor
        ingestion.ai_parsed.vendor_matched = True
        ingestion.ai_parsed.suggested_vendor = None
        
        await ingestion_service.ingestion_repo.update_async(ingestion)
        
        return func.HttpResponse(
            json.dumps(ingestion.model_dump(by_alias=True, mode="json")),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error updating vendor: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)

# ── Function 5: ClassifyHookFunction (Synchronous classification endpoint) ─
@app.route(route="ingestions/classify-hook", methods=["POST"])
async def ClassifyHookFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err
        
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse("Invalid JSON", status_code=400)
        
    ingestion_service = get_ingestion_service()
    
    try:
        hook_msg = PhoneHookMessage(**body)
        # Process the hook synchronously using Gemini AI
        pending_ingestion = await ingestion_service.process_hook_async(hook_msg)
        return func.HttpResponse(
            json.dumps(pending_ingestion.model_dump(by_alias=True, mode="json")),
            status_code=200,
            mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error processing synchronous classification: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)


# ── Function 7: GetHistoricalHooksFunction ─────────────────────────────────
@app.route(route="historical-hooks", methods=["GET"])
async def GetHistoricalHooksFunction(req: func.HttpRequest) -> func.HttpResponse:
    _, err = _require_auth(req)
    if err: return err
    old_conn = os.environ.get("OldCosmosConnectionString", "")
    old_db = os.environ.get("OLD_COSMOS_DB", "FinanceAppLocal")

    if not old_conn:
        return func.HttpResponse("OldCosmosConnectionString not configured", status_code=500)

    from azure.cosmos.aio import CosmosClient as AsyncCosmosClient

    try:
        async with AsyncCosmosClient.from_connection_string(old_conn) as client:
            container = client.get_database_client(old_db).get_container_client("HookMessages")
            query = (
                "SELECT * FROM c "
                "WHERE c.JsonData.action IN ('notif_post', 'sms_receive') "
                "AND (NOT IS_DEFINED(c.Status) OR (c.Status != 'Imported' AND c.Status != 'Ignored')) "
                "AND c.ExtractedData.success = true "
                "ORDER BY c.Date DESC"
            )
            results = []
            async for item in container.query_items(query=query, max_item_count=100):
                results.append(item)
                if len(results) >= 100:
                    break

        return func.HttpResponse(
            json.dumps(results, default=str),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        logging.error(f"Error fetching historical hooks: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)


# ── Function 8: ImportHistoricalHookFunction ────────────────────────────────
@app.route(route="historical-hooks/{hook_id}/import", methods=["POST"])
async def ImportHistoricalHookFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    hook_id = req.route_params.get("hook_id")
    user_id = user.get("sub", "default")

    old_conn = os.environ.get("OldCosmosConnectionString", "")
    old_db = os.environ.get("OLD_COSMOS_DB", "FinanceAppLocal")

    if not old_conn:
        return func.HttpResponse("OldCosmosConnectionString not configured", status_code=500)

    from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
    from datetime import datetime, timezone

    def _scalar(val):
        """Flatten any value to a plain string — handles arrays, dicts, primitives."""
        if val is None:
            return ""
        if isinstance(val, list):
            return str(val[0]) if val else ""
        if isinstance(val, dict):
            return json.dumps(val)
        return str(val)

    try:
        async with AsyncCosmosClient.from_connection_string(old_conn) as client:
            old_container = client.get_database_client(old_db).get_container_client("HookMessages")

            # 1. Fetch old item
            old_item = None
            async for item in old_container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": hook_id}],
            ):
                old_item = item
                break

            if old_item is None:
                return func.HttpResponse(f"Hook {hook_id} not found in old database", status_code=404)

            # 2. Mark old item as Imported
            old_item["Status"] = "Imported"
            await old_container.upsert_item(old_item)

        # 3. Map old schema -> PhoneHookMessage
        date_str = _scalar(old_item.get("Date"))
        try:
            received_at = datetime.fromisoformat(date_str.replace("Z", "+00:00")) if date_str else datetime.now(timezone.utc)
        except ValueError:
            received_at = datetime.now(timezone.utc)

        received_at = received_at.astimezone(timezone.utc)
        month_key = received_at.strftime("%Y-%m-01")

        # Flatten JsonData arrays/primitives to plain strings
        json_data: dict = old_item.get("JsonData") or {}
        raw_payload = {k: _scalar(v) for k, v in json_data.items()}

        # Merge ExtractedData fields
        extracted: dict = old_item.get("ExtractedData") or {}
        if app_val := _scalar(extracted.get("app")):
            raw_payload.setdefault("notif_pkg", app_val)
        if sender_val := _scalar(extracted.get("senderName")):
            raw_payload.setdefault("sms_sender", sender_val)

        action = _scalar(old_item.get("Type")) or "notif"

        # Detect notification type from the action field
        is_sms = "sms" in action.lower() or bool(
            raw_payload.get("sms_rcv_sender") or raw_payload.get("sms_sender") or raw_payload.get("sms_rcv_msg")
        )
        notification_type = "sms" if is_sms else "app"

        # Build raw_msg: prefer the persisted RawMsg, but for SMS re-derive from sender+body
        raw_msg = _scalar(old_item.get("RawMsg")) or ""
        if is_sms and not raw_msg:
            sender = raw_payload.get("sms_rcv_sender") or raw_payload.get("sms_sender") or ""
            body = raw_payload.get("sms_rcv_msg") or raw_payload.get("sms_msg") or ""
            raw_msg = f"[SMS from {sender}] {body}".strip() if sender else body
        if not raw_msg:
            raw_msg = "Unknown notification"

        hook_msg = PhoneHookMessage(
            id=hook_id,
            UserId=user_id,
            received_at=received_at,
            action=action,
            raw_payload=raw_payload,
            raw_msg=raw_msg,
            status="processed",
            month_key=month_key,
            partition_key=month_key,
            notification_type=notification_type,
        )

        # 4. Upsert into new CosmosDB PhoneHookMessages
        hook_repo = CosmosHookRepository()
        await hook_repo.add_async(hook_msg)

        # 5. Classify synchronously — route to the correct pipeline
        logging.info(f"[ImportHistoricalHookFunction] Routing {hook_id} as '{notification_type}'")
        if notification_type == "sms":
            ingestion_service = get_sms_ingestion_service()
        else:
            ingestion_service = get_ingestion_service()
        pending_ingestion = await ingestion_service.process_hook_async(hook_msg)

        return func.HttpResponse(
            json.dumps(pending_ingestion.model_dump(by_alias=True, mode="json")),
            status_code=200,
            mimetype="application/json",
        )

    except Exception as e:
        logging.error(f"Error importing historical hook {hook_id}: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)



# ── Function 9: IgnoreHistoricalHookFunction ────────────────────────────────
@app.route(route="historical-hooks/{hook_id}/ignore", methods=["POST"])
async def IgnoreHistoricalHookFunction(req: func.HttpRequest) -> func.HttpResponse:
    _, err = _require_auth(req)
    if err: return err

    hook_id = req.route_params.get("hook_id")

    old_conn = os.environ.get("OldCosmosConnectionString", "")
    old_db = os.environ.get("OLD_COSMOS_DB", "FinanceAppLocal")

    if not old_conn:
        return func.HttpResponse("OldCosmosConnectionString not configured", status_code=500)

    from azure.cosmos.aio import CosmosClient as AsyncCosmosClient

    try:
        async with AsyncCosmosClient.from_connection_string(old_conn) as client:
            container = client.get_database_client(old_db).get_container_client("HookMessages")

            old_item = None
            async for item in container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": hook_id}],
            ):
                old_item = item
                break

            if old_item is None:
                return func.HttpResponse(f"Hook {hook_id} not found", status_code=404)

            old_item["Status"] = "Ignored"
            await container.upsert_item(old_item)

        return func.HttpResponse(
            json.dumps({"id": hook_id, "status": "Ignored"}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        logging.error(f"Error ignoring historical hook {hook_id}: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)


# ── Function 10: GenerateAccountDescriptionFunction ─────────────────────────
@app.route(route="accounts/generate-description", methods=["POST"])
async def GenerateAccountDescriptionFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    
    try:
        body = req.get_json() or {}
        account_name = body.get("account_name", "")
        account_type = body.get("account_type", "")
        group_name = body.get("group_name", "")
        context = body.get("context", "")

        ingestion_service = get_ingestion_service()
        ai_result = await ingestion_service.generate_account_description_async(
            user_id, account_name, account_type, group_name, context
        )

        return func.HttpResponse(
            json.dumps(ai_result),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        logging.error(f"Error generating account description: {e}")
        return func.HttpResponse(f"Internal server error: {e}", status_code=500)

# ── Function 11: GetRunbookCorrectionsFunction ─────────────────────────────────
@app.route(route="runbook/corrections", methods=["GET"])
async def GetRunbookCorrectionsFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    r_type = req.params.get("type", "app").lower()
    
    # Lazy-load only the repository — no AI/embedding clients needed
    ingestion_repo = CosmosIngestionRepository()
    try:
        # Fetch Confirmed ingestions with higher limit for corrections review
        ingestions = await ingestion_repo.get_by_status_async(user_id, "Confirmed", top=200)
        
        # Filter for those with user_why, not runbook_synced, and matching type
        corrections = []
        for i in ingestions:
            if not (i.user_confirmed and i.user_confirmed.get("user_why") and not getattr(i, "runbook_synced", False)):
                continue
            
            # Detect type
            hook_type = _type_detector.detect_type_from_payload(
                i.raw_payload.get("action", ""),
                i.raw_payload
            )
            
            if hook_type == r_type:
                corrections.append(i)
        
        return func.HttpResponse(
            json.dumps([c.model_dump(by_alias=True, mode="json") for c in corrections]),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Error fetching runbook corrections: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")

# ── Function 12: GetRunbookSessionFunction ──────────────────────────────────
@app.route(route="runbook/review/session", methods=["GET"])
async def GetRunbookSessionFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Returns the current active review session, or 404 if none exists."""
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    ingestion_service = get_ingestion_service()
    try:
        session = await ingestion_service._finance_api_service.get_runbook_session_async(user_id)
        if not session:
            return func.HttpResponse("null", status_code=200, mimetype="application/json")
        return func.HttpResponse(json.dumps(session, default=str), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error fetching runbook session: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")

# ── Function 12.1: GetRunbookFunction ───────────────────────────────────────
@app.route(route="runbook", methods=["GET"])
async def GetRunbookFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Returns the current runbook content (accepts ?type=sms or ?type=app)."""
    user, err = _require_auth(req)
    if err: return err
    user_id = user.get("sub", "default")
    
    # Check runbook type
    r_type = req.params.get("type", "app").lower()
    runbook_id = "runbook-sms" if r_type == "sms" else "runbook"
    
    ingestion_service = get_ingestion_service()
    try:
        content = await ingestion_service._finance_api_service.get_runbook_content_async(user_id, runbook_id=runbook_id)
        # If SMS runbook is requested but empty, bootstrap it
        if r_type == "sms" and not content:
            sms_service = get_sms_ingestion_service()
            content = await sms_service._get_or_bootstrap_sms_runbook(user_id)
            
        return func.HttpResponse(json.dumps({"content": content or ""}), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error fetching runbook: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")

# ── Function 12.2: UpdateRunbookFunction ────────────────────────────────────
@app.route(route="runbook", methods=["PUT"])
async def UpdateRunbookFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Updates the runbook content (accepts ?type=sms or ?type=app)."""
    user, err = _require_auth(req)
    if err: return err
    user_id = user.get("sub", "default")
    
    r_type = req.params.get("type", "app").lower()
    runbook_id = "runbook-sms" if r_type == "sms" else "runbook"
    
    try:
        body = req.get_json()
        content = body.get("content", "")
    except ValueError:
        return func.HttpResponse(json.dumps({"error": "Invalid JSON"}), status_code=400, mimetype="application/json")
        
    ingestion_service = get_ingestion_service()
    try:
        await ingestion_service._finance_api_service.save_runbook_content_async(user_id, content, runbook_id=runbook_id)
        return func.HttpResponse(json.dumps({"success": True}), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error saving runbook: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")

# ── Function 13: StartRunbookReviewFunction ──────────────────────────────────
@app.route(route="runbook/review/start", methods=["POST"])
async def StartRunbookReviewFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Creates (or overwrites) a review session, runs AI analysis, persists to Settings."""
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    
    try:
        body = req.get_json()
        corrections = body.get("corrections", [])
        runbook_type = body.get("runbook_type", "app")
    except ValueError:
        return func.HttpResponse(json.dumps({"error": "Invalid JSON"}), status_code=400, mimetype="application/json")
        
    ingestion_service = get_ingestion_service()
    try:
        from datetime import datetime, timezone
        accounts = await ingestion_service._finance_api_service.get_accounts_async(user_id)
        vendors = await ingestion_service._finance_api_service.get_vendors_async(user_id)
        runbook_id = "runbook-sms" if runbook_type == "sms" else "runbook"
        current_runbook = await ingestion_service._finance_api_service.get_runbook_content_async(user_id, runbook_id=runbook_id)
        if not current_runbook:
            if runbook_type == "sms":
                sms_service = get_sms_ingestion_service()
                current_runbook = await sms_service._get_or_bootstrap_sms_runbook(user_id)
            else:
                current_runbook = ingestion_service._ai_service.get_default_runbook_content()
            
        ai_response = await ingestion_service._ai_service.start_runbook_review_async(
            corrections=corrections,
            accounts=accounts,
            vendors=vendors,
            current_runbook=current_runbook
        )

        now = datetime.now(timezone.utc).isoformat()
        session = {
            "id": "runbook-review-session",
            "UserId": user_id,
            "corrections": corrections,
            "runbook_type": runbook_type,
            "chat_history": [{"role": "ai", "text": ai_response.get("message", ""), "questions": ai_response.get("questions", [])}],
            "proposed_runbook": ai_response.get("proposed_runbook", ""),
            "account_description_updates": ai_response.get("account_description_updates", []),
            "vendor_updates": ai_response.get("vendor_updates", []),
            "created_at": now,
            "updated_at": now,
            "partition_key": user_id
        }
        await ingestion_service._finance_api_service.save_runbook_session_async(user_id, session)

        return func.HttpResponse(json.dumps(session, default=str), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error starting runbook review: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")

# ── Function 14: ChatRunbookReviewFunction ───────────────────────────────────
@app.route(route="runbook/review/chat", methods=["POST"])
async def ChatRunbookReviewFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Appends user message + AI reply to the persisted session. Only user_message needed in body."""
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    
    try:
        body = req.get_json()
        user_message = body.get("user_message", "")
    except ValueError:
        return func.HttpResponse(json.dumps({"error": "Invalid JSON"}), status_code=400, mimetype="application/json")
        
    ingestion_service = get_ingestion_service()
    try:
        from datetime import datetime, timezone

        # Load session
        session = await ingestion_service._finance_api_service.get_runbook_session_async(user_id)
        if not session:
            return func.HttpResponse(json.dumps({"error": "No active session. Start a review first."}), status_code=404, mimetype="application/json")

        # Append user message to history
        chat_history = session.get("chat_history", [])
        chat_history.append({"role": "user", "text": user_message})

        # Fetch supporting data
        accounts = await ingestion_service._finance_api_service.get_accounts_async(user_id)
        vendors = await ingestion_service._finance_api_service.get_vendors_async(user_id)
        runbook_type = session.get("runbook_type", "app")
        runbook_id = "runbook-sms" if runbook_type == "sms" else "runbook"
        current_runbook = await ingestion_service._finance_api_service.get_runbook_content_async(user_id, runbook_id=runbook_id)
        if not current_runbook:
            if runbook_type == "sms":
                sms_service = get_sms_ingestion_service()
                current_runbook = await sms_service._get_or_bootstrap_sms_runbook(user_id)
            else:
                current_runbook = ingestion_service._ai_service.get_default_runbook_content()
            
        ai_response = await ingestion_service._ai_service.chat_runbook_review_async(
            chat_history=chat_history,
            user_message=user_message,
            proposed_runbook=session.get("proposed_runbook", ""),
            proposed_account_updates=session.get("account_description_updates", []),
            proposed_vendor_updates=session.get("vendor_updates", []),
            corrections=session.get("corrections", []),
            accounts=accounts,
            vendors=vendors,
            current_runbook=current_runbook
        )

        # Append AI reply and update session
        chat_history.append({"role": "ai", "text": ai_response.get("message", ""), "questions": ai_response.get("questions", [])})
        session["chat_history"] = chat_history
        session["proposed_runbook"] = ai_response.get("proposed_runbook", session.get("proposed_runbook", ""))
        session["account_description_updates"] = ai_response.get("account_description_updates", session.get("account_description_updates", []))
        session["vendor_updates"] = ai_response.get("vendor_updates", session.get("vendor_updates", []))
        session["updated_at"] = datetime.now(timezone.utc).isoformat()

        await ingestion_service._finance_api_service.save_runbook_session_async(user_id, session)

        return func.HttpResponse(json.dumps(session, default=str), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error in runbook review chat: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")


# ── Function 14.5: UpdateRunbookSessionFunction ──────────────────────────────
@app.route(route="runbook/review/session", methods=["PUT"])
async def UpdateRunbookSessionFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Updates the active session's proposed runbook, account, or vendor updates."""
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(json.dumps({"error": "Invalid JSON"}), status_code=400, mimetype="application/json")
        
    ingestion_service = get_ingestion_service()
    try:
        from datetime import datetime, timezone
        session = await ingestion_service._finance_api_service.get_runbook_session_async(user_id)
        if not session:
            return func.HttpResponse(json.dumps({"error": "No active review session found."}), status_code=404, mimetype="application/json")

        if "proposed_runbook" in body:
            session["proposed_runbook"] = body["proposed_runbook"]
        if "account_description_updates" in body:
            session["account_description_updates"] = body["account_description_updates"]
        if "vendor_updates" in body:
            session["vendor_updates"] = body["vendor_updates"]

        session["updated_at"] = datetime.now(timezone.utc).isoformat()
        await ingestion_service._finance_api_service.save_runbook_session_async(user_id, session)

        return func.HttpResponse(json.dumps(session, default=str), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error updating runbook session: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")


# ── Function 15: ApproveRunbookReviewFunction ────────────────────────────────
@app.route(route="runbook/review/approve", methods=["POST"])
async def ApproveRunbookReviewFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Reads session, applies runbook + account updates, marks corrections synced, then deletes session."""
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
        
    ingestion_service = get_ingestion_service()
    try:
        # Load session
        session = await ingestion_service._finance_api_service.get_runbook_session_async(user_id)
        if not session:
            return func.HttpResponse(json.dumps({"error": "No active session to approve."}), status_code=404, mimetype="application/json")

        try:
            body = req.get_json() or {}
        except ValueError:
            body = {}
            
        proposed_runbook = session.get("proposed_runbook", "")
        # If the frontend passes explicit account_updates in the body, use them instead of the session's
        account_updates = body.get("account_updates", session.get("account_description_updates", []))
        vendor_updates = body.get("vendor_updates", session.get("vendor_updates", []))
        corrections = session.get("corrections", [])
        correction_ids = [c.get("id") for c in corrections if c.get("id")]

        # Save updated runbook
        runbook_type = session.get("runbook_type", "app")
        runbook_id = "runbook-sms" if runbook_type == "sms" else "runbook"
        await ingestion_service._finance_api_service.save_runbook_content_async(user_id, proposed_runbook, runbook_id=runbook_id)
        
        # Update account descriptions
        if account_updates:
            await ingestion_service._finance_api_service.update_account_descriptions_async(user_id, account_updates)
            
        # Update vendor tags
        if vendor_updates:
            await ingestion_service._finance_api_service.update_vendor_tags_async(user_id, vendor_updates)
            
        # Mark corrections as runbook_synced
        for c_id in correction_ids:
            try:
                ingestion = await ingestion_service.ingestion_repo.get_by_id_async(c_id, user_id)
                if ingestion:
                    ingestion.runbook_synced = True
                    await ingestion_service.ingestion_repo.update_async(ingestion)
            except Exception as ex:
                logging.error(f"Failed to mark correction {c_id} as synced: {ex}")

        # Delete session
        await ingestion_service._finance_api_service.delete_runbook_session_async(user_id)

        return func.HttpResponse(json.dumps({"success": True}), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error approving runbook review: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")

# ── Function 16: DiscardRunbookReviewFunction ────────────────────────────────
@app.route(route="runbook/review/discard", methods=["POST"])
async def DiscardRunbookReviewFunction(req: func.HttpRequest) -> func.HttpResponse:
    """Deletes the active review session without applying any changes."""
    user, err = _require_auth(req)
    if err: return err

    user_id = user.get("sub", "default")
    ingestion_service = get_ingestion_service()
    try:
        await ingestion_service._finance_api_service.delete_runbook_session_async(user_id)
        return func.HttpResponse(json.dumps({"success": True}), status_code=200, mimetype="application/json")
    except Exception as e:
        logging.error(f"Error discarding runbook session: {e}")
        return func.HttpResponse(json.dumps({"error": str(e)}), status_code=500, mimetype="application/json")


# ── Function 18: CheckEmailManualFunction ─────────────────────────────────────
@app.route(route="email/check", methods=["POST"])
async def CheckEmailManualFunction(req: func.HttpRequest) -> func.HttpResponse:
    user, err = _require_auth(req)
    if err: return err

    logging.info("Manual check for unread emails triggered.")
    try:
        saved_count = await check_and_save_emails_async()
        return func.HttpResponse(json.dumps({"success": True, "count": saved_count}), status_code=200, mimetype="application/json")
    except Exception as ex:
        logging.error(f"Error in manual email check: {ex}")
        return func.HttpResponse(json.dumps({"error": str(ex)}), status_code=500, mimetype="application/json")


# ── Function 17: EmailTimerTriggerFunction ───────────────────────────────────
@app.timer_trigger(schedule="0 32 */3 * * *", arg_name="myTimer", run_on_startup=False, use_monitor=False)
def timer_trigger(myTimer: func.TimerRequest) -> None:
    if myTimer.past_due:
        logging.info('The timer is past due!')

    logging.info("Checking for unread emails...")
    try:
        import asyncio
        saved_count = asyncio.run(check_and_save_emails_async())
        logging.info(f"Timer trigger processed emails. Saved {saved_count} new hooks.")
    except Exception as ex:
        logging.error(f"Error in email timer trigger: {ex}")
        
    logging.info('Python timer trigger function executed.')


