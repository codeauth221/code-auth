"""
CodeAuthentic - ML Predictor Module.
Feature extraction and AI probability inference using frozen CodeBERT representations.
Computes a 770-dimensional feature vector:
- 768-dim: mean-pooled last hidden state of unmasked tokens
- 2-dim: mean and std of masked-token negative log-likelihood (perplexity signal)
Passes features through fitted StandardScaler + LogisticRegression head.
"""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
from typing import Dict, Optional, Tuple
import numpy as np

# Risk level classification thresholds
RISK_LOW_MAX = 0.40
RISK_MEDIUM_MAX = 0.70
MIN_TOKENS = 30

EXT_TO_LANG = {
    ".c": "c",
    ".java": "java",
    ".py": "python",
}

MODEL_IDS = {
    "c": "neulab/codebert-c",
    "java": "neulab/codebert-java",
    "python": "neulab/codebert-python",
}

# Cache for loaded tokenizers and models
_TOKENIZERS: Dict[str, any] = {}
_MODELS: Dict[str, any] = {}
_HEADS: Dict[str, any] = {}

HEADS_DIR = Path(__file__).resolve().parent / "heads"
CANDIDATES_DIR = Path(__file__).resolve().parent / "candidates"
# Strictly opt-in for a LOCAL Python pilot. Production still reads ml/heads.
# The candidate is checked against its evaluation report and SHA-256 as usual.
PYTHON_TEST_MODE_ENV = "CODEAUTHENTIC_PYTHON_TEST_MODE"


def _experimental_python(language: str) -> bool:
    return language == "python" and os.getenv(PYTHON_TEST_MODE_ENV, "").strip() == "1"


def _head_directory(language: str) -> Path:
    return CANDIDATES_DIR if _experimental_python(language) else HEADS_DIR


def _head_cache_key(language: str) -> str:
    # Prevent a head loaded from one location being reused if the mode changes.
    return f"{language}:{_head_directory(language).resolve()}"


class InferenceResourcesUnavailable(RuntimeError):
    """The hosting container cannot safely start full CodeBERT inference."""


def _container_memory_limit_bytes() -> int | None:
    """Best-effort cgroup v2/v1 hard limit; no heavy imports or network requests.

    This is only a deployment admission guard, not a measurement of peak model RAM.
    On bare-metal Windows machines these files do not exist, so inference proceeds.
    """
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            value = Path(path).read_text(encoding="ascii").strip()
            if value == "max":
                continue
            limit = int(value)
            # cgroups sometimes use an enormous sentinel to mean unlimited.
            if 0 < limit < 1 << 60:
                return limit
        except (OSError, ValueError):
            continue
    return None


def inference_capacity() -> dict:
    """Report hosting constraints without loading the multi-hundred-MB model."""
    disabled = os.getenv("CODEAUTHENTIC_DISABLE_ML_INFERENCE", "").strip().lower() in (
        "1", "true", "yes"
    )
    try:
        minimum_mb = max(1024, int(os.getenv("CODEAUTHENTIC_MIN_INFERENCE_MEMORY_MB", "2048")))
    except ValueError:
        minimum_mb = 2048
    limit = _container_memory_limit_bytes()
    limit_mb = None if limit is None else round(limit / (1024 * 1024))
    allowed = not disabled and (limit is None or limit >= minimum_mb * 1024 * 1024)
    if disabled:
        reason = "ML inference is disabled by CODEAUTHENTIC_DISABLE_ML_INFERENCE."
    elif not allowed:
        reason = (
            f"CodeBERT inference disabled on this {limit_mb} MB instance: "
            f"a minimum {minimum_mb} MB container budget is configured. "
            "Use a separate ML worker or a larger instance; no prediction was generated."
        )
    else:
        reason = None
    return {
        "allowed": allowed,
        "container_memory_limit_mb": limit_mb,
        "configured_minimum_mb": minimum_mb,
        "reason": reason,
        "note": "Admission control only, not proof that inference will fit or complete.",
    }


def require_inference_capacity() -> None:
    """Fail before loading Torch/CodeBERT on demonstrably undersized containers."""
    capacity = inference_capacity()
    if not capacity["allowed"]:
        raise InferenceResourcesUnavailable(capacity["reason"])


class CodeTooShortError(Exception):
    """Raised when submitted code contains fewer than 30 tokens."""
    pass


class HeadNotTrainedError(Exception):
    """Raised when the scikit-learn classifier head for a language has not been fitted."""
    pass


