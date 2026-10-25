"""Hardware-aware model fit estimates and recommendations.

Estimates are intentionally distinguished from a profile that has completed a
load and generation run. Missing hardware readings stay unknown and never
disable onboarding.
"""
from __future__ import annotations

from typing import Any


TESTED_PROFILES = {("standard", "nvidia geforce gtx 970", 4096)}


def assess(choice: str, hardware: dict[str, Any]) -> dict[str, Any]:
    gpu_name = hardware.get("gpu_name")
    vram = hardware.get("vram_mib")
    available_vram = hardware.get("vram_available_mib")
    usable_vram = available_vram if available_vram is not None else vram
    ram = hardware.get("ram_mib")
    available_ram = hardware.get("ram_available_mib")
    usable_ram = available_ram if available_ram is not None else ram
    cpu_threads = hardware.get("cpu_threads")

    if vram is None:
        gpu = {"status": "Unknown", "available": True, "reason": "GPU memory could not be measured; download remains available."}
    elif usable_vram < (6144 if choice == "higher" else 3584):
        gpu = {"status": "Severely insufficient", "available": False, "reason": "Available graphics memory is below the estimated minimum for this model."}
    elif choice == "standard" and gpu_name and (choice, gpu_name.strip().casefold(), vram) in TESTED_PROFILES:
        gpu = {"status": "Tested", "available": True, "reason": "This model has completed load and generation checks on this graphics profile."}
    else:
        gpu = {"status": "Estimated", "available": True, "reason": "Memory suggests this model may fit; generation has not been verified on this graphics profile."}

    cpu_min = 10240 if choice == "higher" else 6144
    if ram is None:
        cpu = {"status": "Unknown", "available": True, "reason": "System memory could not be measured; CPU download remains available."}
    elif usable_ram < cpu_min:
        cpu = {"status": "Severely insufficient", "available": False, "reason": "System memory is below the estimated minimum for CPU inference."}
    else:
        warning = "CPU generation will be very slow; use Standard on GPU for a balanced experience." if choice == "higher" else "CPU generation will be much slower than GPU generation."
        cpu = {"status": "Estimated", "available": True, "reason": warning}
        if cpu_threads is not None and cpu_threads <= 2:
            cpu["reason"] += " This CPU has few threads, so generation may take many minutes per chunk."

    viable_gpu = gpu["available"] and gpu["status"] != "Unknown"
    viable_cpu = cpu["available"] and cpu["status"] != "Unknown"
    available = bool(viable_gpu or viable_cpu or gpu["status"] == "Unknown" or cpu["status"] == "Unknown")
    if viable_gpu:
        device = "GPU"
        status = gpu["status"]
        reason = gpu["reason"]
    elif viable_cpu:
        device = "CPU"
        status = cpu["status"]
        reason = cpu["reason"]
    else:
        device = "Unknown"
        status = "Unknown"
        reason = "We couldn't check hardware fit. Downloads stay enabled; model loading will verify whether it works."
    return {"available": available, "device": device, "status": status, "reason": reason,
            "gpu": gpu, "cpu": cpu}


def system_snapshot() -> dict[str, Any]:
    result: dict[str, Any] = {"cpu_threads": None, "ram_mib": None, "ram_available_mib": None}
    try:
        import psutil
        result["cpu_threads"] = psutil.cpu_count(logical=True)
        memory = psutil.virtual_memory()
        result["ram_mib"] = round(memory.total / 2**20)
        result["ram_available_mib"] = round(memory.available / 2**20)
    except Exception:
        pass
    return result


def hardware_snapshot() -> dict[str, Any]:
    # GPU detection runs once in the dedicated startup thread and is merged by
    # the route from model state; do not import torch on request threads.
    return {"gpu_name": None, "compute_capability": None, "vram_mib": None,
            "vram_available_mib": None, **system_snapshot()}


def compatibility(choice: str, device: str | None, device_name: str | None,
                  memory_mib: int | None) -> tuple[bool, str | None]:
    """Runtime gate. A successfully loaded model is allowed on its chosen device."""
    if device and device.startswith("cuda"):
        estimate = assess(choice, {"gpu_name": device_name, "vram_mib": memory_mib})["gpu"]
        return estimate["available"], estimate["reason"]
    if device == "cpu":
        return True, None
    return False, "The active compute device is unavailable. Retry model setup."
