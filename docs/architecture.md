# Math Quake — Архитектура и план инкрементального рефакторинга

> **Что это.** Не «переписать всё», а **зафиксировать целевую архитектуру** сетевого R3F-шутера и дать **безопасный пошаговый путь** к ней из текущего кода. Каждый шаг — самостоятельно отгружаемый и `tsc --noEmit`-чистый; игра работает после каждого шага. Никакого big-bang rewrite.
>
> **Зачем сейчас.** Впереди много сетевых систем (поезд-горка, ИИ-твари, крафт-миньоны с радиальным меню, мили, рэгдолл, GA-походки, большая мульти-левел карта). Владелец требует: строить ПРАВИЛЬНО и поддерживаемо с этого момента — «no god object», чистый фундамент, чтобы «не въебаться на проде сетевом». Этот документ — конституция, на которую садятся инкременты 06+.
>
> **Метод (из 00-README).** Агенты пишут спеки, владелец кодит по одному инкременту, playable-срез, плейтест. Значит этот рефакторинг тоже идёт **инкрементами-срезами**, а не отдельной «неделей рефакторинга». Каждый шаг §7 — маленький, проверяемый, ценный сам по себе.

---

## 0. TL;DR (для нетерпеливого)

1. **Диагноз.** Два god-объекта: `store.ts` (всё состояние + бизнес-логика воксель-физики в одном `create`) и `Player.tsx` (один `useFrame` ~380 строк: движение + bhop + джетпак + крюк + камера + шейк + recoil + стрельба + миньон-команда + netsync). Плюс скрытая связка «прямой мутации стора» и «input как React-state».
2. **Целевые слои (4 контура правды).** (A) **NET-authoritative** (сервер = правда, клиент интерполирует — уже есть `worldBuffer.ts`); (B) **local cosmetic** (дебрис/рэгдолл/джус — никогда не синкается); (C) **local-player sim** (движение/оружие — клиент владеет собой); (D) **React/DOM UI** (читает стор, НЕ водит горячий цикл).
3. **Структура.** Прагматичные **feature/domain-папки** + **лёгкий «systems»-слой хуков** внутри игрока. НЕ полноценный ECS (оверинжиниринг для этой скорости). Стор режем на **слайсы**. `Player.tsx` режем на композируемые хуки (`useInput/useMovement/useJetpack/useGrapple/useWeapons/useCameraRig/useNetSync`) с явным порядком апдейта и сохранённой zero-alloc дисциплиной.
4. **Один паттерн «мировой сущности»** (интерполированный авторитетный корень + локальная косметика) — переиспользуют train/creatures/minions/ragdoll. Новая система = «добавить модуль», а не «править god-файл».
5. **Порядок.** Сначала дешёвые, разъединяющие шаги (типы/слайсы/вынести системы/зафиксировать net-контракт), ПОТОМ строить поезд/тварей. Иначе долг компаундится на каждой новой системе.

---

## 1. Честный аудит: где болит и почему станет хуже

Проверено по коду: `store.ts`, `Player.tsx`, `server.ts`, `socket.ts`, `net/worldBuffer.ts`, `Enemies.tsx`, `Minions.tsx`, `Debris.tsx`, `WorldEntities.tsx`, `RemotePlayers.tsx`, `game/{movement,shake,fx}.ts`, `hooks/useKeyboard.ts`, `Game.tsx`, `theme.ts`.

### 1.1 `store.ts` — растущий god-store (главный риск)

Один `create<GameState>` держит **всё**: `score/health/enemies/projectiles/damageNumbers/debris/lastDeathFx/jetpackFuel/jetpackStunUntil/remotePlayers/currentWeapon/commandTarget/localMinions` + ~25 экшенов. Проблемы, которые УЖЕ есть и усилятся:

- **Смешаны 4 контура правды в одном объекте.** `remotePlayers` (NET-контур B/A), `debris`/`lastDeathFx` (косметика, контур B), `health`/`score` (частично NET-авторитет сервера, частично локально), `commandTarget`/`localMinions` (скоро уедут в NET-авторитет по инкр.08). Нельзя посмотреть на тип и сказать «это синкается или нет». Когда добавятся `creatures`/`train`/`resources`/`ragdollInbox`/`squads` — тип станет нечитаемым, а границы «что локально / что авторитетно» окончательно размоются. Это ровно то, что порождает сетевые баги на проде.
- **Бизнес-логика физики зашита в стор.** `makeChunks()` (воксель-фрактура, ~35 строк математики), `SHAPES`, `DEBRIS_CAP`, `NEON`, `colorForEnemy` живут в `store.ts`. Стор должен быть **транспортом состояния**, а не движком дебриса. Каждая новая система соблазнится добавить свою математику сюда же (как уже случилось).
- **`damageEnemy` делает пять вещей за один `set`**: урон, спавн damage-numbers, генерация дебриса, `lastDeathFx`, начисление score. Это узел, за который дёргают инкр.02/08/10 (там прямо помечено «тут умирают враги — единственный хук»). Скоро сюда полезут: дроп ресурсов (08), `killCreature`+`ragdollInbox` (10). Узел станет неуправляемым.
- **Массивы пересоздаются на каждый геймплейный ивент** (`projectiles: [...state.projectiles, …]`, `damageNumbers: [...]`). Для редких событий ок; но `debris` уже обходит стор через «inbox»-паттерн именно потому, что per-frame в сторе не тянет. Это доказывает, что **горячие данные не должны жить в реактивном сторе** — но правило нигде не закреплено, и следующий разработчик системы его нарушит.

### 1.2 `Player.tsx` — god-component / god-useFrame

