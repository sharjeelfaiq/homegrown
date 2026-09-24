"""
Small local utilities for the /qwen CUDA-graph wrapper.
"""
from __future__ import annotations

import contextlib
import warnings


@contextlib.contextmanager
def suppress_flash_attn_warning():
    """
    Suppress noisy Flash Attention dtype warnings during model loading.

    The wrapper still passes dtype explicitly. This only keeps logs cleaner.
    """
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=".*Flash Attention 2.*",
            category=Warning,
        )
        warnings.filterwarnings(
            "ignore",
            message=".*You are attempting to use Flash Attention.*",
            category=Warning,
        )
        yield


def cuda_is_usable() -> "tuple[bool, str]":
    """Return (usable, reason) for the default CUDA device.

    `torch.cuda.is_available()` alone is NOT a sufficient check. It reports
    True whenever a driver and device are present, even when the installed
    torch build ships no kernels for that device's compute capability -- the
    failure then surfaces much later, on the first real op, as::

        CUDA error: no kernel image is available for execution on the device

    That is exactly what a CUDA 12.8 build does on a Maxwell card (sm_52):
    cu128 compiles for sm_75 and up. So this probe checks the arch list *and*
    executes a throwaway matmul, which is the only way to be certain the
    device can actually run work.

    `reason` is a human-readable explanation, suitable for logging or showing
    to a user, and is always populated when `usable` is False.
    """
    import torch

    if not torch.cuda.is_available():
        return False, "No CUDA device is available (no NVIDIA GPU, or drivers are missing)."

    try:
        name = torch.cuda.get_device_name(0)
        major, minor = torch.cuda.get_device_capability(0)
    except Exception as e:  # pragma: no cover - driver-level failure
        return False, f"CUDA device present but unusable: {e}"

    arch = f"sm_{major}{minor}"
    supported = torch.cuda.get_arch_list()

    def _parse(a: str):
        """'sm_86' -> (8, 6), 'sm_100' -> (10, 0). Minor is the last digit."""
        if not a.startswith("sm_") or not a[3:].isdigit():
            return None
        digits = a[3:]
        return int(digits[:-1]), int(digits[-1])

    # Cubins are forward-compatible within a major version but not across one,
    # so an sm_50 binary runs on sm_52 while an sm_75 binary does not.
    compatible = [
        p for p in (_parse(a) for a in supported)
        if p is not None and p[0] == major and p[1] <= minor
    ]
    if supported and not compatible:
        return False, (
            f"{name} has CUDA capability {arch}, but this PyTorch build only ships "
            f"kernels for {' '.join(supported)}. Install a torch build that covers "
            f"{arch} (for pre-Turing cards use the cu126 index, not cu128)."
        )

    try:
        a = torch.zeros(8, 8, device="cuda")
        (a @ a).sum().item()
    except Exception as e:
        return False, f"{name} ({arch}) failed a test CUDA operation: {e}"

    return True, f"{name} ({arch})"


def resolve_device(device: str = "auto") -> "tuple[str, str]":
    """Resolve a requested device to one that actually works.

    Returns (device, reason). "auto" picks CUDA when it is genuinely usable
    and silently falls back to CPU otherwise. An explicit "cuda" that is not
    usable raises, rather than quietly running orders of magnitude slower than
    the caller expects.
    """
    if device == "cpu":
        return "cpu", "CPU requested explicitly."

    usable, reason = cuda_is_usable()
    if device == "auto":
        return ("cuda", reason) if usable else ("cpu", reason)
    if not device.startswith("cuda"):
        raise ValueError(f"Unsupported device {device!r}; expected 'auto', 'cuda' or 'cpu'.")
    if not usable:
        raise RuntimeError(f"CUDA was requested but is not usable. {reason}")
    return device, reason
