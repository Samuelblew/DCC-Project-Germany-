# Ideias do Falcon BMS para a campanha do DCC

Estado: **feito** (estudo de 2026-10-16). Todos os itens feitos em primeira versão; os pendentes de cada um estão anotados.

## Fontes

- Manual do usuário do BMS 4.38, capítulo 9.4 (Campaign): Priorities, Creating a Package, Commanding
  a Squadron, Intel; capítulo 9.7 (Logbook); seção 9.4.6 (objetivos e condições de vitória).
- `Data/Campaign/Falcon4.aii`.
- O que já foi portado está em `docs/bms-campaign-features.md`: CAS de alerta, alerta no solo, mudança
  de base, órbita de interferência, turnaround, cobertura de resgate, emboscada baixa, corte de
  estrada, relógio de reposição e as fases da doutrina (ar, terra, estratégico). Esses itens ficam de
  fora daqui.
- Continuam fora também tanque de reabastecimento, JSTARS e FAC, porque as facções não têm esses
  aviões configurados.

## Lista, em ordem de valor

### 1. Esquadrões com inventário real

**Feito (2026-10-16):** `apps/frontend/src/logic/systems/air-order-of-battle.ts`.

- **Estoque:** cada lado tem um estoque por tipo de aeronave (`coalitions.*.airframes`): 24 por tipo
  de caça ou ataque, 12 por tipo de helicóptero e 4 por tipo de AWACS ou reabastecimento.
  Campanhas existentes e tipos novos (troca de era) começam cheios.
- **Disponibilidade:** quem está voando conta como em uso. O ATO, o CSAR, o resgate e o antinavio só
  montam voo se houver aviões no solo para o tamanho do voo.
- **Perdas:** abates na simulação (CAP, SEAD, DEAD) e no DCS (debriefing) tiram do estoque. Aviões de
  carreira ficam fora, porque têm o hangar próprio.
- **Reposição:** 15% da capacidade por dia de campanha, até o tamanho do esquadrão.
- **Interface:** o painel Logistics mostra "Air order of battle", com prontos/total e perdas por tipo
  do seu lado e o total que resta ao inimigo.
- **Ainda não feito:** inventário por base; destruir aviões no solo com ataques a aeródromos (OCA).

- **No BMS:**
  - cada base tem esquadrões com número de aviões e pilotos;
  - avião abatido sai do esquadrão;
  - a reposição é lenta (`ReinforcementTime`);
  - esquadrão sem avião não decola;
  - a tela de ordem de batalha mostra o que resta.
- **No DCC:** a força aérea da IA é infinita fora do modo carreira. Cada voo gasta combustível e munição
  da base, mas avião abatido não desfalca nada.
- **Por que importa:** para quem voa caça é a maior mudança. Abates passam a ter efeito estratégico, e
  a superioridade aérea vira algo que se conquista.
- **Ligações:** ATO (`ato-planner.ts`, que só planeja com aviões disponíveis), debriefing
  (`mission-state-update.ts`, perdas), tick (perdas simuladas em `cap-flight-group.ts`), reposição por
  base, e o mapa ou o card da base mostrando o inventário.
- **Esforço:** 3 a 4 sessões.

### 2. Avaliação da missão alimentando a campanha, e vitória com prazo

**Feito (2026-10-16):** `apps/frontend/src/logic/systems/morale.ts`.

- **Nota:** cada voo do jogador recebe de 1 (Poor) a 5 (Excellent). Ela sobe com a tarefa cumprida
  (abate nas missões ar-ar, alvo destruído nas demais) e quando todos voltam, e desce para cada avião
  perdido.
- **Moral:** a nota move a moral dos dois lados (0 a 100, 50 é neutro). Captura de cidade vale +2 para
  quem toma e -2 para quem perde. A moral volta para 50 a 2 pontos por hora (`InitiativeLeakPerHour`).
- **Efeito:** multiplica o poder de combate em terra de 0,85× a 1,15×.
- **Prazo:** o cenário define `durationDays` (Fulda: 30). Passado o prazo sem objetivo atingido, a
  campanha termina em impasse (`status: 'stalemate'`). Campanhas em escalation não têm prazo.
- **Interface:**
  - o debriefing mostra a nota de cada voo e a moral resultante;
  - a barra superior mostra "Morale nós / eles" e os dias restantes (D-N).

