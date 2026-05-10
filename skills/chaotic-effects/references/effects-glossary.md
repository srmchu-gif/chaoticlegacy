# Effects Glossary

This file mirrors `effects-registry.json` in human-readable form.

## ELEMENTO_X

- **Kind**: `elemento_x`
- **Status**: `reviewed`
- **What it does**: adds `+5` damage for a configured element (`fire|air|earth|water`) when the target executes an attack that has that same element.

### Timing
- Creature source: always active while creature is active in battle.
- Battlegear source: active only while gear is face-up.
- Mugic source: active until end of turn.
- Location source: active while location is active.

### Targeting
- Creature source -> self.
- Battlegear source -> equipped creature.
- Mugic source -> targeted creature.
- Location source -> target defined by location text.

### Stacking
- Stacks additively across active sources.

### Notes for implementation
- Prefer mapping to existing `elementModifier` where possible.
- Keep location-target resolution explicit when source is location-based.
