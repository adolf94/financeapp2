"""
retrieval_service.py
--------------------
Hybrid retrieval over past-transaction vectors. Backend-agnostic: it only
depends on IVectorRepository via VectorService, so the vector store can be
swapped (CosmosDB today, pgvector per PBI-023) without touching this service.

Channels fused with Reciprocal Rank Fusion (RRF):
  1. Vector similarity (cosine, computed over the user's vectors)
  2. Lexical BM25 over embed_text + summary + raw_msg_summary
  3. Vendor-lookup signal (exact vendor-name matches from the Vendors container)

The returned score per match remains the *cosine* similarity so existing
auto-confirm thresholds keep their meaning; ordering is decided by the fusion.
"""

import logging
import math
import re
from typing import List, Optional, Sequence, Tuple

from models.transaction_vector import TransactionVector
from services.vector_service import VectorService

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall((text or "").lower())


class SimpleBM25:
    """Minimal BM25 (Okapi) over a small in-memory corpus (single-user scale)."""

    def __init__(self, docs: List[List[str]], k1: float = 1.5, b: float = 0.75):
        self._k1 = k1
        self._b = b
        self._docs = docs
        self._doc_count = len(docs)
        self._doc_lens = [len(d) for d in docs]
        self._avg_len = (sum(self._doc_lens) / self._doc_count) if self._doc_count else 0.0
        self._df: dict = {}
        self._tfs: List[dict] = []
        for d in docs:
            tf: dict = {}
            for t in d:
                tf[t] = tf.get(t, 0) + 1
            self._tfs.append(tf)
            for t in tf:
                self._df[t] = self._df.get(t, 0) + 1

    def idf(self, term: str) -> float:
        n = self._df.get(term, 0)
        if n == 0:
            return 0.0
        return math.log(1.0 + (self._doc_count - n + 0.5) / (n + 0.5))

    def score(self, query_tokens: Sequence[str], doc_index: int) -> float:
        if doc_index >= self._doc_count or self._avg_len == 0:
            return 0.0
        tf = self._tfs[doc_index]
        dl = self._doc_lens[doc_index]
        score = 0.0
        for t in query_tokens:
            freq = tf.get(t, 0)
            if not freq:
                continue
            denom = freq + self._k1 * (1.0 - self._b + self._b * dl / self._avg_len)
            score += self.idf(t) * (freq * (self._k1 + 1.0)) / denom
        return score

    def scores(self, query_text: str) -> List[float]:
        q = tokenize(query_text)
        return [self.score(q, i) for i in range(self._doc_count)]


def _vector_doc_text(vec: TransactionVector) -> str:
    return " ".join(
        part for part in (vec.embed_text, vec.summary, getattr(vec, "raw_msg_summary", "") or "")
        if part
    )


def _vendor_match_names(vendor_matches: Optional[List[dict]]) -> set:
    names: set = set()
    for m in vendor_matches or []:
        name = (m.get("vendor_name") or "").lower().strip()
        if name:
            names.add(name)
    return names


def reciprocal_rank_fusion(
    rank_lists: List[List[int]],
    weights: Optional[List[float]] = None,
    k: int = 60,
) -> dict:
    """
    Fuse multiple ranked lists of doc indices into a single score map.
    rank_lists[i] is an ordered list of doc indices for channel i.
    Returns {doc_index: fused_score}.
    """
    fused: dict = {}
    weights = weights or [1.0] * len(rank_lists)
    for weight, ranking in zip(weights, rank_lists):
        for rank, doc_index in enumerate(ranking):
            fused[doc_index] = fused.get(doc_index, 0.0) + weight / (k + rank + 1)
    return fused


class RetrievalService:
    """
    Hybrid (vector + lexical + vendor signal) retrieval over transaction vectors,
    ordered by RRF. Scores in the returned tuples remain cosine similarities.
    """

    def __init__(self, vector_service: VectorService, lexical_weight: float = 0.8, vendor_weight: float = 1.2):
        self._vector_service = vector_service
        self._lexical_weight = lexical_weight
        self._vendor_weight = vendor_weight

    async def find_similar_async(
        self,
        query_embedding: List[float],
        user_id: str,
        query_text: str = "",
        top_k: int = 5,
        vendor_matches: Optional[List[dict]] = None,
    ) -> List[Tuple[TransactionVector, float]]:
        # Full scored candidate list (all user vectors) — single-user scale is fine,
        # and a pgvector backend can replace this exact scan with SQL KNN later.
        candidates = await self._vector_service.find_similar_async(
            query_embedding, user_id, top_k=10_000
        )
        if not candidates:
            return []

        vector_ranking = [i for i, _ in enumerate(candidates)]

        lexical_ranking: List[int] = []
        if query_text:
            corpus = [_vector_doc_text(vec) for vec, _ in candidates]
            if any(corpus):
                bm25 = SimpleBM25([tokenize(doc) for doc in corpus])
                lex_scores = bm25.scores(query_text)
                lexical_ranking = [
                    i for i, s in sorted(enumerate(lex_scores), key=lambda x: x[1], reverse=True) if s > 0
                ]

        vendor_names = _vendor_match_names(vendor_matches)
        vendor_ranking: List[int] = []
        if vendor_names:
            vendor_ranking = [
                i for i, (vec, _) in enumerate(candidates)
                if (vec.vendor or "").lower().strip() in vendor_names
            ]

        fused = reciprocal_rank_fusion(
            [vector_ranking, lexical_ranking, vendor_ranking],
            weights=[1.0, self._lexical_weight, self._vendor_weight],
        )

        ordered = sorted(fused.items(), key=lambda x: x[1], reverse=True)[:top_k]
        return [candidates[i] for i, _ in ordered]
