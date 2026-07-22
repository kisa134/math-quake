# 10 — Ragdoll Physics (Humans & Creatures)

> Тела, которые **обмякают и разлетаются** сочно на смерти/тяжёлом хите — вместо текущего мгновенного исчезновения (`Enemies.tsx` просто фильтрует врага из массива + спавнит воксель-дебрис). Референсы: **Half-Life 2 / Source** (классический тряпичный ragdoll на joint-констрейнтах), **GMod** (жёсткие лимиты суставов = не «жвачка»), **Rain World / QWOP / Gang Beasts** (процедурная походка на моторах суставов — задел под инкремент 11), **Totally Accurate Battle Simulator** (active-ragdoll как основа геймплея), **Overgrowth / David Rosen "active ragdoll"** (смешивание анимации и физики).
>
> **Ключевое проектное требование (задаётся владельцем):** этот же риг должен обслуживать **ДВА режима на одном скелете** — `PASSIVE` (обмяк, суставы свободны в пределах лимитов = труп-ragdoll, ЭТОТ инкремент) и `ACTIVE` (суставы-моторы тянут к целевой позе = локомоция, **инкремент 11** + генетическая эволюция походки). Риг и его API проектируем сразу под оба; инкремент 10 реализует пассив + смерть-флоп, инкремент 11 надстраивает мышцы и GA поверх **того же** `game/ragdoll.ts`.
>
> **Сетевая модель (владелец выбрал «networked from start», привязка к backbone инкремента 05):** существо авторитетно на СЕРВЕРЕ как **корневой transform + состояние** (в т.ч. `'dead'`). Сервер **НЕ** симулирует суставы. Каждый КЛИЕНТ строит ragdoll локально и, пока существо живо, **пинит/тянет** его к интерполированному авторитетному корню; на смерти — **отпускает** в физику-обмяк с хит-импульсом (косметика, как дебрис — **никогда не синкается по суставам**). Разные клиенты покажут слегка разные позы трупа — это ок и незаметно. Разделение сделано явным в §3 и §7.

---

## 0. Что уже есть в коде (точка привязки)

Факты из репозитория — чтобы спека села на существующее, а не выдумывала.

**Враг сегодня (`src/components/Enemies.tsx`):**
```tsx
<RigidBody ref={rbRef} type="dynamic" linearDamping={2} angularDamping={1} mass={1}>
  <mesh userData={{ isEnemy: true, id }}>{geometry}<primitive object={material}/></mesh>
</RigidBody>
```
- **Одно** тело + один меш (torus/icosahedron/candle/…). `userData.isEnemy + id` — так его находит хитскан игрока (`Player.tsx:313-329` идёт вверх по `obj.parent`).
- Движется `applyImpulse` к игроку; стреляет; на контакте наносит урон и `removeEnemy`.
- **Смерть:** урон идёт в `store.damageEnemy(id, amount, pos)` (`store.ts:207`). При `health<=0` враг **выпадает** из `enemies[]`, `makeChunks()` кидает воксель-дебрис от точки удара, ставится `lastDeathFx`. Меш **мгновенно исчезает** — никакого тела/флопа.

**Дебрис-паттерн (`src/components/Debris.tsx`) — ЭТАЛОН дисциплины, который ragdoll копирует:**
- `CAP = 256`, единый `InstancedMesh`, **один draw call**, `frustumCulled={false}`.
- Все temp-объекты (`_m, _q, _e, _v, _s, _c`) в **модуль-скоупе** → **ноль аллокаций** в `useFrame`.
- Стор — только «spawn inbox»: на кадре смерти пушит чанки, компонент их **сливает в локальный пул**, чистит inbox, дальше интегрирует сам.
- **Oldest-out**: `if (pool.length > CAP) pool.splice(0, len-CAP)`. `dt = Math.min(dtRaw, 1/30)`. Фейд-хвост по `life`.
- Материал `MeshBasicMaterial({ toneMapped:false })` — «плоский неон, поп в темноте» под Bloom.

**Движок/сцена:**
- `Game.tsx`: `<Physics gravity={[0,-30,0]}>` — Rapier, гравитация −30 (не −9.8! тела падают «аркадно-тяжело» — риг тюнить под это).
- Пост — Bloom (`PostFX`), поэтому неон-эмиссив + `toneMapped=false`.
- Палитра `src/theme.ts`: мир — холодный (cyan `bull #00f5d4`, магента `bear #f72585`, синий `node #4361ee`, violet). **АКТОРЫ** (враги) имеют право на тёплый/alert (`enemyAmber #ffb703`, `alertRed`). Ragdoll — актор → неон-конечности из холодной актор-адаптации (см. §4).

**Версии физики (проверено в `node_modules`):**
| Пакет | Версия | Что даёт |
|---|---|---|
| `@react-three/rapier` | **2.2.0** | `<RigidBody>`, `useRapier()`, хуки суставов, `interactionGroups`, `RapierRigidBody` handle |
| `@dimforge/rapier3d-compat` | **0.19.2** | сырое `world.createImpulseJoint(JointData…, b1, b2, true)`, моторы `configureMotorPosition`, `RevoluteImpulseJoint.setLimits`, `joint.setContactsEnabled` |

Экспортируемые хуки суставов: `useSphericalJoint`, `useRevoluteJoint`, `useFixedJoint`, `usePrismaticJoint`, `useRopeJoint`, `useSpringJoint`.

> **Важное решение по API (см. §6):** React-хуки суставов требуют **фиксированной топологии** (нельзя в цикле переменной длины). Для ПУЛА ragdoll'ов разных планов (biped/quad/blob) хуки неудобны. Поэтому риг строим **императивно** через сырой Rapier: `world.createRigidBody` / `world.createImpulseJoint`, а меши вешаем ручными матрицами (как Debris), **не** через `<RigidBody>`-хуки. R3F-обёртки оставляем только для MVP-прототипа одного biped'а, если так быстрее (§13).

