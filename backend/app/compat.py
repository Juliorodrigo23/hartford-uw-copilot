"""Platform workarounds. Import (and call) BEFORE any heavy ML import.

macOS arm64: torch and onnxruntime each bundle their own OpenMP runtime
(libomp). Loading both into one process makes the second initialization
segfault SILENTLY (observed: exit 139 with no traceback the moment the
retrieval stack and the rest of the pipeline coexisted). Intel's escape
hatch is KMP_DUPLICATE_LIB_OK; single-threaded OMP avoids the two runtimes'
thread pools fighting. Linux (glibc/libgomp) is unaffected; production runs
in the Linux container where none of this applies.
"""

from __future__ import annotations

import os
import sys


def apply_platform_workarounds() -> None:
    if sys.platform == "darwin":
        os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
        os.environ.setdefault("OMP_NUM_THREADS", "1")
        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
