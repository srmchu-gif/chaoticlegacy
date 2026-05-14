---
name: chaotic-effects
description: Canonical workflow for auditing and implementing Chaotic card effects (DOP/ZOTH/SS first), including source baseline, parser/engine mapping, and acceptance gates.
---

# Chaotic Effects Skill

This skill defines the canonical workflow for combat effects in this project.

## When to use

Use this skill when:
- a user describes how an effect should work
- a card ability needs parser or engine implementation
- effect behavior must be reviewed for correctness

## Source of truth

Primary rules source order:
1. PDF glossary + card text
2. Fandom rules/rulings (`List_of_Abilities`)
3. Video explanation (support only)

Project contracts:
- `references/effects-registry.json` (machine contract)
- `references/effects-glossary.md` (human mirror)

If there is a conflict inside the project files, the registry JSON wins.

## Workflow (required)

1. **Freeze sources**  
Run source snapshot first:
- `npm run analyze:sources`
- `npm run analyze:matrix:dop-zoth-ss`

2. **Audit gaps by set/type**  
Classify each gap as:
- `sem_parse`
- `parser_only`
- `timing_incorrect`
- `target_incorrect`
- `resolution_incomplete`

3. **Implement in this order**
- timing/trigger
- target/scope
- stacking/duration/replacement

4. **Update registry and glossary**
- Add or update effect object in `effects-registry.json`.
- Mirror summary in `effects-glossary.md`.
- Set status:
   - `draft`
   - `reviewed`
   - `ready_to_implement`

5. **Ship gates**
- `npm test` green
- DOP/ZOTH/SS matrix with no `sem_parse`
- no unresolved parser kinds for in-scope cards
- explicit note for any deferred rule with reason

## Required effect fields

Each effect entry must include:
- `effect_name`
- `kind`
- `status`
- `timing`
- `target_rule`
- `condition_rule`
- `exact_rule`
- `stacking_rule`
- `duration_rule`
- `exceptions`
- `examples`

## Combat Runtime Contract (official)

This project follows one combat runtime contract for parser -> engine:

- Priority windows are official/strict.
- Simultaneous trigger enqueue order is fixed:
  1) `location`
  2) `battlegear`
  3) `creature`
  4) `mugic`
- Stack resolves in **LIFO**.
- Target selection is **sequential per effect step**.
- Repeat target is allowed unless the text requires `another target`.
- Requirements (`Power >= X`, required element, etc.) are validated at **resolution**.
- Activation costs are **atomic** (if full payment is not possible, do not queue on stack).
- Negation does not refund costs.
- Unknown/unparsed effect kind is a no-op with technical log (`noop_pending_kind`), card remains playable.
- Partial failure policy is **kind-specific** and must be documented in `runtime_contract.partial_failure_policy`.

Every parser output effect should carry `runtimeContract` metadata with these defaults.

## Parametrized effect model

Preferred model is one parametrized `kind` per family.  
Example: `elemento_x` with params:
- `element`
- `amount`
- `source_scope`
- `duration_mode`
- `target_mode`

## Implementation policy

- Keep parser/engine changes minimal and tied to audited gaps.
- Prefer adding tests before/with each behavior fix.
- Keep fallback safety: unknown effect never crashes combat flow.
- Keep DOP/ZOTH/SS checklist updated (`references/effects-glossary.md`).
