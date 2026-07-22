# 07 — Crazy Train (безумный американский рельсовый поезд-горка)

> Гигантский физический **поезд-роллеркостер**, который барражирует по рельсовому сплайну через всю карту. Его можно **догнать, запрыгнуть, пробежать по вагонам, добраться до кабины и ВЕСТИ** (газ/тормоз, камера уезжает в кабину). Он **сносит** всё на пути — игроков, врагов, пропсы — с шейком и звуком. Референсы: **American rollercoaster** (безумная скорость + баньк на виражах), **Half-Life 2** (управляемый вагон/поезд-скриптед), **Snowpiercer** (бег по крышам вагонов), **Mario Kart 8** anti-grav-рельсы (up-vector банк).
>
> **ЖЁСТКОЕ ОГРАНИЧЕНИЕ (закреплено владельцем, из 00-README):** это онлайн-игра, сервер авторитетен, **никакого замедления времени / hit-stop**. Поезд — сетевой с самого начала (сеть-first, инкремент 05). По проводу летит **МИНИМУМ** истины (`t + speed + pilotId`), всё остальное — детерминированная реконструкция из сплайна (инкремент 06) + локальная косметика (банк, искры, шейк).
>
> **Разрушаемость самого поезда = LATER polish.** MVP: поезд едет по петле → можно сесть → занять кабину → рулить скоростью/тормозом → он сносит тела с шейком+звуком.

---

## 0. Что уже есть в коде (точка привязки)

Всё ниже — реальные факты, чтобы спека садилась на существующий движок, а не выдумывала.

**Игрок — это Rapier `dynamic` RigidBody**, не kinematic character-controller (`Player.tsx:398-401`):
```tsx
<RigidBody ref={playerRef} colliders={false} mass={1} type="dynamic"
           position={[0,5,0]} enabledRotations={[false,false,false]}>
  <CapsuleCollider args={[0.5, 0.5]} />   // halfHeight 0.5, radius 0.5 → капсула ~2 юнита
</RigidBody>
```
Движение делается **вручную** через `playerRef.current.setLinvel({x,y,z}, true)` каждый кадр (`Player.tsx:210`), НЕ через контроллер. `translation()`/`linvel()` читаются оттуда же. **Это важно для §3** — мы уже владеем скоростью игрока покадрово, значит «приклеить» его к вагону = просто писать другую скорость/позицию.

**Камера** управляется `PointerLockControls` (владеет `quaternion`/aim, `Player.tsx:397`), а её **позиция жёстко ставится каждый кадр** (`Player.tsx:118` / `:112` для FPS/TPS):
```ts
camera.position.set(currentPos.x, currentPos.y + 0.8, currentPos.z);   // eye level
```
Шейк/recoil — **позиционный/вращательный аддитив ПОСЛЕ** этой установки (`Player.tsx:124-135`, `game/shake.ts`). **Тот же приём** используем для кабинной камеры (§3.4): в режиме пилота мы просто ставим `camera.position` в мировой якорь кабины вместо глаз игрока, а aim остаётся за PLC.

**Клавиши** (`hooks/useKeyboard.ts`): W/S/A/D/Space/F(command)/ЛКМ(shoot). **`KeyE` НЕ обрабатывается нигде** — это наш свободный interact-ключ (§3.1). `KeyV` (тогл FPS/TPS) слушается отдельным `keydown`-эффектом в `Player.tsx:70-75` — по этому же паттерну повесим `KeyE`.

**Grounded-проба** — вертикальный райкаст вниз от ног, проверяет `userData.isFloor / isWall / isJumpPad` (`Player.tsx:158-170`). → **Вагоны должны нести `userData.isFloor`**, чтобы по крышам можно было бегать/прыгать штатной механикой, без спец-кода (§1.4).

**Шейк** (`game/shake.ts`): `addTrauma(amount∈[0,1])` копит, `sampleShake(dt,out)` пишет позиционный offset, `trauma²`-отклик, decay 1.5/сек. Переиспользуем для наезда/тряски езды.

**Палитра** (`theme.ts` `PALETTE`): мир — холодные (`bull #00f5d4`, `bear #f72585`, `node #4361ee`, `accentViolet #7209b7`), актёры — тёплые (`enemyAmber`, `alertRed`, `actorWhite`). Emissive-мир рендерится с `toneMapped={false}` под Bloom (см. `Arena.tsx` Candlestick/Platform). Поезд — **неоновый мировой объект**, значит холодная гамма + `toneMapped={false}`.

**Сеть сейчас** (`server.ts`): комнаты `rooms[roomId] = { players, enemies }`, события `join/update/shoot/hit/disconnect`, широковещание дельт. HP авторитетен на сервере (`hit` → `player_hit`/`player_died`, `server.ts:71-98`). Инкремент 05 добавляет авторитетный тик ~15-20Hz + `world_snapshot`; **инкремент 07 кладёт поезд именно в этот снапшот** (§5).

**Инкремент 06 (предполагается готов) — `src/game/spline.ts`:** детерминированный `THREE.CatmullRomCurve3`-луп рельсов с арк-длина-параметризацией. Контракт, на который опирается 07:
```ts
// src/game/spline.ts  (инкремент 06)
export const RAIL: {
  curve: THREE.CatmullRomCurve3;      // closed=true
  length: number;                     // полная длина петли в юнитах (getLength())
  getPoint(t: number, out: THREE.Vector3): THREE.Vector3;    // t∈[0,1), по арк-длине, wraps
  getTangent(t: number, out: THREE.Vector3): THREE.Vector3;  // единичный, направление движения
  getUp(t: number, out: THREE.Vector3): THREE.Vector3;       // up-вектор рельса (для банка/anti-grav)
  // helper: перевод дистанции(юниты)→t и обратно
  distanceToT(d: number): number;     // (d mod length)/length
  tToDistance(t: number): number;
};
```
> **Оба клиента и сервер генерируют ОДИН И ТОТ ЖЕ сплайн** из зашитых контрольных точек (детерминизм 06). Поэтому по проводу летит только `t` — каждый сам восстановит XYZ+ориентацию всех вагонов. Это ядро сетевой модели §5.

