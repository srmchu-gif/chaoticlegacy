# Vistoria de Jogabilidade - Paridade com Chaotic Recode (DOP/ZOTH/SS)

Gerado em: 2026-05-14T17:36:21.335Z

## Baseline local
- Testes locais: npm test (parser+library+battle-engine) PASS
- Fonte da matriz: `exports\effects_matrix_dop_zoth_ss.json`
- Cartas com habilidade auditadas: **418**
- Status: ok=320, divergente=34, pendente evid?ncia=64
- Evid?ncia capturada no Chaotic Recode: **0** (pendente coleta manual guiada)

## Achados priorizados
### Cr?tico
- Void Dirge (SS/mugic) -> target_resolution_incomplete. Impacto: alvo pode resolver errado em combate.

### Alto
- Drimesse (SS/creatures) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Geltod (ZOTH/creatures) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Jaal (ZOTH/creatures) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Najarin (DOP/creatures) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Ramarhvir, The Danian Hivebringer (ZOTH/creatures) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Ubliqun (DOP/creatures) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Acid Wash (ZOTH/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Ash Torrent (DOP/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Blaze Barrage (SS/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Desiccate the Land (ZOTH/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Hive Call (DOP/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Infight (ZOTH/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Malevolent Blast (ZOTH/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Scout's Strike (ZOTH/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Tornado Tackle (DOP/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Twister of Elements (SS/attacks) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Danian Carapace (ZOTH/battlegear) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Ice Cloak (ZOTH/battlegear) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Mipedian Cactus (DOP/battlegear) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Stone Mail (DOP/battlegear) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Talisman of the Mandiblor (DOP/battlegear) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Wind Whip (SS/battlegear) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Mipedim Lounge (SS/locations) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Mipedim Mirage (SS/locations) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Rao'Pa Sahkk, The Ocean with No Water (SS/locations) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Casters' Warsong (ZOTH/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Elemental Elegy (ZOTH/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Fighters' Fanfare (SS/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Hive Unsung (ZOTH/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Recurring Rescue (ZOTH/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Strain of Ash (SS/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Strain of the Tide (SS/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.
- Tune of Xerium (SS/mugic) -> multi_effect_incomplete. Impacto: multi-efeito potencialmente incompleto.

### M?dio
- 64 cartas implementadas sem evid?ncia manual no Recode (status: pendente evid?ncia).

## Recomenda??o de patch (ordem de impacto)
1. Corrigir `target_resolution_incomplete` (Void Dirge).
2. Corrigir 33 cartas `multi_effect_incomplete` (efeitos encadeados e condicionais).
3. Rodar rodada guiada no Recode por fam?lia e fechar status `pendente evid?ncia` -> `ok`/`divergente`.

## Arquivos gerados
- `exports\jogabilidade_paridade_recode_dop_zoth_ss_matrix.json` (matriz completa por carta)
- `exports\jogabilidade_paridade_recode_dop_zoth_ss_relatorio.md` (relat?rio priorizado)