- **No BMS:**
  - missão bem-sucedida e voo que volta inteiro aumentam a moral e a iniciativa do lado, e a IA passa a
    render mais;
  - missão ruim faz o contrário;
  - as campanhas têm prazo e empate. Na Tiger Spirit a vitória precisa vir em 5 dias; senão é impasse.
- **No DCC:** a iniciativa (`update-operation-profile.ts`) depende só de quantas cidades cada lado tem,
  e não existe prazo.
- **Esforço:** 1 a 2 sessões. É o item mais barato com efeito visível.

### 3. Prioridades do comandante

**Feito (2026-10-16):** `apps/frontend/src/logic/systems/commander-priorities.ts` e a tela
`routes/campaign/home/priorities-dialog.tsx` (botão de mira na barra superior).

- **Controles:** de 0 (Never) a 5 (Maximum), com 3 (Normal) como neutro.
  - Missões: contra-ar ofensivo, supressão de SAM (SEAD/DEAD e interferência), interdição/CAS,
    estratégico, antinavio e contra-ar defensivo (CAP, interceptação e varredura).
  - Alvos: defesa aérea, aeródromos, comando, forças em terra, logística (depósitos, combustível,
    estradas, FARP) e indústria (fábricas, usinas, petróleo).
- **"Set by HQ":** ligado por padrão. Enquanto estiver ligado, o planejador decide sozinho.
- **Efeito no ATO:** cada nível acima ou abaixo do normal soma ou tira 12 pontos na nota do pacote
  pela missão e 8 pelo alvo. "Never" tira o pacote da lista e o registra como rejeitado por
  `commander priority`. No antinavio, o nível muda em um o número de pacotes ativos, e "Never" zera.
- **Escopo:** só o seu lado. AWACS, transporte e mudança de base continuam a critério do QG.
- **Ainda não feito:** prioridade por região do mapa.

- **No BMS:** uma tela com controles por:
  - tipo de alvo (radares, SAMs, aeródromos, pontes, fábricas);
  - tipo de missão (contra-ar ofensivo, supressão de SAM, interdição/CAS, estratégico, antinavio, CAP,
    reconhecimento);
  - região do mapa.

  Esses controles orientam o planejador, e há uma opção "definido pelo QG".
- **No DCC:** o ATO já tem pesos internos de prioridade, mas o jogador não tem acesso a eles.
- **Esforço:** cerca de 2 sessões.

### 4. Névoa de guerra e reconhecimento

**Feito, primeira versão (2026-10-16):** `apps/frontend/src/logic/systems/intel.ts`.

- **Inteligência por lado:** cada lado guarda o que viu do inimigo (`coalitions.*.intel`): posição, hora
  e sensor. A cada tick de lógica, os sensores de cada lado procuram unidades inimigas que se movem.
  - Tropas em terra: 8 km.
  - Guarnição de cidade ou aeródromo: 5 km.
  - Radar de aeródromo: 60 km para aviões.
  - EWR, GCI e sites de defesa aérea da Alemanha: 200 km para aviões.
  - SAM: o próprio alcance, para aviões.
  - AWACS: 350 km para aviões.
  - Aviões em voo: 40 km para aviões, 10 km para o chão (20 km em CAS, FAC, ataque ao solo e
    antinavio) e 60 km para navios.
  - Navios: 120 km para aviões e 60 km para navios.
- **Memória:** tropa, navio e comboio avistados ficam na última posição conhecida e somem depois de
  12 h sem nova visada. Avião é trilha de radar e só existe enquanto alguém o vê.
- **Mapa:** unidades inimigas que se movem (tropas, navios, comboios, aviões) só aparecem depois de
  avistadas, na posição em que foram vistas. Visada com mais de 15 min fica esmaecida e com a idade
  ("seen 2 h ago"). Comboio inimigo não mostra o destino; avião inimigo não mostra a rota.
  Estruturas, cidades, aeródromos, SAMs e radares fixos continuam visíveis (inteligência pré-guerra).
- **Planejamento (os dois lados):** CAS, BAI, corte de estrada e antinavio só atacam o que foi visto
  nas últimas 3 h. A interceptação só decola contra uma incursão que já está no radar. O reconhecimento
  armado continua indo atrás de unidades não vistas, e o voo revela o que encontra. Voos manuais de CAS
  só listam alvos vistos.
