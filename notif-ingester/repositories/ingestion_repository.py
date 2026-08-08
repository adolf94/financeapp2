from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime, timezone
from azure.cosmos.aio import CosmosClient
from models.pending_ingestion import PendingIngestion
import os

class IIngestionRepository(ABC):
    @abstractmethod
    async def add_async(self, ingestion: PendingIngestion) -> PendingIngestion:
        pass

    @abstractmethod
    async def get_by_id_async(self, id: str, user_id: str) -> Optional[PendingIngestion]:
        pass

    @abstractmethod
    async def get_by_status_async(self, user_id: str, status: str, skip: int = 0, top: int = 50) -> list[PendingIngestion]:
        pass

    @abstractmethod
    async def update_async(self, ingestion: PendingIngestion) -> None:
        pass

from repositories.cosmos_client import get_cosmos_client

class CosmosIngestionRepository(IIngestionRepository):
    def __init__(self):
        self.client = get_cosmos_client()
        self.db_name = os.environ.get("COSMOS_DB", "FinanceDb")
        self.container_name = "PendingIngestions"

    async def _get_container(self):
        db = self.client.get_database_client(self.db_name)
        return db.get_container_client(self.container_name)

    async def add_async(self, ingestion: PendingIngestion) -> PendingIngestion:
        container = await self._get_container()
        await container.upsert_item(ingestion.model_dump(by_alias=True, mode="json"))
        return ingestion

    async def get_by_id_async(self, id: str, user_id: str) -> Optional[PendingIngestion]:
        container = await self._get_container()
        try:
            item = await container.read_item(item=id, partition_key=user_id)
            return PendingIngestion(**item)
        except Exception:
            return None

    async def get_by_status_async(self, user_id: str, status: str, skip: int = 0, top: int = 50) -> list[PendingIngestion]:
        container = await self._get_container()
        query = (
            "SELECT * FROM c "
            "WHERE c.UserId = @user_id AND c.status = @status"
        )
        parameters = [
            {"name": "@user_id", "value": user_id},
            {"name": "@status", "value": status}
        ]
        items = container.query_items(
            query=query,
            parameters=parameters
        )
        results = []
        async for item in items:
            results.append(PendingIngestion(**item))

        def get_sort_key(item: PendingIngestion) -> datetime:
            val = item.raw_payload.get("timestamp")
            if val is not None:
                try:
                    if isinstance(val, str) and val.isdigit():
                        val = float(val)
                    if isinstance(val, (int, float)):
                        if val > 30000000000:
                            return datetime.fromtimestamp(val / 1000, tz=timezone.utc)
                        else:
                            return datetime.fromtimestamp(val, tz=timezone.utc)
                    elif isinstance(val, str):
                        dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        return dt
                except Exception:
                    pass

            if item.ai_parsed and item.ai_parsed.date:
                dt = item.ai_parsed.date
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt

            dt = item.received_at
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt

        results.sort(key=get_sort_key, reverse=True)
        return results[skip : skip + top]

    async def update_async(self, ingestion: PendingIngestion) -> None:
        container = await self._get_container()
        await container.upsert_item(ingestion.model_dump(by_alias=True, mode="json"))