---

## 1. КОМПОЗИЦИЯ ПОЕЗДА (цепочка вагонов вдоль сплайна)

### 1.1 Модель «поезд = голова t + фиксированные арк-оффсеты»
Поезд — это **одна скалярная истина `t_head`** (позиция головы по петле) + **скорость**. Каждый вагон `i` сидит на своём фиксированном **отставании по арк-длине** позади головы:
```
d_i     = tToDistance(t_head) - i * WAGON_SPACING        // дистанция центра вагона i
t_i     = distanceToT(d_i)                               // его t (wraps по петле)
pos_i   = RAIL.getPoint(t_i)                             // центр вагона в мире
tan_i   = RAIL.getTangent(t_i)                           // «вперёд» вагона
up_i    = RAIL.getUp(t_i)                                // «вверх» рельса (банк)
```
Оффсет по **арк-длине** (а не по Δt) критичен: на крутых виражах равные Δt дают разные расстояния → вагоны «съезжались/растягивались» бы. Через `distanceToT` промежутки постоянны.

### 1.2 Ориентация вагона (basis из tangent+up, без gimbal)
Каждый вагон ориентируем матрицей-базисом (то же, что `Object3D.lookAt`, но с явным up для банка на anti-grav-виражах):
```ts
// forward = tan_i (уже единичный), up ≈ up_i
_right.crossVectors(up_i, tan_i).normalize();     // right = up × forward
_trueUp.crossVectors(tan_i, _right).normalize();  // ортонормируем up
_basis.makeBasis(_right, _trueUp, tan_i.clone().negate()); // three смотрит по -Z → forward=-Z
wagon.quaternion.setFromRotationMatrix(_basis);
wagon.position.copy(pos_i);
```
> `getUp` из 06 даёт «anti-grav» банк (петли/бочки американской горки). Если 06 отдаёт постоянный `+Y`, вагоны едут ровно — всё равно работает; косметический докрут-банк на виражах добавляем поверх в §1.5.

### 1.3 Рекомендуемые числа состава
| Параметр | Значение | Обоснование |
|---|---|---|
| `WAGON_COUNT` | **6** (1 голова-кабина + 5 вагонов) | достаточно длинный, чтобы бегать по крышам; не топит перф |
| `WAGON_SPACING` (арк, юниты) | **9** | длина корпуса 7 + зазор 2 (видна сцепка) |
| размер вагона (box) | **7 (длина Z) × 3 (шир X) × 3 (выс Y)** | капсула игрока ~2 юнита → на крыше стоишь свободно |
| размер кабины (голова) | **6 × 3.2 × 3.4**, чуть выше | читается как «локомотив», выделяется силуэтом |
| высота пола крыши | центр +1.5 | верх бокса = стоячая поверхность (`userData.isFloor`) |
| колёсная база визуально | 2 «тележки» под вагоном (косметика) | небольшие боксы, edge-glow |

### 1.4 Коллайдеры вагонов (Rapier)
Каждый вагон — **`kinematicPosition` RigidBody** с `CuboidCollider [3.5,1.5,1.5]` (полуразмеры). Kinematic, потому что его трансформ мы **диктуем** из `t` (сервер-истина), а не считаем физикой. Меш несёт `userData={{ isFloor:true, isWagon:true, wagonIndex:i }}` → штатная grounded-проба игрока (`Player.tsx:158`) даёт стоять/бегать/прыгать по крышам **без единой строки спец-кода**. Голова дополнительно `isCab:true`.

> **Почему kinematic, не fixed и не dynamic:** fixed нельзя двигать; dynamic будет драться с солвером на 60+ юнит/сек. `kinematicPosition` + `setNextKinematicTranslation/Rotation` каждый кадр = Rapier корректно считает контакты (толкает динамические тела игрока/врагов при въезде — halfbaked «наезд», который §4 усиливает импульсом) и не интегрирует сам вагон.

### 1.5 Неоновый вид (под Bloom, PALETTE)
- Корпус: `meshStandardMaterial color={PALETTE.node '#4361ee'} emissive={node} emissiveIntensity={0.5} metalness={0.7} roughness={0.25} toneMapped={false}` — как `Platform` в `Arena.tsx:126`.
- Кант/рёбра/окна: emissive `PALETTE.bull '#00f5d4'` полосами (тонкие боксы вдоль корпуса) → «неоновый вагон-горка».
- Кабина-голова: акцент `PALETTE.bear '#f72585'` + мигающий «прожектор» спереди (один `SpotLight`/emissive-диск, дешёво).
- Сцепки между вагонами: тонкий emissive-цилиндр от хвоста `i` к носу `i+1` (позиции берём из уже посчитанных `pos_i`).
- Опц. полиш: «искровой шлейф» от колёс на виражах (spark-пул как в §4), «американские» гирлянды-лампы по крыше (InstancedMesh точек, мерцание синусом).

---

## 2. МОДЕЛЬ ДВИЖЕНИЯ (сервер-авторитетный, детерминированный)

### 2.1 Интеграция по арк-длине (скорость = юниты/сек, постоянна вне зависимости от кривизны)
Сервер в своём тике (05, dt = 1/tick):
```ts
train.dist  = (train.dist + train.speed * dt) % RAIL.length;   // едем по арк-длине
train.tHead = train.dist / RAIL.length;                        // нормализованный t
```
Ключ: продвигаем **дистанцию**, потом делим на length. Так `speed` — реальные юниты/сек, и на виражах поезд не ускоряется/замедляется визуально (равномерный ход), пока мы явно не захотим горочный эффект (§2.3).

