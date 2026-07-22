# 09 — Melee / холодное оружие (сочный замах + нокбэк)

> Психоделический неоновый клинок как **5-й слот оружия**. Короткий замах → активное окно
> удара по конусу перед камерой → большой нокбэк-импульс по телу Rapier + шейк + звук +
> хитмаркер + slash-трейл. Без тайм-дисторшна (онлайн-игра). Тяжёлый удар — будущий триггер
> рэгдолла (инкремент 10) через готовый seam `ragdollize()`.

Статус метода (см. `00-README.md`): это **спека**, кодит владелец одним законченным
playable-срезом. Числа/структуры/точки вставки — конкретные и привязаны к реальному коду
(`src/components/Player.tsx`, `src/store.ts`, `src/components/Enemies.tsx`, `src/game/*`,
`src/utils/audio.ts`, `src/components/UI.tsx`, `src/hooks/useKeyboard.ts`).

---

## 0. TL;DR (что делаем в MVP)

- Новый слот оружия `WEAPON_CONFIG[4]` c `type: 'melee'`, бинд **клавиша 5 (`Digit5`)**.
- FPS-модель клинка из боксов (неоновый blade) в существующем `weaponRef`, видим только когда
  `currentWeapon === 4` (пушка прячется).
- ЛКМ (`keys.shoot`) при выбранном клинке = **замах**: конечный автомат
  `idle → windup → active → recover`, тайминги в мс, анимация — **локальный transform клинка**
  (`bladeRef.rotation`), НЕ time-scale.
- В момент входа в `active` — один **конусный хит-тест** (веер коротких raycast'ов по
  `scene.children`, дедуп по id), дистанция ~3.0u, полу-угол ~35°, мульти-хит.
- На каждого попавшего **AI-врага**: `damageEnemy(id, dmg, point)` + `fireHitmarker` + большой
  **нокбэк-импульс** на его Rapier-теле (forward + up) + `addTrauma` + звук удара + slash-VFX.
  На **игрока**: `socket.emit('hit', ...)` (как сейчас у ranged); импульс — только локально-косметически.
- Промах (whiff) = свист + маленький шейк, без импульса, отдельный звук.
- **Hit-stop ЗАПРЕЩЁН.** Мясистость даём шейком + нокбэком + звуком + панчем камеры.
- Seam под рэгдолл: `ragdollize?.(id, impulse, point)` — интерфейс определён здесь, реализация в №10.

**LATER:** комбо (3-hit), несколько типов клинка (бита/катана/тесак), блок/парри,
заряженный тяжёлый удар, swept-capsule вместо веера, LOS-окклюзия сквозь стены.

---

## 1. Слот оружия и бинд

### 1.1. Почему клавиша 5 (`Digit5`), а не V / средняя-кнопка

Занятые бинды (реальный код):

| Бинд | Где | Что |
|------|-----|-----|
| `Digit1..Digit4` | `Player.tsx` useEffect (keydown) | выбор оружия `setWeapon(0..3)` |
| `KeyV` | `Player.tsx` useEffect | тумблер камеры FPS/TPS (`setIsThirdPerson`) |
| `KeyF` | `useKeyboard.ts` → `keys.command` | команда миньонам |
| `Q` (radial) | зарезервировано владельцем | радиальное меню |
| `Space/WASD/ЛКМ` | `useKeyboard.ts` | движение/прыжок/огонь |

`Digit5` **свободен** и логично продолжает ряд `1-4` — холодное оружие как обычный слот
(Quake/CS-семантика «оружие = слот»). Владелец просил «холодное оружие», т.е. вооружение, а не
пассивный жест — слот 5 читается однозначно.

**Рекомендация MVP:** клинок = выбираемый слот `Digit5`, огонь = ЛКМ (`keys.shoot`), тем же
инпутом что и стрельба. Никакой правки `useKeyboard.ts` не нужно.

**LATER (зарезервировано, не в MVP):** «быстрый мили без смены оружия» на **среднюю кнопку
мыши** (`mousedown` `e.button === 1`) — свободна, не конфликтует. Тогда добавится `keys.melee` в
`useKeyboard.ts` и ветка «quick-melee поверх текущей пушки». В MVP не делаем.

### 1.2. Точка вставки бинда в `Player.tsx`

В существующем `handleKeyDown` (там где `Digit1..Digit4`):

```ts
if (e.code === 'Digit5') setWeapon(4);   // ← добавить
```

`setWeapon` в сторе уже `(index) => set({ currentWeapon: index })` — правок стора для выбора не
нужно. `WEAPON_CONFIG[currentWeapon]` при `currentWeapon === 4` вернёт melee-конфиг (см. §2).

---

## 2. Конфиг оружия (store/config)

### 2.1. `WEAPON_CONFIG` в `Player.tsx`

Добавить 5-й элемент. Поля совместимы с текущей формой (там уже разнородные поля:
`spread/rays/type/thick`), поэтому — тот же нетипизированный массив, новые поля опциональны.

