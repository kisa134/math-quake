# V8 «СИСТЕМА СИСТЕМ» — конституция новой версии
Полное видение owner'а, зафиксировано 2026-07-26 (дословно, его порядок внедрения = наш roadmap).
V1 зафиксирована тегом `v1.0` (коммит 30efc7e). V8 строится волнами на той же базе.

---

## 1. Фундамент игры

Math Quake — high-velocity psychedelic PvPvE market shooter, где рынок — живой мировой цикл, а бой, стройка, орда, экономика и лор связаны в один ритуальный матч. Уже есть: Quake/CS movement, grapple, jetpack, 16 пушек, портал-ган, магия, орда, buy-меню, лор шести эпох, чёрная дыра, 180 свечей, транспорт, драконы, стройка, Supabase-мультиплеер, гига-масштабный Trading Floor.

### 5 PILLARS (цемент)
1. **Velocity** — движение как кайф.
2. **Living Market** — рынок как мировой дирижёр.
3. **Violence Becomes Value** — убийство как источник экономики.
4. **Mutable Space** — карту можно строить, ломать и искажать.
5. **Juicy Absurdity** — всё должно быть сочным, странным и авторским.

Любое новое решение проходит один вопрос: **усиливает ли оно один из pillars — или просто добавляет шум?**

## 2. Core loop (первый неприкасаемый закон)
1. Очень быстро двигаюсь.
2. Стреляю, убиваю, уклоняюсь, перемещаюсь по вертикали.
3. Получаю деньги, ресурсы, бафы, куски оружия, тела врагов.
4. Покупаю, строю, модифицирую себя и пространство.
5. Рынок меняет эпоху — всё вокруг становится другим.
6. Волны усиливаются, я богатею, тяжелею, мутирую и рискую всё потерять.

Если новая идея не усиливает хотя бы один шаг лупа — она уходит в later layer.

## 3. Придуманные системы

### 3.1 Вертикальная социопирамида
Мир как башня в духе «Платформы»: верх — элита, низ — безумие, голод, мусор, ад. Вертикаль = доступ, выживание, власть. Элементы: этажи статуса, карьерные лестницы/лифты/батуты, тайные двери, маршруты вверх/вниз/вбок. Внедрять как map logic и future mode.

### 3.2 Деньги как физический вес
Капитал в мешке, который реально весит: больше денег → тяжелее → хуже скорость/прыжок/крюк → выше шанс упасть → выше шум/заметность/цена смерти. Некоторые классы/билды лучше переносят капитал. Risk-reward: жадность ограничивает мобильность.

### 3.3 Война как экономика
Endless-wave, где крипы — сырьё: волна → трупы/scrap/biomass/fuel/data → игроки разгребают поле → перерабатывают → строят рынок/турели/фабрики/защиту → следующая волна сильнее. Не «шутер с волнами», а war-economy arena.

### 3.4 Роли в команде
Убийца волн · сборщик · переработчик · строитель · трейдер · логист. Кооперативная специализация вместо одинаковых DPS.

### 3.5 Воксельный редактор оружия
Не анархия, а base chassis + sockets + attach rules + visual identity:
core archetype → attachment sockets → functional modules → voxel shell → cosmetic/reactive parts → blueprint save/share.

## 4. Классы

### Внешние buckets: Assault / Defense / Support
### Внутренние роли: Slayer / Anchor / Builder / Distorter / Extractor / Pick / Engine

### Стартовые 6:
1. **Маг-пространственник** (Support/Distorter) — порталы, гравитация, сжатие пространства, охлаждение союзников, перегрев врагов, reposition. Слабость: хрупкость, высокий skill ceiling.
2. **Тяжёлый ликвидатор** (Defense/Anchor) — экзоскелет, миниган+ракеты, berserk/overheat, жжёт своё здоровье и sanity за силу. Слабость: медленный, kite'ится.
3. **Солдат-командир** (Assault/Engine) — стабильный gunfight, команды миньонам, баннеры, простой kit для новичков. Слабость: без микроконтроля не раскрывается.
4. **Инженер-арбитражник** (Defense/Builder) — турели, relay-узлы, переработка останков, экономика команды, укрепление карты. Слабость: выбей сетап — резко слабеет.
5. **Шпион-меметик** (Support/Pick) — маскировка, спуфинг сигналов, саботаж построек, ложные метки, панические фейки, резня тылов. Слабость: лобовой бой.
6. **Некро-брокер** (Support/Extractor-Distorter) — переработка трупов, debt-ghosts, смерть→ресурсы, лечение через перераспределение потерь, усиление в РАСПРОДАЖУ/КАПИТУЛЯЦИЮ. Слабость: зависит от количества тел.

Позже: Квантовый скаут · Снайпер-пророк · AI-оракул/Космо-ведьма.

## 5. Гибкая кастомизация (PoE-подход без потери лица)
- **Класс = стартовая ось, не клетка**: стартовая позиция + 1 сигнатурная механика + 1 уникальный resource loop + 1-2 особых ветки, дальше — большая shared network.
- **Три слоя**: Class Core (идентичность) → Universal Tree (движение/heat/вес капитала/harvesting/стройка/порталы/дроны/рынок/крюк/транспорт) → Mutation/Ascendancy Layer (поздние специализации).
- **Уникальным остаётся**: топология мага, перегрев+масса тяжёлого, инфраструктура инженера, spoofing шпиона, работа с мёртвыми некро-брокера, миньоны солдата.
- Ascendancy-примеры: маг — Topologist/Thermomancer/Gate Shepherd; тяжёлый — Debt Engine/Berserk Liquidator/Iron Bull; инженер — Fortress Broker/High-Frequency Architect/Scrap Alchemist.

