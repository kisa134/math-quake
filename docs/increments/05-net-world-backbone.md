# 05 — Networked World Backbone (авторитетный мир + интерполяция)

> **Что это.** Сетевой хребет для «живого мира»: сервер становится авторитетом не только над игроками (как сейчас), но и над **высокоуровневой правдой мировых сущностей** — поезд-американская-горка, ИИ-твари, отряды-миньоны, — а клиенты рендерят их через **интерполяционный буфер (~100 мс назад)** и крутят только **косметическую локальную физику** (наклон вагонов, суставы рэгдолла из корня, PD-мышцы походки, вспышки, дебрис). Ни один сустав рэгдолла НЕ уходит в провод — тот же принцип, что и дебрис сегодня.
>
> **Зачем сейчас.** Владелец выбрал «networked from the start». Все последующие инкременты (поезд, твари, миньоны, рэгдолл, генетические походки/GA) втыкаются в ЭТОТ контракт. Если контракт зафиксировать сейчас — поезд станет «ещё одной сущностью в снапшоте», а не переписыванием сети.
>
> **Статус:** спека (документ). Код пишется по очереди, начиная с §10 MVP.

---

## 0. Что есть сегодня (факт из кода)

Прочитано: `server.ts`, `src/socket.ts`, `src/store.ts`, `src/components/Player.tsx`.

- **Сервер** (`server.ts`) — чистый **релей per-player**: `rooms[room] = { players, enemies }`. Обработчики `join / update / shoot / hit / disconnect`. Сервер авторитетен ТОЛЬКО над `health / death / score` игроков (`hit` → пересчёт HP → `player_hit` / `player_died` / `score_updated`). **Тика симуляции мира нет.** `rooms[room].enemies` заведён в типе, но нигде не наполняется.
- **Клиент-сокет** (`src/socket.ts`) — слушает `init / player_joined / player_updated / player_shot / player_hit / player_died / score_updated / player_left`, пишет в `useStore`.
- **Стор** (`src/store.ts`) — `remotePlayers: Record<id, PlayerState>`; враги/дебрис/партиклы/`localMinions` — **локальные, per-client**, не синкаются. `PlayerState` уже носит опциональные `minions`.
- **Player.tsx** — раз в 50 мс (`now - lastSyncTime > 50`) шлёт `update` с `{x,y,z,rotation,isShooting,currentWeapon,minions}`. Аллокаций в `useFrame` избегает через модульные `_wishDir/_moveVel/...` (паттерн, который мы обязаны сохранить).

**Ключевой вывод.** Сегодня сеть = «каждый клиент — источник правды о себе, сервер пересылает». Для мира это не годится: у поезда/твари нет «своего клиента». Нужен **серверный tick + снапшот**. Добавляем новый канал `world_*`, **не трогая** живой player-релей (обратная совместимость, нулевой риск для готового шутинга).

---

## 1. Контракт авторитета (это — закон для инкрементов 06+)

```
┌─ SERVER (authoritative, 15–20 Hz tick) ──────────────────────────────┐
│ rooms[room].world = { seq, train, creatures[], minions[], resources[] │
│ }                                                                     │
│ Держит ТОЛЬКО высокоуровневую правду:                                 │
│   train    = t вдоль сплайна + speed + pilotId (+ derailed)           │
│   creature = root {pos,yaw} + vel + state-enum + hp + gaitId          │
│   minion   = ownerId + root + state + targetRef                       │
│ Каждый tick: интегрирует, применяет intent-ы, чинит инварианты,       │
│ шлёт world_snapshot (seq, serverTime, массивы).                       │
└───────────────────────────────────────────────────────────────────────┘
        │ world_snapshot (broadcast, ~15–20 Hz)      ▲ intents (client→server)
        ▼                                            │ train_input / minion_command / spawn_minion
┌─ CLIENT (dumb renderer + cosmetic physics) ───────────────────────────┐
│ Буфер снапшотов (RENDER_DELAY=100 мс). Каждый кадр:                    │
│   renderT = serverNow() - 100  →  lerp/slerp двух соседних снапшотов   │
│ Рендерит интерполированные корни. Локально (косметика, НЕ в провод):  │
│   • наклон вагона от кривизны сплайна и центробежки                    │
│   • рэгдолл-суставы, ведомые корневым transform (PD/пружины)           │
│   • походка/мышцы из gaitId (GA-геном), вспышки, дебрис, звук          │
│ Локальный игрок — как и сегодня: своя физика Rapier + emit('update').  │
└───────────────────────────────────────────────────────────────────────┘
```