```ts
const WEAPON_CONFIG = [
  { rate: 120,  damage: 15,  recoil: 0.1, sound: 800 },
  { rate: 800,  damage: 10,  recoil: 0.4, sound: 200, spread: 0.1, rays: 8 },
  { rate: 400,  damage: 40,  recoil: 0.2, sound: 400, type: 'projectile' },
  { rate: 1500, damage: 120, recoil: 0.6, sound: 100, thick: true },
  // 4 — MELEE / НЕОНОВЫЙ КЛИНОК
  {
    type: 'melee',
    damage: 55,          // сильный, но не ваншот обычного врага (hp 100)
    recoil: 0.30,        // переиспользуем канал камеры-панча (см. §4)
    sound: 0,            // melee использует свои звуки, не playShootSound(freq)
    // тайминги замаха (мс) — драйвятся из useFrame, НЕ setTimeout, НЕ time-scale
    windupMs: 90,        // «взвод» — клинок уводится назад/вверх
    activeMs: 90,        // окно урона — конусный хит-тест срабатывает в начале active
    recoverMs: 180,      // возврат в стойку
    cooldownMs: 90,      // «мёртвое» время после recover до следующего замаха
    // геометрия удара
    range: 3.0,          // досягаемость (u), 2.5–3.5 диапазон вкуса
    arcDeg: 70,          // ПОЛНЫЙ угол конуса (полу-угол = 35°)
    fanRays: 7,          // сколько лучей в веере (гориз. + пара верт.)
    maxHits: 4,          // потолок целей за один замах (мульти-хит)
    // нокбэк
    knockback: 26,       // импульс вдоль forward (u·mass/s; масса врага = 1)
    knockUp: 8,          // импульс вверх (подброс — красиво парится с дебрисом/рэгдоллом)
    heavy: true,         // помечает удар как «тяжёлый» → триггер рэгдолла в №10 (см. §5)
  },
];
```

> Тюнинг всех чисел — в §7. `sound: 0` — маркер «свои звуки»; melee-ветка не зовёт
> `playShootSound(config.sound)`.

### 2.2. Хелпер конфига (без магических индексов)

Рядом с `WEAPON_CONFIG`:

```ts
const MELEE_INDEX = 4;
const isMelee = (cfg: any) => cfg?.type === 'melee';
```

### 2.3. UI (`UI.tsx`)

- `WEAPON_NAMES` → добавить 5-е имя:
  ```ts
  const WEAPON_NAMES = ['AUTO RIFLE', 'SPREAD GUN', 'PLASMA LAUNCHER', 'RAILGUN', 'PLASMA BLADE'];
  ```
- Подсказка бинда `[1-4] SWITCH` → `[1-5] SWITCH`.
- `Hitmarker` уже слушает `onHitmarker` — melee переиспользует его без правок UI.

### 2.4. Стор (`store.ts`)

Для MVP **логика урона не меняется** — melee зовёт существующий `damageEnemy(id, amount, pos)`
(он уже даёт цифры урона, дебрис при смерти, `lastDeathFx`, счёт). Единственное добавление —
**реестр Rapier-тел** для нокбэка/рэгдолла (см. §3.3), это отдельный модуль, а не поле стора.

---

## 3. Механика замаха и хит-тест

### 3.1. Конечный автомат (per-frame, без setTimeout)

Новые ref'ы в компоненте `Player` (рядом с `recoilAmt`, `muzzleFade`):

```ts
type MeleePhase = 'idle' | 'windup' | 'active' | 'recover';
const meleePhase   = useRef<MeleePhase>('idle');
const meleePhaseT  = useRef(0);                 // мс, прошедшие в текущей фазе
const meleeCдown   = useRef(0);                 // мс оставшегося кулдауна
const meleeHitIds  = useRef<Set<string>>(new Set()); // дедуп попаданий за замах
const meleeDidTest = useRef(false);             // хит-тест уже проведён в этом active
```

Ref'ы под модель/VFX:

```ts
const bladeRef  = useRef<THREE.Group>(null);    // локальная группа клинка (для анимации замаха)
const slashRef  = useRef<THREE.Mesh>(null);     // emissive slash-дуга
const slashFade = useRef(0);
```

Пред-аллокации (module scope, рядом с `_recoilVec/_endPoint` — **никаких new в useFrame**):

```ts
const _mForward = new THREE.Vector3();
const _mRight   = new THREE.Vector3();
const _mUp      = new THREE.Vector3(0, 1, 0);
const _mOrigin  = new THREE.Vector3();
const _mRayDir  = new THREE.Vector3();
const _mImpulse = new THREE.Vector3();
const _mHitPoint= new THREE.Vector3();
const _mQuat    = new THREE.Quaternion();
// углы веера (радианы), гориз. разброс + 2 верт. — заполняются один раз
const MELEE_FAN = [ -1, -0.66, -0.33, 0, 0.33, 0.66, 1 ]; // множители полу-угла (fanRays=7)
```