### 2.2 Границы и отклик на пилота
| Параметр | Значение | Смысл |
|---|---|---|
| `TRAIN_SPEED_MIN` | **8** юн/с | «ползёт», но не стоит — всегда живой |
| `TRAIN_SPEED_CRUISE` | **28** юн/с | дефолт без пилота (авто-круиз) |
| `TRAIN_SPEED_MAX` | **75** юн/с | безумная горка на прямых |
| `TRAIN_ACCEL` | **22** юн/с² | газ пилота (W/↑) |
| `TRAIN_BRAKE` | **40** юн/с² | тормоз (S/↓) резче газа — контроль |
| `TRAIN_COAST` | **4** юн/с² | без ввода скорость дрейфует к `CRUISE` |

Сервер применяет ввод пилота (§5.2):
```ts
if (pilotInput.throttle > 0) train.speed += TRAIN_ACCEL * pilotInput.throttle * dt;
else if (pilotInput.brake > 0) train.speed -= TRAIN_BRAKE * pilotInput.brake * dt;
else train.speed += Math.sign(TRAIN_SPEED_CRUISE - train.speed) * TRAIN_COAST * dt; // coast к круизу
train.speed = clamp(train.speed, TRAIN_SPEED_MIN, TRAIN_SPEED_MAX);
```

### 2.3 Горочный «гравитационный» отклик (опц., но детерминированный на сервере)
Чтобы ощущалась **американская горка** — на подъёмах теряет скорость, на спусках разгоняется. Полностью детерминировано (сервер читает наклон рельса из того же сплайна):
```ts
const slope = -RAIL.getTangent(train.tHead).y;   // >0 = едем в горку, <0 = под горку
train.speed += slope * TRAIN_GRAVITY * dt;        // TRAIN_GRAVITY ≈ 30
train.speed = clamp(train.speed, TRAIN_SPEED_MIN, TRAIN_SPEED_MAX);
```
> Без пилота это даёт «дышащий» ход сам по себе (провисает на горках, свистит на спусках) — уже читается как горка. С пилотом — накладывается на его газ/тормоз. `TRAIN_GRAVITY` тюним; при 0 — фича выключена, поезд едет ровно (безопасный дефолт для MVP, включаем на плейтесте).

> **Детерминизм:** всё это ТОЛЬКО на сервере. Клиент никогда не интегрирует `t` сам — он **интерполирует** между двумя снапшотами (§5.3). Значит горочная физика не может рассинхронить клиентов.

---

## 3. ПОСАДКА + УПРАВЛЕНИЕ

### 3.1 Ключ `E` (interact) — проводка
`KeyE` сейчас нигде не слушается. Вешаем в тот же `keydown`-эффект, что `KeyV` (`Player.tsx:70`), но лучше — как **edge-триггер через ref** (посадка/высадка — дискретное событие, не hold):
```ts
// в useKeyboard.ts добавить в keys: interact:boolean (KeyE) — по образцу jump
// ИЛИ (проще, локально в Player.tsx) отдельный listener пишущий useRef edge:
const interactPressed = useRef(false);
// keydown KeyE → interactPressed.current = true;  (сбрасываем после обработки в useFrame)
```
Рекомендую добавить `interact` в `useKeyboard` (там уже единый источник) + в `Player.tsx` держать `prevInteract` ref для edge-детекта (как `prevJump`, `Player.tsx:53`).

### 3.2 Состояние «катаюсь» (клиентское, локальное)
Три режима игрока, храним в `useRef` (не в zustand — покадровое, ре-рендер не нужен) + отражаем флаг в store для UI/HUD:
```ts
type RideState =
  | { mode: 'onfoot' }
  | { mode: 'riding'; wagonIndex: number; seatLocal: THREE.Vector3 }  // на вагоне/крыше
  | { mode: 'piloting' };                                             // в кабине, я пилот
```

### 3.3 Проба близости и посадка (E)
Каждый кадр (только `onfoot`) считаем ближайший вагон и дистанцию до его «зоны посадки» (крыша/платформа). Без аллокаций — вагонные мировые позиции у нас уже посчитаны в `<Train/>` (§5.4), кладём их в модуль-скоуп массив `_wagonWorld[i]`:
```ts
if (ride.mode === 'onfoot' && interactEdge) {
  let best = -1, bestD = BOARD_RADIUS;             // BOARD_RADIUS = 4 юнита
  for (let i=0;i<WAGON_COUNT;i++){
    const d = _playerPos.distanceTo(_wagonWorld[i].pos);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) {
    // локальная «посадочная» точка = центр верха вагона в его системе координат
    ride = { mode:'riding', wagonIndex:best, seatLocal:new THREE.Vector3(0, 1.6, 0) };
  }
}
```
> **Догнать поезд:** посадка — это про скилл движения (bhop/air-strafe из инк.01 доносят до 26-95 юн/с — быстрее круиза 28). Прыгнул на крышу (штатный `isFloor`) → стоишь на вагоне физически (kinematic пол несёт тебя) → жмёшь E рядом → «пристёгнут». До E можно просто **стоять на крыше** как на движущейся платформе (Rapier сам несёт), E добавляет «жёсткую привязку сиденья» чтобы не соскользнуть на вираже.

### 3.4 Физика «еду на вагоне» — РЕКОМЕНДУЕМЫЙ подход (kinematic-snap игрока)