---

## 1. RIG — дизайн скелета из тел + суставов

### 1.1 Общие принципы (все планы)

- **Тело сустава = Rapier RigidBody** (`dynamic`), коллайдер — **капсула** (конечности/торс/шея) или **бокс** (таз/голова опц.). Капсулы дёшевы и не цепляются рёбрами.
- **Сустав = ImpulseJoint** между родителем и ребёнком:
  - **Spherical** (шар) — плечи, бёдра, шея, основание хвоста: 3 угловых DOF, естественный «болтается».
  - **Revolute** (шарнир) — колени, локти: 1 DOF, **`setLimits(min,max)`** первого класса, и **motor** первого класса (для ACTIVE).
- **Массы** — анатомично-заниженные (лёгкие конечности флопают живее; тяжёлый таз = якорь). Сумма ≈ 1.0 (как текущий `mass={1}` враг), чтобы импульсы/гравитация −30 читались привычно.
- **Демпфинг:** `linearDamping ≈ 0.5`, `angularDamping ≈ 3–6` на конечностях — гасит «вечное дрожание» тряпки в Rapier (главный источник джиттера, см. §риски). Таз/торс — `angularDamping ≈ 2`.
- **`ccd={false}`** на всех (CCD дорого, ×N тел; конечности мелкие, но медленные — обычный солвер ок). Включить CCD **точечно** только если пробивают пол на −30 (маловероятно при этих размерах).
- **Anchor'ы сустава** задаём в **локальных координатах КАЖДОГО тела** (`anchor1` на родителе, `anchor2` на ребёнке) — это точки стыка, обычно концы капсул.

### 1.2 BIPED (гуманоид) — основной план MVP

11 тел, 10 суставов. Ростом ~1.8 юнита (враг сейчас ~2 юнита — сопоставимо).

```
            [head]
              | (spherical, neck)
      +----[torso]----+
      |(sph) |  |(sph)|
 [upperArmL] |  | [upperArmR]
      |(rev) |  |(rev)|
 [foreArmL]  |  | [foreArmR]
              |(fixed/sph, spine)
           [pelvis]
       (sph)|      |(sph)
    [thighL]        [thighR]
      |(rev)          |(rev)
    [shinL]          [shinR]
```

| # | Часть | Коллайдер (полу-высота h, радиус r) | Масса | Сустав к родителю | Тип | Anchor (родитель→ребёнок) | Лимиты |
|---|---|---|---|---|---|---|---|
| 0 | pelvis | capsule h0.12 r0.16 (или box 0.32×0.24×0.18) | **0.22** | — (root тела) | — | — | — |
| 1 | torso | capsule h0.22 r0.17 | 0.24 | pelvis | spherical | pelvis top (0,0.18,0) → torso bottom (0,−0.22,0) | cone ≈ ±25° (свинг), твист ±20° |
| 2 | head | capsule h0.09 r0.13 | 0.08 | torso | spherical (neck) | torso top (0,0.24,0) → head bottom (0,−0.11,0) | cone ±40°, твист ±50° |
| 3 | upperArmL | capsule h0.16 r0.06 | 0.06 | torso | spherical | torso (−0.20,0.14,0) → arm top (0,0.16,0) | cone ±90°, твист ±60° |
| 4 | foreArmL | capsule h0.15 r0.05 | 0.045 | upperArmL | **revolute** (ось X, локоть) | upper bottom (0,−0.16,0) → fore top (0,0.15,0) | **[0, 150°]** (локоть гнётся в одну) |
| 5 | upperArmR | ↑ зеркально | 0.06 | torso | spherical | (+0.20,0.14,0) → (0,0.16,0) | как L |
| 6 | foreArmR | ↑ | 0.045 | upperArmR | revolute | как L | [0,150°] |
| 7 | thighL | capsule h0.20 r0.08 | 0.11 | pelvis | spherical | pelvis (−0.09,−0.16,0) → thigh top (0,0.20,0) | cone ±70° (вперёд-больше), твист ±25° |
| 8 | shinL | capsule h0.20 r0.06 | 0.075 | thighL | **revolute** (ось X, колено) | thigh bottom (0,−0.20,0) → shin top (0,0.20,0) | **[−150°, 0]** (колено назад) |
| 9 | thighR | ↑ зеркально | 0.11 | pelvis | spherical | (+0.09,−0.16,0) → (0,0.20,0) | как L |
| 10 | shinR | ↑ | 0.075 | thighR | revolute | как L | [−150°,0] |

> **Сумма масс ≈ 1.0.** Таз тяжёлый (0.22) = якорь, руки лёгкие = флопают. Спайн `pelvis→torso` можно сделать **spherical** (живее) или **fixed** (жёстче, дешевле солверу) — MVP: spherical с узким конусом ±25°.
> **Стопы/кисти** в MVP **не отдельные тела** — «впаяны» в shin/foreArm концы капсул. Дисмембермент/стопы для активной ходьбы — инкремент 11 (стопа как контактная точка критична для походки; заложить хук в §2, но тело не плодить сейчас).

### 1.3 QUADRUPED (later)

Тело + 4 ноги по 2 сегмента + шея + голова + опц. хвост. ~11–13 тел, 10–12 суставов.