Один `useFrame` (строки 123–505, ~380 строк) в одной функции делает **всё** покадрово: чтение linvel/translation, third-person камера, `sampleShake`, recoil, weapon sway, grounded-raycast, jetpack-стан по стору, bhop/coyote/buffer/air-jump, джетпак-тяга+топливо+throttled-write в стор, ground/air accelerate, **крюк-кошка** (raycast+reel+rope-визуал), `setLinvel`, muzzle-fade, laser-fade, **стрельба** (4 конфига, hitscan/projectile, спарки через `scene.add`+`setTimeout`, socket emit hit/shoot), **минион-команда** (raycast+setCommandTarget), bounds-death, **netsync** (`socket.emit('update')`). Плюс сам компонент рендерит оружие, muzzle, third-person mesh, лазер и верёвку.

Почему это будет резать при масштабировании:
- **Инкр.07 (поезд)** прямо пишет: нужна «ride-ветка ВМЕСТО обычного movement-блока», кабинная камера, `E`-interact, `setBodyType` kinematic. Это влезет только в тот же useFrame — он раздуется до ~550 строк с ветвлением режимов внутри одной функции.
- **Инкр.08 (радиал)** прямо пишет: «чтобы Player.tsx useFrame не раздувался, вынести радиал в `game/radial.ts`». Уже есть осознание, что файл переполнен.
- **Порядок апдейта неявный.** Камера ставится в начале, шейк/recoil сразу, движение в середине, netsync в конце — но это «так исторически легло». Инкр.07 §5.5 требует явный `useFrame` priority (Train раньше Player). Без выделенного «tick orchestrator» порядок между системами становится лотереей маунта.
- **Нет переиспользования.** Логика grounded-raycast, weapon-feel, netsync-throttle не может быть переиспользована миньоном/тварью/удалённым игроком — она заперта в замыкании компонента.

### 1.3 Связки и «протечки контуров» (coupling hotspots)

- **Прямая мутация стора мимо `set()`.** `socket.ts:60` — `useStore.getState().score = data.score;` (и `:59` — та же ветка). Это молча ломает реактивность (подписчики `score` не перерисуются) и обходит единственную точку истины. Классический источник «у одного игрока счёт не обновился». **Настоящий баг, не стиль.**
- **Input как React-state.** `useKeyboard` держит `keys` в `useState` и делает `setKeys` на КАЖДОЕ нажатие → Player ре-рендерится, пересоздаётся `useFrame`-замыкание. Для горячего цикла ввод должен быть **ref/mutable-снимком**, а не state (иначе каждая клавиша = ре-рендер сцены). Пока незаметно, но при росте UI/подписок начнёт стоить.
- **Прямые cross-import'ы между «системами».** `Enemies.tsx`, `Minions.tsx`, `Player.tsx` дёргают `useStore.getState().addProjectile/damageEnemy/setCommandTarget` напрямую из `useFrame`. `Minions.tsx:50` пишет `useStore.setState({ localMinions })` каждый кадр (+ аллокации `new THREE.Vector3` на юнита/кадр — грязно, помечено в инкр.08). Нет слоя «команд/событий» — всё дёргает глобальный стор императивно. Когда систем станет 10, это граф «все-со-всеми».
- **DOM-логика верхом на 3D через ad-hoc шины.** `game/fx.ts` (hitmarker-шина) — правильный паттерн (декуплинг 3D→DOM без churn стора), но он единичный и не обобщён. Инкр.08 хочет такую же шину для радиала. Без обобщённого «event bus» каждый заводит свою.
- **`scene.children` full-raycast как способ найти цель.** `Player.tsx` шутинг и grounded-проба делают `intersectObjects(scene.children, true)` и ходят вверх по `obj.parent` в поисках `userData.isEnemy/isFloor/isWall`. Работает, но: (1) O(вся сцена) на каждый выстрел/кадр; (2) `userData`-строки — нетипизированный контракт, раскиданный по `Arena/Enemies/RemotePlayers/Train(future)`. С большой мульти-левел картой это станет и перф-, и корректность-проблемой.
- **`gameOver()` на `pointerlockchange`.** `Player.tsx:104-115` — ЛЮБОЙ выход из lock завершает матч. Инкр.08 §7.5 прямо называет это «хрупким тех-долгом»: любой будущий UI, снимающий lock, убьёт игру. Это архитектурная мина под будущие меню/паузу.

### 1.4 Что УЖЕ сделано правильно (не ломать)

- **Zero-alloc дисциплина в `useFrame`** (модуль-скоуп `_wishDir/_moveVel/...` в Player; `_m/_q/_e/_v/_s/_c` в Debris; `_out` reuse в `worldBuffer`). Это ядро 60fps — **сохраняем как незыблемый инвариант**.
- **`game/*.ts` — чистые модули без React** (`movement/shake/fx`). Вызывающий владеет состоянием. Это ровно целевой паттерн для systems-слоя — расширяем его, а не заменяем.
- **«Spawn inbox»-паттерн Debris** (стор = почтовый ящик спавна, компонент сливает в локальный пул и дальше симулит сам, ноль per-frame стора). Это **эталон** для всей косметики (контур B). Обобщаем.
- **NET-хребет `worldBuffer.ts`** уже правильный: снапшоты идут `socket → кольцевой буфер → sampleWorld() → ref-меш`, **мимо** React/zustand, ноль аллокаций, clock-offset EMA, интерполяция с задержкой. Это готовый контур A — на него садятся train/creatures/minions.
- **`WorldEntities.tsx`** — уже мини-прототип целевого «world entity renderer» (читает `sampleWorld()` в useFrame, пишет в ref). Обобщаем его в переиспользуемый паттерн §5.

