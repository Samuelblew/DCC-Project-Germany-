# Bolha estilo Falcon BMS — estudo e estimativa

Estado: **planejado, não iniciado** (estudo feito em 2026-10-11).

## Por que

O culling atual decide uma única vez, na geração do `.miz`, o que entra na missão. Cada caso novo vira
mais uma faixa:

- rota;
- SAM de longo alcance;
- aeronaves;
- antiaérea;
- alvos de voos de IA.

O Falcon BMS resolve isso com uma bolha viva em torno do jogador. A ideia é aproveitar esse modelo no DCC.

## Como o BMS faz

Fontes:

- `Docs/00 BMS Manuals` (técnico, usuário e treinamento);
- `Data/Campaign/Falcon4.aii`;
- `Data/TerrData/Objects` (banco de objetivos);
- nomes de funções e opções no `Bin/x64/Falcon BMS.exe` e no `.pdb` do BMS 4.38.

Os nomes são reais. O comportamento descrito para eles é dedução a partir dos nomes, porque não há
documentação oficial detalhada da bolha.

### Agregado e desagregado

- **Agregado (2D):** um voo, um batalhão ou uma base é uma entidade só, com posição, força e munição
  como números. O combate é resolvido por estatística.
- **Desagregado (3D):** perto do jogador, a entidade vira veículos individuais simulados de verdade.
- A campanha nunca para. A bolha só decide quem passa de um estado para o outro e é recalculada
  continuamente durante o voo.

### Parâmetros (`Falcon4.aii`, seção `[Other]`)

| Parâmetro | Valor | Significado |
|---|---|---|
| `AirSearchDistance` | 60 | raio da bolha para aeronaves (nm) |
| `GroundSearchDistance` | 18 | raio para unidades terrestres (nm) |
| `ReaggregationRatio` | 120 | histerese: só reagrega a 120% da distância em que desagregou |
| `BubbleRebuildTime` | 3 | intervalo de recálculo (provavelmente segundos) |
| `PlayerBubbleObjects` | 12 | provável limite de objetos processados por ciclo |
| `SimBubbleSize` | 1000000 | tamanho máximo da simulação |

### Mecanismos encontrados no executável

- **Bolha por jogador:**
  - `DoAllSessionBubbles` e `DoSessionBubble` calculam uma bolha para cada humano; vale a união delas.
  - `PLAYER_BUBBLE_SLIDER` e `SetBubbleRatio` são um slider de usuário que escala a bolha
    (desempenho × alcance).
- **Regras por tipo:** `CheckAllUnitDeaggregationForSession`, `CheckObjectiveDeaggregationForSession`,
  `CheckAwacsDeaggregationForSession` e `CheckNavalDeaggregationForSession`.
- **Raio dinâmico por entidade:**
  - `g_fMaxDynamicBubbleRangeNm` e `UseMissileRangeFromDats` indicam um raio que depende do alcance da
    arma, com um teto global.
  - `ExtendBubble`, `IsBubbleExtended` e `ResetExtendBubble` estendem a bolha temporariamente, por
    exemplo para uma arma stand-off.
- **Desagregação forçada pela ação:** com `C_CHANGE_AI_DEAGG_FOR_GROUND_ATTACK`, uma IA que vai atacar
  um alvo em solo força a desagregação desse alvo. Fora da bolha, o ataque é resolvido por estatística.
- **Limpeza:** `MarkDeaggedCampaignEntitiesAsUninteresting` e `ReaggregateNonInterestingEntities`.
- **Casos especiais:**
  - `g_bAdjustAirbaseBubbleRanges`: alcance próprio para bases aéreas.
  - `g_fLivePilotsBubble`: raio para pilotos ejetados.
  - `DeaggregatePersistantObjects`: crateras e destroços que persistem.
  - `BuildingDeaggLevel` e `ObjDeaggLevel`: densidade de objetos.
- **Hora certa:** `FlightClass::GetDeaggregationPoint` coloca voos que ainda vão decolar no ponto de
  taxi, perto da hora de decolagem.
- **Proteções:** mensagens como `TRYING KILL A DEAGGED FLIGHT WITH A PLAYER IN IT` mostram que há
  proteção contra remover um voo envolvido com um jogador.
- **Distância por tipo de objetivo:** o banco de objetivos (OCD) tem um campo `DeaggDistance` por
  classe. Nos 1146 tipos ele está em 0, ou seja, todos usam o padrão global.

## Diferença para o DCS e para o DCC

