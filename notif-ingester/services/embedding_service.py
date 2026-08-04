"""
embedding_service.py
--------------------
Generates text embeddings for transaction vectors using the configured provider.

⚠️  IMPORTANT — Embedding Dimension Warning  ⚠️
------------------------------------------------
Different embedding providers produce vectors of DIFFERENT dimensions:

  gemini:gemini-embedding-2      →  768 dimensions
  openai:text-embedding-3-small  →  1536 dimensions
  openai:text-embedding-3-large  →  3072 dimensions

Stored `TransactionVector` documents in CosmosDB contain embeddings at a
fixed dimension. If you switch EMBEDDING_AI to a different provider/model
whose output dimension differs from the stored vectors, cosine-similarity
lookups WILL silently return garbage results (and may raise shape errors).

Before switching EMBEDDING_AI, you MUST:
  1. Re-embed ALL existing TransactionVector documents with the new model.
  2. Update any stored dimension metadata if applicable.

Default: EMBEDDING_AI=gemini:gemini-embedding-2 (768-dim). Only change this
if you understand the implications and have re-embedded all stored vectors.
"""

import os
from services.llm_provider import make_provider


class EmbeddingService:
    def __init__(self):
        self.provider = make_provider("EMBEDDING")

    async def embed_async(self, text: str) -> list[float]:
        return await self.provider.embed(text)
