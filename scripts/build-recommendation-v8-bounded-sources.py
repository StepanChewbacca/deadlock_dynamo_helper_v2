#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

DATASET_VERSION = "CONTEXTUAL_V3_DECISION_DATASET_1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--policy-output-dir", required=True)
    parser.add_argument("--replay-output-dir", required=True)
    parser.add_argument("--training-window-start", required=True)
    parser.add_argument("--training-window-end", required=True)
    parser.add_argument("--tuning-start", required=True)
    parser.add_argument("--future-test-start", required=True)
    parser.add_argument("--policy-match-count", type=int, default=5000)
    parser.add_argument("--replay-train-match-count", type=int, default=2500)
    parser.add_argument("--replay-tuning-match-count", type=int, default=1250)
    parser.add_argument("--replay-future-match-count", type=int, default=1250)
    return parser.parse_args()


def timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def scan_matches(dataset_path: Path) -> dict[int, float]:
    matches: dict[int, float] = {}
    with dataset_path.open("rb") as source:
        for line_number, raw in enumerate(source, start=1):
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
                match_id = int(row["matchId"])
                match_time = timestamp(str(row["matchStartTime"]))
            except Exception as error:
                raise RuntimeError(
                    f"Invalid source row at line {line_number}: {error}"
                ) from error
            previous = matches.get(match_id)
            if previous is not None and previous != match_time:
                raise RuntimeError(
                    f"Match {match_id} has conflicting matchStartTime values"
                )
            matches[match_id] = match_time
            if line_number % 500_000 == 0:
                print(
                    f"scan rows={line_number} distinctMatches={len(matches)}",
                    flush=True,
                )
    return matches


def select_matches(
    matches: dict[int, float],
    training_start: float,
    training_end: float,
    tuning_start: float,
    future_start: float,
    policy_count: int,
    replay_train_count: int,
    replay_tuning_count: int,
    replay_future_count: int,
) -> tuple[set[int], set[int], dict[str, list[int]]]:
    ordered = sorted(matches.items(), key=lambda item: (item[1], item[0]))
    policy = [
        match_id
        for match_id, match_time in ordered
        if training_start <= match_time <= training_end
    ][:policy_count]
    replay_train = [
        match_id
        for match_id, match_time in ordered
        if training_end < match_time < tuning_start
    ][:replay_train_count]
    replay_tuning = [
        match_id
        for match_id, match_time in ordered
        if tuning_start <= match_time < future_start
    ][:replay_tuning_count]
    replay_future = [
        match_id
        for match_id, match_time in ordered
        if match_time >= future_start
    ][:replay_future_count]

    expected = {
        "policy": policy_count,
        "replayTrain": replay_train_count,
        "replayTuning": replay_tuning_count,
        "replayFuture": replay_future_count,
    }
    actual = {
        "policy": len(policy),
        "replayTrain": len(replay_train),
        "replayTuning": len(replay_tuning),
        "replayFuture": len(replay_future),
    }
    if actual != expected:
        raise RuntimeError(f"Insufficient matches: expected={expected} actual={actual}")

    replay = replay_train + replay_tuning + replay_future
    if len(set(replay)) != len(replay):
        raise RuntimeError("Replay split selection contains duplicate match IDs")
    if set(policy).intersection(replay):
        raise RuntimeError("Policy and replay selections overlap")

    return set(policy), set(replay), {
        "policy": policy,
        "replayTrain": replay_train,
        "replayTuning": replay_tuning,
        "replayFuture": replay_future,
    }


def write_selected(
    source_path: Path,
    output_path: Path,
    selected_matches: set[int],
) -> tuple[int, int, str, set[int]]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    partial = output_path.with_suffix(output_path.suffix + ".partial")
    if partial.exists():
        partial.unlink()
    digest = hashlib.sha256()
    byte_length = 0
    row_count = 0
    written_matches: set[int] = set()
    with source_path.open("rb") as source, partial.open("wb") as output:
        for line_number, raw in enumerate(source, start=1):
            if not raw.strip():
                continue
            row = json.loads(raw)
            match_id = int(row["matchId"])
            if match_id not in selected_matches:
                continue
            write_all(output, raw)
            digest.update(raw)
            byte_length += len(raw)
            row_count += 1
            written_matches.add(match_id)
            if row_count % 250_000 == 0:
                print(
                    f"write path={output_path.name} rows={row_count} matches={len(written_matches)}",
                    flush=True,
                )
        output.flush()
        os.fsync(output.fileno())
    if written_matches != selected_matches:
        missing = sorted(selected_matches - written_matches)[:20]
        raise RuntimeError(f"Selected matches were not written: {missing}")
    partial.replace(output_path)
    return row_count, byte_length, digest.hexdigest(), written_matches


def write_all(output: BinaryIO, value: bytes) -> None:
    offset = 0
    while offset < len(value):
        written = output.write(value[offset:])
        if written is None or written <= 0:
            raise RuntimeError("Dataset writer made no progress")
        offset += written


