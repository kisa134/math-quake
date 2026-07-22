# 08 — Minions: Craft & Radial Command

> Крафти своих миньонов по кнопке (собрал ресурсы → нажал → бот появился) и командуй растущим отрядом через **радиальное командное меню** (зажал Q → кольцо действий → увёл мышь в сектор → отпустил → команда ушла). Референсы: **StarCraft II / Warcraft III** (control-groups, attack-move, hold-position, «juicy» отклик юнита на приказ), **Brütal Legend / Pikmin** (командование отрядом от первого лица, «go-here»/«gather»), **радиал-меню GTA V / RDR2 / Dota HUD** (сектор по углу мыши, снап, мгновенный выбор), **They Are Billions** (дешёвый boids-стиеринг сотни юнитов без pathfinding).
>
> **ЖЁСТКОЕ ОГРАНИЧЕНИЕ (сеть-first, из 00-README):** это онлайн-игра, сервер авторитетен. Миньоны — **серверные сущности отряда**, их AI/стиеринг крутится на серверном тике, клиенты только **интерполируют** снапшот и рисуют. Клиент шлёт **интенты** (`spawn_minion`, `minion_command`), сервер валидирует (ресурсы, кап) и решает. Никакого замедления времени; вся клиентская часть — косметика (боб, вспышка, подсветка сектора).

---

## 0. Что уже есть в коде (точка привязки)

Всё ниже — реальные факты из репозитория, чтобы спека села на существующее.

**`src/components/Minions.tsx` — локальная симуляция (заменяем):**
- `LocalMinions` держит **ровно 3** `RigidBody colliders="cuboid"` (Minions.tsx:11-14, `startOffsets`).
- Каждый кадр (`useFrame`, :16-51) тянет их импульсом к `commandTarget + startOffset` если дистанция > 1.5, демпфирует `linvel *= 0.9`, и **пишет позиции в стор**: `useStore.setState({ localMinions: minionData })` (:50) — прямо внутри `useFrame` (аллокации `new THREE.Vector3` на юнита каждый кадр, :27-32 — грязно).
- `RemotePlayerMinions` (:74-91) рисует чужой отряд как синие боксы из массива `{x,y,z}[]`.

**`src/components/Player.tsx` — текущая «команда» = зажать F:**
```ts
// Player.tsx:372-379 — Command Target (Minions)
if (keys.command && now - lastSyncTime.current > 300) {
  raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
  const intersects = raycaster.current.intersectObjects(scene.children, true);
  if (intersects.length > 0) {
    useStore.getState().setCommandTarget([intersects[0].point.x, intersects[0].point.y, intersects[0].point.z]);
  }
}
```
- Синк игрока шлёт весь отряд: `socket.emit("update", { ..., minions: useStore.getState().localMinions })` (Player.tsx:390-398) — раз в 50мс.

**⚠️ Критичный гейт pointer-lock (Player.tsx:88-99):**
```ts
const handlePointerLockChange = () => {
  if (!document.pointerLockElement && isPlaying) {
    gameOver();               // ← ЛЮБОЙ выход из lock = КОНЕЦ ИГРЫ
  }
};
```
> **Из этого следует главный дизайн-констрейнт радиал-меню:** мы **НЕ имеем права** звать `document.exitPointerLock()` / показывать системный курсор — это мгновенно завершит матч. Радиал обязан работать **внутри** активного pointer-lock, читая `mousemove.movementX/movementY` (они продолжают приходить в залоченном состоянии) и рисуя **виртуальный** селектор. См. §4.

**`src/hooks/useKeyboard.ts`:** плоский стейт-объект клавиш; `command` замаплен на `KeyF` (:22, :33). Мышь LMB → `shoot` (:37-42). Паттерн: `keydown`/`keyup` → `setKeys`. **Расширяем** этим же паттерном (`craft`=KeyB, `radial`=KeyQ).

**`src/store.ts`:** `commandTarget: [x,y,z]|null` (:80), `localMinions: {x,y,z}[]` (:81), `PlayerState.minions?` (:64). `damageEnemy` (:207-254) — **тут死ают враги** (`deadEnemies`, `scoreGain`, :227-245); это единственный хук «враг умер» на клиенте. `startGame`/`reset` чистят `localMinions` (:305-307).

**`server.ts`:** комнаты `rooms[roomId] = { players, enemies }` (:19-22), **событийная модель без тика** — `join`/`update`/`shoot`/`hit`/`disconnect` (:27-109). Врагов сервер сейчас не симулирует (клиент-сайд `spawnEnemy`). **Тика-цикла и `world_snapshot` пока НЕТ** — это бэкбон инкремента 05 (см. §1, зависимость).

**`src/socket.ts`:** `init`/`player_joined`/`player_updated`/`player_shot`/`player_hit`/`player_died`/`score_updated`/`player_left` (:15-66). Расширяем набором минион-сообщений.

**`src/game/fx.ts`:** крошечная событийная шина 3D→DOM (`onHitmarker`/`fireHitmarker`, :10-17). `UI.tsx` `Hitmarker` (:166-199) подписывается на неё. **Переиспользуем этот же паттерн** для открытия/закрытия/выбора радиала (шина `radial`), чтобы не гонять zustand каждый кадр.

**Что делаем в 08 (сводка):**
| Система | Сейчас | Файл | Инкремент 08 |
|---|---|---|---|
| Кол-во миньонов | фикс. 3 | Minions.tsx:11 | крафт по кнопке, растущий отряд до капа |
| Где живёт AI | клиент (`useFrame` импульсы) | Minions.tsx:16 | **серверный тик** (авторитет), клиент интерполирует |
| Команда | зажать F → raycast → одна точка `commandTarget` | Player.tsx:372 | **радиал Q** (Follow/Attack/Hold/Go-here/Gather) |
| Ресурсы | нет | — | `resources` в сторе, дроп с киллов, HUD-ридаут |
| Крафт | нет | — | B → `spawn_minion` интент → сервер валидирует |
| Рендер отряда | боксы по `{x,y,z}[]` | Minions.tsx:78 | InstancedMesh, интерполяция из снапшота, все отряды |

---

## 1. Сетевая модель — где живёт симуляция (бэкбон 05)

