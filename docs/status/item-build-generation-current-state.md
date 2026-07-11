# Current Item Build Generation

Дата: 2026-07-11

Документ описывает, как сейчас формируется item build в API и как он потом используется Overwolf HUD. Это не целевая архитектура. Текущая модель имеет архитектурные проблемы: она строит рекомендованный порядок из агрегированных фаз и эвристик, а не из нормализованного per-match item timeline.

## Где находится код

- Backend entry point: `apps/api/src/deadlock-live/all-heroes-analysis.controller.ts`
- Основная логика: `apps/api/src/deadlock-live/all-heroes-analysis.service.ts`
- HUD отображение: `apps/overwolf-client/src/ui.ts`
- Overwolf item event parsing: `apps/overwolf-client/src/index.ts`

Основной API endpoint:

- `GET /deadlock/analysis/hero/:heroId`

Он возвращает `HeroBuildResponse`, внутри которого есть `builds[]`. Каждый build содержит:

- `buildType`: `weapon | spirit | vitality`
- `phases.early`
- `phases.mid`
- `phases.late`
- `coreItems`
- `situationalItems`
- `skillsOrder`
- `skillBuild`

## Источники данных

Сейчас item build строится из Postgres-данных, загруженных crawler-ом:

- `match_players`
- `match_player_items`
- `items`
- `item_components`
- `heroes`

Для героя берутся последние матчи:

```ts
const MAX_MATCHES_PER_HERO = 1000;
```

В `getHeroBuilds(heroId)`:

1. `heroId` приводится к canonical ID.
2. Подтягиваются alias IDs героя.
3. Загружаются `heroesMap`, `itemsMap`, `itemComponentsMap`.
4. Из `match_players` выбираются последние `MAX_MATCHES_PER_HERO` записей по `crawledAt DESC`.
5. Вместе с player-записью загружаются relations:
   - `itemPurchases`
   - `skillUpgrades`
6. Эти players передаются в `computeBuilds(players, itemsMap)`.

## Кластеризация build type

`computeBuilds()` делит матчи героя на 3 группы:

- `weapon`
- `spirit`
- `vitality`

Кластер выбирается по доминирующему суммарному spend в слотах предметов:

```ts
if (meta.item_slot_type === 'weapon') weaponSpend += cost;
else if (meta.item_slot_type === 'spirit') spiritSpend += cost;
else if (meta.item_slot_type === 'vitality') vitalitySpend += cost;
```

Дальше выбирается максимальный spend. Если группа содержит меньше 10 игроков, build для нее не показывается:

```ts
if (group.length < 10) continue;
```

Проблема: это не реальный archetype build. Это грубая группировка по итоговой сумме стоимости предметов в слотах.

## Как собираются phase items

Для каждого кластера вызывается `computeClusterBuild(buildType, players, itemsMap)`.

Внутри считаются:

- `totalMatches`
- `wins`
- `winRate`
- `avgNetWorth`

Затем создаются 4 bucket-а:

- `earlyItems`: покупки до 8 минуты, `< 480s`
- `midItems`: покупки с 8 до 20 минуты, `480-1200s`
- `lateItems`: покупки после 20 минуты, `>= 1200s`
- `allItemData`: только финальные permanent items, используется для `coreItems` и `situationalItems`

Фиксированные cutoffs:

```ts
const EARLY_CUTOFF = 480;
const MID_CUTOFF = 1200;
```

Для всех players заранее считается среднее время покупки по item ID:

```ts
const actualAverageTimesByItem = this.computeActualAverageTimesByItem(players);
```

Это среднее используется потом при эвристическом восстановлении компонентов.

## Reconstruct purchases

Перед тем как положить item в phase bucket, backend вызывает:

```ts
const reconstructedPurchases = this.reconstructPurchases(
  p.itemPurchases || [],
  itemsMap,
  actualAverageTimesByItem,
);
```

`reconstructPurchases()`:

1. Берет реальные raw purchases из `match_player_items`.
2. Сортирует их по `purchaseTimeS`.
3. Для каждой покупки вызывает `buildComponentTimeline()`.
4. Если у предмета есть recipe components, функция пытается вставить недостающие components перед parent item.
5. Потом добавляет сам parent item.
6. Возвращает общий список, отсортированный по `purchaseTimeS`.

Важный момент: если component отсутствует в raw purchases, он может быть добавлен эвристически.

Пример текущей логики:

