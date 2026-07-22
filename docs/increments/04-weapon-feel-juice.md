# 04 — Weapon Feel & Combat Juice

> Сочный AAA-фидбек стрельбы поверх существующей боевой системы. Референсы: **DOOM 2016/Eternal** (вспышки, читаемость урона, крауч-панч), **Halo** (отдача-паттерны, хитмаркер-тик), **Destiny 2** (bloom-прицел, дамаг-цифры), **Titanfall** (камера-кик + шейк), **Vlambeer "Art of Screenshake"** (много мелких эффектов складываются в «мясо»).
>
> **ЖЁСТКОЕ ОГРАНИЧЕНИЕ (закреплено владельцем):** это онлайн-игра. **НИКАКОГО hit-stop / slow-mo / Time.timeScale / замедления времени.** Весь джус — недетерминированно-косметический и **не завязан на время**: экран-шейк, вспышки, партиклы, камера-кик, звук, анимация. Ничто из этого не трогает netcode: сервер по-прежнему авторитетен по HP/смерти (`socket.emit("hit")` / `player_died`), а весь эффект-слой живёт локально в клиенте.

---

## 0. Что уже есть в коде (точка привязки)

Всё ниже — реальные факты из `src/components/Player.tsx`, чтобы спека садилась на существующее, а не выдумывала.

**`WEAPON_CONFIG` (Player.tsx:33-38):**
```ts
const WEAPON_CONFIG = [
  { rate: 120,  damage: 15,  recoil: 0.1, sound: 800 },                          // 0 Auto Rifle
  { rate: 800,  damage: 10,  recoil: 0.4, sound: 200, spread: 0.1, rays: 8 },    // 1 Spread / Shotgun
  { rate: 400,  damage: 40,  recoil: 0.2, sound: 400, type: 'projectile' },      // 2 Plasma Launcher
  { rate: 1500, damage: 120, recoil: 0.6, sound: 100, thick: true }             // 3 Railgun
];
```
> `rate` — это **cooldown в мс** между выстрелами (проверка `now - lastShootTime > config.rate`), НЕ выстрелов/сек. `recoil` сейчас — просто сдвиг `weaponMesh.position.z` на 40 мс (Player.tsx:196-200). Имена оружий в `UI.tsx:10`: `AUTO RIFLE / SPREAD GUN / PLASMA LAUNCHER / RAILGUN`.

**Что уже работает и что мы улучшаем:**
| Система | Сейчас | Файл:строки | Инкремент 04 делает |
|---|---|---|---|
| Recoil | сдвиг меша по z на 40мс | Player.tsx:196-200 | камера-кик + пружина восстановления + view-punch |
| Muzzle flash | нет | — | спрайт-вспышка у ствола, цвет по оружию |
| Tracer | одна переиспользуемая `THREE.Line`, fade 5/сек | Player.tsx:179-188, 280-292, 353-357 | пул трейсеров, вид под оружие, impact-flash |
| Hitmarker | нет | — | X-маркер + kill-маркер + тик-звук в UI |
| Crosshair | статичный SVG-крест | UI.tsx:43-52 | динамический bloom-прицел от огня/спреда |
| Damage numbers | `<Text>` всплывает, fade за 1с | DamageNumbers.tsx | скейл по урону, крит, цвет, джиттер, арка |
| Screen shake | нет | — | trauma-модель, аддитивная к камере |
| Sparks | `THREE.Mesh` спавнятся + `setTimeout` remove | Player.tsx:258-269 | пул, без setTimeout, impact по типу |
| Audio | `playShootSound(freq,dur)` square-osc | audio.ts:12-30 | per-weapon + impact + hitmarker + kill |

**Критичные ограничения из движка:**
- Камера управляется `PointerLockControls` (Player.tsx:329) — он **пишет `camera.quaternion` напрямую** каждый mousemove. Значит любой камера-кик/шейк **нельзя** класть на `camera.rotation` (перетрётся). Решение — **рендер-камера как ребёнок рига** ИЛИ аддитивный offset, применяемый **после** контролов в том же `useFrame` (см. §1, §6).
- `useFrame` (Player.tsx:94) уже дисциплинирован: общие аллокации вынесены в модуль-скоуп (`_frontVector` и т.д., строки 14-22). **Продолжаем этот стиль:** ноль `new` в горячем пути, всё пулится.
- Камера-позиция каждый кадр жёстко ставится в `camera.position.set(...)` на уровне глаз (Player.tsx:112). Шейк/кик — это **вращательный** offset вокруг этой позиции, не позиционный (позиционный сотрётся строкой 112).

---

## 1. RECOIL / камера-кик

### Проблема
Сейчас «отдача» = `weaponMesh.position.z += recoil` на 40 мс. Пушка дёргается, но **прицел не двигается** → стрельба ощущается «ватной», нет связи выстрел→экран.

### Модель (двухслойная, как в Halo/Destiny)
Разделяем **два независимых слоя**, которые складываются:
1. **View-punch (kick)** — резкий импульс поворота камеры вверх+вбок в момент выстрела, с пружинным возвратом. Влияет на прицеливание (ствол реально смотрит выше).
2. **Weapon-punch** — визуальный отскок модели оружия (уже есть z-nudge; апгрейдим до позиция+вращение). Чисто косметика, на прицел не влияет.

Оба **не** трогают `camera.quaternion` напрямую (его владеет PointerLockControls). Вместо этого держим **аддитивный recoil-эйлер** и применяем его после контролов.

### Структура данных (модуль-скоуп Player.tsx, рядом с `_frontVector`)
```ts
// --- Recoil state (аддитив поверх PointerLockControls) ---
const _recoilCurrent = new THREE.Vector2(0, 0);   // текущий применённый угол (pitch, yaw), рад
const _recoilTarget  = new THREE.Vector2(0, 0);    // цель, к которой пружиним (обычно к 0)
const _recoilVel     = new THREE.Vector2(0, 0);    // скорость пружины
const _camBaseEuler  = new THREE.Euler(0, 0, 0, 'YXZ');
```