### Принцип
Сегодня отряд симулируется **локально** у каждого клиента (Minions.tsx `useFrame`) и позиции просто рассылаются в `update`. Это ок для «моих трёх коробок рядом», но ломается для геймплея: два клиента увидят разные позиции, «attack target» недетерминирован, чужой отряд не может бить тебя честно. **Переносим симуляцию на сервер.**

### Контракт (садимся на бэкбон инкремента 05 — авторитетный тик + `world_snapshot`)
Инкремент 05 вводит серверный фикс-тик (реком. **20 Гц**, `dt = 50мс`) и широковещание `world_snapshot`. Инкремент 08 **добавляет в этот снапшот массив миньонов** и обрабатывает два интента. Если 05 к моменту реализации ещё не готов — 08 приносит **минимальный тик-цикл только для миньонов** (см. код ниже), совместимый по форме с будущим общим снапшотом.

**Серверная сущность миньона (авторитет):**
```ts
// server.ts — внутри rooms[roomId]
interface Minion {
  id: string;
  owner: string;             // socket.id владельца
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  hp: number; maxHp: number;
  state: 'follow' | 'attack' | 'hold' | 'goto' | 'gather';
  targetId: string | null;      // для attack (enemy/player id) / gather (resource node id)
  tx: number; ty: number; tz: number;  // точка-цель для goto/hold-anchor/gather-fallback
  slot: number;                 // индекс в формации (для follow/hold-оффсета)
  tier: number;                 // 0 базовый (вариации — §3)
  fireCd: number;               // мс до следующего выстрела (attack-стейт)
  bornAt: number;
}
// rooms[roomId].minions: Record<string, Minion>
// rooms[roomId].resourceNodes?: Record<string, ResourceNode>  (§2, опц.)
```

**Интенты (клиент → сервер):**
```ts
// spawn_minion — «скрафтить». Без параметров позиции: сервер сам ставит у владельца.
socket.emit('spawn_minion');                     // сервер: проверить resources ≥ cost & squad < cap → списать → создать

// minion_command — команда выделенным миньонам владельца.
socket.emit('minion_command', {
  cmd: 'follow' | 'attack' | 'hold' | 'goto' | 'gather',
  point?: [number, number, number],   // для goto / hold-anchor / gather-fallback (raycast под прицелом)
  targetId?: string | null,           // для attack (id врага/игрока под прицелом) / gather (нода)
  // ids?: string[]                    // LATER: субвыделение; MVP — команда идёт ВСЕМ миньонам владельца
});
```

**Снапшот (сервер → клиенты, каждый тик):**
```ts
// расширение world_snapshot (или отдельный minions_snapshot до готовности 05)
io.to(roomId).emit('world_snapshot', {
  t: serverNow,
  minions: [                              // ВЕСЬ отряд комнаты (все владельцы) — плоский массив
    { id, owner, x, y, z, state, hp, maxHp, tier }   // vx/vz НЕ шлём (интерполяция по позициям)
  ],
  resources: { [ownerId]: number },       // авторитетный баланс каждого игрока
  nodes?: [ { id, x, y, z, amount } ],     // ресурс-ноды (§2, опц.)
});
```
> **Почему плоский массив, а не `players[id].minions`:** отряды разных игроков рендерятся одним InstancedMesh с окраской по `owner === myId` (свой/чужой). Плоский список = один проход, ноль вложенной сборки. Замена сегодняшнего `minions` внутри `update` (Player.tsx:397) — **больше не шлём отряд в `update`**, он приходит из снапшота.

### Минимальный серверный тик (если 05 ещё не готов — приносим в 08)
```ts
// server.ts — один интервал на процесс, проходит все комнаты
const TICK_HZ = 20, TICK_MS = 1000 / TICK_HZ;
setInterval(() => {
  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    stepMinions(room, TICK_MS / 1000, now);   // §5 — стиеринг + бой + сепарация
    io.to(roomId).emit('world_snapshot', buildSnapshot(room, now));
  }
}, TICK_MS);
```
> Один `setInterval` на весь процесс (не на комнату) — дёшево. `stepMinions` — чистая арифметика векторов, ноль аллокаций (переиспользуемые scratch-переменные в модуль-скоупе, как `_wishDir` в Player.tsx). Cost-анализ — §7.

### Клиентская интерполяция
Клиент держит **буфер из 2 последних снапшотов** и рендерит миньонов с задержкой `interpDelay ≈ 100мс` (2 тика), `lerp` позиции между снапшотами по времени. Это стандартный «snapshot interpolation» — плавно на 20 Гц, устойчиво к джиттеру. Косметика (боб вверх-вниз, поворот «лицом по скорости», вспышка выстрела) считается **локально** поверх интерполированной позиции. Детали — §6.

---

## 2. RESOURCES (ресурсы)

### Модель
Единый числовой ресурс — назовём **`shards`** (в тему мира: «осколки геометрии»/vector-flux). Авторитет — на сервере (`rooms[roomId].resources[ownerId]`), клиент держит **зеркало** для HUD (`store.resources`), обновляемое из снапшота. Крафт списывает **на сервере** (анти-десинк): клиент не может «налевачить» баланс.

### Как зарабатываются
1. **Дроп с киллов (MVP-источник).** Каждый убитый враг даёт осколки. Сегодня смерть врага считается в двух местах — надо оба свести к серверу для MP-честности, но для MVP-петли достаточно:
   - **Клиентский хук:** в `damageEnemy` (store.ts:227, где считается `deadEnemies`) — при `deadEnemies.length` эмитим серверу `emit('claim_shards', { n: deadEnemies.length * SHARDS_PER_KILL })` **или** (чище) сервер сам начисляет, когда враги станут серверными (05). Для 08-MVP: клиент шлёт факт killed-count, сервер начисляет и включает в снапшот. Значение: `SHARDS_PER_KILL = 3` (candle-босс `= 8`).
   - **Анти-чит-заметка:** пока враги клиент-сайд, `claim_shards` доверяет клиенту (как и сегодняшний `hit`). Когда враги переедут на сервер (будущий инкремент), начисление станет полностью серверным. Явный технический долг, помечаем.