| Группа | Тела | Сустав | Лимиты-ноты |
|---|---|---|---|
| spine | pelvisRear + torsoFront (2 бокса/капсулы) | spherical между ними | ±15° — позвоночник почти жёсткий |
| neck+head | neck, head | 2× spherical | шея свободнее (±45°) |
| нога ×4 | upperLeg + lowerLeg | бедро spherical (±60°), колено/локоть revolute [0,140°] | передние сгибаются вперёд, задние — назад (зеркалить знак лимита) |
| tail (опц.) | 2–3 капсулы цепью | spherical, слабый angularDamping | болтается для «жизни» |

Массы: torso+pelvis ~0.5 суммарно (тяжёлое ядро), ноги по ~0.08. Плоский, широкая база → на смерти заваливается набок сочно.

### 1.4 BLOB / SIMPLE (later, дешёвый)

2–4 тела. Для мелочи/роёв, где полный риг — перебор по перфу.

- **1-body «желе»:** одно тело + мягкий `angularDamping` низкий → просто кувыркается (почти как сегодня, но с вращением-флопом и хит-импульсом). Это **fallback-план** для дальних/массовых врагов.
- **3-body «слизень»:** голова-тело-хвост капсулы, 2 spherical, cone ±35°. Дёшево, но уже «живой» вихляж.

### 1.5 Коллизия и группы (анти-джиттер — критично)

Rapier: `collisionGroups` = 32-бит (старшие 16 = membership, младшие 16 = filter). Хелпер `interactionGroups(memberships[], filters[])` из `@react-three/rapier`.

**Правила, чтобы конечности НЕ дрожали друг о друга и о собственную капсулу:**
1. **Соседние по суставу тела НЕ коллидируют** — `joint.setContactsEnabled(false)` на КАЖДОМ суставе (плечо не толкается о торс, колено о бедро). Это первичный анти-джиттер.
2. **Несоседние части ОДНОГО ragdoll коллидируют** (рука не проходит сквозь торс) — но это дорого и часто визуально не нужно на трупе → **опция `selfCollide` в плане**. MVP biped: `selfCollide=false` (все тела одного ragdoll в своей группе, между собой не сталкиваются) → **максимально дёшево и стабильно**; later — включить точечно (кисти↔ноги).
3. **Ragdoll ↔ мир** (пол/стены/рельсы/поезд `userData.isFloor/isWall`) — **всегда ДА**. Это весь смак флопа.
4. **Ragdoll ↔ другой ragdoll** — **НЕТ** в MVP (перф; трупы проваливаются друг в друга — незаметно). Membership на ragdoll'ы одна и та же, filter не включает эту же группу.
5. **Ragdoll ↔ игрок-капсула** — **НЕТ** (труп не должен толкать/блокировать игрока). 

```ts
// game/ragdoll.ts — битовые группы
const G_WORLD    = 0b0001;  // пол/стены/поезд (их membership, не наша забота — уже есть)
const G_RAGDOLL  = 0b0010;  // все кости всех ragdoll'ов
const G_PLAYER   = 0b0100;
// каждая кость: member = RAGDOLL, filter = WORLD (и опц. RAGDOLL если selfCollide)
const boneGroups = interactionGroups(G_RAGDOLL, selfCollide ? [G_WORLD, G_RAGDOLL] : [G_WORLD]);
```
> `solverGroups` оставляем = `collisionGroups` (по умолчанию). Если несоседние части всё же джиттерят при `selfCollide=true` — разнести `solverGroups`, чтобы контакт **детектился, но не решался** мягко. MVP это не трогает (`selfCollide=false`).

### 1.6 Перф-бюджет

| План | Тел | Суставов | Стоимость (условн. ед.) |
|---|---|---|---|
| biped | 11 | 10 | 1.0× |
| quadruped | ~12 | ~11 | ~1.1× |
| blob-3 | 3 | 2 | ~0.25× |
| blob-1 | 1 | 0 | ~0.08× (почти как враг сегодня) |

**Бюджет одновременных ragdoll'ов (см. кап §4/§5):**
- Цель 60 fps на mid-GPU (`dpr [1,1.5]`, `shadows:false` — сцена уже лёгкая по свету).
- **MAX_RAGDOLLS = 8** активных «живых полных ригов» одновременно кажется безопасным (≈88 тел, 80 суставов). **Трупы (limp) кап отдельно: MAX_CORPSES = 6** (oldest-out, §5). Итого ≤ ~14 ригов пик.
- Дальние/массовые враги → **blob-1/blob-3** (LOD по дистанции), полный biped только для ближних. Это держит суммарные тела в узде даже при 20 врагах (`store.ts` cap 20).

---

## 2. Два режима на ОДНОМ риге + API (контракт для инкремента 11)

Оба режима — тот же набор тел/суставов. Отличие: **что делаем с суставами каждый кадр**.

| Режим | Суставы | Тела | Кто двигает | Инкремент |
|---|---|---|---|---|
| **PASSIVE** (limp) | свободны в пределах лимитов, моторы OFF | `dynamic`, чистая физика | гравитация + хит-импульс | **10** (этот) |
| **ACTIVE** (motorized) | моторы тянут к целевым углам позы | `dynamic`, но управляемые торком мотора | `driveJoint()` из контроллера позы/локомоции | **11** |
| **KINEMATIC-HOLD** (alive-follow) | моторы держат нейтральную позу жёстко | корень `kinematicPosition`, кости `dynamic` с сильными моторами | пиним корень к серверному transform | **10** (§3) |

### 2.1 Моторы (как ACTIVE физически работает)

- **Revolute (колени/локти):** первоклассный мотор.
  ```ts
  (joint as RevoluteImpulseJoint).configureMotorPosition(targetRad, stiffness, damping);
  // stiffness (kp) тянет к targetRad; damping (kd) гасит. MotorModel по умолч. AccelerationBased.
  ```