```ts
const actualAverageTime = actualAverageTimesByItem[componentItemId];
const estimatedPurchaseTimeS =
  actualAverageTime !== undefined && actualAverageTime < parentPurchaseTimeS
    ? actualAverageTime
    : Math.max(0, Math.min(parentPurchaseTimeS - 1, fallbackTime));
```

То есть component time может быть:

- реальным средним временем по всем матчам кластера;
- либо fallback-оценкой перед parent purchase time.

Проблема: это не гарантирует реальный порядок конкретного матча. Это смесь реальных events и восстановленных эвристических events.

## Как определяется final item

Для каждого player считается:

```ts
const finalItemIds = this.getEffectiveFinalItems(p.itemPurchases || []);
```

`getEffectiveFinalItems()`:

1. Убирает предметы, у которых есть `soldTimeS`.
2. Берет оставшиеся held item IDs.
3. Если held component входит в held parent item, component считается consumed и убирается.

Упрощенно:

```ts
if (component C is held && parent P is also held) {
  exclude C;
}
```

Проблема: final set используется для `allItemData`, `coreItems`, `situationalItems` и permanent-флага, но сам build order не является чистым final build и не является чистым purchase timeline. Сейчас это смешанная модель.

## Что попадает в phase buckets

Для каждого reconstructed purchase:

1. Считается `itemId`.
2. Берется `purchaseTimeS`.
3. Проверяется, является ли item финальным:

```ts
const isFinal = finalItemIds.has(itemId);
```

4. Считается статистика total bought vs final kept:

```ts
totalPurchasedCount[itemId] += 1;
if (isFinal) finalPurchasedCount[itemId] += 1;
```

5. Если item финальный, он добавляется в `allItemData`.
6. Если покупка late, то в `lateItems` попадает только final item.
7. Если покупка early/mid, туда могут попасть и temporary, и permanent items.

Текущая семантика фаз:

- Early: реальные или восстановленные покупки до 8 минуты, включая temporary.
- Mid: реальные или восстановленные покупки 8-20 минут, включая temporary.
- Late: только final items после 20 минуты.
- Core/Situational: только final items, без temporary.

Проблема: разные списки имеют разные правила. Это усложняет корректный ordered build.

## Scoring items

Каждый bucket прогоняется через `scoreItems()`.

Для item считается:

```ts
const allPickRate = data.count / bucketTotalPlayers;
const winPickRate = data.wins > 0 ? data.wins / wins : 0;
const rawScore = winPickRate * 0.65 + allPickRate * 0.35;
const score = Math.round(rawScore * 100);
```

Item отбрасывается, если `score < 10`.

Также считается permanent-флаг:

```ts
const isPermanent = (finalKept / totalBought) >= 0.50;
```

В response item получает:

- `id`
- `name`
- `cost`
- `slotType`
- `score`
- `avgPurchaseTimeS`
- `isPermanent`
- `componentItemIds`

Проблема scoring-а: высокий score не означает, что item должен идти раньше. Это win/pick эвристика, а не модель последовательности покупок.

## Как item выбирает одну phase

Один и тот же item может попасть в early, mid и late. Чтобы не дублировать item в нескольких колонках, сейчас выбирается одна preferred phase:

1. Для каждой phase регистрируются scored items.
2. Если item уже был в другой phase, сравнивается score.
3. Побеждает phase с большим score.
4. При равном score побеждает более ранняя phase.

После этого phase items сортируются:

```ts
avgPurchaseTimeS ASC, затем score DESC
```

Проблема: item может покупаться раньше в реальном build path, но оказаться в другой phase из-за score. Это снова не гарантирует правильную последовательность.

## Как режутся phase lists

Финальные phase списки режутся так:

```ts
early: 4 permanent + 2 temporary
mid:   6 permanent + 2 temporary
late:  6 permanent + 0 temporary
```

Возвращается:

```ts
phases: {
  early: slicePhaseItems(uniquePhaseItems('early', earlyScored), 4, 2),
  mid:   slicePhaseItems(uniquePhaseItems('mid',   midScored),   6, 2),
  late:  slicePhaseItems(uniquePhaseItems('late',  lateScored),  6, 0),
}
```

Проблема: cap может выкинуть item, который нужен как component или как обязательный шаг upgrade chain.

## Core и situational items

`coreItems` и `situationalItems` строятся из `allScored`, то есть из `allItemData`.

`allItemData` содержит только final items.

