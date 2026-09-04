#!/usr/bin/env python3
"""
Streaming generation loops using CUDA graphs for both predictor and talker.

Same decode strategy as generate.fast_generate, but yields codec chunks
every `chunk_size` steps instead of returning the full sequence at once.
"""
import time
from typing import Generator, Tuple

import torch

from .sampling import apply_repetition_penalty, sample_logits


def _chunk_timing(prefill_ms: float, elapsed: float, n_steps: int) -> dict:
    return {
        'prefill_ms': prefill_ms,
        'decode_s': elapsed,
        'steps': n_steps,
        'ms_per_step': (elapsed / n_steps * 1000) if n_steps > 0 else 0.0,
        'steps_per_s': (n_steps / elapsed) if elapsed > 0 else 0.0,
    }


@torch.inference_mode()
def fast_generate_streaming(
    talker,
    talker_input_embeds: torch.Tensor,
    attention_mask: torch.Tensor,
    trailing_text_hiddens: torch.Tensor,
    tts_pad_embed: torch.Tensor,
    config,
    predictor_graph,
    talker_graph,
    max_new_tokens: int = 2048,
    min_new_tokens: int = 2,
    temperature: float = 0.9,
    top_k: int = 50,
    top_p: float = 1.0,
    do_sample: bool = True,
    repetition_penalty: float = 1.05,
    chunk_size: int = 12,
) -> Generator[Tuple[torch.Tensor, dict], None, None]:
    """
    Stream autoregressive generation with CUDA-graphed predictor and talker.

    Yields (codec_chunk, timing) every `chunk_size` decode steps, where
    codec_chunk is a [n, num_code_groups] long tensor of newly generated
    codes and timing describes cumulative progress at that point.
    """
    eos_id = config.codec_eos_token_id
    num_code_groups = config.num_code_groups
    vocab_size = config.vocab_size
    device = talker_input_embeds.device

    suppress_mask = torch.zeros(vocab_size, dtype=torch.bool, device=device)
    suppress_start = max(0, vocab_size - 1024)
    for i in range(suppress_start, vocab_size):
        if i != eos_id:
            suppress_mask[i] = True

    predictor = talker.code_predictor
    talker_codec_embed = talker.get_input_embeddings()
    talker_codec_head = talker.codec_head
    predictor_codec_embeds = predictor.get_input_embeddings()

    # === PREFILL (still uses HF forward for variable-length prefill) ===
    t_start = time.time()

    out = talker.forward(
        inputs_embeds=talker_input_embeds,
        attention_mask=attention_mask,
        use_cache=True,
        output_hidden_states=True,
        return_dict=True,
        trailing_text_hidden=trailing_text_hiddens,
        tts_pad_embed=tts_pad_embed,
        generation_step=None,
        past_hidden=None,
        past_key_values=None,
    )

    talker_past_kv = out.past_key_values
    past_hidden = out.past_hidden
    gen_step = out.generation_step

    logits = out.logits[:, -1, :]
    suppress_eos = min_new_tokens > 0
    token = sample_logits(
        logits,
        temperature=temperature,
        top_k=top_k,
        top_p=top_p,
        do_sample=do_sample,
        suppress_mask=suppress_mask,
        suppress_tokens=[eos_id] if suppress_eos else None,
    )

    # Copy prefill KV cache into talker graph's static cache
    prefill_len = talker_graph.prefill_kv(talker_past_kv)
    # Sync padding mask + rope deltas for decode parity
    rope_deltas = getattr(talker, "rope_deltas", None)
    talker_graph.set_generation_state(attention_mask, rope_deltas)

    torch.cuda.synchronize()
    t_prefill = time.time() - t_start

    # === DECODE LOOP ===
    t_decode_start = time.time()
    all_codec_ids = []
    chunk_buffer = []

    for step_idx in range(max_new_tokens):
        if token.item() == eos_id:
            break

        # --- CUDA-Graphed Code Predictor ---
        last_id_hidden = talker_codec_embed(token.unsqueeze(1))  # [1, 1, H]
        pred_input = torch.cat((past_hidden, last_id_hidden), dim=1)  # [1, 2, H]
        codebook_token_ids = predictor_graph.run(pred_input)  # [15] long tensor

        # Build full codec: [first_cb, cb1, ..., cb15]
        all_cb = torch.cat([token.view(1), codebook_token_ids])  # [16]
        all_codec_ids.append(all_cb.detach())
        chunk_buffer.append(all_cb.detach())

        # --- Build input embedding for talker ---
        codec_hiddens = [last_id_hidden]
        for i in range(num_code_groups - 1):
            codec_hiddens.append(predictor_codec_embeds[i](codebook_token_ids[i].unsqueeze(0).unsqueeze(0)))
        inputs_embeds = torch.cat(codec_hiddens, dim=1).sum(1, keepdim=True)

        if gen_step < trailing_text_hiddens.shape[1]:
            inputs_embeds = inputs_embeds + trailing_text_hiddens[:, gen_step].unsqueeze(1)
        else:
            inputs_embeds = inputs_embeds + tts_pad_embed

        # --- CUDA-Graphed Talker decode step ---
        current_pos = prefill_len + step_idx
        if current_pos >= talker_graph.max_seq_len - 1:
            # Stop if we exceed max_seq_len
            break

        hidden_states = talker_graph.run(inputs_embeds, position=current_pos)
        # hidden_states is the static output buffer - use it immediately

        logits = talker_codec_head(hidden_states[:, -1, :]).unsqueeze(0)

        if repetition_penalty != 1.0 and len(all_codec_ids) > 0:
            history = torch.stack([c[0] for c in all_codec_ids])
            logits = apply_repetition_penalty(logits, history, repetition_penalty)

        suppress_eos = len(all_codec_ids) < min_new_tokens
        token = sample_logits(
            logits.squeeze(0),
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            do_sample=do_sample,
            suppress_mask=suppress_mask,
            suppress_tokens=[eos_id] if suppress_eos else None,
        )
        past_hidden = hidden_states[:, -1:, :].clone()  # clone since it's the static buffer
        gen_step += 1

        if len(chunk_buffer) >= chunk_size:
            torch.cuda.synchronize()
            elapsed = time.time() - t_decode_start
            timing = _chunk_timing(t_prefill * 1000, elapsed, len(all_codec_ids))
            yield torch.stack(chunk_buffer), timing
            chunk_buffer = []

    if chunk_buffer:
        torch.cuda.synchronize()
        elapsed = time.time() - t_decode_start
        timing = _chunk_timing(t_prefill * 1000, elapsed, len(all_codec_ids))
        yield torch.stack(chunk_buffer), timing


