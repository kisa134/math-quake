import { useStore } from '../store';
import { WEAPONS } from '../config/weapons';
import { MODS, MOD_BY_ID, SOCKETS, SOCKET_RU } from '../config/weaponMods';
import { ASSETS } from '../config/assets';
import { MUTATIONS } from '../game/botHorde';
import {
  adminCtx, adminTeleport, tpToDragon, adminCarToMe,
  setSpeedMult, getSpeedMult, setJumpMult, getJumpMult,
  setJetInfinite, isJetInfinite, ringAtMe, orbAtMe,
} from '../game/admin';
import { adminSpawnBot } from './BotHorde';
import { blackHoleFeed, blackHoleSuck } from './VoxelCandles';
import { formationOverride } from '../game/formations';
import { fireSalvo } from './Euphoria';
import { getCity } from '../game/cityscape';
import { DRAGONS } from '../game/voxDragon';
import { playSuction, playHitTick } from '../utils/audio';
import { gunState } from '../game/gunState';
import { MAPS, currentMap, setMapInUrl } from '../config/maps';

/**
 * V8.5 П1 — THE HUB (Tab). Максимум песочницы на одном КЛИКАБЕЛЬНОМ экране:
 * справка по всем фичам, арсенал, мастерская, стройка-палитра, админ-спаун и
 * ручки мира. Пойнтер разблокирован пока хаб открыт; кнопка ИГРАТЬ re-lock'ает
 * прямо в жесте клика (иначе Chrome откажет).
 */

const ENEMY_TYPES = ['torus', 'torusKnot', 'icosahedron', 'octahedron', 'dodecahedron', 'candle'] as const;
const CREATURES = ['blob', 'wisp', 'crab'] as const;

const btn = 'px-3 py-1.5 border border-white/20 text-white/80 font-mono text-[12px] uppercase tracking-wider hover:border-amber-300 hover:text-amber-200 cursor-pointer select-none';
const btnOn = 'px-3 py-1.5 border border-emerald-400 text-emerald-300 font-mono text-[12px] uppercase tracking-wider cursor-pointer select-none';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-white/12 bg-black/55 p-4">
    <div className="font-black text-[11px] tracking-[0.35em] uppercase mb-3" style={{ color: 'var(--accent, #c8b273)' }}>{title}</div>
    {children}
  </div>
);

const HELP: [string, string][] = [
  ['WASD + мышь', 'движение · бхоп/страйф как в Quake'],
  ['Space ×2', 'джетпак (топливо внизу экрана)'],
  ['ПКМ', 'крюк-Спайдермен: цепляет ВСЁ, свинг, буст на отпускании'],
  ['ЛКМ', 'огонь · у каждого ствола свой спрей/звук/гильзы'],
  ['1-9 / колесо', 'оружие (10-16 только колесом)'],
  ['Q зажать / тап', 'рынок $SOUL: LONG/SHORT флик · тап = закрыть позицию'],
  ['P', 'арсенал-свитчер'],
  ['N', 'мастерская: 4 сокета × 10 модулей, чертежи сохраняются'],
  ['E зажать', 'колесо магии (PRISM/VOID/радуги)'],
  ['B', 'стройка: скролл деталь · R поворот · [ ] размер · G статик/физика'],
  ['T', 'сесть в тачку / оседлать дракона / приручить существо'],
  ['Space в тачке', 'ручник-дрифт (дым+визг)'],
  ['F', 'команда миньонам · жертва у Жерла'],
  ['C', 'магнит-ботинки'],
  ['V', '3-е лицо'],
  ['9 слот', 'портальная пушка A/B'],
  ['Каждые 75с', 'эпоха рынка: мир перекрашивается, музыка дышит'],
  ['Каждую ЭЙФОРИЮ', 'формация душ + фейерверки с крыш'],
  ['Каждые 10 мин', 'торговый день: звонок, подиум, звание'],
  ['?debug=1', 'FPS-панель'],
  ['Бэклог', 'docs/V8_BACKLOG.md в репо — всё что в проде / частично / очередь'],
];