- **Spherical (плечи/бёдра/шея):** мотор шара в JS-биндинге слабее (нет простого «targetQuat»). **Рекомендация:** для ACTIVE-локомоции ведущие оси — это **revolute** (сагиттальный мах ноги/руки в плоскости шага). Поэтому для инкремента 11 **ключевые драйв-суставы — hip и shoulder моделируем как revolute (ось махания) ЛИБО как «spherical для флопа + отдельный слабый угловой пружинный драйв через torque-to-target»**. MVP §10 моторы не трогает вовсе (всё limp), но API ниже уже принимает `driveJoint` на любой сустав; для spherical он под капотом применяет **torque-to-target** (пружина по `quatCurrent→quatTarget`), для revolute — `configureMotorPosition`. Так инкремент 11 зовёт единый `driveJoint()`, не зная типа.

```ts
// game/ragdoll.ts — драйв абстрагирует тип сустава
function driveJoint(rig, jointId, targetAngle /*|targetQuat*/, stiffness, damping) {
  const j = rig.joints[jointId];
  if (j.kind === 'revolute') {
    j.handle.configureMotorPosition(targetAngle, stiffness, damping);
  } else { // spherical → torque-to-target пружина (применяется в step())
    j.driveTarget = targetAngle; j.kp = stiffness; j.kd = damping;
  }
}
```

### 2.2 Публичный API `game/ragdoll.ts` (то, что зовут §3, §7 и инкремент 11)

```ts
export type BodyPlan = 'biped' | 'quadruped' | 'blob3' | 'blob1';
export type RagMode  = 'limp' | 'active' | 'hold';

export interface Rig {
  id: string;
  plan: BodyPlan;
  mode: RagMode;
  root: RapierRigidBody;                 // pelvis/torso — к нему пинится сеть
  bones: RapierRigidBody[];              // все тела, индексы = таблица §1.2
  joints: { kind:'revolute'|'spherical'|'fixed', handle:ImpulseJoint,
            driveTarget?:number, kp?:number, kd?:number }[];
  meshes: THREE.Object3D[];              // визуал, синкается матрицами (§4)
  bornAt: number; diedAt?: number;       // для cleanup/fade
}

// СОЗДАНИЕ: строит тела+суставы у spawnTransform, вешает меши. mode стартовый.
export function createRagdoll(plan: BodyPlan, spawn: THREE.Matrix4, mode: RagMode): Rig;

// РЕЖИМ: limp = моторы off + тела чистый dynamic; active = моторы on; hold = см. §3
export function setMode(rig: Rig, mode: RagMode): void;

// ДРАЙВ одного сустава к целевому углу/кватерниону (инкремент 11: локомоция/GA)
export function driveJoint(rig: Rig, jointId: number, target: number, stiffness: number, damping: number): void;

// ИМПУЛЬС в конкретную кость (хит/взрыв/пинок) — юзабельно и в limp, и в active
export function applyImpulse(rig: Rig, boneId: number, impulse: THREE.Vector3, atPoint?: THREE.Vector3): void;

// ПИН корня к авторитетному transform (сеть) — вызывать каждый кадр пока alive (§3)
export function pinRootTo(rig: Rig, pos: THREE.Vector3, quat: THREE.Quaternion): void;

// ШАГ визуала/пружин — раз в кадр из <Creatures> useFrame (§6). НОЛЬ аллокаций.
export function stepRig(rig: Rig, dt: number): void;

// УНИЧТОЖЕНИЕ: снять суставы, удалить тела из world, вернуть меши в пул
export function destroyRig(rig: Rig): void;
```

> **Это и есть контракт инкремента 11.** Локомоция там = каждый кадр гонять `driveJoint(rig, hipL, phase(t)…)` по фазовым таргетам, а GA эволюционирует параметры фазовой функции (амплитуды/частоты/фазы каждого драйв-сустава) по фитнесу (пройденная дистанция без падения). Инкремент 10 обязан отдать этот API рабочим на `limp` + `hold`, `active` — заглушкой (`setMode('active')` включает моторы в нейтраль, локомоции ещё нет).

---

## 3. ALIVE-FOLLOW: пока живой — трекинг авторитетного корня; на смерти — limp

Пока существо живо и **ещё не локомотит** (инкремент 11 даст настоящую ходьбу), клиентский риг должен **следовать** за интерполированным серверным корнем и выглядеть цельным, не расползаясь.

### 3.1 Выбор подхода — «kinematic root + hold-поза»

Два кандидата:

- **(A) Kinematic root + мягкий hold костей** ✅ рекомендую.
  Корень (pelvis) — `RigidBodyType.KinematicPositionBased`. Каждый кадр `pinRootTo(rig, serverPos, serverQuat)` = `root.setNextKinematicTranslation/Rotation` к интерполированному transform (backbone инкремента 05 уже интерполирует `remotePlayers`/врагов — то же и для creatures). Кости — `dynamic`, но в режиме `hold` их моторы (revolute) держат нейтраль **жёстко** (высокий kp), spherical — сильная torque-пружина к нейтрали. Итог: тело едет за корнем как связка, слегка пружиня конечностями (чуть «живёт», это хорошо). На смерти → `setMode('limp')`: корень становится `dynamic`, моторы off, кости обмякают.
  - **Плюсы:** корень точно на серверной позиции (нет дрейфа), дёшево, стабильно.
  - **Минус:** kinematic корень «продавливает» dynamic-кости если те упрутся в стену — на живом теле почти не случается.

- **(B) Teleport root каждый кадр + soft-joint** — телепортировать корень `setTranslation` и полагаться на суставы подтянуть остальное. Хуже: телепорт `dynamic`-тела ломает солвер (взрывы скоростей), нужен `resetForces`+`setLinvel(0)`. Не берём.