**Проблема:** игрок — `dynamic` капсула (`Player.tsx:398`). Динамическое тело на **быстром** kinematic-полу (до 75 юн/с, да ещё на виражах с боковым ускорением) будет соскальзывать/подлётывать — солвер не успевает, трения не хватает, банк кидает вбок. Джойнт (rapier joint игрок↔вагон) тоже плох: жёсткий джойнт дерётся с нашим ручным `setLinvel`, а мягкий — болтается.

**Решение (чистейшее для ЭТОГО движка): на время `riding`/`piloting` переключаем тело игрока в `kinematicPosition` и САМИ ставим позицию каждый кадр** — ровно как мы уже жёстко ставим камеру. Мы и так не полагаемся на встроенный контроллер, так что это не регресс.
```ts
// При посадке: playerRef.current.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
// При высадке: обратно Dynamic + сохранить импульс (см. 3.6).

// В useFrame, ветка riding/piloting (ВМЕСТО обычного movement-блока Player.tsx:145-210):
const w = _wagonWorld[ride.wagonIndex];             // {pos, quat} этого вагона (из §5.4)
// on-board локальная ходьба: игрок может ходить по крыше в пределах бокса
if (ride.mode === 'riding') {
  // WASD двигают seatLocal в плоскости крыши вагона (локально), с клампом по габаритам
  _wish2D.set(Number(keys.right)-Number(keys.left), 0, Number(keys.backward)-Number(keys.forward));
  ride.seatLocal.x = clamp(ride.seatLocal.x + _wish2D.x * ONBOARD_SPEED * delta, -1.2, 1.2);
  ride.seatLocal.z = clamp(ride.seatLocal.z + _wish2D.z * ONBOARD_SPEED * delta, -3.0, 3.0);
  // прыжок с вагона: Space → высадка с добавленной скоростью (§3.6)
  if (keys.jump) { dismount(/*withJump*/true); }
}
// мировая цель = центр вагона + локальный оффсет, повёрнутый ориентацией вагона
_seatWorld.copy(ride.seatLocal).applyQuaternion(w.quat).add(w.pos);
playerRef.current.setNextKinematicTranslation({ x:_seatWorld.x, y:_seatWorld.y, z:_seatWorld.z });
```
> `setNextKinematicTranslation` = Rapier интерполирует и корректно генерит контакты (ты всё ещё можешь получить пулю/толкнуть врага). Игрок «прилипает» к вагону идеально даже на 75 юн/с и в петле, потому что мы задаём позицию, а не надеемся на трение. **On-board WASD** сохранён (владелец просил «movement still works on-board»): ходишь по крыше/платформе, просто в системе координат вагона.

### 3.5 Кабина + захват пилота + камера
```ts
// Если riding И вагон == 0 (голова) И игрок близко к cab-якорю → E claim pilot:
if (ride.mode==='riding' && ride.wagonIndex===0 && interactEdge && nearCabAnchor) {
  socket.emit('train_input', { action:'claim' });   // сервер решает, свободна ли кабина (§5.2)
  ride = { mode:'piloting' };                        // оптимистично; сервер подтвердит pilotId
}
```
**Кабинная камера:** в режиме `piloting` камера ставится в мировой якорь кабины (нос головы, чуть выше пола), а **aim остаётся за PointerLockControls** (свободно осмотреться), с мягким «forward bias» по ходу поезда:
```ts
// ВМЕСТО camera.position.set(eye) (Player.tsx:118):
_cabAnchorLocal.set(0, 1.4, -2.2);                    // локально в голове: приподнят, сдвинут вперёд
_cabWorld.copy(_cabAnchorLocal).applyQuaternion(_wagonWorld[0].quat).add(_wagonWorld[0].pos);
camera.position.copy(_cabWorld);
// шейк/тряска езды добавляем ПОСЛЕ (тот же приём, что §0): camera.position += sampleShake + rideRumble
```
> Aim мышью не трогаем — PLC владеет `quaternion`, мы владеем `position` (как и в обычном режиме). Ничего не дерётся. Скорость поезда → лёгкий FOV-kick (`camera.fov` растёт на 6-10° к MAX-скорости, `updateProjectionMatrix()` только при изменении) = ощущение «гонит».

### 3.6 Высадка / вылет (dismount)
```ts
function dismount(withJump: boolean) {
  playerRef.current.setBodyType(rapier.RigidBodyType.Dynamic, true);
  // наследуем скорость вагона (иначе «телепорт-стоп» на 60 юн/с ломает ощущение)
  const wSpeed = _wagonWorld[idx].tangent.clone().multiplyScalar(train.speedApprox);
  const up = withJump ? MOVE.jumpVelocity : 0;
  playerRef.current.setLinvel({ x:wSpeed.x, y:up, z:wSpeed.z }, true);
  if (ride.mode==='piloting') socket.emit('train_input', { action:'release' }); // отдать кабину
  ride = { mode:'onfoot' };
}
```
> **Соскок на скорости = фича** (владелец: «jump-onto-from-rails tricks» — LATER, но соскок с импульсом даём сразу): спрыгнул с летящего поезда на 60 юн/с → летишь по касательной, air-strafe (инк.01) ловит момент → трюковые перелёты между вагонами/на арену. Естественно вытекает из наследования скорости.

**Авто-высадка** (безопасность): если `riding` и вагон почему-то стал далеко (рассинхрон/поезд «моргнул» на переподключении) — форс-dismount. Если игрок умер (`gameOver`) — сброс в `onfoot`.

---

## 4. КОЛЛИЗИЯ / СНОС (поезд толкает тела с пути)