### Per-weapon значения — РАСШИРЯЕМ `WEAPON_CONFIG`
Добавляем в каждый объект (не ломая существующие поля):
```ts
// добавить к каждому weapon в WEAPON_CONFIG:
kick:    { pitch, yaw, recover, punch }
// pitch   — вертикальный кик вверх, радианы (импульс за выстрел)
// yaw     — горизонтальный кик, радианы; знак чередуем (см. паттерн)
// recover — жёсткость пружины возврата (больше = быстрее к нулю)
// punch   — множитель weapon-punch модели
```

| # | Оружие | `kick.pitch` | `kick.yaw` (±) | `recover` | `punch` | Паттерн |
|---|---|---|---|---|---|---|
| 0 | Auto Rifle | 0.010 | ±0.004 | 14 | 0.6 | нарастающий: pitch *= 1+0.04·streak (кап ×2.2), yaw знак чередуется |
| 1 | Spread Gun | 0.045 | ±0.010 | 10 | 1.0 | один жирный кик за залп |
| 2 | Plasma Launcher | 0.022 | ±0.006 | 12 | 0.8 | средний ровный |
| 3 | Railgun | 0.075 | 0.0 | 7 | 1.4 | огромный вертикальный панч, без yaw (снайпер) |

> **Recoil-streak:** для авто-винтовки паттерн «климбит» как в CS/Halo — считаем непрерывную очередь `recoilStreak` (ref number). Инкремент при каждом выстреле, **сброс, если** `now - lastShootTime > config.rate * 2.5` (отпустил гашетку). `pitch_effective = kick.pitch * min(2.2, 1 + 0.04*recoilStreak)`. Даёт узнаваемую «лесенку», которую игрок учится компенсировать вниз — это скилл-выражение (Halo/CS DNA).

### Пружина возврата (в `useFrame`, semi-implicit, кадронезависимо)
```ts
// вызывать КАЖДЫЙ кадр, ПОСЛЕ логики контролов, ДО применения к камере
function updateRecoil(delta: number, recover: number) {
  // критически-демпфированная пружина к нулю
  const k = recover;              // жёсткость
  const d = 2 * Math.sqrt(k);     // критический демпфер (без овершута)
  _recoilVel.x += (-_recoilCurrent.x * k - _recoilVel.x * d) * delta;
  _recoilVel.y += (-_recoilCurrent.y * k - _recoilVel.y * d) * delta;
  _recoilCurrent.x += _recoilVel.x * delta;
  _recoilCurrent.y += _recoilVel.y * delta;
}
```
При выстреле — **импульс**, не set:
```ts
// в блоке стрельбы, после setLastShootTime:
const kp = config.kick.pitch * Math.min(2.2, 1 + 0.04 * recoilStreak.current);
_recoilCurrent.x += kp;                                   // толчок вверх (pitch+)
_recoilCurrent.y += config.kick.yaw * (recoilStreak.current % 2 ? 1 : -1); // чередуем сторону
```

### Применение к камере при PointerLockControls (ключевой момент)
PLC ставит `camera.quaternion` из своего внутреннего yaw/pitch на каждый mousemove — то есть **между** нашими кадрами. Поэтому:

**Подход A (рекомендую — минимально инвазивный): аддитивный эйлер поверх.**
В самом конце `useFrame` (после того как PLC уже отработал mousemove, а мы поставили `camera.position`), читаем текущий кватернион камеры как «базу прицела» и домешиваем recoil как локальный поворот:
```ts
// В КОНЦЕ useFrame, после camera.position.set(...):
_camBaseEuler.setFromQuaternion(camera.quaternion, 'YXZ');
_camBaseEuler.x += _recoilCurrent.x;   // pitch — recoil ВВЕРХ (в 'YXZ' +x = вверх при данной конвенции; проверить знак на месте)
_camBaseEuler.y += _recoilCurrent.y;   // yaw
camera.quaternion.setFromEuler(_camBaseEuler);
```
> Нюанс: PLC хранит своё состояние отдельно и на следующем mousemove перезапишет quaternion **со своей** (не-recoil) базы. Т.е. recoil виден как «дрожь поверх» и естественно затухает, НЕ накапливаясь в стейте контролов. Это именно то, что нужно: **view-punch, который не «залипает» в аиме** (Titanfall-стиль). Реальное смещение прицела на время кика — да (ствол выше), но по отпусканию всё вернулось. Если хотим «recoil реально уводит аим» (CS-стиль, надо докручивать мышь вниз) — вместо этого прибавлять к внутреннему pitch контролов через `controlsRef.current` API; **для аркадного онлайн-шутера рекомендую подход A** (прощает, читается, не бесит в сети).

**Подход B (если A даёт борьбу за quaternion): рендер-камера-ребёнок.** Создать `<group>` `camRig`, PLC вешать на риг, а recoil+shake класть на дочернюю камеру как локальный `rotation`. Чище архитектурно, но требует переноса `camera.position` логики на риг → больше правок. Держим как fallback.

### Weapon-punch (косметика модели, апгрейд текущего z-nudge)
Заменяем `setTimeout`-хак (Player.tsx:199) на пружину по тому же принципу, применяемую к `weaponRef.current.children[0]`:
```ts
// вместо weaponMesh.position.z += recoil; setTimeout(...):
_weaponPunch.z += 0.06 * config.kick.punch;   // назад (Kickback)
_weaponPunch.x += (Math.random()-0.5) * 0.01 * config.kick.punch;
_weaponPunchRot -= 0.15 * config.kick.punch;  // ствол задирается (rot.x-)
// в useFrame каждый кадр — пружиним _weaponPunch к 0 (recover ~18) и пишем в меш поверх sway
```
Это убирает разбросанные `setTimeout` (утечка при быстрой стрельбе) и даёт плавный отскок.

---

## 2. MUZZLE FLASH

### Требование
Яркая короткая вспышка у дульного среза, цвет под оружие, **дешёвая** — без реального `PointLight` каждый выстрел (тени/переосвещение = дорого и «дёргает» всю сцену).

