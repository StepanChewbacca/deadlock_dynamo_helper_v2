# Inventory transaction reconstruction

Live inventory snapshots do not include an ordered purchase transaction log. The
reconstructor explains each adjacent snapshot pair with a deterministic multiset
action sequence.

## Reconstruction rules

- Inventory state is represented as item counts, not a set of item IDs.
- Added items are considered as either direct buys or recipe upgrades.
- An upgrade is legal only when every recipe component can be removed with its
  full multiplicity.
- Overlapping recipe explanations are optimized by the number of consumed
  removed components. This produces the minimum BUY/SELL/UPGRADE action count.
- Equal optimal explanations use a deterministic canonical result and are marked
  ambiguous.
- The selected explanation is replayed through the shared multiset action engine.
  A result is accepted only when replay reaches the observed snapshot exactly.

## Confidence values

- `EXACT_SINGLE_ACTION` - one validated action explains the interval.
- `MULTI_ACTION_INTERVAL` - multiple validated actions are required.
- `AMBIGUOUS_MULTI_ACTION` - multiple equally optimal explanations exist.
- `UNRESOLVED` - no action was observed or exact replay validation failed.

The legacy Contextual V3 action-key helper remains available and delegates to the
structured reconstructor. Live recommendation telemetry stores the structured
confidence instead of inferring confidence only from the number of action keys.
