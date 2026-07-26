#!/usr/bin/env python3

import argparse
import gzip
import hashlib
import json
import math
import os
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from catboost import CatBoostRegressor, Pool

MODEL_VERSION = "RECOMMENDATION_VALUE_V7_TABULAR_CANDIDATE_SCORER_1"
DATASET_VERSION = "RECOMMENDATION_DECISION_DATASET_V5_3"
HORIZONS = ("3m", "5m", "10m")
HORIZON_WEIGHTS = {"3m": 1.0, "5m": 0.75, "10m": 0.5}
MAX_CANDIDATES = 64
SEED = 20260726

COLUMNS = [
    ("target", "Label"),
    ("weight", "Weight"),
    ("decision_id", "Auxiliary"),
    ("match_id", "Auxiliary"),
    ("observed_action_key", "Auxiliary"),
    ("candidate_action_key", "Categ"),
    ("hero_id", "Categ"),
    ("team_id", "Categ"),
    ("time_bucket", "Categ"),
    ("inventory_state_key", "Categ"),
    ("previous_action_tail", "Categ"),
    ("allied_heroes", "Categ"),
    ("enemy_heroes", "Categ"),
    ("candidate_slot_type", "Categ"),
    ("candidate_tier", "Categ"),
    ("candidate_tags", "Categ"),
    ("team_economy_band", "Categ"),
    ("inventory_total_cost", "Num"),
    ("inventory_highest_tier", "Num"),
    ("player_net_worth", "Num"),
    ("player_kills", "Num"),
    ("player_deaths", "Num"),
    ("player_assists", "Num"),
    ("player_damage", "Num"),
    ("player_level", "Num"),
    ("team_net_worth_delta", "Num"),
    ("team_relative_net_worth_delta", "Num"),
    ("player_team_net_worth_share", "Num"),
    ("candidate_cost", "Num"),
    ("candidate_is_active", "Num"),
    ("interaction_count", "Num"),
]
CANDIDATE_FEATURE_NAMES = {
    "candidate_action_key",
    "candidate_slot_type",
    "candidate_tier",
    "candidate_tags",
    "candidate_cost",
    "candidate_is_active",
    "interaction_count",
}