2. **Пикапы-осколки (juicy-слой, опц. в MVP).** Убитый враг роняет **1-3 подбираемых осколка** — маленькие вращающиеся `octahedron`-меши в позиции смерти (переиспользуем death-fx/debris-путь). Игрок подбирает, **пробегая рядом** (радиус 2.0). Пикап — серверная сущность (чтобы не дублировался у двух игроков): сервер спавнит `resourceNodes` типа `drop`, при входе игрока в радиус — начисляет владельцу и удаляет ноду в снапшоте.
3. **Мировые ноды-жилы (LATER — «gather»-экономика).** Статичные `ResourceNode { id, x, z, amount }` на арене, которые миньоны в стейте `gather` фармят по чуть-чуть в тик и «несут» владельцу. Это раскрывает сектор Gather радиала. MVP: сектор есть, экономика нод — later (см. §5 gather + §8).

```ts
interface ResourceNode {
  id: string; x: number; y: number; z: number;
  amount: number;                 // осталось осколков
  kind: 'drop' | 'vein';          // drop = падение с килла (подбирает игрок), vein = жила (фармят миньоны)
}
```

### Стоимость крафта (масштабируемая)
```ts
// cost = базовая + шаг × (текущий размер отряда). Растёт → отряд не бесконечный без фарма.
const MINION_BASE_COST = 10;
const MINION_COST_STEP = 6;
function minionCost(currentSquadSize: number) {
  return MINION_BASE_COST + MINION_COST_STEP * currentSquadSize;   // 10,16,22,28,34,...
}
const SQUAD_CAP = 8;              // хардкап на владельца (перф + читаемость), §7
```
| Отряд сейчас | Цена след. миньона |
|---|---|
| 0 | 10 |
| 1 | 16 |
| 2 | 22 |
| 3 | 28 |
| … | +6 за каждого |

### HUD-ридаут
DOM-слой в `UI.tsx` (Tailwind, в тон существующему нижнему HUD, :77-114). Добавляем **счётчик осколков** и **готовность крафта** рядом с оружейным блоком:
```tsx
// UI.tsx — новый мини-блок в нижнем HUD (между Weapon и Score, или в углу оружия)
const resources = useStore(s => s.resources);
const squad     = useStore(s => s.mySquadCount);      // из снапшота
const cost      = MINION_BASE_COST + MINION_COST_STEP * squad;
const canCraft  = resources >= cost && squad < SQUAD_CAP;
// Рендер: «◈ {resources}» крупно + «[B] CRAFT · {cost}» подсветкой (emerald если canCraft, серым иначе)
//         + «SQUAD {squad}/{SQUAD_CAP}»
```
> Цвет/типографика — по существующей палитре (emerald `#10b981`, моно-цифры `tabular-nums`, как health/score). Осколок-иконка — юникод `◈` или мелкий inline-SVG-ромб (в тон rotate-45 прицелу). Когда `canCraft` — блок пульсирует лёгким glow (CSS), сообщая «можно крафтить».

---

## 3. CRAFT (крафт миньона)

### Поток
```
[B] нажат  →  клиент: если (mirror) resources ≥ cost && squad < cap  →  emit('spawn_minion')
                                                       ↓ (иначе — «клак»-звук отказа + красный флеш HUD, ничего не шлём)
СЕРВЕР on('spawn_minion'):
   const cost = minionCost(squadSizeOf(owner));
   if (resources[owner] < cost) return;              // авторитетная проверка (анти-десинк)
   if (squadSizeOf(owner) >= SQUAD_CAP) return;
   resources[owner] -= cost;
   создать Minion у владельца (позиция = за спиной игрока + slot-оффсет, state='follow')
   → попадёт в следующий world_snapshot → у ВСЕХ клиентов появится миньон
```
> Клиентская проверка перед `emit` — только чтобы не слать заведомо-мусорные интенты и дать мгновенный отказ-фидбек. **Истина — на сервере** (клиентское зеркало могло отстать от снапшота). Если клиент послал, а сервер отклонил (баланс изменился) — просто в следующем снапшоте миньон не появится и `resources` не изменится; клиентское зеркало само себя поправит. Никаких «оптимистичных» локальных миньонов — ждём снапшот (100-150мс, незаметно).

### Клавиша
`useKeyboard` — добавить `craft: boolean` на `KeyB` (edge-триггер: спавним на **нажатии**, не на удержании — иначе заспамит весь баланс за кадр). Реализация edge — в `Player.tsx` через `useEffect`-`keydown` (как `Digit1..4`/`KeyV`, Player.tsx:67-78), а не через per-frame `keys.craft`:
```ts
// Player.tsx handleKeyDown (рядом с weapon-switch):
if (e.code === 'KeyB') {
  const { resources, mySquadCount } = useStore.getState();
  const cost = MINION_BASE_COST + MINION_COST_STEP * mySquadCount;
  if (resources >= cost && mySquadCount < SQUAD_CAP) {
    socket.emit('spawn_minion');
    playCraftSound();                    // «синтез» — восходящий бип (audio.ts)
  } else {
    fireCraftDenied();                   // fx.ts → HUD красный тик + «клак»
  }
}
```

### Стейты/варианты миньона (tiers — опц.)
MVP — **один тип** (`tier: 0`): базовый «дрон-куб» (сегодняшний `#00f5d4` бокс). Стата:
```ts
const MINION_TIERS = [
  // tier 0 — Scout Drone (MVP)
  { hp: 40, speed: 6.0, dmg: 6, range: 14, fireCd: 500, color: '#00f5d4', size: 0.8 },
  // LATER tier 1 — Brawler (ближний, толще):
  { hp: 90, speed: 4.5, dmg: 14, range: 2.5, fireCd: 700, color: '#f72585', size: 1.0, melee: true },
  // LATER tier 2 — Sniper (дальний, хрупкий):
  { hp: 25, speed: 5.0, dmg: 30, range: 30, fireCd: 1400, color: '#ffd166', size: 0.7 },
];
```
> Тиры раскрываются позже: выбор тира при крафте — **дополнительный сектор в крафт-контексте** или модификатор (`Shift+B`). MVP крафтит только tier 0. Держим поле `tier` в сущности с самого начала, чтобы рендер/AI были готовы.

---

## 4. RADIAL COMMAND MENU (центр инкремента)

