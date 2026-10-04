# Carreira com várias aeronaves — requisitos

Objetivo: abrir o modo Carreira, hoje feito só para o MiG-29 Fulcrum, para outras aeronaves. A
campanha começa com uma aeronave, e o jogador pode mudar de aeronave no meio da campanha comprando
e vendendo aviões.

## Decisões tomadas

| Tema                      | Decisão                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Aeronave inicial          | Uma por campanha; as outras chegam depois pela compra                                                                                            |
| Troca no meio da campanha | Comprar aviões do tipo novo, com prazo de entrega, e vender os antigos por valor residual. Sem conversão de tipo e sem desbloqueio por progresso |
| Estoque de armas          | Separado por tipo de aeronave                                                                                                                    |
| Regra de aquisição        | Escolhida na criação da campanha. **Fidelidade:** só aeronaves da coalizão do jogador. **Arcade:** qualquer aeronave, de qualquer lado           |

## Módulos instalados (`D:\DCS OF\DCS World\Mods\aircraft`)

- **Full fidelity:** MiG-29 Fulcrum (`MiG-29 Fulcrum`) e F-16C bl.50 (`F-16C_50`).
- **Flaming Cliffs:** A-10A, F-15C, MiG-29 (A/S), Su-25, Su-25T, Su-27, Su-33, F-5E FC, F-86F FC e
  MiG-15bis FC.
- **Gratuito:** TF-51D.

F-5E FC, F-86F FC e MiG-15bis FC não estão em `packages/contracts/src/dcs/aircraft-name.ts`. O
nome de tipo que o DCS usa para cada um precisa ser confirmado no módulo antes de entrarem.

## Onde o código está preso ao MiG-29 hoje

- `packages/contracts/src/campaign/schemas/career.ts`
  - `career.aircraftName` guarda um tipo só.
  - `inventory`, `presets` e `radio` não dizem a que tipo pertencem.
  - Cada avião do hangar (`careerAirframe.aircraftName`) já guarda o próprio tipo.
- `packages/contracts/src/schemas/radio-plan.ts` supõe um rádio de comunicação mais pares de ADF,
  o formato do R-862 com o ARK-19.
- `packages/data/src/career/`
  - `careerStart.inventory` só tem armas do MiG.
  - `careerRewards` é global e favorece abate aéreo (avião abatido 25, veículo destruído 3).
- `packages/generate-miz/src/add-flight-groups.ts`: `FLIGHT_RADIO_PRESET_INDEX` e
  `COCKPIT_CHANNEL_OFFSET` são tabelas soltas no gerador.
- `apps/frontend/src/logic/career/career.ts`
  - Todas as funções recebem um único `CareerAircraft`, vindo de `career.aircraftName`.
  - `releaseBareCareerSlots` compara voos com esse único tipo.
- `apps/frontend/src/stores/active.ts`: `getCareerFlightConstraints` e as proteções de slot usam
  `career.aircraftName`.
- Interface
  - `takeoff-button.tsx` monta o nome do botão com `replace(' Fulcrum', '')`.
  - `career-ops-dialog.tsx`, `career-dialog.tsx`, `career-preset-editor.tsx`,
    `career-radio-dialog.tsx` e `career-sidebar.tsx` resolvem a aeronave a partir de
    `career.aircraftName`.
- `apps/core/src/main/api/campaign/create-campaign.ts`
  - Usa `'MiG-29 Fulcrum'` como padrão.
  - Só acrescenta a aeronave às tarefas da facção na criação da campanha.

## Requisitos

### 1. Perfil de aeronave separado da economia

- **R1.1** Dividir `CareerAircraft` em duas partes:
  - **Perfil do módulo** (`AircraftProfile`): estações, armas com CLSID, estações aceitas e nomes de
    munição, rádios, auxílios de navegação, limite de waypoints, falhas leves, unidades do
    kneeboard, assentos, nível de fidelidade e papel.
  - **Entrada de carreira** (`CareerEntry`): preço novo e usado, revisão, reparo, prazo de entrega,
    estoque inicial e fator de valor de revenda.
