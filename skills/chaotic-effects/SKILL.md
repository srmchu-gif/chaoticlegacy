---
name: chaotic-effects
description: Use this skill whenever card effects are discussed, defined, or implemented in combat. This skill is the canonical source for effect behavior and mapping to parser/engine.
---

# Chaotic Effects Skill

This skill defines the canonical workflow for combat effects in this project.

## When to use

Use this skill when:
- a user describes how an effect should work
- a card ability needs parser or engine implementation
- effect behavior must be reviewed for correctness

## Source of truth

Primary source:
- `references/effects-registry.json`

Human-readable mirror:
- `references/effects-glossary.md`

If there is a conflict, the registry JSON wins.

## Workflow (required)

For each new effect definition:
1. Validate the input against the required fields in the registry schema.
2. Add or update the effect object in `effects-registry.json`.
3. Update `effects-glossary.md` with a readable summary.
4. Set status using this progression:
   - `draft`
   - `reviewed`
   - `ready_to_implement`
5. If possible, map to current parser/engine kinds.
6. If mapping is incomplete, record explicit gap notes in `implementation_notes`.

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

## Parametrized effect model

Preferred model is one parametrized `kind` per family.  
Example: `elemento_x` with params:
- `element`
- `amount`
- `source_scope`
- `duration_mode`
- `target_mode`

## Implementation policy

- Do not modify gameplay code from this skill update alone.
- Keep this skill focused on effect specification and implementation guidance.
- Use the registry during later parser/engine coding as the contract.
