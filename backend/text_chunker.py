"""Splits long scripts into TTS-safe chunks without ever cutting mid-word.

Sentence boundaries are the primary split point; consecutive sentences are
greedily packed into a chunk up to max_chars. A single sentence that alone
exceeds max_chars falls back to clause boundaries (comma/semicolon/colon),
then to plain word-boundary wrapping as a last resort.
"""
import re

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_CLAUSE_SPLIT_RE = re.compile(r"(?<=[,;:])\s+")


def chunk_text(text: str, max_chars: int) -> list[str]:
    text = text.strip()
    if not text:
        return []

    units: list[str] = []
    for sentence in _split_on(text, _SENTENCE_SPLIT_RE):
        units.extend(_ensure_within_limit(sentence, max_chars))

    return _pack(units, max_chars)


def _split_on(text: str, pattern: re.Pattern) -> list[str]:
    return [u.strip() for u in pattern.split(text) if u.strip()]


def _ensure_within_limit(unit: str, max_chars: int) -> list[str]:
    if len(unit) <= max_chars:
        return [unit]

    clauses = _split_on(unit, _CLAUSE_SPLIT_RE)
    if len(clauses) > 1:
        result = []
        for clause in clauses:
            result.extend(_ensure_within_limit(clause, max_chars))
        return result

    return _split_by_words(unit, max_chars)


def _split_by_words(unit: str, max_chars: int) -> list[str]:
    return _pack(unit.split(), max_chars)


def _pack(units: list[str], max_chars: int) -> list[str]:
    chunks: list[str] = []
    current = ""
    for unit in units:
        if not current:
            current = unit
        elif len(current) + 1 + len(unit) <= max_chars:
            current = f"{current} {unit}"
        else:
            chunks.append(current)
            current = unit
    if current:
        chunks.append(current)
    return chunks