### Подход: спрайт + опционально один пул-лайт
1. **Спрайт-вспышка (основное):** `THREE.Sprite` с `SpriteMaterial({ map: flashTex, blending: AdditiveBlending, depthWrite:false, transparent:true })`. Один переиспользуемый спрайт (или пул из 2 на случай перекрытия у авто-винтовки). Позиция — дульный оффсет оружия; масштаб и opacity гасим за ~50-70 мс.
2. **Свет (опционально, один на всё):** ОДИН `PointLight`, заранее в сцене, `intensity=0`. При выстреле `intensity = flashLight`, каждый кадр `intensity *= 0.80` (мгновенный decay). Один лайт, никогда не создаётся/не удаляется → нет пересборки шейдеров. Для авто-винтовки не мигаем каждый кадр — только «подкидываем» intensity (наложение само даёт мерцание).

### Дульный оффсет
Ствол модели в Player.tsx — box на `[0.3, -0.3, -0.8]` внутри `weaponRef`. Дуло ≈ локально `(0.3, -0.3, -1.0)`. Трансформ в мир: `_muzzleLocal.clone().applyMatrix4(weaponRef.current.matrixWorld)`. (Уже есть похожий паттерн для лазера — `_laserStartPoint.applyMatrix4(camera.matrixWorld)`, Player.tsx:288.)

### Per-weapon
| # | Оружие | Цвет вспышки | Scale | Life (мс) | Light intensity |
|---|---|---|---|---|---|
| 0 | Auto Rifle | `#ffd166` тёплый жёлтый | 0.35 | 45 | 1.5 |
| 1 | Spread Gun | `#ff9e00` оранж, шире | 0.6 | 60 | 2.5 |
| 2 | Plasma Launcher | `#00f5d4` циан (в тон снаряду) | 0.5 | 70 | 2.0 |
| 3 | Railgun | `#ff006e` магента, узкая длинная | 0.45×1.8y | 90 | 4.0 |

```ts
function fireMuzzleFlash(weaponIdx, worldPos, worldQuat) {
  const s = muzzlePool.acquire();               // Sprite из пула
  s.position.copy(worldPos);
  s.quaternion.copy(worldQuat);                 // ориентируем «конус» по стволу
  s.material.color.set(FLASH[weaponIdx].color);
  s.scale.setScalar(FLASH[weaponIdx].scale * (0.85 + Math.random()*0.3)); // джиттер размера
  s.material.rotation = Math.random() * Math.PI; // рандом-разворот текстуры → живость
  s.material.opacity = 1;
  s.userData.life = FLASH[weaponIdx].life;
  muzzleLight.color.set(FLASH[weaponIdx].color);
  muzzleLight.intensity = FLASH[weaponIdx].light;
  muzzleLight.position.copy(worldPos);
}
// в useFrame: opacity -= delta*1000/life; light.intensity *= 0.80; при opacity<=0 → release
```
> Текстуру `flashTex` генерим один раз в canvas (радиальный градиент + 4-6 лучей-звезда) → dataURL → `TextureLoader`, ноль сетевых ассетов. Ориентация спрайта по `worldQuat` даёт вид «выхлопа из ствола», а не всегда-к-камере (для Railgun критично — длинная вспышка вдоль луча).

---

## 3. TRACERS / лучи / болты

### Сейчас
Одна `THREE.Line` (Player.tsx:353-357), рисуется только для `r===0` (Player.tsx:281), `linewidth` фактически игнорируется большинством платформ (WebGL ограничение — линии всегда 1px). Fade `opacity -= 5*delta`. Для дробовика видно лишь 1 из 8 лучей.

### Апгрейд: пул трейсеров + вид под оружие
`THREE.Line`/`linewidth` — тупик (не толстеет). Используем **quad-трейсер**: тонкий вытянутый `PlaneGeometry`/`BoxGeometry`, ориентированный вдоль луча start→end, с аддитивным материалом. Толщину задаёт **scale**, не `linewidth` → railgun реально толстый.

**Пул:** `TracerPool` из ~16 quad-мешей (хватает на залп дробовика ×8 + перекрытия), `AdditiveBlending`, `depthWrite:false`. `acquire()` берёт свободный, ставит между двумя точками:
```ts
function placeTracer(a: Vec3, b: Vec3, cfg: TracerCfg) {
  const t = tracerPool.acquire();
  _mid.addVectors(a, b).multiplyScalar(0.5);
  t.position.copy(_mid);
  t.scale.set(cfg.width, cfg.width, a.distanceTo(b));   // длина по z
  t.lookAt(b);                                          // ориент вдоль луча
  t.material.color.set(cfg.color);
  t.material.opacity = cfg.opacity;
  t.userData.fade = cfg.fade;                           // скорость гашения/сек
  t.visible = true;
}
// useFrame: opacity -= fade*delta; opacity<=0 → release
```

### Per-weapon вид
| # | Оружие | Тип | Width | Цвет | Fade (op/сек) | Особое |
|---|---|---|---|---|---|---|
| 0 | Auto Rifle | тонкий быстрый трейсер | 0.02 | `#ffd166` | 8 (≈0.12с) | рисуем не каждую пулю, а ~каждую (дешёвый) |
| 1 | Spread Gun | 8 коротких лучей | 0.03 | `#ff9e00` | 10 (≈0.1с) | **рисуем ВСЕ `rays`**, не только r===0 |
| 2 | Plasma Launcher | болт-снаряд | — | `#00f5d4` | — | НЕ трейсер: летящий glow-меш (уже есть projectile-система, §ниже) |
| 3 | Railgun | толстый луч + послесвечение | 0.12 | `#ff006e` | 2.0 (≈0.5с) | долгий «slug-trail», ядро + внешний хало-quad (2 меша) |

> **Spread gun — критичный фикс:** сейчас условие `r === 0` (Player.tsx:281) рисует 1 из 8. Убрать это условие для трейсеров — **каждый** из `config.rays` кладёт свой quad из пула (по 8 за залп, пул на 16 покрывает). Именно веер лучей делает дробовик «мясным».

