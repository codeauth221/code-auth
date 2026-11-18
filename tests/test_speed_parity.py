"""Offline parity tests for CodeAuthentic masked-offset batching.

These tests do not load CodeBERT weights, touch Supabase or access the network.
Run: python -m unittest tests.test_speed_parity -v
"""
import os
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from ml import predictor


class TinyTokenizer:
    mask_token_id = 4
    cls_token_id = 5
    sep_token_id = 6
    def encode(self, code, add_special_tokens=False):
        return [int(i) for i in code.split()]


class TinyEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding = nn.Embedding(1024, 768)
        self.fc = nn.Linear(768, 768)
    def forward(self, input_ids, output_hidden_states=False):
        return SimpleNamespace(last_hidden_state=self.fc(self.embedding(input_ids)))


class TinyMLM(nn.Module):
    def __init__(self):
        super().__init__()
        self.roberta = TinyEncoder()
        self.lm_head = nn.Linear(768, 128)
    def forward(self, input_ids, attention_mask=None, output_hidden_states=False):
        h = self.roberta(input_ids).last_hidden_state
        return SimpleNamespace(hidden_states=[h], logits=self.lm_head(h))


def original_reference(code, tokenizer, model):
    tokens = tokenizer.encode(code, add_special_tokens=False)
    chunks = [tokens[i:i + 510] for i in range(0, len(tokens), 510)][:8]
    if len(chunks) > 1 and len(chunks[-1]) < 20:
        chunks.pop()
    features, weights = [], []
    with torch.no_grad():
        for chunk in chunks:
            weights.append(len(chunk))
            seq = [tokenizer.cls_token_id] + chunk + [tokenizer.sep_token_id]
            rows = [list(seq) for _ in range(5)]
            groups = []
            for offset in range(4):
                positions = list(range(1 + offset, len(seq) - 1, 4))
                for pos in positions:
                    rows[offset + 1][pos] = tokenizer.mask_token_id
                groups.append(positions)
            ids = torch.tensor(rows, dtype=torch.long)
            out = model(input_ids=ids, attention_mask=torch.ones_like(ids), output_hidden_states=True)
            mean_hidden = out.hidden_states[-1][0, 1:-1, :].mean(0).numpy()
            logprobs = F.log_softmax(out.logits, dim=-1)
            nlls = [-logprobs[offset+1, pos, seq[pos]].item()
                    for offset, positions in enumerate(groups) for pos in positions]
            features.append(np.concatenate([mean_hidden, np.array([np.mean(nlls), np.std(nlls)])]))
    weights = np.array(weights, dtype=float)
    weights /= weights.sum()
    return np.sum([f * weight for f, weight in zip(features, weights)], axis=0)


class MaskBatchCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.previous_threads = torch.get_num_threads()
        torch.set_num_threads(2)
        torch.manual_seed(12)
        cls.model = TinyMLM().eval()
        cls.tokenizer = TinyTokenizer()

    @classmethod
    def tearDownClass(cls):
        torch.set_num_threads(cls.previous_threads)

    def run_case(self, count, batch):
        values = [7 + (i % 120) for i in range(count)]
        code = ' '.join(map(str, values))
        expected = original_reference(code, self.tokenizer, self.model)
        with patch.dict(os.environ, {'CODEAUTHENTIC_MASK_BATCH_SIZE': str(batch)}), \
             patch.object(predictor, '_get_tokenizer_and_model', return_value=(self.tokenizer, self.model)), \
             patch.object(predictor, 'require_inference_capacity'):
            result = predictor.extract_features(code, 'c')
        self.assertEqual(result.shape, (770,))
        np.testing.assert_allclose(result, expected, atol=5e-6, rtol=1e-6)

    def test_one_chunk_all_batch_sizes(self):
        for batch in (1, 2, 4):
            with self.subTest(batch=batch):
                self.run_case(133, batch)

    def test_multiple_chunks_all_batch_sizes(self):
        for batch in (1, 2, 4):
            with self.subTest(batch=batch):
                self.run_case(620, batch)

    def test_short_trailing_chunk_discarded(self):
        self.run_case(521, 4)

    def test_invalid_batch_settings_fail_closed(self):
        for setting in ('0', '3', '-1', '100', 'auto'):
            with self.subTest(setting=setting):
                with patch.dict(os.environ, {'CODEAUTHENTIC_MASK_BATCH_SIZE': setting}), \
                     patch.object(predictor, 'require_inference_capacity'):
                    with self.assertRaisesRegex(ValueError, 'CODEAUTHENTIC_MASK_BATCH_SIZE'):
                        predictor.extract_features('7 '*40, 'python')


if __name__ == '__main__':
    unittest.main(verbosity=2)