export const Hub = () => {
  const open = useStore((s) => s.hubOpen);
  const weapon = useStore((s) => s.currentWeapon);
  const mods = useStore((s) => s.weaponMods[weapon]);
  const god = useStore((s) => s.god);
  const editorSelect = useStore((s) => s.editorSelect);
  const editorMode = useStore((s) => s.editorMode);
  const placedCount = useStore((s) => s.placedProps.length);
  const isHost = useStore((s) => s.isHost);
  const money = useStore((s) => s.money);

  if (!open) return null;
  const st = () => useStore.getState();
  const close = () => {
    st().setHub(false);
    (document.querySelector('canvas') as HTMLCanvasElement | null)?.requestPointerLock();
  };
  const near = (r = 6): [number, number, number] => {
    const a = Math.random() * Math.PI * 2;
    return [adminCtx.x + Math.cos(a) * r, adminCtx.y + 1, adminCtx.z + Math.sin(a) * r];
  };

  return (
    <div className="absolute inset-0 z-40 pointer-events-auto overflow-y-auto"
         style={{ background: 'radial-gradient(circle at center, rgba(6,5,4,0.88), rgba(0,0,0,0.96))' }}>
      <div className="max-w-6xl mx-auto p-6 flex flex-col gap-4">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="font-black text-3xl uppercase tracking-[0.2em] text-white">ХАБ</div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-white/40">Math Quake · вся песочница на одном экране · Tab закрыть</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="font-mono text-amber-200 text-xl font-bold tabular-nums">${money}</div>
            <button onClick={close} className="px-8 py-3 bg-amber-300 text-black font-black uppercase tracking-[0.25em] hover:bg-amber-200 cursor-pointer">
              Играть ▸
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* АРСЕНАЛ */}
          <Section title="Арсенал — клик = взять">
            <div className="grid grid-cols-4 gap-1">
              {WEAPONS.map((w, i) => (
                <div key={w.name} className={i === weapon ? btnOn : btn}
                     onClick={() => { st().setWeapon(i); playHitTick(); }}>
                  {w.name}
                </div>
              ))}
            </div>
          </Section>

          {/* МАСТЕРСКАЯ */}
          <Section title={`Мастерская — ${WEAPONS[weapon]?.name ?? ''} · клик = крутить слот`}>
            <div className="flex flex-col gap-1">
              {SOCKETS.map((sock) => {
                const id = mods?.[sock];
                const m = id ? MOD_BY_ID[id] : undefined;
                return (
                  <div key={sock} className={btn + ' flex justify-between'}
                       onClick={() => { st().cycleMod(weapon, sock); playHitTick(); }}>
                    <span className="text-white/45">{SOCKET_RU[sock]}</span>
                    {m ? <span style={{ color: m.color }}>{m.label} · {m.desc}</span> : <span className="text-white/30">пусто</span>}
                  </div>
                );
              })}
              <div className="font-mono text-[10px] text-white/35 mt-1">{MODS.length} модулей · чертёж сохраняется сам · обвес виден на стволе</div>
            </div>
          </Section>

          {/* СТРОЙКА */}
          <Section title={`Стройка — палитра (${placedCount}/300) · клик = выбрать и строить`}>
            <div className="grid grid-cols-5 gap-1 max-h-44 overflow-y-auto">
              {ASSETS.map((a) => (
                <div key={a.id} className={a.id === editorSelect ? btnOn : btn}
                     onClick={() => { st().setEditorSelect(a.id); if (!editorMode) st().toggleEditor(); }}>
                  {a.label ?? a.id}
                </div>
              ))}
            </div>
            <div className="font-mono text-[10px] text-white/35 mt-2">B в игре · скролл деталь · R поворот · [ ] размер ×0.25–30 · G статик/физика · ЛКМ ставит / ПКМ удаляет</div>
          </Section>

          {/* МИР */}
          <Section title="Мир — ручки (локально)">
            <div className="flex flex-wrap gap-1">
              <div className={god ? btnOn : btn} onClick={() => st().setGod(!god)}>GOD {god ? 'ON' : 'OFF'}</div>
              <div className={isJetInfinite() ? btnOn : btn} onClick={() => { setJetInfinite(!isJetInfinite()); st().setHub(true); }}>ДЖЕТ ∞ {isJetInfinite() ? 'ON' : 'OFF'}</div>
              {[1, 2, 3].map((m) => (
                <div key={m} className={getSpeedMult() === m ? btnOn : btn} onClick={() => { setSpeedMult(m); st().setHub(true); }}>СКОРОСТЬ ×{m}</div>
              ))}
              {[1, 1.5, 2].map((m) => (
                <div key={m} className={getJumpMult() === m ? btnOn : btn} onClick={() => { setJumpMult(m); st().setHub(true); }}>ПРЫЖОК ×{m}</div>
              ))}
              <div className={btn} onClick={() => st().addMoney(100000)}>+$100K</div>
              <div className={btn} onClick={() => { gunState.therm = 0; }}>ОСТУДИТЬ СТВОЛ</div>
            </div>
            {/* КВЕЙК-АРЕНЫ: смена карты (перезагрузка мира) */}
            <div className="font-mono text-[10px] uppercase text-white/40 mt-3 mb-1">Карта (сменить = перезайти):</div>
            <div className="flex flex-wrap gap-1">
              {MAPS.map((m) => (
                <div key={m.id} className={currentMap() === m.id ? btnOn : btn} style={{ borderColor: `${m.color}66` }}
                     onClick={() => { if (currentMap() !== m.id) { setMapInUrl(m.id); window.location.reload(); } }}>
                  {m.name}
                </div>
              ))}
            </div>
          </Section>

          {/* АДМИН-СПАУН */}
          <Section title={`Админ-спаун у меня ${isHost ? '' : '· (боты/существа — только у хоста)'}`}>
            <div className="font-mono text-[10px] uppercase text-white/40 mb-1">Орда:</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {MUTATIONS.map((m) => (
                <div key={m.id} className={btn} style={{ borderColor: `${m.color}66` }}
                     onClick={() => { const p = near(8); adminSpawnBot(m.id, p[0], p[1], p[2]); }}>
                  {m.id}
                </div>
              ))}
              <div className={btn} onClick={() => { const p = near(10); adminSpawnBot('BONE', p[0], p[1], p[2], true); const q = near(10); adminSpawnBot('BERSERK', q[0], q[1], q[2], true); }}>
                ПАРА-ДУЭЛЯНТОВ
              </div>
            </div>
            <div className="font-mono text-[10px] uppercase text-white/40 mb-1">Существа и аномалии:</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {CREATURES.map((c) => (
                <div key={c} className={btn} onClick={() => {
                  const p = near(7);
                  st().setCreatures([...st().creatures, { id: `adm-${Date.now()}-${Math.floor(Math.random() * 999)}`, type: c, x: p[0], y: p[1] + 2, z: p[2], hp: 60 }]);
                }}>{c}</div>
              ))}
              {ENEMY_TYPES.map((t) => (
                <div key={t} className={btn} onClick={() => { const p = near(12); st().spawnEnemyAt(t, p[0], p[1] + 6, p[2]); }}>{t}</div>
              ))}
            </div>
            <div className="font-mono text-[10px] uppercase text-white/40 mb-1">Лут и баффы:</div>
            <div className="flex flex-wrap gap-1">
              <div className={btn} onClick={() => orbAtMe('cash')}>CASH-ОРБ</div>
              <div className={btn} onClick={() => orbAtMe('buff')}>БАФФ-ОРБ</div>
              <div className={btn} onClick={() => st().setBuff('rage', Date.now() + 12000)}>RAGE 12с</div>
              <div className={btn} onClick={() => st().setBuff('surge', Date.now() + 12000)}>SURGE 12с</div>
              <div className={btn} onClick={() => st().setBuff('midas', Date.now() + 15000)}>MIDAS 15с</div>
            </div>
          </Section>

          {/* ТП + РЕЖИССУРА */}
          <Section title="Телепорт и режиссура">
            <div className="font-mono text-[10px] uppercase text-white/40 mb-1">Телепорт:</div>
            <div className="flex flex-wrap gap-1 mb-2">
              <div className={btn} onClick={() => adminTeleport(0, 92, 0)}>ТОРГОВЫЙ ПОЛ</div>
              <div className={btn} onClick={() => adminTeleport(1800, 960, 0)}>ГАЛО</div>
              <div className={btn} onClick={() => adminTeleport(-260, 40, -520)}>ТРЕК-ДЕК</div>
              {DRAGONS.map((d) => (
                <div key={d.id} className={btn} onClick={() => tpToDragon(d.id)}>К {d.name}</div>
              ))}
              <div className={btn} onClick={() => adminCarToMe()}>ТАЧКУ КО МНЕ</div>
            </div>
            <div className="font-mono text-[10px] uppercase text-white/40 mb-1">Кино (клик и смотри):</div>
            <div className="flex flex-wrap gap-1">
              <div className={btn} onClick={() => { blackHoleSuck.v = 1.4; playSuction(); }}>ВОРОНКА ДЫРЫ</div>
              <div className={btn} onClick={() => { blackHoleFeed.v = 1; }}>КОРМЁЖКА</div>
              <div className={btn} onClick={() => ringAtMe()}>ШОК-КОЛЬЦО</div>
              {(['ГИГА-СВЕЧА', 'ЧЕРЕП', 'ЗНАК $'] as const).map((n, fig) => (
                <div key={n} className={btn} onClick={() => { formationOverride.fig = fig; formationOverride.until = Date.now() + 14000; }}>
                  ФОРМАЦИЯ: {n}
                </div>
              ))}
              <div className={btn} onClick={() => {
                const spots = getCity().roofSpots;
                const sorted = [...spots].sort((a, b) =>
                  ((a[0] - adminCtx.x) ** 2 + (a[2] - adminCtx.z) ** 2) - ((b[0] - adminCtx.x) ** 2 + (b[2] - adminCtx.z) ** 2));
                sorted.slice(0, 3).forEach((s, i) => setTimeout(() => fireSalvo(s), i * 350));
              }}>ЗАЛП С КРЫШ</div>
            </div>
          </Section>
        </div>

        {/* СПРАВКА */}
        <Section title="Справка — всё, что есть в игре">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            {HELP.map(([k, v]) => (
              <div key={k} className="flex gap-3 font-mono text-[12px]">
                <span className="text-amber-200 font-bold min-w-[120px]">{k}</span>
                <span className="text-white/65">{v}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
};