> **Railgun lingering beam:** ширина 0.12, fade всего 2.0 → луч висит полсекунды и тает. Плюс второй, полупрозрачный «хало»-quad шире (0.35) с fade 3.0 → эффект перегретого слага (Destiny linear-fusion DNA).

### Tracer travel vs instant
- Hitscan (auto/spread/rail) — луч **мгновенный** (выстрел→точка попадания в тот же кадр). Это правильно для читаемости и нетто-справедливости в сети. Иллюзию скорости даёт fade, а не движение.
- Plasma (launcher) — уже **летящий снаряд** (`addProjectile`, Player.tsx:209, velocity 50). Оставляем travel, добавляем glow-трейл за болтом (мелкие затухающие quad-пуфы каждые ~30мс полёта — опц. полиш).

### Impact flash в точке попадания
В `_endPoint` (точка пересечения) — короткая вспышка тем же спрайт-пулом, что и muzzle (или отдельный `impactPool`):
- **По врагу/игроку:** спрайт `#f72585` (в тон существующим enemy-sparks, Player.tsx:26) scale 0.4, life 80мс + больше искр (уже есть, 6 шт).
- **По стене/полу:** спрайт `#00f5d4` (wall-spark color, Player.tsx:27) scale 0.25, life 60мс + 2 искры + опц. decal-quad (тёмный кружок, живёт 2с, пул на 24 — полиш).
Заменяем текущий `new THREE.Mesh(...)+setTimeout` (Player.tsx:261-268) на **пул искр** (см. §10) — setTimeout при быстрой стрельбе плодит таймеры.

---

## 4. HITMARKER + динамический прицел

Живёт в **UI-слое** (DOM/React, `UI.tsx`), НЕ в 3D — прицел всегда в центре экрана, дёшево, чётко. Нужен канал «выстрел попал» из 3D-логики (Player.tsx) в UI. Кладём в zustand transient-события (см. §10 «событийная шина»).

### 4.1 Hitmarker
При успешном попадании (в Player.tsx там, где сейчас `damageEnemy`/`emit("hit")`, строки 247/275) — эмитим hit-событие. UI рисует **X** из 4 коротких штрихов, наложенных на прицел, life ~150мс, scale-in→fade.

| Событие | Вид | Звук | Life |
|---|---|---|---|
| Обычное попадание | белый X, штрих 8px | тонкий «тик» | 120мс |
| Крит (хедшот/×1.5+) | жёлтый X `#ffd166`, толще | выше «тик» | 150мс |
| **Kill** | красный X `#ff006e` + расходящееся кольцо | «чанк» ниже+громче | 250мс |

Реализация (React, поверх crosshair-контейнера UI.tsx:43-52):
```tsx
// подписка на последнее hit-событие из стора
const hit = useStore(s => s.lastHit);   // {id, kind:'hit'|'crit'|'kill', t}
// рендерим <Hitmarker key={hit.id} kind={hit.kind}/> — CSS-анимация scale/opacity, авто-снятие по key
```
CSS: 4 `<span>` абсолютом под 45°, `@keyframes hm { from{transform:scale(1.6);opacity:1} to{transform:scale(1);opacity:0} }` 150мс. **Никакого 3D-оверхеда.** `key={hit.id}` (растущий id) перезапускает анимацию на каждом попадании.

### 4.2 Динамический прицел (bloom)
Текущий прицел (UI.tsx:43-52) статичен. Делаем 4 штриха (или существующие линии), которые **расходятся от центра при огне и спреде** и плавно сходятся:
```ts
// в сторе: crosshairBloom: number (0..1), decays каждый кадр в UI через rAF/useFrame-tick
// при выстреле: bloom = min(1, bloom + kickPerShot[weapon])
// каждый кадр: bloom *= 0.90  (сходится за ~0.3с)
// gap(px) = baseGap + bloom * maxSpread[weapon]
```
| # | Оружие | baseGap | maxSpread | kickPerShot | Форма |
|---|---|---|---|---|---|
| 0 | Auto | 6px | 14px | 0.10 | 4 штриха, тонкие |
| 1 | Spread | 8px | 34px | 0.55 | 4 штриха толстые, широкий разлёт (визуализирует `spread:0.1`) |
| 2 | Plasma | 7px | 12px | 0.22 | кольцо-ромб (в тон текущему rotate-45, UI.tsx:48) |
| 3 | Railgun | 3px | 6px | 0.15 | тонкий точный крест + центр-точка (снайпер) |

> Прицел **раскрывается ровно на величину реального разброса** — игрок читает «сейчас точность плохая», как в CS/Destiny. Для дробовика широкий bloom = честная коммуникация конуса. При смене оружия (`currentWeapon`) прицел мгновенно переключает форму.
>
> **Реализация тика:** bloom затухает по времени. Проще всего — маленький `requestAnimationFrame`-луп в UI-компоненте (или `useFrame` внутри Canvas, пишущий CSS-переменную `--bloom` в оверлей). Не гоняем React-ре-рендер каждый кадр — пишем `style.setProperty('--gap', ...)` в ref прицела.

---

## 5. DAMAGE NUMBERS (апгрейд DamageNumbers.tsx)

### Сейчас
`<Text fontSize=1.5>` всплывает `y += delta*2`, opacity `-= delta`, удаляется через 1с (DamageNumbers.tsx:22-31). Цвет per-call (`#f72585` враг, `#4361ee` игрок, store.ts). Функционально, но «плоско»: нет скейла по урону, нет крита, нет джиттера, все одинаковые.

### Апгрейд — «поп»
Расширяем `DamageNumber` в store.ts новыми полями (все опциональны, старые вызовы не ломаются):
```ts
interface DamageNumber {
  id: string; x:number; y:number; z:number; amount:number; createdAt:number; color?:string;
  // NEW:
  crit?: boolean;         // хедшот / high-damage
  dmgType?: 'enemy'|'player'|'explosion'|'crit';
  vx?: number; vy?: number;   // начальная скорость арки (джиттер)
  seed?: number;              // для детерминированного покачивания
}
```

