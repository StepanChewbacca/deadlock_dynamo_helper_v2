# Item Build Refactor: Answers From Current Code and Database

Дата: 2026-07-11

Это ответы на список вопросов по текущей реализации. Источники: код проекта в `/home/chewie/deadlock` и фактическая PostgreSQL база на `my-vps`.

## 1. Какие файлы отвечают за текущую логику

Основные файлы существуют и сейчас используются:

- `apps/api/src/deadlock-live/all-heroes-analysis.service.ts`
- `apps/api/src/deadlock-live/all-heroes-analysis.controller.ts`
- `apps/overwolf-client/src/index.ts`
- `apps/overwolf-client/src/ui.ts`

Entities:

- `apps/api/src/deadlock-live/entities/match.entity.ts`
- `apps/api/src/deadlock-live/entities/match-player.entity.ts`
- `apps/api/src/deadlock-live/entities/match-player-item.entity.ts`
- `apps/api/src/deadlock-live/entities/item.entity.ts`
- `apps/api/src/deadlock-live/entities/item-component.entity.ts`
- `apps/api/src/deadlock-live/entities/match-player-skill-upgrade.entity.ts`

## 2. Как выглядит `match_player_items`

Entity:

```ts
@Entity('match_player_items')
export class MatchPlayerItem {
  id!: number;
  matchPlayerId!: number;
  itemId!: number;
  purchaseTimeS!: number | null;
  soldTimeS!: number | null;
  upgradeId!: number | null;
  flags!: number | null;
  imbuedAbilityId!: number | null;
  upgradeInfo!: number | null;
  slotOrder!: number | null;
  createdAt!: Date;
}
```

Фактические колонки в PostgreSQL:

- `id`
- `matchPlayerId`
- `itemId`
- `purchaseTimeS`
- `soldTimeS`
- `slotOrder`
- `createdAt`
- `upgradeId`
- `flags`
- `imbuedAbilityId`
- `upgradeInfo`

Чего нет:

- `quantity`
- отдельного `slot`
- `matchId` напрямую в `match_player_items`
- `playerId`/Steam ID
- item instance ID
- явного `eventType`
- явного поля `consumedByItemId`

`matchId` и `heroId` доступны только через join на `match_players`.

## 3. Реальный пример `match_player_items`

Пример из VPS:

- `matchPlayerId`: `39516`
- `matchId`: `91053493`
- `heroId`: `15`

```text
slotOrder | itemId     | name              | purchaseTimeS | soldTimeS | upgradeId | flags | imbuedAbilityId | upgradeInfo
0         | 3399065363 | Sprint Boots      | 67            | 153       | 1         | 1     | 0               | 65537
1         | 3074274290 | Trophy Collector  | 153           | 0         | 1         | 0     | 0               | 65537
2         | 1998374645 | Mystic Burst      | 243           | 1314      | 1         | 1     | 0               | 65537
3         | 754480263  | Mystic Expansion  | 357           | 0         | 1         | 0     | 2521902222      | 65537
4         | 465043967  | Spirit Strike     | 358           | 776       | 1         | 1     | 0               | 65537
5         | 968099481  | Extra Spirit      | 458           | 775       | 1         | 1     | 0               | 65537
6         | 1150006784 | Arcane Surge      | 552           | 0         | 1         | 0     | 0               | 65537
7         | 1292979587 | Surge of Power    | 775           | 0         | 1         | 0     | 2521902222      | 65537
8         | 3190916303 | Spirit Snatch     | 776           | 0         | 1         | 0     | 0               | 65537
9         | 7409189    | Improved Spirit   | 887           | 1815      | 1         | 1     | 0               | 65537
10        | 3261353684 | Superior Cooldown | 1003          | 1670      | 1         | 1     | 0               | 65537
11        | 865958998  | Veil Walker       | 1164          | 0         | 1         | 0     | 0               | 65537
```

Вывод по примеру:

- Покупки имеют `purchaseTimeS`.
- Продажи/исчезновения представлены через `soldTimeS > 0`.
- `flags = 1` часто совпадает с предметами, которые потом имеют `soldTimeS > 0`.
- `upgradeId` сейчас почти везде `1`, по текущим данным это не является useful parent item ID.
- `imbuedAbilityId` бывает заполнен для imbue-предметов.
- `slotOrder` сейчас является порядком item в массиве API, а не настоящим inventory slot.

## 4. Что источник записывает по item lifecycle

На основании кода crawler-а:

```ts
const rawItems: any[] = p.items || [];

buildItems.push({
  id: item.item_id,
  purchaseTimeS: item.game_time_s || 0,
  soldTimeS: item.sold_time_s || 0,
  upgradeId: item.upgrade_id || 0,
  flags: item.flags || 0,
  imbuedAbilityId: item.imbued_ability_id || 0,
  upgradeInfo: item.upgrade_info || 0,
});
```

Ответы:

- Покупку component: да, если она есть в `players[].items`.
- Покупку parent: да, если она есть в `players[].items`.
- Только итоговый parent: возможно, если API так отдаст матч, но текущая схема не отличает это от обычной покупки.
- Продажу: да, через `soldTimeS`.
- Повторную покупку: схема технически позволяет несколько строк с одним `itemId`, но в текущей базе duplicate item per player не найдено.
- Использование consumable: отдельного event type нет.
- Исчезновение после upgrade: явно не хранится как `consumed`; может выглядеть как `soldTimeS > 0` у component, но это надо подтверждать по raw API.

Фактическая статистика из VPS:

- `match_player_items`: `451424` строк.
- Строк с `soldTimeS > 0`: `161880`.
- Строк с `upgradeId != 0`: `451424`.
- Duplicate `(matchPlayerId, itemId)`: `0` пар на текущих данных.

## 5. Есть ли patch/build/version матча

Нет. В текущей entity `Match` есть только:

```ts
matchId: number;
startTime: Date;
durationS: number;
averageBadge: number;
winningTeam: number;
crawledAt: Date;
```

Фактические колонки:

- `matchId`
- `startTime`
- `durationS`
- `averageBadge`
- `winningTeam`
- `crawledAt`

Patch/build/version не сохраняется.

Следствие: сейчас нельзя корректно фильтровать статистику по patch. Матчи до/после изменения item recipe, стоимости или mechanics смешиваются.

## 6. Что означает лимит 16 слотов

В текущем коде лимит `16` относится к skill order, а не item inventory.

В crawler:

```ts
const skillsOrder = skillItems
  .sort((a, b) => a.time - b.time)
  .map((s) => mapAbilityToSkillNumber(heroId, s.abilityId))
  .slice(0, 16);
```

Для item slots текущая модель не знает:

- 16 общих slots или нет;
- weapon/vitality/spirit/flex slot availability;
- можно ли купить upgrade при полном inventory;
- сколько слотов освобождает upgrade;
- заблокированы ли flex slots.

`slotOrder` в `match_player_items` не является inventory slot. Это index строки при сохранении `buildItems.map((item, index) => ...)`.

## 7. Что такое "яйцо" в данных

Точного ответа в текущем коде нет.

В `all-heroes-analysis.service.ts` есть комментарий:

```ts
// early and mid can contain temporary items (like Extra Regen or Golden Goose Egg)
```

Но отдельной модели consumable items нет:

- item ID яйца в коде не зафиксирован;
- use event не хранится;
- освобождение слота не хранится;
- sell/use не различаются;
- исчезновение может быть только косвенно через `soldTimeS`.

Чтобы ответить точно, нужно найти item в `items` по названию и посмотреть raw `players[].items` по матчам, где он покупался.

## 8. Как представлены recipes

Recipes хранятся в таблице `item_components`.

Entity:

```ts
@Entity('item_components')
@Unique(['parentItemId', 'componentItemId'])
export class ItemComponent {
  id!: number;
  parentItemId!: number;
  componentItemId!: number;
  componentOrder!: number;
  createdAt!: Date;
}
```

Загрузка recipes:

```ts
const itemComponents = await this.itemComponentRepo.find({
  order: { parentItemId: 'ASC', componentOrder: 'ASC' },
});
```

Формат runtime map:

```ts
Record<parentItemId, componentItemId[]>
```

Примеры из VPS:

```text
Improved Spirit       <- Extra Spirit
Armor Piercing Rounds <- High-Velocity Rounds
Express Shot          <- High-Velocity Rounds
Leech                 <- Bullet Lifesteal + Spirit Lifesteal
Veil Walker           <- Sprint Boots
Transcendent Cooldown <- Superior Cooldown
```

Ответы:

- Components сейчас трактуются как обязательный список.
- Альтернативные recipes не моделируются.
- Несколько одинаковых components невозможны из-за unique `(parentItemId, componentItemId)`.
- Цепочки глубже одного уровня технически поддержаны в `buildComponentTimeline()` через рекурсию.
- Один component может быть component сразу для нескольких parents. Пример: `High-Velocity Rounds` входит в `Armor Piercing Rounds` и `Express Shot`.
- Входит ли стоимость component в parent price: текущая модель это не хранит.
- Можно ли купить parent без component: текущая модель это не валидирует.

## 9. Может ли игрок иметь два одинаковых предмета

Текущая база на момент проверки не содержит duplicate `(matchPlayerId, itemId)`:

```text
duplicate_item_player_pairs = 0
```

Но схема не запрещает duplicates:

- нет unique constraint на `(matchPlayerId, itemId)`;
- нет instance ID;
- HUD использует `Set<itemId>`, поэтому duplicates были бы потеряны.

Практический ответ: текущая реализация предполагает, что duplicates не нужны. Если игра допускает duplicates хотя бы для части items, текущая модель сломается.

## 10. Какие события реально предоставляет Overwolf

В текущем клиенте обрабатываются item events:

```ts
if (event.category === 'items' || (event.key && event.key.startsWith('items_'))) {
  const payload = event.payload || {};
  const rawItems = payload.items || [];
  const boughtIds = rawItems
    .map((item) => Number(item.id ?? item.itemId ?? item.item_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  mainWindow.localPurchasedItemIds = new Set(boughtIds);
}
```

Backend live state ожидает payload:

```ts
payload = {
  steam_id: string,
  items: [
    {
      id: number,
      name: string,
      class_name: string,
      enhanced?: boolean
    }
  ]
}
```

Ответы по Overwolf:

- Покупка: текущий код видит новый item в snapshot-like `payload.items`.
- Продажа: отдельное событие продажи не обрабатывается; item просто исчезнет из `payload.items`, если Overwolf так отдаст snapshot.
- Использование: отдельное событие use не обрабатывается.
- Upgrade: отдельное событие upgrade не обрабатывается.
- Reconnect: специальной item recovery logic нет.
- Порядок событий: код не гарантирует и не валидирует порядок.
- Initial inventory snapshot: код готов принять snapshot `items`, но не гарантирует, что он приходит.
- Periodic snapshot: backend live state умеет хранить snapshots по интервалу, но это не item-specific recovery protocol.
- События между матчами: состояние сбрасывается только общей match/roster логикой, отдельной строгой очистки item lifecycle нет.

## 11. Где сейчас выполняется динамическая логика

Сейчас логика разделена так:

- Backend строит build lists: `phases`, `coreItems`, `situationalItems`.
- HUD берет `[...early, ...mid, ...late]`.
- HUD фильтрует уже купленные item IDs из `localPurchasedItemIds`.
- HUD показывает первые 3 оставшихся item-а.

Компоненты в HUD учитываются только частично:

```ts
const ownedIds = expandOwnedItemIds(purchasedIds, allItemsOrdered);
const remainingItems = allItemsOrdered.filter(item => !isBuildItemAlreadyHandled(item, ownedIds));
```

Это не полноценная recommendation policy. Это frontend-фильтр поверх backend list.

## 12. Что сейчас видит игрок

В HUD игрок видит:

- `Next Items to Buy`;
- максимум 3 item-а;
- skill actions;
- matchup/situational adjustments, если они есть.

Игрок сейчас не видит:

- explicit component chain;
- buy vs upgrade distinction;
- sell recommendation;
- use consumable recommendation;
- "нет свободного слота";
- confidence/support по item step;
- branch selection state.

## 13. Как сейчас определяется build archetype

Текущий build archetype:

- `weapon`
- `spirit`
- `vitality`

Определяется по максимальному суммарному spend в `itemSlotType`.

Логика:

```ts
if (meta.item_slot_type === 'weapon') weaponSpend += cost;
else if (meta.item_slot_type === 'spirit') spiritSpend += cost;
else if (meta.item_slot_type === 'vitality') vitalitySpend += cost;

const dominant =
  weaponSpend >= spiritSpend && weaponSpend >= vitalitySpend
    ? 'weapon'
    : spiritSpend >= vitalitySpend
    ? 'spirit'
    : 'vitality';
```

Ответ: текущая кластеризация грубая. Реальных archetypes вроде `Spirit Burst`, `Weapon Sustain`, `Tank Frontline`, `Hybrid` сейчас нет.

## 14. Какую метрику сейчас оптимизирует build

Текущая item score формула:

```ts
const allPickRate = data.count / bucketTotalPlayers;
const winPickRate = data.wins > 0 ? data.wins / wins : 0;
const rawScore = winPickRate * 0.65 + allPickRate * 0.35;
const score = Math.round(rawScore * 100);
```

То есть сейчас оптимизируется смесь:

- 65% pick rate среди победителей;
- 35% общий pick rate.

Это не causal win probability и не "лучший build". Selection bias есть: дорогие late items будут выглядеть хорошо, потому что их чаще покупают в выигранных играх.

## 15. Какие данные о матче доступны кроме items

Сейчас в `matches`:

- `matchId`
- `startTime`
- `durationS`
- `averageBadge`
- `winningTeam`
- `crawledAt`

Сейчас в `match_players`:

- `matchId`
- `heroId`
- `team`
- `won`
- `kills`
- `deaths`
- `assists`
- `netWorth`
- `crawledAt`

Нет:

- lane opponent;
- enemy lane mapping;
- net worth timeline;
- souls by minute;
- region;
- patch;
- player Steam ID в historical table;
- replay item inventory snapshots;
- explicit event IDs.

## 16. Какой объем данных сейчас

На VPS на момент проверки:

- `match_player_items`: `451424` строк.

Текущий build endpoint берет максимум:

```ts
const MAX_MATCHES_PER_HERO = 1000;
```

Это последние `match_players` для героя по `crawledAt DESC`.

Ответ: 1000 последних player-записей на героя действительно может быть мало после фильтрации по patch/rank/archetype. Сейчас patch/rank фильтрации нет.

## 17. Нужна ли обратная совместимость API

Код Overwolf сейчас завязан на старые поля:

- `builds[]`
- `phases.early`
- `phases.mid`
- `phases.late`
- `coreItems`
- `situationalItems`
- `skillBuild`

HUD явно делает:

```ts
const allItemsOrdered = [...earlyList, ...midList, ...lateList];
```

Ответ: если backend сразу перейдет только на `buildGraph/buildSteps`, текущий Overwolf UI сломается. Нужна либо обратная совместимость, либо одновременная переделка HUD.

Практичный вариант:

- временно возвращать старые `phases`;
- добавить новые поля `buildSteps`/`buildGraph`;
- переключить HUD на новые поля;
- потом удалить старую модель.

## 18. Нужно ли хранить build как граф

Да, текущая модель плоских phase arrays недостаточна.

Причина: текущий список не умеет корректно выразить inventory state transitions:

- component уже есть;
- parent уже есть;
- component продан;
- consumable использован;
- inventory полный;
- starter item надо продать;
- игрок отклонился от основного пути.

Рекомендуемая целевая модель:

```ts
interface BuildNode {
  id: string;
  inventorySignature: string;
  outgoingEdges: BuildEdge[];
}

interface BuildEdge {
  action: 'BUY' | 'UPGRADE' | 'SELL' | 'USE';
  itemId: number;
  resultingInventorySignature: string;
  support: number;
  confidence: number;
  medianTimeS: number;
  requiredSlotDelta: number;
  tags: Array<'CORE' | 'TEMPORARY' | 'SITUATIONAL'>;
}
```

Но перед этим нужно расширить normalized timeline, потому что текущая historical schema не хранит достаточно lifecycle-семантики.

## 19. Что нужно сделать перед рефакторингом

Минимальные технические шаги:

1. Добавить normalized item event model: `BUY`, `SELL`, `UPGRADE`, `USE`, `CONSUME`.
2. Добавить `source`: `REAL_API` или `INFERRED_RECIPE`.
3. Добавить `eventTimeS`.
4. Добавить `itemInstanceId` или другой surrogate для duplicates/future-proof inventory.
5. Добавить patch/build version в `matches`, если Deadlock API отдает это поле.
6. Перестать использовать `slotOrder` как inventory slot.
7. Строить build path из per-player timelines, а не из phase buckets.
8. Сохранить старый response до миграции HUD.

## 20. Короткий вывод

Текущие данные лучше, чем просто final build: есть `purchaseTimeS` и `soldTimeS`, а значит можно строить реальный timeline. Но текущая модель все еще недостаточна для правильного item recommender-а, потому что нет patch/version, нет explicit event type, нет item instances, нет real inventory slot state и нет явного consumed/upgraded lifecycle.

Главный следующий шаг: ввести normalized item events и build graph, а старые `early/mid/late` оставить только как compatibility layer на время миграции UI.
