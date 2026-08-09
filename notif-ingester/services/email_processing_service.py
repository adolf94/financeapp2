"""
EmailProcessingService
----------------------
Subclass of IngestionService that overrides classification to use Email-specific
prompts and the separate 'runbook-email' CosmosDB document.
"""

import os
import logging
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import AiParsedData
from services.ingestion_service import IngestionService
from repositories.ingestion_repository import IIngestionRepository
from services.embedding_service import EmbeddingService
from services.vector_service import VectorService
from services.ai_service import AiService
from services.finance_api_service import FinanceApiService


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

    # -- Overrides ---------------------------------------------------------------

    def _get_runbook_id(self) -> str:
        """Use the dedicated email runbook document."""
        return self.RUNBOOK_ID

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
        stream_reasoning: bool = True
    ) -> AiParsedData:
        """Use the Email-specific classification prompt."""
        return await self._ai_service.classify_email_async(
            hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches, operation_id=operation_id, connection_id=connection_id, stream_reasoning_to_client=stream_reasoning
        )

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

    async def process_hook_async(self, hook: PhoneHookMessage):
        """Override to bootstrap the Email runbook on first use, then delegate to base."""
        await self._get_or_bootstrap_email_runbook(hook.user_id)
        ingestion = await super().process_hook_async(hook)
        if ingestion and ingestion.ai_parsed and ingestion.ai_parsed.summary:
            ingestion.raw_msg = f"[EMAIL]: {ingestion.ai_parsed.summary}"
            await self.ingestion_repo.update_async(ingestion)
        return ingestion
