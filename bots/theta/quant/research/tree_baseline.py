"""Shallow decision-tree baseline (work package 54).

Stdlib-only (this repo's pyproject.toml declares zero third-party
dependencies -- same constraint the existing logistic baseline in
`calibration/severe_drawdown_logistic_baseline.py` documents). A minimal,
deterministic, depth-limited CART classifier (Gini impurity, midpoint
splits over sorted unique thresholds) meant to run on the IDENTICAL
train/validation/forward splits `validation.py`'s purged walk-forward
already produces -- this module does not build its own split.

No gradient boosting here: the work package text is explicit that a deep
model is not yet justified ("no deep model yet"), and this repo's own
severe-drawdown logistic baseline already establishes the precedent that a
GBM/boosted variant requires this shallow baseline to exist first, which it
now does.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class TreeTrainingRow:
    features: Tuple[float, ...]
    label: int  # 1/0, never a censored row


@dataclass(frozen=True)
class TreeNode:
    is_leaf: bool
    prediction: Optional[float]  # positive-class fraction at this leaf, only when is_leaf
    feature_index: Optional[int]
    threshold: Optional[float]
    left: Optional['TreeNode']
    right: Optional['TreeNode']


@dataclass(frozen=True)
class TreeFitResult:
    state: str  # "FITTED" | "INSUFFICIENT_SAMPLE"
    sample_n: int
    minimum_required_n: int
    max_depth: int
    root: Optional[TreeNode]


def _gini(labels: Sequence[int]) -> float:
    n = len(labels)
    if n == 0:
        return 0.0
    p = sum(labels) / n
    return 1.0 - p * p - (1 - p) * (1 - p)


def _build(rows: List[TreeTrainingRow], depth: int, max_depth: int, minimum_leaf_n: int) -> TreeNode:
    labels = [r.label for r in rows]
    parent_gini = _gini(labels)
    positive_fraction = sum(labels) / len(labels)
    if depth >= max_depth or len(rows) < 2 * minimum_leaf_n or parent_gini == 0.0:
        return TreeNode(True, positive_fraction, None, None, None, None)
    n_features = len(rows[0].features)
    best = None  # (gain, feature_index, threshold, left_rows, right_rows)
    for feature_index in range(n_features):
        values = sorted({r.features[feature_index] for r in rows})
        for i in range(len(values) - 1):
            threshold = (values[i] + values[i + 1]) / 2.0
            left = [r for r in rows if r.features[feature_index] <= threshold]
            right = [r for r in rows if r.features[feature_index] > threshold]
            if len(left) < minimum_leaf_n or len(right) < minimum_leaf_n:
                continue
            weighted = (len(left) * _gini([r.label for r in left]) + len(right) * _gini([r.label for r in right])) / len(rows)
            gain = parent_gini - weighted
            # Deterministic tie-break: first-found (lowest feature_index, then lowest threshold) wins.
            if best is None or gain > best[0] + 1e-15:
                best = (gain, feature_index, threshold, left, right)
    if best is None or best[0] <= 1e-15:
        return TreeNode(True, positive_fraction, None, None, None, None)
    _, feature_index, threshold, left_rows, right_rows = best
    return TreeNode(False, None, feature_index, threshold,
                     _build(left_rows, depth + 1, max_depth, minimum_leaf_n),
                     _build(right_rows, depth + 1, max_depth, minimum_leaf_n))


def fit_tree_baseline(
    rows: Sequence[TreeTrainingRow], minimum_required_n: int = 30, max_depth: int = 3, minimum_leaf_n: int = 5,
) -> TreeFitResult:
    if minimum_required_n <= 0 or max_depth <= 0 or minimum_leaf_n <= 0:
        raise ValueError("TREE_BASELINE_CONFIG_INVALID")
    if len(rows) < minimum_required_n or len(set(r.label for r in rows)) < 2:
        return TreeFitResult("INSUFFICIENT_SAMPLE", len(rows), minimum_required_n, max_depth, None)
    n_features = len(rows[0].features)
    if any(len(r.features) != n_features for r in rows):
        raise ValueError("TREE_BASELINE_FEATURE_VECTOR_LENGTH_MISMATCH")
    root = _build(list(rows), 0, max_depth, minimum_leaf_n)
    return TreeFitResult("FITTED", len(rows), minimum_required_n, max_depth, root)


def predict_probability(node: TreeNode, features: Tuple[float, ...]) -> float:
    while not node.is_leaf:
        node = node.left if features[node.feature_index] <= node.threshold else node.right
    return node.prediction
