# ADR 0001 — Storage engine: SQLite with per-record AES-256-GCM

- **Status:** Accepted (2026-11, roadmap item R3.2)
- **Deciders:** project owner
- **Supersedes:** the single-file JSON vault (`data/vault.json` + `data/vectors.json`)

## Context

Up to 2.1, the vault was one JSON document, encrypted as a single AES-GCM envelope. The vector index lived in a second file of the same shape. Every change, even one renamed label, decrypted, re-serialized, re-encrypted and fsync'd the whole file.

At 3,000 entries `vectors.json` reached ~78 MB. The first load after unlock took ~21 s, and every save rewrote tens of megabytes. Write cost grew linearly with vault size. Since every save rewrote the whole file, a crash during that write could also put the whole vault at risk. Atomic rename protected against this, but at the cost of the full rewrite.

Options considered:

| Option | Verdict |
|---|---|
| Keep JSON, shard into N files | Rewrites shrink, but we would be building a database by hand: indexes, transactions, compaction. |
| SQLCipher (whole-file encryption) | Strong and well-known. But it needs a native module rebuilt for each Electron/Node ABI and target, plus a second crypto stack beside our audited GCM code. |
| **SQLite (`node:sqlite`) + per-record AES-GCM** | **Chosen.** Built into Node 24 / Electron 44, so there is no native dependency. Uses one crypto path (`server/crypto.ts`). Writes are O(record). |
| LevelDB / LMDB | Native modules, and no advantage over SQLite for this workload. |

## Decision

1. **`data/vault.json` becomes a small header.** It holds `{version: 2, storage: "sqlite", encrypted, kdf, salt, iv, authTag, ciphertext}`. The ciphertext seals `{version:2, storage:"sqlite", entries:[]}`, which serves as the key check for unlock. With no password set, the header is plain JSON with the same marker.
2. **Records live in `data/vault.db`.** The tables are `entries` and `vectors`, with columns `(id, entry_id, iv, tag, body)`, plus `meta(k, v)`.
   - Each body is the record's JSON, sealed with AES-256-GCM under the vault key.
   - Each row gets a fresh 96-bit IV.
   - **AAD = `indexarc:v2:<table>:<id>`.** Copying a ciphertext onto another row, or into the other table, fails authentication.
   - Embeddings are stored as packed float64 (base64) inside the sealed body.
3. **Key state is recorded in `meta`:** `enc`, `salt`, `kdf`, `schema`, and `rev` (a monotonic write counter used to deduplicate backups).
4. **Durability pragmas:** `journal_mode=WAL`, `synchronous=FULL` (a committed transaction survives power loss), `secure_delete=ON` (freed pages are zeroed, so replaced ciphertext or plaintext does not linger), and `busy_timeout`.
5. **Ordering rules for key changes.** These make every crash point recoverable:
   - *Encrypting:* write the encrypted header first, then re-seal the rows. A crash leaves plaintext rows under an encrypted header.
   - *Removing the password:* decrypt the rows while the key is live and write them as plaintext first, then write the plaintext header. A crash leaves plaintext rows under an encrypted header (the same recoverable state).
   - *Re-keying (KDF upgrade):* rows keep their old salt and KDF in `meta` until they are rewritten.
   - **`reconcileDbKey`** runs at every unlock. If `meta` does not match the header, it re-seals all rows under the header's key, deriving the old row key from `meta` when needed. It also seals any plaintext rows.
6. **Migration from v1 runs once, on unlock** (or on first read for an unencrypted vault). The order is:
   1. Take a full emergency snapshot of the v1 files.
   2. Write the tables.
   3. Switch the header.
   4. Delete `vectors.json`.

   A crash before step 3 leaves a valid v1 vault, and the migration reruns. A crash after step 3 leaves a stale `vectors.json`, which is deleted on the next read.
7. **Backups and snapshots include the database.**
   - Emergency snapshots carry `files.vault_db`, a `VACUUM INTO` copy that is consistent while the database is open.
   - Locked-state restore vetting opens the image and refuses it if any row is unsealed.
   - Rolling backups write `vault-db-<stamp>.{enc|plain}.sqlite`, skipped when `rev` has not changed.
   - Restore closes the database, removes `-wal` and `-shm`, then swaps the file in.
8. **Plaintext refusal is unchanged.** When encryption is expected, or the header has vanished while the rows are still sealed, reads return empty and writes are refused. Such a vault is never silently rewritten in plaintext.

## Consequences

**Better**
- Writes are O(record). Measured on 10k entries plus 10k 384-d vectors (`server/storage-v2.test.ts`, dev laptop):

  | Operation | Time |
  |---|---|
  | create | ~10 ms |
  | update | ~3 ms |
  | delete | ~5 ms |
  | vector upsert | ~4 ms |
  | full list after unlock | ~0.3 s, including the decrypt of every row |
  | unlock | ~0.1–0.5 s, the memory-hard KDF; rows are not touched |
- A failed write now risks a single row, not the whole file. SQLite transactions replace the write-file-then-rename dance for record data.
- There is no native dependency, and still a single crypto implementation.

**Worse / accepted**
- **Metadata is visible at rest.** Row count, row sizes and ids are visible; ids are random UUIDs. An attacker can tell how many secrets exist and roughly how large each is. In v1, only the total size was visible.
- **Row-level rollback and deletion are not detected.** With file access, an attacker can delete a row or restore an older sealed copy of the same row, and GCM will not flag it. v1 had the same property at the file level, via a file-level HMAC that the attacker could not forge but could replay. A signed `rev` / Merkle root in the header is a follow-up (tracked in R5).
- **Scratchpad, notes, revisions and settings are still JSON envelopes.** They are small and change less often. Moving them into the database is a follow-up once the format has had time in the field.
- **Downgrading is not supported.** Once migrated, a 2.1 build cannot read a v2 vault. The pre-migration emergency snapshot is the rollback path.

## Verification

- `server/storage-v2.test.ts` covers:
  - new-vault layout, with no plaintext secret in any file
  - encrypted and plaintext v1 migration
  - AAD swap detection
  - crash recovery for plaintext-under-encrypted-header and interrupted re-key
  - snapshot round-trip and the encryption check
  - the 10k-entry benchmark
- The existing key-ops, fail-closed, emergency-restore, encrypt-grace and KDF-migration suites all run against v2 unchanged.