### 4.1 Кто что решает (авторитет)
- **Урон по HP игроков → СЕРВЕР** (незыблемо, как весь netcode). Сервер владеет `t` (он его и считает) → в своём тике знает мировые позиции всех вагонов (тот же сплайн) и позиции игроков (из `update`). Делает дешёвую overlap-проверку и шлёт урон через **существующий путь** `player_hit`/`player_died` (`server.ts:71-98`) — новый повод, старый канал.
- **Кинетический снос (knockback-импульс) + шейк + звук → КЛИЕНТ** (косметика). Прилетает событие `train_knock` → локально импульс + `addTrauma` + звук.
- **Враги-фигуры** (`enemies`, локально-косметические, инк.02) — толкаются/убиваются локально клиентом (у них нет авторитетной HP на сервере в текущей модели).

### 4.2 Дешёвый swept-запрос «ковшом» перед каждым вагоном (не continuous collision)
Полноценный CCD на 6 вагонах × 75 юн/с — дорого и не нужно. Вместо этого — **дискретная overlap-проверка коробкой-«ковчектером» (cowcatcher)** чуть впереди носа каждого вагона, раз в тик:
```ts
// СЕРВЕР (для урона игрокам) и КЛИЕНТ (для косметики врагов) — одинаковая геометрия:
for each wagon i:
  // коробка перед носом: центр = pos_i + tan_i * (halfLen + SWEEP_AHEAD/2)
  _sweepCenter = pos_i + tan_i * (3.5 + SWEEP_AHEAD*0.5);   // SWEEP_AHEAD = speed*dt + 1.5
  // OBB-тест против тел (игроки/враги/пропсы). На КЛИЕНТЕ — rapier:
  world.intersectionsWithShape(_sweepCenter, wagonQuat, _sweepCuboid, (collider) => {
     const rb = collider.parent();
     if (rb.userData?.isEnemy || rb.userData?.isProp) applyKnock(rb, tan_i);
     return true;
  });
  // На СЕРВЕРЕ — простой AABB/сфера-тест по player-позициям (нет rapier на сервере):
  for pid in players: if pointInOBB(players[pid], _sweepCenter, wagonQuat, halfExtents)
     → dealTrainDamage(pid, TRAIN_DAMAGE), broadcast train_knock{pid, dir:tan_i, force}
```
`SWEEP_AHEAD = speed*dt + margin` закрывает «туннелирование» на высокой скорости без честного CCD: ковш на каждом тике покрывает путь, пройденный за кадр. **Дёшево** (6 коробок), **детерминировано на сервере** (позиции тел он и так держит).

### 4.3 Импульс сноса (клиент, косметика)
```ts
function applyKnock(rb, forwardTangent) {
  // толчок ВПЕРЁД по ходу + вверх (тело «подлетает и улетает» — американская горка энергия)
  _impulse.copy(forwardTangent).multiplyScalar(KNOCK_FORWARD)   // KNOCK_FORWARD ≈ speed*8
          .add(_up.setScalar? _UPVEC.clone().multiplyScalar(KNOCK_UP)); // KNOCK_UP ≈ 60
  rb.applyImpulse(_impulse, true);
  rb.applyTorqueImpulse(_randSpin, true);   // закрутка → «кувыркается»
}
```
Для **своего** игрока (когда снесло меня): помимо серверного урона — `addTrauma(0.5)` (сильный удар), лёгкий отброс камеры (позиционный, как шейк), и если стоял на рельсах — Rapier сам подкинет капсулу (она dynamic вне езды). Для **врагов** — тот же импульс + связка с воксель-смертью инк.02 (снёс → `damageEnemy(big)` → берст дебриса), поезд «фаршует» толпу.

### 4.4 Шейк + звук наезда
- **Шейк:** `addTrauma` по близости к точке наезда. Сильный удар по мне: 0.5. Проезд мимо на высокой скорости (свист): маленький постоянный `addTrauma(0.02)` каждый тик, пока поезд в радиусе 15 юн — «земля трясётся от махины». Внутри кабины на MAX-скорости — постоянный `rideRumble` (мелкий синусный позиционный джиттер, отдельно от trauma, чтобы не зашкаливать).
- **Звук** (расширяем `utils/audio.ts`, синтез, ноль сетевых ассетов — как в инк.04 §8):
  | Событие | Синтез (эскиз) |
  |---|---|
  | гудок/horn (пилот жмёт клавишу, напр. `KeyH`) | два низких sine 180/240Гц, 0.5с, «поезд-гудок» |
  | постоянный гул катящегося (loop, громкость по скорости+близости) | низкий пилообразный 40-70Гц + rumble-noise, lowpass |
  | лязг колёс на стыках | периодический клик по пройденной дистанции (каждые ~9 юн) |
  | БАХ наезда/сноса | noise-burst + низкий thump 60Гц (как kill в инк.04) |
  | визг тормозов (пилот S) | highpass noise sweep 2к→400, пока тормозит |
  Пространственное панорамирование по X-смещению поезда от направления камеры (`StereoPannerNode`) — дёшево, «слышно откуда прёт».

### 4.5 Урон (числа, тюним с владельцем)
| Кого | Урон | Примечание |
|---|---|---|
| Игрок (прямой наезд) | **TRAIN_DAMAGE = 60** | не instakill — можно выжить/оправиться; на MAX-скорости множитель ×1.5 |
| Игрок-пилот в кабине | 0 (иммун к своему поезду) | ты внутри |
| Враг-фигура (инк.02) | massive → мгновенная воксель-смерть | «косилка», удовлетворяет |
| Пропсы | knock-импульс, без урона | физическая забава |
> HP игрока считает **только сервер** (`server.ts`), клиент рисует урон-цифру/шейк как предсказание, сервер подтверждает `player_hit`. Ровно как обычная стрельба сейчас.

---

## 5. STORE / СЕТЬ / `<Train/>`