O DCS carrega um `.miz` estático. O que o DCC deixa de fora na geração simplesmente não existe durante
o voo. No BMS, ao contrário, as entidades entram e saem do 3D o tempo todo.

## Plano em etapas

### Etapa 1: raio por entidade e dependências, ainda na geração

- **O que muda:** as três faixas fixas dão lugar a uma regra geral, em que cada coisa entra pelo seu
  próprio alcance, com um teto global:
  - SAM pelo alcance da arma;
  - EWR pelo alcance do radar;
  - CAP pela distância de engajamento;
  - base aérea pelo tráfego.
- **Sliders:** viram multiplicadores, como o `BubbleRatio`.
- **Dependências:** se um SAM entra, entram também o EWR e o centro de comando que o alimentam. Isso
  amplia o que já existe para os alvos de voos de IA.
- **Onde:** `packages/generate-miz/src/mission-culling.ts`, `add-germany-iads.ts` e
  `add-ground-groups.ts`, mais os sliders no MiG-29 Ops, no card de detalhes e no Mission Control.
- **Esforço:** 1 a 2 sessões. **Risco:** baixo, porque continua sendo um `.miz` normal.
- **Limitação:** a decisão ainda acontece antes do voo.

### Etapa 2a: bolha em tempo real para terrestres e SAMs (Lua)

- **Gerador:** escreve os grupos como dados numa tabela Lua, em vez de criá-los no `.miz`.
- **Script de bolha:** a cada poucos segundos, cria com `coalition.addGroup` os grupos que entram no raio
  e remove os que passam de 120% dele (histerese), guardando vida e posição.
- **`state.lua`:** precisa distinguir unidade removida pela bolha de unidade destruída. Hoje "sumiu"
  conta como perda; sem essa distinção, a campanha marcaria baixas falsas.
- **Skynet:** já tem `addSAMSite` para uso durante a missão, mas não tem remoção; o trecho de
  `onEvent`/`S_EVENT_BIRTH` existe apenas comentado em `skynet-iads.lua`. É preciso adicionar a remoção
  de sites.
- **Travadas:** para evitar pausas ao criar SAMs grandes, usar uma fila que cria poucos grupos por
  ciclo, como o `PlayerBubbleObjects`.
- **Esforço:** 4 a 6 sessões, mais missões de teste no DCS. **Risco:** médio.

### Etapa 2b: bolha em tempo real para aeronaves

- **Voos criados no ar:** precisam receber de novo a rota, a tarefa, o alvo e as opções de ROE do ponto
  em que estariam.
- **Voos que decolam de aeroporto:** desagregam no taxi perto da hora da decolagem, como o
  `GetDeaggregationPoint`.
- **Combate:** não remover um voo envolvido em combate com o jogador.
- **Revisar a interação com:** o culling, o EWR, o GCI, o modo carreira e o slider de Air activity.
- **Esforço:** 5 a 8 sessões, mais testes no DCS. **Risco:** alto.

## Resumo

| Etapa | Esforço | Risco | Ganho |
|---|---|---|---|
| 1. Raio por entidade + dependências | 1–2 sessões | baixo | culling mais preciso, menos sliders |
| 2a. Bolha em tempo real para terrestres/SAMs | 4–6 sessões + testes no DCS | médio | mapa inteiro "vivo" sem pesar |
| 2b. Bolha em tempo real para aeronaves | 5–8 sessões + testes no DCS | alto | muito mais tráfego aéreo sem custo |

O gargalo do calendário são os ciclos de teste no DCS (gerar missão, voar, ver o que quebrou), não a
escrita do código.

## Ponto de partida já existente: a imersão (2026-10-11)

O sistema de imersão já usa o modelo que a bolha vai precisar:

- **Prefixos:** todo grupo de ambiente se chama `DCC-AMB-*`, e todo comboio de suprimento se chama
  `DCC-CONVOY-<coalizão>-<rota>`. A bolha consegue reconhecer esses grupos e gerenciá-los sem afetar a
  sincronização da campanha.
- **Criação durante a missão:** `packages/generate-miz/src/scripts/immersion.lua` já cria estáticos e
  grupos com `coalition.addStaticObject` e `coalition.addGroup`, já libera grupos com ativação atrasada
  (`group:activate()`) e já remove grupos (`group:destroy()`).
- **Culling:** os comboios e o tráfego de ambiente passam pelo culling (`includesGroundPath` e
  `includesAircraftPath` em `mission-culling.ts`).
