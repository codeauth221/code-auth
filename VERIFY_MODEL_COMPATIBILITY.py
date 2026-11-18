"""Compare original (5-row) and optimized CodeBERT features on your own laptop.

Run AFTER C training finishes, from your project root using the trained models:
    python VERIFY_MODEL_COMPATIBILITY.py --language python
    python VERIFY_MODEL_COMPATIBILITY.py --language java

This is an optional but strongly recommended pre-deployment parity check.
It intentionally loads pretrained CodeBERT and the original memory-heavy 5-row
method for one short sample. Do NOT run it on a 512 MB server.
"""
import argparse
import numpy as np

from ml import predictor as p

# A small real Python/Java sample with >30 CodeBERT tokens.
SAMPLES = {
    "python": """
def median(values):
    if not values:
        return None
    numbers = sorted(values)
    middle = len(numbers) // 2
    if len(numbers) % 2 == 1:
        return numbers[middle]
    return (numbers[middle - 1] + numbers[middle]) / 2
print(median([7, 4, 2, 9, 11]))
""",
    "java": """
public class MedianDemo {
    public static int sumEven(int[] values) {
        int total = 0;
        for (int value : values) {
            if (value % 2 == 0) {
                total += value;
            }
        }
        return total;
    }
    public static void main(String[] args) {
        System.out.println(sumEven(new int[]{1, 2, 3, 4, 5, 6}));
    }
}
""",
    "c": """
#include <stdio.h>
int sum_even(int *values, int size) {
    int result = 0;
    for (int i = 0; i < size; ++i) {
        if (values[i] % 2 == 0) result += values[i];
    }
    return result;
}
int main(void) {
    int values[] = {1, 2, 3, 4, 5, 6};
    printf("%d\\n", sum_even(values, 6));
    return 0;
}
""",
}


def reference_features(code, tokenizer, model):
    import torch
    import torch.nn.functional as F
    tokens = tokenizer.encode(code, add_special_tokens=False)
    if len(tokens) < p.MIN_TOKENS:
        raise RuntimeError('Test sample is too short')
    chunks = [tokens[i:i + 510] for i in range(0, len(tokens), 510)][:8]
    if len(chunks) > 1 and len(chunks[-1]) < 20:
        chunks.pop()
    device = next(model.parameters()).device
    mask = tokenizer.mask_token_id or 103
    cls = tokenizer.cls_token_id or 0
    sep = tokenizer.sep_token_id or 2
    all_features, weights = [], []
    with torch.no_grad():
        for chunk in chunks:
            weights.append(len(chunk))
            seq = [cls] + chunk + [sep]
            rows = [list(seq) for _ in range(5)]
            positions_by_offset = []
            for offset in range(4):
                positions = []
                for pos in range(1, len(seq) - 1):
                    if (pos - 1) % 4 == offset:
                        rows[offset + 1][pos] = mask
                        positions.append(pos)
                positions_by_offset.append(positions)
            ids = torch.tensor(rows, dtype=torch.long, device=device)
            output = model(input_ids=ids, attention_mask=torch.ones_like(ids), output_hidden_states=True)
            mean_hidden = output.hidden_states[-1][0, 1:len(seq)-1, :].mean(0).cpu().numpy()
            log_probs = F.log_softmax(output.logits, dim=-1)
            nlls = []
            for offset in range(4):
                for pos in positions_by_offset[offset]:
                    nlls.append(-log_probs[offset + 1, pos, seq[pos]].item())
            all_features.append(np.concatenate([mean_hidden, np.array([np.mean(nlls), np.std(nlls)])]))
    weights = np.asarray(weights, dtype=float); weights /= weights.sum()
    return np.sum([feat * w for feat, w in zip(all_features, weights)], axis=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--language', choices=list(SAMPLES), required=True)
    args = parser.parse_args()
    code = SAMPLES[args.language]
    tokenizer, model = p._get_tokenizer_and_model(args.language)
    reference = reference_features(code, tokenizer, model)
    actual = p.extract_features(code, args.language)
    difference = float(np.max(np.abs(reference - actual)))
    print(f'{args.language}: 770-feature max absolute difference: {difference:.8f}')
    np.testing.assert_allclose(reference, actual, atol=1e-4, rtol=1e-4)
    print('PASS: Optimized features match the original extractor within tolerance.')
    try:
        head = p._get_trained_head(args.language)
        proba_old = float(head.predict_proba(reference.reshape(1,-1))[0, list(head.classes_).index(1)])
        proba_new = float(head.predict_proba(actual.reshape(1,-1))[0, list(head.classes_).index(1)])
        print(f'AI probability: old={proba_old:.6f} optimized={proba_new:.6f} delta={abs(proba_old-proba_new):.6f}')
        assert abs(proba_old-proba_new) < 0.01, 'Classifier probability changed by >= 1 percentage point'
        print('PASS: Trained classifier predictions agree within 1 percentage point.')
    except p.HeadNotTrainedError:
        print('Classifier not activated; only feature parity checked.')

if __name__ == '__main__':
    main()
