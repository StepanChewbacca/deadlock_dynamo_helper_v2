const fs = require('node:fs');

void (async () => {
  const model = JSON.parse(
    fs.readFileSync('/app/apps/api/storage/contextual-v3-training/model.json', 'utf8'),
  );
  const heroIds = Object.keys(model.counts.hero)
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .sort((left, right) => left - right);
  const enemyIds = [...new Set(
    Object.keys(model.counts.enemy)
      .map((key) => Number(key.split('|')[2]))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  )].sort((left, right) => left - right);
  let attempts = 0;

  for (const heroId of heroIds) {
    for (const gameTimeS of [0, 600, 1200]) {
      for (const enemyHeroId of enemyIds) {
        attempts += 1;
        const response = await fetch(
          'http://127.0.0.1:3000/deadlock/analysis/build-recommendation',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              heroId,
              itemIds: [],
              gameTimeS,
              alliedHeroIds: [],
              enemyHeroIds: [enemyHeroId],
              previousActionKeys: [],
              limit: 20,
              minAlternativeHistoricalCount: 0,
              minAlternativeConfidence: 0,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(`Recommendation HTTP ${response.status}`);
        }
        const recommendation = await response.json();
        if (recommendation.recommendationModel !== 'CONTEXTUAL_V3') {
          throw new Error('Recommendation did not come from Contextual V3');
        }
        const action = [recommendation.action, ...recommendation.alternatives].find(
          (candidate) =>
            Array.isArray(candidate.matchupSignals) &&
            candidate.matchupSignals.length > 0,
        );
        if (action) {
          console.log(JSON.stringify({
            attempts,
            heroId,
            gameTimeS,
            enemyHeroId,
            actionKey: action.actionKey,
            label: action.label,
            matchupSignals: action.matchupSignals,
            recommendationModel: recommendation.recommendationModel,
          }));
          return;
        }
        if (attempts >= 600) {
          throw new Error(`No matchup signal found in ${attempts} recommendations`);
        }
      }
    }
  }

  throw new Error(`No matchup signal found in ${attempts} recommendations`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
