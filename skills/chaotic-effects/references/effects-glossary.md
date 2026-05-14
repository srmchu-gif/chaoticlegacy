# Effects Glossary

Human-readable mirror of `effects-registry.json`.

## Combat Runtime Contract
- Priority window: official.
- Simultaneous trigger enqueue order: `Location > Battlegear > Creature > Mugic`.
- Stack resolution: LIFO.
- Targeting: sequential; repeat target only blocked when text says `another target`.
- Requirements: validated at resolution.
- Costs: atomic (no partial payment).
- Negation: no cost refund.
- Unknown/unparsed kinds: no-op + technical log.

## DOP/ZOTH/SS Checklist (runtime audit)
- Parser coverage: in progress (tracked via matrix scripts).
- Target/cost/priority/context review: in progress.
- Card-by-card tracker: `references/dop-zoth-ss-checklist.md`.
- Per-card closure format:
  - `parser`: ok/gap
  - `target`: ok/gap
  - `cost`: ok/gap
  - `priority`: ok/gap
  - `runtime`: ok/gap
  - `tested`: ok/gap

## ACTIVATED_ABILITY
- Abilities with explicit cost (`MC`, `Expend`, `Discard`, `Sacrifice`).
- Triggered only by controller action in priority window.
- If text says `once per turn`, usage lock is per ability line and per turn.

## CHALLENGE_X
- Controller wins challenge only if own stat is at least `X` above opposing stat.
- If challenge is won, linked conditional effect resolves.

## DEFENDER
- During defender response window, eligible adjacent creature can intercept.
- Criteria variants (tribe/type/element) restrict legal intercept targets.

## ELEMENT_X
- Adds elemental attack damage of matching element.
- Stacks additively across active sources.

## ELEMENTPROOF_X
- Triggered when creature becomes engaged with creature of matching element type.
- Grants temporary Energy as defined by effect.

## HEAL_X
- Removes damage without exceeding current energy cap.
- Blocked by explicit heal-prevention effects.

## HIVE_STATE
- Hive acts as state machine (`off` -> `on` -> `off` on expiration/rule end).
- `Hive:` prefixed effects are active only while Hive is on.

## INFECT
- Applies infected status to legal targets only.
- Cannot stack duplicate infection unless first removed by effect.

## INVISIBILITY_FAMILY
- Includes Strike/Surprise/Disarm conditional behavior versus non-invisible opposing creature.
- Global/engaged anti-invisibility effects strip and block invisibility.
