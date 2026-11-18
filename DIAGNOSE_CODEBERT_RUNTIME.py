"""Measure actual first-use CodeBERT latency in one isolated local process.

Run in project root, virtualenv active (NOT Render Free):
  python DIAGNOSE_CODEBERT_RUNTIME.py --language c --file codeauthentic_c_smoke_test.c

Use separate invocations for each CODEAUTHENTIC_MODEL_DEVICE setting. Run while
local backend is stopped to avoid concurrent models and misleading timings.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
from time import perf_counter


def step(label, func):
    started = perf_counter()
    result = func()
    print(f"{label}: {perf_counter() - started:.2f}s", flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description="Local CodeBERT cold/warm latency diagnostic")
    parser.add_argument('--language', choices=['c', 'java', 'python'], required=True)
    parser.add_argument('--file', type=Path, required=True)
    args = parser.parse_args()
    if not args.file.is_file():
        parser.error('File does not exist: ' + str(args.file))
    os.environ.setdefault('CODEAUTHENTIC_PERF_TRACE', '1')
    from ml import predictor as p
    import torch
    code = args.file.read_text(encoding='utf-8-sig')
    print('Language:', args.language)
    print('Placement:', os.getenv('CODEAUTHENTIC_MODEL_DEVICE', 'auto'))
    print('Mask batch:', os.getenv('CODEAUTHENTIC_MASK_BATCH_SIZE', '2'))
    print('PyTorch threads:', torch.get_num_threads())
    print('CUDA available:', torch.cuda.is_available())
    step('Classifier initialization', lambda: p._get_trained_head(args.language))
    step('Tokenizer initialization and token count', lambda: p.check_context(code, args.language))
    _, model = step('Model initialization', lambda: p._get_tokenizer_and_model(args.language))
    device_map = getattr(model, 'hf_device_map', None)
    if isinstance(device_map, dict):
        placements = sorted({str(device) for device in device_map.values()})
        print('Model placement locations:', ', '.join(placements), flush=True)
        if 'disk' in placements:
            print('WARNING: Some model layers are disk-offloaded. Benchmark explicit CPU placement.', flush=True)
    for n in (1, 2):
        result = step('Complete warm inference #' + str(n), lambda: p.analyze(code, args.file.name))
        print(f"Result #{n}: language={result['language']} risk={result['risk_level']} score={result['ai_probability']:.4f}", flush=True)
    print('Complete. Results are statistical estimates, not proof of authorship.')


if __name__ == '__main__':
    main()
