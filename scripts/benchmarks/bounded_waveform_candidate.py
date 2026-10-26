"""Install the experimental decoder only on an isolated benchmark instance."""
import inspect
from functools import wraps

import torch

from qwen.waveform_stream import prefix_skipping_waveform_stream
from experimental_bounded_waveform import bounded_waveform_stream


def install(tts, decoder='bounded'):
    original = tts.generate_voice_clone_streaming
    signature = inspect.signature(original)
    if decoder == 'legacy':
        from legacy_waveform_stream import legacy_waveform_stream
        waveform = legacy_waveform_stream
    elif decoder == 'prefix-skip':
        waveform = prefix_skipping_waveform_stream
    elif decoder == 'bounded':
        waveform = bounded_waveform_stream
    else:
        raise ValueError('Unknown waveform decoder')

    @wraps(original)
    @torch.inference_mode()
    def generate(*args, **kwargs):
        arguments = signature.bind(*args, **kwargs)
        arguments.apply_defaults()
        values = arguments.arguments
        prepare_names = ('text', 'language', 'ref_audio', 'ref_text', 'xvec_only',
                         'append_silence', 'voice_clone_prompt', 'instruct')
        prepared = tts._prepare_generation(
            **{name: values[name] for name in prepare_names},
            non_streaming_mode=tts._resolve_non_streaming_mode(values['non_streaming_mode'], default=False),
        )
        m, talker, config, tie, tam, tth, tpe, ref_codes = prepared
        from qwen.streaming import fast_generate_streaming, parity_generate_streaming
        parity = tts._resolve_parity(values['parity_mode'])
        options = {name: values[name] for name in (
            'max_new_tokens', 'min_new_tokens', 'temperature', 'top_k', 'top_p',
            'do_sample', 'repetition_penalty', 'chunk_size',
        )}
        options.update(talker=talker, config=config, talker_input_embeds=tie,
                       attention_mask=tam, trailing_text_hiddens=tth, tts_pad_embed=tpe)
        if not parity:
            options.update(predictor_graph=tts.predictor_graph, talker_graph=tts.talker_graph)
        source = (parity_generate_streaming if parity else fast_generate_streaming)(**options)
        yield from waveform(source, m.speech_tokenizer, ref_codes, values['chunk_size'])

    tts.generate_voice_clone_streaming = generate
    return original