**Решение:** (A). Живой = `mode:'hold'`, kinematic root, моторы держат нейтраль. Позже инкремент 11 переключит живого в `mode:'active'` (kinematic root ИЛИ dynamic root с локомоцией — там решим).

### 3.2 Переход в limp (смерть/тяжёлый хит) — «juicy flop»

Триггеры (клиентский косметический слой; **истину по HP/смерти держит сервер**, §7):
1. **Смерть:** сервер шлёт `creature_died {id, hitPart?, impulse?}` ИЛИ (single-player-путь сегодня) `store.damageEnemy` увёл `health<=0`. → `killRagdoll(rig, hitPart, impulse)`.
2. **Тяжёлый ближний хит / взрыв (инкремент 09 melee):** переиспользуем хук `ragdollize(entity, impulse)` — это тот же путь, что и смерть, но существо может остаться живым (**stagger-ragdoll**): кратко limp + импульс, затем (later) `getUp()` через active-моторы. MVP: `ragdollize` = сразу полный limp как на смерти (без вставания).

```ts
function killRagdoll(rig, hitPart = rig.rootBoneId, impulse) {
  setMode(rig, 'limp');                    // корень dynamic, моторы off
  rig.root.setBodyType(Dynamic, true);     // был kinematic (hold) → dynamic
  // унаследовать текущую скорость движения существа, чтобы флоп «продолжил» инерцию
  rig.bones.forEach(b => b.setLinvel(rig.lastRootVel, true));
  applyImpulse(rig, hitPart, impulse);     // хлёсткий толчок в задетую часть
  // +немного случайного спина в торс/голову — «крутануло»
  rig.bones[torsoId].applyTorqueImpulse(randSpin(), true);
  rig.diedAt = performance.now();
}
```
> `impulse` берётся из направления выстрела/удара × сила оружия (railgun кидает сильнее авто). Хит в голову/грудь → импульс туда → тело откидывает назад-вверх (как Source). Наследование `lastRootVel` (скорость существа до смерти) — чтобы бегущий враг **продолжил** лететь, а не встал колом.

### 3.3 Единая карта состояний

```
        spawn
          │
        HOLD ──(alive, follows server root, joints hold neutral)
          │
   ┌──────┼───────────────┐
   │      │               │
 death   heavy-hit    (incr.11) ACTIVE (locomotion/GA)
   │      │
  LIMP  LIMP(stagger)──(incr.11 getUp)──►ACTIVE/HOLD
   │      │
  cleanup after N s (fade/sink) → destroyRig
```

---

## 4. Рендеринг — неон-конечности, привязка мешей, пул/лимиты

### 4.1 Визуал (в тон миру + Bloom)

- Каждая кость — вытянутый неон-меш: **капсула** или скруглённый бокс, `MeshBasicMaterial`/`MeshStandardMaterial({emissive})` c **`toneMapped={false}`** (как Debris) → ярко «горит» под Bloom.
- **Цвет по плану/типу** (актор-адаптация палитры — холодные неоны, тёплый только акцент):
  | План | Основной | Акцент (голова/«глаз») |
  |---|---|---|
  | biped | `bear #f72585` (магента) | `bloomWhite`/`enemyAmber` «глаз»-точка |
  | quadruped | `node #4361ee` (синий) | `uiCyan` |
  | blob | `accentViolet #7209b7` | `bull #00f5d4` |
- **Wireframe/каркас-look** уместен (текущие враги половину времени wireframe, `Enemies.tsx:50`) — «математический» скелет из неон-палок в духе игры. MVP: сплошные эмиссив-капсулы (читаемее в полёте), wireframe — опция плана.
- **Стыки суставов** — маленькая яркая сфера-«сустав» (доп. декор-меш, не тело) в точке anchor → тело читается как «конструкт», а не мешок. Дёшево (11 сфер, инстансинг).

### 4.2 Привязка мешей к телам — **ручные матрицы, как Debris** ✅

**НЕ** `<RigidBody>` на кость (для пула императивнее и дешевле). Каждый кадр в `stepRig`:
```ts
// ноль аллокаций: _v,_q,_s,_m в модуль-скоупе (как Debris.tsx:22-27)
for (let i = 0; i < rig.bones.length; i++) {
  const t = rig.bones[i].translation();   // Rapier {x,y,z}
  const r = rig.bones[i].rotation();      // Rapier quat
  _v.set(t.x, t.y, t.z); _q.set(r.x, r.y, r.z, r.w);
  _s.copy(rig.boneScale[i]);              // предрассчитанный масштаб капсулы
  _m.compose(_v, _q, _s);
  rig.meshes[i].matrixAutoUpdate = false;
  rig.meshes[i].matrix.copy(_m);
}
```
> Меши-кости — обычные `<mesh>` в общем `<group>` под `<Creatures>`, `matrixAutoUpdate=false`, матрица пишется вручную. Можно инстансить одинаковые капсулы в `InstancedMesh` (как Debris) для десятков костей в одном draw — **оптимизация later**; MVP — по мешу на кость (11×N мешей, приемлемо при N≤14).

### 4.3 Пул и лимиты (защита fps — паттерн Debris)

