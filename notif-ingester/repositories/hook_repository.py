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
    async def update_status_async(self, id: str, status: str, user_id: str) -> None:
        pass

class CosmosHookRepository(IHookRepository):
    def __init__(self):
        self.endpoint = os.environ.get("CosmosConnectionString", "")
        # Parse endpoint from ConnectionString for cosmos client
        conn_parts = dict(kv.split("=", 1) for kv in self.endpoint.split(";") if kv)
        
        # Or better, just use from_connection_string
        self.client = CosmosClient.from_connection_string(self.endpoint)
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

    async def update_status_async(self, id: str, status: str, user_id: str) -> None:
        container = await self._get_container()
        item = await container.read_item(item=id, partition_key=user_id)
        item["status"] = status
        await container.upsert_item(item)