@torch.inference_mode()
def parity_generate_streaming(
    talker,
    talker_input_embeds: torch.Tensor,
    attention_mask: torch.Tensor,
    trailing_text_hiddens: torch.Tensor,
    tts_pad_embed: torch.Tensor,
    config,
    max_new_tokens: int = 2048,
    min_new_tokens: int = 2,
    temperature: float = 0.9,
    top_k: int = 50,
    top_p: float = 1.0,
    do_sample: bool = True,
    repetition_penalty: float = 1.05,
    chunk_size: int = 12,
) -> Generator[Tuple[torch.Tensor, dict], None, None]:
    """
    Parity-mode streaming: disables CUDA graphs and decodes the full
    sequence via the talker's own HF `generate` (dynamic cache), then
    yields the result in `chunk_size`-step chunks for interface parity
    with `fast_generate_streaming`.

    Since the underlying HF `generate()` call is not itself incremental,
    this does not reduce first-chunk latency -- it exists for debugging
    and numerical parity checks against non-CUDA-graph decoding.
    """
    eos_id = config.codec_eos_token_id
    vocab_size = config.vocab_size

    suppress_start = max(0, vocab_size - 1024)
    suppress_tokens = [i for i in range(suppress_start, vocab_size) if i != eos_id]

    t_start = time.time()
    talker_result = talker.generate(
        inputs_embeds=talker_input_embeds,
        attention_mask=attention_mask,
        trailing_text_hidden=trailing_text_hiddens,
        tts_pad_embed=tts_pad_embed,
        max_new_tokens=max_new_tokens,
        min_new_tokens=min_new_tokens,
        do_sample=do_sample,
        top_k=top_k,
        top_p=top_p,
        temperature=temperature,
        repetition_penalty=repetition_penalty,
        eos_token_id=eos_id,
        suppress_tokens=suppress_tokens,
        subtalker_dosample=do_sample,
        subtalker_top_k=top_k,
        subtalker_top_p=top_p,
        subtalker_temperature=temperature,
        output_hidden_states=True,
        return_dict_in_generate=True,
    )
    talker_codes = torch.stack(
        [hid[-1] for hid in talker_result.hidden_states if hid[-1] is not None],
        dim=1,
    )
    first_codebook = talker_codes[:, :, 0]
    is_stop_token = first_codebook == eos_id
    stop_indices = torch.argmax(is_stop_token.int(), dim=1)
    has_stop_token = is_stop_token.any(dim=1)
    effective_lengths = torch.where(has_stop_token, stop_indices, talker_codes.shape[1])
    codes = talker_codes[0, :effective_lengths[0], :]

    torch.cuda.synchronize()
    total_time = time.time() - t_start
    total_steps = int(codes.shape[0])

    for start in range(0, total_steps, chunk_size):
        end = min(start + chunk_size, total_steps)
        elapsed = total_time * (end / total_steps) if total_steps > 0 else 0.0
        timing = _chunk_timing(0.0, elapsed, end)
        yield codes[start:end], timing