- **R1.2** O perfil declara o nível de fidelidade, `full` ou `flamingCliffs`. Cada capacidade é
  opcional:
  - presets de rádio configuráveis;
  - ADF;
  - TACAN;
  - ILS;
  - falhas programáveis;
  - limite de waypoints.

  A interface e o gerador escondem ou ignoram o que o perfil não declara. Os Flaming Cliffs não têm
  painel de presets de rádio como o R-862; o que cada um suporta precisa ser conferido no módulo
  (ver R9.2).

- **R1.3** `FLIGHT_RADIO_PRESET_INDEX` e `COCKPIT_CHANNEL_OFFSET` migram para os perfis. As
  aeronaves sem perfil continuam com o comportamento atual.
- **R1.4** O perfil também vale no modo Clássico para os presets de rádio, o limite de waypoints e
  a validação de loadout.
- **R1.5** O perfil declara o papel principal: `airSuperiority`, `multirole`, `attack` ou
  `helicopter`. Os requisitos R5 usam esse campo.

### 2. Estado da carreira com várias aeronaves

- **R2.1** Remover `career.aircraftName`.
  - A frota é a lista `airframes`, em que cada avião já tem o seu tipo.
  - Não há habilitação de tipo: o jogador voa qualquer tipo de que tenha um avião pronto.
- **R2.2** Guardar `career.preferredAircraft`, o tipo que a interface abre por padrão. Ele é
  atualizado quando o jogador escolhe um avião de outro tipo.
- **R2.3** Presets ganham o campo `aircraftName`. O editor e a lista de loadouts só mostram os do
  tipo em contexto.
- **R2.4** Rádio por tipo, em `career.radios[aircraftName]`. Quando falta, usa o padrão do perfil.
- **R2.5** Pilotos de ala continuam genéricos e voam qualquer tipo. No DCS um grupo de voo é de um
  tipo só, então cada ala precisa de um avião do mesmo tipo que o do jogador naquela surtida.
- **R2.6** O avião gratuito, dado depois de 24 horas sem dinheiro e sem avião, é do tipo do último
  avião que o jogador perdeu. Se esse tipo não estiver mais disponível para a coalizão, vem o tipo
  mais barato disponível.
- **R2.7** Migração automática dos saves atuais:
  - `aircraftName` vira `preferredAircraft`;
  - `inventory` passa para `inventory['MiG-29 Fulcrum']`;
  - `radio` passa para `radios['MiG-29 Fulcrum']`;
  - os presets recebem `aircraftName: 'MiG-29 Fulcrum'`.

  Nenhum dado do jogador pode se perder, e a migração precisa de teste com um save real.

### 3. Estoque de armas por tipo

- **R3.1** `inventory` passa a ser `Record<aircraftName, Record<CLSID, quantidade>>`.
- **R3.2** O arsenal, a montagem da surtida e o cálculo do que falta só olham o estoque do tipo da
  surtida.
- **R3.3** O reembolso de munição não usada volta para o estoque do tipo que voou, usando os nomes
  de munição do perfil desse tipo.
- **R3.4** Venda de armas de um tipo por uma fração do preço, para quem abandona aquele tipo.

### 4. Rádio e navegação genéricos

- **R4.1** O plano de rádio vira uma lista de rádios por perfil. Cada rádio declara:
  - nome;
  - tipo: UHF, VHF ou combinado;
  - número de canais;
  - número do primeiro canal no cockpit;
  - faixas de frequência;
  - o índice `Radio[n]` em que o DCS grava os presets.

  O F-16C, por exemplo, tem UHF e VHF com 20 canais cada.

- **R4.2** Os auxílios de navegação vêm do perfil (NDB/ADF, TACAN, ILS, RSBN/PRMG). A interface só
  oferece o que o avião tem.
- **R4.3** O kneeboard segue o perfil:
  - unidades métricas ou imperiais;
  - só os auxílios de navegação que o avião tem (o TACAN deixa de aparecer para o MiG-29);
  - numeração de canal do cockpit.