def _verified_head_report(language: str) -> dict:
    """Verify candidate promotion evidence BEFORE unpickling a classifier.

    This is an integrity/quality check, not a security signature. Only load
    .joblib artifacts produced in a trusted environment.
    """
    head_dir = _head_directory(language)
    path = head_dir / f"{language}.joblib"
    report_path = head_dir / f"{language}.json"
    if not path.is_file() or path.stat().st_size == 0:
        raise HeadNotTrainedError(
            f"No evaluated AI-authorship classifier is available for {language} in {head_dir}. "
            "Frozen CodeBERT alone is not an AI-code detector. "
            "Import real labeled samples, train and evaluate a head, then explicitly activate it."
        )
    if not report_path.is_file():
        raise HeadNotTrainedError(
            f"{language} classifier file exists but its evaluation report is missing "
            f"(expected {report_path}). Do not use unverified AI-authorship scores."
        )
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        from ml.train_head import FEATURE_VERSION
        if report.get("language") != language or report.get("model_id") != MODEL_IDS[language]:
            raise ValueError("classifier report model/language mismatch")
        if report.get("feature_version") != FEATURE_VERSION or not report.get("group_disjoint_splits") or report.get("grouping_method") != "Problem_id":
            raise ValueError("classifier lacks matching features or problem-level holdout evaluation")
        if report.get("candidate_sha256") != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError("classifier checksum mismatch")
        test = report["test_metrics"]
        if test.get("human_samples", 0) < 20 or test.get("ai_samples", 0) < 20:
            raise ValueError("classifier needs at least 20 held-out examples per class")
        if test.get("human_false_positive_rate", 1) > 0.15 or test.get("ai_f1", 0) < 0.70:
            raise ValueError("held-out quality criteria were not met")
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise HeadNotTrainedError(f"{language} classifier evaluation/integrity failed: {exc}") from exc
    return report


def model_readiness() -> dict:
    """Offline readiness: one language can be active while others await training."""
    required = ("numpy", "torch", "transformers", "joblib", "sklearn")
    dependencies = {name: importlib.util.find_spec(name) is not None for name in required}
    heads = {}
    for lang in MODEL_IDS:
        available = (_head_directory(lang) / f"{lang}.joblib").is_file()
        experimental = _experimental_python(lang)
        try:
            _verified_head_report(lang)
            verified = True
            problem = None
        except HeadNotTrainedError as exc:
            verified = False
            problem = str(exc)
        heads[lang] = {"file_present": available, "evaluated_head_present": verified,
                       "loaded_in_process": _head_cache_key(lang) in _HEADS,
                       "model_loaded_in_process": lang in _MODELS,
                       "experimental": experimental,
                       "source": "candidate" if experimental else "active",
                       "issue": problem}
    ready = [lang for lang in MODEL_IDS if heads[lang]["evaluated_head_present"] and all(dependencies.values())]
    experimental_ready = [lang for lang in ready if heads[lang]["experimental"]]
    capacity = inference_capacity()
    return {"dependencies": dependencies, "languages": heads, "ready_languages": ready,
            "experimental_languages": experimental_ready,
            "active_languages": [lang for lang in ready if lang not in experimental_ready],
            "ready_for_inference_attempt": len(ready) == len(MODEL_IDS) and capacity["allowed"],
            "inference_capacity": capacity,
            "note": "Readiness verifies classifier files, reports and dependencies, NOT successful inference. "
                    "Check inference_capacity before submitting; results are not proof of authorship. "
                    "Use ml.verify_pipeline --file for an end-to-end inference test."}


def _get_trained_head(language: str):
    """Return the real fitted head; reject missing or incompatible artifacts."""
    import joblib

    if language not in MODEL_IDS:
        raise ValueError(f"Unsupported language: {language}")
    # Prevent loading random unverified .joblib files or plain MLM checkpoints.
    _verified_head_report(language)
    head_path = _head_directory(language) / f"{language}.joblib"
    cache_key = _head_cache_key(language)
    if cache_key not in _HEADS:
        # joblib files are pickles; load only classifier artifacts created by this project.
        _HEADS[cache_key] = joblib.load(head_path)
    head = _HEADS[cache_key]
    classes = list(getattr(head, "classes_", []))
    if sorted(classes) != [0, 1] or not hasattr(head, "predict_proba"):
        raise ValueError(f"Trained classifier for '{language}' must have human=0 and AI=1 classes.")
    feature_count = getattr(head, "n_features_in_", None)
    if feature_count is not None and int(feature_count) != 770:
        raise ValueError(f"Trained classifier for '{language}' expects {feature_count} features, not 770.")
    return head


