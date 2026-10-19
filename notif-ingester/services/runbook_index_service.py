"""
runbook_index_service.py
------------------------
Runbook RAG: splits the per-channel runbook markdown into rule-atomic chunks,
indexes them (embeddings + lexical), and retrieves pinned + relevant chunks per
classification instead of injecting the whole document.

Chunking contract (authoring experience unchanged — the user still writes one
markdown doc per channel; splitting happens at index time):
  - Preamble before the first `##` header → its own chunk (usually the
    "explicit rules override" header — pinned).
  - Small sections → one chunk as-is.
  - Fat sections → split by `###` subsections; subsections still fat → one
    bullet-rule per chunk. Every chunk carries its section title as context
    (`## Section — Subsection`), never a floating orphan bullet.
  - Pinned rules: `[pinned]` tag in the rule text or a pinned section title.
  - Stable rule IDs: R-{CHANNEL}-{hash6} derived from runbook_id + section +
    body, stable across re-indexes and cited by the LLM in `why`.
"""

import hashlib
import logging
import re
from abc import ABC, abstractmethod
from typing import Dict, List, Optional

from pydantic import BaseModel, Field
from services.embedding_service import EmbeddingService
from services.retrieval_service import SimpleBM25, reciprocal_rank_fusion, tokenize

CHANNEL_CODES = {
    "runbook": "APP",
    "runbook-sms": "SMS",
    "runbook-email": "EMAIL",
    "runbook-image": "IMAGE",
}

PINNED_TAG = "[pinned]"
PINNED_SECTION_TITLES = {"strict id handling", "explicit rules override"}
MAX_SECTION_CHARS = 400
MAX_SECTION_RULES = 3
MAX_SUBSECTION_CHARS = 600
MAX_SUBSECTION_RULES = 1


class RunbookChunk(BaseModel):
    id: str = ""
    user_id: str = Field(default="default", alias="UserId")
    runbook_id: str = Field(alias="runbookId")
    section_title: str = Field(default="", alias="sectionTitle")
    rule_id: str = Field(default="", alias="ruleId")
    content: str = ""
    pinned: bool = False
    embedding: Optional[List[float]] = None
    etag_version: Optional[str] = Field(default=None, alias="etagVersion")

    class Config:
        populate_by_name = True


def _channel_code(runbook_id: str) -> str:
    if runbook_id in CHANNEL_CODES:
        return CHANNEL_CODES[runbook_id]
    if runbook_id.startswith("runbook-app:"):
        pkg = runbook_id.replace("runbook-app:", "", 1).upper()
        pkg = re.sub(r"[^A-Z0-9]+", "-", pkg).strip("-")
        return f"APP-{pkg}" if pkg else "APP"
    return re.sub(r"[^A-Z0-9]+", "-", runbook_id.upper()).strip("-") or "RUNBOOK"


def _is_pinned(section_title: str, body: str) -> bool:
    if PINNED_TAG in body.lower():
        return True
    return section_title.strip().lower() in PINNED_SECTION_TITLES


def _rule_id_for(runbook_id: str, section_title: str, body: str) -> str:
    digest = hashlib.sha1(f"{runbook_id}|{section_title}|{body}".encode("utf-8")).hexdigest()[:6]
    return f"R-{_channel_code(runbook_id)}-{digest.upper()}"


def _split_rules(body: str) -> List[str]:
    """Split a section body into individual rule units (bullets or paragraphs)."""
    lines = [ln for ln in body.split("\n")]
    rules: List[str] = []
    current: List[str] = []
    for ln in lines:
        if re.match(r"^\s*([-*]|\d+\.)\s+", ln):
            if current:
                rules.append("\n".join(current).strip())
                current = []
            current.append(ln)
        elif ln.strip() == "":
            if current:
                rules.append("\n".join(current).strip())
                current = []
        else:
            current.append(ln)
    if current:
        rules.append("\n".join(current).strip())
    return [r for r in rules if r]


def _count_rules(body: str) -> int:
    return len([ln for ln in body.split("\n") if re.match(r"^\s*([-*]|\d+\.)\s+", ln)])


