from abc import ABC, abstractmethod
from typing import Optional
from azure.cosmos.aio import CosmosClient
from models.phone_hook import PhoneHookMessage
import os

class IHookRepository(ABC):
    @abstractmethod
    async def add_async(self, msg: PhoneHookMessage) -> PhoneHookMessage:
        pass

    @abstractmethod
    async def get_by_notif_id_async(self, notif_id: str, month_key: str) -> Optional[PhoneHookMessage]:
        pass

    @abstractmethod
    async def get_by_id_async(self, id: str, user_id: str) -> Optional[PhoneHookMessage]:
        pass

    @abstractmethod
    async def get_by_status_async(self, user_id: str, status: str, skip: int = 0, top: int = 50) -> list[PhoneHookMessage]:
        pass

    @abstractmethod
    async def update_status_async(self, id: str, status: str, user_id: str) -> None:
        pass

    @abstractmethod
    async def delete_async(self, id: str, user_id: str) -> bool:
        pass

from repositories.cosmos_client import get_cosmos_client

class CosmosHookRepository(IHookRepository):
    def __init__(self):
        self.client = get_cosmos_client()
        self.db_name = os.environ.get("COSMOS_DB", "FinanceDb")
        self.container_name = "PhoneHookMessages"

    async def _get_container(self):
        db = self.client.get_database_client(self.db_name)
        return db.get_container_client(self.container_name)

    async def add_async(self, msg: PhoneHookMessage) -> PhoneHookMessage:
        container = await self._get_container()
        await container.upsert_item(msg.model_dump(by_alias=True, mode="json"))
        return msg

    async def get_by_notif_id_async(self, notif_id: str, month_key: str) -> Optional[PhoneHookMessage]:
        container = await self._get_container()
        query = "SELECT * FROM c WHERE c.raw_payload.notif_id = @notif_id"
        parameters = [{"name": "@notif_id", "value": notif_id}]
        
        items = container.query_items(
            query=query,
            parameters=parameters,
            partition_key="3575cfa0-ec94-40d2-8b25-ee9f0f135027"
        )
        async for item in items:
            return PhoneHookMessage(**item)
        return None

    async def get_by_id_async(self, id: str, user_id: str) -> Optional[PhoneHookMessage]:
        container = await self._get_container()
        for pk in [user_id, "default"]:
            try:
                item = await container.read_item(item=id, partition_key=pk)
                return PhoneHookMessage(**item)
            except Exception:
                pass

        try:
            query = "SELECT * FROM c WHERE c.id = @id"
            items = container.query_items(
                query=query,
                parameters=[{"name": "@id", "value": id}],
                enable_cross_partition_query=True
            )
            async for doc in items:
                return PhoneHookMessage(**doc)
        except Exception as e:
            logging.error(f"[CosmosHookRepository] Failed to get hook {id}: {e}")
        return None

    async def get_by_status_async(self, user_id: str, status: str, skip: int = 0, top: int = 50) -> list[PhoneHookMessage]:
        container = await self._get_container()
        query = "SELECT * FROM c WHERE (c.UserId = @user_id OR c.userId = @user_id OR c.user_id = @user_id OR c.UserId = 'default' OR c.userId = 'default') AND c.status = @status"
        parameters = [
            {"name": "@user_id", "value": user_id},
            {"name": "@status", "value": status}
        ]
        items = container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=True
        )
        results = []
        async for item in items:
            try:
                results.append(PhoneHookMessage(**item))
            except Exception:
                pass

        results.sort(key=lambda h: h.received_at, reverse=True)
        return results[skip : skip + top]

    async def update_status_async(self, id: str, status: str, user_id: str) -> None:
        container = await self._get_container()
        for pk in [user_id, "default"]:
            try:
                item = await container.read_item(item=id, partition_key=pk)
                item["status"] = status
                await container.upsert_item(item)
                return
            except Exception:
                pass

        try:
            query = "SELECT * FROM c WHERE c.id = @id"
            items = container.query_items(
                query=query,
                parameters=[{"name": "@id", "value": id}],
                enable_cross_partition_query=True
            )
            async for doc in items:
                doc["status"] = status
                await container.upsert_item(doc)
                return
        except Exception as e:
            logging.error(f"[CosmosHookRepository] Failed to update status for hook {id}: {e}")

    async def delete_async(self, id: str, user_id: str) -> bool:
        container = await self._get_container()
        for pk in [user_id, "default"]:
            try:
                await container.delete_item(item=id, partition_key=pk)
                return True
            except Exception:
                pass

        try:
            query = "SELECT * FROM c WHERE c.id = @id"
            items = container.query_items(
                query=query,
                parameters=[{"name": "@id", "value": id}],
                enable_cross_partition_query=True
            )
            async for doc in items:
                pk = doc.get("partition_key") or doc.get("UserId") or doc.get("userId") or "default"
                await container.delete_item(item=id, partition_key=pk)
                return True
        except Exception as e:
            logging.error(f"[CosmosHookRepository] Failed to delete hook {id}: {e}")
        return False


