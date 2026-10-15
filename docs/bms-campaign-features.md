# Features de campanha tiradas do Falcon BMS

Referência: `D:\falcon\Game\Falcon BMS 4.38`, arquivos `Data\Campaign\Falcon4.aii`, `Offense.pri`, `Defense.pri` e `MissionData_XX.xml`.

O ATO daqui já cobre BARCAP, varredura, interceptação, OCA, BAI, interdição, AWACS e SEAD. O que falta, e cabe numa surtida de 45–90 minutos, está abaixo.

## 1. CAS de alerta

No ataque o Falcon dá peso 90 ao CAS sob chamada, o mesmo da interdição, e segura 2 voos (`OnCallFlightsPerRequest`). Cada um fica 20 minutos na estação, no mínimo 10 (`AMIS_ONCALLCAS`).

O CAS marcado sai no pacote com hora fixa. O de alerta só decola quando a coluna entra no assalto (`captureStartedAt`). Dois aviões, decolagem em 10 minutos, prioridade 90.

Estado: feito no planejador.

## 2. Alerta no solo

Dois caças, planejamento de 0 a 10 minutos (`AMIS_ALERT`), e o BMS só os põe no pátio 10 minutos antes do táxi (`g_nDeagTimerCamp`).

A interceptação já existia. O que mudou: a decolagem não fica antes de 10 minutos a partir de agora, mesmo com o raid em cima da hora. O orçamento continua em um scramble por lado.

Estado: feito.

## 3. Mudança de base

Peso 100 nos dois planos, o maior da lista. Quatro aviões, planejamento de 20 a 120 minutos (`AMIS_RELOCATE`).

Um campo craterado para de lançar. O esquadrão decola uma vez, desse campo, e pousa no campo amigo mais próximo que ainda opera. A casa do voo passa a ser o destino.

Estado: feito.

## 4. Órbita de interferência

Um avião, 30 a 70 milhas atrás da frente, 60 minutos na estação, escolta igual à do AWACS (`MinimumECMDistance` / `MaximumECMDistance`, `AMIS_ECM`). Enquanto está lá, o radar de busca do outro lado piora. Só na época que já tem esse avião na lista, do mesmo jeito que o E-3.

Estado: feito. A tarefa `ECM` existe em toda facção com a lista vazia, então Fulda não inventa um jammer. Quando a lista tem o avião, o planejador põe uma órbita entre o AWACS e a BARCAP. Enquanto ela está no ar, o pacote de ataque não espera o SEAD e o radar de busca inimigo fica `jammed`.

## 5. Turnaround

`AircraftTurnaroundMinutes` 60. O pouso grava `aircraftTurnaroundUntil` por campo e por tipo (`Home:F-16C_50`). Esse tipo não decola de novo desse campo por uma hora. Outro tipo no mesmo campo, e o mesmo tipo em outro campo, seguem livres. O ferry de um campo craterado não passa por esse filtro.

## 6. Caça em cima do resgate

O CSAR sai sozinho. No Falcon, com um piloto no chão, dois caças decolam na hora (`AMIS_HAVCAP`: planejamento 0, dois aviões, 60 minutos na estação, mínimo 30) e não passam de 45 milhas (`MaxSARDistance`). Peso 10 no ataque e 80 na defesa.

O planejador põe um CAP no piloto, decolagem em 10 minutos, prioridade acima da BARCAP. O par divide o orçamento de CAP (dois pares no ar).

Estado: feito.

## 7. Emboscada baixa

`AMIS_AMBUSHCAP`: dois caças, 15 minutos na estação, planejados com 30 minutos, entre 500 e 2.000 pés, mais à frente da BARCAP. Peso 40 no ataque e 80 na defesa. A frase do BMS é impedir que o pacote inimigo atravesse a área.

Órbita baixa no mesmo trecho da frente, prioridade abaixo da BARCAP. Os dois cabem no orçamento de dois pares.

Estado: feito.

## 8. Cortar a estrada

No ataque a ponte pesa 100, igual ao aeródromo. No CAS cai para 1. O texto da missão é destruir a ponte antes da coluna cruzar. `ObjectiveRepairInterval` é 120 minutos.

Um ataque no trecho de um eixo já aberto fecha essa ligação por duas horas. A coluna que ainda não entrou no combate para. A que já está na cidade continua. Depósito destruído continua destruído.

