import os
from azure.cosmos.aio import CosmosClient

_cosmos_client = None

def get_cosmos_client() -> CosmosClient:
    global _cosmos_client
    if _cosmos_client is None:
        endpoint = os.environ.get("CosmosConnectionString", "")
        if endpoint:
            _cosmos_client = CosmosClient.from_connection_string(endpoint)
    return _cosmos_client