**Явно проговариваем (важно для 06+):** мировые сущности — **это НЕ локальный игрок**. Поэтому **client-side prediction + rollback им НЕ нужен**. Достаточно чистой интерполяции с задержкой. Прогноз/реконсиляция остаются только у локального игрока (у него их и сегодня нет в сетевом смысле — он просто авторитет над собой). Единственное исключение — **пилот поезда**: см. §7 (лёгкий опережающий рендер своего же ввода, опционально, только для «отзывчивости руля»).

---

## 2. Серверные формы состояния (`server.ts`)

Расширяем тип комнаты. **Единицы:** позиции — метры (мировые), углы — радианы, время — мс (`Date.now()` серверные), скорости — м/с.

```ts
// --- enum'ы как узкие строки (дёшево в JSON, читаемо) ---
type CreatureState = 'idle' | 'walk' | 'chase' | 'attack' | 'dead';
type MinionState   = 'follow' | 'move' | 'attack' | 'dead';

interface Train {
  t: number;          // параметр вдоль сплайна [0..1), НЕ мировые XYZ
  speed: number;      // единиц t в секунду (нормализовано к длине сплайна)
  pilotId: string | null;  // socket.id пилота или null (автопилот)
  derailed: boolean;  // косметический флаг «сошёл с рельс» (клиент решает как показать)
}

interface Creature {
  id: string;
  x: number; y: number; z: number;  // корневой transform
  yaw: number;                      // рысканье (единственный угол в проводе)
  vx: number; vy: number; vz: number; // скорость (для экстраполяции при потере пакета)
  state: CreatureState;
  hp: number;
  gaitId: number;   // индекс/сид генома походки (GA) — клиент по нему собирает мышцы
}

interface Minion {
  id: string;
  ownerId: string;
  x: number; y: number; z: number;
  yaw: number;
  state: MinionState;
  targetId: string | null;  // на кого нацелен (creature.id | player socket.id)
}

interface Resource {         // «ресурсы»/пикапы — статичные до подбора
  id: string;
  x: number; y: number; z: number;
  kind: number;    // enum-индекс типа
  taken: boolean;
}

interface World {
  seq: number;         // монотонный номер снапшота (стартует с 1)
  train: Train;
  creatures: Creature[];
  minions: Minion[];
  resources: Resource[];
}

const rooms: Record<string, {
  players: Record<string, { x:number,y:number,z:number,rotation:number,health:number,score:number,isShooting:boolean }>;
  world: World;        // ← НОВОЕ
  lastTick: number;    // для дельты dt в тике
}> = {};
```

Инициализация мира при создании комнаты (в обработчике `join`, там где сейчас `rooms[roomId] = { players:{}, enemies:{} }`):

```ts
function makeWorld(): World {
  return {
    seq: 0,
    train: { t: 0, speed: 0.03, pilotId: null, derailed: false },
    creatures: [],   // спавнятся тиком/событием (инкремент 07)
    minions: [],     // спавнятся по spawn_minion (инкремент 08)
    resources: [],
  };
}
```

---

## 3. Тик-луп (авторитетная симуляция)

Один `setInterval` на процесс, а НЕ на комнату (проще, дешевле; внутри цикл по комнатам). **Частота 20 Hz (50 мс).**

**Обоснование частоты.** 20 Hz снапшотов + 100 мс интерполяции = клиент всегда имеет ≥2 снапшота в буфере (50 мс шаг), lerp гладкий на 60–144 fps рендере. 15 Hz (66 мс) — нижняя граница, годится если упрёмся в bandwidth; ниже — интерполяция начинает «плыть». Берём **20 Hz** и оставляем `TICK_HZ` константой.

```ts
const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;      // 50

setInterval(() => {
  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const dt = Math.min(0.1, (now - room.lastTick) / 1000); // clamp против фризов
    room.lastTick = now;

    stepWorld(room.world, room.players, dt);   // §4 — вся симуляция
    room.world.seq++;

    io.to(roomId).emit('world_snapshot', buildSnapshot(room.world, now)); // §5
  }
}, TICK_MS);
```

`stepWorld` — чистая интеграция высокоуровневой правды (детали наполняются инкрементами):