### 5.1 Дополнения store (`store.ts`)
Минимум — поезд по сути один объект. Кладём **интерполяционный буфер** (два последних снапшота) в ref-ы `<Train/>`, а в zustand — только то, что нужно React/HUD:
```ts
interface TrainState {
  tHead: number;        // последний авторитетный t от сервера (для не-физ. нужд)
  speed: number;        // юниты/сек (для HUD-спидометра, FOV-kick, звука)
  pilotId: string|null; // кто сейчас ведёт (null = автопилот-круиз)
}
interface GameState {
  // ...существующее...
  train: TrainState;                 // из world_snapshot
  ridingTrain: boolean;              // мой режим riding|piloting (для HUD «[E] выйти», прицел off)
  setTrain: (t: Partial<TrainState>) => void;
  setRidingTrain: (v: boolean) => void;
}
// init: train:{ tHead:0, speed:28, pilotId:null }, ridingTrain:false
```
> Никаких вагон-трансформов в сторе (их 6×матрица × 20Hz = мусор). Только `{tHead, speed, pilotId}`. Всё остальное `<Train/>` восстанавливает из сплайна.

### 5.2 Интент `train_input` (клиент → сервер) и применение
Клиент-пилот шлёт компактный ввод (дросселируем ~15-20Hz, как `update`, `Player.tsx:369`):
```ts
// клиент, только если ride.mode==='piloting':
socket.emit('train_input', {
  throttle: keys.forward ? 1 : 0,   // W/↑ газ  (0..1)
  brake:    keys.backward ? 1 : 0,  // S/↓ тормоз
  horn:     keys.horn ? 1 : 0,      // опц. гудок
});
// claim/release — отдельные разовые:
socket.emit('train_input', { action:'claim' });   // занять кабину
socket.emit('train_input', { action:'release' }); // отдать
```
```ts
// server.ts (в io.on('connection')):
socket.on('train_input', (msg) => {
  const room = rooms[currentRoom]; if (!room) return;
  const tr = room.train;                                  // { dist, tHead, speed, pilotId }
  if (msg.action === 'claim') {
    if (!tr.pilotId) { tr.pilotId = socket.id; io.to(currentRoom).emit('train_pilot', tr.pilotId); }
    return;
  }
  if (msg.action === 'release') {
    if (tr.pilotId === socket.id) { tr.pilotId = null; io.to(currentRoom).emit('train_pilot', null); }
    return;
  }
  if (tr.pilotId !== socket.id) return;                    // только пилот рулит
  room._pilotInput = { throttle: msg.throttle||0, brake: msg.brake||0, horn: msg.horn||0 };
});
// disconnect: если tr.pilotId===socket.id → tr.pilotId=null (кабина освобождается)
```
Сервер применяет `_pilotInput` в тике (§2.2). **Никакого client-side prediction** для скорости/позиции поезда: ты его пассажир/водитель-по-команде, не носитель авторитета. Цена — **инпут-лаг** ~1 RTT + 1 тик (при 50-100мс пинге и 20Hz ≈ 100-150мс от нажатия газа до видимого разгона). Для «тяжёлого поезда» это **читается как инерция локомотива**, а не как лаг — тяжёлая махина и должна отзываться вязко. Приемлемо и даже в тему (обосновано владельцу).

### 5.3 `world_snapshot` — поезд в снапшоте (05) и интерполяция на клиенте
Сервер в тике (05) добавляет в снапшот блок train:
```ts
// world_snapshot payload (05) расширяем полем:
train: { t: tr.tHead, speed: tr.speed, pilot: tr.pilotId }
```
Клиент буферизует **два последних** снапшота и интерполирует `t` по времени рендера (тот же паттерн, что `RemotePlayer` лерпит позицию, `RemotePlayers.tsx:34-37`, но для скаляра `t`):
```ts
// В <Train/>: держим _snapA {t, tRecv}, _snapB {t, tRecv} — предыдущий и текущий.
// render alpha = (now - tRecv_B) / (tRecv_B - tRecv_A), clamp [0,1]
// ВАЖНО: t — циклический (петля). Интерполируем по КРАТЧАЙШЕЙ дуге:
let dt = _snapB.t - _snapA.t;
if (dt >  0.5) dt -= 1;      // прошли шов 1→0
if (dt < -0.5) dt += 1;
const tRender = fract(_snapA.t + dt * alpha);   // fract = ((x%1)+1)%1
```
> Wrap-коррекция обязательна, иначе на шве петли (`t: 0.98 → 0.02`) поезд «прыгнет назад через всю карту». Скорость для косметики (звук/FOV/банк) берём прямо `_snapB.speed` (не критично гладкая).

