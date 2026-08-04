import logging
import os
from abc import ABC, abstractmethod
from models.prompt_debug_log import PromptDebugLog
from azure.cosmos.aio import CosmosClient

logger = logging.getLogger(__name__)


class IPromptDebugRepository(ABC):
    @abstractmethod
    async def add_async(self, log: PromptDebugLog) -> None:
        pass


class CosmosPromptDebugRepository(IPromptDebugRepository):
    def __init__(self):
        self.endpoint = os.environ.get("CosmosConnectionString", "")
        self.client = CosmosClient.from_connection_string(self.endpoint)
        self.db_name = os.environ.get("COSMOS_DB", "FinanceDb")
        self.container_name = "PromptDebugLogs"

    async def _get_container(self):
        db = self.client.get_database_client(self.db_name)
        return db.get_container_client(self.container_name)

    async def add_async(self, log: PromptDebugLog) -> None:
        try:
            container = await self._get_container()
            await container.upsert_item(log.model_dump(by_alias=True, mode="json"))
        except Exception as e:
            logger.warning("PromptDebugRepository: failed to persist log — %s", e)


class NoOpPromptDebugRepository(IPromptDebugRepository):
    """Used when PROMPT_DEBUG is off — swallows all writes."""
    async def add_async(self, log: PromptDebugLog) -> None:
        pass