```ts
function stepWorld(w: World, players: Room['players'], dt: number) {
  // --- ПОЕЗД (инкремент 06) ---
  // если pilotId есть — speed уже выставлен из train_input; иначе автопилот
  if (!w.train.pilotId) w.train.speed = cruise(w.train.speed, dt);
  w.train.t = (w.train.t + w.train.speed * dt) % 1;   // закольцованный сплайн

  // --- ТВАРИ (инкремент 07): простой авторитетный ИИ на КОРНЕ (не на суставах) ---
  for (const c of w.creatures) {
    if (c.state === 'dead') continue;
    const tgt = nearestPlayer(c, players);            // серверный «мозг»
    aiStep(c, tgt, dt);   // выставляет state/vx/vz/yaw, интегрирует x,z
  }

  // --- МИНЬОНЫ (инкремент 08): исполняют последнюю команду владельца ---
  for (const m of w.minions) minionStep(m, w, players, dt);

  // GC мёртвых через N тиков (§8 despawn)
}
```

**Инвариант:** сервер НЕ считает суставы, наклоны, IK, партиклы. Только корень + enum + hp + t. Всё «мясо» — клиент.

---

## 4. Снапшот: форма, размер, full vs delta

### 4.1 Квантование (обязательно)

JSON-числа float64 = 8 байт «на бумаге» + текст. Квантуем в целые перед отправкой — режет и байты, и джиттер:

| Поле | Квант | Диапазон | Хранит как |
|------|-------|----------|------------|
| x,y,z | ×100 (см) | арена ±~200 м | int (round) |
| yaw / rotation | ×1000 (мрад) | ±π | int16-ish |
| train.t | ×10000 | [0,1) | int |
| speed | ×1000 | малый | int |
| vx,vy,vz | ×10 | | int (шлём ТОЛЬКО если экстраполяция нужна — тварям да, статике нет) |
| hp | как есть (0..255) | | uint8 |
| state/gaitId/kind | индекс | | uint8 |

На проводе — просто целые в массивах (socket.io сам сожмёт; при желании позже — бинарь, см. §6 риски). Деквантование на клиенте: `x = xq / 100`.

### 4.2 Форма снапшота (массивы, не объекты — компактнее)

```ts
function buildSnapshot(w: World, serverTime: number) {
  return {
    seq: w.seq,
    t: serverTime,                       // серверные мс — для clock-sync (§9)
    train: [Math.round(w.train.t*1e4), Math.round(w.train.speed*1e3),
            w.train.pilotId ?? '', w.train.derailed ? 1 : 0],
    // creatures: плоский кортеж на сущность
    cr: w.creatures.map(c => [
      c.id, q(c.x), q(c.y), q(c.z), qa(c.yaw),
      STATE_I[c.state], c.hp|0, c.gaitId|0,
      // vx,vy,vz только для не-idle (экстраполяция):
      c.state==='idle' ? 0 : Math.round(c.vx*10),
      c.state==='idle' ? 0 : Math.round(c.vz*10),
    ]),
    mn: w.minions.map(m => [m.id, q(m.x), q(m.y), q(m.z), qa(m.yaw), MST_I[m.state], m.targetId ?? '']),
    // ресурсы шлём ТОЛЬКО в full/при изменении (см. delta ниже)
  };
}
const q  = (v:number)=>Math.round(v*100);
const qa = (v:number)=>Math.round(v*1000);
```

### 4.3 Full vs Delta — **рекомендация: гибрид «keyframe + delta», старт с FULL**

- **MVP и до ~30 сущностей: слать FULL каждый tick.** Расчёт (§6) показывает, что full-снапшот на 20 сущностей ≈ 1.2 КБ/tick × 20 Hz ≈ **24 КБ/с на клиента** — это копейки, socket.io permessage-deflate жмёт ещё вдвое. Full радикально проще: нет рассинхрона дельт, поздний джойн = обычный снапшот, потеря пакета лечится следующим тиком «сама».
- **Когда сущностей станет много (>50) или добавим ресурсы/поезд-состав из 30 вагонов — перейти на дельту:** каждые N=20 тиков (раз в секунду) — **keyframe (full)**, между ними — только изменившиеся поля (dirty-флаги на сервере). Клиент, поймавший keyframe, применяет дельты поверх; пропустил дельту — ждёт следующий keyframe (макс. рассинхрон 1 с, невидимо на фоне интерполяции). **Ресурсы/статику НЕ включаем в per-tick вообще** — только keyframe + событие `resource_taken`.

