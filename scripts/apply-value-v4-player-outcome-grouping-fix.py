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
    "    const outcomesByMatch = new Map<string, boolean>();\n",
    "    const outcomesByMatchPlayer = new Map<string, boolean>();\n",
    "outcome map declaration",
)
service = replace_once(
    service,
    "      const outcome = Boolean(row.outcomeLabel.playerWon);\n"
    "      const existingOutcome = outcomesByMatch.get(row.matchId);\n"
    "      if (existingOutcome !== undefined && existingOutcome !== outcome) {\n"
    "        conflictingEligibleMatchOutcomeCount += 1;\n"
    "      } else {\n"
    "        outcomesByMatch.set(row.matchId, outcome);\n"
    "      }\n",
    "      const outcome = Boolean(row.outcomeLabel.playerWon);\n"
    "      const matchPlayerKey = `${row.matchId}\\u0000${row.steamId}`;\n"
    "      const existingOutcome = outcomesByMatchPlayer.get(matchPlayerKey);\n"
    "      if (existingOutcome !== undefined && existingOutcome !== outcome) {\n"
    "        conflictingEligibleMatchOutcomeCount += 1;\n"
    "      } else {\n"
    "        outcomesByMatchPlayer.set(matchPlayerKey, outcome);\n"
    "      }\n",
    "match-player outcome validation",
)
service = replace_once(
    service,
    "          'The outcome-eligible source subset contains conflicting outcomes within a match.',\n",
    "          'The outcome-eligible source subset contains conflicting outcomes for one player within a match.',\n",
    "conflict error message",
)
service_path.write_text(service)


test_path = Path("apps/api/test/recommendation-value-v4-training.spec.ts")
test = test_path.read_text()
test = replace_once(
    test,
    "  it('rejects conflicting outcomes within one eligible match', async () => {\n",
    "  it('allows opposite player outcomes within the same eligible match', async () => {\n"
    "    const rows = createSourceRows();\n"
    "    rows.push(\n"
    "      createRow({\n"
    "        decisionId: 'opponent-decision',\n"
    "        matchId: 'match-1',\n"
    "        steamId: 'steam-opponent',\n"
    "        occurredAt: '2026-01-01T00:04:00.000Z',\n"
    "        actionKey: 'BUY:3',\n"
    "        playerWon: false,\n"
    "      }),\n"
    "    );\n"
    "    await writeSourceArtifacts(rows, sourceDirectory, 11);\n"
    "    const service = new RecommendationValueV4TrainingService();\n"
    "    await service.onModuleInit();\n\n"
    "    await service.start({ trainFraction: 0.6 });\n"
    "    await service.waitForIdle();\n\n"
    "    expect(service.getStatus()).toMatchObject({\n"
    "      state: 'COMPLETE',\n"
    "      eligibleSourceRowCount: 11,\n"
    "      sourceMatchCount: 5,\n"
    "    });\n"
    "  });\n\n"
    "  it('rejects conflicting outcomes for one player within one eligible match', async () => {\n",
    "multi-player outcome test insertion",
)
test = replace_once(
    test,
    "      error: expect.stringContaining('conflicting outcomes within a match'),\n",
    "      error: expect.stringContaining('conflicting outcomes for one player within a match'),\n",
    "conflict assertion",
)
test = replace_once(
    test,
    "  playerWon: boolean;\n  inventoryStateKey?: string;\n",
    "  playerWon: boolean;\n  steamId?: string;\n  inventoryStateKey?: string;\n",
    "createRow input steam id",
)
test = replace_once(
    test,
    "    steamId: `steam-${input.matchId}`,\n",
    "    steamId: input.steamId ?? `steam-${input.matchId}`,\n",
    "createRow steam id assignment",
)
test_path.write_text(test)
