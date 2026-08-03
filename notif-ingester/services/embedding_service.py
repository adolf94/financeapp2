from google import genai
import os

class EmbeddingService:
    def __init__(self):
        api_key = os.environ.get("GEMINI_API_KEY", "")
        self.client = genai.Client(api_key=api_key)

    async def embed_async(self, text: str) -> list[float]:
        # Using standard sync call inside async for simplicity,
        # or we could use the async client if genai provides one.
        # As of current SDK, usually client.models.embed_content is blocking,
        # but Azure Functions Python async worker will run it.
        result = self.client.models.embed_content(
            model=os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2"),
            contents=text
        )
        return result.embeddings[0].values