> **Вывод:** пишем `buildSnapshot` так, чтобы full было дефолтом; dirty-tracking добавим позже одним слоем над теми же массивами. Не оптимизируем преждевременно.

---

## 5. Каталог сообщений (весь хребет)

| Имя | Направление | Payload | Назначение / где втыкается |
|-----|-------------|---------|----------------------------|
| `join` | C→S | `roomId` | **есть.** Дополняем: сервер шлёт `world_init` вслед за `init`. |
| `init` | S→C | `{id, players}` | **есть, не трогаем.** |
| `world_init` | S→C | `{world: FullWorld, serverTime, seq}` | **НОВОЕ.** Полное состояние мира при входе/поздний джойн (§8). |
| `world_snapshot` | S→C (broadcast) | `{seq, t, train, cr[], mn[]}` (§4) | **НОВОЕ.** Периодический снапшот, 20 Hz. |
| `world_event` | S→C (broadcast) | `{kind, ...}` | **НОВОЕ.** Разовые события вне tick: `creature_spawn`, `creature_died`, `resource_taken`, `train_derailed`. Не полагаемся на diff снапшота для «одноразовых» вещей (звук/вспышка/score). |
| `train_input` | C→S | `{throttle:-1..1, brake:bool}` | **НОВОЕ (06).** Intent пилота. Применяется только если `socket.id===pilotId`. |
| `train_claim` | C→S | `{}` | **НОВОЕ (06).** Заявка на руль: сервер ставит `pilotId=socket.id` если свободно. |
| `train_release` | C→S | `{}` | **НОВОЕ (06).** Отпустить руль (или авто при disconnect). |
| `spawn_minion` | C→S | `{gaitId?, at:[x,y,z]}` | **НОВОЕ (08).** Просьба заспавнить миньона у владельца. Сервер валидирует лимит (§6) и создаёт. |
| `minion_command` | C→S | `{minionId?, cmd:'move'\|'attack'\|'follow', target:[x,y,z]\|id}` | **НОВОЕ (08).** Команда отряду. `minionId` пустой = всему отряду владельца. |
| `update` | C→S | `{x,y,z,rotation,isShooting,currentWeapon,minions}` | **есть.** Локальный игрок. Поле `minions` из `update` **депрекейтим** — миньоны переезжают в авторитетный мир. |
| `player_*`,`shoot`,`hit`,`score_updated` | обе | — | **есть, не трогаем.** Player-канал живёт параллельно world-каналу. |

**Принцип разделения.** Непрерывное (позы) → `world_snapshot` (можно терять, интерполяция скроет). Дискретное/одноразовое (родился/умер/подобрал) → `world_event` (важен факт, не поза). Это тот же водораздел, что уже есть у игроков: `player_updated` (непрерывно) vs `player_died` (событие).

### Куда втыкается каждый будущий инкремент
- **06 Поезд:** `train_*` + `world.train`; клиент — сплайн-геометрия рельс + наклон вагонов (косметика).
- **07 Твари/ИИ:** `world.creatures` + `aiStep` на сервере + `creature_spawn/died` события; клиент — меши по `id`, анимация по `state`.
- **08 Миньоны:** `spawn_minion`/`minion_command` + `world.minions`; удаляем локальные `localMinions`.
- **09 Рэгдолл:** чисто клиент — суставы ведомы корнем из снапшота; в провод НЕ идёт. Смерть = событие `creature_died` → клиент роняет рэгдолл.
- **10 GA/походки:** `gaitId` в снапшоте — сид генома; клиент строит PD-мышцы из него. Эволюция геномов может жить на сервере (высокоуровнево) или офлайн — провод несёт только id/params.

---

## 6. Бюджет пропускной способности и перф

**Размер одной сущности (после квантования, целые в массиве):** creature ≈ 10 полей ≈ ~40–55 байт JSON-текста (id ~7 симв + 9 чисел). minion ≈ 30 байт. train ≈ 25 байт.

| Сценарий | Сущностей | Байт/tick (до deflate) | ×20 Hz | На клиента | На 8-местную комнату (broadcast) |
|----------|-----------|------------------------|--------|-----------|-----------------------------------|
| MVP (1 dummy) | 1 | ~60 | 1.2 КБ/с | 1.2 КБ/с | ~10 КБ/с |
| Реалистичный | 20 creatures + 8 minions + train | ~1.3 КБ | ~26 КБ/с | 26 КБ/с | ~210 КБ/с исходящих с сервера |
| Потолок (clamp) | 40 creatures + 16 minions | ~2.6 КБ | ~52 КБ/с | 52 КБ/с | ~420 КБ/с |