- **Desligar:** "Reveal enemy" no menu de cheats (`campaignParams.fogOfWar = false`).
- **Ainda não feito:** confirmação de dano (BDA), já que unidade destruída some do mapa na hora;
  contatos vindos do DCS (o que o jogador viu ou atacou na missão); missão de reconhecimento dedicada;
  esconder a composição exata da unidade avistada.

- **No BMS:**
  - tropas inimigas ficam invisíveis no mapa até serem avistadas pelas próprias tropas, pelos pilotos
    ou por missões de reconhecimento;
  - a informação envelhece;
  - o dano de um ataque só é confirmado depois de alguém olhar (BDA).
- **No DCC:** o inimigo aparece inteiro, o tempo todo, inclusive posição exata de colunas e SAMs.
- **Por que importa:** muda o planejamento por completo. Radares, AWACS, o GCI do MiG e o
  reconhecimento armado que já existe no ATO passariam a valer como inteligência.
- **Esforço:** 3 a 5 sessões. Mexe no mapa e no ATO; melhor depois que a base estiver estável.

### 5. Tela de inteligência

**Feito (2026-10-16):** `routes/campaign/home/intel-dialog.tsx` (botão de gráfico na barra superior) e
`apps/frontend/src/logic/systems/force-history.ts`.

- **Postura:** arquétipo e ritmo de cada lado, moral e quem tem a iniciativa.
- **Nível de força:** tropas em campo, aviões, território (cidades e aeródromos) e sites de SAM, com
  gráfico dos dois lados ao longo da guerra e a variação das últimas 24 h. A campanha grava uma amostra a
  cada 6 h (`forceHistory`, até 60 dias). Com a névoa ligada, os números do inimigo são estimativas
  arredondadas.
- **Esquadrões:** a ordem de batalha aérea e as últimas notas de missão.
- **Notícias:** capturas, comboios, resgates, escalada e outros eventos da campanha, mais recentes
  primeiro.
- **Ainda não feito:** o "replay JSTARS" da frente se movendo.

- **No BMS:** postura de cada lado, gráficos de nível de força ao longo do tempo, "replay JSTARS"
  mostrando a frente se movendo, estatísticas do esquadrão e notícias rodando.
- **No DCC:** só existe o log de eventos.
- **Esforço:** 2 a 3 sessões.

### 6. Diário de bordo e carreira de piloto

**Feito (2026-10-16):** `apps/frontend/src/logic/systems/logbook.ts`, aba "Logbook" na tela de
inteligência e quadro "Logbook" no debriefing.

- **Escopo:** um diário por campanha (`campaign.logbook`), para o avião do jogador (a unidade `client`),
  nos modos clássico e carreira.
- **Pontos:**
  - abates feitos pela sua unidade: avião 10, helicóptero 6, navio 15, veículo 2, estrutura ou estático 3;
  - abate de aliado: -25;
  - a nota da missão vale de -5 (Poor) a +15 (Excellent);
  - ejeção: -10; morte: -50.
- **Patentes:** Ten. 0, 1º Ten. 150, Cap. 300, Maj. 800, Ten.-Cel. 1600 e Cel. 3000, com os nomes da força
  aérea do seu lado.
- **Medalhas:** nomes ocidentais ou soviéticos conforme o lado.
  - Nota Excellent: Air Medal / medalha "Por Mérito em Combate".
  - Três abates aéreos numa surtida: DFC / Ordem da Estrela Vermelha.
  - Ás, com 5 abates: Silver Star / Ordem da Bandeira Vermelha.
  - Abatido e sobreviveu: Purple Heart / medalha "Pela Coragem".
  - 25 surtidas: Longevity / medalha "Por Mérito em Batalha".
  - Campanha vencida: Air Force Cross / Ordem de Lenin.
- **Registro:** as últimas 100 surtidas, com data, voo, avião, nota, abates por tipo, desfecho e pontos.
- **Ainda não feito:** diário que atravesse campanhas; a exigência de campanha vencida para Major, que
  o BMS tem.

- **No BMS:**
  - pontos por missão;
  - patentes (Ten. 150 pontos, Cap. 300, Maj. 800 e uma campanha vencida, e assim por diante);
  - medalhas;
  - estatísticas de abates ar-ar, ar-solo, estáticos e navais, além de mortes.