---

## 2. Целевая архитектура: 4 контура правды

Ядро решения — не «папки», а **явные границы между четырьмя контурами**. Каждый кусок состояния и логики принадлежит ровно одному; правила пересечения — жёсткие.

```
┌── (A) NET-AUTHORITATIVE ──────────────────────────────────────────────┐
│ Сервер = ЕДИНСТВЕННАЯ правда: root-transform + enum-state + hp + t.    │
│ Клиент: worldBuffer (кольцо снапшотов) → sampleWorld() → интерполяция. │
│ Сюда: creatures, train, minions/squads, resources, HP/death/score.    │
│ НИКОГДА не идёт через реактивный zustand покадрово. Только «структура» │
│ (список id/спавн-события) — редко, реактивно.                          │
├── (B) LOCAL COSMETIC ─────────────────────────────────────────────────┤
│ Клиент-only, НИКОГДА не синкается. Debris, ragdoll-суставы, spark,     │
│ damage-numbers, screen-shake, muzzle/laser fade, walk-bob, наклон      │
│ вагона. Паттерн «spawn inbox» (стор-почта → локальный пул → own sim).  │
│ Разные клиенты видят чуть разное — ОК by design (как debris).          │
├── (C) LOCAL-PLAYER SIM ───────────────────────────────────────────────┤
│ Клиент владеет собой: движение (bhop/air-strafe), джетпак, крюк,       │
│ оружие/hitscan, камера. Rapier-физика локального игрока. Шлёт intent-ы │
│ (update/shoot/hit/train_input/minion_command). Сервер валидирует урон. │
├── (D) REACT / DOM UI ─────────────────────────────────────────────────┤
│ Читает стор селекторами (редко-меняющиеся поля), рисует HUD/меню.      │
│ НИКОГДА не водит горячий цикл. Покадровое → прямые DOM-мутации/шины,   │
│ не setState (как fx.ts hitmarker, throttled jetpack-fuel).            │
└───────────────────────────────────────────────────────────────────────┘
```

**Инвариант границ (закон):**
1. Контур A покадрово живёт в `net/*` (ref-буфер), НЕ в zustand. В zustand от A — только «структура сцены» (списки id, `train.pilotId`, `resources`-зеркало для HUD).
2. Контур B никогда не попадает в сеть и не живёт в реактивном сторе покадрово — только «inbox» спавна.
3. Контур C — единственный, кто пишет `setLinvel`/двигает камеру локального игрока и шлёт intent-ы. Не читает косметику B.
4. Контур D читает стор, но горячие покадровые значения тянет императивно (`getState()` в useFrame или прямой DOM), не подписками.

Всё, что мы делаем в §3–§6, — это разложить существующий код по этим контурам и сделать границы **видимыми в структуре файлов и типов**.

---

## 3. Структура проекта: feature-папки + лёгкий systems-слой

### 3.1 Выбор: НЕ ECS, а «domain modules + system hooks». Обоснование.

Рассматривали три варианта:
- **(1) Оставить как есть (god-файлы).** Отвергнуто — §1.
- **(2) Полноценный ECS** (entity registry + компоненты + системы-итераторы). Отвергнуто как **оверинжиниринг для этой стадии**: R3F/Rapier уже дают «сущность = компонент + rigidbody», а сеть уже задаёт «сущность = запись в снапшоте». Второй, самодельный ECS-слой поверх — это двойная бухгалтерия, чужеродная R3F, и он замедлит быстрый геймплей-итерейт владельца (метод «playable-срез за проход»). ECS окупается на сотнях однородных сущностей одного вида; у нас — разнородные системы (поезд ≠ тварь ≠ миньон) по ≤ капов (creatures 40, minions 16, ragdolls 8).
- **(3) ВЫБРАНО: domain-модули + system-хуки.** Каждая система — самодостаточный модуль (`game/<system>.ts` чистая логика + `components/<System>.tsx` рендер + опц. `net/` вклад + `config/<system>.ts` числа). Внутри игрока — композиция **system-хуков** с явным порядком. Это прямое продолжение уже существующего паттерна (`game/movement.ts` + `Player.tsx`), просто доведённое до конца и стандартизированное.

> **Прагматика:** цель — «поддерживаемо + масштабируемо», а не «максимально абстрактно». Каждая новая система должна добавляться как **новая папка/модуль**, не трогая чужие. Это единственная метрика, по которой судим архитектуру.

### 3.2 Целевое дерево (куда переезжает каждый текущий концерн)