permessage-deflate (socket.io по умолчанию для крупных фреймов) режет позиционные массивы ~2×. Вывод: **до ~40 сущностей full-снапшоты @20 Hz абсолютно комфортны** для веба. Если комнаты станут людными — включаем дельту (§4.3) и/или роняем до 15 Hz.

**Клампы (жёсткие, на сервере):**
```ts
const MAX_CREATURES = 40;      // спавн отклоняется выше
const MAX_MINIONS_PER_OWNER = 8;
const MAX_MINIONS_TOTAL = 16;
const MAX_SNAPSHOT_ENTITIES = 64;   // страховка: режем хвост массива
const TICK_HZ = 20;
```

**Tick vs render decoupling.**
- Сервер: фиксированный 20 Hz tick — источник правды, независим от клиентских fps.
- Клиент: рендер на `useFrame` (60–144 fps) читает **интерполированное** состояние на `renderT = serverNow()-100мс`. Между снапшотами кадры интерполируются, а не «прыгают» на tick. Косметическая физика (наклон/рэгдолл/походка) интегрируется на клиентском `delta`, поверх интерполированного корня.

---

## 7. Клиент: приём, буфер, интерполяция, стор, чтение в кадре

### 7.1 Буфер снапшотов (модуль `src/net/worldBuffer.ts`)

**Без per-frame аллокаций** — буфер как кольцо фиксированной длины, деквант в типизированные/переиспользуемые структуры.

```ts
const RENDER_DELAY = 100;      // мс: рендерим на 100 мс в прошлом
const BUFFER_MAX   = 20;       // ~1 с истории @20 Hz

interface Snap { seq:number; clientRecvT:number; serverT:number;
                 train: TrainView; cr: Map<string, CreatureView>; mn: Map<string, MinionView>; }

const buffer: Snap[] = [];     // отсортирован по serverT (приходят по порядку)
let clockOffset = 0;           // serverT - clientT, скользящее среднее (§9)

export function pushSnapshot(raw:any) {
  const snap = decodeSnapshot(raw);           // деквант; переиспользуем view-объекты по id
  buffer.push(snap);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  updateClockOffset(raw.t);                   // §9
}

export function serverNow() { return Date.now() + clockOffset; }
```

### 7.2 Интерполяция (вызывается раз за кадр из хука, §7.2)

```ts
// заранее выделенные аккумуляторы — НИКАКИХ new в кадре
const _out = { train: {t:0,speed:0,pilotId:null as string|null,derailed:false},
               creatures: new Map<string, CreatureView>() };

export function sampleWorld(): typeof _out {
  const renderT = serverNow() - RENDER_DELAY;

  // найти пару снапшотов [a,b] так что a.serverT <= renderT <= b.serverT
  let a = buffer[0], b = buffer[buffer.length-1];
  for (let i=0; i<buffer.length-1; i++) {
    if (buffer[i].serverT <= renderT && buffer[i+1].serverT >= renderT) { a=buffer[i]; b=buffer[i+1]; break; }
  }
  const span = Math.max(1, b.serverT - a.serverT);
  const alpha = clamp01((renderT - a.serverT) / span);

  // train: lerp t (учесть wrap 1→0!), lerp speed
  _out.train.t = lerpAngleLike(a.train.t, b.train.t, alpha);   // wrap-safe
  _out.train.pilotId = b.train.pilotId;
  _out.train.derailed = b.train.derailed;

  // creatures: по id из b; если в a нет (только что заспавнилась) — берём b как есть
  for (const [id, cb] of b.cr) {
    const ca = a.cr.get(id);
    const view = getOrCreateView(_out.creatures, id);          // reuse, без new
    if (ca) { view.x = lerp(ca.x,cb.x,alpha); view.z = lerp(ca.z,cb.z,alpha);
              view.y = lerp(ca.y,cb.y,alpha); view.yaw = slerpAngle(ca.yaw,cb.yaw,alpha); }
    else    { view.x=cb.x; view.y=cb.y; view.z=cb.z; view.yaw=cb.yaw; }
    view.state = cb.state; view.hp = cb.hp; view.gaitId = cb.gaitId;
  }
  pruneMissing(_out.creatures, b.cr);   // сущности, которых нет в b — удалить из вывода
  return _out;
}
```