- **No DCC:** completaria o modo carreira, que hoje é financeiro.
- **Esforço:** 1 a 2 sessões.

### 7. Pacotes montados pelo jogador

**Feito (2026-10-16):** `requestPackageSupport` em `ato-planner.ts` e os botões "Request support" sob
cada voo seu na tela de missão (`routes/campaign/mission/package-support.tsx`).

- **Pedidos:** antes de gerar a missão, você pede para o seu voo:
  - **Escort:** CAP na rota, a 65% do caminho até o alvo;
  - **SEAD:** contra o SAM que protege o alvo; recusado se nenhum ameaça;
  - **Sweep:** varredura perto do alvo, 10 min antes.
- **Recursos:** o apoio sai dos esquadrões do lado como qualquer voo do ATO (tipos configurados para a
  tarefa, aviões disponíveis no estoque, base próxima) e entra no pacote do seu voo. Se o voo não tinha
  pacote, um é criado com você como `primary`.
- **Horário:** casado com o TOT do seu voo, usando as mesmas antecedências do planejador, e nunca antes
  de 5 min a partir de agora.
- **Recusas:** o motivo aparece ao lado do botão ("no aircraft ready for SEAD", "the package already has
  escort"…).
- **Ainda não feito:** escolher alvo e TOT do zero numa tela de planejamento; pedir ECM.

- **No BMS:** o jogador escolhe alvo e TOT e pede escolta, SEAD e ECM da IA no mesmo pacote, desde
  que haja aviões livres nos esquadrões.
- **No DCC:** dá para criar um voo manual, mas não um pacote com apoio da IA. Para o MiG, seria pedir
  uma escolta ou uma varredura junto com a própria missão.
- **Esforço:** 2 a 3 sessões. Combina com o item 1.

### 8. Meteorologia no briefing e no planejamento

**Feito (2026-10-16):** `packages/data/src/weather.ts` (modelo e tabela do DCS),
`apps/frontend/src/logic/systems/weather.ts` (evolução) e o painel Weather da tela de missão.

- **Antes:** toda missão saía com o mesmo céu (Preset2, 20 °C, vento igual em todas as altitudes).
- **Tempo da campanha** (`campaign.weather`): cinco padrões (limpo, esparso, nublado, encoberto,
  chuva) que mudam a cada 6 a 12 h.
  - **Mudança:** cada troca fica no padrão ou anda um passo, puxada pela climatologia do teatro e pela
    estação. O inverno alemão fecha, e o Golfo fica limpo. O hemisfério sul é invertido.
  - **Cada padrão define:** preset de nuvem do DCS (só presets que aceitam a base escolhida), base,
    vento de superfície, 2000 m e 8000 m (mais forte e girando com a altitude), QNH, visibilidade e
    temperatura (estação, ciclo do dia, atenuado pelas nuvens).
  - **Previsão:** o próximo padrão e a hora da troca.
  - **Log:** a mudança de padrão vai para o log e para as notícias da tela de inteligência.
- **Briefing:** céu, base em pés e metros, visibilidade, temperatura, ventos nas três altitudes, QNH
  (mmHg, hPa e inHg), altitude de rastro de condensação e a previsão.
- **Planejamento:** com teto baixo (encoberto ou chuva abaixo de 1500 m), strike, CAS, OCA, estratégico
  e DEAD perdem prioridade no ATO (-20, ou -30 com chuva). O briefing avisa.
- **Ainda não feito:**
  - trocar bomba laser por bomba burra: cada avião tem um único armamento por tarefa nos dados;
  - neblina e tempo diferente no alvo e na base, já que o DCS usa um tempo só para o mapa todo;
  - tempo no kneeboard.

- **No BMS:**
  - o tempo no alvo e na base aparece separado;
  - a base das nuvens e a altitude de rastro de condensação são informadas;
  - o planejador evita armas guiadas por laser com céu fechado.
- **Esforço:** 1 a 2 sessões.

## Ordem recomendada

1. Item 2: barato, e dá peso às surtidas do jogador.
2. Item 1: a maior mudança de jogo para quem voa caça.
3. Item 3: controle sobre a guerra aérea.
4. Item 4: névoa de guerra, quando a base estiver estável. Ela se apoia nos radares, no GCI e no
   reconhecimento que já existem.
