# Diagnostic capture storage

The Overwolf diagnostic capture stores raw GEP entries in IndexedDB.

- Database: `deadlock-live-probe-diagnostics`
- Entries are written in ordered batches.
- Metadata and manual markers survive application restarts.
- Legacy localStorage data is migrated once.
- The desktop panel reports `INITIALIZING`, `RECORDING`, `COMPLETE`, or `STORAGE_ERROR`.
- ZIP export reads the complete ordered journal from IndexedDB.
