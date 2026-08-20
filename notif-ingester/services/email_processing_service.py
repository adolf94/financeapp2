"""
EmailProcessingService
----------------------
Subclass of IngestionService that overrides classification to use Email-specific
prompts and the separate 'runbook-email' CosmosDB document.
"""

import os
import logging
from typing import Optional
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import AiParsedData
from services.ingestion_service import IngestionService
from repositories.ingestion_repository import IIngestionRepository
from services.embedding_service import EmbeddingService
from services.vector_service import VectorService
from services.ai_service import AiService
from services.finance_api_service import FinanceApiService
from services.signalr_publisher import publish_signalr_message



class EmailProcessingService(IngestionService):
    """Ingestion pipeline tailored for email receipts and banking statements."""

    RUNBOOK_ID = "runbook-email"

    def __init__(
        self,
        ingestion_repo: IIngestionRepository,
        embedding_service: EmbeddingService,
        vector_service: VectorService,
        ai_service: AiService,
        finance_api_service: FinanceApiService
    ):
        super().__init__(
            ingestion_repo=ingestion_repo,
            embedding_service=embedding_service,
            vector_service=vector_service,
            ai_service=ai_service,
            finance_api_service=finance_api_service
        )
        self._auto_confirm_threshold = float(
            os.environ.get("AUTO_CONFIRM_THRESHOLD", "0.95")
        )

    def _get_runbook_id(self) -> str:
        """Use the dedicated email runbook document."""
        return self.RUNBOOK_ID

    def _use_is_financial_gate(self) -> bool:
        """Emails are inherently financial; skip fast gate."""
        return False

    def _get_relation_window_minutes(self) -> float:
        """Emails lag behind payments (e.g. order confirmation); widen amount-only relation window to 60m."""
        return 60.0

    def _is_shopee_email(self, hook: PhoneHookMessage) -> bool:
        """Check if an incoming email hook is from Shopee."""
        sender = (hook.raw_payload.get("sender") or "").lower()
        from_hdr = (hook.raw_payload.get("from") or hook.raw_payload.get("From") or "").lower()
        subject = (hook.raw_payload.get("subject") or "").lower()
        body = (hook.raw_payload.get("markdown_content") or hook.raw_payload.get("body") or hook.raw_msg or "").lower()

        return "shopee" in sender or "shopee" in from_hdr or "shopee" in subject or "shopee.ph" in body

    async def _classify_hook_async(
        self,
        hook,
        similar_vectors,
        accounts,
        runbook_content,
        vendors,
        vendor_matches,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning: bool = True,
        exchange_rate_info: str = "",
        user_corrections: Optional[dict] = None,
        related_context: str = "",
        extracted_info = None
    ) -> AiParsedData:
        """Route to multi-order prompt if multi-order detected during precheck, otherwise standard Email prompt."""
        is_multi_order = extracted_info.is_multi_order if extracted_info and hasattr(extracted_info, "is_multi_order") else False

        if self._is_shopee_email(hook) and is_multi_order:
            # Multi-order Shopee checkout -> dedicated multi-order extraction prompt
            shopee_runbook = self.get_shopee_runbook_content()
            combined_runbook = f"{runbook_content}\n\n{shopee_runbook}" if shopee_runbook else runbook_content
            return await self._ai_service.classify_email_shopee_async(
                hook, similar_vectors, accounts, combined_runbook, vendors, vendor_matches,
                operation_id=operation_id, connection_id=connection_id,
                stream_reasoning_to_client=stream_reasoning, exchange_rate_info=exchange_rate_info,
                user_corrections=user_corrections, related_context=related_context
            )

        return await self._ai_service.classify_email_async(
            hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches,
            operation_id=operation_id, connection_id=connection_id,
            stream_reasoning_to_client=stream_reasoning, exchange_rate_info=exchange_rate_info,
            user_corrections=user_corrections, related_context=related_context
        )

    def get_shopee_runbook_content(self) -> str:
        """Load the bundled shopee_email_runbook.md template."""
        runbook_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "runbooks",
            "shopee_email_runbook.md"
        )
        try:
            with open(runbook_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def get_default_email_runbook_content(self) -> str:
        """Load the bundled email_runbook.md template as the default Email runbook."""
        runbook_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "runbooks",
            "email_runbook.md"
        )
        try:
            with open(runbook_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            logging.warning("[EmailProcessingService] email_runbook.md not found; using empty runbook.")
            return "# Email Classification Rules\n\nNo Email-specific rules defined yet.\n"

    async def _get_or_bootstrap_email_runbook(self, user_id: str) -> str:
        """
        Fetch the Email runbook from CosmosDB.
        If it doesn't exist yet, bootstrap it from the bundled template and persist it.
        """
        content = await self._finance_api_service.get_runbook_content_async(
            user_id, runbook_id=self.RUNBOOK_ID
        )
        if not content:
            logging.info("[EmailProcessingService] No Email runbook found — bootstrapping from template.")
            content = self.get_default_email_runbook_content()
            await self._finance_api_service.save_runbook_content_async(
                user_id, content, runbook_id=self.RUNBOOK_ID
            )
        return content

    async def _resolve_source_account_async(self, total_amount: float, email_timestamp, user_id: str, shopee_ingestion_id: str) -> tuple[Optional[str], Optional[str]]:
        """
        Query repository for matching SMS/app notification candidates within 5 minutes of email send time.
        Returns (credit_account_id, matched_candidate_id).
        """
        if not total_amount or not email_timestamp:
            return None, None

        # 1. Search pending/recent candidate ingestions in repo
        candidates = await self.ingestion_repo.find_by_amount_and_time_async(
            user_id=user_id,
            amount=total_amount,
            around_time=email_timestamp,
            window_minutes=5
        )

        for cand in candidates:
            if cand.id == shopee_ingestion_id:
                continue
            cand_credit_acc = cand.ai_parsed.credit_account_id if cand.ai_parsed else None
            if cand_credit_acc:
                # Backport link to the matched candidate
                cand_possible = set(cand.possible_related_ingestion_ids or [])
                if shopee_ingestion_id not in cand_possible:
                    cand_possible.add(shopee_ingestion_id)
                    cand.possible_related_ingestion_ids = list(cand_possible)
                    try:
                        await self.ingestion_repo.update_async(cand)
                    except Exception as e:
                        logging.warning(f"[EmailProcessingService] Failed to backport link to candidate {cand.id}: {e}")
                return cand_credit_acc, cand.id

        # 2. Check confirmed ledger entries
        confirmed_matches = await self._finance_api_service.search_confirmed_ledger_entries_async(
            user_id=user_id,
            amount=total_amount,
            around_time=email_timestamp,
            window_minutes=5
        )
        if confirmed_matches:
            # Found confirmed transaction match
            return None, None

        return None, None

    async def process_hook_async(self, hook: PhoneHookMessage):
        """Override to bootstrap the Email runbook, process multi-order if applicable, and resolve source accounts."""
        await self._get_or_bootstrap_email_runbook(hook.user_id)
        ingestion = await super().process_hook_async(hook)
        if not ingestion:
            return ingestion

        # Check for Shopee multi-order or Shopee single order requiring source credit account resolution
        if self._is_shopee_email(hook) and ingestion.ai_parsed and ingestion.ai_parsed.amount:
            eff_time = self._extract_effective_time(ingestion)
            resolved_credit_acc, matched_cand_id = await self._resolve_source_account_async(
                total_amount=ingestion.ai_parsed.amount,
                email_timestamp=eff_time,
                user_id=hook.user_id,
                shopee_ingestion_id=ingestion.id
            )
            if resolved_credit_acc:
                ingestion.ai_parsed.credit_account_id = resolved_credit_acc
            if matched_cand_id:
                possible_ids = set(ingestion.possible_related_ingestion_ids or [])
                possible_ids.add(matched_cand_id)
                ingestion.possible_related_ingestion_ids = list(possible_ids)

        if ingestion.ai_parsed and ingestion.ai_parsed.summary:
            ingestion.raw_msg = f"[EMAIL]: {ingestion.ai_parsed.summary}"
        
        await self.ingestion_repo.update_async(ingestion)

        # Broadcast SignalR completion with ingestion details
        try:
            ingestion_dict = ingestion.model_dump(by_alias=True, mode="json")
            await publish_signalr_message(
                "notificationHub",
                "reclassifyComplete",
                [ingestion_dict, hook.id],
                user_id=hook.user_id,
            )
            logging.info(f"[EmailProcessingService] Broadcasted reclassifyComplete to user {hook.user_id} for ingestion {ingestion.id}")
        except Exception as e:
            logging.warning(f"[EmailProcessingService] SignalR broadcast failed: {e}")

        return ingestion