### Задача UX
Зажал **Q** → в центре экрана возникает кольцо из 5 секторов (Follow / Attack / Hold / Go-here / Gather). Двигаешь мышь → сектор под текущим «углом мыши» подсвечивается. Отпустил Q (или ЛКМ) → выбранная команда уходит выделенным миньонам. Должно ощущаться как RTS-радиал: **быстро, снапно, без возни с курсором**.

### ⚠️ Совместимость с PointerLockControls (ключевой инженерный момент)
Курсор **залочен** (PLC), а выход из lock = `gameOver()` (Player.tsx:88-99). Значит:
- **НЕЛЬЗЯ** `exitPointerLock()` / системный курсор / DOM-`onClick` по секторам.
- Реальной позиции курсора нет — она в центре и залочена.

**Решение — виртуальный угловой селектор из `movementX/Y`:** пока открыт радиал, слушаем `mousemove` и **аккумулируем** дельты в вектор `sel = {x, y}` (в px-подобных единицах), клампим по радиусу. Угол сектора = `atan2(sel.y, sel.x)`. Мышь двигается — PLC всё ещё крутит камеру (это ок, даже приятно: целишься камерой, пока выбираешь), но **выбор сектора** читается из накопленного вектора, а не из камеры. Радиус `|sel|` > deadzone (напр. 22px) — сектор «захвачен»; внутри deadzone — «нет выбора» (отпустишь = отмена).

```ts
// game/radial.ts — состояние + аккумулятор (модуль-скоуп, ноль React-ре-рендеров на mousemove)
const RADIAL = {
  open: false,
  sel: { x: 0, y: 0 },        // накопленная дельта мыши с момента открытия
  sector: -1,                  // текущий индекс сектора (-1 = deadzone/нет)
  radius: 0,                   // |sel|, клампится к RING_MAX
};
const RING_MAX = 90;           // px — насыщение вектора
const DEADZONE = 22;           // px — ближе к центру = нет выбора (отмена при отпускании)
const SECTORS = ['follow','attack','hold','goto','gather'] as const;   // 5 → сектор = 72°

function radialMouseMove(e: MouseEvent) {
  if (!RADIAL.open) return;
  const SENS = 0.6;                          // чувствительность селектора (тюним)
  RADIAL.sel.x += e.movementX * SENS;
  RADIAL.sel.y += e.movementY * SENS;
  // клампим к кольцу
  const r = Math.hypot(RADIAL.sel.x, RADIAL.sel.y);
  RADIAL.radius = Math.min(r, RING_MAX);
  if (r > RING_MAX) { RADIAL.sel.x *= RING_MAX / r; RADIAL.sel.y *= RING_MAX / r; }
  // угол → сектор (0° вверх, по часовой). screen-Y вниз → инвертируем.
  if (r < DEADZONE) { RADIAL.sector = -1; }
  else {
    let a = Math.atan2(RADIAL.sel.x, -RADIAL.sel.y);   // 0 = вверх
    if (a < 0) a += Math.PI * 2;
    RADIAL.sector = Math.floor((a + Math.PI / SECTORS.length) / (Math.PI * 2) * SECTORS.length) % SECTORS.length;
  }
  emitRadialUpdate(RADIAL.sector, RADIAL.sel);   // fx.ts-шина → DOM подсветка (см. ниже)
}
```

### Стейт-машина
```
        Q down (isPlaying)                    отпустил Q / ЛКМ (sector≥0)
IDLE ─────────────────────────► OPEN ─────────────────────────────────► ISSUE ─► IDLE
  ▲                              │  │                                              │
  │      отпустил Q в deadzone   │  │  двигает мышь → аккумулирует sel, sector     │
  └──────────  (CANCEL) ─────────┘  └──────────────────────────────────────────────┘
```
- **OPEN (Q down):** `RADIAL.open = true`; сбрасываем `sel={0,0}`, `sector=-1`; вешаем `mousemove` → `radialMouseMove`; **подавляем shoot** пока радиал открыт (иначе ЛКМ-подтверждение стрельнёт); шина `fx` шлёт `radialOpen` → DOM-оверлей появляется (fade-in 80мс).
- **ISSUE (Q up ИЛИ ЛКМ, при `sector ≥ 0`):** резолвим команду сектора (см. таблицу), делаем raycast под прицелом для target/point-команд, `socket.emit('minion_command', …)`; звук подтверждения; шина `radialClose('issued')`.
- **CANCEL (Q up при `sector < 0`):** ничего не шлём, шина `radialClose('cancel')`, тихий «свуш» отмены.
- Снимаем `mousemove`-листенер на закрытии.

### Тайминги (снап, RTS-taste)
| Момент | Значение |
|---|---|
| Появление оверлея (fade+scale-in) | 80 мс (ease-out, scale 0.85→1.0) |
| Реакция подсветки сектора | мгновенно (тот же кадр mousemove) |
| Deadzone радиус | 22 px аккум. |
| Кольцо насыщается (max) | 90 px аккум. |
| Закрытие (fade-out) | 60 мс |
| Мин. время открытия (анти-дребезг) | если Q отпущен < 40мс и `sel≈0` → трактуем как «tap Q» = быстрый **Follow** (частая команда без прицеливания) |
| Cooldown между командами | 120 мс (не спамить сервер) |

> **Tap-Q = Follow** (быстрый collect/heel одним нажатием) — RTS-мускульная память: чаще всего зовёшь отряд к себе. Полный радиал — для остальных 4 команд.

### Сектора → команды
5 секторов, по 72°, стартовый сектор (вверх) = самая частая:
| Сектор (угол) | Команда | Что делает | Как берётся цель |
|---|---|---|---|
| ↑ верх | **Follow** | миньоны в формации следуют за владельцем | цель не нужна |
| ↗ право-верх | **Attack** | атаковать сущность под прицелом | raycast под прицелом в момент ISSUE → первый `userData.isEnemy`/`isPlayer` (как хитскан Player.tsx:313-329) → `targetId` |
| ↘ право-низ | **Go-here** | идти в точку | raycast под прицелом → точка пола `intersects[0].point` (как текущий F, Player.tsx:374-377) |
| ↙ лево-низ | **Hold** | держать текущую позицию/формацию, не преследовать | якорь = текущая позиция каждого миньона (сервер фиксит на входе в стейт) |
| ↖ лево-верх | **Gather** | фармить ближайшую ноду / собирать дропы | raycast → если под прицелом нода, её `targetId`; иначе ближайшая нода к отряду (сервер решает) |

