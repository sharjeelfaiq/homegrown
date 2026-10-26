"""Independent preparation/assembly microbenchmarks; called within phase budget."""
import statistics
import time


def suppression_mask(torch, vocab_size, eos_id, device):
    mask = torch.zeros(vocab_size, dtype=torch.bool, device=device)
    mask[max(0, vocab_size - 1024):] = True
    if 0 <= eos_id < vocab_size:
        mask[eos_id] = False
    return mask


def run(torch):
    from codec_history_candidate import CodecHistory
    device = 'cuda'
    pieces = list(torch.arange(696 * 16, device=device).reshape(-1, 16).split(12))

    def old_history():
        prior = []
        for index, piece in enumerate(pieces):
            prior.append(piece)
            flat = torch.cat(prior)
            result = flat if index < 3 else flat[max(0, len(flat) - len(piece) - 25):]
        return result

    def new_history():
        history = CodecHistory()
        for index, piece in enumerate(pieces):
            result = history.append(piece, index >= 3)
        return result

    def old_mask():
        mask = torch.zeros(3072, device=device, dtype=torch.bool)
        for index in range(2048, 3072):
            if index != 2150:
                mask[index] = True
        return mask

    def new_mask():
        return suppression_mask(torch, 3072, 2150, device)

    results = {}
    for name, old, new in [('history_696_frames', old_history, new_history),
                           ('suppression_mask', old_mask, new_mask)]:
        assert torch.equal(old(), new())
        times = {'old_s': [], 'new_s': []}
        for index in range(9):
            # Alternate order to reduce thermal/order bias.
            for label, fn in ([('old_s', old), ('new_s', new)] if index % 2 == 0
                              else [('new_s', new), ('old_s', old)]):
                torch.cuda.synchronize()
                start = time.perf_counter()
                fn()
                torch.cuda.synchronize()
                times[label].append(time.perf_counter() - start)
        results[name] = dict(**times, old_median_s=statistics.median(times['old_s']),
                             new_median_s=statistics.median(times['new_s']))
    return results