```
src/
  store/                      # РАНЬШЕ: один store.ts. СТАЛО: слайсы (§4).
    index.ts                 #   собирает useStore из слайсов (combine)
    types.ts                 #   общие типы состояния (Enemy, PlayerState, …)
    playerSlice.ts           #   health, score, currentWeapon, isPlaying, jetpackFuel/stun
    combatSlice.ts           #   projectiles, damageNumbers  (спавн-inbox'ы)
    cosmeticSlice.ts         #   debris, lastDeathFx  (контур B inbox)
    netSlice.ts              #   playerId, roomId, remotePlayers  (контур A структура)
    worldSlice.ts            #   creatureIds, minionIds/squads, train{pilotId}, resources (A-структура, растёт по 05/07/08)
    enemySlice.ts            #   enemies[] + spawn/damage/remove (до переезда врагов на сервер)

  net/                       # контур A — уже есть worldBuffer.ts
    worldBuffer.ts           #   кольцо снапшотов + sampleWorld + serverNow (ЕСТЬ)
    protocol.ts              #   NEW: типы сообщений + версия + квантование (§6)
    handlers.ts              #   NEW: регистрация socket.on(...) (вынести из socket.ts)
    socket.ts                #   тонкий: create socket + connect (из текущего socket.ts)

  game/                      # чистые модули без React (ЕСТЬ: movement/shake/fx)
    movement.ts  shake.ts  fx.ts          # как есть
    eventBus.ts              #   NEW: обобщение fx.ts (типизированные шины 3D↔DOM)
    voxel.ts                 #   NEW: makeChunks/colorForEnemy/NEON (вынести из store.ts)
    radial.ts                #   NEW (инкр.08): радиал-стейт-машина
    spline.ts                #   NEW (инкр.06): рельсы
    ragdoll.ts  locomotion.ts  ga.ts      #   NEW (инкр.10/11)

  systems/                   # NEW: system-хуки локального игрока (контур C) — §4.3
    useInput.ts              #   ref-снимок ввода (замена useState в useKeyboard)
    usePlayerMovement.ts     #   bhop/air-strafe/grounded (из Player.tsx)
    useJetpack.ts  useGrapple.ts  useWeapons.ts  useCameraRig.ts  useNetSync.ts
    useFrameOrder.ts         #   константы priority (порядок tick, §4.4)

  components/                # рендер (R3F). Тонкие, читают стор/net.
    Game.tsx                 #   компоновка сцены + <TickRoot/> порядок
    Player.tsx               #   ТОНКИЙ: композиция system-хуков + JSX оружия
    Enemies.tsx  Debris.tsx  Projectiles.tsx  DamageNumbers.tsx  RemotePlayers.tsx
    WorldEntities.tsx        #   → обобщается в паттерн §5; далее Train/Creatures/Squads
    Arena.tsx  MatrixRain.tsx  PostFX.tsx  UI.tsx  ErrorBoundary.tsx

  config/                    # NEW: тюнинг-числа (инкременты уже просят config/train.ts, config/minions.ts)
    train.ts  minions.ts  ragdoll.tuning.ts  weapons.ts

  hooks/useKeyboard.ts       # остаётся как источник событий, но пишет в ref (§4.3)
  theme.ts  utils/audio.ts   # как есть
```

Это **эволюция**, не революция: существующие `game/`, `net/`, `components/`, `hooks/`, `utils/` остаются; добавляются `store/` (разбитый), `systems/`, `config/`, и пара новых модулей в `game/`/`net/`.

### 3.3 Контракт `userData` — единая типизированная точка

Сейчас `userData.{isEnemy,isPlayer,isFloor,isWall,isJumpPad,id}` — строковый контракт, раскиданный по компонентам и читаемый raycast-обходом parent-цепочки. Централизуем:

```ts
// game/hitTags.ts (NEW)
export interface HitTag {
  isEnemy?: boolean; isPlayer?: boolean; isFloor?: boolean; isWall?: boolean;
  isJumpPad?: boolean; isWagon?: boolean; isCab?: boolean; isMinion?: boolean;
  id?: string; jumpForce?: number; wagonIndex?: number;
}
export const tag = (t: HitTag): HitTag => t;                 // фабрика userData
export function findTag(o: THREE.Object3D | null): { obj: THREE.Object3D; tag: HitTag } | null; // parent-обход, одна реализация
```

Все `userData={{...}}` → `userData={tag({...})}`; все parent-обходы (`Player.tsx` шутинг/grounded/grapple) → `findTag()`. Один типизированный контракт, одна реализация обхода, готово к train/creatures/minions-хитбоксам.

---

## 4. Разбор god-объектов

### 4.1 Слайсы стора (режем `store.ts`)

Zustand поддерживает slice-паттерн без смены API (`useStore(s => s.x)` не меняется). Каждый слайс — функция `(set, get) => ({...})`, собираются в один `create`:

```ts
// store/index.ts
export const useStore = create<GameState>()((...a) => ({
  ...createPlayerSlice(...a),
  ...createCombatSlice(...a),
  ...createCosmeticSlice(...a),
  ...createNetSlice(...a),
  ...createWorldSlice(...a),
  ...createEnemySlice(...a),
}));
```

Раскладка по контурам (§2) — и это делает границы видимыми:

| Слайс | Контур | Поля | Заметки |
|---|---|---|---|
| `playerSlice` | C/D | `health, score, currentWeapon, isPlaying, jetpackFuel, jetpackStunUntil, roomId, playerId` | HP/score — зеркало серверной правды для HUD |
| `combatSlice` | B(inbox) | `projectiles, damageNumbers` + add/remove | спавн-inbox'ы, дренируются рендером |
| `cosmeticSlice` | B(inbox) | `debris, lastDeathFx` + addDebris | **вся voxel-математика уезжает в `game/voxel.ts`** |
| `netSlice` | A(struct) | `remotePlayers` + update/remove | покадровые позы уже лерпятся в `RemotePlayers.tsx`, стор держит цель |
| `worldSlice` | A(struct) | `creatureIds, squads/minionIds, train{pilotId}, resources, mySquadCount, ragdollInbox` | растёт по 05/07/08/10; **только структура, не позы** |
| `enemySlice` | A→ | `enemies[]` + spawn/damage/remove | временно клиентский; при переезде врагов на сервер сливается в worldSlice |

**`damageEnemy` разбираем на композицию** (сейчас 5 дел в одном `set`). Целевой вид — оркестратор, дёргающий чистые функции:

