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


def _pack_greedy(units: list[str], limit: int) -> list[str] | None:
    """Greedily fill chunks up to `limit`. None when some unit cannot fit.

    Returning None rather than overflowing keeps the "no chunk exceeds the
    limit" guarantee decidable, which is what lets _pack() search for a
    smaller limit without risking a chunk that blows the model's context.
    """
    chunks: list[str] = []
    current = ""
    for unit in units:
        if len(unit) > limit:
            return None
        if not current:
            current = unit
        elif len(current) + 1 + len(unit) <= limit:
            current = f"{current} {unit}"
        else:
            chunks.append(current)
            current = unit
    if current:
        chunks.append(current)
    return chunks


# Guard on the balancing DP below, which is O(chunks x units^2). Scripts here
# run to MAX_TOTAL_CHARS=60,000, which at a small chunk size is enough units to
# make that cost real, so fall back to greedy packing past this many states.
_BALANCE_STATE_BUDGET = 2_000_000


def _pack(units: list[str], max_chars: int) -> list[str]:
    """Pack units into chunks within max_chars, sized as evenly as possible.

    Greedy filling leaves the final chunk holding whatever remains, routinely a
    fraction of the others -- one real script produced
    [138, 164, 188, 174, 195, 186, 75]. That runt is the chunk that misbehaves:
    short chunks sit near their generation frame cap, so it is the one that
    drops its closing words and murmurs.

    Simply packing to a smaller limit does not fix it, because greedy packing
    is not optimal: on that same script every limit below 195 yields NINE chunks
    instead of seven, which would make the job slower rather than better. Even
    chunks require choosing all the boundaries together, so this is a partition
    DP -- split the units into exactly as many contiguous groups as greedy
    needed, minimising squared deviation from the mean group size, subject to
    no group exceeding max_chars.

    Chunk count therefore never increases, and no chunk ever exceeds max_chars;
    only the boundaries move.
    """
    baseline = _pack_greedy(units, max_chars)
    if baseline is None or len(baseline) <= 1:
        return baseline or []

    groups = len(baseline)
    count = len(units)
    if groups * count * count > _BALANCE_STATE_BUDGET:
        return baseline

    lengths = [len(u) for u in units]
    prefix = [0] * (count + 1)
    for i, length in enumerate(lengths):
        prefix[i + 1] = prefix[i] + length

    def joined_len(start: int, end: int) -> int:
        """Length of units[start:end] joined by single spaces."""
        return prefix[end] - prefix[start] + (end - start - 1)

    target = joined_len(0, count) / groups
    inf = float("inf")
    cost = [[inf] * (count + 1) for _ in range(groups + 1)]
    split_at = [[-1] * (count + 1) for _ in range(groups + 1)]
    cost[0][0] = 0.0

    for group in range(1, groups + 1):
        for end in range(group, count + 1):
            best, best_start = inf, -1
            # Walking start downwards grows the group, so once it exceeds
            # max_chars every earlier start does too.
            for start in range(end - 1, group - 2, -1):
                length = joined_len(start, end)
                if length > max_chars:
                    break
                previous = cost[group - 1][start]
                if previous == inf:
                    continue
                candidate = previous + (length - target) ** 2
                if candidate < best:
                    best, best_start = candidate, start
            cost[group][end] = best
            split_at[group][end] = best_start

    if cost[groups][count] == inf:
        return baseline

    bounds: list[tuple[int, int]] = []
    end = count
    for group in range(groups, 0, -1):
        start = split_at[group][end]
        bounds.append((start, end))
        end = start
    bounds.reverse()
    return [" ".join(units[start:end]) for start, end in bounds]
