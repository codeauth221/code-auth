"""Configuration for an opt-in remote inference queue. Local mode is unchanged."""
import os


def remote_mode() -> bool:
    value = os.getenv("CODEAUTHENTIC_ANALYSIS_MODE", "local").strip().lower()
    if value not in {"local", "remote"}:
        raise RuntimeError("CODEAUTHENTIC_ANALYSIS_MODE must be 'local' or 'remote'.")
    return value == "remote"
