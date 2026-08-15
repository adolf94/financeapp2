"""
SmsProcessingService
--------------------
Subclass of IngestionService that overrides classification to use SMS-specific
prompts and the separate 'runbook-sms' CosmosDB document.

Key differences from the base IngestionService (App pipeline):
- _get_runbook_id()     → returns 'runbook-sms' (separate CosmosDB document)
- _classify_hook_async() → calls ai_service.classify_sms_async()
- _get_default_runbook() → loads the bundled sms_runbook.md template
- Auto-confirm threshold → SMS_AUTO_CONFIRM_THRESHOLD env var (default 0.95)
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


class SmsProcessingService(IngestionService):
    """Ingestion pipeline tailored for SMS banking notifications."""

    RUNBOOK_ID = "runbook-sms"

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
        # Use centralized auto-confirm threshold
        self._auto_confirm_threshold = float(
            os.environ.get("AUTO_CONFIRM_THRESHOLD", "0.95")
        )

    # -- Overrides ---------------------------------------------------------------

    def _get_runbook_id(self) -> str:
        """Use the dedicated SMS runbook document."""
        return self.RUNBOOK_ID

    async def _classify_hook_async(
        self,
        hook: PhoneHookMessage,
        similar_vectors,
        accounts,
        runbook_content,
        vendors,
        vendor_matches,
        operation_id: str = None,
        connection_id: str = None,
        stream_reasoning: bool = True,
        exchange_rate_info: str = "",
        user_corrections: Optional[dict] = None
    ) -> 'AiParsedData':
        """Classify SMS hook with specialized prompt."""
        return await self._ai_service.classify_sms_async(
            hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id=operation_id, connection_id=connection_id, stream_reasoning_to_client=stream_reasoning, exchange_rate_info=exchange_rate_info, user_corrections=user_corrections
        )

    def get_default_sms_runbook_content(self) -> str:
        """Load the bundled sms_runbook.md template as the default SMS runbook."""
        runbook_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "runbooks",
            "sms_runbook.md"
        )
        try:
            with open(runbook_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            logging.warning("[SmsProcessingService] sms_runbook.md not found; using empty runbook.")
            return "# SMS Classification Rules\n\nNo SMS-specific rules defined yet.\n"

    async def _get_or_bootstrap_sms_runbook(self, user_id: str) -> str:
        """
        Fetch the SMS runbook from CosmosDB.
        If it doesn't exist yet, bootstrap it from the bundled template and persist it
        so the user can edit it from the Settings UI.
        """
        content = await self._finance_api_service.get_runbook_content_async(
            user_id, runbook_id=self.RUNBOOK_ID
        )
        if not content:
            logging.info("[SmsProcessingService] No SMS runbook found — bootstrapping from template.")
            content = self.get_default_sms_runbook_content()
            await self._finance_api_service.save_runbook_content_async(
                user_id, content, runbook_id=self.RUNBOOK_ID
            )
        return content

    async def process_hook_async(self, hook: PhoneHookMessage):
        """Override to bootstrap the SMS runbook on first use, then delegate to base."""
        # Pre-fetch (and potentially create) the SMS runbook so the base class sees it
        await self._get_or_bootstrap_sms_runbook(hook.user_id)
        return await super().process_hook_async(hook)