```ts
// enemySlice.damageEnemy → тонкий: применяет урон, а «последствия смерти» делегирует
damageEnemy: (id, amount, pos) => {
  const dead = applyDamage(get, set, id, amount);   // возвращает погибших
  if (pos) get().addDamageNumber(pos, amount);       // combatSlice
  for (const e of dead) {
    get().addDebris(makeChunks(e, pos ?? e.position)); // cosmeticSlice + game/voxel.ts
    get().pulseDeathFx(e);                             // cosmeticSlice
    // будущее: get().dropResources(e) (08), get().killCreature(e) (10) — ДОБАВЛЯЮТСЯ здесь, каждая в СВОЙ слайс
  }
  get().addScore(dead.length * 10);                    // playerSlice
}
```

Теперь инкр.08/10 добавляют свой эффект смерти в **свой** слайс + одну строку в оркестратор, а не раздувают монолитный `set`.

### 4.2 Вынести бизнес-логику из стора

- `makeChunks`, `colorForEnemy`, `SHAPES`, `NEON`, `DEBRIS_CAP`, кванты → `game/voxel.ts` (чистые функции, как `movement.ts`). Стор их вызывает, но не содержит.
- Магические weapon-конфиги из `Player.tsx` (`WEAPON_CONFIG`) → `config/weapons.ts`.

### 4.3 Разбор `Player.tsx` на system-хуки (контур C)

Каждый концерн текущего useFrame → отдельный **чистый хук**, возвращающий `step(ctx, dt)`-функцию. Игрок держит **общий mutable-контекст** (ref) и вызывает шаги в явном порядке. Zero-alloc сохраняется: все scratch-векторы — модуль-скоуп внутри своего хука (как сейчас в Player).

```ts
// systems/types.ts
interface PlayerCtx {
  body: RapierRigidBody; camera: THREE.Camera; scene: THREE.Scene;
  input: InputSnapshot;                 // ref-снимок (см. useInput)
  grounded: boolean; onJumpPad: boolean; jumpForce: number;
  vel: THREE.Vector3; newY: number;     // движковые аккумуляторы кадра
  // + refs для weapon/jet/grapple состояния
}
```

```ts
// Player.tsx — ТОНКИЙ: композиция + порядок
const ctx = usePlayerCtx();
const stepInput   = useInput(ctx);
const stepGround  = useGroundProbe(ctx);     // grounded/jumppad raycast (из Player.tsx:170-190)
const stepMove    = usePlayerMovement(ctx);  // bhop/coyote/buffer/air-strafe (Player.tsx:205-268)
const stepJet     = useJetpack(ctx);         // тяга/топливо/стан (Player.tsx:194-259)
const stepGrapple = useGrapple(ctx);         // reel + rope (Player.tsx:271-321)
const stepWeapons = useWeapons(ctx);         // shoot/hitscan/projectile/recoil/muzzle/laser (Player.tsx:326-475)
const stepCamera  = useCameraRig(ctx);       // eye/third-person + shake + recoil offset (Player.tsx:130-158)
const stepNetSync = useNetSync(ctx);         // throttled emit('update') (Player.tsx:492-504)

useFrame((_, dt) => {
  if (!ctx.active()) return;
  stepInput(dt); stepGround(dt); stepJet(dt); stepMove(dt); stepGrapple(dt);
  ctx.body.setLinvel(ctx.vel /*+newY*/, true);   // единственная точка записи скорости
  stepCamera(dt); stepWeapons(dt); stepNetSync(dt);
}, FRAME.PLAYER);
```

Выигрыш: инкр.07 добавляет `useTrainRide(ctx)` как **ещё один шаг** (ride-ветка вместо move — переключается флагом `ctx.rideMode`, не хирургией внутри 380-строчной функции); инкр.08 радиал живёт в `game/radial.ts` и лишь `stepWeapons` спрашивает `isRadialOpen()` для подавления стрельбы. Каждый хук тестируем и переиспользуем (напр. `useNetSync`-throttle годится и для train_input).

### 4.4 Явный порядок tick (FRAME priority)

Проблема неявного порядка (§1.2, инкр.07 §5.5) решается таблицей приоритетов `useFrame(cb, priority)` — R3F гарантирует порядок по priority:

```ts
// systems/useFrameOrder.ts
export const FRAME = {
  WORLD_INTERP: -30,  // net/worldBuffer → Train/Creatures/Squads пишут интерп-корни ПЕРВЫМИ
  TRAIN:        -20,  // вагоны обновляют _wagonWorld (Player читает ниже)
  PLAYER:         0,  // локальный игрок (движение/камера/оружие)
  COSMETIC:      10,  // debris/ragdoll stepRig (после игрока/мира)
  UI_SAMPLE:     20,  // редкие throttled DOM-выборки
};
```

Это делает «кто раньше кого» **явным и стабильным**, не зависящим от порядка маунта. Один из самых дешёвых и высоко-окупаемых шагов.

---

## 5. Паттерн «мировой сущности» (переиспользуемый для train/creatures/minions/ragdoll)

Обобщаем `WorldEntities.tsx` в один канонический паттерн. Каждая NET-сущность (контур A) рендерится так:

```
1. СТРУКТУРА (реактивно, редко): список id из world_event/snapshot-структуры живёт в worldSlice.
   React монтирует/размонтирует контейнер по id (creatureIds, minionIds, train.present).
2. ПОЗЫ (императивно, каждый кадр): useFrame(priority = FRAME.WORLD_INTERP) читает sampleWorld()
   → пишет интерполированный root в ref-меш (mesh.position/rotation). НОЛЬ аллокаций, НОЛЬ zustand.
3. КОСМЕТИКА (локально, контур B): поверх интерп-корня локально считается «мясо» —
   наклон вагона / суставы рэгдолла (pinRootTo) / walk-bob миньона / PD-мышцы GA-походки.
   Никогда не синкается. Разные клиенты чуть разные — ОК.
```