def chunk_runbook(markdown: str, runbook_id: str) -> List[RunbookChunk]:
    """Split a runbook markdown document into rule-atomic chunks."""
    if not markdown or not markdown.strip():
        return []

    sections = re.split(r"^(?=## )", markdown.strip(), flags=re.M)
    chunks: List[RunbookChunk] = []

    for section in sections:
        section = section.strip()
        if not section:
            continue
        m = re.match(r"^## (.+)$", section.split("\n", 1)[0])
        if not m:
            # Preamble before first header (the override/explicit-rules header)
            chunks.append(RunbookChunk(
                runbook_id=runbook_id,
                section_title="Header",
                rule_id=_rule_id_for(runbook_id, "Header", section),
                content=section,
                pinned=_is_pinned("Header", section) or "override" in section.lower(),
            ))
            continue

        title = m.group(1).strip()
        body = section.split("\n", 1)[1].strip() if "\n" in section else ""
        if not body:
            continue

        subsections = re.split(r"^(?=### )", body, flags=re.M)
        if len(subsections) > 1 or (len(body) > MAX_SECTION_CHARS or _count_rules(body) > MAX_SECTION_RULES):
            for sub in subsections:
                sub = sub.strip()
                if not sub:
                    continue
                sm = re.match(r"^### (.+)$", sub.split("\n", 1)[0])
                sub_title = sm.group(1).strip() if sm else ""
                sub_body = sub.split("\n", 1)[1].strip() if (sm and "\n" in sub) else ("" if sm else sub)
                if not sub_body:
                    sub_body = sub
                ctx_title = f"{title} — {sub_title}" if sub_title else title
                if len(sub_body) > MAX_SUBSECTION_CHARS or _count_rules(sub_body) > MAX_SUBSECTION_RULES:
                    for rule in _split_rules(sub_body):
                        if not rule:
                            continue
                        chunks.append(_make_chunk(runbook_id, title, ctx_title, rule))
                else:
                    chunks.append(_make_chunk(runbook_id, title, ctx_title, sub_body))
        else:
            chunks.append(_make_chunk(runbook_id, title, title, body))

    return chunks


def _make_chunk(runbook_id: str, section_title: str, ctx_title: str, body: str) -> RunbookChunk:
    content = f"## {ctx_title}\n\n{body}"
    return RunbookChunk(
        runbook_id=runbook_id,
        section_title=ctx_title,
        rule_id=_rule_id_for(runbook_id, section_title, body),
        content=content,
        pinned=_is_pinned(section_title, body),
    )


class IRunbookChunkRepository(ABC):
    @abstractmethod
    async def replace_all_async(self, user_id: str, runbook_id: str, chunks: List[RunbookChunk]) -> None:
        pass

    @abstractmethod
    async def get_by_runbook_async(self, user_id: str, runbook_id: str) -> List[RunbookChunk]:
        pass


class CosmosRunbookChunkRepository(IRunbookChunkRepository):
    def __init__(self):
        from repositories.cosmos_client import get_cosmos_client
        import os
        self.client = get_cosmos_client()
        self.db_name = os.environ.get("COSMOS_DB", "FinanceDb")
        self.container_name = "RunbookChunks"

    async def _get_container(self):
        db = self.client.get_database_client(self.db_name)
        return db.get_container_client(self.container_name)

    async def replace_all_async(self, user_id: str, runbook_id: str, chunks: List[RunbookChunk]) -> None:
        container = await self._get_container()
        old = await self.get_by_runbook_async(user_id, runbook_id)
        for chunk in old:
            try:
                await container.delete_item(item=chunk.id, partition_key=user_id)
            except Exception as e:
                logging.warning(f"[runbook-index] Failed to delete stale chunk {chunk.id}: {e}")
        for chunk in chunks:
            # Serialize with aliases so stored keys (runbookId, sectionTitle, ...)
            # match the queries and readers in get_by_runbook_async.
            await container.upsert_item(chunk.model_dump(mode="json", by_alias=True))

    async def get_by_runbook_async(self, user_id: str, runbook_id: str) -> List[RunbookChunk]:
        container = await self._get_container()
        query = "SELECT * FROM c WHERE c.runbookId = @runbook_id"
        results: List[RunbookChunk] = []
        async for item in container.query_items(
            query=query,
            parameters=[{"name": "@runbook_id", "value": runbook_id}],
            partition_key=user_id,
        ):
            item["user_id"] = item.get("user_id", item.get("UserId", user_id))
            results.append(RunbookChunk(**item))
        return results


