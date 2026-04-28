"""Semantic + recursive chunking.

For long-form narratives (NTSB reports, 10-K risk-factor sections) we use a
semantic chunker that splits on cosine-distance shifts in successive
sentence embeddings. For tabular / heavily-formatted pages we fall back to
recursive character splitting.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np


@dataclass
class Chunk:
    text: str
    start: int
    end: int
    metadata: dict


_SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def split_sentences(text: str) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    cursor = 0
    for s in _SENT_RE.split(text.strip()):
        s_clean = s.strip()
        if not s_clean:
            continue
        idx = text.find(s_clean, cursor)
        if idx < 0:
            idx = cursor
        out.append((idx, idx + len(s_clean), s_clean))
        cursor = idx + len(s_clean)
    return out


def semantic_chunks(
    text: str,
    embed_fn,
    target_tokens: int = 220,
    overlap_tokens: int = 30,
    breakpoint_pct: float = 0.85,
    metadata: dict | None = None,
) -> list[Chunk]:
    """Cosine-distance breakpoint chunker.

    `embed_fn` takes a list[str] and returns np.ndarray (n, d), normalized.
    """
    sents = split_sentences(text)
    if not sents:
        return []
    if len(sents) == 1:
        return [Chunk(text=sents[0][2], start=sents[0][0], end=sents[0][1], metadata=metadata or {})]

    embs = embed_fn([s[2] for s in sents])
    # Pairwise cosine distance between successive sentences
    dists = 1 - np.einsum("ij,ij->i", embs[:-1], embs[1:])
    cutoff = float(np.quantile(dists, breakpoint_pct))
    boundaries = [i + 1 for i, d in enumerate(dists) if d >= cutoff]

    chunks: list[Chunk] = []
    start_idx = 0
    cur_text = ""
    cur_tok = 0
    for i, (s, e, t) in enumerate(sents):
        is_break = (i in boundaries) and cur_tok >= target_tokens * 0.4
        cur_text += (" " if cur_text else "") + t
        cur_tok += len(t.split())
        if cur_tok >= target_tokens or is_break:
            chunks.append(
                Chunk(
                    text=cur_text,
                    start=sents[start_idx][0],
                    end=e,
                    metadata=metadata or {},
                )
            )
            # Overlap: keep the last `overlap_tokens` words of cur_text
            words = cur_text.split()
            if overlap_tokens and len(words) > overlap_tokens:
                cur_text = " ".join(words[-overlap_tokens:])
                cur_tok = overlap_tokens
            else:
                cur_text = ""
                cur_tok = 0
            start_idx = i + 1
    if cur_text.strip():
        chunks.append(
            Chunk(
                text=cur_text,
                start=sents[start_idx][0] if start_idx < len(sents) else 0,
                end=sents[-1][1],
                metadata=metadata or {},
            )
        )
    return chunks


def recursive_chunks(
    text: str,
    target_chars: int = 1200,
    overlap_chars: int = 150,
    metadata: dict | None = None,
) -> list[Chunk]:
    """Cheap fallback for tabular / heavily-formatted pages."""
    out: list[Chunk] = []
    i = 0
    while i < len(text):
        end = min(len(text), i + target_chars)
        out.append(Chunk(text=text[i:end], start=i, end=end, metadata=metadata or {}))
        i = end - overlap_chars if end < len(text) else end
    return out