Estado: feito.

## 9. Relógio da reposição

`OffensiveReinforcementTime` 60. A preparação de 20 minutos na porta da cidade continua. A espera de 2 horas antes da primeira ofensiva está na seção 10.

Quando uma companhia é destruída, o quartel daquela cidade espera uma hora antes de formar outra. A guarnição que já está lá não é dissolvida.

Estado: feito.

## 10. A ordem da guerra

O manual do BMS (prioridades, 9.4.2) descreve três tempos. O ar fragga na hora. A terra só abre ofensiva depois da preparação (`ActionPrepTime` 120 minutos). Fábrica e usina sobem de prioridade mais tarde. Quem ganha a campanha é a tropa. A preparação de 20 minutos na porta da cidade continua. O que faltava era a espera antes de qualquer coluna sair.

No Fulda isso vira relógio gravado na criação da campanha:

- Nas primeiras 2 horas só saem surtidas contra o que derruba o avião: OCA, SEAD e o posto de comando. A coluna nova fica de guarnição. CAS, corte de estrada, depósito e fábrica esperam.
- Das 2 às 8 horas a ofensiva de terra abre, com depósito, estrada e CAS.
- Depois de 8 horas fábrica, usina e plataforma de petróleo passam a ser o alvo preferido. O B-52 e o Tu-22M3 só saem nesse tempo. Um desses prédios vivo, a até 5 km do quartel, aumenta a produção. Morto, o bônus some.

Campanha antiga, sem esses relógios, continua como está.

### Onde a indústria fica

Não é uma fábrica por vila. São os complexos que existiam em 1985 dentro das cidades do teatro. Os prédios são estáticos do DCS que o molde já usa: `Workshop A`, `Warehouse`, `Tech combine`, `Boiler-house A`, `Chemical tank A`, `Military staff`.

Pacto:

- Eisenach, fábrica: VEB Automobilwerk Eisenach, o Wartburg.
- Gotha, fábrica: Gothaer Waggonfabrik, vagões.
- Erfurt, fábrica: VEB Optima, o parque industrial do distrito.
- Bitterfeld, fábrica e usina: Chemiekombinat Bitterfeld, o triângulo químico, com a central do próprio complexo.
- Köthen, combustível: a estrada química até Bernburg. A soda era em Bernburg, que não está no mapa. Köthen é a cidade do teatro nesse eixo.
- Potsdam, comando: o quartel-general soviético era Wünsdorf. Potsdam é a cidade do mapa mais perto de Berlim.

OTAN:

- Braunschweig, fábrica: Volkswagenwerk Braunschweig, o Vorwerk de 1938, peças para Wolfsburg.
- Hannover, fábrica: o cinturão industrial da cidade.
- Hanau, fábrica: Degussa e o parque químico a leste de Frankfurt.
- Helmstedt, usina: Kraftwerk Buschhaus, linhito, na rede em 30 de julho de 1985.
- Hamburgo, combustível: o porto de petróleo.
- Frankfurt, comando: o objetivo de terra do Pacto.
- Schwedeneck A e B, plataformas: o campo Schwedeneck-See, na baía de Kiel. A produzia desde novembro de 1984. B já estava instalada; a produção dela começou no verão de 1985. Ficam na água, sem estrada, com o estático `Oil rig` do DCS.

Estado: feito.

## Filtros que acompanham

- Ameaça: `MaxFlymissionThreat` 45, `MinAvoidThreat` 40, `MinSeadescortThreat` 20. Se um SAM cobre o alvo e a facção tem SEAD ou DEAD mas o pacote saiu sem eles, o ataque espera. Coreia, sem essa lista, continua atacando.
- Turnaround: `AircraftTurnaroundMinutes` 60. Feito na seção 5.

## Fora deste plano

Tanker (60–100 milhas) e JSTARS (70–110 milhas, olha o chão). A lista de reabastecimento está vazia, e a coluna já aparece no mapa.

FAC pesa 40 no ataque, 60 na defesa e 100 na interdição. A tarefa `AFAC` já existe, com a lista vazia em toda facção. Sem o avião, não inventa.

BDA pesa 1 a 10 e só sai acima da prioridade 900, porque no Falcon o dano é incerto até alguém olhar. Aqui a campanha já sabe qual prédio caiu.
