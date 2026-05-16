# Battle Intent API (MVP competitivo)

Endpoint: `POST /api/multiplayer/rooms/:roomId/action`

## Input (novo contrato)

Envie `seatToken` e `intent`:

```json
{
  "seatToken": "....",
  "intent": "move|2|E"
}
```

Tambem suporta objeto:

```json
{
  "seatToken": "....",
  "intent": {
    "type": "priority",
    "selection": { "kind": "mugic", "mugicIndex": 1 }
  }
}
```

Comandos suportados no formato `|`:
- `move|<fromSlot>|<toLetter>`
- `ability|creature|<slot>` ou `ability|battlegear|<slot>`
- `mugic|<mugicIndex>`
- `strike|<attackIndex>`
- `target|<kind>|<id>|...`
- `choose|<choiceIndex>`
- `pass`

Compatibilidade: `payload.action` legado continua aceito.

## Output de evento unificado

No stream `GET /api/multiplayer/events/:roomId`, cada `room_snapshot` agora inclui tambem:
- `type: "game_state_update"`
- `battleStateView` com:
  - `phase`
  - `action`
  - `activePlayerIndex`
  - `combat`
  - `engaged`
  - `pendingAction`
  - `attacksAvailable`
  - `burstSize`
  - `burst`
  - `resolving`
  - `finished`
  - `winner`

## Telemetria

Cada acao aplicada registra `battle_action_intent` com:
- `intent`
- `action`
- `state_before`
- `state_after`
- `effects_resolved`