def main() -> None:
    args = parse_args()
    dataset_path = Path(args.dataset)
    manifest_path = Path(args.manifest)
    audit_path = Path(args.audit)
    output_dir = Path(args.output_dir)
    report_dir = Path(args.report_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    manifest = read_json(manifest_path)
    audit = read_json(audit_path)
    assert manifest.get("datasetVersion") == DATASET_VERSION
    assert audit.get("passed") is True
    expected_dataset_sha = required_sha(manifest.get("artifact", {}).get("sha256"))
    upstream_dataset_v4_sha = required_sha(manifest.get("source", {}).get("sha256"))

    if reuse_complete_artifact(output_dir, expected_dataset_sha, report_dir):
        print("Reused completed Recommendation V7 CatBoost artifact.")
        return

    actual_dataset_sha = hash_file(dataset_path)
    if actual_dataset_sha != expected_dataset_sha:
        raise RuntimeError(
            f"Dataset SHA-256 mismatch: {actual_dataset_sha} versus {expected_dataset_sha}"
        )

    work_dir = output_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=True)
    paths = build_paths(work_dir)
    write_column_descriptions(paths)

    prep = load_reusable_preparation(paths, actual_dataset_sha)
    if prep is None:
        prep = prepare_datasets(dataset_path, paths, actual_dataset_sha)
    else:
        print("Reused prepared CatBoost pools.")

    state_model = train_or_load_model(
        name="state",
        train_path=paths["train_observed"],
        tuning_path=paths["tuning_observed"],
        column_description=paths["state_cd"],
        model_path=output_dir / "state-model.cbm",
        marker_path=output_dir / "state-trained.json",
        iterations=700,
        depth=8,
    )
    action_model = train_or_load_model(
        name="action",
        train_path=paths["train_observed"],
        tuning_path=paths["tuning_observed"],
        column_description=paths["action_cd"],
        model_path=output_dir / "action-model.cbm",
        marker_path=output_dir / "action-trained.json",
        iterations=1200,
        depth=9,
    )

    tuning_state_predictions = predict_file(
        state_model, paths["tuning_observed"], paths["state_cd"]
    )
    test_state_predictions = predict_file(
        state_model, paths["test_observed"], paths["state_cd"]
    )
    tuning_action_predictions = predict_file(
        action_model, paths["tuning_candidates"], paths["action_cd"]
    )
    test_action_predictions = predict_file(
        action_model, paths["test_candidates"], paths["action_cd"]
    )

    tuning_state_by_decision = prediction_map(
        paths["tuning_observed_meta"], tuning_state_predictions
    )
    test_state_by_decision = prediction_map(
        paths["test_observed_meta"], test_state_predictions
    )

    tuning_metrics = evaluate_candidates(
        paths["tuning_candidates_meta"],
        tuning_action_predictions,
        tuning_state_by_decision,
        None,
    )
    prediction_path = output_dir / "prediction-evaluation.ndjson"
    test_metrics = evaluate_candidates(
        paths["test_candidates_meta"],
        test_action_predictions,
        test_state_by_decision,
        prediction_path,
    )

    feature_names = list(action_model.feature_names_)
    importances = list(action_model.get_feature_importance())
    feature_importance = sorted(
        [
            {"feature": feature_names[index], "importance": float(value)}
            for index, value in enumerate(importances)
        ],
        key=lambda row: (-row["importance"], row["feature"]),
    )

    release_gate = build_release_gate(test_metrics)
    generated_at = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"

    state_model_path = output_dir / "state-model.cbm"
    action_model_path = output_dir / "action-model.cbm"
    model_metadata = {
        "schemaVersion": 1,
        "modelVersion": MODEL_VERSION,
        "generatedAt": generated_at,
        "modelKind": "CATBOOST_STATE_PLUS_CANDIDATE_DIRECT_METHOD",
        "target": "SHORT_HORIZON_UTILITY_ONLY",
        "candidateScore": "ACTION_Q_MINUS_STATE_BASELINE",
        "training": {
            "matchBalanced": True,
            "finalOutcomeUsedInActionTarget": False,
            "maximumCandidates": MAX_CANDIDATES,
            "seed": SEED,
        },
        "models": {
            "state": {
                "fileName": state_model_path.name,
                "sha256": hash_file(state_model_path),
                "bestIteration": state_model.get_best_iteration(),
                "bestScore": state_model.get_best_score(),
            },
            "action": {
                "fileName": action_model_path.name,
                "sha256": hash_file(action_model_path),
                "bestIteration": action_model.get_best_iteration(),
                "bestScore": action_model.get_best_score(),
            },
        },
        "featureImportance": feature_importance,
    }
    model_json_path = output_dir / "model.json"
    atomic_json(model_json_path, model_metadata)

    evaluation = {
        "schemaVersion": 1,
        "modelVersion": MODEL_VERSION,
        "generatedAt": generated_at,
        "split": "CHRONOLOGICAL_MATCH_LEVEL_70_15_15",
        "selection": "CATBOOST_EARLY_STOPPING_ON_TUNING_ONLY",
        "target": "SHORT_HORIZON_UTILITY_ONLY",
        "tuning": tuning_metrics,
        "test": test_metrics,
        "releaseGate": release_gate,
        "interpretation": {
            "causal": False,
            "allowedUse": "Offline candidate-ranking diagnostics and propensity-corrected policy evaluation.",
            "productionRolloutAuthorized": False,
        },
    }
    evaluation_path = output_dir / "evaluation.json"
    atomic_json(evaluation_path, evaluation)

    prediction_sha = hash_file(prediction_path)
    model_json_sha = hash_file(model_json_path)
    evaluation_sha = hash_file(evaluation_path)
    audit_value = {
        "schemaVersion": 1,
        "modelVersion": MODEL_VERSION,
        "generatedAt": generated_at,
        "passed": True,
        "source": {
            "datasetVersion": DATASET_VERSION,
            "artifactSha256": actual_dataset_sha,
            "upstreamDatasetV4Sha256": upstream_dataset_v4_sha,
            "sourceRowCount": prep["sourceRowCount"],
            "baseEligibleRowCount": prep["baseEligibleRowCount"],
            "shortHorizonEligibleRowCount": prep["shortHorizonEligibleRowCount"],
            "eligibleMatchCount": prep["eligibleMatchCount"],
        },
        "split": prep["split"],
        "integrity": {
            "duplicateDecisionCount": prep["duplicateDecisionCount"],
            "candidateTruncatedDecisionCount": prep["candidateTruncatedDecisionCount"],
            "predictionRowCount": test_metrics["decisionCount"],
            "nonFinitePredictionCount": test_metrics["nonFinitePredictionCount"],
        },
        "leakage": {
            "featureCutoff": "DECISION_TIME",
            "shortHorizonOutcomesUsedOnlyAsTargets": True,
            "finalOutcomeUsedInActionTarget": False,
            "testUsedForTuning": False,
            "chronologicalMatchSplit": True,
            "productionRolloutAuthorized": False,
        },
        "artifacts": {
            "predictionEvaluation": {
                "fileName": prediction_path.name,
                "sha256": prediction_sha,
                "rowCount": test_metrics["decisionCount"],
            },
            "model": {"fileName": model_json_path.name, "sha256": model_json_sha},
            "evaluation": {
                "fileName": evaluation_path.name,
                "sha256": evaluation_sha,
            },
        },
        "warnings": [] if release_gate["passed"] else release_gate["reasons"],
    }
    audit_output_path = output_dir / "audit.json"
    atomic_json(audit_output_path, audit_value)
    audit_sha = hash_file(audit_output_path)

    output_manifest = {
        "schemaVersion": 1,
        "modelVersion": MODEL_VERSION,
        "generatedAt": generated_at,
        "source": {
            "datasetVersion": DATASET_VERSION,
            "artifactSha256": actual_dataset_sha,
            "upstreamDatasetV4Sha256": upstream_dataset_v4_sha,
            "sourceRowCount": prep["sourceRowCount"],
            "eligibleRowCount": prep["shortHorizonEligibleRowCount"],
        },
        "split": prep["split"],
        "training": model_metadata["training"],
        "artifacts": {
            "predictionEvaluation": {
                "format": "NDJSON",
                "fileName": prediction_path.name,
                "sha256": prediction_sha,
                "rowCount": test_metrics["decisionCount"],
            },
            "model": {
                "format": "JSON_METADATA_AND_CBM",
                "fileName": model_json_path.name,
                "sha256": model_json_sha,
            },
            "evaluation": {
                "format": "JSON",
                "fileName": evaluation_path.name,
                "sha256": evaluation_sha,
            },
            "audit": {
                "format": "JSON",
                "fileName": audit_output_path.name,
                "sha256": audit_sha,
            },
        },
        "auditPassed": True,
        "releaseGatePassed": release_gate["passed"],
        "warnings": [] if release_gate["passed"] else release_gate["reasons"],
    }
    output_manifest_path = output_dir / "manifest.json"
    atomic_json(output_manifest_path, output_manifest)

    report = {
        "completedAt": generated_at,
        "outputDirectory": str(output_dir),
        "manifest": output_manifest,
        "evaluation": evaluation,
        "audit": audit_value,
        "topFeatureImportance": feature_importance[:50],
    }
    atomic_json(report_dir / "50-v7-catboost-report.json", report)
    shutil.copy2(output_manifest_path, report_dir / "50-v7-manifest.json")
    shutil.copy2(evaluation_path, report_dir / "50-v7-evaluation.json")
    print(json.dumps(report, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--audit", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--report-dir", required=True)
    return parser.parse_args()


def build_paths(work_dir: Path) -> dict[str, Path]:
    return {
        "action_cd": work_dir / "action.cd",
        "state_cd": work_dir / "state.cd",
        "train_observed": work_dir / "train-observed.tsv",
        "tuning_observed": work_dir / "tuning-observed.tsv",
        "test_observed": work_dir / "test-observed.tsv",
        "tuning_observed_meta": work_dir / "tuning-observed-meta.ndjson",
        "test_observed_meta": work_dir / "test-observed-meta.ndjson",
        "tuning_candidates": work_dir / "tuning-candidates.tsv",
        "test_candidates": work_dir / "test-candidates.tsv",
        "tuning_candidates_meta": work_dir / "tuning-candidates-meta.ndjson",
        "test_candidates_meta": work_dir / "test-candidates-meta.ndjson",
        "preparation": work_dir / "preparation.json",
    }


def write_column_descriptions(paths: dict[str, Path]) -> None:
    action_lines = []
    state_lines = []
    for index, (name, column_type) in enumerate(COLUMNS):
        action_lines.append(f"{index}\t{column_type}\t{name}")
        state_type = "Auxiliary" if name in CANDIDATE_FEATURE_NAMES else column_type
        state_lines.append(f"{index}\t{state_type}\t{name}")
    paths["action_cd"].write_text("\n".join(action_lines) + "\n", encoding="utf-8")
    paths["state_cd"].write_text("\n".join(state_lines) + "\n", encoding="utf-8")


def load_reusable_preparation(
    paths: dict[str, Path], source_sha: str
) -> dict[str, Any] | None:
    required = [
        paths["preparation"],
        paths["train_observed"],
        paths["tuning_observed"],
        paths["test_observed"],
        paths["tuning_observed_meta"],
        paths["test_observed_meta"],
        paths["tuning_candidates"],
        paths["test_candidates"],
        paths["tuning_candidates_meta"],
        paths["test_candidates_meta"],
    ]
    if not all(path.is_file() for path in required):
        return None
    value = read_json(paths["preparation"])
    return value if value.get("sourceSha256") == source_sha else None


def prepare_datasets(
    dataset_path: Path, paths: dict[str, Path], source_sha: str
) -> dict[str, Any]:
    match_first_observed: dict[str, str] = {}
    short_counts: Counter[str] = Counter()
    decision_ids: set[str] = set()
    source_rows = 0
    base_eligible_rows = 0
    short_rows = 0
    duplicate_decisions = 0

    for row in each_dataset_row(dataset_path):
        source_rows += 1
        prepared = prepare_base_row(row)
        if prepared is not None:
            base_eligible_rows += 1
            decision_id = prepared["decision_id"]
            if decision_id in decision_ids:
                duplicate_decisions += 1
            decision_ids.add(decision_id)
            match_id = prepared["match_id"]
            occurred_at = prepared["decision_occurred_at"]
            existing = match_first_observed.get(match_id)
            if existing is None or parse_timestamp(occurred_at) < parse_timestamp(existing):
                match_first_observed[match_id] = occurred_at
            if short_horizon_utility(row) is not None:
                short_counts[match_id] += 1
                short_rows += 1
        if source_rows % 100_000 == 0:
            print(f"[v7-prep-pass1] rows={source_rows}")

    descriptors = sorted(
        match_first_observed.items(),
        key=lambda entry: (parse_timestamp(entry[1]), entry[0]),
    )
    if len(descriptors) < 3:
        raise RuntimeError("At least three eligible matches are required.")
    train_count = bounded_split_count(math.floor(len(descriptors) * 0.7), 1, len(descriptors) - 2)
    max_tuning_count = len(descriptors) - train_count - 1
    tuning_count = bounded_split_count(
        math.floor(len(descriptors) * 0.15), 1, max_tuning_count
    )
    train_ids = {match_id for match_id, _ in descriptors[:train_count]}
    tuning_ids = {
        match_id
        for match_id, _ in descriptors[train_count : train_count + tuning_count]
    }
    test_ids = {
        match_id for match_id, _ in descriptors[train_count + tuning_count :]
    }
    descriptor_sha = hashlib.sha256(
        "\n".join(f"{match_id}:{timestamp}" for match_id, timestamp in descriptors).encode()
    ).hexdigest()

    writers = {
        key: path.open("w", encoding="utf-8", newline="")
        for key, path in paths.items()
        if key
        in {
            "train_observed",
            "tuning_observed",
            "test_observed",
            "tuning_observed_meta",
            "test_observed_meta",
            "tuning_candidates",
            "test_candidates",
            "tuning_candidates_meta",
            "test_candidates_meta",
        }
    }
    split_rows = Counter()
    candidate_rows = Counter()
    truncated_decisions = 0
    processed = 0
    try:
        for row in each_dataset_row(dataset_path):
            processed += 1
            prepared = prepare_base_row(row)
            if prepared is None:
                continue
            target = short_horizon_utility(row)
            if target is None:
                continue
            match_id = prepared["match_id"]
            count = short_counts.get(match_id, 0)
            if count <= 0:
                raise RuntimeError(f"Match {match_id} has no short-horizon decision count.")
            weight = 1.0 / count
            if match_id in train_ids:
                split = "train"
            elif match_id in tuning_ids:
                split = "tuning"
            elif match_id in test_ids:
                split = "test"
            else:
                continue

            observed_feature = observed_candidate_feature(row, prepared["observed_action_key"])
            observed_values = feature_values(
                row,
                prepared,
                prepared["observed_action_key"],
                observed_feature,
                target,
                weight,
            )
            write_tsv(writers[f"{split}_observed"], observed_values)
            split_rows[split] += 1
            if split in {"tuning", "test"}:
                observed_meta = {
                    "decisionId": prepared["decision_id"],
                    "matchId": match_id,
                }
                write_json_line(writers[f"{split}_observed_meta"], observed_meta)
                candidate_keys, truncated = candidate_action_keys(
                    row, prepared["observed_action_key"]
                )
                truncated_decisions += 1 if truncated else 0
                feature_map = candidate_feature_map(row)
                for candidate_key in candidate_keys:
                    values = feature_values(
                        row,
                        prepared,
                        candidate_key,
                        feature_map.get(candidate_key, {}),
                        target,
                        weight,
                    )
                    write_tsv(writers[f"{split}_candidates"], values)
                    write_json_line(
                        writers[f"{split}_candidates_meta"],
                        {
                            "decisionId": prepared["decision_id"],
                            "matchId": match_id,
                            "playerWon": prepared["player_won"],
                            "targetUtility": target,
                            "matchWeight": weight,
                            "observedActionKey": prepared["observed_action_key"],
                            "candidateActionKey": candidate_key,
                        },
                    )
                    candidate_rows[split] += 1
            if processed % 100_000 == 0:
                print(f"[v7-prep-pass2] rows={processed}")
    finally:
        for writer in writers.values():
            writer.close()

    prep = {
        "generatedAt": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
        "sourceSha256": source_sha,
        "sourceRowCount": source_rows,
        "baseEligibleRowCount": base_eligible_rows,
        "shortHorizonEligibleRowCount": short_rows,
        "eligibleMatchCount": len(descriptors),
        "duplicateDecisionCount": duplicate_decisions,
        "candidateTruncatedDecisionCount": truncated_decisions,
        "split": {
            "descriptorSha256": descriptor_sha,
            "strategy": "CHRONOLOGICAL_MATCH_LEVEL_70_15_15",
            "trainMatchCount": len(train_ids),
            "tuningMatchCount": len(tuning_ids),
            "testMatchCount": len(test_ids),
            "trainRowCount": split_rows["train"],
            "tuningRowCount": split_rows["tuning"],
            "testRowCount": split_rows["test"],
            "tuningCandidateRowCount": candidate_rows["tuning"],
            "testCandidateRowCount": candidate_rows["test"],
            "overlapCount": 0,
        },
    }
    atomic_json(paths["preparation"], prep)
    return prep


def train_or_load_model(
    name: str,
    train_path: Path,
    tuning_path: Path,
    column_description: Path,
    model_path: Path,
    marker_path: Path,
    iterations: int,
    depth: int,
) -> CatBoostRegressor:
    model = CatBoostRegressor()
    if model_path.is_file() and marker_path.is_file():
        model.load_model(str(model_path))
        print(f"Reused trained {name} CatBoost model.")
        return model

    train_pool = Pool(
        str(train_path),
        column_description=str(column_description),
        delimiter="\t",
        has_header=False,
        thread_count=-1,
    )
    tuning_pool = Pool(
        str(tuning_path),
        column_description=str(column_description),
        delimiter="\t",
        has_header=False,
        thread_count=-1,
    )
    model = CatBoostRegressor(
        loss_function="RMSE",
        eval_metric="RMSE",
        iterations=iterations,
        depth=depth,
        learning_rate=0.05,
        l2_leaf_reg=10,
        random_seed=SEED,
        random_strength=1,
        bootstrap_type="Bernoulli",
        subsample=0.8,
        rsm=0.85,
        thread_count=-1,
        allow_writing_files=True,
        train_dir=str(model_path.parent / f"{name}-catboost-info"),
        save_snapshot=True,
        snapshot_file=str(model_path.parent / f"{name}.snapshot"),
        snapshot_interval=300,
        verbose=50,
    )
    model.fit(
        train_pool,
        eval_set=tuning_pool,
        use_best_model=True,
        early_stopping_rounds=100,
    )
    model.save_model(str(model_path))
    atomic_json(
        marker_path,
        {
            "completedAt": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "modelSha256": hash_file(model_path),
            "bestIteration": model.get_best_iteration(),
            "bestScore": model.get_best_score(),
        },
    )
    return model


def predict_file(model: CatBoostRegressor, data_path: Path, cd_path: Path) -> list[float]:
    pool = Pool(
        str(data_path),
        column_description=str(cd_path),
        delimiter="\t",
        has_header=False,
        thread_count=-1,
    )
    return [float(value) for value in model.predict(pool)]


def prediction_map(meta_path: Path, predictions: list[float]) -> dict[str, float]:
    result: dict[str, float] = {}
    with meta_path.open("r", encoding="utf-8") as source:
        for index, line in enumerate(source):
            meta = json.loads(line)
            result[meta["decisionId"]] = clamp(predictions[index], -1.0, 1.0)
    if len(result) != len(predictions):
        raise RuntimeError(
            f"Prediction metadata mismatch for {meta_path}: {len(result)} versus {len(predictions)}"
        )
    return result


def evaluate_candidates(
    meta_path: Path,
    action_predictions: list[float],
    state_by_decision: dict[str, float],
    prediction_output: Path | None,
) -> dict[str, Any]:
    accumulator = MetricAccumulator()
    writer = prediction_output.open("w", encoding="utf-8") if prediction_output else None
    current_decision: str | None = None
    group: list[tuple[dict[str, Any], float]] = []
    try:
        with meta_path.open("r", encoding="utf-8") as source:
            for index, line in enumerate(source):
                meta = json.loads(line)
                decision_id = meta["decisionId"]
                if current_decision is not None and decision_id != current_decision:
                    flush_candidate_group(group, state_by_decision, accumulator, writer)
                    group = []
                current_decision = decision_id
                group.append((meta, clamp(action_predictions[index], -1.0, 1.0)))
            if group:
                flush_candidate_group(group, state_by_decision, accumulator, writer)
    finally:
        if writer:
            writer.close()
    if accumulator.non_finite_predictions > 0:
        raise RuntimeError("CatBoost evaluation produced non-finite predictions.")
    return accumulator.finalize()


def flush_candidate_group(
    group: list[tuple[dict[str, Any], float]],
    state_by_decision: dict[str, float],
    accumulator: "MetricAccumulator",
    writer: Any,
) -> None:
    meta = group[0][0]
    decision_id = meta["decisionId"]
    state_utility = state_by_decision.get(decision_id)
    if state_utility is None:
        raise RuntimeError(f"Missing state prediction for decision {decision_id}")
    candidates = [
        {
            "actionKey": candidate_meta["candidateActionKey"],
            "actionUtility": prediction,
            "actionAdvantage": clamp(prediction - state_utility, -1.0, 1.0),
            "actionWinProbability": clamp((prediction + 1.0) / 2.0, 0.0, 1.0),
            "supportedActionKeyCount": 1,
        }
        for candidate_meta, prediction in group
    ]
    candidates.sort(key=lambda row: (-row["actionAdvantage"], row["actionKey"]))
    observed = next(
        (
            candidate
            for candidate in candidates
            if candidate["actionKey"] == meta["observedActionKey"]
        ),
        None,
    )
    if observed is None:
        raise RuntimeError(f"Observed action missing for decision {decision_id}")
    accumulator.observe(meta, state_utility, observed, candidates)
    if writer:
        value = {
            "schemaVersion": 1,
            "modelVersion": MODEL_VERSION,
            "decisionId": decision_id,
            "matchId": meta["matchId"],
            "playerWon": meta["playerWon"],
            "targetUtility": meta["targetUtility"],
            "targetComponents": {
                "finalOutcome": 1 if meta["playerWon"] else -1,
                "shortHorizonUtility": meta["targetUtility"],
                "shortHorizonCount": 1,
            },
            "matchWeight": meta["matchWeight"],
            "observedActionKey": meta["observedActionKey"],
            "stateUtility": state_utility,
            "observedActionUtility": observed["actionUtility"],
            "observedActionAdvantage": observed["actionAdvantage"],
            "stateWinProbability": clamp((state_utility + 1.0) / 2.0, 0.0, 1.0),
            "observedActionWinProbability": observed["actionWinProbability"],
            "supportedStateKeyCount": 1,
            "supportedActionKeyCount": 1,
            "candidateRanking": [
                {"rank": index + 1, **candidate}
                for index, candidate in enumerate(candidates)
            ],
        }
        writer.write(json.dumps(value, separators=(",", ":")) + "\n")


class MetricAccumulator:
    def __init__(self) -> None:
        self.match_ids: set[str] = set()
        self.decision_count = 0
        self.total_weight = 0.0
        self.state_squared_error = 0.0
        self.action_squared_error = 0.0
        self.state_absolute_error = 0.0
        self.action_absolute_error = 0.0
        self.top1_weight = 0.0
        self.reciprocal_rank_weight = 0.0
        self.ndcg_weight = 0.0
        self.pair_weight = 0.0
        self.correct_pair_weight = 0.0
        self.regret_weight = 0.0
        self.candidate_set_weight = 0.0
        self.separations: list[tuple[float, float]] = []
        self.non_finite_predictions = 0

    def observe(
        self,
        meta: dict[str, Any],
        state_utility: float,
        observed: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> None:
        values = [state_utility] + [candidate["actionUtility"] for candidate in candidates]
        if not all(math.isfinite(value) for value in values):
            self.non_finite_predictions += 1
            return
        weight = float(meta["matchWeight"])
        target = float(meta["targetUtility"])
        observed_index = next(
            index
            for index, candidate in enumerate(candidates)
            if candidate["actionKey"] == meta["observedActionKey"]
        )
        self.match_ids.add(str(meta["matchId"]))
        self.decision_count += 1
        self.total_weight += weight
        self.state_squared_error += weight * (state_utility - target) ** 2
        self.action_squared_error += weight * (observed["actionUtility"] - target) ** 2
        self.state_absolute_error += weight * abs(state_utility - target)
        self.action_absolute_error += weight * abs(observed["actionUtility"] - target)
        self.top1_weight += weight if observed_index == 0 else 0.0
        self.reciprocal_rank_weight += weight / (observed_index + 1)
        self.ndcg_weight += weight / math.log2(observed_index + 2)
        self.regret_weight += weight * max(
            0.0,
            candidates[0]["actionAdvantage"] - observed["actionAdvantage"],
        )
        if len(candidates) >= 2:
            self.candidate_set_weight += weight
            separation = (
                candidates[0]["actionAdvantage"]
                - candidates[1]["actionAdvantage"]
            )
            self.separations.append((separation, weight))
        self.pair_weight += weight * max(0, len(candidates) - 1)
        self.correct_pair_weight += weight * max(0, len(candidates) - observed_index - 1)

    def finalize(self) -> dict[str, Any]:
        total = max(self.total_weight, 1e-12)
        pair_total = max(self.pair_weight, 1e-12)
        state_rmse = math.sqrt(self.state_squared_error / total)
        action_rmse = math.sqrt(self.action_squared_error / total)
        return {
            "matchCount": len(self.match_ids),
            "decisionCount": self.decision_count,
            "totalWeight": self.total_weight,
            "stateRmse": state_rmse,
            "actionRmse": action_rmse,
            "utilityRmseImprovement": state_rmse - action_rmse,
            "stateMae": self.state_absolute_error / total,
            "actionMae": self.action_absolute_error / total,
            "observedActionTop1Agreement": self.top1_weight / total,
            "observedActionMeanReciprocalRank": self.reciprocal_rank_weight / total,
            "observedActionNdcg": self.ndcg_weight / total,
            "pairwiseObservedActionAccuracy": self.correct_pair_weight / pair_total,
            "averageObservedActionRegret": self.regret_weight / total,
            "candidateSetCoverage": self.candidate_set_weight / total,
            "averageTopCandidateSeparation": weighted_mean(self.separations),
            "separationP50": weighted_quantile(self.separations, 0.5),
            "separationP90": weighted_quantile(self.separations, 0.9),
            "separationP99": weighted_quantile(self.separations, 0.99),
            "separationRateAtLeast0001": weighted_rate(
                self.separations, lambda value: value >= 0.001
            ),
            "separationRateAtLeast0003": weighted_rate(
                self.separations, lambda value: value >= 0.003
            ),
            "separationRateAtLeast0010": weighted_rate(
                self.separations, lambda value: value >= 0.01
            ),
            "shortHorizonCoverage": 1.0,
            "nonFinitePredictionCount": self.non_finite_predictions,
        }


def prepare_base_row(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("datasetVersion") != DATASET_VERSION:
        return None
    identity = record(row.get("identity"))
    state = record(row.get("stateBeforeAction"))
    observed = record(row.get("observedAction"))
    outcome = record(row.get("finalOutcome"))
    eligibility = record(row.get("trainingEligibility"))
    action_key = text(observed.get("actionKey"))
    player_won = outcome.get("playerWon")
    if (
        eligibility.get("exactAction") is not True
        or eligibility.get("finalOutcome") is not True
        or outcome.get("available") is not True
        or outcome.get("conflicting") is True
        or action_key is None
        or not isinstance(player_won, bool)
    ):
        return None
    match_id = text(identity.get("matchId"))
    decision_id = text(row.get("decisionId"))
    occurred_at = text(identity.get("decisionOccurredAt"))
    hero_id = number(identity.get("heroId") or state.get("heroId"))
    if not match_id or not decision_id or not occurred_at or hero_id <= 0:
        return None
    candidate_keys, _ = candidate_action_keys(row, action_key)
    if not candidate_keys:
        return None
    return {
        "match_id": match_id,
        "decision_id": decision_id,
        "decision_occurred_at": occurred_at,
        "observed_action_key": action_key,
        "player_won": player_won,
    }


def short_horizon_utility(row: dict[str, Any]) -> float | None:
    windows = record(record(row.get("shortHorizonOutcomes")).get("windows"))
    values: list[tuple[float, float]] = []
    for horizon in HORIZONS:
        window = record(windows.get(horizon))
        if window.get("available") is not True:
            continue
        utility = clamp(
            number(window.get("killsDelta")) * 0.12
            + number(window.get("assistsDelta")) * 0.05
            + number(window.get("killParticipationDelta")) * 0.04
            - number(window.get("deathsDelta")) * 0.18
            + number(window.get("netWorthDelta")) / 10_000
            + number(window.get("heroDamageDelta")) / 25_000
            + number(window.get("enemyObjectiveLossCount")) * 0.12
            - number(window.get("ownObjectiveLossCount")) * 0.12
            + (0.05 if window.get("survived") is True else 0.0),
            -1.0,
            1.0,
        )
        values.append((utility, HORIZON_WEIGHTS[horizon]))
    if not values:
        return None
    total_weight = sum(weight for _, weight in values)
    return sum(value * weight for value, weight in values) / total_weight


def feature_values(
    row: dict[str, Any],
    prepared: dict[str, Any],
    candidate_action_key: str,
    candidate_feature: dict[str, Any],
    target: float,
    weight: float,
) -> list[Any]:
    identity = record(row.get("identity"))
    state = record(row.get("stateBeforeAction"))
    trajectory = record(row.get("trajectory"))
    features = record(row.get("itemAndBuildFeatures"))
    inventory = record(features.get("inventory"))
    timeline = record(state.get("playerTimelineSnapshot"))
    economy = record(state.get("teamEconomy"))
    item = record(candidate_feature.get("item"))
    previous_actions = strings(trajectory.get("fullPreviousActionKeys"))
    previous_tail = ">".join(previous_actions[-5:]) or "EMPTY"
    relative_delta = number(economy.get("relativeNetWorthDelta"))
    return [
        target,
        weight,
        prepared["decision_id"],
        prepared["match_id"],
        prepared["observed_action_key"],
        candidate_action_key,
        str(int(number(identity.get("heroId") or state.get("heroId")))),
        clean_categorical(identity.get("teamId")),
        clean_categorical(state.get("timeBucket")),
        clean_categorical(state.get("inventoryStateKey") or "UNKNOWN"),
        clean_categorical(previous_tail),
        clean_categorical(",".join(str(int(value)) for value in numbers(state.get("alliedHeroIds")))),
        clean_categorical(",".join(str(int(value)) for value in numbers(state.get("enemyHeroIds")))),
        clean_categorical(item.get("slotType") or "UNKNOWN"),
        clean_categorical(int(number(item.get("tier")))),
        clean_categorical(",".join(sorted(strings(item.get("tags")))) or "NONE"),
        classify_economy(relative_delta) if economy.get("available") is True else "UNKNOWN",
        number(inventory.get("totalCost")),
        number(inventory.get("highestTier")),
        number(timeline.get("netWorth")),
        number(timeline.get("kills")),
        number(timeline.get("deaths")),
        number(timeline.get("assists")),
        number(timeline.get("heroDamage")),
        number(timeline.get("level")),
        number(economy.get("netWorthDelta")),
        relative_delta,
        number(economy.get("playerNetWorthShare")),
        number(item.get("cost")),
        1.0 if item.get("isActiveItem") is True else 0.0,
        float(len(strings(candidate_feature.get("interactionKeys")))),
    ]


def candidate_action_keys(
    row: dict[str, Any], observed_action_key: str
) -> tuple[list[str], bool]:
    state = record(row.get("stateBeforeAction"))
    keys: list[str] = []
    for candidate in records(state.get("candidateActions")):
        value = text(candidate.get("actionKey"))
        if value and value not in keys:
            keys.append(value)
    if observed_action_key not in keys:
        keys.append(observed_action_key)
    truncated = len(keys) > MAX_CANDIDATES
    if truncated:
        selected = keys[:MAX_CANDIDATES]
        if observed_action_key not in selected:
            selected[-1] = observed_action_key
        keys = list(dict.fromkeys(selected))
    return keys, truncated


def candidate_feature_map(row: dict[str, Any]) -> dict[str, dict[str, Any]]:
    features = record(row.get("itemAndBuildFeatures"))
    result: dict[str, dict[str, Any]] = {}
    for candidate in records(features.get("candidates")):
        key = text(candidate.get("actionKey"))
        if key:
            result[key] = candidate
    observed = record(features.get("observedAction"))
    observed_key = text(observed.get("actionKey"))
    if observed_key:
        result.setdefault(observed_key, observed)
    return result


def observed_candidate_feature(
    row: dict[str, Any], observed_action_key: str
) -> dict[str, Any]:
    return candidate_feature_map(row).get(observed_action_key, {})


def build_release_gate(test: dict[str, Any]) -> dict[str, Any]:
    reasons = []
    if test["matchCount"] < 100:
        reasons.append("Untouched test contains fewer than 100 matches.")
    if test["utilityRmseImprovement"] <= 0:
        reasons.append("Candidate-conditioned RMSE does not improve over state-only.")
    if test["candidateSetCoverage"] < 0.5:
        reasons.append("Candidate-set coverage is below 50%.")
    if test["averageTopCandidateSeparation"] < 0.002:
        reasons.append("Mean top-candidate separation is below the V7 progression threshold 0.002.")
    if test["separationRateAtLeast0010"] <= 0:
        reasons.append("No held-out decision separates top candidates by 0.01 utility.")
    return {
        "passed": not reasons,
        "reasons": reasons,
        "progressionThreshold": 0.002,
        "productionSeparationThreshold": 0.01,
        "productionRolloutAuthorized": False,
    }


def reuse_complete_artifact(
    output_dir: Path, source_sha: str, report_dir: Path
) -> bool:
    manifest_path = output_dir / "manifest.json"
    audit_path = output_dir / "audit.json"
    evaluation_path = output_dir / "evaluation.json"
    prediction_path = output_dir / "prediction-evaluation.ndjson"
    model_path = output_dir / "model.json"
    if not all(
        path.is_file()
        for path in [manifest_path, audit_path, evaluation_path, prediction_path, model_path]
    ):
        return False
    manifest = read_json(manifest_path)
    audit = read_json(audit_path)
    if (
        audit.get("passed") is not True
        or manifest.get("source", {}).get("artifactSha256") != source_sha
    ):
        return False
    report = {
        "completedAt": manifest.get("generatedAt"),
        "outputDirectory": str(output_dir),
        "manifest": manifest,
        "evaluation": read_json(evaluation_path),
        "audit": audit,
    }
    atomic_json(report_dir / "50-v7-catboost-report.json", report)
    return True


def each_dataset_row(path: Path) -> Iterable[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"Invalid dataset JSON at line {line_number}") from error
            if isinstance(value, dict):
                yield value


def write_tsv(writer: Any, values: list[Any]) -> None:
    writer.write("\t".join(clean_cell(value) for value in values) + "\n")


def write_json_line(writer: Any, value: dict[str, Any]) -> None:
    writer.write(json.dumps(value, separators=(",", ":")) + "\n")


def clean_cell(value: Any) -> str:
    if isinstance(value, float):
        if not math.isfinite(value):
            return "0"
        return format(value, ".12g")
    return clean_categorical(value)


def clean_categorical(value: Any) -> str:
    text_value = str(value if value is not None else "UNKNOWN")
    return text_value.replace("\t", " ").replace("\r", " ").replace("\n", " ") or "UNKNOWN"


def weighted_mean(values: list[tuple[float, float]]) -> float:
    total = sum(weight for _, weight in values)
    return 0.0 if total <= 0 else sum(value * weight for value, weight in values) / total


def weighted_quantile(values: list[tuple[float, float]], probability: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values, key=lambda entry: entry[0])
    total = sum(weight for _, weight in ordered)
    threshold = total * probability
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= threshold:
            return value
    return ordered[-1][0]


def weighted_rate(
    values: list[tuple[float, float]], predicate: Any
) -> float:
    total = sum(weight for _, weight in values)
    if total <= 0:
        return 0.0
    return sum(weight for value, weight in values if predicate(value)) / total


def classify_economy(value: float) -> str:
    if value <= -0.15:
        return "FAR_BEHIND"
    if value < -0.05:
        return "BEHIND"
    if value <= 0.05:
        return "EVEN"
    if value < 0.15:
        return "AHEAD"
    return "FAR_AHEAD"


def bounded_split_count(value: int, minimum: int, maximum: int) -> int:
    return min(maximum, max(minimum, value))


def parse_timestamp(value: str) -> float:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).timestamp()


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def required_sha(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
        raise RuntimeError("Required SHA-256 is missing or invalid.")
    return normalized


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected JSON object in {path}")
    return value


def record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def records(value: Any) -> list[dict[str, Any]]:
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def text(value: Any) -> str | None:
    normalized = value.strip() if isinstance(value, str) else ""
    return normalized or None


def number(value: Any) -> float:
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        return 0.0
    return normalized if math.isfinite(normalized) else 0.0


def numbers(value: Any) -> list[float]:
    return [number(entry) for entry in value] if isinstance(value, list) else []


def strings(value: Any) -> list[str]:
    return [entry for entry in value if isinstance(entry, str) and entry] if isinstance(value, list) else []


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


if __name__ == "__main__":
    main()