```ts
// Player.tsx — резолв в момент ISSUE (внутри обработчика Q-up / радиал-issue)
function issueRadial(sector: number) {
  const cmd = SECTORS[sector];
  const payload: any = { cmd };
  if (cmd === 'attack' || cmd === 'gather') {
    // raycast под прицелом (центр экрана), как в стрельбе
    raycaster.current.setFromCamera(_center, camera);
    const hits = raycaster.current.intersectObjects(scene.children, true);
    payload.targetId = pickTargetId(hits);       // walk parent chain → userData.id (isEnemy/isPlayer/isNode)
    if (hits[0]) payload.point = [hits[0].point.x, hits[0].point.y, hits[0].point.z]; // fallback-точка
  } else if (cmd === 'goto') {
    raycaster.current.setFromCamera(_center, camera);
    const hits = raycaster.current.intersectObjects(scene.children, true);
    if (hits[0]) payload.point = [hits[0].point.x, hits[0].point.y, hits[0].point.z];
    else return; // некуда — тихая отмена
  }
  // follow / hold — без цели
  socket.emit('minion_command', payload);
  playCommandSound(cmd);        // разный питч на команду (RTS «yes sir»-фидбек)
}
```

### DOM-оверлей (в `UI.tsx`, шина `fx`, БЕЗ pointer-events)
Рисуем радиал как **абсолютный оверлей поверх прицела** (тот же слой, что `Hitmarker`, UI.tsx:56). `pointer-events: none` — он не кликается мышью (её нет), только **показывает** состояние.
```tsx
// UI.tsx — компонент <RadialMenu/>, подписан на шину radial (game/radial.ts, паттерн onHitmarker)
// Состояние: open (bool), sector (number), sel ({x,y})
// Рендер:
//  - затемняющий винье-круг (radial-gradient, subtle) появляется на open
//  - 5 секторов кольца: SVG <path> pie-slices ИЛИ 5 позиционированных «капсул»-лейблов по кругу
//    активный сектор — emerald-заливка + scale 1.08 + текст ярче; неактивные — полупрозрачные
//  - иконка+лейбл каждого: FOLLOW / ATTACK / HOLD / GO HERE / GATHER
//  - виртуальный «джойстик-точка» на позиции (cx+sel.x, cy+sel.y) — показывает куда «увёл» игрок
//  - deadzone-кружок в центре: если sector<0 подсвечен → «отпусти = отмена»
// Всё через CSS-переменные/ref (не React-стейт на каждый mousemove — только на смену sector):
//   angle/sel пишем в style.setProperty из подписки, sector-смена → лёгкий setState (редко)
```
> **Ноль React-рендеров на mousemove:** позицию точки и активный сектор пишем прямыми DOM-мутациями (ref + `style.setProperty('--sel-x', …)` / toggle класса активного сектора), как bloom-прицел в 04 (§4.2). `setState` дёргаем **только** при смене индекса сектора (5 значений — редко), для смены подсветки/лейбла. Открытие/закрытие — по шине.

### Выделение (selection model)
**MVP: команда идёт ВСЕМ миньонам владельца.** Сервер в `minion_command` итерирует `minions` где `owner === socket.id` и применяет стейт всем. Просто, предсказуемо, удовлетворяюще для отряда ≤ 8.

**LATER — субвыделение:**
- **Control-groups** (цифры 5-9, чтобы не конфликтовать с оружием 1-4): назначить `Ctrl+5` = «этот сабсет», вызвать `5` = «команда только им».
- **Look-select:** миньон под прицелом при открытии радиала → команда только ему/ближайшим N.
- Тогда интент несёт `ids?: string[]`; сервер фильтрует по пересечению `owner` и `ids`.
Держим поле `ids?` в контракте с самого начала (§1), MVP его не шлёт.

### Клавиша
`useKeyboard` — добавить `radial: boolean` на `KeyQ` (нужен и down, и up — стейт-машина живёт на фронте кадра в Player.tsx или прямо в `game/radial.ts` через `keydown/keyup`-листенеры, как проще). **Рекомендую вынести весь радиал в `game/radial.ts`** с собственными `keydown('KeyQ')`/`keyup('KeyQ')`/`mousemove`/`mousedown`-листенерами (регистрируются при `isPlaying`), чтобы Player.tsx `useFrame` не раздувался. Player.tsx предоставляет `issueRadial` (нужен доступ к `camera`/`scene`/`raycaster`) через callback, переданный в `radial.ts`, или радиал эмитит `radialIssue(sector)` по шине, а Player подписан и делает raycast+emit.

> **Подавление стрельбы:** пока `RADIAL.open`, в `useKeyboard`/Player стрельбовый блок (Player.tsx:255) должен видеть «радиал открыт» и **не стрелять** (ЛКМ в это время = подтверждение). Проще: `game/radial.ts` экспортит `isRadialOpen()`; в Player.tsx `if (keys.shoot && !isRadialOpen() && …)`.

---

## 5. СЕРВЕРНЫЙ AI миньонов (на тике)

Простой, дешёвый, **без pathfinding** — прямой стиеринг (seek/arrive) + сепарация (boids). Один проход `stepMinions(room, dt, now)` за тик (§1). Ноль аллокаций — scratch-векторы в модуль-скоупе.

### Общий шаг на миньона
```
для каждого миньона m владельца o:
  1. desired = ноль
  2. switch (m.state):
       follow: desired = arrive(m, formationSlot(owner o, m.slot))       // точка в формации за игроком
       goto:   desired = arrive(m, (m.tx,m.tz)); если дошёл (<1.5) → state='hold', якорь=точка
       hold:   desired = arrive(m, (m.tx,m.tz))                          // держит якорь; §бой ниже всё равно стреляет по врагам в радиусе
       attack: t = lookup(m.targetId);
               если t мёртв/нет → state='follow';
               иначе desired = arrive(m, pointNear(t, engageRange)); + БОЙ (ниже)
       gather: n = lookup(m.targetId as node) ?? nearestNode(m);
               если n → desired = arrive(m, n); если дошёл → farmTick(n, o); если n пуст → nearestNode/при отсутствии → 'follow'
  3. sep = separation(m, соседи в радиусе 1.5)                           // расталкивание, чтоб не слипались
  4. steer = clamp(desired * W_SEEK + sep * W_SEP, maxForce)
  5. m.vx,m.vz += steer * dt; клампим |v| ≤ tier.speed; демпфер v *= 0.88
  6. m.x += vx*dt; m.z += vz*dt;  y — простой «приклей к полу»/гравитация (см. ниже)
  7. БОЙ: если есть враг в tier.range (attack-цель ИЛИ авто-таргет в hold/follow при агро) и m.fireCd≤0 →
          нанести урон / заспавнить серверный снаряд; m.fireCd = tier.fireCd
     m.fireCd -= dt*1000
```