Канонический скелет модуля (то, что копирует train/creatures/squads):

```tsx
// components/<System>.tsx — паттерн
export function System() {
  const ids = useStore(s => s.<system>Ids);            // (1) структура, реактивно
  const refs = useRef(new Map<string, THREE.Object3D>());
  useFrame(() => {                                      // (2)+(3) позы+косметика, императивно
    const w = sampleWorld();
    for (const [id, view] of w.<system>) {
      const mesh = refs.current.get(id); if (!mesh) continue;
      mesh.position.set(view.x, view.y, view.z);
      mesh.rotation.y = view.yaw;
      stepCosmetic(mesh, view, dt);                    // локальная косметика системы
    }
  }, FRAME.WORLD_INTERP);
  return <>{ids.map(id => <EntityMesh key={id} id={id} bind={refs} />)}</>;
}
```

**Инвариант паттерна (закон хребта, из инкр.05):** покадровые позы NET-сущностей идут `socket → worldBuffer → sampleWorld() → ref-меш`, **никогда** через реактивный zustand и **никогда** с `new` в useFrame. Это ровно дисциплина, что уже держит 60fps в `Player.tsx`/`Debris.tsx`/`worldBuffer.ts`.

Косметика (контур B) переиспользует **spawn-inbox Debris**: `ragdollInbox` (инкр.10) — тот же паттерн, что `debris`. Новая косметическая система = новый inbox + локальный пул + own-sim, не трогая чужое.

Итог: **train, creatures, squads, ragdoll — это четыре копии одного паттерна**, различающиеся только `stepCosmetic`. «Добавить систему» = добавить `worldSlice.<x>Ids` + `<X>.tsx` по скелету + серверный вклад в снапшот. Ни один god-файл не трогается.

---

## 6. Сеть для прода: границы, версии, где валидация

Хребет (`worldBuffer.ts` + серверный tick) уже правильный. Достраиваем то, что защищает от «въебались на проде».

### 6.1 Клиент/сервер модульная граница
- **Сервер (`server.ts`) — единственный авторитет** над: HP/death/score игроков (есть), root/state/hp тварей, `train.t/speed/pilot`, миньоны/ресурсы, урон от поезда. Клиент их НЕ вычисляет — интерполирует.
- **Клиент — авторитет только над собой** (позиция локального игрока через `emit('update')`) + intent-ы. Это уже так; фиксируем как правило.
- **Разнести протокол в общий модуль.** Формы сообщений и квантование дублируются на сервере (`buildSnapshot`) и клиенте (`worldBuffer.decode`). Вынести в `net/protocol.ts` (импортится обеими сторонами) — один источник формата, деквант не разъедется с квантом. Сейчас `q=×100`, `qa=×1000`, `train ×1e4` заданы дважды в двух файлах — это будущий рассинхрон.

### 6.2 Версионирование и конвенции сообщений
- **Каналы:** непрерывное (позы) → `world_snapshot` (можно терять, интерполяция скроет); дискретное (родился/умер/подобрал) → `world_event` (важен факт). Этот водораздел уже узаконен инкр.05 — держать его для ВСЕХ новых систем.
- **`PROTOCOL_VERSION`** в `net/protocol.ts`; клиент шлёт при `join`, сервер сверяет и на mismatch шлёт `world_reject{reason}` (клиент показывает «обнови страницу»). Дёшево, спасает от «старая вкладка на новом сервере» на проде.
- **Снапшот — массивы кортежей, не объекты** (уже так) + `seq` монотонный + дроп `seq <= lastSeq` (уже так в `worldBuffer`). Full-снапшоты до ~40 сущностей; delta — потом, одним слоем над теми же массивами (инкр.05 §4.3).
- **Именование:** `<domain>_<verb>` (`train_input`, `minion_command`, `creature_genome`, `world_snapshot`). Intent'ы C→S императивны (`spawn_minion`), broadcast S→C — факты (`world_event`).

### 6.3 Где живут валидация и анти-чит
- **Урон/HP/смерть/score — только сервер** (есть для игроков; расширяется на тварей/миньонов). Клиент рисует урон как предсказание, сервер подтверждает `player_hit`. Никогда не доверять клиентскому HP.
- **Лимиты/клампы на сервере** (инкр.05 §6): `MAX_CREATURES=40, MAX_MINIONS_PER_OWNER=8, MAX_MINIONS_TOTAL=16, MAX_SNAPSHOT_ENTITIES=64`. Спавн выше — тихий игнор. Это защита и от перфа, и от абьюза.
- **Intent-валидация на сервере:** `train_input` применяется только если `socket.id === pilotId`; `spawn_minion` — только при `resources ≥ cost && squad < cap` (списание НА СЕРВЕРЕ, не доверять клиентскому зеркалу). `minion_command` — только по своим (`owner === socket.id`).
- **Известный долг (пометить явно):** `socket.on('hit')` сейчас доверяет клиенту (`targetId/damage`) — как и будущий `claim_shards` (инкр.08). Это осознанный временный долг до серверных врагов; **закрывается**, когда враги/попадания станут серверными. Держим в одном месте (`net/handlers.ts`) с комментарием-меткой `// TRUST-CLIENT DEBT`, чтобы не забыть.
- **Rate-limit intent'ов** на сервере (throttle по socket.id) — дешёвая страховка от спама `spawn_minion`/`train_input`. Один хелпер в `net/handlers.ts`.

