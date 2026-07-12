import { Injectable } from '@nestjs/common';
import {
  RecentMatchItemSnapshot,
  RecentMatchPlayerSnapshot,
  RecentMatchSnapshot,
} from './recent-matches-window.service';

export type CanonicalItemActionType =
  | 'BUY'
  | 'UPGRADE'
  | 'SELL'
  | 'REBUY'
  | 'USE'
  | 'CONSUME'
  | 'RECONCILE'
  | 'UNKNOWN_REMOVE';

export type TimelineDiagnosticCode =
  | 'INVALID_ITEM_ID'
  | 'MISSING_PURCHASE_TIME'
  | 'INVALID_PURCHASE_TIME'
  | 'INVALID_SOLD_TIME'
  | 'SOLD_BEFORE_PURCHASE'
  | 'INVALID_UPGRADE_ID';

export interface CanonicalItemAction {
  sequence: number;
  type: CanonicalItemActionType;
  gameTimeS: number;
  itemId: number;
  instanceId: string;
  sourceRowId: number;
  relatedItemId?: number;
  slotOrder?: number;
  evidence: 'purchaseTimeS' | 'soldTimeS' | 'upgradeId';
  confidence: 1;
}

export interface TimelineDiagnostic {
  code: TimelineDiagnosticCode;
  sourceRowId: number;
  itemId?: number;
  details?: Record<string, number>;
}

export interface NormalizedPlayerItemTimeline {
  matchId: number;
  playerId: number;
  heroId: number;
  actions: CanonicalItemAction[];
  diagnostics: TimelineDiagnostic[];
}

export interface NormalizedMatchItemTimelines {
  matchId: number;
  startTime: Date;
  players: NormalizedPlayerItemTimeline[];
  actionCount: number;
  diagnosticCount: number;
}

interface PendingAction extends Omit<CanonicalItemAction, 'sequence'> {
  insertionOrder: number;
}

interface PreviousPurchase {
  purchaseTimeS: number;
  soldTimeS?: number;
}

@Injectable()
export class MatchTimelineNormalizationService {
  normalizeMatch(match: RecentMatchSnapshot): NormalizedMatchItemTimelines {
    const players = match.players.map((player) => this.normalizePlayer(player));

    return {
      matchId: match.matchId,
      startTime: new Date(match.startTime),
      players,
      actionCount: players.reduce((total, player) => total + player.actions.length, 0),
      diagnosticCount: players.reduce((total, player) => total + player.diagnostics.length, 0),
    };
  }

  normalizePlayer(player: RecentMatchPlayerSnapshot): NormalizedPlayerItemTimeline {
    const diagnostics: TimelineDiagnostic[] = [];
    const actions: PendingAction[] = [];
    const previousPurchasesByItemId = new Map<number, PreviousPurchase[]>();
    let insertionOrder = 0;

    const rows = [...player.itemPurchases].sort(compareItemRows);
    for (const row of rows) {
      const itemId = toPositiveInteger(row.itemId);
      if (itemId === undefined) {
        diagnostics.push({ code: 'INVALID_ITEM_ID', sourceRowId: row.id });
        continue;
      }

      const purchaseTimeS = toNonNegativeInteger(row.purchaseTimeS);
      if (row.purchaseTimeS === undefined) {
        diagnostics.push({
          code: 'MISSING_PURCHASE_TIME',
          sourceRowId: row.id,
          itemId,
        });
        continue;
      }
      if (purchaseTimeS === undefined) {
        diagnostics.push({
          code: 'INVALID_PURCHASE_TIME',
          sourceRowId: row.id,
          itemId,
        });
        continue;
      }

      const soldTimeS = this.resolveSoldTime(row, purchaseTimeS, itemId, diagnostics);
      const previousPurchases = previousPurchasesByItemId.get(itemId) ?? [];
      const isRebuy = previousPurchases.some(
        (previous) => previous.soldTimeS !== undefined && previous.soldTimeS <= purchaseTimeS,
      );
      const instanceId = `${player.id}:${row.id}`;

      actions.push({
        type: isRebuy ? 'REBUY' : 'BUY',
        gameTimeS: purchaseTimeS,
        itemId,
        instanceId,
        sourceRowId: row.id,
        slotOrder: row.slotOrder,
        evidence: 'purchaseTimeS',
        confidence: 1,
        insertionOrder: insertionOrder++,
      });

      const upgradeId = this.resolveUpgradeId(row, itemId, diagnostics);
      if (upgradeId !== undefined) {
        actions.push({
          type: 'UPGRADE',
          gameTimeS: purchaseTimeS,
          itemId,
          relatedItemId: upgradeId,
          instanceId,
          sourceRowId: row.id,
          slotOrder: row.slotOrder,
          evidence: 'upgradeId',
          confidence: 1,
          insertionOrder: insertionOrder++,
        });
      }

      if (soldTimeS !== undefined) {
        actions.push({
          type: 'SELL',
          gameTimeS: soldTimeS,
          itemId,
          instanceId,
          sourceRowId: row.id,
          slotOrder: row.slotOrder,
          evidence: 'soldTimeS',
          confidence: 1,
          insertionOrder: insertionOrder++,
        });
      }

      previousPurchases.push({ purchaseTimeS, soldTimeS });
      previousPurchasesByItemId.set(itemId, previousPurchases);
    }

    actions.sort(compareActions);

    return {
      matchId: player.matchId,
      playerId: player.id,
      heroId: player.heroId,
      actions: actions.map(({ insertionOrder: _insertionOrder, ...action }, index) => ({
        ...action,
        sequence: index + 1,
      })),
      diagnostics,
    };
  }