### Стиеринг-примитивы (дёшево)
```ts
// arrive: seek с торможением у цели (без овершута) — Reynolds steering
function arrive(m, tx, tz, slow = 3.0) {
  let dx = tx - m.x, dz = tz - m.z;
  const d = Math.hypot(dx, dz) || 1;
  const speed = TIER(m).speed * Math.min(1, d / slow);   // тормозим внутри slow-радиуса
  return { x: (dx/d)*speed, z: (dz/d)*speed };           // желаемая скорость
}
// separation: сумма отталкиваний от соседей ближе SEP_R (только свои+чужие в комнате — дёшево, O(n²) при n≤~40)
function separation(m, all, SEP_R = 1.5) {
  let sx = 0, sz = 0;
  for (const o of all) {
    if (o === m) continue;
    const dx = m.x - o.x, dz = m.z - o.z;
    const d2 = dx*dx + dz*dz;
    if (d2 > 0 && d2 < SEP_R*SEP_R) { const d = Math.sqrt(d2); sx += dx/d/d; sz += dz/d/d; }
  }
  return { x: sx, z: sz };
}
```

### Формация (follow/hold-slot)
Дешёвая **сетка-клин** за спиной владельца: слот `k` → оффсет в локальных координатах игрока (позади и в стороны), повёрнутый на yaw игрока.
```ts
// слоты: колонны по 2, позади игрока. row = floor(k/2), col = k%2
function formationSlot(player, slot) {
  const row = Math.floor(slot / 2), col = slot % 2;
  const back = -2.5 - row * 1.8;                 // за спиной, ряды вглубь
  const side = (col === 0 ? -1.4 : 1.4);         // лево/право
  // повернуть (side, back) на yaw игрока → мировая точка возле player.x/z
  const yaw = player.rotation;
  return {
    x: player.x + side * Math.cos(yaw) - back * Math.sin(yaw),
    z: player.z + side * Math.sin(yaw) + back * Math.cos(yaw),
  };
}
```
> `slot` присваивается при спавне (порядковый), переиспользуется при follow/hold. Даёт узнаваемый строй, который поворачивается с игроком (StarCraft-подобно). Никакого pathfinding — если строй упёрся в стену, сепарация+arrive сами растолкают (арены открытые, ок для MVP).

### Бой миньона (attack + авто-агро)
- **Attack-стейт:** тянется к `pointNear(target, engageRange=range*0.8)`, и когда цель в `tier.range` и `fireCd≤0` — **серверный выстрел**. Для tier0 (range 14) — хитскан-урон по цели напрямую (`target.hp -= dmg`, переиспользуем серверный урон-путь как `hit`, server.ts:71-98) ИЛИ серверный снаряд (если хотим видимый болт — интеграция с projectile-системой). MVP: прямой урон + косметический «музл» на клиенте по флагу.
- **Авто-агро (follow/hold):** миньон в follow/hold, если враг заходит в `AGGRO_R=10` — **временно** стреляет по нему (не меняя state), возвращается к follow-точке. Даёт «отряд огрызается сам». Флаг `m.aggroId` (не путать с приказным `targetId`).
- **Урон по игроку (PvP):** если `targetId` — чужой игрок, миньон-выстрел идёт через тот же серверный урон-путь, что `hit` (server.ts:75), с `shooterId = owner`. Так чужой отряд честно бьёт тебя, и это авторитетно.

### Y / гравитация (дёшево)
Арена в основном плоская. MVP: `m.y` — простой пружина-к-полу: держим фикс. высоту (напр. `y = groundY + 0.4`), либо лёгкая гравитация + «пол на y=0» кламп. Без rapier на сервере (сервер не крутит физдвижок) — миньоны **не** физ-тела на сервере, это точки со стиерингом. Клиент рисует их над полом. (Если позже нужен рельеф — raycast-высота по карте высот арены; вне MVP.)

### Команда → стейт (маппинг)
| Интент `cmd` | Серверный эффект |
|---|---|
| `follow` | всем миньонам owner: `state='follow'`, `targetId=null` |
| `attack` | `state='attack'`, `targetId=payload.targetId` (если валиден); нет цели → `goto point` |
| `hold` | `state='hold'`, якорь `(tx,tz)=текущая позиция` каждого |
| `goto` | `state='goto'`, `(tx,tz)=payload.point` |
| `gather` | `state='gather'`, `targetId=node` или nearest; нет нод → `follow` |

---

## 6. Store / сообщения / рефактор `<Minions/>`

### Изменения стора (`src/store.ts`)
```ts
// новые поля
resources: number;                 // зеркало осколков владельца (из снапшота)
mySquadCount: number;              // сколько моих миньонов живо (из снапшота) — для HUD/cost
squads: MinionView[];              // ВЕСЬ отряд комнаты (интерп-рендер) — из снапшота
resourceNodes: NodeView[];         // ноды/дропы (опц.)
// commandTarget/localMinions — DEPRECATED (удаляем после переноса рендера; §7 миграция)

interface MinionView {             // то, что рисуем (лёгкое, из снапшота)
  id: string; owner: string;
  x: number; y: number; z: number;         // последняя снапшот-позиция
  px: number; py: number; pz: number;      // ПРЕДЫДУЩАЯ снапшот-позиция (для lerp)
  state: string; hp: number; maxHp: number; tier: number;
  lastT: number;                            // t предыдущего снапшота
}
// сеттеры: applySnapshot(snap) — обновляет resources/mySquadCount/squads/nodes ЗА ОДИН set()
```
> `applySnapshot` — **один** `set()` за тик (20/сек), а не per-миньон. Внутри: для каждого пришедшего миньона переносим старый `x,y,z`→`px,py,pz`, кладём новые, ставим `lastT`. Удаляем пропавших. `mySquadCount = squads.filter(owner===myId).length`. Ноль аллокаций сверх нужного (переиспользуем массив, мутируем по индексу где можно; либо принимаем один свежий массив за снапшот — 20/сек это ок).

