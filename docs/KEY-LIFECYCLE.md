# Key lifecycle

Every key and secret IndexArc creates, where it lives, how it changes, and how
it ends. This is the reference for ASVS V6.4 (key management). The threat model
is in [THREAT-MODEL.md](THREAT-MODEL.md); the requirement mapping is in
[ASVS-L2.md](ASVS-L2.md).

All paths are relative to the data root (the install folder, or
`INDEXARC_ROOT`).

## Inventory

| Key / secret | Created from | Stored | Lives | Changed by | Destroyed |
|---|---|---|---|---|---|
| **Master password** | the user | nowhere | typed at setup, unlock, password change | Change password | never stored; JS strings cannot be wiped |
| **Vault key** (256-bit) | Argon2id(master password, salt): 64 MiB, t=3, p=4 | memory only | from unlock until lock | password change, KDF upgrade | `lock()` zero-fills it; also on quit and auto-lock |
| **Vault salt** (16 bytes) | CSPRNG | in the clear in `data/vault.json` (and `vault.db` meta) | until the next re-key | password change, KDF upgrade | replaced |
| **Row keys** | none: rows use the vault key directly, with AAD `indexarc:v2:<table>:<id>` | n/a | n/a | with the vault key | with the vault key |
| **File AAD labels** | fixed: `indexarc:file:v1:<role>` | in each envelope (authenticated) | n/a | n/a | n/a |
| **Row-checksum key** | HKDF-SHA256(vault key, `indexarc:rowsum:v1`) | memory only (cached per vault key) | while unlocked | with the vault key | dropped with the vault key |
| **CLI token digest key** | HKDF-SHA256(vault key, `indexarc:cli-token:v1`) | memory only | while unlocked | with the vault key | dropped with the vault key |
| **CLI tokens** | 32 bytes CSPRNG, prefixed | user's machine only (`indexarc login` file, mode 0600); the app keeps HMAC digests in `data/cli-tokens.json` | until revoked | revoke in Settings → CLI access | revoked one by one, or **all** on any re-key |
| **Recovery key pair** (X25519) | CSPRNG at "Create recovery key" | private key: shown once as the recovery code, never stored; public key in `data/recovery.json` | until replaced or removed | "Create recovery key" again | "Remove recovery key" deletes `recovery.json` |
| **Recovery seal** | vault key sealed to the recovery public key (ephemeral X25519 + HKDF-SHA256 + AES-256-GCM, AAD `indexarc:recovery:vault-key:v1`) | `data/recovery.json` | until the next key change | resealed automatically after every key change | removed with the recovery key |
| **Settings wrap key** (256-bit) | CSPRNG, packaged builds only | `config/settings.key.enc`, wrapped by the OS (`safeStorage`: DPAPI, Keychain, libsecret); unwrapped by the shell and passed to the server in its environment | for the life of the OS user profile | not rotated | never deleted automatically: deleting it orphans the API keys wrapped with it |
| **API pairing token** | 32 bytes CSPRNG per app start | shell memory, server environment, renderer (via sender-checked IPC) | one app run | every start | process exit |
| **SSE tickets** | CSPRNG | server memory | one use, 30 seconds | per request | on use or expiry |
| **Integrity manifest key** | 32 bytes CSPRNG | `config/manifest.key`, in the clear | indefinitely | not rotated | not destroyed |
| **Export key** | Argon2id(export passphrase of 12+ characters, fresh salt) | memory, for one export or import | one operation | per export | dropped after use |

The previous vault key also lives briefly in `vault.db` meta `prev_key`, sealed
under the new key, during a password change (see below).

## Flows

### Set up encryption

1. The user picks a master password. It must pass the policy in
   `shared/password-policy.ts`: 12+ characters, not a common password,
   strength score 2+.
2. A fresh salt is generated and the vault key derived (Argon2id).
3. Every file is written under the vault key: the `vault.json` header and the
   JSON companions with their role AAD, and each `vault.db` row with its row
   AAD. The row checksum is computed, and the header records that it exists.
4. Plaintext backups that existed before are moved to
   `backups/plaintext-grace/`. The first unlock 24 hours or more later deletes
   them.

### Unlock

1. The KDF parameters and salt are read from the header. Parameters outside the
   enforced bounds are refused (`kdfWithinBounds`), so a tampered header cannot
   downgrade the KDF.
2. The vault key is derived and checked by opening the header (AES-GCM with
   AAD).
3. Repairs and upgrades, in order:
   - finish an interrupted re-key (`prev_key`);
   - upgrade the KDF if the parameters are older than the current ones (a full
     re-key under a new salt);
   - bind files written before AAD existed (companions first, header last);
   - check the row checksum. A mismatch is reported as an integrity warning;
     it is not repaired.
4. Failed attempts are throttled.

### Lock (manual, auto-lock, minimise, quit)

`lock()` zero-fills the vault key, drops it and the derived keys, and clears the
decrypted caches. Auto-lock defaults to 5 minutes of inactivity. CLI reads do
not extend it.

### Change password (re-key)

1. The old password is verified, then a new salt is generated and a new key
   derived.
2. The old key is written to `vault.db` meta `prev_key`, sealed under the
   new key.
3. The header and companion files are rewritten under the new key as one
   staged commit.
4. The rows are resealed under the new key, which clears `prev_key`, and the
   row checksum is recomputed.
5. If the process stops between steps 3 and 4, the next unlock (with the new
   password) unseals `prev_key` and finishes the rows. Nothing is ever written
   in plaintext along the way.
6. Side effects:
   - every CLI token is revoked, because their digests were keyed from the
     old key;
   - the recovery seal is refreshed;
   - an emergency snapshot is taken.

The recovery code keeps working after a password change: it is resealed, not
revoked. To revoke it, create a new recovery key or remove it.

### KDF upgrade

When the stored parameters are weaker than the current ones (for example a
PBKDF2 vault from before 2.1), a successful unlock re-keys the vault under a
fresh salt with the current Argon2id parameters, by the same steps as a
password change.

### Recover with the recovery code

The code opens the recovery seal and yields the vault key. The user must then
set a new master password, which re-keys everything as above. Anyone holding
the code **and** the vault files can do this, so the code must be stored
offline.

### Remove encryption

Requires the master password. Everything is rewritten in plaintext and the
row checksum is no longer kept (it needs the vault key).

### Export and import

An encrypted export (`.iaexport`) uses its own key, derived from a separate
passphrase (Argon2id with a fresh salt; AES-256-GCM with a fixed AAD). It does
not contain the vault key. A plain `.env` export is plaintext and the UI
warns about it.

## Residual risks

- **While unlocked**, the vault key is in memory, and so are decrypted strings,
  which JavaScript cannot zero. A process with the user's rights can read them.
- **The settings wrap key** is passed to the server process in its environment.
  It protects API keys at rest, not from code running as the user.
- **The integrity manifest key** sits in the clear next to the data, so the
  manifest catches accidents, not an attacker. Tampering with records is caught
  by AES-GCM, AAD and the keyed row checksum instead.
- **Whole-vault rollback** (every file swapped for an older copy together)
  looks the same as restoring a backup, and is not detected.
- **The recovery code** is as powerful as the master password and is not
  revoked by a password change.
- **No hardware-backed keys** (TPM, Secure Enclave, Windows Hello). Using them
  would need a native module; that decision is open in the roadmap.
