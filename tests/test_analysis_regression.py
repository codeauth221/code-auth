"""Offline regression checks: no pretrained downloads or real credentials needed.

Run in a fresh Python process with DATABASE_URL=sqlite:// for isolated DB tests.
"""
import importlib
import os
import sys
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

os.environ['DATABASE_URL'] = 'sqlite://'

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from ml import predictor
from backend import analysis
from backend.database import Base
from backend.models import Submission, Lobby, Instructor


class FakeTokenizer:
    mask_token_id = 4
    cls_token_id = 5
    sep_token_id = 6

    def encode(self, code, add_special_tokens=False):
        return [int(v) for v in code.split()]


class FakeEncoder(nn.Module):
    def __init__(self, vocab=768):
        super().__init__()
        self.embedding = nn.Embedding(vocab, 768)
        self.transform = nn.Linear(768, 768)

    def forward(self, input_ids, output_hidden_states=False):
        hidden = self.transform(self.embedding(input_ids))
        return SimpleNamespace(last_hidden_state=hidden)


class FakeMLM(nn.Module):
    def __init__(self, vocab=768):
        super().__init__()
        self.roberta = FakeEncoder(vocab)
        self.lm_head = nn.Linear(768, vocab)

    def forward(self, input_ids, attention_mask=None, output_hidden_states=False):
        hidden = self.roberta(input_ids).last_hidden_state
        return SimpleNamespace(hidden_states=[hidden], logits=self.lm_head(hidden))


def old_feature_reference(code, tokenizer, model):
    """Exact 5-row source algorithm, using a small deterministic fake CodeBERT."""
    tokens = tokenizer.encode(code, add_special_tokens=False)
    chunks = [tokens[i:i+510] for i in range(0,len(tokens),510)][:8]
    if len(chunks) > 1 and len(chunks[-1]) < 20:
        chunks.pop()
    features=[]; weights=[]
    with torch.no_grad():
        for chunk in chunks:
            weights.append(len(chunk))
            inp=[tokenizer.cls_token_id]+chunk+[tokenizer.sep_token_id]
            rows=[list(inp) for _ in range(5)]; all_masked=[]
            for offset in range(4):
                selected=[]
                for pos in range(1,len(inp)-1):
                    if (pos-1)%4==offset:
                        rows[offset+1][pos]=tokenizer.mask_token_id
                        selected.append(pos)
                all_masked.append(selected)
            ids=torch.tensor(rows)
            output=model(input_ids=ids,attention_mask=torch.ones_like(ids),output_hidden_states=True)
            avg=output.hidden_states[-1][0,1:len(inp)-1,:].mean(dim=0).numpy()
            probs=F.log_softmax(output.logits,dim=-1)
            nlls=[]
            for off in range(4):
                for pos in all_masked[off]:
                    nlls.append(-probs[off+1,pos,inp[pos]].item())
            features.append(np.concatenate([avg,np.array([np.mean(nlls),np.std(nlls)])]))
    w=np.array(weights,dtype=float); w/=w.sum()
    return np.sum([f*v for f,v in zip(features,w)],axis=0)


