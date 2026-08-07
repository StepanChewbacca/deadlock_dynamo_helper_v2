#!/usr/bin/env python3

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", required=True)
    parser.add_argument("--timeline-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--missing-limit", type=int, default=500)
    parser.add_argument("--row-limit", type=int, default=100000)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def read_ndjson(path: Path) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                value = json.loads(line)
                if isinstance(value, dict):
                    values.append(value)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    return values


def number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def expected_team(team: Any) -> int | None:
    parsed = number(team)
    if parsed is None or not parsed.is_integer():
        return None
    value = int(parsed)
    if value == 0:
        return 2
    if value == 1:
        return 3
    return value if value > 0 else None


def time_bucket(game_time_s: float) -> str:
    if game_time_s < 180:
        return "<3m"
    if game_time_s < 300:
        return "3-5m"
    if game_time_s < 600:
        return "5-10m"
    if game_time_s < 1200:
        return "10-20m"
    if game_time_s < 1800:
        return "20-30m"
    return ">=30m"


def timeline_data(root: Path, match_id: str, cache: dict[str, dict[str, Any]]) -> dict[str, Any]:
    cached = cache.get(match_id)
    if cached is not None:
        return cached
    directory = root / match_id
    manifest = read_json(directory / "manifest.json")
    snapshots = read_ndjson(directory / "player-snapshots.ndjson")
    value = {"manifest": manifest, "snapshots": snapshots}
    cache[match_id] = value
    return value


def diagnose_row(row: dict[str, Any], root: Path, cache: dict[str, dict[str, Any]]) -> dict[str, Any]:
    match_id = str(row.get("matchId", ""))
    hero_id = int(number(row.get("heroId")) or 0)
    player_id = str(row.get("playerId", ""))
    team_id = expected_team(row.get("team"))
    decision_time = number(row.get("decisionGameTimeS")) or 0.0
    timeline = timeline_data(root, match_id, cache)
    snapshots = timeline["snapshots"]

    exact = [
        snapshot
        for snapshot in snapshots
        if int(number(snapshot.get("heroId")) or 0) == hero_id
        and (team_id is None or int(number(snapshot.get("teamId")) or -1) == team_id)
    ]
    hero_only = [
        snapshot
        for snapshot in snapshots
        if int(number(snapshot.get("heroId")) or 0) == hero_id
    ]
    player = [
        snapshot
        for snapshot in snapshots
        if str(snapshot.get("steamId", "")) == player_id
    ]
    player_team = [
        snapshot
        for snapshot in player
        if team_id is None or int(number(snapshot.get("teamId")) or -1) == team_id
    ]

    exact_times = sorted(
        value
        for snapshot in exact
        if (value := number(snapshot.get("gameTimeS"))) is not None
    )
    before = [value for value in exact_times if value <= decision_time]
    baseline = before[-1] if before else None
    baseline_age = decision_time - baseline if baseline is not None else None
    match_end = number(timeline["manifest"].get("matchEndGameTimeS"))

    if not exact:
        if hero_only:
            cause = "TEAM_MISMATCH"
        elif player:
            cause = "HERO_MISMATCH_FOR_PLAYER"
        else:
            cause = "NO_PLAYER_TIMELINE"
    elif baseline is None:
        cause = "NO_SNAPSHOT_AT_OR_BEFORE_DECISION"
    elif baseline_age is not None and baseline_age > 300:
        cause = "DECISION_BASELINE_STALE"
    else:
        cause = "UNEXPECTED_INCOMPLETE_OUTCOME"

    return {
        "decisionId": row.get("decisionId"),
        "matchId": match_id,
        "playerId": player_id,
        "heroId": hero_id,
        "team": row.get("team"),
        "expectedTeamId": team_id,
        "phase": row.get("phase"),
        "decisionGameTimeS": decision_time,
        "timeBucket": time_bucket(decision_time),
        "cause": cause,
        "timelineSnapshotCount": len(snapshots),
        "exactHeroTeamSnapshotCount": len(exact),
        "heroOnlySnapshotCount": len(hero_only),
        "playerSnapshotCount": len(player),
        "playerTeamSnapshotCount": len(player_team),
        "playerHeroIds": sorted(
            {
                int(value)
                for snapshot in player
                if (value := number(snapshot.get("heroId"))) is not None
                and value.is_integer()
            }
        ),
        "playerTeamIds": sorted(
            {
                int(value)
                for snapshot in player
                if (value := number(snapshot.get("teamId"))) is not None
                and value.is_integer()
            }
        ),
        "firstExactSnapshotGameTimeS": exact_times[0] if exact_times else None,
        "lastExactSnapshotGameTimeS": exact_times[-1] if exact_times else None,
        "baselineGameTimeS": baseline,
        "baselineAgeS": baseline_age,
        "matchEndGameTimeS": match_end,
        "terminalWithin3m": match_end is not None and match_end <= decision_time + 180,
        "terminalWithin5m": match_end is not None and match_end <= decision_time + 300,
        "terminalWithin10m": match_end is not None and match_end <= decision_time + 600,
        "shortHorizonOutcomes": row.get("shortHorizonOutcomes", []),
        "exclusionReasons": row.get("eligibility", {}).get("exclusionReasons", []),
    }


def main() -> None:
    args = parse_args()
    replay_path = Path(args.replay)
    timeline_root = Path(args.timeline_root)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    scanned = 0
    missing = 0
    timeline_joined = 0
    terminal_or_timeline_outcome = 0
    causes: Counter[str] = Counter()
    phases: Counter[str] = Counter()
    buckets: Counter[str] = Counter()
    details: list[dict[str, Any]] = []
    cache: dict[str, dict[str, Any]] = {}

    with replay_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            scanned += 1
            row = json.loads(line)
            joined = row.get("timeline", {}).get("decisionSnapshotJoined") is True
            complete = any(
                outcome.get("complete") is True
                for outcome in row.get("shortHorizonOutcomes", [])
                if isinstance(outcome, dict)
            )
            timeline_joined += 1 if joined else 0
            terminal_or_timeline_outcome += 1 if complete else 0
            if not joined and not complete:
                missing += 1
                detail = diagnose_row(row, timeline_root, cache)
                causes[detail["cause"]] += 1
                phases[str(detail["phase"])] += 1
                buckets[detail["timeBucket"]] += 1
                if len(details) < 50:
                    details.append(detail)
                if missing >= args.missing_limit:
                    break
            if scanned >= args.row_limit:
                break

    report = {
        "schemaVersion": 1,
        "replayPath": str(replay_path),
        "timelineRoot": str(timeline_root),
        "scannedRowCount": scanned,
        "missingCoverageRowCount": missing,
        "sampleTimelineJoinedCount": timeline_joined,
        "sampleCompleteOutcomeCount": terminal_or_timeline_outcome,
        "missingCoverageRateInSample": missing / scanned if scanned else 0,
        "causeCounts": dict(causes.most_common()),
        "phaseCounts": dict(phases.most_common()),
        "decisionTimeBucketCounts": dict(buckets.most_common()),
        "sampleMatchCount": len(cache),
        "examples": details,
    }
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
