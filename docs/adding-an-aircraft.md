# Como adicionar uma aeronave à carreira

Passo a passo para colocar um novo módulo do DCS na carreira, como foi feito com o MiG-29 e
os Flaming Cliffs (Su-27, Su-25, MiG-29S, Su-25T, Su-33, F-15C, A-10A, F-5E, F-86F e MiG-15bis)
e o F-16C. A ordem importa: primeiro o perfil do módulo, depois a verificação contra o DCS instalado,
por último a economia.

## Obrigatório

### 1. Perfil do módulo

Crie `packages/data/src/aircraft-profiles/<tipo>.ts` exportando um `AircraftProfile` e registre-o
em `aircraftProfiles`, no `index.ts` da mesma pasta.

- `aircraftName`: o nome do tipo no DCS, igual ao `Name` da definição do módulo ou ao
  `MAC_flyable('<nome>')` do `entry.lua`.
- `displayName` e `shortName`: nomes da interface.
- `fidelity`: `full` para módulos completos e `flamingCliffs` para os FC.
- `role`: `airSuperiority`, `multirole`, `attack` ou `helicopter`. Decide os multiplicadores de
  recompensa (`careerRoleMultipliers`).
- `factionTypes`: os nomes que as facções usam para esse avião, quando diferem do módulo. Exemplo:
  o MiG-29 do jogador é o `MiG-29A` das facções. Sem isso, a regra Fidelidade não sabe a que
  coalizão o tipo pertence.
- `stations`: as estações, da esquerda para a direita vistas de trás, com o rótulo do editor.
- `weapons`: uma entrada por CLSID, com `ammoNames` (os nomes que o `Unit.getAmmo` devolve,
  normalizados por `normalizeAmmoName`), `roundsPerStore` (um casulo de foguetes conta foguetes) e
  as estações aceitas. Tanques ficam `free: true`.
- `loadouts`: os loadouts sugeridos e as tarefas de cada um. Uma tarefa sem loadout não é oferecida.
- `navigationAids` (`adf`, `tacan`, `ils`, `rsbn`) e `units` (`metric` ou `imperial`): mudam o
  gerador, o kneeboard e as chamadas GCI.
- `minorFailures`: deixe vazio até mapear as falhas (ver opcionais).

De onde tirar os dados:

- módulo completo: a definição Lua em `CoreMods/aircraft/<módulo>/` ou `Mods/aircraft/<módulo>/`
  (`Pylons`, `panelRadio`, `Failures`) e os scripts de dispositivos em `Cockpit/Scripts`
  (`Failure_name`);
- Flaming Cliffs: as tabelas de pilone ficam nos binários. Use os payloads do editor
  (`MissionEditor/data/scripts/UnitPayloads/<tipo>.lua`) e as missões do módulo. Só libere uma arma
  nas estações em que ela foi vista.

Antes de escrever o perfil, o modo `--inspect` lista o que o módulo oferece. Para cada CLSID ele
mostra as estações e os nomes dos payloads do editor que o levam, e é desses nomes que sai o nome
da arma:

```powershell
cd packages/data
bun scripts/verify-aircraft-profile.ts "D:/DCS OF/DCS World" "<aircraftName>" --inspect
```

Deixe de fora as armas cujo nome no `Unit.getAmmo` ou cuja contagem por carga você não consegue
confirmar, como casulos de canhão e racks múltiplas. Quando o nome não bate, a carga inteira conta
como gasta na volta. Duas armas do mesmo avião também não podem ter um nome de munição em comum
(por exemplo um casulo S-8KOM simples e um duplo), porque uma desconta os foguetes da outra. O
teste genérico recusa isso; escolha uma das duas.

Alguns Flaming Cliffs, como o A-10A, têm a definição em Lua com a tabela `pylon(n, …)`. Nesse
caso o script lê as estações de lá, que é a regra do próprio módulo.

### 2. Verificação contra o DCS instalado

```powershell
cd packages/data
bun scripts/verify-aircraft-profile.ts "D:/DCS OF/DCS World" "<aircraftName>" --write
```

O script mostra:

- CLSIDs que o módulo não conhece;
- estações onde uma arma nunca foi vista. Num FC isso é erro; num módulo completo é só aviso;
- falhas e rádios que o módulo não tem;
- o que o módulo suporta: rádios com preset, quantas falhas programáveis, estações vistas.

Com `--write`, ele grava o resultado em `src/aircraft-profiles/module-snapshots.ts`. O teste
genérico (`packages/generate-miz/src/aircraft-profiles.test.ts`) compara todos os perfis com esse
arquivo, então ele precisa ser regravado sempre que um perfil mudar. O script sai com código 1
quando acha erro.

### 3. Economia da carreira

Crie `packages/data/src/career/<tipo>.ts` com `defineCareerAircraft(perfil, economia)` e registre
em `careerAircraft`, no `index.ts` da mesma pasta.

- `prices`: novo, faixa do usado, revisão e reparo por ponto de integridade;
- `usedIntegrityRange` e `usedDefectCount`. Num tipo sem falhas mapeadas, use `[0, 0]`;
- `deliveryHours` (prazo de entrega) e `resaleFactor` (fração do valor na revenda);
- `weaponPrices`: toda arma que não é `free` precisa de preço;
- `startInventory`: o estoque inicial de quem começa nesse avião.

### 4. Testes

```powershell
cd packages/generate-miz; bun run test
cd apps/frontend; npx vitest run src/logic/career
```

Os testes genéricos rodam sozinhos para o tipo novo:

- loadouts respeitam as estações;
- CLSIDs, falhas e rádios existem no snapshot do módulo;
- o plano de rádio padrão cabe nas faixas em todas as bases com dados de rádio;
- uma rota gerada cabe no limite de waypoints;
- todas as armas têm preço e o estoque inicial é válido.

## Opcional

- **Rádios com preset** (`radios`): só quando o módulo tem `panelRadio`. Declare cada rádio de
  comunicação (faixas, canais, `firstChannelLabel` quando o cockpit não começa em 1, e o
  `Radio[n]` da missão), o ADF se houver, e o `defaultPlan`. Sem `radios`, o gerador não grava
  presets e a tela de rádio fica desligada.
- **Falhas** (`minorFailures`): só falhas que degradam sem impedir de voar e combater. Use os IDs
  que o script lista. Com falhas, aviões usados e danos passam a armar defeitos.
- **Limite de waypoints** (`maxRouteWaypoints`): quando o sistema de navegação guarda poucos
  pontos. A carreira afina a rota antes da decolagem.
- **Kneeboard**: segue `units` e `navigationAids` sem código novo. Sem TACAN, ele mostra o NDB e a
  torre da base.

## Fora do escopo por enquanto

Assentos extras com tripulante de IA, helicópteros com bases próprias e porta-aviões. O perfil já
tem espaço para isso, mas a carreira ainda não trata esses casos.