### 6.4 Немедленный net-баг к починке
`socket.ts:59-60` мутирует `useStore.getState().score = ...` напрямую → подписчики не обновятся. Заменить на `useStore.getState().setScore(data.score)` (playerSlice). Это контур-D баг, ловится глазами, чинится в первом же шаге.

---

## 7. Безопасный инкрементальный план миграции

Правила: каждый шаг **самостоятельно отгружаем**, `npx tsc --noEmit` зелёный, игра играется, ErrorBoundary на месте. Порядок — от разъединяющих-дешёвых к структурным. **Шаги R0–R6 сделать ДО постройки поезда/тварей** (иначе долг компаундится на каждой системе); R7+ — ленивые/по случаю.

### Фаза «фундамент» — ДО инкрементов 06+

**R0 — net-баг + прямые мутации (полчаса, чистая победа).**
Починить `socket.ts` прямую мутацию `score` → сеттер. Grep на `getState().<field> =` — убрать все прямые присваивания. Ноль структурных изменений, только корректность. *Проверка: score обновляется у обоих игроков.*

**R1 — вынести бизнес-логику из стора (`game/voxel.ts`).**
Переместить `makeChunks/colorForEnemy/SHAPES/NEON/DEBRIS_CAP` в `game/voxel.ts`, стор импортирует. Чистый вырез, поведение идентично. *Проверка: воксель-берст на киллах как раньше; `tsc` зелёный.*

**R2 — `hitTags.ts` (типизированный userData + `findTag`).**
Ввести `tag()`/`findTag()`; заменить `userData={{...}}` и parent-обходы в `Player.tsx`/`Enemies.tsx`/`RemotePlayers.tsx`/`Arena.tsx`. Один типизированный контракт до того, как train/creatures добавят свои хитбоксы. *Проверка: стрельба/grounded/grapple работают.*

**R3 — `net/protocol.ts` + тонкий `socket.ts`/`net/handlers.ts`.**
Вынести квантование и формы снапшота в общий `protocol.ts` (импорт сервером и `worldBuffer`). Разнести `socket.ts` на `socket.ts` (create/connect) + `handlers.ts` (все `on(...)`). Пометить `// TRUST-CLIENT DEBT`. Зафиксировать `PROTOCOL_VERSION` + reject. *Проверка: dummy-октаэдр (MVP инкр.05) по-прежнему летает синхронно на 2 вкладках.*

**R4 — слайсы стора (`store/`).**
Разбить `store.ts` на слайсы §4.1 через combine. Публичный API `useStore(s=>s.x)` НЕ меняется → компоненты не трогаем. Разложить поля по контурам, чтобы границы стали видимы. *Проверка: полный прогон игры; `tsc` зелёный (тип `GameState` = пересечение слайсов).*

**R5 — `game/eventBus.ts` (обобщить `fx.ts`) + `systems/useInput.ts` (ввод в ref).**
Обобщить hitmarker-шину в типизированный `eventBus` (готово для радиала инкр.08). Перевести `useKeyboard` на ref-снимок (`InputSnapshot`) вместо `useState` — убирает ре-рендер Player на каждую клавишу. *Проверка: управление идентично, в React DevTools Player не ре-рендерится на WASD.*

**R6 — разбор `Player.tsx` на system-хуки (§4.3) + FRAME-priority (§4.4).**
Самый крупный шаг — делать по одному хуку за подшаг, каждый подшаг `tsc`-зелёный:
- R6a: вынести `useCameraRig` (камера+shake+recoil).
- R6b: `useGroundProbe` + `usePlayerMovement` (bhop/air-strafe).
- R6c: `useJetpack`.
- R6d: `useGrapple`.
- R6e: `useWeapons` (shoot/hitscan/projectile/muzzle/laser).
- R6f: `useNetSync`; ввести `FRAME.*` priority.
После каждого подшага игра играется. По завершении `Player.tsx` — тонкая композиция. *Проверка после каждого: движение/стрельба/джетпак/крюк идентичны; 60fps, ноль GC-пилы.*

> **Почему R0–R6 ПЕРЕД поездом/тварями:** инкр.07 хочет ride-ветку в игроке (нужен R6 — иначе она влезет в 380-строчный useFrame), явный FRAME-priority (R6f), config/train.ts (структура R-фазы), typed wagon-хитбоксы (R2), protocol-блок train (R3). Инкр.08 хочет eventBus (R5), worldSlice (R4), radial вне игрока (R6). Построить их ДО рефакторинга = вшить god-паттерн ещё глубже.

### Фаза «по случаю» — можно лениво/во время инкрементов

**R7 — обобщить `WorldEntities.tsx` в паттерн §5.** Делается естественно при постройке первой реальной NET-сущности (Train инкр.07): выносим скелет `EntityMesh`/`refs`-map, `WorldEntities` становится первым его инстансом. Не отдельный шаг — часть инкр.07.

**R8 — вынести `gameOver`-на-pointerlock в явную «паузу vs смерть».** Сделать при первом UI, которому нужен lock-exit (меню/радиал уже НЕ снимает lock, так что не срочно). Разделить `pointerlockchange` → `pause()` (не `gameOver()`), смерть — по HP. Закрывает мину §1.3.

**R9 — `config/*.ts` для чисел.** Заводится по мере инкрементов (train.ts, minions.ts, ragdoll.tuning.ts уже прописаны в спеках). Не ретро-фит, а «новые числа сразу в config».

**R10 — delta-снапшоты / квантование позиций.** Только когда сущностей > ~40 (инкр.05 §4.3). Преждевременно не оптимизировать — full до 40 комфортен.

