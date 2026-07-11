# Item Build Refactor: Required Inputs and Architecture Questions

Дата: 2026-07-11

Документ фиксирует вопросы и входные данные, которые нужны перед переделкой item build logic. Главная цель: перестать строить build как плоский список предметов по фазам и перейти к модели реальных item events, inventory state и допустимых переходов.

## 1. Нужен исходный код

В первую очередь нужны файлы:

- `apps/api/src/deadlock-live/all-heroes-analysis.service.ts`
- `apps/api/src/deadlock-live/all-heroes-analysis.controller.ts`
- `apps/overwolf-client/src/index.ts`
- `apps/overwolf-client/src/ui.ts`

Также нужны entities или migrations для таблиц:

- `match_players`
- `match_player_items`
- `items`
- `item_components`

## 2. Нужна структура `match_player_items`

Нужно понять, как выглядит одна запись `match_player_items`.

Нужны все поля entity и 5-10 реальных примеров одного игрока из одного матча.

Особенно важны поля:

- `itemId`
- `purchaseTimeS`
- `soldTimeS`
- `quantity`
- `slot`
- upgrade-related fields
- `matchId`
- `playerId`

Нужно понять, записывает ли источник:

- покупку component;
- покупку parent;
- только итоговый parent;
- продажу;
- повторную покупку;
- использование consumable;
- исчезновение предмета после upgrade.

## 3. Есть ли у матча patch/build/version

Нельзя смешивать матчи до и после изменения:

- стоимости предмета;
- recipe;
- характеристик;
- количества слотов;
- slot type;
- механики consumable.

Нужно понять, где хранится версия игры и насколько точно по ней можно фильтровать.

## 4. Что означает лимит 16 слотов

Нужно формализовать ограничения inventory:

- это 16 общих item slots;
- есть ли отдельные weapon, vitality, spirit и flex slots;
- можно ли купить предмет, когда слот его категории занят, но есть свободный flex;
- можно ли купить upgrade при полном inventory, если upgrade сразу поглощает component;
- может ли один upgrade поглотить несколько предметов и освободить несколько слотов;
- учитываются ли временно заблокированные flex slots.

## 5. Что такое "яйцо" в данных

Нужны:

- item ID;
- точное название;
- как Overwolf сообщает его покупку;
- есть ли событие использования;
- исчезает ли оно из inventory;
- может ли оно быть продано;
- когда именно освобождается слот.

Это определит общую модель consumable items.

## 6. Как представлены recipes

Базовый ожидаемый формат:

```ts
interface ItemRecipe {
  parentItemId: number;
  componentItemIds: number[];
}
```

Но важны дополнительные детали:

- components обязательны все или один из вариантов;
- можно ли купить parent без component;
- входит ли стоимость component в parent price;
- бывают ли цепочки глубже одного уровня;
- бывают ли несколько одинаковых components;
- бывают ли альтернативные recipes;
- может ли item быть component сразу для нескольких parents.

## 7. Может ли игрок иметь два одинаковых предмета

Текущая модель на `Set<itemId>` сломается, если разрешены duplicates.

Если duplicates возможны, inventory должен хранить экземпляры:

```ts
interface InventoryItemInstance {
  instanceId: string;
  itemId: number;
  acquiredAtS: number;
  sourceEventId: string;
}
```

Нужно точно знать, запрещены ли duplicates глобально или только для отдельных items.

## 8. Какие события реально предоставляет Overwolf

Нужны реальные payloads для:

- покупки;
- продажи;
- использования;
- upgrade;
- смерти;
- reconnect;
- начала spectating или повторного подключения.

Также важно:

- события гарантированно приходят по порядку;
- бывают ли пропуски;
- приходит ли initial inventory snapshot;
- можно ли периодически получить полный inventory snapshot;
- очищаются ли события между матчами.

## 9. Где должна выполняться динамическая логика

Возможные варианты:

- backend возвращает готовый build graph, HUD выбирает ветку;
- HUD отправляет inventory на backend и получает следующие items;
- вся recommendation policy работает локально;
- гибрид: backend строит graph, HUD выполняет deterministic inventory traversal.

Для Overwolf обычно предпочтительнее гибрид, чтобы HUD не зависел от запроса после каждой покупки.

## 10. Какой результат должен видеть игрок

Нужно выбрать продуктовую семантику:

- один строгий ordered build;
- три следующих предмета;
- один основной item и два situational;
- component chain с отображением промежуточных покупок;
- рекомендация продажи;
- рекомендация сначала использовать consumable;
- предупреждение "нет свободного слота";
- несколько полноценных build archetypes.

## 11. Как сейчас определяется build archetype

Текущая группировка по `weapon/spirit/vitality` spend слишком грубая.

Возможные признаки для кластеризации:

- последовательность первых ключевых items;
- final high-tier items;
- ability order;
- damage composition;
- purchase transition embeddings;
- timing ключевых powerspikes.

Нужно понять, обязательно ли сохранить ровно три типа:

- `weapon`
- `spirit`
- `vitality`

Или можно вернуть реальные archetypes:

- `Spirit Burst`
- `Weapon Sustain`
- `Tank Frontline`
- `Hybrid`

## 12. Какую метрику нужно оптимизировать

Есть принципиальная разница между:

- самым популярным build;
- build с максимальным win rate;
- build лучших игроков;
- build для конкретного rank;
- build с максимальной вероятностью победы при текущей ситуации;
- наиболее стабильным build с достаточным sample size.

Чистый win rate будет давать сильный selection bias. Например, дорогой late item часто имеет высокий win rate потому, что его чаще покупают уже выигравшие игроки.

## 13. Какие данные о матче доступны кроме items

Особенно полезны:

- rank / MMR;
- lane opponent;
- enemy hero composition;
- ally composition;
- net worth timeline;
- kills / deaths / assists;
- souls by minute;
- game duration;
- win/loss;
- ability order;
- player region;
- patch.

Без contextual features можно построить хороший основной path, но полноценные situational branches будут ограничены.

## 14. Какой объем данных

Нужно знать примерно:

- matches total;
- matches per hero;
- matches per patch;
- average item events per player;
- number of ranks/MMR brackets.

1000 последних записей на героя может быть мало для нескольких archetypes и situational branches, особенно после фильтрации по patch и skill bracket.

## 15. Нужна ли обратная совместимость API

Нужно решить, должен ли новый response временно продолжать возвращать старые поля:

- `phases`
- `coreItems`
- `situationalItems`

Или можно сразу перейти на новую модель:

- `buildGraph`
- `buildSteps`
- `branches`
- `recommendationPolicy`

## 16. Критически важное решение

Не нужно хранить конечный build как один плоский массив. Лучше возвращать граф допустимых переходов, а поверх него иметь основной рекомендованный путь.

Предлагаемая модель:

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

Такая модель естественно решает кейсы:

- component уже есть: выбирается edge покупки parent;
- parent уже есть: component edge больше недоступен;
- component продан: `BUY` edge снова становится доступен;
- consumable использован: слот освобождается;
- inventory полный: остаются только `UPGRADE`, `USE` или `SELL` edges;
- starter item больше не нужен: появляется статистически обоснованный `SELL` edge;
- игрок отклонился от основного build: выбирается ближайшее совместимое состояние, а не ломается весь список.

## 17. Первый следующий шаг

Первым делом нужно собрать и проверить:

- файлы из раздела 1;
- entities/migrations из раздела 1;
- пример timeline одного игрока из одного матча;
- реальные payloads Overwolf item events.

После анализа этих данных можно составить конкретный план рефакторинга с TypeScript-интерфейсами, алгоритмами и тестами.