**Экстраполяция при недоборе буфера** (пакетлосс/лаг-спайк): если `renderT > lastSnap.serverT`, вместо clamp — короткая экстраполяция `pos += v*dt` (для того и шлём `vx,vz` тварям), но не дольше ~150 мс, потом фриз. Это делает потерю 2–3 пакетов подряд незаметной.

### 7.3 Хук-потребитель `useWorldInterp` (`src/net/useWorldInterp.ts`)

Мировые сущности НЕ живут в реактивном zustand-стейте покадрово (иначе — ре-рендеры и аллокации). Паттерн: **zustand хранит только «список id/спавн-события» (редко меняется, реактивно), а покадровые transforms читаются императивно** из `sampleWorld()` внутри `useFrame` и пишутся прямо в `ref`-меши.

```ts
// В компоненте Creatures.tsx (инкремент 07):
useFrame((_, delta) => {
  const w = sampleWorld();                 // интерполяция, без аллокаций
  for (const [id, view] of w.creatures) {
    const mesh = meshRefs.get(id);         // Map<id, THREE.Object3D>, обновляется по спавн-событиям
    if (!mesh) continue;
    mesh.position.set(view.x, view.y, view.z);
    mesh.rotation.y = view.yaw;
    stepCosmetic(mesh, view, delta);       // наклон/рэгдолл/походка — ЛОКАЛЬНО
  }
});
```

Список `id` для монтирования/размонтирования мешей — реактивный, приходит из `world_event` (`creature_spawn`/`died`), а не из покадрового снапшота. Это разделяет «структуру сцены» (React, редко) и «позы» (императив, каждый кадр).

### 7.4 Дополнения в `store.ts` (реактивная часть — только структура)

```ts
interface WorldEntityList {
  creatureIds: string[];               // для монтирования мешей
  minionIds: string[];
  train: { present: boolean; pilotId: string|null };  // для UI «ты за рулём»
  addCreature: (id:string)=>void;
  removeCreature: (id:string)=>void;
  setMinions: (ids:string[])=>void;
  setTrainPilot: (pilotId:string|null)=>void;
}
```

> Заметь: `remotePlayers` остаётся как есть. `localMinions` **удаляется** — миньоны становятся авторитетными (`minionIds` + императивные позы). Это единственное «ломающее» изменение в существующем сторе, и оно ожидаемо (инкремент 08).

### 7.5 Регистрация обработчиков (`src/socket.ts`, дополнение)

```ts
socket.on('world_init',     (d) => { seedBuffer(d); useStore.getState().hydrateWorld(d.world); });
socket.on('world_snapshot', (d) => pushSnapshot(d));           // горячий путь — НЕ трогает React
socket.on('world_event',    (d) => applyWorldEvent(d));        // spawn/died/taken → стор + звук/вспышка
```
Критично: `world_snapshot` идёт **мимо zustand** прямо в кольцевой буфер (§7.1). Только события меняют реактивный стор.

---

## 8. Отказы и краевые случаи

| Случай | Поведение |
|--------|-----------|
| **Поздний джойн** | На `join` сервер шлёт `world_init` с ПОЛНЫМ `World` (не ждём keyframe). Клиент заполняет буфер одним снапшотом (a==b, alpha=0) и стартует. |
| **Пилот отвалился (disconnect)** | В `disconnect`-хендлере: если `world.train.pilotId===socket.id` → `pilotId=null` (автопилот подхватывает `cruise`). Плюс: все `minions` где `ownerId===socket.id` → помечаются `dead`/деспавнятся, шлётся `world_event`. |
| **Despawn сущности** | Смерть: `state='dead'` держим ~1–2 с (клиент играет рэгдолл-падение), затем GC из массива + `creature_died` событие сразу в момент смерти (звук/дебрис — по событию, не по исчезновению из снапшота). Клиент, не увидев id в снапшоте, размонтирует меш (`pruneMissing`). |
| **Clock sync** | Снапшот несёт `serverTime`. Клиент: `offset = serverTime - Date.now()` при приёме, сглаживание EMA (`clockOffset = 0.9*clockOffset + 0.1*sample`). `serverNow()=Date.now()+clockOffset`. Не нужен NTP-пинг: односторонняя оценка + 100 мс буфера поглощают дрейф. |
| **Потеря пакетов** | Интерполяция на 100 мс = запас в 2 снапшота. Потеря 1 tick — невидима (следующий снапшот перекрывает окно). 2–3 подряд — короткая экстраполяция по `v` (§7.2), затем мягкий фриз. Full-снапшоты означают, что **потеря никогда не накапливает рассинхрон** (в отличие от чистых дельт). |
| **Out-of-order снапшот** | socket.io/TCP гарантирует порядок в рамках сокета, но защищаемся: отбрасываем снапшот с `seq <= lastSeq`. |
| **Опустела комната** | Как сейчас: `delete rooms[roomId]` при 0 игроков. Мир умирает с комнатой; tick-цикл её просто пропускает. |
| **Спавн выше лимита** | `spawn_minion`/creature-спавн при достижении клампа — тихо игнор + опционально `world_event {kind:'spawn_denied'}` инициатору. |

