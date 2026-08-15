"""
ImageProcessingService
----------------------
Subclass of IngestionService tailored for multimodal image receipts, statements, and invoices.
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid_extensions import uuid7
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import PendingIngestion, AiParsedData, AiVendorInfo
from services.ingestion_service import IngestionService


from repositories.ingestion_repository import IIngestionRepository
from services.embedding_service import EmbeddingService
from services.vector_service import VectorService
from services.ai_service import AiService
from services.finance_api_service import FinanceApiService
from services.blob_storage_service import BlobStorageService
from services.preprocessing_service import PreprocessingService
from services.signalr_publisher import publish_signalr_message


logger = logging.getLogger(__name__)


class ImageProcessingService(IngestionService):
    """Ingestion pipeline tailored for receipt and financial statement images."""

    RUNBOOK_ID = "runbook-image"

    def __init__(
        self,
        ingestion_repo: IIngestionRepository,
        embedding_service: EmbeddingService,
        vector_service: VectorService,
        ai_service: AiService,
        finance_api_service: FinanceApiService,
        blob_storage_service: Optional[BlobStorageService] = None,
    ):
        super().__init__(
            ingestion_repo=ingestion_repo,
            embedding_service=embedding_service,
            vector_service=vector_service,
            ai_service=ai_service,
            finance_api_service=finance_api_service,
        )
        self._blob_storage = blob_storage_service or BlobStorageService()

    def _get_runbook_id(self) -> str:
        return self.RUNBOOK_ID

    def get_default_image_runbook_content(self) -> str:
        """Load bundled image_runbook.md template."""
        runbook_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "runbooks",
            "image_runbook.md"
        )
        try:
            with open(runbook_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            logger.warning("[ImageProcessingService] image_runbook.md not found; using empty runbook.")
            return "# Image Classification Rules\n\nNo image-specific rules defined yet.\n"

    async def _get_or_bootstrap_image_runbook(self, user_id: str) -> str:
        content = await self._finance_api_service.get_runbook_content_async(
            user_id, runbook_id=self.RUNBOOK_ID
        )
        if not content:
            logger.info("[ImageProcessingService] No Image runbook found — bootstrapping from template.")
            content = self.get_default_image_runbook_content()
            await self._finance_api_service.save_runbook_content_async(
                user_id, content, runbook_id=self.RUNBOOK_ID
            )
        return content

    async def process_hook_async(self, hook: PhoneHookMessage) -> PendingIngestion:
        """Process an image notification hook triggered from CosmosDB Change Feed."""
        payload = hook.raw_payload or {}
        blob_name = payload.get("blob_name")
        blob_url = payload.get("image_url", "")
        filename = payload.get("filename", "receipt.png")
        mime_type = payload.get("format", "image/png")
        description = payload.get("description")
        operation_id = payload.get("operation_id")
        connection_id = payload.get("connection_id")
        stream_reasoning = payload.get("stream_reasoning", True)

        image_bytes = None
        if blob_name:
            try:
                image_bytes, mime_type = await self._blob_storage.download_image_async(blob_name)
            except Exception as e:
                logger.error(f"[ImageProcessingService] Failed downloading blob '{blob_name}': {e}")

        if not image_bytes:
            raise ValueError(f"No image content available for hook {hook.id}")

        return await self.process_image_async(
            image_bytes=image_bytes,
            mime_type=mime_type,
            filename=filename,
            user_id=hook.user_id,
            operation_id=operation_id,
            connection_id=connection_id,
            ingestion_id=hook.id,
            stream_reasoning=stream_reasoning,
            description=description,
            blob_name=blob_name,
            blob_url=blob_url,
        )

    async def process_image_async(
        self,
        image_bytes: bytes,
        mime_type: str,
        filename: str,
        user_id: str,
        operation_id: Optional[str] = None,
        connection_id: Optional[str] = None,
        ingestion_id: Optional[str] = None,
        stream_reasoning: bool = True,
        description: Optional[str] = None,
        user_corrections: Optional[dict] = None,
        blob_name: Optional[str] = None,
        blob_url: Optional[str] = None,
    ) -> PendingIngestion:
        """Process an uploaded receipt or invoice image end-to-end."""
        target_id = ingestion_id or str(uuid7())
        now = datetime.now(timezone.utc)
        month_key = now.strftime("%Y-%m")

        logger.info(f"[ImageProcessingService] Processing image '{filename}' for user '{user_id}' (ingestion_id={target_id})")

        # 1. Upload to Blob Storage if not already uploaded
        resolved_blob_name = blob_name or ""
        resolved_blob_url = blob_url or ""
        if not resolved_blob_name:
            try:
                resolved_blob_name, resolved_blob_url = await self._blob_storage.upload_image_async(
                    image_bytes=image_bytes,
                    user_id=user_id,
                    ingestion_id=target_id,
                    filename=filename,
                    mime_type=mime_type,
                )
            except Exception as e:
                logger.error(f"[ImageProcessingService] Blob upload warning: {e}")


    async def _preprocess_image_and_find_vendor_matches_async(
        self,
        image_bytes: bytes,
        mime_type: str,
        filename: str,
        description: str,
        user_id: str,
    ) -> tuple[list[dict], str, str, dict]:
        """Pass 1: Pre-process image via fast OCR + filename heuristics to find matching database vendors."""
        import re
        local_lookups = PreprocessingService.extract_image_lookups(filename, description)
        inferred_app = PreprocessingService.extract_application_from_filename(filename) or ""
        app_source = "filename" if inferred_app else ""
        
        extracted_info = {}
        try:
            extracted_info = await self._ai_service.extract_image_info_async(
                image_bytes=image_bytes,
                mime_type=mime_type,
                filename=filename,
                description=description,
            )
        except Exception as e:
            logger.warning(f"[ImageProcessingService] OCR pre-extraction warning: {e}")

        candidate_lookups = list(local_lookups)
        if extracted_info:
            candidate_lookups.extend(extracted_info.get("account_numbers", []))
            candidate_lookups.extend(extracted_info.get("account_names", []))
            candidate_lookups.extend(extracted_info.get("potential_vendor_names", []))
            if not inferred_app and extracted_info.get("application"):
                inferred_app = extracted_info.get("application")
                app_source = extracted_info.get("appname_source") or "ocr"
            if inferred_app:
                candidate_lookups.append(inferred_app)

        normalized = []
        for loc in candidate_lookups:
            if not loc or not isinstance(loc, str):
                continue
            cleaned = loc.strip()
            normalized.append(cleaned)
            num_clean = re.sub(r'[\s\-]+', '', cleaned)
            if num_clean != cleaned:
                normalized.append(num_clean)
            if num_clean.startswith("09") and len(num_clean) == 11:
                normalized.append(num_clean[1:])
                normalized.append("+63" + num_clean[1:])
            elif num_clean.startswith("+639") and len(num_clean) == 13:
                normalized.append("0" + num_clean[3:])
                normalized.append(num_clean[3:])

        unique_lookups = list(dict.fromkeys(normalized))
        
        vendor_matches = await self._finance_api_service.search_all_vendor_matches_by_lookups_async(
            user_id, unique_lookups
        )
        return vendor_matches, inferred_app, app_source, extracted_info

    async def process_image_async(
        self,
        image_bytes: bytes,
        mime_type: str,
        filename: str,
        user_id: str,
        operation_id: str = None,
        connection_id: str = None,
        ingestion_id: str = None,
        stream_reasoning: bool = True,
        user_corrections: Optional[dict] = None,
        description: str = None,
        blob_name: str = None,
        blob_url: str = None,
    ) -> PendingIngestion:
        now = datetime.now(timezone.utc)
        month_key = now.strftime("%Y-%m")
        target_id = ingestion_id or str(uuid7())

        logger.info(f"[ImageProcessingService] Processing image '{filename}' for user '{user_id}' (ingestion_id={target_id})")

        # 1. Upload to Blob Storage if not already uploaded
        resolved_blob_name = blob_name or ""
        resolved_blob_url = blob_url or ""
        if not resolved_blob_name:
            try:
                resolved_blob_name, resolved_blob_url = await self._blob_storage.upload_image_async(
                    image_bytes=image_bytes,
                    user_id=user_id,
                    ingestion_id=target_id,
                    filename=filename,
                    mime_type=mime_type,
                )
            except Exception as e:
                logger.error(f"[ImageProcessingService] Blob upload warning: {e}")


        # 2. Fetch runbook, accounts, and vendors
        runbook_content = await self._get_or_bootstrap_image_runbook(user_id)
        accounts = await self._finance_api_service.get_accounts_async(user_id)
        vendors = await self._finance_api_service.get_vendors_async(user_id)

        # 3. Pass 1: Pre-process OCR & lookup database vendor matches
        vendor_matches, inferred_app, app_source, _ = await self._preprocess_image_and_find_vendor_matches_async(
            image_bytes=image_bytes,
            mime_type=mime_type,
            filename=filename,
            description=description or "",
            user_id=user_id,
        )

        # Merge user description into corrections if provided
        corrections = user_corrections or {}
        if description and not corrections.get("comment"):
            corrections["comment"] = description

        # 4. Pass 2: Classify image with multimodal AI with vendor match context
        ai_parsed: AiParsedData = await self._ai_service.classify_image_async(
            image_bytes=image_bytes,
            mime_type=mime_type,
            similar_vectors=[],
            accounts=accounts,
            runbook_content=runbook_content,
            vendors=vendors,
            vendor_matches=vendor_matches,
            filename=filename,
            description=description or "",
            inferred_app=inferred_app,
            app_source=app_source,
            user_id=user_id,
            operation_id=operation_id,
            connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning,
            user_corrections=corrections if corrections else None,
        )


        # 5. Map lookups and vendor matching
        lookups = self._build_lookups(ai_parsed, accounts)
        await self._apply_vendor_matching(ai_parsed, vendors, accounts, lookups, user_id)

        # 6. Build raw payload and metadata
        raw_msg = f"[IMAGE]: {ai_parsed.summary or description or filename}"
        raw_payload = {
            "filename": filename,
            "format": mime_type,
            "file_size": len(image_bytes),
            "blob_name": resolved_blob_name,
            "image_url": resolved_blob_url,
            "uploaded_at": now.isoformat(),
            "notif_title": filename,
            "description": description or "",
        }


        ingestion = PendingIngestion(
            id=target_id,
            user_id=user_id,
            hook_id=target_id,
            received_at=now,
            raw_payload=raw_payload,
            raw_msg=raw_msg,
            ai_parsed=ai_parsed,
            similarity_score=ai_parsed.confidence or 0.0,
            top_matches=[],
            status="NonFinancial" if ai_parsed.is_financial is False else "Pending",
            month_key=month_key,
            partition_key=user_id,
            notification_type="image",
        )

        if ai_parsed.is_financial is False:
            ingestion.ttl = 7 * 24 * 60 * 60  # 7 days

        # 7. Save to CosmosDB
        saved_ingestion = await self._repo.add_async(ingestion)

        # 8. SignalR broadcast completion if operation_id provided
        if operation_id:
            try:
                ingestion_dict = saved_ingestion.model_dump(by_alias=True, mode="json")
                await publish_signalr_message(
                    "notificationHub",
                    "reclassifyComplete",
                    [ingestion_dict, operation_id],
                    user_id=user_id,
                    group_name=operation_id,
                )
            except Exception as e:
                logger.warning(f"[ImageProcessingService] SignalR broadcast failed: {e}")

        return saved_ingestion

    async def reclassify_ingestion_async(
        self,
        ingestion_id: str,
        user_id: str,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning: bool = True,
        user_corrections: Optional[dict] = None,
    ) -> PendingIngestion:
        """Re-classify an image ingestion, downloading the original image if available."""
        ingestion = await self._repo.get_by_id_async(ingestion_id, user_id)
        if not ingestion:
            raise ValueError("Ingestion not found")

        blob_name = ingestion.raw_payload.get("blob_name")
        image_bytes = None
        mime_type = ingestion.raw_payload.get("format", "image/png")

        if blob_name:
            try:
                image_bytes, mime_type = await self._blob_storage.download_image_async(blob_name)
            except Exception as e:
                logger.warning(f"[ImageProcessingService] Could not download image blob for reclassification: {e}")

        if image_bytes:
            runbook_content = await self._get_or_bootstrap_image_runbook(user_id)
            accounts = await self._finance_api_service.get_accounts_async(user_id)
            vendors = await self._finance_api_service.get_vendors_async(user_id)
            reclassify_filename = ingestion.raw_payload.get("filename", "") if ingestion.raw_payload else ""
            reclassify_desc = ingestion.raw_payload.get("description", "") if ingestion.raw_payload else ""

            vendor_matches, inferred_app, app_source, _ = await self._preprocess_image_and_find_vendor_matches_async(
                image_bytes=image_bytes,
                mime_type=mime_type,
                filename=reclassify_filename,
                description=reclassify_desc,
                user_id=user_id,
            )

            ai_parsed = await self._ai_service.classify_image_async(
                image_bytes=image_bytes,
                mime_type=mime_type,
                similar_vectors=[],
                accounts=accounts,
                runbook_content=runbook_content,
                vendors=vendors,
                vendor_matches=vendor_matches,
                filename=reclassify_filename,
                description=reclassify_desc,
                inferred_app=inferred_app,
                app_source=app_source,
                user_id=user_id,
                operation_id=operation_id,
                connection_id=connection_id,
                stream_reasoning_to_client=stream_reasoning,
                user_corrections=user_corrections,
            )




            lookups = self._build_lookups(ai_parsed, accounts)
            await self._apply_vendor_matching(ai_parsed, vendors, accounts, lookups, user_id)

            ingestion.ai_parsed = ai_parsed
            ingestion.status = "Pending"
            await self._repo.update_async(ingestion)
            return ingestion

        # Fallback to text reclassification if image bytes cannot be fetched
        return await super().reclassify_ingestion_async(
            ingestion_id=ingestion_id,
            user_id=user_id,
            operation_id=operation_id,
            connection_id=connection_id,
            stream_reasoning=stream_reasoning,
            user_corrections=user_corrections,
        )