### 3.2. Порядок в `useFrame` (точная точка вставки)

Вставить **отдельный melee-блок ПЕРЕД** блоком `// Shooting logic`
(`if (keys.shoot && now - lastShootTime > config.rate)`), и **защитить ranged-блок** от
melee-конфига, чтобы ЛКМ по клинку не пыталась хитсканить:

```ts
const config = WEAPON_CONFIG[currentWeapon];

// ============ MELEE (инкремент 09) ============
if (isMelee(config)) {
  advanceMelee(delta, now, config);   // см. §3.4 — весь автомат + хит-тест + VFX/звук
} else {
  // ---- существующий ranged-блок целиком остаётся здесь ----
  if (keys.shoot && now - lastShootTime > config.rate) {
    // ... projectile / hitscan без изменений ...
  }
}
// ============ /MELEE ============
```

> `advanceMelee` — локальная функция-замыкание внутри `Player` (видит camera/scene/world/rapier/
> ref'ы). Не хук, вызывается раз за кадр только когда выбран клинок. Альтернатива —
> заинлайнить; функция чище для ревью.

Анимация модели клинка и fade slash-трейла — тоже в `advanceMelee` (единый источник времени =
`meleePhaseT`), рядом с уже существующими per-frame fade-блоками (muzzle/laser).

### 3.3. Реестр Rapier-тел врагов (для нокбэка и рэгдолла)

Проблема: raycast по `scene.children` даёт **меш** (`userData.isEnemy + id`) и живую точку
попадания, но НЕ даёт Rapier-`RigidBody`, которому нужно `applyImpulse`. Стор-позиция врага
(`enemy.position`) — это позиция **спавна**, она не обновляется (движение живёт в Rapier-теле в
`Enemies.tsx`), поэтому конус по стор-позициям бил бы по призракам. Значит: цели ищем raycast'ом
(живые позиции), а тело берём из реестра по id.

**Новый модуль `src/game/bodies.ts`:**

```ts
import type { RapierRigidBody } from '@react-three/rapier';

// id врага → его Rapier-тело. Заполняется/чистится в Enemies.tsx.
const bodies = new Map<string, RapierRigidBody>();

export const registerBody   = (id: string, rb: RapierRigidBody) => bodies.set(id, rb);
export const unregisterBody = (id: string) => bodies.delete(id);
export const getBody        = (id: string) => bodies.get(id);
```

**Правка `Enemies.tsx`** (в `EnemyMesh`, у которого уже есть `rbRef`):

```ts
import { registerBody, unregisterBody } from '../game/bodies';

useEffect(() => {
  if (rbRef.current) registerBody(id, rbRef.current);
  return () => unregisterBody(id);
}, [id]);
```

Реестр — общий seam: им же пользуется рэгдолл (№10), чтобы найти тело и «уронить» его.

### 3.4. `advanceMelee` — псевдокод (полный)

```ts
function advanceMelee(delta: number, now: number, cfg: any) {
  const dtMs = delta * 1000;
  if (meleeCдown.current > 0) meleeCдown.current -= dtMs;

  // --- запуск замаха ---
  if (meleePhase.current === 'idle' && keys.shoot && meleeCдown.current <= 0) {
    meleePhase.current = 'windup';
    meleePhaseT.current = 0;
    meleeDidTest.current = false;
    meleeHitIds.current.clear();
    playSwooshSound();                 // свист замаха (см. §4)
  }

  // --- продвижение фазы ---
  if (meleePhase.current !== 'idle') {
    meleePhaseT.current += dtMs;

    if (meleePhase.current === 'windup' && meleePhaseT.current >= cfg.windupMs) {
      meleePhase.current = 'active'; meleePhaseT.current = 0;
    }
    if (meleePhase.current === 'active') {
      if (!meleeDidTest.current) {      // хит-тест ОДИН раз в начале active
        meleeDidTest.current = true;
        doMeleeHitTest(cfg);           // §3.5
        triggerSlashVFX();             // §4 — включить/сбросить дугу
      }
      if (meleePhaseT.current >= cfg.activeMs) {
        meleePhase.current = 'recover'; meleePhaseT.current = 0;
      }
    }
    if (meleePhase.current === 'recover' && meleePhaseT.current >= cfg.recoverMs) {
      meleePhase.current = 'idle'; meleePhaseT.current = 0;
      meleeCдown.current = cfg.cooldownMs;
    }
  }

  animateBlade(cfg);        // §6 — bladeRef.rotation по фазе (eased)
  fadeSlash(delta);         // §4 — затухание slash-дуги
}
```

> Мульти-хит «один тест в начале active» = чистый single-sweep. Если позже захочется тянущийся
> удар (бита), тест можно гонять каждый кадр active с дедупом по `meleeHitIds` — Set уже готов.

### 3.5. Конусный хит-тест — `doMeleeHitTest` (геометрия)

Веер коротких raycast'ов из глаза вдоль forward, разложенных по горизонтали на полу-угол, +2 луча
с вертикальным наклоном (чтобы ловить низких/высоких врагов). Переиспользуем ровно ту же
трассировку `scene.children`, что и ranged, и тот же обход `userData.isEnemy/isPlayer`.

```ts
function doMeleeHitTest(cfg: any) {
  const half = THREE.MathUtils.degToRad(cfg.arcDeg) * 0.5;
  camera.getWorldDirection(_mForward);                 // единичный forward
  _mRight.crossVectors(_mForward, _mUp).normalize();   // право (для горизонт. веера)
  _mOrigin.copy(camera.position);

  let hits = 0;
  const targets: string[] = [];        // игроки (для socket 'hit'), дедуп ниже

  for (let i = 0; i < cfg.fanRays && hits < cfg.maxHits; i++) {
    const yaw = MELEE_FAN[i] * half;                   // горизонтальный разброс
    const pitch = (i % 3 === 0) ? MELEE_FAN[i] * half * 0.4 : 0; // лёгкий верт. на крайних
    // dir = forward, повёрнутый на yaw вокруг up и pitch вокруг right
    _mRayDir.copy(_mForward)
      .applyAxisAngle(_mUp, yaw)
      .applyAxisAngle(_mRight, pitch)
      .normalize();

    raycaster.current.set(_mOrigin, _mRayDir);
    raycaster.current.near = 0;
    raycaster.current.far  = cfg.range;                // ← дальность = длина клинка
    const intersects = raycaster.current.intersectObjects(scene.children, true);

    for (const h of intersects) {
      // стена/пол раньше врага — луч перекрыт, дальше не идём (LOS для этого луча)
      if (h.object.userData?.isWall || h.object.userData?.isFloor) break;

      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData?.isEnemy) {
          const id = obj.userData.id as string;
          if (!meleeHitIds.current.has(id)) {
            meleeHitIds.current.add(id);
            hits++;
            _mHitPoint.copy(h.point);
            if (obj.userData?.isPlayer) {
              targets.push(id);                         // игрок → сервер
            } else {
              resolveMeleeHitEnemy(id, cfg);            // §3.6 — AI-враг локально
            }
          }
          break;
        }
        obj = obj.parent;
      }
      if (hits >= cfg.maxHits) break;
    }
  }

  // игроки: server-authoritative урон (как ranged), импульс НЕ синкаем
  for (const id of targets) {
    socket.emit('hit', { targetId: id, damage: cfg.damage });
    useStore.getState().addDamageNumber(
      [_mHitPoint.x, _mHitPoint.y, _mHitPoint.z], cfg.damage, '#4361ee');
    fireHitmarker(false);
    applyMeleeKnockback(id, cfg);        // косметический локальный импульс, если тело есть
  }

  // общий фидбек по факту «замах во что-то попал / промах»
  if (hits > 0) {
    addTrauma(0.28);                     // панч камеры на КОНТАКТ (сильнее выстрела)
    recoilAmt.current = Math.min(1.2, recoilAmt.current + cfg.recoil);
    playMeleeHitSound();                 // мясистый удар (§4)
  } else {
    addTrauma(0.05);                     // whiff — еле-еле
    // свист уже сыгран на старте замаха; отдельного «промах»-звука достаточно свиста
  }
}
```

Замечания:
- `break` на стене/полу даёт дешёвую LOS-окклюзию **на луч** (не бьём сквозь стену в упор).
- Веер + Set-дедуп = честный мульти-хит по конусу без дублей.
- Ноль аллокаций: все вектора пред-аллоцированы; `targets`/массив — крайне редкий путь (обычно
  0–1 игрок рядом); при желании заменить на 2 ref-поля, но для читаемости оставляю локальный.

**LATER (точнее, но дороже):** вместо веера — `world.intersectionsWithShape` Rapier'а с
capsule/cone-формой (истинный swept-объём), либо `castShape`. Даёт объёмное перекрытие и тела
напрямую; но требует ручного маппинга collider→id. Для MVP веер+реестр проще и консистентнее с
ranged.

### 3.6. Резолв по AI-врагу — `resolveMeleeHitEnemy`

```ts
function resolveMeleeHitEnemy(id: string, cfg: any) {
  // 1) урон (даёт цифры урона + дебрис при смерти + счёт + lastDeathFx)
  useStore.getState().damageEnemy(id, cfg.damage,
    [_mHitPoint.x, _mHitPoint.y, _mHitPoint.z]);
  // 2) хитмаркер
  fireHitmarker(false);
  // 3) нокбэк-импульс на теле Rapier (или рэгдолл-триггер — §5)
  applyMeleeKnockback(id, cfg);
  // 4) искры в точке удара (переиспользуем sparkGeometry/sparkMaterialEnemy)
  spawnMeleeSparks(_mHitPoint);
}
```

`spawnMeleeSparks` — тот же паттерн, что sparks в ranged-блоке (создать несколько
`THREE.Mesh(sparkGeometry, sparkMaterialEnemy)`, `scene.add`, `setTimeout` remove ~120мс), можно
вынести в общий хелпер и звать из обоих мест.

### 3.7. Нокбэк-импульс — `applyMeleeKnockback`

```ts
function applyMeleeKnockback(id: string, cfg: any) {
  const rb = getBody(id);              // §3.3 реестр; для remote-игроков тела может не быть
  if (!rb) return;                     // нет локального тела → импульс пропускаем (норм)

  // направление = forward камеры + вверх (подброс)
  _mImpulse.copy(_mForward).multiplyScalar(cfg.knockback);
  _mImpulse.y += cfg.knockUp;

  if (cfg.heavy && ragdollize) {       // §5 — тяжёлый удар роняет в рэгдолл (когда №10 готов)
    ragdollize(id, _mImpulse, _mHitPoint);
  } else {
    rb.applyImpulse({ x: _mImpulse.x, y: _mImpulse.y, z: _mImpulse.z }, true);
    // опционально — закрутка для «мяса»:
    rb.applyTorqueImpulse({ x: 0, y: (Math.random() - 0.5) * 6, z: 0 }, true);
  }
}
```

> `applyImpulse` при `mass = 1` (враги в `Enemies.tsx` `mass={1}`, `linearDamping={2}`): импульс
> `26` вдоль forward даёт заметный, но затухающий отлёт. `knockUp: 8` подбрасывает — красиво
> ложится на дебрис при добивании и на рэгдолл в №10.

---

## 4. Feel / juice (без искажения времени)

Владелец и `00-README.md` категоричны: **никакого time-scale / hit-stop / slow-mo** — это
онлайн. Мясо строим на: шейке, нокбэке, панче камеры, вспышке/трейле, звуке.

### 4.1. Звук (`audio.ts`) — 2 новые функции

```ts
// Свист замаха — короткий восходящий «вжух» (шумовой, фильтр движется вверх)
export const playSwooshSound = () => { /* bandpass-шум 0.12с, freq 400→1600, gain 0.12→0.01 */ };

// Мясистый удар клинком — низкий «чанк» + короткий металлический клэнг
export const playMeleeHitSound = () => {
  // A) sine 160→50 Гц, 0.12с, gain 0.3 (телесный удар)
  // B) triangle 900→400 Гц, 0.06с, gain 0.12 (клэнг клинка)
  // оба через один audioCtx.currentTime; переиспользовать паттерн playExplosionSound
};
```

- **Хит vs whiff различимы:** whiff = только `playSwooshSound` (на старте замаха). Хит =
  swoosh (старт) + `playMeleeHitSound` (в контакт). Если попали — слышен «вжух+чанк», если
  промах — только «вжух».
- Для добивания-в-крупного (candle) можно доп. `playExplosionSound()` уже есть — вызвать при
  `hits > 0 && крупная цель` (опционально, LATER).

### 4.2. Slash-трейл (emissive-дуга)

Пред-созданный меш (как `laserRef`/`muzzleRef`), не аллоцируем в кадре. Тонкая изогнутая полоса
(`ringGeometry` сегментом или узкий изогнутый `planeGeometry`), emissive неон, `toneMapped:false`,
`transparent`, `depthWrite:false`. Живёт как ребёнок `weaponRef` (движется с камерой) со смещением
перед клинком.

```ts
// в JSX, внутри <group ref={weaponRef}> рядом с blade:
<mesh ref={slashRef} position={[0.15, -0.2, -1.1]} visible={false}>
  <ringGeometry args={[0.9, 1.15, 24, 1, 0, Math.PI * 0.9]} /> {/* дуга ~160° */}
  <meshBasicMaterial color="#00f5d4" transparent opacity={0} toneMapped={false} depthWrite={false} />
</mesh>
```

Управление (в `advanceMelee`):

```ts
function triggerSlashVFX() {                 // в начале active
  if (!slashRef.current) return;
  slashFade.current = 1;
  slashRef.current.visible = true;
  slashRef.current.rotation.z = -1.1;        // старт дуги
  (slashRef.current.material as THREE.MeshBasicMaterial).opacity = 0.9;
}
function fadeSlash(delta: number) {          // каждый кадр
  if (!slashRef.current || slashFade.current <= 0) return;
  slashFade.current = Math.max(0, slashFade.current - delta * 6); // ~0.16с
  slashRef.current.rotation.z += delta * 14; // «прочерк» дуги по ходу свинга
  const m = slashRef.current.material as THREE.MeshBasicMaterial;
  m.opacity = slashFade.current * 0.9;
  slashRef.current.visible = slashFade.current > 0.01;
}
```

### 4.3. Панч камеры + шейк

- На контакт (`hits > 0`): `addTrauma(0.28)` + `recoilAmt.current += cfg.recoil` — переиспользуем
  оба канала из §04 (позиционный шейк + кик отдачи, оба PLC-safe, не трогают yaw/pitch).
- Промах: `addTrauma(0.05)` — почти незаметный «свист воздуха».
- **Hit-stop запрещён** — не ставим `world.timestep`/rAF-паузы/`setTimeout`-фризы. Ощущение
  «веса» = амплитуда шейка + резкий нокбэк тела, а не остановка времени.

---

## 5. Привязка к рэгдоллу (инкремент 10) — seam, без реализации

Тяжёлый мили-удар — естественный триггер «уронить существо в рэгдолл с этим импульсом». №10
владеет физикой рэгдолла; №09 лишь предоставляет вызов.

**Новый модуль `src/game/ragdoll.ts` (создаётся здесь как пустой seam):**

```ts
import type * as THREE from 'three';

export type RagdollFn = (
  entityId: string,        // id врага (ключ реестра bodies.ts)
  impulse: THREE.Vector3,  // мировой импульс (forward*knockback + up)
  hitPoint: THREE.Vector3, // точка попадания (для точки приложения силы)
) => void;

// Инкремент 10 регистрирует реальную реализацию; до этого — null (no-op).
export let ragdollize: RagdollFn | null = null;
export const registerRagdoll = (fn: RagdollFn | null) => { ragdollize = fn; };
```

- В §09 `applyMeleeKnockback` уже вызывает `ragdollize?.(id, _mImpulse, _mHitPoint)` при
  `cfg.heavy`. Пока №10 не зарегистрировал функцию — `ragdollize` = `null`, и мы падаем в обычный
  `applyImpulse` (см. ветку в §3.7). Т.е. MVP работает и без рэгдолла, а №10 включается «бесшовно».
- Контракт для №10: `ragdollize` **сам** решает — заменить кинематическое тело врага цепочкой
  суставов/капсул и приложить `impulse` в `hitPoint`, либо просто применить импульс + пометить
  «мёртв/тряпка». №09 не знает деталей и не должен.
- Порог «тяжести»: сейчас `cfg.heavy: true` для единственного клинка → любой его хит — тяжёлый.
  Когда появится заряженный удар/лёгкие клинки (LATER), `heavy` станет зависеть от заряда/типа, и
  только тяжёлые будут ронять в рэгдолл; лёгкие — просто нокбэк.

---

## 6. FPS-модель клинка и анимация замаха

### 6.1. Модель (боксы, как текущая пушка)

Внутри существующей `<group ref={weaponRef}>` добавить под-группу клинка. Неоновый blade из
боксов: рукоять + гарда + светящееся лезвие (emissive).

```tsx
<group ref={bladeRef} position={[0.35, -0.35, -0.7]} visible={false}>
  {/* рукоять */}
  <mesh position={[0, 0, 0.25]}>
    <boxGeometry args={[0.06, 0.06, 0.28]} />
    <meshStandardMaterial color="#222" />
  </mesh>
  {/* гарда */}
  <mesh position={[0, 0, 0.08]}>
    <boxGeometry args={[0.22, 0.05, 0.05]} />
    <meshStandardMaterial color="#444" metalness={0.8} roughness={0.3} />
  </mesh>
  {/* лезвие (светится) */}
  <mesh position={[0, 0, -0.55]}>
    <boxGeometry args={[0.07, 0.02, 1.1]} />
    <meshStandardMaterial color="#00f5d4" emissive="#00f5d4" emissiveIntensity={1.4} toneMapped={false} />
  </mesh>
</group>
```

### 6.2. Переключение видимости пушка↔клинок

Сейчас `weaponRef.visible = !isThirdPerson`, а под-меш пушки = `weaponRef.current.children[0]`
(его дёргает recoil). Заводим явные ref'ы вместо индекса детей и переключаем по `currentWeapon`:

- В per-frame секции «Weapon sway/visible» добавить:
  ```ts
  const meleeSelected = currentWeapon === MELEE_INDEX;
  if (gunGroupRef.current)  gunGroupRef.current.visible  = !isThirdPerson && !meleeSelected;
  if (bladeRef.current)     bladeRef.current.visible     = !isThirdPerson &&  meleeSelected;
  if (muzzleRef.current && meleeSelected) muzzleRef.current.visible = false;
  ```
  (Обернуть текущую пушку+muzzle в `<group ref={gunGroupRef}>` — маленькая правка JSX.)
- Существующий recoil-твик `weaponRef.current.children[0]` в ranged-ветке не тронется — melee
  идёт своей веткой и своей анимацией `bladeRef`.

### 6.3. Анимация замаха — `animateBlade` (локальный transform, НЕ time-scale)

`weaponRef` каждый кадр копирует позу камеры, поэтому анимируем **локальную** позу `bladeRef`
(его rotation/position), как gun-recoil дёргает `children[0].position.z`. Драйвер — фаза + прогресс
`meleePhaseT / phaseMs`, eased.

Ключевые позы (rest → windup → active-конец → recover→rest):

| Фаза | `rotation.x` | `rotation.z` | `position.z` | смысл |
|------|-------------|-------------|-------------|-------|
| rest (idle) | 0 | 0 | −0.70 | стойка |
| windup (конец) | −0.5 | +0.6 | −0.55 | занос назад-вверх-вправо |
| active (конец) | +0.4 | −1.3 | −0.95 | резкий диагональный рубящий свинг влево-вниз-вперёд |
| recover→rest | → 0 | → 0 | → −0.70 | плавный возврат |

```ts
function animateBlade(cfg: any) {
  if (!bladeRef.current) return;
  const b = bladeRef.current;
  const p = meleePhase.current;
  const prog = (ms: number) => Math.min(1, meleePhaseT.current / ms); // 0..1 в фазе
  const ease = (t: number) => t * t * (3 - 2 * t); // smoothstep

  if (p === 'idle') {
    // мягко тянем к стойке (на случай выхода из recover)
    b.rotation.x += (0 - b.rotation.x) * 0.3;
    b.rotation.z += (0 - b.rotation.z) * 0.3;
    b.position.z += (-0.70 - b.position.z) * 0.3;
  } else if (p === 'windup') {
    const t = ease(prog(cfg.windupMs));
    b.rotation.x = -0.5 * t;
    b.rotation.z =  0.6 * t;
    b.position.z = -0.70 + 0.15 * t;
  } else if (p === 'active') {
    const t = ease(prog(cfg.activeMs));               // быстрый мах из заноса
    b.rotation.x = -0.5 + ( 0.4 - (-0.5)) * t;
    b.rotation.z =  0.6 + (-1.3 -   0.6 ) * t;
    b.position.z = -0.55 + (-0.95 - (-0.55)) * t;
  } else { // recover
    const t = ease(prog(cfg.recoverMs));
    b.rotation.x =  0.4 * (1 - t);
    b.rotation.z = -1.3 * (1 - t);
    b.position.z = -0.95 + (-0.70 - (-0.95)) * t;
  }
}
```

Никаких `setTimeout` для анимации (в отличие от gun-recoil, который их использует) — всё от
`meleePhaseT`, что делает замах устойчивым к фреймрейту и полностью совместимым с «нет time-scale».

---

## 7. Тюнинг-таблица

| Параметр | Значение (MVP) | Диапазон вкуса | Эффект |
|----------|----------------|----------------|--------|
| `damage` | 55 | 40–80 | 2 удара на обычного (hp100); не ваншот |
| `range` | 3.0 u | 2.5–3.5 | досягаемость клинка |
| `arcDeg` | 70° | 50–90 | ширина конуса (мульти-хит по толпе) |
| `fanRays` | 7 | 5–9 | плотность веера (дырки vs стоимость) |
| `maxHits` | 4 | 2–6 | потолок целей за замах |
| `windupMs` | 90 | 60–140 | «телеграф» замаха; больше = читаемее, но вязче |
| `activeMs` | 90 | 60–120 | окно урона |
| `recoverMs`| 180 | 120–260 | восстановление (темп) |
| `cooldownMs`| 90 | 0–200 | пауза до след. замаха |
| **эфф. rate** | ~450 мс/удар | — | windup+active+recover+cd |
| `knockback`| 26 | 15–40 | отлёт вдоль forward |
| `knockUp` | 8 | 0–14 | подброс вверх |
| trauma (hit) | 0.28 | 0.18–0.4 | панч камеры на контакт |
| trauma (whiff)| 0.05 | 0–0.1 | свист |
| slash fade | ~0.16 c | 0.1–0.25 | длина «прочерка» дуги |

Заметки по физике: враг `mass=1`, `linearDamping=2` (`Enemies.tsx`) — импульс 26 даёт резкий
короткий отлёт (демпфер быстро гасит), что и нужно для «удара», а не «пинка в космос». Если
владельцу мало «мяса» — растить `knockback`+`knockUp` вместе (плоский отлёт без подброса читается
слабее).

---

## 8. Сетевая модель (явно)

Согласовано с «networked from start» и бэкбоном мультиплеера (join/update/**shoot**/**hit**/death):

- **Урон по игроку** — server-authoritative через существующий путь `socket.emit('hit', { targetId,
  damage })` (тот же, что у ranged). Сервер применяет урон/смерть. Melee НЕ вводит новый серверный
  путь урона.
- **Урон по локальным AI-врагам** — локально, ровно как ranged сегодня (`damageEnemy` в сторе).
  AI-враги не сетевые сущности.
- **Нокбэк-импульс** на теле — **косметика, локально, НЕ синкается** (как дебрис/воксели в №02).
  Каждый клиент видит свой отлёт; авторитет — только HP/смерть на сервере. Никаких «per-hit
  impulse» сообщений.
- **Рэгдолл** (№10) — так же локально-косметичен; импульс, переданный в `ragdollize`, не уходит в
  сеть.
- Свист/удар/искры/slash/шейк — чисто клиентские, не синкаются.

Итого новых сетевых сообщений melee **не добавляет** — переиспользует `hit`.

---

## 9. Точки вставки (чек-лист правок кода)

| Файл | Правка |
|------|--------|
| `Player.tsx` | `WEAPON_CONFIG[4]` (§2.1); `MELEE_INDEX`/`isMelee` (§2.2); бинд `Digit5→setWeapon(4)` (§1.2); ref'ы melee-автомата + пред-аллокации (§3.1); блок `if (isMelee(config)) advanceMelee() else {ranged}` в useFrame (§3.2); функции `advanceMelee/doMeleeHitTest/resolveMeleeHitEnemy/applyMeleeKnockback/animateBlade/triggerSlashVFX/fadeSlash/spawnMeleeSparks` (§3–4,6); JSX: `gunGroupRef`-обёртка пушки, `bladeRef`-группа клинка, `slashRef`-дуга (§6); переключение видимости по `currentWeapon` (§6.2) |
| `store.ts` | правок логики урона НЕ требуется (melee зовёт существующий `damageEnemy`) |
| `game/bodies.ts` | **новый** реестр `registerBody/unregisterBody/getBody` (§3.3) |
| `game/ragdoll.ts` | **новый** seam `ragdollize`/`registerRagdoll` (§5) |
| `Enemies.tsx` | `useEffect` регистрации `rbRef.current` в реестр по `id` (§3.3) |
| `audio.ts` | `playSwooshSound`, `playMeleeHitSound` (§4.1) |
| `UI.tsx` | `WEAPON_NAMES` +'PLASMA BLADE'; подсказка `[1-5]` (§2.3) |
| `useKeyboard.ts` | без изменений в MVP (ЛКМ=замах). Средняя-кнопка quick-melee = LATER |

Инвариант производительности: **ноль `new` в useFrame** — все вектора/кватернионы/цвета пред-
аллоцированы в module scope (как `_recoilVec`/`_endPoint`); реестр — `Map`; хит-тест ≤ `fanRays`
raycast'ов только в кадре входа в `active` (не каждый кадр). 60 fps держим.

---

## 10. Playtester checklist (владелец)

MVP считается готовым к плейтесту, когда:

- [ ] Клавиша **5** выбирает клинок; в HUD имя «PLASMA BLADE», пушка исчезает, виден неоновый blade.
- [ ] ЛКМ = замах: видимый **windup** (занос) → резкий **свинг** → возврат; темп ~2 удара/сек, не спам.
- [ ] По врагу в упор: **урон** (цифра), **хитмаркер**, **искры**, враг **отлетает** (forward+вверх).
- [ ] По **группе** врагов в конусе — задевает несколько (до 4), без двойного урона одному за замах.
- [ ] **Промах по воздуху**: слышен только свист, камера почти не трясётся, урона нет.
- [ ] **Хит vs промах** звучат по-разному (свист+чанк vs только свист).
- [ ] **Slash-дуга** прочерчивается на свинге и быстро гаснет.
- [ ] Панч камеры на контакт ощутимее, чем на выстрел; **время НЕ замедляется** нигде.
- [ ] Сквозь стену в упор врага **не бьёт** (луч перекрыт стеной).
- [ ] Добивание врага → он крошится в воксели (существующий дебрис) + счёт растёт.
- [ ] По удалённому игроку: уходит `hit` на сервер, локально видно цифру урона; отлёт (если тело
      есть) чисто визуальный.
- [ ] Стабильные 60 fps в свалке (нет фризов/GC-стоттера от замахов).

---

## 11. LATER (за рамками MVP)

- **Комбо**: 3-hit цепочка (A→B→C с разными позами/уронами и окном continue), сброс по таймауту.
- **Несколько типов холодного**: бита (широкий, больше нокбэк, меньше урон), катана (узкий, быстрый),
  тесак (медленный, тяжёлый, гарант-рэгдолл). Каждый — свой `WEAPON_CONFIG`-профиль; слот 5 листает
  их либо отдельные слоты.
- **Заряженный тяжёлый удар**: удержание ЛКМ → рост `damage/knockback/heavy`; только заряженный
  роняет в рэгдолл.
- **Блок/парри** (ПКМ): окно парирования снарядов/ударов → стан/рефлект.
- **Quick-melee** на среднюю кнопку без смены оружия (добавить `keys.melee` в `useKeyboard.ts`).
- **Swept-capsule/cone через Rapier** (`intersectionsWithShape`) вместо веера + LOS-окклюзия целиком.
- **Синк рэгдолл-поз** (если владелец захочет одинаковые тряпки у всех) — но это ломает «косметика
  локально»; по умолчанию НЕ делаем.
</content>
</invoke>