```ts
const MAX_RAGDOLLS = 8;    // живые полные риги
const MAX_CORPSES  = 6;    // limp-трупы (fade-out)
```
- **Пул ригов** предсоздан: тела/суставы/меши переиспользуются (`acquire()/release()`), а не `createRigidBody`/`removeRigidBody` каждую смерть (Rapier body-create недёшев × 11). При release — тела `setEnabled(false)` + меши `visible=false`, при acquire — `setEnabled(true)` + телепорт в spawn.
- **Oldest-out для трупов:** новый труп при полном `MAX_CORPSES` → мгновенно `destroy`/`recycle` **самого старого** (`splice` по `diedAt`, как `pool.splice(0, len-CAP)` в Debris).
- **LOD:** дальше `R_FAR` (напр. 80 юнитов) существо рисуется blob-1 (1 тело) или вообще старым инстанс-путём; полный biped только вблизи. Смерть далеко → воксель-дебрис (старый путь), без ragdoll.

---

## 5. Жизненный цикл, коллизия с миром, cleanup

### 5.1 Spawn / despawn

- **Spawn (alive):** creature приходит от сервера (id, plan, transform, state) → `acquire` риг из пула → `createRagdoll(plan, spawnMatrix, 'hold')` → добавить в реестр `Creatures`. Пока `alive` — `pinRootTo` каждый кадр.
- **Death:** `killRagdoll` → `mode:'limp'`, помечен `diedAt`. Продолжает физику-флоп.
- **Cleanup трупа:** через `CORPSE_TTL` (напр. **6 c**) — **fade + sink**:
  - последние `FADE=1.0 c`: `material.opacity` 1→0 (нужен `transparent:true`) **и/или** «утопить» — плавно `root.setTranslation(y -= sinkSpeed*dt)` через мир (провалить под пол) — дёшево и «растворяется в матрице».
  - затем `release` риг в пул.
- **Мгновенный despawn** если существо ушло из зоны/сервер снял id живым (не смерть) — просто `release`, без флопа.

### 5.2 Коллизия с миром (рельсы/поезд/пол)

- Кости членятся в `G_RAGDOLL`, фильтр включает `G_WORLD` → падают на пол, наваливаются на рельсы/стены/движущийся поезд (если у поезда `dynamic`/`kinematic` коллайдер — труп на нём **поедет**, что круто; проверить, что у поезда есть коллайдер, а не только меш).
- **Пол-провал guard:** как в Debris `FLOOR_Y=-50` — если любая кость `y < -50`, риг мгновенно `release` (упал в бездну). Совпадает с игроком (`Player.tsx:382` смерть на `y<-50`).
- **Гравитация −30** (не −9.8) → тюнить импульсы/демпфинг под «тяжёлый аркадный» флоп (тела падают быстро; лёгкие руки всё равно взлетают от импульса — контраст читается).

### 5.3 Cleanup ресурсов

`destroyRig`: `world.removeImpulseJoint(j, false)` для всех суставов → `world.removeRigidBody(b)` для всех тел (или `setEnabled(false)` если возврат в пул) → меши `visible=false`/вернуть в инстанс-пул. **Порядок важен:** сначала суставы, потом тела (удаление тела с живым суставом = варн/креш в Rapier).

---

## 6. Стор/стейт, структура компонентов, модуль `game/ragdoll.ts`

### 6.1 Стор (`store.ts`) — минимальные добавки

Creatures авторитетны на сервере; клиент держит их как данные (аналог `remotePlayers`). Ragdoll-**физика костей в сторе НЕ живёт** (как debris-пул живёт в компоненте, не в сторе).

```ts
interface Creature {
  id: string;
  plan: BodyPlan;
  x:number; y:number; z:number; rotation:number;  // авторитетный корень (интерполируется)
  state: 'alive' | 'dead';
  // на кадре смерти сервер (или локальный damageEnemy) кладёт причину для флопа:
  deathHitPart?: number; deathImpulse?: [number,number,number];
}
interface GameState {
  // ...
  creatures: Record<string, Creature>;          // авторитетный реестр (сеть)
  ragdollInbox: { id:string; hitPart:number; impulse:[number,number,number] }[]; // «умри сочно» pulse, как debris inbox
  spawnRagdoll: (id, plan, transform) => void;
  killCreature: (id, hitPart?, impulse?) => void;   // ставит state='dead' + пушит в ragdollInbox
  updateCreature: (id, data) => void;               // сеть-интерполяция корня
  removeCreature: (id) => void;
}
```
> `ragdollInbox` — тот же «spawn inbox»-паттерн, что `debris` (`store.ts:73`): `<Creatures>` сливает его в кадре, чистит, переводит соответствующий риг в limp. Ноль React-ре-рендеров на физику.
>
> **Мост к текущему `damageEnemy`:** MVP оставляет врагов как есть, но при `health<=0` вместо чистого исчезновения — `killCreature(id, hitPart, impulse)` (флоп) **вместо/в дополнение** к `makeChunks` (можно комбо: труп + немного искр, но не полный воксель-берст — иначе двойной эффект). Владельцу на выбор: ragdoll **заменяет** воксель-взрыв для «человечных» врагов, воксель остаётся для «кристаллов»/candle.

### 6.2 Структура компонентов

```
<Creatures/>                         // новый; заменяет/дополняет <Enemies/> для ragdoll-существ
  ├─ useFrame:
  │    1. слить store.ragdollInbox → killRagdoll(rig,…); clear inbox
  │    2. для каждого alive creature: pinRootTo(rig, interp(creature))  // сеть-follow (§3)
  │    3. stepRig(rig, dt) для всех (пружины spherical-драйва + запись матриц мешей)  // §4.2
  │    4. cleanup: трупы старше TTL → fade/sink → release (§5.1)
  ├─ <group ref=bonesGroup>          // все меши-кости (matrixAutoUpdate=false)
  └─ (опц.) <instancedMesh> суставы-сферы, инстанс-капсулы
```
- `<Ragdoll/>` — **не** React-компонент на существо (иначе N ре-рендеров); риг = чистый JS-объект в реестре `Map<id,Rig>` внутри `<Creatures>` (ref). React только монтирует контейнер-group и пул мешей. Это в точности философия Debris (весь пул — один компонент, данные в ref).
- `game/ragdoll.ts` — вся физика/API §2.2, **ноль импортов React**, чистые функции над `world` (из `useRapier()`, прокинуть в модуль через init) и над `Rig`.