Правила:

```ts
coreItems = score >= 60
situationalItems = score >= 35 && score < 60
```

Проблема: это не ordered build. Это score buckets по финальным предметам.

## Как HUD выбирает следующие предметы

В Overwolf HUD берется уже готовый build:

```ts
const allItemsOrdered = [...earlyList, ...midList, ...lateList];
```

Затем HUD получает локально купленные item IDs из Overwolf events:

```ts
mainWindow.localPurchasedItemIds
```

После последнего фикса HUD раскрывает owned parent item в components:

```ts
const ownedIds = expandOwnedItemIds(purchasedIds, allItemsOrdered);
const remainingItems = allItemsOrdered.filter(item => !isBuildItemAlreadyHandled(item, ownedIds));
const next3Items = remainingItems.slice(0, 3);
```

Это решает частный UI-баг:

- если уже куплен parent item, component больше не предлагается;
- если уже куплен component, сам component больше не предлагается.

Но это не решает главную проблему генерации build order: HUD не строит порядок, он только отображает первые 3 item-а из backend phase order.

## Главные проблемы текущей модели

1. Build order не является реальным порядком покупок из матчей.
2. `reconstructPurchases()` может добавлять components эвристически, даже если их не было в raw item events.
3. Среднее время component-а считается глобально по кластеру, а не по конкретному match timeline.
4. Early/mid/late buckets фиксированы по времени и не учитывают tempo героя, build type и net worth.
5. `score` смешивает win rate и pick rate, но не моделирует вероятность следующей покупки.
6. `coreItems` и `situationalItems` строятся из финальных предметов, но phase build включает temporary items.
7. `preferredPhaseByItem` выбирает одну phase по score, а не по фактическому месту item-а в build chain.
8. `slicePhaseItems()` может выкинуть обязательный component или parent upgrade.
9. Components в response есть только как `componentItemIds`, но build не является explicit graph/path.
10. HUD не знает полный item lifecycle, если Overwolf events не передали sold/consumed state.

## Что нужно переделывать

Целевая модель должна быть не `early/mid/late scored lists`, а ordered item timeline / build graph.

Минимальная новая модель:

```ts
interface BuildStep {
  stepIndex: number;
  itemId: number;
  action: 'BUY' | 'UPGRADE' | 'SELL' | 'SKIP_OPTIONAL';
  parentItemId?: number;
  componentItemIds?: number[];
  componentOfItemId?: number;
  medianPurchaseTimeS: number;
  p25PurchaseTimeS: number;
  p75PurchaseTimeS: number;
  support: number;
  winRate: number;
  confidence: number;
  required: boolean;
  situational: boolean;
  inferred: boolean;
}
```

Новый pipeline должен быть таким:

1. Для каждого match player построить normalized item timeline из реальных `match_player_items`.
2. Не смешивать реальные purchases и inferred components без флага `inferred`.
3. Явно хранить lifecycle:
   - bought
   - sold
   - consumed into parent
   - upgraded into parent
4. Для upgrade chains строить ordered chain:
   - component buy
   - parent upgrade/buy
   - next parent upgrade/buy
5. Агрегировать не отдельные item buckets, а последовательности шагов.
6. Для каждого шага считать median/p25/p75 purchase time и support.
7. Отдельно выделять core path и situational branches.
8. HUD должен идти по `buildSteps`, а не по `[early, mid, late]`.
9. Если component уже куплен, следующим должен стать parent upgrade, а не повтор component.
10. Если parent уже куплен, все его components считаются закрытыми.

## Тесты, которые нужны для переделки

Обязательные cases:

- `High-Velocity Rounds -> Opening Rounds`
- Несколько upgrade chains, не только HVR/Opening.
- Component куплен, parent еще нет: HUD предлагает parent.
- Parent куплен: HUD не предлагает component.
- Component продан и parent не куплен: HUD может снова предлагать component, если он required.
- Temporary starter item не должен попадать в late/core как обязательный final build.
- Один item не должен появляться в нескольких фазах/столбцах.
- `avgPurchaseTimeS`/median order не должен нарушать recipe order.

## Вывод

Сейчас backend генерирует build как статистический список items по фазам, а HUD только фильтрует уже купленные предметы. Это недостаточно для корректной подсказки "что покупать дальше". Для правильной работы нужна отдельная модель ordered build steps, построенная из реальных item events и recipe graph, с явным разделением real и inferred событий.