class ModelMemoryTests(unittest.TestCase):
    def test_512mb_rejected_before_loading_model(self):
        with patch.object(predictor, '_container_memory_limit_bytes', return_value=512*1024*1024):
            self.assertFalse(predictor.inference_capacity()['allowed'])
            with self.assertRaisesRegex(predictor.InferenceResourcesUnavailable, '512 MB'):
                predictor.require_inference_capacity()
            # Even when model is cached, we cannot mistakenly load on low-RAM host.
            with self.assertRaises(predictor.InferenceResourcesUnavailable):
                predictor._get_tokenizer_and_model('python')

    def test_4gb_container_admitted(self):
        with patch.object(predictor, '_container_memory_limit_bytes', return_value=4*1024**3):
            self.assertTrue(predictor.inference_capacity()['allowed'])

    def test_model_feature_parity_to_original_algorithm(self):
        torch.manual_seed(7)
        model=FakeMLM().eval()
        tokenizer=FakeTokenizer()
        # Single chunk; multiple chunks; under-20 trailing tokens; eight chunk cap.
        for n in (35, 510, 635, 1025, 4100):
            tokens=[7+(i%600) for i in range(n)]
            code=' '.join(map(str,tokens))
            reference=old_feature_reference(code,tokenizer,model)
            with patch.object(predictor, '_get_tokenizer_and_model', return_value=(tokenizer, model)):
                with patch.object(predictor, 'require_inference_capacity'):
                    actual=predictor.extract_features(code,'python')
            self.assertEqual(actual.shape,(770,))
            np.testing.assert_allclose(actual,reference,atol=5e-6,rtol=1e-6)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session=sessionmaker(bind=self.engine,expire_on_commit=False)
        self.original_session=analysis.SessionLocal
        analysis.SessionLocal=self.Session
        self.broadcast_patch=patch.object(analysis.manager,'broadcast_threadsafe')
        self.broadcast_patch.start()
        self.db=self.Session()
        instr=Instructor(name='Test',email='test@example.invalid',password_hash='dummy')
        self.db.add(instr); self.db.flush()
        self.lobby=Lobby(instructor_id=instr.id,title='Test',subject='Test',language='python',max_students=5,status='ACTIVE',expires_at=datetime.utcnow()+timedelta(hours=2))
        self.db.add(self.lobby); self.db.commit()

    def tearDown(self):
        self.db.close()
        analysis.SessionLocal=self.original_session
        self.broadcast_patch.stop()
        self.engine.dispose()

    def new_submission(self,status='pending',minutes_old=0):
        item=Submission(lobby_id=self.lobby.id,student_id='A',file_name='test.py',language='python',source_code='print(42)',status=status,created_at=datetime.utcnow()-timedelta(minutes=minutes_old))
        self.db.add(item); self.db.commit(); return item.id

    def test_complete_result_and_no_duplicate_analysis(self):
        id=self.new_submission()
        with patch.object(predictor,'analyze',return_value={'ai_probability':0.77,'risk_level':'High'}):
            with patch.object(predictor,'require_inference_capacity'):
                analysis.run_analysis(id)
                analysis.run_analysis(id)
        self.db.expire_all()
        item=self.db.get(Submission,id)
        self.assertEqual(item.status,'done')
        self.assertAlmostEqual(item.ai_probability,0.77)
        self.assertEqual(item.risk_level,'High')

    def test_low_memory_fails_with_explanation_and_without_fake_score(self):
        id=self.new_submission()
        with patch.object(predictor,'require_inference_capacity',side_effect=predictor.InferenceResourcesUnavailable('too little RAM')):
            with patch.object(predictor,'analyze') as model:
                analysis.run_analysis(id)
                model.assert_not_called()
        self.db.expire_all()
        item=self.db.get(Submission,id)
        self.assertEqual(item.status,'failed')
        self.assertIsNone(item.ai_probability)
        self.assertIsNone(item.risk_level)
        self.assertIn('RAM',item.error_message)

    def test_stale_recovery_only_old_unfinished_rows(self):
        stale=self.new_submission('analyzing',90)
        pending=self.new_submission('pending',90)
        done=self.new_submission('done',90)
        recent=self.new_submission('analyzing',2)
        self.assertEqual(analysis.recover_stale_analyses(),2)
        self.db.expire_all()
        self.assertEqual(self.db.get(Submission,stale).status,'failed')
        self.assertEqual(self.db.get(Submission,pending).status,'failed')
        self.assertEqual(self.db.get(Submission,done).status,'done')
        self.assertEqual(self.db.get(Submission,recent).status,'analyzing')
        self.assertEqual(analysis.recover_stale_analyses(),0)

    def test_late_inference_cannot_overwrite_stale_recovery(self):
        id=self.new_submission('pending',90)
        def simulate_very_slow_model(code, filename):
            self.assertEqual(analysis.recover_stale_analyses(),1)
            return {'ai_probability':0.12,'risk_level':'Low'}
        with patch.object(predictor,'require_inference_capacity'):
            with patch.object(predictor,'analyze',side_effect=simulate_very_slow_model):
                analysis.run_analysis(id)
        self.db.expire_all()
        item=self.db.get(Submission,id)
        self.assertEqual(item.status,'failed')
        self.assertIsNone(item.ai_probability)

if __name__=='__main__':
    unittest.main(verbosity=2)