### Сообщения (`src/socket.ts`)
```ts
socket.on('world_snapshot', (snap) => useStore.getState().applySnapshot(snap));
// (если 05 не готов — то же под именем 'minions_snapshot')
// spawn_minion / minion_command — только emit (см. §1, §3, §4); сервер отвечает снапшотом.
// claim_shards — emit при killed-count (§2), сервер начисляет, ответ в снапшоте.
```
Серверная сторона — новые `on('spawn_minion')`, `on('minion_command')`, `on('claim_shards')` + тик-цикл (§1, §5).

### Рефактор `Minions.tsx` — интерполяция + InstancedMesh
Заменяем `LocalMinions` (rapier-тела + `useFrame`-импульсы + `setState` в кадре) на **чистый рендер снапшота**:
```tsx
// src/components/Minions.tsx — новый Squads (рендерит ВСЕ отряды комнаты)
export const Squads = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const myId = useStore(s => s.playerId);
  // подписка на squads через getState в useFrame (НЕ через хук-селектор — чтобы не ре-рендерить на каждый снапшот)

  useFrame(() => {
    const squads = useStore.getState().squads;
    const mesh = meshRef.current; if (!mesh) return;
    const now = performance.now();
    let i = 0;
    for (const m of squads) {
      // интерполяция между px→x по времени с interpDelay
      const a = interpAlpha(m, now);                 // 0..1, из lastT + snapshotInterval
      _pos.set(
        m.px + (m.x - m.px) * a,
        (m.py + (m.y - m.py) * a) + bob(m.id, now),   // косметический боб
        m.pz + (m.z - m.pz) * a
      );
      _quat.setFromAxisAngle(_up, headingFrom(m));    // лицом по скорости (из px→x)
      _mat.compose(_pos, _quat, _one);
      mesh.setMatrixAt(i, _mat);
      mesh.setColorAt(i, colorFor(m, myId));          // свой = cyan tier-color, чужой = синий #4361ee
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_INSTANCES]} castShadow receiveShadow frustumCulled={false}>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial vertexColors />
    </instancedMesh>
  );
};
// MAX_INSTANCES = SQUAD_CAP * MAX_PLAYERS_PER_ROOM (напр. 8*8=64), с запасом 128.
```
- **`RemotePlayerMinions` удаляется** — чужие отряды теперь в том же `squads`/InstancedMesh, отличаются цветом по `owner`. Один mesh на все отряды комнаты.
- **Ноль аллокаций в useFrame:** `_pos/_quat/_mat/_one/_up` — модуль-скоуп (как `_wishDir` в Player.tsx). `bob`/`headingFrom`/`interpAlpha` — чистая арифметика.
- **`localMinions`-путь и `commandTarget` из Player.tsx (:372-379, :397) удаляются**; `update` больше не тащит `minions`. Клиент ничего не симулирует.
- Дуло/муляж-«глаз» миньона (Minions.tsx:63-66) — опустить в MVP (инстансы одноцветные), либо второй InstancedMesh для «стволов» позже.

---

## 7. Производительность и риски

### Перф
| Слой | Стоимость | Митигация |
|---|---|---|
| Рендер отряда | 1 `InstancedMesh`, ≤128 инстансов | один draw-call; `setMatrixAt` в кадре — дёшево; ноль `new` |
| Серверный тик | `stepMinions` O(n²) на сепарацию, n = миньоны комнаты | n ≤ `cap*players` (8*8=64); 64² = 4096 пар × 20Гц ≈ 82k оп/сек/комната — тривиально. При росте — spatial hash (grid buckets), later |
| Снапшот-трафик | миньоны × 20Гц | слать только `{id,owner,x,y,z,state,hp,tier}`; квантовать позиции (float→int16 ×100) later; дельта-снапшоты — бэкбон 05 |
| Клиент applySnapshot | 1 `set()`/тик (20/сек) | узкие селекторы; рендер читает `getState()` в useFrame, не через хук |
| Крафт-спам | edge-триггер B + серверный кап | нет per-frame спавна |

### Честные риски
1. **Радиал vs pointer-lock (главный).** Мы принципиально не выходим из lock (иначе `gameOver`), а читаем `movementX/Y`. Риск: пока радиал открыт, PLC **всё ещё крутит камеру** от той же мыши → игрок, «выбирая сектор», крутит вид. Это может дезориентировать. **Митигации на выбор (тюним на плейтесте):**
   - (a) Оставить как есть — «камера следует, выбор идёт вектором» (часто ощущается норм, как GTA-радиал с замедлением). 
   - (b) На время радиала **заморозить** влияние мыши на PLC, не выходя из lock: временно `controlsRef.current.disconnect()` (drei PLC снимает свои mousemove-листенеры, **не трогая** pointerLockElement → `gameOver` не стреляет), а наш `radialMouseMove` читает дельты; на закрытии `controlsRef.current.connect()`. **Это предпочтительный вариант** — камера стоит, выбор чистый. Проверить, что `disconnect/connect` не дёргает `pointerlockchange` (не должен — он лишь про DOM-listeners). 
   - (c) Гибрид: снизить чувствительность камеры ×0.15 на время радиала.
   > Заложить (b) как основной, (a)/(c) как fallback-флаги в конфиге.
2. **Серверный AI при многих отрядах.** O(n²) сепарация. При 64 миньонах — ок; при будущих «мега-волнах» — grid spatial hash. Помечено, не блокер MVP.
3. **Рассинхрон крафта.** Оптимистичного локального миньона нет → 100-150мс задержки появления. Незаметно, зато без «фантомных» миньонов при отказе сервера.
4. **Долг: `claim_shards` доверяет клиенту** (пока враги клиент-сайд). Явно помечено; закроется, когда враги станут серверными.
5. **Death-гейт pointer-lock хрупок.** Любой будущий UI, снимающий lock, убьёт матч. Радиал этого не делает — но это общий тех-долг (стоит вынести «пауза vs смерть» из `pointerlockchange`).

