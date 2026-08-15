"""
BlobStorageService
------------------
Handles storing and retrieving receipt and invoice images in Azure Blob Storage.
"""

import os
import logging
from typing import Optional, Tuple
from azure.storage.blob import ContentSettings
from azure.storage.blob.aio import BlobServiceClient
from azure.core.exceptions import ResourceExistsError

logger = logging.getLogger(__name__)

class BlobStorageService:
    CONTAINER_NAME = "receipt-images"

    def __init__(self, connection_string: Optional[str] = None):
        self.connection_string = (
            connection_string
            or os.environ.get("BLOB_STORAGE_CONNECTION_STRING")
            or os.environ.get("BlobStorageConnectionString")
            or os.environ.get("AzureWebJobsStorage")
            or "UseDevelopmentStorage=true"
        )
        self._blob_service_client: Optional[BlobServiceClient] = None

    def _get_client(self) -> BlobServiceClient:
        if self._blob_service_client is None:
            self._blob_service_client = BlobServiceClient.from_connection_string(
                self.connection_string
            )
        return self._blob_service_client

    async def upload_image_async(
        self,
        image_bytes: bytes,
        user_id: str,
        ingestion_id: str,
        filename: str,
        mime_type: str,
    ) -> Tuple[str, str]:
        """
        Uploads image bytes to Azure Blob Storage container 'receipt-images'.
        Returns (blob_name, blob_url).
        """
        clean_filename = os.path.basename(filename or "image.png")
        blob_name = f"{user_id}/{ingestion_id}_{clean_filename}"

        client = self._get_client()
        try:
            container_client = client.get_container_client(self.CONTAINER_NAME)
            try:
                await container_client.create_container()
            except ResourceExistsError:
                pass
            except Exception as e:
                logger.debug(f"[BlobStorageService] Container create check: {e}")

            blob_client = container_client.get_blob_client(blob_name)
            await blob_client.upload_blob(
                image_bytes,
                overwrite=True,
                content_settings=ContentSettings(content_type=mime_type),
            )

            blob_url = blob_client.url
            logger.info(f"[BlobStorageService] Uploaded image to {blob_url}")
            return blob_name, blob_url
        except Exception as e:
            logger.error(f"[BlobStorageService] Failed to upload image blob: {e}")
            raise

    async def download_image_async(self, blob_name: str) -> Tuple[bytes, str]:
        """
        Downloads blob bytes and content type.
        Returns (bytes, content_type).
        """
        client = self._get_client()
        container_client = client.get_container_client(self.CONTAINER_NAME)
        blob_client = container_client.get_blob_client(blob_name)
        
        properties = await blob_client.get_blob_properties()
        content_type = properties.content_settings.content_type or "image/png"
        
        download_stream = await blob_client.download_blob()
        data = await download_stream.readall()
        return data, content_type

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def close(self):
        if self._blob_service_client:
            await self._blob_service_client.close()
            self._blob_service_client = None