- **R4.4** O diálogo de rádio é montado a partir do perfil, sem regras de um avião específico no
  componente.
- **R4.5** O plano antigo do MiG-29 é convertido para o formato novo sem perda (faz parte da R2.7).

### 5. Missões e economia por papel

- **R5.1** As missões oferecidas para um avião saem dos loadouts do perfil, como hoje. A tela de
  operações mostra o papel do tipo.
- **R5.2** As recompensas usam um multiplicador por papel. Um avião de ataque ganha de verdade com
  CAS e strike; um caça de superioridade continua ganhando principalmente com abates.
- **R5.3** O bônus de tarefa cumprida depende do tipo de missão: um SEAD que destrói o alvo não
  vale o mesmo que uma CAP sem contato.
- **R5.4** Os valores ficam em tabelas de dados e são cobertos por testes, como `careerRewards`
  hoje.

### 6. Criação da campanha

- **R6.1** A lista de aeronaves da carreira vem dos perfis com entrada de carreira e respeita a
  regra de aquisição (R6.5). Na regra Fidelidade, o F-16C só aparece em campanhas do lado azul.
- **R6.2** A era vira aviso, não bloqueio, nas duas regras. Exemplo: o MiG-29 só entrou em serviço
  na Alemanha Oriental em 1988.
- **R6.3** Escolha de uma aeronave inicial. Remover o padrão fixo `'MiG-29 Fulcrum'`.
- **R6.4** A base inicial precisa ser compatível com o tipo. Aeronaves de porta-aviões ficam fora
  até haver suporte.
- **R6.5** **Regra de aquisição** na criação da campanha, ao lado da escolha Clássico/Carreira:
  - **Fidelidade:** a aeronave inicial e as compras ficam limitadas às aeronaves da coalizão do
    jogador no cenário (as que estão na facção dele);
  - **Arcade:** a aeronave inicial e as compras podem ser de qualquer tipo com entrada de carreira,
    independente do lado. Exemplo: um F-16C na campanha do Fulda pelo lado vermelho;
  - fica salva na carreira (`career.acquisitionRule: 'fidelity' | 'arcade'`) e não muda depois da
    criação;
  - aparece no Hangar e na barra lateral, para o jogador lembrar qual regra está valendo;
  - saves antigos migram como `fidelity`, que é o comportamento de hoje.
- **R6.6** No Arcade, uma aeronave que não pertence à facção do jogador:
  - entra na missão do DCS na coalizão do jogador, com o país do jogador e a pintura padrão do
    tipo, porque o DCS aceita qualquer tipo em qualquer país;
  - não entra nas tarefas da facção, então a IA da coalizão não passa a voar esse tipo (ver R7.4).
    O jogador voa esse tipo nas missões que ele mesmo planeja em "My missions";
  - se o inimigo também usa esse tipo (por exemplo MiG-29 contra MiG-29), a tela de compra mostra
    um aviso de que a identificação visual fica mais difícil. Não bloqueia a compra.

### 7. Troca de aeronave: compra e venda

- **R7.1** **Catálogo de compra:** os tipos com entrada de carreira permitidos pela regra de
  aquisição (R6.5), com preço novo e usado. Na Fidelidade, só os da coalizão; no Arcade, todos. Avião usado mantém as falhas ocultas não críticas, quando o
  perfil tiver falhas programáveis.
- **R7.2** **Entrega:**
  - o avião comprado chega numa base amiga de retaguarda depois de um prazo em horas de campanha,
    definido pelo tipo;
  - enquanto está a caminho, ele aparece no hangar como "Em entrega";
  - quando chega, vale a regra de permanência de base: para usar o avião em outra base, é preciso
    voar até lá.
- **R7.3** **Venda:**
  - o valor residual depende do estado (novo ou usado), da integridade e do fator de revenda do
    tipo;
  - só aviões prontos e na base podem ser vendidos;
  - a venda entra no extrato.