def preload_models() -> None:
    """
    Loads all three CodeBERT models and tokenizers into memory.
    Optional helper for dedicated ML workers; not called during normal FastAPI startup.
    """
    require_inference_capacity()
    import torch
    from transformers import AutoModelForMaskedLM, AutoTokenizer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[PRELOAD] Loading CodeBERT models on device: {device}")

    for lang, model_id in MODEL_IDS.items():
        if lang not in _TOKENIZERS:
            print(f"[PRELOAD] Loading tokenizer for {lang} ({model_id})...")
            _TOKENIZERS[lang] = AutoTokenizer.from_pretrained(model_id)

        if lang not in _MODELS:
            print(f"[PRELOAD] Loading model weights for {lang} ({model_id})...")
            try:
                model = AutoModelForMaskedLM.from_pretrained(model_id, device_map="auto")
            except Exception:
                model = AutoModelForMaskedLM.from_pretrained(model_id).to(device)
            model.eval()
            # Freeze all weights - study does NOT fine-tune CodeBERT weights
            for param in model.parameters():
                param.requires_grad = False
            _MODELS[lang] = model

    print("[PRELOAD] All CodeBERT models loaded and frozen successfully.")


def _get_tokenizer_and_model(language: str):
    """Retrieves or lazily initializes the tokenizer and model for a language."""
    require_inference_capacity()
    import torch
    from transformers import AutoModelForMaskedLM, AutoTokenizer

    if language not in _TOKENIZERS or language not in _MODELS:
        model_id = MODEL_IDS.get(language)
        if not model_id:
            raise ValueError(f"Unsupported language: {language}")

        if language not in _TOKENIZERS:
            _TOKENIZERS[language] = AutoTokenizer.from_pretrained(model_id)

        if language not in _MODELS:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            try:
                model = AutoModelForMaskedLM.from_pretrained(model_id, device_map="auto")
            except Exception:
                model = AutoModelForMaskedLM.from_pretrained(model_id).to(device)
            model.eval()
            for param in model.parameters():
                param.requires_grad = False
            _MODELS[language] = model

    return _TOKENIZERS[language], _MODELS[language]


def count_tokens(code: str, language: str, *, local_files_only: bool = False) -> int:
    """Count real CodeBERT tokens; viewer may require local cache to avoid network delays."""
    if language not in MODEL_IDS:
        raise ValueError(f"Unsupported language: {language}")
    if language not in _TOKENIZERS:
        from transformers import AutoTokenizer
        _TOKENIZERS[language] = AutoTokenizer.from_pretrained(
            MODEL_IDS[language], local_files_only=local_files_only
        )
    return len(_TOKENIZERS[language].encode(code, add_special_tokens=False))


def check_context(code: str, language: str) -> int:
    """Validate a code submission against the real 30-token requirement."""
    token_count = count_tokens(code, language)
    if token_count < MIN_TOKENS:
        raise CodeTooShortError(
            f"Code is too short ({token_count} tokens). Minimum required is {MIN_TOKENS} tokens."
        )
    return token_count


def _mask_batch_size() -> int:
    """Number of masked offsets encoded together (1: lowest RAM, 4: fastest candidate).

    This is a runtime setting only. It does not change the trained 770-feature
    definition, the masking positions, the chunk limit or classifier weights.
    """
    value = os.getenv("CODEAUTHENTIC_MASK_BATCH_SIZE", "2").strip()
    if value not in ("1", "2", "4"):
        raise ValueError(
            "CODEAUTHENTIC_MASK_BATCH_SIZE must be 1, 2 or 4; "
            "use 1 to minimize RAM or benchmark 2 and 4 locally."
        )
    return int(value)