### Поведение
1. **Скейл по урону:** `fontSize = 0.8 + clamp(amount/120, 0, 1) * 1.6` → 15dmg ≈ 1.0, 120dmg (railgun) ≈ 2.4. Большой урон = крупные цифры (DOOM/Borderlands).
2. **Крит-стайл:** `crit` → цвет `#ffd166`, `outlineWidth 0.15`, fontSize ×1.35, префикс отсутствует но добавляем лёгкий «!» или увеличенный аутлайн. Крит определяем в Player.tsx (напр. попадание в верхнюю часть врага, или damage ≥ порог) — пока простой триггер: railgun-хиты и попадания в bounding-top = крит.
3. **Цвет по типу:**
   | Тип | Цвет | Когда |
   |---|---|---|
   | enemy | `#f72585` магента | урон по фигуре (уже есть) |
   | player | `#4361ee` синий | урон по игроку (уже есть) |
   | crit | `#ffd166` жёлтый | крит |
   | explosion | `#ff9e00` оранж | сплеш плазмы (будущее) |
4. **Спавн-джиттер + арка:** старт `vx = (rand-0.5)*1.5`, `vy = 2.5 + rand*1.5`. Каждый кадр: `x += vx*delta; y += vy*delta; vy -= 4*delta` (гравитация) → цифра выпрыгивает по дуге и оседает, а не тупо ползёт вверх. Плюс лёгкое покачивание `x += sin((t+seed)*8)*0.02`.
5. **Pop-in scale:** первые 100мс `scale` идёт 0.3→1.2→1.0 (overshoot) через простую ease — цифра «щёлкает» в кадр. Реализуем множителем к `fontSize`/`ref.scale`.
6. **Стек одинаковых:** если по тому же врагу дамаг < 120мс назад в близкой точке — можно **суммировать** в одну растущую цифру (DPS-читаемость, Destiny). Опц. полиш; MVP — просто спавним каждую.
7. **Fade:** держим полную непрозрачность 60% времени жизни, затем гасим (сейчас гаснет линейно всю жизнь → рано блёкнет). `life = crit ? 1.4с : 1.0с`.
8. **Billboard:** `<Text>` из drei уже смотрит на камеру. Оставляем.

```tsx
// DamageNumbers.tsx — обновлённый useFrame на цифру:
const age = (Date.now() - d.createdAt) / 1000;
const life = d.crit ? 1.4 : 1.0;
// арка
d._vy -= 4*delta;
ref.current.position.x += d._vx*delta;
ref.current.position.y += d._vy*delta;
// pop-in overshoot (первые 0.1с)
const pop = age < 0.1 ? THREE.MathUtils.lerp(0.3, 1.2, age/0.1)
          : age < 0.18 ? THREE.MathUtils.lerp(1.2, 1.0, (age-0.1)/0.08) : 1.0;
ref.current.scale.setScalar(baseScale * pop);
// fade только в хвосте
ref.current.material.opacity = age < life*0.6 ? 1 : Math.max(0, 1-(age-life*0.6)/(life*0.4));
if (age > life) removeDamageNumber(d.id);
```
> Производительность: цифр может быть много при дробовике (×8 попаданий). **Кап** на `damageNumbers` (напр. 40, дропать старейшие в `addDamageNumber`) + для дробовика лучше суммировать залп в 1 цифру (см. п.6) — 8 отдельных «10» уродливы, одно «80» читается.

---

## 6. SCREEN SHAKE (trauma-модель)

### Модель (Vlambeer / Squirrel Eiserloh "trauma")
Держим одно скалярное `trauma ∈ [0,1]`, оно **само затухает**. Смещение = `trauma²` (нелинейно — мелкие тряски мягкие, крупные бьют). Каждое событие **добавляет** trauma (не set), так что серии выстрелов копятся.

```ts
// модуль-скоуп Player.tsx
let _trauma = 0;
const TRAUMA_DECAY = 1.4;   // /сек — полное затухание за ~0.7с
const _shakeEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function addTrauma(amount: number) { _trauma = Math.min(1, _trauma + amount); }

function applyShake(delta: number) {
  _trauma = Math.max(0, _trauma - TRAUMA_DECAY * delta);
  const s = _trauma * _trauma;                 // квадратичный отклик
  if (s < 0.0001) return;
  const t = performance.now() * 0.001;
  // перлин-подобно через несколько синусов (без аллокаций)
  const pitch = (Math.sin(t*47.0) ) * s * MAX_PITCH;
  const yaw   = (Math.sin(t*57.3) ) * s * MAX_YAW;
  const roll  = (Math.sin(t*39.7) ) * s * MAX_ROLL;
  // домешиваем к камере ТЕМ ЖЕ приёмом, что recoil (после PLC)
  _shakeEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  _shakeEuler.x += pitch; _shakeEuler.y += yaw; _shakeEuler.z += roll;
  camera.quaternion.setFromEuler(_shakeEuler);
}
// MAX_PITCH=0.03, MAX_YAW=0.03, MAX_ROLL=0.05 рад
```

### Порядок применения в useFrame (важно — не драться с PLC и recoil)
В конце `useFrame`, **после** `camera.position.set(...)`:
```
1. updateRecoil(delta, config.recover)     // пружина
2. читаем camera.quaternion как базу
3. base.x += recoilCurrent.x; base.y += recoilCurrent.y
4. shake: base.x += pitch; base.y += yaw; base.z += roll
5. camera.quaternion.setFromEuler(base)     // ОДНА запись, recoil+shake вместе
```
> Recoil и shake **складываются в один эйлер** и пишутся в quaternion один раз за кадр. PLC на следующем mousemove перезапишет с чистой базы → и recoil, и shake живут «поверх» и затухают, никогда не залипая в аим-стейте. Позиция камеры уже поставлена строкой 112 (шейк — только вращательный, чтобы не конфликтовать с жёстким `position.set`).
> **Roll (z)** — только у шейка (не у recoil). Лёгкий roll читается как «удар» и невозможен обычной мышью → сразу чувствуется «взрыв», а не «дёрнул мышкой».