- **R7.4** **Planejamento da IA:** quando o jogador recebe o primeiro avião de um tipo que pertence
  à facção dele, esse tipo entra nas tarefas da facção, se ainda não estiver lá. Isso estende
  `addCareerAircraftToTasks` para o meio da campanha. Tipos de fora da facção, só possíveis no
  Arcade, não entram (R6.6).
- **R7.5** **Missões entre tipos:** surtidas, missões próprias e o bloqueio de slots fora da surtida
  passam a valer para qualquer tipo que o jogador tenha, não só para um.

### 8. Interface

- **R8.1** "MiG-29 Ops" vira "Ops".
  - A coluna de aviões mostra a frota mista, com o tipo ao lado do número de cauda.
  - O contexto de tipo (loadouts, presets, rádio, estoque) acompanha o avião selecionado.
- **R8.2** O Hangar ganha:
  - filtro por tipo;
  - a aba **Comprar**, com o catálogo da R7.1 e o prazo de entrega;
  - a ação **Vender**.
- **R8.3** O Arsenal mostra e compra armas do tipo selecionado.
- **R8.4** A barra lateral e o marcador amarelo do mapa mostram o tipo junto do número de cauda, e
  aviões em entrega aparecem como tal.

### 9. Qualidade e expansão

- **R9.1** Um teste genérico roda para todos os perfis e verifica que:
  - os loadouts respeitam as regras de estação;
  - o rádio padrão cabe nas faixas de cada rádio;
  - o número de waypoints respeita o limite;
  - os CLSIDs, as falhas e os rádios existem no módulo instalado. As definições em
    `packages/data/src/aircrafts` só têm os loadouts da IA, então a referência é o snapshot que o
    script da R9.2 grava a partir do DCS.
- **R9.2** Um script, no estilo de `packages/data/scripts/extract-terrain-radio.ts`, lê o módulo
  instalado e confere CLSIDs, estações, IDs de falha e rádios de um perfil. Ele também diz o que um
  módulo Flaming Cliffs suporta.
- **R9.3** Um passo a passo de "como adicionar uma aeronave", separando o que é obrigatório do que é
  opcional.

## Fora do escopo agora, sem fechar a porta

- Aeronaves de dois lugares e tripulante de IA, como Jester e WSO: o perfil já declara assentos.
- Helicópteros, com missões e bases próprias.
- Porta-aviões.
- GCI além do KRU do MiG-29A: a missão coloca uma rede amiga nas bases do jogador (WAVE 1–10)
  e uma rede inimiga nas bases da coalizão oposta (WAVE 11–20), o comando Activate GCI e radares
  compatíveis da IADS. Jogando vermelho, a OTAN fica com o GCI inimigo; jogando azul, o Pacto.
  O culling só carrega as estações no corredor da missão. O HUD do Fulcrum usa o enlace amigo;
  o F10 BRAA fica para os outros aviões. O mapa da campanha mostra as duas redes e o painel
  Layers pode escondê-las.

## Fases

1. **Base sem mudança de comportamento:** perfil, estado multi-tipo, campo da regra de aquisição e
   migração do save (R1, R2, R3.1, R4.5 e o campo da R6.5). A carreira de MiG-29 atual continua
   funcionando igual, como Fidelidade. **Feita.**
2. **Rádio, navegação e kneeboard genéricos** (R4, mais R1.3 e a parte de rádio da R1.4).
   **Feita:**
   - o plano guarda uma lista de canais por rádio de comunicação; planos antigos migram ao carregar;
   - o perfil declara cada rádio (banda, canais, primeiro canal do cockpit, `Radio[n]` da missão),
     o ADF, os auxílios de navegação e as unidades;
   - o gerador usa o perfil e não cria beacon TACAN para avião sem TACAN; no modo Clássico, o
     jogador recebe o plano padrão do perfil;
   - o kneeboard usa as unidades do perfil e a numeração de canal do cockpit, e troca o TACAN por
     NDB e torre da base quando o avião não tem TACAN.