  private resolveSoldTime(
    row: RecentMatchItemSnapshot,
    purchaseTimeS: number,
    itemId: number,
    diagnostics: TimelineDiagnostic[],
  ): number | undefined {
    if (row.soldTimeS === undefined) {
      return undefined;
    }

    const soldTimeS = toNonNegativeInteger(row.soldTimeS);
    if (soldTimeS === undefined) {
      diagnostics.push({
        code: 'INVALID_SOLD_TIME',
        sourceRowId: row.id,
        itemId,
      });
      return undefined;
    }

    if (soldTimeS < purchaseTimeS) {
      diagnostics.push({
        code: 'SOLD_BEFORE_PURCHASE',
        sourceRowId: row.id,
        itemId,
        details: { purchaseTimeS, soldTimeS },
      });
      return undefined;
    }

    return soldTimeS;
  }

  private resolveUpgradeId(
    row: RecentMatchItemSnapshot,
    itemId: number,
    diagnostics: TimelineDiagnostic[],
  ): number | undefined {
    if (row.upgradeId === undefined || row.upgradeId === 0) {
      return undefined;
    }

    const upgradeId = toPositiveInteger(row.upgradeId);
    if (upgradeId === undefined || upgradeId === itemId) {
      diagnostics.push({
        code: 'INVALID_UPGRADE_ID',
        sourceRowId: row.id,
        itemId,
      });
      return undefined;
    }

    return upgradeId;
  }
}

function compareItemRows(left: RecentMatchItemSnapshot, right: RecentMatchItemSnapshot): number {
  const leftTime = left.purchaseTimeS ?? Number.MAX_SAFE_INTEGER;
  const rightTime = right.purchaseTimeS ?? Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftSlot = left.slotOrder ?? Number.MAX_SAFE_INTEGER;
  const rightSlot = right.slotOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftSlot !== rightSlot) {
    return leftSlot - rightSlot;
  }

  return left.id - right.id;
}

function compareActions(left: PendingAction, right: PendingAction): number {
  if (left.gameTimeS !== right.gameTimeS) {
    return left.gameTimeS - right.gameTimeS;
  }

  const typeDifference = actionPriority(left.type) - actionPriority(right.type);
  if (typeDifference !== 0) {
    return typeDifference;
  }

  return left.insertionOrder - right.insertionOrder;
}

function actionPriority(type: CanonicalItemActionType): number {
  switch (type) {
    case 'SELL':
      return 0;
    case 'BUY':
    case 'REBUY':
      return 1;
    case 'UPGRADE':
      return 2;
    default:
      return 3;
  }
}

function toPositiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function toNonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