### Trauma per event
| Событие | +trauma | Где хук |
|---|---|---|
| Выстрел auto | 0.06 | блок стрельбы, weapon 0 |
| Выстрел spread | 0.18 | weapon 1 (жирный залп) |
| Выстрел plasma | 0.10 | weapon 2 |
| Выстрел railgun | 0.30 | weapon 3 (макс из оружия) |
| Попал по врагу | +0.04 | где `damageEnemy` |
| Получил урон (takeDamage) | 0.25 | подписка на takeDamage |
| **Убил врага/игрока** | 0.35 | kill-событие (§7) |
| Взрыв плазмы рядом | 0.45 | сплеш-радиус (будущее) |
| Взрыв плазмы дальний | 0.15..0.45 по дистанции | |

> Кап на 1.0 не даёт «эпилепсию» при спаме. Для авто-винтовки 0.06/выстрел при rate 120мс → устойчивое ~0.4 trauma в очереди = приятный «buzz», не рвотный. Настраивать вживую с владельцем.

---

## 7. KILL FEEDBACK

Момент убийства — кульминация петли. Триггерится в двух местах:
- **Локальный враг-фигура:** в `damageEnemy` (store.ts:147) когда `health <= 0` (там уже считается `deadEnemies`, `scoreGain` — Player.tsx/store.ts:168). Отсюда эмитим kill-событие.
- **Игрок-цель (сеть):** сервер шлёт `player_died` → в `src/socket.ts` обработчик эмитит kill-событие в стор.

### Пакет фидбека на kill (всё косметика, без time-scale)
1. **Trauma-панч:** `addTrauma(0.35)` — экран бьёт заметно сильнее обычного хита.
2. **Kill-хитмаркер:** красный расширенный X + расходящееся кольцо (§4.1) — мгновенное «ты убил».
3. **Kill-звук:** отдельный низкий «чанк»/«boom» (§8), громче тика.
4. **Crosshair-пульс:** прицел коротко раздувается и схлопывается (bloom += 0.6 с быстрым возвратом) — тактильный «удар».
5. **Гор-берст:** увязка с инкрементом 02 (воксель-смерть) — здесь только триггерим существующий `addDebris`/дебрис-путь (store.ts:170-189 уже делает чанки для candle; для остальных врагов — берст искр из пула + опц. воксель из инк.02). Джус-слой 04 **не владеет** разрушением, только «поджигает» его + добавляет вспышку смерти (белый флеш-спрайт scale 1.2 в позиции врага, life 120мс).
6. **Streak-флориш (полиш):** считаем киллы в окне (напр. 2+ за 3с). На стрике — короткий UI-текст «DOUBLE / TRIPLE / RAMPAGE» (Halo-медали) в оверлее + чуть громче kill-звук с растущим питчем. Живёт 1с, fade. Данные: `killStreak` + `lastKillTime` в сторе.

```ts
// store.ts damageEnemy, где deadEnemies.length>0:
if (deadEnemies.length) {
  // emit kill event (см. §10 шину):
  pushEvent({ type:'kill', pos:e.position, streak: nextStreak });
}
```

> **Читаемость киллов** важнее пышности: hitmarker + звук + trauma-панч дают 90% удовлетворения (Halo знал это). Стрик-медали — вишенка.

---

## 8. AUDIO (расширение audio.ts)

### Сейчас
`playShootSound(freq, dur)` — один square-осциллятор с pitch-down (audio.ts:12-30). `playJumpSound`. Стрельба зовёт `playShootSound(config.sound, 0.05)` (Player.tsx:193).

### Новые события → вызовы
Расширяем `audio.ts` набором синтезированных (ноль сетевых ассетов, всё WebAudio) звуков:

| Событие | Функция | Синтез (эскиз) | Хук |
|---|---|---|---|
| Выстрел auto | `playWeaponFire(0)` | square 800→200, dur 0.05, + короткий noise-burst «щелчок» | Player.tsx блок стрельбы |
| Выстрел spread | `playWeaponFire(1)` | noise-burst (lowpass 2k→200) 0.12 + низкий thump (sine 90Гц) | " |
| Выстрел plasma | `playWeaponFire(2)` | sine 400→800 «вуф» + лёгкий FM-шиммер | " |
| Выстрел railgun | `playWeaponFire(3)` | sweep sine 1200→80 0.25 + noise-tail «разряд» реверб-хвост | " |
| Impact по плоти | `playImpact('flesh', pos?)` | короткий lowpass noise «чпок» 0.06, питч чуть выше | где enemy-hit (Player.tsx:247) |
| Impact по стене | `playImpact('wall')` | резкий highpass noise «тик» 0.04 | где wall/floor-hit (Player.tsx:255) |
| **Hitmarker** | `playHitmarker(crit)` | очень короткий sine-пинг 1800Гц (crit 2400Гц) 0.03, тихий | на hit-событии (UI или Player) |
| **Kill** | `playKill(streak)` | нисходящий «boom»: sine 300→60 0.2 + noise-punch; питч +streak*80Гц | kill-событие (§7) |
| Low-ammo / near (будущее) | `playLowAmmo()` | двойной тихий «клик» 1200Гц | когда введём патроны |