## 6. Оружие как живое существо
Каждый ствол обязан иметь слои:
- **Idle life** — дыхание, микро-движение, sway.
- **Fire life** — выстрел, болт, отдача, камера, вспышка.
- **Mechanical life** — затвор, барабан, подача, вращение, перегрев.
- **Thermal life** — glow, дым, охлаждение, heat state.
- **Impact life** — гильзы, частицы, вибрация, мусор.
- **Ownership life** — следы апгрейдов, трофеи, charm'ы, наклейки, ржавчина, свечение.

Двигаться должно: затворы, помпы, блоки минигана, отдача корпуса, шланги/поршни/катушки, магазин при перезарядке, гильзы, тепловые пластины, эмиссивные сегменты, ампулы с жидкостью, руны.
Спектакль выстрела: muzzle flash, откат, camera kick, свой shell ejection, свой mech clack, свой body impact, свой low-end punch, tail/decay.

## 7. Звук (инженерия кайфа)
**5 слоёв на каждый ствол**: Mech (затвор/клик/пружина) · Body (тело выстрела) · Punch (низ, удар в грудь) · Tail (хвост/реверб/воздух) · Foley (гильзы/перезарядка/перегрев).

**Sonic fantasy на ствол**: GLITCH WAND crystalline snap+spectral fizz · SCATTER SHOT сухой мясной blast+shell clack · PLASMA STAFF wet electric bloom+ion hiss · RAIL BLADE slicing metallic crack+after-ring · KALASH GLITCH dirty industrial chatter · SALARY SHREDDER rotating chunk+angry overheat scream · WHALE HARPOON tense launch+giant cable thunk · BLACK SWAN catastrophic singular hit+ominous tail.

**Правила**: пушка игрока звучит жирнее вражеских (payoff и extension of agency). Состояния звука: cold / warm / overheating / jammed / empowered / buffed-by-epoch.

## 8. Конструктор мега-пушки
**Архитектура**: Base chassis → Weapon class → Attachment sockets → Functional modules → Reactive modules → Voxel shell → Blueprint → Ownership data.
**Категории деталей**: Barrel · Chamber · Feed system · Stock/brace · Grip · Energy core · Muzzle · Underbarrel · Scope/oracle · Catalyst/rune/AI chip · Shell style · Heat sink · Relic slot.
**Добыча в мире**: scrap parts, legendary mechanisms, glitch coils, biomass glands, cursed relics, AI chips, black hole fragments, dragon organs, market cores, dead player blueprints — оружие собирается из останков мира.
**Баланс**: параметры от chassis + key modules + rarity budget + compatibility rules; воксельная оболочка почти косметика (чуть mass/heat dispersion/intimidation/handling). «Самый огромный кирпич» НЕ должен побеждать.

## 9. Кастомизация персонажа как конструктор
**Body/Augments**: экзоскелет, доп. мешок капитала, тепловые рёбра, крюк-усилитель, нейросеть наведения, corpse harvester spine, spell stabilizer, anti-fall boots, drone port, black-swan gland.
**Class Core** + **Shared Build Web** (движение/money mass/harvesting/building/summon control/portal manipulation/heat/vehicle mastery/crit chains/epoch attunement/market anomalies).

## 10. Порядок внедрения (production order)
- **Этап 1 — вкус и живая стрельба**: shell ejection, bolt animation, weapon sway, recoil tiers, overheat visuals, richer sound layers, per-weapon identity. Огромный perceptual gain быстро.
- **Этап 2 — состояния оружия**: cold/warm/overheated, glow/smoke/jam risk, epoch-reactive visuals+sound, moving modules.
- **Этап 3 — модульные детали**: chassis, sockets, 10-15 модулей, blueprint save/load.
- **Этап 4 — добыча деталей**: parts as loot, salvage, dead weapon fragments, workbench.
- **Этап 5 — классы**: 4-6 стартовых + unique resource loops.
- **Этап 6 — shared build web**: PoE-like мета-сетка (только после того как gun feel готов!).

## 11. Главная инженерная мысль
«Больше свободы» ≠ «лучше». Свобода держится на жёстких правилах совместимости, стоимости и роли:
**ядро жёсткое · вариативность огромная · цена за силу всегда есть · визуальная и звуковая читаемость обязательна.**

## 12. Master checklist
1. Зафиксировать pillars и core loop. ✅ (этот документ + Библия)
2. Доделать живость оружия. ← V8 Ф1
3. Многослойный gun sound design. ← V8 Ф1
4. Weapon states: cold/warm/overheat/empowered. ← V8 Ф2
5. Modular weapon chassis + sockets. ← Ф3
6. World loot частей оружия. ← Ф4
7. Blueprint-сохранение и sharing. ← Ф3
8. Деньги как физический вес. ← нить (сливается с WOLF W3 GAZE/хром)
9. War-economy loop из трупов и ресурсов. ← нить
10. Бульдозеры, переработка, рынок останков. ← нить
11. 6 стартовых классов. ← Ф5
12. Unique resource loop каждому классу. ← Ф5
13. Shared build web. ← Ф6
14. Ascendancy-специализации. ← Ф6
15. Вертикальная башня/социопирамида. ← отдельный режим/структура, после Ф6.