def write_descriptor(
    output_dir: Path,
    source_manifest: dict,
    source_sha: str,
    row_count: int,
    byte_length: int,
    artifact_sha: str,
    match_count: int,
    role: str,
    selection: dict,
) -> None:
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = {
        "schemaVersion": source_manifest.get("schemaVersion", 1),
        "datasetVersion": DATASET_VERSION,
        "generatedAt": generated_at,
        "source": {
            "kind": "IMMUTABLE_CONTEXTUAL_V3_BOUNDED_DERIVATION",
            "sourceDatasetSha256": source_sha,
            "selectionRole": role,
            "selection": selection,
        },
        "artifact": {
            "format": "NDJSON",
            "fileName": "dataset.ndjson",
            "byteLength": byte_length,
            "sha256": artifact_sha,
            "rowCount": row_count,
        },
        "matchCount": match_count,
        "auditPassed": True,
        "userLiveUsedAsInput": False,
    }
    audit = {
        "schemaVersion": 1,
        "auditVersion": "CONTEXTUAL_V3_BOUNDED_DERIVATION_AUDIT_1",
        "generatedAt": generated_at,
        "passed": True,
        "datasetVersion": DATASET_VERSION,
        "rowCount": row_count,
        "matchCount": match_count,
        "sourceDatasetSha256": source_sha,
        "artifactSha256": artifact_sha,
        "selectionRole": role,
        "selection": selection,
        "inheritedSourceAudit": True,
        "filteringCanIntroduceDuplicates": False,
        "userLiveUsedAsInput": False,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(output_dir / "manifest.json", manifest)
    atomic_json(output_dir / "audit.json", audit)


def atomic_json(path: Path, value: dict) -> None:
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    partial.replace(path)


def main() -> None:
    args = parse_args()
    source_dir = Path(args.source_dir)
    source_path = source_dir / "dataset.ndjson"
    source_manifest_path = source_dir / "manifest.json"
    source_audit_path = source_dir / "audit.json"
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    source_audit = json.loads(source_audit_path.read_text(encoding="utf-8"))
    if source_manifest.get("datasetVersion") != DATASET_VERSION:
        raise RuntimeError("Unexpected source dataset version")
    if source_manifest.get("auditPassed") is not True or source_audit.get("passed") is not True:
        raise RuntimeError("Source Dataset V3 audit did not pass")
    source_sha = str(source_manifest["artifact"]["sha256"])

    matches = scan_matches(source_path)
    policy, replay, groups = select_matches(
        matches,
        timestamp(args.training_window_start),
        timestamp(args.training_window_end),
        timestamp(args.tuning_start),
        timestamp(args.future_test_start),
        args.policy_match_count,
        args.replay_train_match_count,
        args.replay_tuning_match_count,
        args.replay_future_match_count,
    )

    policy_dir = Path(args.policy_output_dir)
    replay_dir = Path(args.replay_output_dir)
    policy_result = write_selected(source_path, policy_dir / "dataset.ndjson", policy)
    replay_result = write_selected(source_path, replay_dir / "dataset.ndjson", replay)

    policy_selection = {
        "strategy": "EARLIEST_CHRONOLOGICAL_MATCHES_IN_POLICY_WINDOW",
        "matchCount": len(policy),
        "trainingWindowStart": args.training_window_start,
        "trainingWindowEnd": args.training_window_end,
    }
    replay_selection = {
        "strategy": "CHRONOLOGICAL_SPLIT_QUOTAS",
        "matchCount": len(replay),
        "trainMatchCount": len(groups["replayTrain"]),
        "tuningMatchCount": len(groups["replayTuning"]),
        "futureTestMatchCount": len(groups["replayFuture"]),
        "trainingWindowEnd": args.training_window_end,
        "tuningStart": args.tuning_start,
        "futureTestStart": args.future_test_start,
    }

    write_descriptor(
        policy_dir,
        source_manifest,
        source_sha,
        policy_result[0],
        policy_result[1],
        policy_result[2],
        len(policy_result[3]),
        "CANDIDATE_POLICY_5000_MATCHES",
        policy_selection,
    )
    write_descriptor(
        replay_dir,
        source_manifest,
        source_sha,
        replay_result[0],
        replay_result[1],
        replay_result[2],
        len(replay_result[3]),
        "REPLAY_TRAINING_5000_MATCHES",
        replay_selection,
    )

    summary = {
        "sourceDatasetSha256": source_sha,
        "sourceMatchCount": len(matches),
        "policy": {
            "matchCount": len(policy_result[3]),
            "rowCount": policy_result[0],
            "byteLength": policy_result[1],
            "sha256": policy_result[2],
        },
        "replay": {
            "matchCount": len(replay_result[3]),
            "rowCount": replay_result[0],
            "byteLength": replay_result[1],
            "sha256": replay_result[2],
            "trainMatchCount": len(groups["replayTrain"]),
            "tuningMatchCount": len(groups["replayTuning"]),
            "futureTestMatchCount": len(groups["replayFuture"]),
        },
    }
    atomic_json(Path(args.replay_output_dir).parent / "summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == "__main__":
    main()