```ts
// audio.ts — общий noise-хелпер (переиспользуем буфер):
let _noiseBuf: AudioBuffer | null = null;
function noise(dur, filterType, f0, f1, gain) {
  if(!audioCtx) return;
  if(!_noiseBuf){ /* сгенерить 1с белого шума один раз */ }
  const src = audioCtx.createBufferSource(); src.buffer = _noiseBuf;
  const flt = audioCtx.createBiquadFilter(); flt.type = filterType;
  flt.frequency.setValueAtTime(f0, audioCtx.currentTime);
  flt.frequency.exponentialRampToValueAtTime(f1, audioCtx.currentTime+dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+dur);
  src.connect(flt); flt.connect(g); g.connect(audioCtx.destination);
  src.start(); src.stop(audioCtx.currentTime+dur);
}
```
> **Пространственность (полиш):** impact-звуки можно панорамировать через `StereoPannerNode` по X-смещению точки попадания относительно направления камеры — дешёвый «откуда прилетело». Hitmarker/kill — всегда центр (это UI-фидбек игроку, не мировой звук).
>
> **Анти-спам:** авто-винтовка при rate 120мс = ~8 выстрелов/сек. Ок для square, но hitmarker-пинги не наслаивать бесконтрольно — если < 40мс с прошлого тика, пропускать (throttle), иначе «трещотка».

---

## 9. Per-weapon FEEL matrix (сводная — чтобы 4 оружия ощущались РАЗНО и премиально)

| Аспект | 0 · AUTO RIFLE | 1 · SPREAD GUN | 2 · PLASMA LAUNCHER | 3 · RAILGUN |
|---|---|---|---|---|
| Фэнтезия | контролируемый ливень | комнатный вышибала | тяжёлый лоб-заряд | «палец бога», one-shot |
| Rate (cooldown) | 120мс (быстро) | 800мс (медленно) | 400мс | 1500мс (очень медленно) |
| Damage | 15 | 10×8 лучей | 40 (снаряд) | 120 |
| Recoil-паттерн | лесенка вверх, растёт со стриком, лёгкий yaw-зигзаг | один жирный вертикальный панч | средний ровный кик | ОГРОМНЫЙ вертикальный панч, без yaw |
| Muzzle flash | мелкая тёплая жёлтая | широкая оранжевая | циан-шар | узкая длинная магента |
| Tracer | тонкий быстрый жёлтый, fade 0.12с | **веер из 8** оранжевых лучей | летящий циан-болт + трейл | толстый магента-slug + хало, висит 0.5с |
| Screen shake (+trauma) | 0.06 (buzz) | 0.18 (толчок) | 0.10 | 0.30 (удар) |
| Sound | сухой square-стаккато | noise-бум + низкий thump | «вуф» + шиммер | электро-sweep + реверб-хвост |
| Crosshair bloom | средний, тонкие штрихи | ОГРОМНЫЙ разлёт (честный конус) | кольцо-ромб, малый | почти не двигается, точка |
| Impact | сред. искры | 8 точек искр веером | циан-вспышка (+сплеш будущее) | пробойная вспышка + big spark |
| Крит-склонность | редко | нет | по сплешу | часто (высокий дамаг → крит-стайл цифры) |
| Ощущение в руке | «держу поток, веду вниз» | «БАХ — и перезарядка паузой» | «зарядил-плюнул» | «замер, выцелил, УДАР» |

> Различие держится на **контрасте темпа × веса**: авто = высокий темп/малый вес каждого события; рельса = низкий темп/максимальный вес одного события. Дробовик = редкий, но самый «широкий» кадр (веер+разлёт прицела+бум). Плазма = единственный travel-снаряд, поэтому ощущается «физически» иначе. Числа выше — стартовая точка для тюнинга с владельцем.

---

## 10. ПРОИЗВОДИТЕЛЬНОСТЬ и мультиплеер

### Пулы (ноль аллокаций/setTimeout в горячем пути)
Все эффект-объекты — **предсозданные пулы**, ring-buffer `acquire()/release()`, никаких `new` и `setTimeout` в `useFrame` (текущий код грешит и тем, и другим — Player.tsx:261-268 создаёт Mesh + setTimeout на каждую искру).

| Пул | Размер | Тип объекта | Жизнь по |
|---|---|---|---|
| `sparkPool` | 64 | `THREE.Mesh` (общая geo+mat, как сейчас) | `userData.life`, тикается в useFrame |
| `tracerPool` | 16 | quad-меш (Additive) | opacity-fade |
| `muzzlePool` | 4 | `Sprite` (Additive) | opacity-fade |
| `impactPool` | 24 | `Sprite` (Additive) | opacity-fade |
| `muzzleLight` | 1 | `PointLight` (никогда не пересоздаётся) | intensity *= 0.8 |
| damage numbers | кап 40 | drei `<Text>` | age (store) |

**Общий тик пулов** — один проход в `useFrame` (Player.tsx), декремент `life`/`opacity`, при исчерпании `visible=false` + возврат в пул. Ноль таймеров. Ноль GC-стуттера (ADR из 00-README: «отсутствие аллокаций в useFrame»).

### Событийная шина 3D→UI (для hitmarker/kill/bloom)
UI (DOM) и логика (Player.tsx, three) разделены. Нужен лёгкий канал. Варианты:
- **Zustand transient** (рекомендую): поля `lastHit:{id,kind}`, `crosshairBloom`, `killStreak` в сторе. Player пишет (`set`), UI подписывается **узко** (`useStore(s=>s.lastHit)`), чтобы не ре-рендерить весь HUD. Bloom-decay пишем в CSS-var через ref, не через set (иначе 60 ре-рендеров/сек).
- Альтернатива: чистый mitt/EventEmitter, UI слушает в `useEffect`. Меньше сторовой возни. Любой ок; главное — **не** гонять React-рендер на каждый кадр bloom.

### Мультиплеер (авторитет сервера незыблем)
- **Весь джус §1-8 — локальный и косметический.** Он рисуется у стрелка на клиенте. Урон/HP/смерть — **только сервер** (`socket.emit("hit", {targetId, damage})` Player.tsx:275; `player_died`). Клиентский damage-number по игроку (Player.tsx:277) — это **предсказание**; истину подтверждает сервер.
- **Никакого замедления времени** — по определению не может рассинхронить сеть, т.к. мы вообще его не используем. Все эффекты завязаны на `delta`/`performance.now()` локально и не влияют на симуляцию.
- **Ремоут-стрельба:** когда приходит чужой `shoot`/`update.isShooting`, можно проигрывать **чужой** muzzle-flash + tracer на позиции того игрока (по `remotePlayers`, store.ts:65) — дешёвый пул тот же. Чужой шейк/recoil — НЕ применяем к своей камере (только свои события трясут свой экран). Чужой звук — панорамированный по дистанции (полиш).
- **Детерминизм не требуется** для косметики: если у двух клиентов вспышки чуть разошлись — неважно, HP считает сервер.