- **Perdas:** comboios destruídos já voltam para a campanha como interrupção de rota
  (`apps/frontend/src/logic/systems/convoy-losses.ts`).

## Estudo: AWACS, GCI e antenas (2026-10-13)

Estas três coisas não são unidades de combate. O produto delas é uma **imagem**, não um tiro. A bolha decide quem existe em 3D. A imagem tem de continuar a existir quando o emissor está agregado.

### O que cada uma é no DCC hoje

- **AWACS.** Há dois. O voo de campanha com tarefa AWACS entra no catálogo da bolha como avião de apoio, a 120 km, e some do `.miz`. O AWACS injetado (`AWACS-blue` / `AWACS-red` em `add-awacs-groups.ts`) é outro: nasce no ar, atrás da frente, em hipódromo, imortal e invisível, e **não** passa pelo culling. É um avião só por lado.
- **GCI.** A van KRU (`GCI_station_MiG29`) é o datalink do MiG-29, com alcance de 200 km. Sozinha ela não vê nada: no DCS ela liga, sozinha, radares de busca compatíveis que estejam a até 250 km (P-14, P-19, FPS-117, 55G6, 1L13, radares de busca de S-300, Buk e Patriot). Se a bolha tirou esses radares do `.miz`, a van não acha nenhum e o gerador planta três antenas só para ela, a 25 km: FPS-117 no lado NATO, 55G6 no outro, com nome `GCI-EWR-<canal>-1..3`. O script `ewr.lua` é outra peça: a fala para o jogador, e ela só lista aviões que já existem no DCS, até 160 km. Não usa essas antenas.

### Por que a bolha comum erra

Um caça a 80 km existe para lutar com você. A antena do GCI existe para alimentar a van. Se a bolha tira o radar de busca de um SAM porque você está longe, a van perde a antena que ia usar e o gerador cria três radares pesados no lugar, que ficam a missão inteira. Se a bolha também tira essas três, o datalink do Fulcrum fica mudo mesmo com a van presente.

O GCI de hoje repete o mesmo erro pelo outro lado: a mensagem só lista aviões desagregados. Com a bolha, o picture fica vazio assim que o inimigo está agregado, mesmo que a campanha saiba onde ele está.

O AWACS injetado é barato (um avião, sem combate). O AWACS de campanha tratado como voo comum é que está errado: a 120 km ele nasce e morre no script, perde o hipódromo, e o radar dele no DCS só detecta o que já está em 3D.

### Como aplicar

**AWACS.** O orbitador injetado fica no `.miz` a surtida inteira, um por lado, onde já está. Não entra no catálogo da bolha. O voo de campanha com tarefa AWACS segue a mesma regra: permanece na missão, não é despawnado. A imagem que ele “vê” de tráfego agregado não vem do radar 3D; vem da campanha (posição, altitude e tarefa do voo 2D) e é dita pelo GCI. O radar 3D fica só para o que já está na bolha.

**GCI e as antenas dele.** A van e pelo menos um radar compatível formam um conjunto e ficam no `.miz` a surtida inteira. Não se omite a van pelo raio de SAM. Não se deixa a bolha remover o único radar que a van enxergaria, senão o gerador substitui por três FPS-117 ou 55G6. Essas antenas de reserva, quando forem necessárias, acompanham a van: mesmo nome `GCI-EWR-…`, sem despawn. Um radar de SAM que também serve de antena para a van continua podendo entrar na bolha de chão se houver outra antena cobrindo aquela van; se ele for a única, fica. O picture falado continua com duas fontes: aviões que existem no DCS, e voos agregados que a campanha sabe que estão no alcance. O contato agregado é só a fala, sem criar o grupo.

### O que não fazer

- Não despawnar a van KRU nem a antena que a está alimentando.
- Não deixar a bolha esvaziar os radares compatíveis e aceitar as três antenas de reserva como se fossem de graça: cada uma varre o teatro.
- Não deixar o picture falado depender só de aviões vivos no DCS.
- Não tratar o radar de alerta do IADS como se fosse a antena do GCI. São sistemas diferentes.

## Recomendação

1. Fazer a etapa 1 primeiro.
2. Depois, a etapa 2a só para SAMs de longo alcance e EWRs. São estáticos e são onde o culling mais
   incomoda.
3. Fazer a etapa 2b apenas se o tráfego aéreo continuar insuficiente mesmo com o slider de Air activity.
4. Antes de qualquer etapa, fazer commit ou backup do estado atual do repositório.