### 6.3 Ноль аллокаций в горячем пути

- Все `THREE.Vector3/Quaternion/Matrix4/Euler` — модуль-скоуп в `ragdoll.ts` и `Creatures.tsx` (как `Debris.tsx:22-27`, `Player.tsx:16-24`).
- `dt = Math.min(dtRaw, 1/30)` (как Debris) — защита от «взрыва» суставов на лаг-спайке (большой dt = солвер расходится).
- Реестр ригов — предвыделенный массив-пул, `acquire/release` индексами, без `new` в `useFrame`.
- Импульсы/торки — переиспользуемые векторы, `.set(...)` перед подачей в Rapier.

---

## 7. Сетевая модель (явно) — что локально, что авторитетно

| Слой | Где живёт | Синкается? |
|---|---|---|
| Корневой transform существа (x,y,z,rot) | **сервер авторитетен**, клиент интерполирует | **ДА** (как `remotePlayers`/врагов, backbone инкр.05) |
| Состояние `alive/dead` | **сервер авторитетен** | **ДА** (`creature_died`) |
| HP / кто нанёс урон / момент смерти | **сервер** (как `socket.emit("hit")`, `player_died` в инкр.04/05) | **ДА** |
| **Позы суставов ragdoll (кости)** | **чисто локально на каждом клиенте** | **НЕТ, НИКОГДА** |
| Хит-импульс на флопе | локально (из направления/оружия), сервер может прислать `hitPart+impulse` как **подсказку** для консистентности, но не как истину | опц. одно сообщение на смерть, дальше 0 |

**Правила (закрепить):**
1. Пока `alive` — клиент **пинит** локальный риг к интерполированному серверному корню (§3, kinematic root). Никакой суставной физики по сети.
2. На `dead` — клиент **отпускает** риг в limp + импульс. Симуляция костей идёт **независимо** на каждом клиенте (как дебрис). Разные позы трупа у разных игроков — **ок и незаметно**, HP/смерть уже решены сервером.
3. Ragdoll **не влияет** на геймплей/коллизию игрока (труп в `G_RAGDOLL`, не сталкивается с игроком — §1.5) → нельзя «застрять в трупе», нет десинк-эксплойтов.
4. **Детерминизм не требуется** (косметика). Ровно как весь джус инкремента 04.

> Это тот же контракт, что уже действует для debris и combat-FX: **сервер = HP/смерть, клиент = вся косметика**. Ragdoll — просто «дорогой дебрис со скелетом».

---

## 8. Риски (честно) и как их бьём

| Риск | Причина | Митигация |
|---|---|---|
| **Джиттер/дрожь суставов** (Rapier «тряпка вибрирует») | слабый солвер по контактам соседних тел + низкий damping | (1) `joint.setContactsEnabled(false)` на всех суставах; (2) `selfCollide=false` MVP; (3) `angularDamping 3–6` на конечностях; (4) `dt` clamp 1/30; (5) поднять `world.numSolverIterations` точечно если надо |
| **«Жвачка»/резиновость** (тело растягивается на суставах) | импульс-суставы мягкие под большой массой/импульсом | лимиты углов заданы жёстко; массы адекватные (не давать конечности 0.001); импульс хита кап по величине; при желании — `world` solver iters ↑ |
| **Перф многих ригов** | 11 тел×8 + контакты + суставы | `MAX_RAGDOLLS 8` / `MAX_CORPSES 6`; LOD→blob/voxel на дистанции; пул тел (не пересоздавать); `ccd:false`; ragdoll↔ragdoll и ragdoll↔player OFF |
| **Тюнинг лимитов вручную долго** | 10 суставов × (cone/twist/min/max) | стартовая таблица §1.2 + единый `RAGDOLL_TUNING` §11, крутить вживую; начать с «слишком свободно», зажимать |
| **Kinematic корень продавливает стены** живого | kinematic игнорит контакты | на живом почти не бывает; при упоре — кости-dynamic спружинят; смерть → dynamic, проблема исчезает |
| **Провал сквозь пол** на g=−30 | мелкие быстрые капсулы | floor guard `y<-50`→release; включить CCD точечно если реально пробивает |
| **Удаление тела с живым суставом** = креш/варн | порядок cleanup | всегда сустав → потом тело (§5.3) |
| **Хуки суставов не масштабируются на пул** | React-хуки фикс-топология | строим императивно сырым Rapier (§0, §6) |
| **Spherical мотор слаб для ACTIVE** (инкр.11) | JS-биндинг | ведущие драйв-оси = revolute; spherical-драйв = torque-to-target пружина (§2.1) |
| Двойной эффект (voxel + ragdoll) на смерти | оба хука на `damageEnemy` | выбрать per-type: ragdoll ИЛИ voxel (§6.1) |

---

## 9. Тюнинг-таблица (единый конфиг, крутить с владельцем)