### 5.4 `<Train/>` — рендер вагонов БЕЗ аллокаций в useFrame
Компонент маунтится в `Game.tsx` внутри `<Physics>` (рядом с `<Arena/>`). Все объекты — предсозданы; в `useFrame` только запись трансформов (дисциплина 00-README «ноль аллокаций»):
```tsx
// --- модуль-скоуп (как _wishDir и т.п. в Player.tsx) ---
const _p = new THREE.Vector3(), _tan = new THREE.Vector3(), _up = new THREE.Vector3();
const _right = new THREE.Vector3(), _trueUp = new THREE.Vector3();
const _basis = new THREE.Matrix4(), _q = new THREE.Quaternion();
// экспортируем наружу для Player.tsx (посадка/наезд/камера) — единый источник трансформов:
export const _wagonWorld = Array.from({length: WAGON_COUNT}, () => ({
  pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tangent: new THREE.Vector3(),
}));

export function Train() {
  const bodyRefs = useRef<RapierRigidBody[]>([]);   // 6 kinematic тел
  const snapA = useRef({ t:0, tr:0 }), snapB = useRef({ t:0, speed:28, tr:0 });

  // подписка на снапшоты — пишем в ref-буфер (НЕ zustand-рендер):
  useEffect(() => socket.on('world_snapshot', s => {
    snapA.current = snapB.current;
    snapB.current = { t: s.train.t, speed: s.train.speed, tr: performance.now() };
  }), []);

  useFrame(() => {
    const now = performance.now();
    const span = snapB.current.tr - snapA.current.tr || 1;
    const alpha = Math.min(1, (now - snapB.current.tr) / span);   // small extrapolate-clamp
    let dtt = snapB.current.t - snapA.current.t;
    if (dtt >  0.5) dtt -= 1; if (dtt < -0.5) dtt += 1;
    const tHead = ((snapA.current.t + dtt*alpha) % 1 + 1) % 1;
    const dHead = RAIL.tToDistance(tHead);

    for (let i=0;i<WAGON_COUNT;i++){
      const ti = RAIL.distanceToT(dHead - i*WAGON_SPACING);
      RAIL.getPoint(ti, _p); RAIL.getTangent(ti, _tan); RAIL.getUp(ti, _up);
      _right.crossVectors(_up, _tan).normalize();
      _trueUp.crossVectors(_tan, _right).normalize();
      _basis.makeBasis(_right, _trueUp, _tan.clone ? _tan : _tan); // forward handling see §1.2
      _q.setFromRotationMatrix(_basis);
      // косметический докрут-банк по кривизне (§1.5) — опц. добавка к _q здесь
      const b = bodyRefs.current[i];
      b.setNextKinematicTranslation(_p);
      b.setNextKinematicRotation(_q);
      // публикуем для Player.tsx:
      _wagonWorld[i].pos.copy(_p); _wagonWorld[i].quat.copy(_q); _wagonWorld[i].tangent.copy(_tan);
    }
  });

  return <>{Array.from({length:WAGON_COUNT}).map((_,i)=>(
    <RigidBody key={i} ref={el=>bodyRefs.current[i]=el!} type="kinematicPosition" colliders={false}
               userData={{ isFloor:true, isWagon:true, isCab:i===0, wagonIndex:i }}>
      <CuboidCollider args={i===0?[3,1.7,1.6]:[3.5,1.5,1.5]} />
      <WagonMesh head={i===0} />   {/* неоновый box + канты + окна, §1.5 */}
    </RigidBody>
  ))}</>;
}
```
> `_wagonWorld` — **общий модуль-скоуп мост** между `<Train/>` (пишет) и `<Player.tsx>` (читает для посадки/сиденья/кабин-камеры/наезда). Ноль per-frame аллокаций (кроме `_tan.clone().negate()` в §1.2 — вынести в предсозданный `_fwdNeg` вектор). `<Train/>` рендерит 6 тел один раз; useFrame только двигает.

### 5.5 Порядок useFrame (кто раньше — Train или Player)
`<Train/>` должен обновить `_wagonWorld` **до** того, как `<Player.tsx>` его прочитает в том же кадре. R3F выполняет `useFrame` в порядке маунта; ставим `<Train/>` в `Game.tsx` **перед** `<Player/>` (`Game.tsx:44-45`), либо задаём `useFrame(cb, RENDER_PRIORITY)` — Train приоритет `-1`, Player `0`. Рекомендую явный priority (надёжнее порядка маунта).

---

## 6. ПРОИЗВОДИТЕЛЬНОСТЬ и ЧЕСТНЫЕ РИСКИ

### Перф
- **6 вагонов** = 6 kinematic тел + 6 боксов-мешей + канты. Дёшево. Если состав вырастет (LATER, длинный поезд/несколько поездов) — **InstancedMesh** на корпуса (один draw-call), а окна/канты — второй instanced-слой; трансформы пишем в `instanceMatrix` из того же `_wagonWorld`-цикла.
- **Overlap-запросы наезда** — 6 коробок/тик через `world.intersectionsWithShape` (broad-phase Rapier, дёшево). НЕ CCD. Сервер — 6 OBB × N игроков (N мал).
- **Ноль аллокаций** в `useFrame` `<Train/>` и в ride-ветке `Player.tsx` (все векторы/кватернионы — модуль-скоуп, §5.4). Спарк/звук-пулы — как в инк.04 §10.
- Снапшот-подписка пишет в **ref-буфер**, не в zustand → нет 20 ре-рендеров/сек HUD.

### Честные риски (и как их бьём)
| Риск | Почему | Митигейшн |
|---|---|---|
| Динамический игрок «улетает» с быстрого kinematic-пола | трение/солвер не держат на 75 юн/с + банк | **не полагаемся на трение** — на `riding` переключаем игрока в kinematic и снапим позицию (§3.4) |
| Туннелирование сноса на MAX-скорости | за кадр поезд проходит >1 длину тела | ковш `SWEEP_AHEAD=speed*dt+margin` покрывает путь кадра (§4.2) |
| Камера в кабине «плывёт» на банке/петле | up-vector крутится, PLC держит свой yaw | камера = только позиция (якорь), aim за PLC; банк не трогает камеру-rotation (§3.5); rumble — позиционный |
| Рассинхрон `t` на шве петли | циклический параметр | wrap-коррекция кратчайшей дугой в интерполяции (§5.3) |
| Инпут-лаг руления | нет prediction (by design) | подан как «инерция локомотива»; тяжёлый accel/coast маскирует (§5.2) |
| Пилот дисконнектнулся за рулём | кабина «залипла» | `disconnect` освобождает `pilotId` → автопилот-круиз (§5.2) |
| Игрок на вагоне при его «моргании» (reconnect) | вагон прыгнул | авто-force-dismount по дистанции (§3.6) |
| Порядок useFrame Train vs Player | Player прочитал старый `_wagonWorld` | явный `useFrame` priority: Train раньше Player (§5.5) |
| `setBodyType` туда-сюда каждую посадку | смена типа тела — не бесплатно | делаем только на edge посадки/высадки (редко), не каждый кадр |

