# Phase 16.2: player time-state contract

## State boundary

Player time state belongs to the shared simulation clock, not to the autonomy
worker lease. It has two independent dimensions:

- `presence` is `online` or `offline` and reflects an authenticated gateway bot
  connection;
- `rest` is `awake` or `sleeping` and changes only through an explicit domain
  transition.

A disconnect changes only presence. It never starts sleep, wakes a character or
pauses the world. Reconnect likewise changes only presence. Sleeping may remain
true while the avatar goes offline, and an offline character may be awake. Every
transition records canonical simulation time separately from its wall-clock
evidence. Repeating the same state is idempotent and does not increment revision.

Starting sleep is stricter than changing presence. Schema v4 requires a bounded
sleep-place id and immutable access evidence. NPC agents may use verified physical
presence or a bed entitlement; human players require a non-expired bed entitlement.
The sleep context remains attached when the player logs out and is cleared only
by an explicit wake transition. A different bed or entitlement cannot replace an
active sleep session without waking first. Legacy pre-v4 sleeping rows remain
sleeping but have no invented access context and must wake before starting a new
verified session.

`playerTimeCapabilities()` is the fail-closed execution policy. Physical skills
require both `online` and `awake`. `worldClockAdvances` is always true, including
while every player is offline or sleeping. Offline delegation is persisted as
`disabled` in schema v1 of this state model; later delegation needs a versioned,
bounded policy and must not be inferred from logout. The current autonomy
supervisor therefore retries without planning when an explicitly sleeping state
denies physical execution.

The gateway records online state after accepting the bot session and offline
state only when the closing socket still owns that session. A stale superseded
socket cannot mark the replacement offline. The admin clock endpoint includes
the ordered player-state snapshot alongside clock and event data. Gateway startup
reconciles any persisted `online` state to `offline`, because no authenticated
session survives a process restart; it still preserves the independent rest state.

## Persistence and rollback

Simulation-clock store schema v3 adds `simulation_player_time_state`, keyed by
clock and normalized player identity. It stores presence/rest transition times,
the disabled delegation boundary, the last transition wall time and an optimistic
revision. The v2-to-v3 migration is additive and has a reopen test.

Rollback requires stopping gateway clock writers and copying the clock database
with its WAL/SHM sidecars. An older v2 application may leave the additive table
untouched; destructive removal is unsupported. If the database itself must be
restored, archive v3 first and restore a complete v2 backup. Presence is
reconciled from live authenticated sessions after restart. Rest is domain state
and must never be guessed from connectivity or silently rewritten during
rollback. Offline delegation remains disabled in either direction.

Schema v4 additively appends nullable sleep admission columns. It does not rewrite
existing presence/rest values. Rollback to v3 may leave these columns untouched;
after restoring an older full backup, active sleep admission evidence must be
re-established rather than inferred from connectivity.

## Verification

The simulation-clock tests prove that disconnect preserves explicit sleep,
waking does not imply login, offline/sleeping states keep the world clock moving,
and physical/offline-delegated execution remains denied. The autonomy supervisor
test proves that even a ready online session cannot run a sleeping avatar. Gateway
HTTP regression tests cover the existing connection lifecycle after durable
presence recording was added.