```ts
// game/ragdoll.tuning.ts — все «магические числа» рига здесь
export const RAGDOLL_TUNING = {
  caps:      { maxRagdolls: 8, maxCorpses: 6, corpseTTL: 6.0, fade: 1.0, farLOD: 80, floorY: -50 },
  damping:   { limbLinear: 0.5, limbAngular: 4.0, coreLinear: 0.4, coreAngular: 2.0 },
  biped: {
    masses:  { pelvis:0.22, torso:0.24, head:0.08, upperArm:0.06, foreArm:0.045, thigh:0.11, shin:0.075 },
    limits:  { spineCone:25, spineTwist:20, neckCone:40, neckTwist:50,
               shoulderCone:90, shoulderTwist:60, elbow:[0,150],
               hipCone:70, hipTwist:25, knee:[-150,0] },   // градусы
  },
  hit:       { impulseMax: 14, torsoSpin: 6, inheritVel: true }, // сила флопа
  // per-weapon импульс смерти (масштаб от §04 damage): auto<spread<plasma<railgun
  weaponImpulse: [6, 9, 11, 16],
  hold:      { jointKp: 40, jointKd: 6 },   // жёсткость удержания нейтрали пока alive
  active:    { defaultKp: 25, defaultKd: 4 }, // старт для инкремента 11 (моторы)
  look:      { emissiveIntensity: 0.9, wireframe: false, jointOrbs: true },
};
```
> Старт «читаемо, не эпилептично»: лимиты скорее свободные, импульсы средние. На плейтесте зажимать лимиты (если «жвачка») / поднимать импульс (если «вяло падает»).

---

## 10. Плейтестер-чеклист (чем принимаем)

- [ ] Враг на смерти **обмякает и падает** телом, а не исчезает мгновенно.
- [ ] Хит в голову/грудь → тело **откидывает в сторону удара** (railgun сильнее авто).
- [ ] Бегущий враг, убитый в движении, **продолжает лететь** по инерции (не встаёт колом).
- [ ] Конечности **не дрожат** (нет вибрации-тряпки) в покое на полу.
- [ ] Тело **не растягивается** резиной; суставы гнутся анатомично (колено/локоть в одну сторону).
- [ ] Труп **лежит на полу/рельсах/поезде** корректно, едет на движущемся поезде.
- [ ] Трупы **исчезают** (fade/утопить) через ~6 c; на экране не копится больше кап.
- [ ] 60 fps при 6+ одновременных трупах в куче (пул, ноль GC-стуттера, ноль setTimeout).
- [ ] Пока живой — тело **следует** за существом цельно, не расползаясь (hold-режим).
- [ ] Ничего не рассинхронит сеть: сервер решает HP/смерть, кости — локальная косметика.
- [ ] Разные клиенты показывают разные позы трупа — и это **незаметно** в игре.
- [ ] Неон-конечности **горят** под Bloom, читаются в темноте (toneMapped=false).

---

## 11. MVP инкремента 10 (минимум — заменить мгновенное исчезновение сочным флопом)

> Senior first pass: законченный playable-срез. Владелец стреляет во врага → тот **обмякает и красиво падает**. Один план (biped), лимит, неон, cleanup.

**MVP (в порядке):**
1. **`game/ragdoll.ts` — императивный конструктор biped** (§1.2): 11 тел + 10 суставов сырым Rapier, `setContactsEnabled(false)`, группы `selfCollide=false` (§1.5). API `createRagdoll/setMode/applyImpulse/pinRootTo/stepRig/destroyRig` (§2.2) — `active` пока заглушка (моторы в нейтраль).
2. **`<Creatures/>` компонент** (§6.2): реестр ригов в ref, `useFrame` = слить `ragdollInbox` → `killRagdoll`, `pinRootTo` для alive, `stepRig` (матрицы мешей §4.2), cleanup TTL.
3. **Смерть-флоп** (§3.2): в `store.damageEnemy` при `health<=0` → `killCreature(id, hitPart, impulse)` (импульс из направления/оружия) вместо мгновенного исчезновения. Для «человечных» врагов ragdoll заменяет voxel-берст (кристаллы/candle — оставить voxel).
4. **Alive-follow hold** (§3.1): kinematic root, моторы держат нейтраль, риг едет за врагом (можно повесить на существующий враг-transform, пока сервер-creatures не готов — читать позицию текущего врага).
5. **Неон-look + пул + кап** (§4): эмиссив-капсулы `toneMapped=false`, `MAX_CORPSES=6` oldest-out, fade/sink cleanup, floor-guard `y<-50`.
6. **`ragdollize(entity, impulse)` хук** (§3.2) — та же точка входа, что мили-инкремент 09 дёрнет для тяжёлого хита (MVP = сразу полный limp).

**Позже (polish / следующие инкременты):**
- **Инкремент 11:** ACTIVE-моторы + фазовая локомоция + GA эволюция походки поверх `driveJoint()` (контракт §2.2 уже готов).
- **QUADRUPED / BLOB** планы (§1.3–1.4) + LOD-переключение по дистанции.
- **Дисмембермент**: `joint.setContactsEnabled` + порог урона → `world.removeImpulseJoint` = конечность отлетает (кость становится свободным телом, живёт как debris).
- **Self-collision polish** (`selfCollide=true` точечно: кисти↔ноги) + solverGroups-развод при джиттере.
- **Инстансинг костей** в `InstancedMesh` (десятки костей — один draw, как Debris).
- **Сустав-сферы** декор, wireframe-скелет-look опция.
- Труп «поедет на поезде» — проверить/добавить kinematic-коллайдер поезда.
- Сервер-`creatures` реестр + `creature_died {hitPart, impulse}` сообщение (полная сеть §7), когда backbone инкр.05 дозреет.

> MVP трогает: **новый** `game/ragdoll.ts` + `game/ragdoll.tuning.ts` + **новый** `Creatures.tsx`, мелкие правки `store.ts` (creatures/ragdollInbox/killCreature) и `Game.tsx` (смонтировать `<Creatures/>`). Ноль изменений в netcode-истине (сервер по-прежнему решает HP/смерть). Риск для мультиплеера — ноль (кости локальны, как debris).