def extract_features(code: str, language: str) -> np.ndarray:
    """Original 770-feature CodeBERT representation with bounded masked batching.

    Each chunk uses the original unmasked mean-pooled 768 hidden units and the
    four original masked-token offset groups to compute NLL mean/std. No chunk
    truncation, offset subsampling, model changes, or classifier retraining.

    We encode the masked offsets in small groups so Torch can amortize encoder
    dispatch overhead. Crucially, the vocabulary head operates ONLY on tokens
    that were masked, avoiding the old [5, 512, vocab] memory spike.

    CODEAUTHENTIC_MASK_BATCH_SIZE=1|2|4 (default 2). Increasing the group size
    can be faster, particularly on a GPU, but costs more RAM and is not
    guaranteed to help on every CPU. Always benchmark on your actual machine.
    """
    import torch

    require_inference_capacity()
    batch_size = _mask_batch_size()
    tokenizer, model = _get_tokenizer_and_model(language)
    if not hasattr(model, "roberta") or not hasattr(model, "lm_head"):
        raise RuntimeError("Unsupported CodeBERT architecture for feature extraction.")
    device = next(model.parameters()).device

    # Preserve the training extractor's exact tokenization and 8-chunk cap.
    tokens = tokenizer.encode(code, add_special_tokens=False)
    if len(tokens) < MIN_TOKENS:
        raise CodeTooShortError(f"Code contains {len(tokens)} tokens, fewer than {MIN_TOKENS} minimum.")
    chunks = [tokens[i:i + 510] for i in range(0, len(tokens), 510)][:8]
    if len(chunks) > 1 and len(chunks[-1]) < 20:
        chunks.pop()

    chunk_features = []
    chunk_weights = []
    mask_token_id = tokenizer.mask_token_id or 103
    cls_token_id = tokenizer.cls_token_id or 0
    sep_token_id = tokenizer.sep_token_id or 2

    with torch.inference_mode():
        for chunk in chunks:
            chunk_weights.append(len(chunk))
            input_seq = [cls_token_id] + chunk + [sep_token_id]
            seq_len = len(input_seq)

            # Unmasked row: identical mean pooling over nonspecial token states.
            unmasked_ids = torch.tensor([input_seq], dtype=torch.long, device=device)
            hidden = model.roberta(input_ids=unmasked_ids, output_hidden_states=False).last_hidden_state
            mean_hidden = hidden[0, 1:seq_len - 1, :].mean(dim=0).cpu().numpy()
            del hidden, unmasked_ids

            # Gather NLLs in the SAME order as the original four-offset feature.
            nlls = []
            for start in range(0, 4, batch_size):
                offset_batch = range(start, min(4, start + batch_size))
                positions_batch = []
                rows = []
                for offset in offset_batch:
                    positions = list(range(1 + offset, seq_len - 1, 4))
                    positions_batch.append(positions)
                    masked_ids = list(input_seq)
                    for pos in positions:
                        masked_ids[pos] = mask_token_id
                    rows.append(masked_ids)

                masked_tensor = torch.tensor(rows, dtype=torch.long, device=device)
                masked_hidden = model.roberta(
                    input_ids=masked_tensor, output_hidden_states=False
                ).last_hidden_state

                # Do not compute all-token MLM logits. Evaluate only masked positions.
                for row_index, positions in enumerate(positions_batch):
                    if not positions:
                        continue
                    position_ids = torch.tensor(positions, dtype=torch.long, device=device)
                    selected_hidden = masked_hidden[row_index].index_select(0, position_ids)
                    logits = model.lm_head(selected_hidden)
                    true_token_ids = torch.tensor(
                        [input_seq[pos] for pos in positions], dtype=torch.long, device=logits.device
                    ).unsqueeze(1)
                    # Mathematically identical to -log_softmax(logits)[true_token],
                    # without materializing another full-vocabulary log-prob tensor.
                    selected_nll = (
                        torch.logsumexp(logits, dim=-1)
                        - logits.gather(1, true_token_ids).squeeze(1)
                    )
                    nlls.extend(selected_nll.cpu().tolist())
                    del position_ids, selected_hidden, logits, true_token_ids, selected_nll
                del masked_tensor, masked_hidden

            nll_mean = float(np.mean(nlls)) if nlls else 0.0
            nll_std = float(np.std(nlls)) if nlls else 0.0
            chunk_features.append(np.concatenate([mean_hidden, np.array([nll_mean, nll_std])]))

    weights = np.asarray(chunk_weights, dtype=float)
    weights /= weights.sum()
    return np.sum([feat * w for feat, w in zip(chunk_features, weights)], axis=0)


def predict(code: str, language: str) -> float:
    """Run the trained real classifier on a 770-dimensional CodeBERT vector."""
    head = _get_trained_head(language)
    features = extract_features(code, language)
    if features.shape != (770,) or not np.all(np.isfinite(features)):
        raise ValueError("CodeBERT returned invalid or incomplete features; analysis was not scored.")
    probabilities = head.predict_proba(features.reshape(1, -1))
    ai_index = list(head.classes_).index(1)
    ai_prob = float(probabilities[0, ai_index])
    if not np.isfinite(ai_prob) or not 0.0 <= ai_prob <= 1.0:
        raise ValueError("Classifier returned an invalid probability; analysis was not scored.")
    return ai_prob


def risk_level(score: float) -> str:
    """Classifies risk level based on AI generation probability."""
    if score < RISK_LOW_MAX:
        return "Low"
    elif score < RISK_MEDIUM_MAX:
        return "Medium"
    else:
        return "High"


def analyze(code: str, filename: str) -> Dict[str, any]:
    """
    Public entry point for source code submission analysis.
    Returns: {"language": str, "ai_probability": float, "risk_level": str}
    """
    _, ext = os.path.splitext(filename.lower())
    language = EXT_TO_LANG.get(ext)
    if not language:
        raise ValueError(f"Unsupported file extension '{ext}'. Allowed: .c, .java, .py")

    # Confirm trained head availability before downloading heavyweight CodeBERT weights.
    _get_trained_head(language)

    # Verify context length
    check_context(code, language)

    # Run prediction
    score = predict(code, language)
    risk = risk_level(score)

    return {
        "language": language,
        "ai_probability": round(score, 4),
        "risk_level": risk,
    }
