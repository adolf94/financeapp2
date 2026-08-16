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
    async def find_candidates_for_relation_async(self, user_id: str, days_lookback: int = 30) -> list[PendingIngestion]:
        pass

    @abstractmethod
    async def find_by_amount_and_time_async(self, user_id: str, amount: float, around_time, window_minutes: int = 5) -> list[PendingIngestion]:
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

    async def find_candidates_for_relation_async(self, user_id: str, days_lookback: int = 30) -> list[PendingIngestion]:
        container = await self._get_container()
        # Query items for this user within the lookback window or currently pending
        cutoff = datetime.now(timezone.utc).timestamp() - (days_lookback * 24 * 60 * 60)
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
        
        query = (
            "SELECT * FROM c "
            "WHERE c.UserId = @user_id AND (c.received_at >= @cutoff OR c.status = 'Pending')"
        )
        parameters = [
            {"name": "@user_id", "value": user_id},
            {"name": "@cutoff", "value": cutoff_iso}
        ]
        items = container.query_items(
            query=query,
            parameters=parameters
        )
        results = []
        async for item in items:
            try:
                results.append(PendingIngestion(**item))
            except Exception:
                pass
        return results

    async def find_by_amount_and_time_async(self, user_id: str, amount: float, around_time, window_minutes: int = 5) -> list[PendingIngestion]:
        from datetime import timedelta
        if isinstance(around_time, str):
            try:
                around_dt = datetime.fromisoformat(around_time.replace("Z", "+00:00"))
            except Exception:
                around_dt = datetime.now(timezone.utc)
        elif isinstance(around_time, datetime):
            around_dt = around_time
        else:
            around_dt = datetime.now(timezone.utc)

        if around_dt.tzinfo is None:
            around_dt = around_dt.replace(tzinfo=timezone.utc)

        min_dt_iso = (around_dt - timedelta(minutes=window_minutes)).isoformat()
        max_dt_iso = (around_dt + timedelta(minutes=window_minutes)).isoformat()

        container = await self._get_container()
        query = (
            "SELECT * FROM c "
            "WHERE c.UserId = @user_id AND c.received_at >= @min_time AND c.received_at <= @max_time"
        )
        parameters = [
            {"name": "@user_id", "value": user_id},
            {"name": "@min_time", "value": min_dt_iso},
            {"name": "@max_time", "value": max_dt_iso}
        ]
        items = container.query_items(
            query=query,
            parameters=parameters
        )
        results = []
        target_amount = round(abs(float(amount)), 2)
        async for item in items:
            try:
                ing = PendingIngestion(**item)
                cand_amount = ing.ai_parsed.amount if ing.ai_parsed else None
                if cand_amount is not None and round(abs(float(cand_amount)), 2) == target_amount:
                    results.append(ing)
            except Exception:
                pass
        return results

    async def update_async(self, ingestion: PendingIngestion) -> None:
        container = await self._get_container()
        await container.upsert_item(ingestion.model_dump(by_alias=True, mode="json"))