3. **Segunda aeronave**, para provar a estrutura:
   - um Flaming Cliffs do lado vermelho, que dá para comprar na campanha do Fulda (Su-25T, Su-27 ou
     MiG-29S). **Su-27 feito:** perfil e carreira a partir dos payloads do editor de missões
     (`UnitPayloads/Su-27.lua`) e das missões do módulo; sem presets de rádio (o módulo não tem
     painel) e sem falhas programáveis até a lista de falhas dos Flaming Cliffs ser mapeada. Os
     outros Flaming Cliffs entram um a um no mesmo formato.
     **Su-25 feito:** é o avião de ataque da facção soviética de 1984, então a regra Fidelidade já
     o vende no Fulda pelo lado vermelho. São seis loadouts: CAS com casulos S-8 e RBK-250, CAS
     com FAB-250 e S-13, RBK-500AO, Kh-29L com Kh-25ML, FAB-500 e BetAB-500ShP. Ficaram de fora o
     casulo de canhão SPPU-22 e as racks de FAB-100, porque o número de tiros que o
     `Unit.getAmmo` informa para eles não foi confirmado. Nesse caso a carga inteira contaria
     como gasta.
     **Os outros Flaming Cliffs feitos:**
     - MiG-29S: superioridade aérea com R-77, facção russa de 1996;
     - Su-25T: ataque com Kh-58U e Kh-25MPU (SEAD), Kh-29L/T, Vikhr-M e os casulos
       Fantasmagoria e Mercury, facção russa de 1996;
     - Su-33: superioridade aérea, sem facção, só no Arcade. Opera de base terrestre, porque a
       carreira ainda não trata porta-aviões;
     - F-15C: AIM-120B/C, AIM-7M e AIM-9M, unidades imperiais, TACAN e ILS. Sem facção, só no
       Arcade;
     - A-10A: Mavericks, Mk-82/84, Rockeye, CBU-87/97 e foguetes, unidades imperiais, TACAN e
       ILS, facção americana de 1977. É o único Flaming Cliffs com falhas programáveis
       (piloto automático, alerta de míssil e ECM), então o usado dele pode vir com defeito.
       As estações vêm da tabela de pilones da própria definição do módulo, e não dos
       payloads.

     **F-5E FC, F-86F FC e MiG-15bis FC feitos:** tipos `F-5E-3_FC`, `F-86F_FC` e
       `MiG-15bis_FC`. Representam `F-5E-3`, `F-86F Sabre` e `MiG-15bis` das facções. Sem
       presets de rádio e sem falhas mapeadas. Foguetes e racks múltiplas ficaram de fora
       até o `Unit.getAmmo` ser confirmado.

   - depois o F-16C, para provar um segundo full fidelity com UHF e VHF, TACAN, ILS e unidades
     imperiais numa campanha azul. **F-16C feito:** perfil `F-16C_50`, papel multirole, facções
     americana de 2004 e francesa de 1982. Dois rádios com preset (UHF AN/ARC-164 e VHF
     AN/ARC-222, 20 canais cada), TACAN e ILS, unidades imperiais. O plano padrão põe o voo, o
     AWACS, a torre UHF e o JTAC no COMM 1 e a torre VHF no COMM 2. Loadouts de CAP com
     AIM-120C, varredura, SEAD com AGM-88C e HTS, CAS com Maverick e GBU-12, TER de Mk-82,
     GBU-10 e GBU-31. Falhas leves de RWR, rádio-altímetro, antenas UHF, dispenser, IDM, MIDS
     e relógio; o usado pode vir com 1 a 3 defeitos. No Fulda pela facção americana de 1977 ele
     só aparece no Arcade, porque essa facção não voa F-16.