class RunbookIndexService:
    """
    Indexes runbooks into rule-atomic chunks and retrieves pinned + relevant
    rule chunks per classification (hybrid vector + BM25 via RRF).
    """

    def __init__(self, embedding_service: EmbeddingService, chunk_repo: IRunbookChunkRepository):
        self._embedding_service = embedding_service
        self._repo = chunk_repo
        self._cache: Dict[tuple, tuple] = {}

    async def reindex_runbook_async(
        self, user_id: str, runbook_id: str, content: str, etag: Optional[str] = None
    ) -> List[RunbookChunk]:
        cache_key = (user_id, runbook_id)
        cached = self._cache.get(cache_key)
        if cached and cached[0] == (etag or content):
            return cached[1]

        chunks = chunk_runbook(content, runbook_id)
        seen_doc_ids: Dict[str, int] = {}
        for chunk in chunks:
            chunk.user_id = user_id
            chunk.etag_version = etag
            # Cosmos requires a unique, non-empty document id. Derive it from the
            # stable rule id; disambiguate duplicate rules within one runbook.
            base = chunk.rule_id or _rule_id_for(runbook_id, chunk.section_title, chunk.content)
            n = seen_doc_ids.get(base, 0)
            seen_doc_ids[base] = n + 1
            chunk.id = base if n == 0 else f"{base}-{n + 1}"
            try:
                chunk.embedding = await self._embedding_service.embed_async(chunk.content)
            except Exception as e:
                logging.warning(f"[runbook-index] Embedding failed for {chunk.rule_id}: {e}")

        try:
            await self._repo.replace_all_async(user_id, runbook_id, chunks)
        except Exception as e:
            logging.error(f"[runbook-index] Persisting chunks for {runbook_id} failed: {e}")

        self._cache[cache_key] = (etag or content, chunks)
        return chunks

    async def get_rules_context_async(
        self,
        user_id: str,
        runbook_ids: List[str],
        query_embedding: Optional[List[float]] = None,
        query_text: str = "",
        top_k: int = 6,
    ) -> str:
        """
        Return markdown with pinned rules + top-k retrieved rules for this
        classification. Empty string when nothing is indexed (caller falls back
        to whole-doc injection).
        """
        all_chunks: List[RunbookChunk] = []
        for runbook_id in runbook_ids:
            cache_key = (user_id, runbook_id)
            cached = self._cache.get(cache_key)
            chunks = cached[1] if cached else None
            if chunks is None:
                try:
                    chunks = await self._repo.get_by_runbook_async(user_id, runbook_id)
                except Exception as e:
                    logging.warning(f"[runbook-index] Fetching chunks for {runbook_id} failed: {e}")
                    chunks = []
                self._cache[cache_key] = (chunks[0].etag_version if chunks else None, chunks)
            all_chunks.extend(chunks)

        if not all_chunks:
            return ""

        pinned = [c for c in all_chunks if c.pinned]

        candidates = [c for c in all_chunks if not c.pinned]
        ranked: List[RunbookChunk] = []
        if candidates:
            if query_embedding:
                import numpy as np
                q = np.array(query_embedding)
                q_norm = np.linalg.norm(q)
                vector_scores: List[float] = []
                for c in candidates:
                    if c.embedding and q_norm:
                        v = np.array(c.embedding)
                        v_norm = np.linalg.norm(v)
                        score = float(np.dot(q, v) / (q_norm * v_norm)) if v_norm else 0.0
                    else:
                        score = 0.0
                    vector_scores.append(score)

                vector_ranking = [
                    i for i, s in sorted(enumerate(vector_scores), key=lambda x: x[1], reverse=True) if s > 0
                ]

                bm25_ranking: List[int] = []
                if query_text:
                    bm25 = SimpleBM25([tokenize(c.content) for c in candidates])
                    lex_scores = bm25.scores(query_text)
                    bm25_ranking = [
                        i for i, s in sorted(enumerate(lex_scores), key=lambda x: x[1], reverse=True) if s > 0
                    ]

                fused = reciprocal_rank_fusion(
                    [vector_ranking, bm25_ranking],
                    weights=[1.0, 0.8],
                )
                ranked = [candidates[i] for i, _ in sorted(fused.items(), key=lambda x: x[1], reverse=True)]
            else:
                ranked = candidates

        top = ranked[:top_k]

        lines = ["### Retrieved Rules (cited by ID — reference the ID in `why`)"]
        seen_ids: set = set()
        for chunk in [*pinned, *top]:
            if chunk.rule_id in seen_ids:
                continue
            seen_ids.add(chunk.rule_id)
            pin = " (pinned)" if chunk.pinned else ""
            lines.append(f"\n[{chunk.rule_id}]{pin}\n{chunk.content}")
        return "\n".join(lines)