**R11 — spatial index вместо `scene.children` full-raycast.** Когда карта станет большой мульти-левел. До тех пор `intersectObjects` терпимо.

### Диаграмма зависимостей шагов
```
R0 ─┐
R1 ─┼─► (независимы, любой порядок)
R2 ─┘
R3 ──► (protocol перед train/creature net-работой)
R4 ──► R6 (слайсы удобнее до разбора игрока, но не блокер)
R5 ──► R6 (input-ref до system-хуков)
R6 ──► инкр.07/08 (ride-ветка/радиал садятся на хуки)
R7  = часть инкр.07 ;  R8/R9/R10/R11 = по случаю
```

---

## 8. Конвенции (как добавлять фичи дальше)

### 8.1 Незыблемые правила горячего цикла
- **Ноль аллокаций в `useFrame`.** Все `THREE.*` scratch — модуль-скоуп (`const _v = new THREE.Vector3()`), `.set()` перед использованием. Никакого `new`/`.clone()`/array-literal/`.map()` в кадре. (Единственное известное нарушение — `_tan.clone().negate()` в будущем Train §1.2 — вынести в предсозданный `_fwdNeg`.)
- **Нет per-frame записи в реактивный zustand.** Покадровое → ref/локальный пул/`getState()`-чтение. Запись в стор — только на дискретные события (спавн/смерть/подбор) или throttled (jetpack-fuel ~12Гц, netsync ~20Гц). NET-позы — только через `worldBuffer`, мимо стора.
- **`dt = Math.min(dtRaw, 1/30)`** в любой интеграции (debris/ragdoll/локомоция) — защита от «взрыва» на лаг-спайке.
- **Input читается из ref-снимка**, не из React-state.

### 8.2 Границы контуров (§2) — при добавлении любого состояния спроси
1. Это **синкается** (сервер = правда)? → контур A: живёт в `net/` (позы) + `worldSlice` (структура). Никогда покадрово в zustand.
2. Это **чистая косметика**? → контур B: spawn-inbox + локальный пул + own-sim. Никогда в сеть.
3. Это **симуляция локального игрока**? → контур C: system-хук в `systems/`, шлёт intent-ы.
4. Это **HUD/меню**? → контур D: селектор стора; покадровое — DOM/шина, не setState.

Если поле не ложится однозначно в один контур — это сигнал, что оно смешивает концерны (как сегодня `localMinions`), разделить.

### 8.3 Чеклист «новая система» (напр. следующая после поезда)
- [ ] Числа → `config/<system>.ts` (не хардкод в компоненте).
- [ ] Чистая логика → `game/<system>.ts` (без React, зеркало `movement.ts`).
- [ ] NET-вклад → форма в `net/protocol.ts` (обе стороны), сервер = авторитет, клиент интерполирует через `worldBuffer`.
- [ ] Рендер → `components/<System>.tsx` по паттерну §5 (структура реактивно, позы императивно, косметика локально).
- [ ] Структура состояния → **свой** слайс/поля в `worldSlice`, не в чужой god-объект.
- [ ] Ввод/intent → system-хук или `game/<system>.ts`-листенеры, не раздувать `Player.tsx` useFrame.
- [ ] Порядок кадра → назначить `FRAME.*` priority, если читает/пишет общий ref (как `_wagonWorld`).
- [ ] Валидация урона/лимитов → на сервере; клиентское — предсказание.
- [ ] Ноль аллокаций/ноль per-frame стора соблюдены.

### 8.4 Гейты качества
- **`npx tsc --noEmit` зелёный после каждого шага/подшага** — это первичный safety net (нет тестов рендера).
- **ErrorBoundary** остаётся обёрткой сцены — регресс не белоэкранит всё.
- **Perf-проба:** Performance-запись без «пилы» heap в `useFrame`; `world_snapshot` ~20/с в Network; `clockOffset`/`buffer.length` стабильны (рецепт верификации инкр.05 §12).
- **2-вкладочный net-smoke** после любого касания сети (R0/R3 и все NET-системы): две вкладки в одну комнату, сущности синхронны, закрытие одной не роняет другую (авторитетность), throttle Slow-3G сглаживает а не телепортирует.
- **Юнит-тесты — только на чистые модули** (`game/voxel.ts`, будущие `game/ga.ts` операторы, `movement.ts` accelerate/friction). Рендер/сеть не юнит-тестим — дорого и хрупко; их держит `tsc` + плейтест владельца.

---

## 9. Итог для владельца

Проблема не в том, что код «плохой» — движение, дебрис, net-хребет сделаны с правильной дисциплиной (zero-alloc, spawn-inbox, интерполяция мимо React). Проблема в том, что **два файла собрали в себя слишком много концернов** (`store.ts` — всё состояние + физику дебриса; `Player.tsx` — весь игрок в одном useFrame), и **границы «что синкается / что локально» не видны в структуре**. Пока систем 5 — терпимо; на 10 сетевых системах это даст именно те баги, которых ты боишься на проде.

Лечение — не переписывание, а **разложить существующее по 4 контурам правды** (A сеть / B косметика / C локальный игрок / D UI), порезать два god-объекта на слайсы и system-хуки, и **зафиксировать один паттерн «мировой сущности»**, чтобы поезд/твари/миньоны/рэгдолл добавлялись как «новый модуль», а не «правка god-файла». План §7 идёт маленькими `tsc`-зелёными шагами, игра играется после каждого. Ключ: **сделать R0–R6 до поезда/тварей** — тогда каждая новая система садится на чистый фундамент, а не углубляет долг. Дисциплина, которая уже держит 60fps, становится законом, записанным в §8, — и её нельзя случайно нарушить в следующей фиче.