---

## 7. ТЮНИНГ-ТАБЛИЦА (единый конфиг — править вживую с владельцем)
```ts
// src/config/train.ts — импортить в Train/Player/server (общие числа = детерминизм)
export const TRAIN = {
  compose: { count:6, spacing:9,
             wagon:[7,3,3], cab:[6,3.2,3.4], roofTop:1.5 },
  speed:   { min:8, cruise:28, max:75, accel:22, brake:40, coast:4, gravity:30 /*0=off*/ },
  board:   { radius:4, onboardSpeed:6, seatClampX:1.2, seatClampZ:3.0,
             cabAnchor:[0,1.4,-2.2], fovKickMax:8 },
  knock:   { sweepMargin:1.5, forwardMul:8, up:60, spinMax:12,
             damage:60, maxSpeedDmgMul:1.5 },
  shake:   { hit:0.5, passBy:0.02, passByRadius:15, rumbleMax:0.06 },
  net:     { inputHz:18 },   // как update-throttle
  look:    { body:'#4361ee', edge:'#00f5d4', cab:'#f72585' },  // PALETTE node/bull/bear
};
```
> Стартовые значения консервативны в сторону «читаемо и управляемо»; безумную скорость (max, gravity) и силу сноса поднимаем вместе на плейтесте. `gravity:0` — безопасный MVP-дефолт (ровный ход), включаем горочный эффект после базовой проверки.

---

## 8. Human feel-checklist (чем принимаем)
- [ ] Поезд **сам катится** по всей петле без пилота (авто-круиз), плавно, без рывков на шве петли.
- [ ] Видно и слышно издалека: неоновая махина + нарастающий гул + дрожь земли при приближении.
- [ ] Можно **догнать** движением (bhop/air-strafe быстрее круиза) и **запрыгнуть на крышу** — стоишь на ней как на движущейся платформе.
- [ ] `E` рядом с вагоном → «пристёгнут»: на вираже/петле **не соскальзываешь**, можешь ходить по крыше (on-board WASD).
- [ ] Дошёл до головы, `E` у кабины → **стал пилотом**, камера уехала в кабину, aim свободен.
- [ ] W/↑ газ, S/↓ тормоз (визг) — поезд разгоняется/тормозит; на MAX ощущается безумно (FOV-kick, гул, тряска).
- [ ] Инпут-руления отзывается «тяжело-инерционно», а не «лагающе» — читается как локомотив.
- [ ] Поезд **сносит** врагов (фарш + воксель-берст) и игроков (урон от сервера + отброс + сильный шейк + БАХ).
- [ ] Соскок на скорости (Space) → летишь по касательной, air-strafe ловит момент (трюк).
- [ ] Пилот вышел/дисконнектнулся → кабина освобождается, поезд возвращается на круиз.
- [ ] 60 fps при езде + сносе толпы (пулы, kinematic, ноль аллокаций, 6 ковш-запросов).
- [ ] Ничего не рассинхронит сеть: `t/speed/pilot` — единственная истина по проводу, HP решает сервер.
- [ ] Второй игрок видит поезд/вагоны в той же позиции (детерминизм сплайна + интерполяция `t`).

---

## 9. MVP инкремента 07 (минимум, чтобы поезд СРАЗУ был безумный и играбельный)
> Метод 00-README: законченный сочный playable-срез (senior first pass), владелец играет и подтверждает.

**MVP (в этом порядке — каждый пункт уже играбелен):**
1. **Сплайн-поезд едет** (§1, §2, §5.4): `<Train/>` рендерит 6 kinematic-вагонов, читает `t` из снапшота (сервер продвигает `t` авто-круизом, §2.1). Детерминированные позиции + банк. Уже зрелище.
2. **Стоять/бегать по крышам** (§1.4): `userData.isFloor` на вагонах → штатная grounded-механика, ноль спец-кода. Догнал движением, запрыгнул.
3. **Посадка E + kinematic-snap** (§3.1-3.4): `E` пристёгивает, игрок kinematic-снапится к сиденью, on-board WASD. Не соскальзываешь на виражах.
4. **Кабина + руление** (§3.5, §5.2): `E` у головы → `train_input claim`, кабин-камера, W/S газ/тормоз через сервер, спидометр в HUD. Ведёшь поезд.
5. **Снос + шейк + звук** (§4): ковш-overlap → урон игрокам (сервер, старый `hit`-путь) + knock-импульс/шейк/БАХ локально; враги → воксель-смерть. Косилка.

**LATER (polish waves):**
- **Разрушаемость самого поезда** (вагоны бьются/отваливаются, воксель-берст корпуса) — вынесено владельцем в later.
- **Дерейл/сход с рельсов** (перегруз скорости на вираже → эффектный вылет).
- **Несколько поездов** / длинный состав через InstancedMesh (§6).
- **Тонкий тюнинг урона/сноса** и горочная `gravity`-физика (§2.3) на плейтесте.
- **Jump-onto-from-rails трюки** — целевые «трамплины» с арены на летящий поезд, комбо-перелёты между вагонами.
- **Гирлянды/искры/horn-мелодия**, пространственный звук колёс-стыков, remote-косметика чужого пилота в кабине.

> MVP трогает: **новые** `src/components/Train.tsx`, `src/config/train.ts`; правки в `Game.tsx` (маунт `<Train/>`), `Player.tsx` (ride-ветка + `E` + кабин-камера), `store.ts` (`train`/`ridingTrain`), `useKeyboard.ts` (`interact`), `server.ts` (train-тик + `train_input`), `socket.ts` (`world_snapshot.train`/`train_pilot`), `utils/audio.ts` (train-звуки). **Ноль изменений в модели авторитета HP** — снос идёт через существующий `player_hit`.