4. **Compra, venda e entrega** (R7), **seletor Fidelidade/Arcade na criação** (R6.5 e R6.6) e
   **economia por papel** (R5). **Feita:**
   - a criação tem o seletor Fidelidade/Arcade ao lado de Clássico/Carreira. A lista de aviões
     segue a regra e a facção escolhida, e avisa quando o inimigo voa o mesmo tipo. O core recusa
     um avião fora da regra;
   - o perfil declara `factionTypes`, os tipos de facção que o módulo representa (o MiG-29 do
     jogador é o `MiG-29A` das facções);
   - o Hangar mostra a regra, o catálogo de compra com papel e prazo, e a ação Vender com o valor
     residual. A barra lateral mostra a regra e os aviões em entrega;
   - a compra é paga na hora e o avião chega à base amiga mais longe do inimigo depois de
     `deliveryHours`. Se essa base cair antes, ele vai para a retaguarda que sobrou;
   - na chegada, um tipo da facção entra nas tarefas da IA; um tipo de fora (Arcade) não entra;
   - a venda vale preço novo, ou o topo do usado, × `resaleFactor` × integridade. Só avião pronto
     na base pode ser vendido;
   - abates usam `careerRoleMultipliers` e o bônus de tarefa sai de `careerTaskRewards`, pela
     tarefa gravada na surtida.
5. **Ajustes de interface e ferramentas de expansão** (R8 e R9). **Feita:**
   - o botão do topo virou "Ops". A tela de Ops mostra o papel do tipo selecionado e o tipo ao
     lado de cada número de cauda;
   - o Hangar ganhou a aba Comprar, o filtro por tipo e a regra no título. O Arsenal troca de tipo
     entre os que você tem;
   - o marcador amarelo do mapa mostra tipo, cauda e "(delivery)";
   - `packages/data/scripts/verify-aircraft-profile.ts` lê o DCS instalado. Na definição Lua,
     confere CLSIDs, `panelRadio` e `Failures`; nos scripts do cockpit, `Failure_name`. Nos
     payloads do editor e nas missões do módulo, vê em que estação cada arma aparece (os CLSIDs
     antigos são traduzidos pela tabela de substituição do módulo). Com `--write`, grava
     `module-snapshots.ts`. Com `--inspect`, lista o que um módulo ainda sem perfil oferece: cada
     CLSID, as estações e os payloads do editor que o levam. Quando a definição lista os
     lançadores de cada `pylon(n, …)`, como a do A-10A, as estações vêm dali;
   - o teste genérico `packages/generate-miz/src/aircraft-profiles.test.ts` confere todos os
     perfis contra esse snapshot sem precisar do DCS. O limite de waypoints é testado na carreira;
   - o script achou e corrigiu a FAB-250 do Su-27 liberada nas estações 4 e 7, onde o DCS nunca
     a mostra. O loadout `cas-s8` passou a levar FAB-500 nelas;
   - o passo a passo está em `docs/adding-an-aircraft.md`.

## Critérios de aceite

- Um save de carreira do MiG-29 de antes da mudança abre sem perda de dinheiro, aviões, estoque,
  presets ou rádio.
- Na campanha do Fulda pelo lado vermelho, o jogador consegue:
  - comprar um avião de outro tipo;
  - recebê-lo depois do prazo;
  - voar uma surtida com ele e um ala do mesmo tipo;
  - receber a recompensa conforme o papel;
  - vender um MiG.
- Numa campanha Fidelidade pelo lado vermelho, o F-16C não aparece para compra. Numa campanha
  Arcade com o mesmo cenário, ele aparece, pode ser comprado e voado numa missão própria, e a IA
  vermelha continua sem voar F-16C.
- O gerador grava presets de rádio e falhas só quando o perfil declara suporte.
- Os testes genéricos de perfil passam para todos os tipos cadastrados.

## Em aberto

- No Arcade, se a IA da coalizão deve poder voar os tipos de fora da facção que o jogador comprou.
  Hoje o documento diz que não (R6.6).
- Os valores de prazo de entrega e de fator de revenda de cada tipo. Hoje: F-86F FC e
  MiG-15bis FC 36 h; MiG-29, MiG-29S, Su-25 e F-5E FC 48 h; Su-25T, A-10A e F-16C 60 h;
  Su-27, Su-33 e F-15C 72 h. Todos com revenda de 60%.
- Mapear as falhas dos Flaming Cliffs além do A-10A. As definições deles estão nos binários.