---

## 11. Тюнинг-таблица (единая, для правки вживую с владельцем)

```ts
// Единый конфиг джуса — вынести в src/config/juice.ts, импортить в Player/UI/DamageNumbers
export const JUICE = {
  recoil: {
    //            pitch,  yaw,   recover, punch
    0: { pitch:0.010, yaw:0.004, recover:14, punch:0.6, streakClimb:true },
    1: { pitch:0.045, yaw:0.010, recover:10, punch:1.0 },
    2: { pitch:0.022, yaw:0.006, recover:12, punch:0.8 },
    3: { pitch:0.075, yaw:0.000, recover:7,  punch:1.4 },
  },
  trauma:  { fire:[0.06,0.18,0.10,0.30], hit:0.04, hurt:0.25, kill:0.35, decay:1.4,
             maxPitch:0.03, maxYaw:0.03, maxRoll:0.05 },
  flash:   { color:['#ffd166','#ff9e00','#00f5d4','#ff006e'],
             scale:[0.35,0.6,0.5,0.45], life:[45,60,70,90], light:[1.5,2.5,2.0,4.0] },
  tracer:  { width:[0.02,0.03,0,0.12], color:['#ffd166','#ff9e00','#00f5d4','#ff006e'],
             fade:[8,10,0,2.0], railHaloWidth:0.35, railHaloFade:3.0 },
  crosshair:{ baseGap:[6,8,7,3], maxSpread:[14,34,12,6], kickPerShot:[0.10,0.55,0.22,0.15], decay:0.90 },
  dmgNum:  { minSize:0.8, maxSize:2.4, critMul:1.35, life:1.0, critLife:1.4,
             critColor:'#ffd166', colors:{enemy:'#f72585',player:'#4361ee',explosion:'#ff9e00'},
             cap:40 },
  pools:   { spark:64, tracer:16, muzzle:4, impact:24 },
};
```
> Всё «магическое число» джуса — здесь, чтобы владелец крутил без охоты по файлам. Стартовые значения консервативны в сторону «читаемо», а не «эпилепсия»; поднимать вместе на плейтесте.

---

## 12. Human feel-checklist (чем принимаем)

- [ ] Каждый выстрел **видно на экране** (кик) — стрельба не «ватная».
- [ ] Отпустил гашетку авто → прицел плавно вернулся в центр (пружина, без залипания).
- [ ] Авто-винтовка «климбит» вверх со стриком — есть чему учиться компенсировать.
- [ ] Railgun ощущается как УДАР: большой кик + толстый висящий луч + бум + сильный шейк.
- [ ] Дробовик показывает **все 8 лучей** веером + широко раскрывает прицел.
- [ ] Попадание = мгновенный X-хитмаркер + тик — «я попал» без раздумий.
- [ ] Убийство ощутимо жирнее хита: kill-X + boom + панч экрана.
- [ ] Damage-цифры «выпрыгивают» дугой и щёлкают в кадр; большой урон = большие цифры; крит жёлтый.
- [ ] Шейк не дерётся с мышью, не тошнит, roll читается как «удар», а не «глюк».
- [ ] 60 fps держится при спаме дробовика в толпу (пулы, без GC-стуттера, без setTimeout-роя).
- [ ] Ничего не рассинхронит сеть: сервер по-прежнему решает HP/смерть.
- [ ] 4 оружия ощущаются как **4 разных оружия** вслепую по звуку+кику+прицелу.

---

## 13. MVP для инкремента 04 (минимум, чтобы стрельба СРАЗУ ощущалась отлично)

> «Art of Screenshake»: 80% ощущения дают 4-5 дешёвых эффектов. Делаем их первыми, законченным playable-срезом (senior first pass), владелец играет и подтверждает.

**MVP (в этом порядке — каждый уже заметно улучшает игру):**
1. **Камера-кик + пружина возврата** (§1, подход A) — самый большой скачок ощущения на единицу кода. Расширить `WEAPON_CONFIG.kick`, добавить `_recoil*` + `updateRecoil` + применение в конце useFrame.
2. **Screen shake trauma** (§6) — складывается в тот же эйлер, что и recoil (одна запись в quaternion). `addTrauma` на выстрел/хит/килл.
3. **Muzzle flash** (§2) — спрайт-пул + один pool-light. Мгновенная «энергия» у ствола.
4. **Hitmarker + тик-звук** (§4.1, §8) — X в UI + `playHitmarker`. Замыкает петлю «попал».
5. **Damage numbers pop** (§5) — скейл по урону + арка + pop-in + крит-цвет. Апгрейд DamageNumbers.tsx (файл уже есть, правки локальны).

**Позже (polish waves):**
- Веер-трейсеры дробовика + railgun lingering beam + impact-decals (§3) — заменить `THREE.Line` на tracer-пул.
- Динамический bloom-прицел с формой под оружие (§4.2) — переписать crosshair в UI.tsx.
- Kill-стрик медали / флориши (§7 п.6).
- Per-weapon синтез-звуки full set + пространственное панорамирование (§8).
- Пулинг искр вместо `new Mesh + setTimeout` (§10) — перф-чистка (сделать до релиза).
- Ремоут muzzle/tracer для чужой стрельбы (§10).
- Плазма-трейл + сплеш-урон + explosion-damage-numbers.

> MVP-набор (кик + шейк + вспышка + хитмаркер + лучшие цифры) трогает ровно 3 файла (`Player.tsx`, `UI.tsx`, `DamageNumbers.tsx`) + `store.ts`/`audio.ts` мелко + новый `config/juice.ts`. Ноль изменений в netcode, ноль риска для мультиплеера.
```