### Тюнинг-таблица (вынести в `src/config/minions.ts`)
```ts
export const MINIONS = {
  economy: { shardsPerKill: 3, shardsPerCandle: 8, pickupRadius: 2.0,
             baseCost: 10, costStep: 6, squadCap: 8 },
  radial:  { sectors: ['follow','attack','hold','goto','gather'],
             deadzone: 22, ringMax: 90, sens: 0.6, openMs: 80, closeMs: 60,
             tapFollowMs: 40, cmdCooldownMs: 120, freezeCamera: true /*риск §7.1(b)*/ },
  tiers:   [ { hp:40, speed:6.0, dmg:6,  range:14, fireCd:500,  color:'#00f5d4', size:0.8 } ],  // LATER +brawler/sniper
  steer:   { wSeek:1.0, wSep:1.4, sepR:1.5, maxForce:30, damp:0.88, arriveSlow:3.0,
             aggroR:10, engageMul:0.8 },
  form:    { back0:-2.5, rowGap:1.8, sideGap:1.4 },
  net:     { tickHz:20, interpDelayMs:100 },
  render:  { maxInstances:128, ownColor:'#00f5d4', allyColor:'#39ff14', enemyColor:'#4361ee' },
};
```

### Human feel-checklist (чем принимаем)
- [ ] Набил врагов → счётчик осколков `◈` растёт; при достатке блок `[B] CRAFT` подсвечивается «можно».
- [ ] Нажал **B** → через ~0.1с миньон появляется в строю за спиной; баланс списался; следующий дороже.
- [ ] Кап 8 работает: на 8-м крафт отказывает (клак + красный тик), баланс не тратится.
- [ ] Зажал **Q** → кольцо появляется за 80мс, 5 секторов читаются, активный подсвечен.
- [ ] Увёл мышь в сектор → подсветка мгновенная; отпустил → команда ушла (звук «yes sir»).
- [ ] **Follow**: отряд собирается в клин за мной и поворачивается со мной.
- [ ] **Attack** (навёл на врага, выбрал): отряд бежит и лупит именно эту цель.
- [ ] **Go-here**: отряд идёт в точку под прицелом и встаёт там.
- [ ] **Hold**: остаётся на месте, не бежит за мной, но огрызается на подошедших.
- [ ] Отпустил Q в центре (deadzone) → **отмена**, ничего не послано, тихий свуш.
- [ ] Tap-Q (быстрый клик) → мгновенный Follow без возни.
- [ ] Радиал **не** завершает матч (pointer-lock жив), камера ведёт себя предсказуемо (§7.1).
- [ ] Второй игрок в комнате видит мой отряд в тех же позициях (сервер-авторитет), его отряд — другого цвета.
- [ ] Чужой отряд в attack честно снимает мне HP (через серверный урон-путь).
- [ ] 60 fps при 2 полных отрядах (16 миньонов) в кадре; сервер-тик не тормозит.
- [ ] Пока радиал открыт, ЛКМ **не стреляет** (это подтверждение).

---

## 8. MVP инкремента 08 (минимум для сочной петли «крафт + командование»)

> «Собрал → скрафтил → скомандовал → отряд слушается и все это видят» — вертикальный playable-срез (senior first pass, не заглушка). Владелец играет и подтверждает.

**MVP (в этом порядке):**
1. **Серверная сущность миньона + тик + `world_snapshot.minions`** (§1, §5 базовый стиеринг follow/goto/hold/attack). Перенос сима с клиента на сервер — фундамент, без него остальное недетерминировано.
2. **Рефактор `Minions.tsx` → `Squads` (InstancedMesh + интерполяция)**, удаление `LocalMinions`/`RemotePlayerMinions`/`localMinions`/`commandTarget` (§6). Все отряды комнаты рисуются, свой/чужой по цвету.
3. **Ресурсы с киллов + HUD-ридаут** (§2 источник №1, §2 HUD): `shards` в сторе из снапшота, `claim_shards` с killed-count, счётчик `◈` + `[B] CRAFT · cost` + `SQUAD n/8`.
4. **Крафт по B** (§3): edge-триггер → `spawn_minion` → серверная валидация (cost/cap) → появление через снапшот. Масштаб-цена, кап 8.
5. **Радиал Q — Follow / Attack / Hold / Go-here** (§4): стейт-машина внутри pointer-lock (movementX/Y + freezeCamera-вариант §7.1(b)), DOM-оверлей в UI.tsx по шине fx, raycast-цель для Attack/Go-here, команда всем миньонам владельца.

**Позже (polish waves):**
- **Gather-экономика**: ноды-жилы + миньоны фармят + несут осколки (§2 №3, §5 gather-стейт). MVP оставляет сектор Gather как «идти к ближайшей ноде», но нод пока нет.
- **Пикапы-осколки** (§2 №2): подбираемые дропы с киллов вместо мгновенного начисления (juicy).
- **Субвыделение** (§4 selection): control-groups / look-select, `ids` в интенте.
- **Тиры/варианты миньонов** (§3): Brawler/Sniper + выбор тира при крафте (`Shift+B`/крафт-радиал).
- **Формации-UI**: смена строя (клин/линия/кольцо), сектор или тоггл.
- **Видимые серверные снаряды миньонов** + музл/трейсер (интеграция с projectile-системой) вместо прямого урона.
- **Косметика отряда**: боб-анимация по стейту, «стволы» вторым InstancedMesh, HP-полоски над ранеными.
- **Сеть-полиш**: квантование позиций, дельта-снапшоты (с бэкбоном 05), интерп-сглаживание.
- **Анти-чит**: серверные враги → полностью серверное начисление осколков (закрыть долг §7.4).

> MVP трогает: **новый** `game/radial.ts` + `config/minions.ts`; правки в `server.ts` (тик+интенты+сущность), `store.ts` (snapshot-стейт), `socket.ts` (снапшот-хендлер), `Minions.tsx` (→`Squads`), `Player.tsx` (B-крафт, радиал-issue-raycast, снять F-command и `localMinions`-синк, подавить shoot при радиале), `UI.tsx` (осколки-HUD + `<RadialMenu/>`), `useKeyboard.ts` (craft/radial-клавиши). Netcode-инвариант: **сервер авторитетен по миньонам/ресурсам/урону**, клиент — интенты + интерполяция + косметика.
