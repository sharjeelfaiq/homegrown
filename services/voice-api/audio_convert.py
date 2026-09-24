"""MP3 audio output via PyAV (bundles its own FFmpeg libraries -- no system
ffmpeg binary required).

write_mp3 encodes a raw PCM numpy array directly to .mp3 -- this is what
generation uses now, so no intermediate .wav is ever written. wav_to_mp3
(file-to-file) is kept only to serve downloads for history entries created
before this change, which still point at an on-disk .wav.
"""
import numpy as np
import av


def write_mp3(samples: np.ndarray, sample_rate: int, mp3_path: str) -> None:
    """Encode a mono float32 PCM array (range [-1, 1]) directly to MP3."""
    container = av.open(mp3_path, mode="w")
    try:
        stream = container.add_stream("mp3", rate=sample_rate)
        # AAC's frame size is a fixed 1024 samples/channel regardless of
        # sample rate -- codec_context.frame_size is only populated once the
        # encoder has been fed a frame, so 1024 is the correct value to use
        # upfront, not just a fallback.
        frame_size = stream.codec_context.frame_size or 1024
        planar = samples.reshape(1, -1).astype(np.float32)
        total = planar.shape[1]
        pts = 0
        for start in range(0, total, frame_size):
            chunk = planar[:, start:start + frame_size]
            frame = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="mono")
            frame.sample_rate = sample_rate
            frame.pts = pts
            pts += chunk.shape[1]
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()


def wav_to_mp3(wav_path: str, mp3_path: str) -> None:
    """Legacy path: convert an existing .wav file to .mp3 (used only for
    history entries generated before write_mp3 existed)."""
    with av.open(wav_path) as in_container:
        in_stream = in_container.streams.audio[0]
        with av.open(mp3_path, mode="w") as out_container:
            out_stream = out_container.add_stream("mp3")
            for frame in in_container.decode(in_stream):
                frame.pts = None
                for packet in out_stream.encode(frame):
                    out_container.mux(packet)
            for packet in out_stream.encode():
                out_container.mux(packet)
