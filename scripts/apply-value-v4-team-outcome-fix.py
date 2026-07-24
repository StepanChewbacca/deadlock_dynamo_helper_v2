from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content.replace(old, new, 1)


service_path = Path("apps/api/src/deadlock-live/recommendation-value-v4-training.service.ts")
service = service_path.read_text()
service = replace_once(
    service,
    "      const matchPlayerKey = `${row.matchId}\\u0000${row.steamId}`;\n",
    "      const matchPlayerKey = `${row.matchId}\\u0000${row.steamId}\\u0000${row.teamId ?? 'UNKNOWN_TEAM'}`;\n",
    "team-scoped outcome consistency key",
)
service_path.write_text(service)

test_path = Path("apps/api/test/recommendation-value-v4-training.spec.ts")
test = test_path.read_text()
test = replace_once(
    test,
    "  it('allows opposite player outcomes within the same eligible match', async () => {\n",
    "  it('allows opposite outcomes for the same historical player identifier on different teams', async () => {\n",
    "opposite outcome test title",
)
test = replace_once(
    test,
    "        steamId: 'steam-opponent',\n        occurredAt: '2026-01-01T00:04:00.000Z',\n        actionKey: 'BUY:3',\n        playerWon: false,\n",
    "        steamId: rows[0].steamId,\n        teamId: 2,\n        occurredAt: '2026-01-01T00:04:00.000Z',\n        actionKey: 'BUY:3',\n        playerWon: false,\n",
    "team-scoped opposite outcome fixture",
)
test = replace_once(
    test,
    "  steamId?: string;\n  inventoryStateKey?: string;\n",
    "  steamId?: string;\n  teamId?: number;\n  inventoryStateKey?: string;\n",
    "team id fixture input",
)
test = replace_once(
    test,
    "    teamId: 1,\n",
    "    teamId: input.teamId ?? 1,\n",
    "team id fixture assignment",
)
test_path.write_text(test)