---

## 9. Clock sync — детально (нужно всем инкрементам)

```ts
let clockOffset = 0, inited = false;
function updateClockOffset(serverT:number) {
  const sample = serverT - Date.now();     // положит., если сервер «впереди»
  clockOffset = inited ? 0.9*clockOffset + 0.1*sample : (inited=true, sample);
}
```
Мы НЕ компенсируем RTT/2 (без пинг-паунга) — это добавит небольшой стабильный сдвиг, полностью скрытый `RENDER_DELAY=100 мс`. Если позже понадобится точность (напр. для попадания по движущейся твари как у игроков) — добавим ping-echo и вычтем `rtt/2`. Для интерполяции мира — избыточно.

---

## 10. Риски (честно) и прагматичный водораздел

1. **Стоимость авторитета над «физичными» сущностями.** Полная серверная физика (Rapier на Node для каждой твари/вагона) — дорого по CPU и убивает детерминизм между JS-физикой сервера и клиента. **Митигация — водораздел:** сервер симулирует **только корень** (точка+скорость+yaw) простым кинематическим/пружинным ИИ, БЕЗ Rapier-солвера. Вся «физичность» (столкновения суставов рэгдолла, наклон вагона, отскоки дебриса) — **косметика на клиенте**, не влияет на правду. Тот же принцип, что уже узаконен для дебриса (§00-README: «разрушение/дебрис косметичны локально»).
2. **Расхождение косметики между клиентами.** Наклон/рэгдолл у двух игроков будут чуть разными — и это **ОК**: они не геймплейны (никто по суставу не стреляет). Геймплейный хитбокс = корневой transform из снапшота, одинаковый у всех.
3. **Поезд с пассажирами-игроками.** Игрок стоит на движущемся вагоне: его локальная Rapier-физика в мировых координатах будет драться с движением поезда. **Решение (детали в 06):** пол вагона — кинематическое тело, чью позу клиент ставит из интерполированного `train.t`; игрок стоит на нём обычным коллайдером. Пилот может получить лёгкий опережающий рендер своего руля (см. §1), но правда о `t` всё равно серверная.
4. **Bandwidth при массовости.** Разобрано (§6): full до ~40 сущностей — норм; выше — дельта/15 Hz. Риск управляем клампами.
5. **Node event-loop под tick+broadcast.** 20 Hz × (симуляция + сериализация) на комнату. При многих комнатах — следить за `stepWorld` (O(creatures²) в `nearestPlayer` — кэшировать). Пока комнат мало — незаметно.

**Итог водораздела:** `сервер = высокоуровневая правда (что где и в каком состоянии), клиент = как это красиво трясётся`. Это делает «networked from the start» реально выполнимым, а не исследовательским проектом.

---

## 11. MVP — минимальный хребет, играбельный в изоляции

**Цель:** доказать петлю `серверный tick → снапшот → клиентская интерполяция` на ОДНОЙ фиктивной авторитетной сущности, ДО поезда/тварей. Playtestable сам по себе.

### Объём MVP (и только он)
1. **Сервер (`server.ts`):**
   - Добавить `world` в комнату + `makeWorld()` с одной «dummy» сущностью: `creatures:[{ id:'dummy', x:0,y:2,z:0, yaw:0, vx:0,vy:0,vz:0, state:'walk', hp:100, gaitId:0 }]`.
   - `setInterval` @20 Hz: двигать dummy по кругу — `const a=now/1000; c.x=Math.cos(a)*8; c.z=Math.sin(a)*8; c.yaw=a+Math.PI/2;` (чистая серверная правда, клиент её НЕ вычисляет).
   - `buildSnapshot` (только `cr[]`+`seq`+`t`) → `io.to(room).emit('world_snapshot', ...)`.
   - На `join`: `socket.emit('world_init', {world, serverTime:Date.now(), seq})`.
