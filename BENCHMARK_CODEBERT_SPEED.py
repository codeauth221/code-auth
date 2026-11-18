r"""Benchmark safe CodeBERT masked batching on the local machine.

Example (PowerShell, from project root):
    python .\BENCHMARK_CODEBERT_SPEED.py --language c --file .\codeauthentic_c_smoke_test.c

The checkpoint is loaded once, then kept cached in this process. This does not
modify your database, train a model or submit any files. Run on localhost with
sufficient free RAM; never run this test on a 512 MB Render Free instance.
"""
from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

import numpy as np
from ml import predictor as p


def timed(code: str, language: str, size: int):
    os.environ['CODEAUTHENTIC_MASK_BATCH_SIZE'] = str(size)
    started = time.perf_counter()
    feature = p.extract_features(code, language)
    return time.perf_counter() - started, feature


def main():
    parser = argparse.ArgumentParser(description='Benchmark CodeBERT masking batches (no training).')
    parser.add_argument('--language', choices=('c', 'java', 'python'), required=True)
    parser.add_argument('--file', type=Path, required=True)
    args = parser.parse_args()
    code = args.file.read_text(encoding='utf-8-sig')
    old_setting = os.environ.get('CODEAUTHENTIC_MASK_BATCH_SIZE')
    try:
        print('Loading CodeBERT once (first load may be slow)...', flush=True)
        p._get_tokenizer_and_model(args.language)
        print(f'Benchmarking {args.language} / {args.file.name}; exact original 770-feature definition.', flush=True)
        baseline = None
        measurements = []
        for size in (1, 2, 4):
            duration, features = timed(code, args.language, size)
            if baseline is None:
                baseline = features
                max_delta = 0.0
            else:
                max_delta = float(np.max(np.abs(baseline - features)))
                np.testing.assert_allclose(baseline, features, atol=1e-4, rtol=1e-4)
            head = p._get_trained_head(args.language)
            ai_col = list(head.classes_).index(1)
            score = float(head.predict_proba(features.reshape(1,-1))[0, ai_col])
            measurements.append((size, duration, score))
            print(f'batch={size}: {duration:.2f}s, probability={score:.6f}, '
                  f'max feature delta vs batch 1={max_delta:.8f}', flush=True)
        fastest = min(measurements, key=lambda item: item[1])
        print(f'Fastest for THIS run: batch={fastest[0]} ({fastest[1]:.2f}s). '
              f'For reliable tuning, repeat the benchmark under normal load.')
        print('Apply locally with: $env:CODEAUTHENTIC_MASK_BATCH_SIZE = "' + str(fastest[0]) + '"')
        print('Restart the backend after changing this environment variable.')
    finally:
        if old_setting is None:
            os.environ.pop('CODEAUTHENTIC_MASK_BATCH_SIZE', None)
        else:
            os.environ['CODEAUTHENTIC_MASK_BATCH_SIZE'] = old_setting


if __name__ == '__main__':
    main()
