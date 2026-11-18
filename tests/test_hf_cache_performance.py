"""Offline tests: no model downloads, DB changes or trained head access."""
import os
import unittest
import sys
import types
import torch
from unittest.mock import patch
from ml import predictor as p


class Factory:
    def __init__(self, fail_locally=False):
        self.fail_locally = fail_locally
        self.calls = []

    def from_pretrained(self, model_id, **kwargs):
        self.calls.append((model_id, kwargs))
        if self.fail_locally and kwargs.get('local_files_only'):
            raise OSError('Cache missing')
        return {'model_id': model_id, 'kwargs': kwargs}


class LocalCacheTests(unittest.TestCase):
    def test_cached_model_never_attempts_hub(self):
        factory = Factory()
        value = p._prefer_local_hf_cache(factory, 'neulab/codebert-c', device_map='auto')
        self.assertEqual(len(factory.calls), 1)
        self.assertTrue(value['kwargs']['local_files_only'])
        self.assertEqual(value['kwargs']['device_map'], 'auto')

    def test_cache_miss_falls_back_only_once(self):
        factory = Factory(fail_locally=True)
        value = p._prefer_local_hf_cache(factory, 'neulab/codebert-java')
        self.assertEqual(len(factory.calls), 2)
        self.assertTrue(factory.calls[0][1]['local_files_only'])
        self.assertNotIn('local_files_only', factory.calls[1][1])
        self.assertEqual(value['model_id'], 'neulab/codebert-java')

    def test_default_device_preserved(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(p._model_device_preference(), 'auto')

    def test_explicit_device_preferences(self):
        for value in ('auto', 'cpu', 'cuda'):
            with self.subTest(value=value), patch.dict(os.environ, {'CODEAUTHENTIC_MODEL_DEVICE': value}):
                self.assertEqual(p._model_device_preference(), value)
        with patch.dict(os.environ, {'CODEAUTHENTIC_MODEL_DEVICE': 'bad'}):
            with self.assertRaisesRegex(ValueError, 'CODEAUTHENTIC_MODEL_DEVICE'):
                p._model_device_preference()

    def test_cpu_placement_disables_auto_offload(self):
        class FakeModel(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.layer = torch.nn.Linear(2, 2)
            @classmethod
            def from_pretrained(cls, model_id, **kwargs):
                cls.kwargs = kwargs
                return cls()

        fake_transformers = types.ModuleType('transformers')
        fake_transformers.AutoModelForMaskedLM = FakeModel
        with patch.dict(sys.modules, {'transformers': fake_transformers}), \
             patch.dict(os.environ, {'CODEAUTHENTIC_MODEL_DEVICE': 'cpu'}):
            model = p._load_frozen_model('neulab/codebert-c')
        self.assertNotIn('device_map', FakeModel.kwargs)
        self.assertFalse(model.training)
        self.assertTrue(all(not x.requires_grad for x in model.parameters()))
        self.assertEqual(next(model.parameters()).device.type, 'cpu')

    def test_auto_placement_keeps_original_device_map(self):
        class FakeModel(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.layer = torch.nn.Linear(2, 2)
            @classmethod
            def from_pretrained(cls, model_id, **kwargs):
                cls.kwargs = kwargs
                return cls()

        fake_transformers = types.ModuleType('transformers')
        fake_transformers.AutoModelForMaskedLM = FakeModel
        with patch.dict(sys.modules, {'transformers': fake_transformers}), \
             patch.dict(os.environ, {'CODEAUTHENTIC_MODEL_DEVICE': 'auto'}):
            model = p._load_frozen_model('neulab/codebert-c')
        self.assertEqual(FakeModel.kwargs['device_map'], 'auto')
        self.assertFalse(model.training)

    def test_perf_trace_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(p._timing_enabled())


if __name__ == '__main__':
    unittest.main()