2. **Клиент:**
   - `src/net/worldBuffer.ts`: `pushSnapshot`/`sampleWorld`/`serverNow` + clock-offset (§7.1–7.2, но только creatures, wrap не нужен).
   - `src/socket.ts`: `on('world_init')` seed + `on('world_snapshot')` push.
   - `src/components/WorldEntities.tsx`: монтирует один меш (напр. светящийся октаэдр), в `useFrame` читает `sampleWorld()` и ставит `mesh.position/rotation.y`. Никаких аллокаций в кадре.
3. **Проверяемый результат:** dummy плавно летает по кругу, **одинаково у всех клиентов**, движение приходит С СЕРВЕРА (выключи один клиент — у другого dummy продолжает — доказательство авторитетности).

### Что НЕ входит в MVP (следующие инкременты)
Дельта-снапшоты, поезд, ИИ-твари, миньоны, рэгдолл, GA-походки, `world_event`, экстраполяция, клампы >1 сущности, наклон/косметика. Всё это встаёт поверх готового §11 без изменения контракта.

### 12. Рецепт верификации на 2 клиента (1 сервер, 2 вкладки)

1. `npm run dev` → сервер на `:3000`.
2. Открыть **две вкладки** браузера на `http://localhost:3000`, обе войти в **одну комнату** (один `roomId`).
3. **Ожидаемо:** в обеих вкладках dummy-октаэдр летает по одному и тому же кругу, **фазово синхронно** (обе читают серверный `t`), плавно на 60 fps (интерполяция, не 20 Hz «степ»).
4. **Тест авторитетности:** закрыть вкладку A. Во вкладке B dummy **не останавливается и не дёргается** — сервер продолжает tick. Вновь открыть A/войти в комнату → dummy появляется уже «в правильной фазе круга» (пришёл `world_init` с текущим `t`) — доказательство late-join.
5. **Тест интерполяции/лага:** DevTools → Network → throttle «Slow 3G» на вкладке B на пару секунд. Движение должно **сгладиться/чуть отстать, но не телепортироваться** (буфер 100 мс + экстраполяция). После снятия throttle — плавно догоняет.
6. **Тест clock-sync:** в консоли вкладки залогировать `clockOffset` и `buffer.length` — offset стабилен (±несколько мс), buffer держится ~2–4 снапшота. Если buffer часто пустеет → поднять `RENDER_DELAY`.
7. **Перф-чек:** `world_snapshot` в Network ≈ 20/с, размер фрейма ~60–100 Б; в консоли — 0 GC-спайков в `useFrame` (Performance-запись без «пилы» heap).

---

## Приложение A — файлы, которых касается хребет

| Файл | Изменение |
|------|-----------|
| `server.ts` | +`World` в комнату, +`makeWorld`, +tick `setInterval`, +`stepWorld`/`buildSnapshot`, +`world_init` в `join`, +`train_*`/`minion_*`/`spawn_minion` хендлеры (по инкрементам), pilot-cleanup в `disconnect`. **Player-релей не трогаем.** |
| `src/net/worldBuffer.ts` | **новый.** Кольцевой буфер, деквант, `sampleWorld`, `serverNow`, clock-offset, экстраполяция. |
| `src/net/useWorldInterp.ts` | **новый.** Хук-обёртка над `sampleWorld` для `useFrame`-потребителей. |
| `src/socket.ts` | +`world_init`/`world_snapshot`/`world_event` обработчики (snapshot → буфер, мимо React). |
| `src/store.ts` | +структурная часть (`creatureIds`/`minionIds`/`train.pilotId` + события). Удалить `localMinions` (инкремент 08). |
| `src/components/WorldEntities.tsx` (MVP) → `Creatures.tsx`/`Train.tsx`/`Minions.tsx` (позже) | **новые.** Императивный рендер интерполированных корней + косметическая физика. |

**Незыблемый инвариант хребта:** покадровые позы мировых сущностей идут `сокет → кольцевой буфер → sampleWorld() → ref-меш`, **никогда** через реактивный zustand и **никогда** с `new` в `useFrame` — ровно тот дисциплинированный паттерн, что уже держит 60 fps в `Player.tsx`.
