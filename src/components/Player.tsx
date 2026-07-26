import { useEffect, useRef, useState, useMemo, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../store';
import { playShootSound, playWeaponSound, playJumpSound, playHitTick, playExplosionSound } from '../utils/audio';
import { tickMarket, marketNow, isLiquidated } from '../game/market';
import { noteKill } from '../game/tradingDay';
import { modMults, SOCKETS } from '../config/weaponMods';
import { adminCtx, registerTeleport } from '../game/admin';
import { getPlayerSpawn } from '../game/quakeMaps';
import { adsState } from '../game/loadout';
import { MOVE, cameraYaw, wishDirection, applyFriction, accelerate, clampHorizontal } from '../game/movement';
import { sampleShake, addTrauma } from '../game/shake';
import { fireHitmarker, fireShot } from '../game/fx';
import { WEAPONS } from '../config/weapons';
import { WeaponModel } from './WeaponModel';
import { BUILD_IDS } from '../config/assets';
import { getSpell } from '../config/spells';
import { VoxDude } from './VoxDude';
import { makeGore, limbZoneAt, ZONE_DMG, type LimbZone } from '../game/voxHumanoid';
import { trainVelocity } from './Train';
import { carPositions, tryToggleCar } from './Cars';
import { grappleCityHits } from './Cityscape';
import { ECON } from '../config/economy';
import { tryTame, damageCreature } from './Creatures';
import { makeFlames } from '../game/voxel';
import { carveVoxCandle, getVoxCandlePos, voxCandleAlive } from './VoxelCandles';
import { botHitInbox } from '../game/botHorde';
import { tryMountDragon, dragonRide } from './Dragons';
import { DRAGONS, dragonAlive, applyDragonHit, dragonFxInbox, RAINBOW, FOAM } from '../game/voxDragon';
import { makeFlames as makePixelFlames } from '../game/voxel';
import { gunState } from '../game/gunState';
import { propHitInbox } from './PhysProps';
import { builtHitInbox, heightState, saveBest, loadBest } from '../game/builtProps';
import { isTower } from '../config/maps';
import { totemHitInbox } from './Totems';
import { registerKill } from '../game/combo';
import { portalState, placePortal, tryPortal } from '../game/portals';

const JUMP_FORCE = 15;

// Shared allocations to prevent Garbage Collection stutter in useFrame
const _wishDir = new THREE.Vector3();
const _moveVel = new THREE.Vector3();
const _downRayDir = new THREE.Vector3(0, -1, 0);
const _downRaycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _shake = { x: 0, y: 0, z: 0 };
const _recoilVec = new THREE.Vector3();
const _center2 = new THREE.Vector2(0, 0);
const _grappleVec = new THREE.Vector3();
const _ropeStart = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
// Grapple 2.0 (Spider-Man pass): magnetic assist cone + swing temps
const _velFull = new THREE.Vector3();
const _candlePos = new THREE.Vector3();
// NDC offsets tried in order — center first, then a widening assist cone.
// «Цепляется всегда»: if the crosshair is даже рядом с целью — магнит доводит.
const ASSIST_OFFSETS: [number, number][] = [
  [0, 0],
  [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05],
  [0.11, 0], [-0.11, 0], [0, 0.11], [0, -0.11],
  [0.08, 0.08], [-0.08, 0.08], [0.08, -0.08], [-0.08, -0.08],
];
const _assistNdc = new THREE.Vector2();

// WS-4 magnetic-boots probe (short lateral + up rays; reused each frame)
const _bootRaycaster = new THREE.Raycaster();
const _bootNormal = new THREE.Vector3();
const BOOT_DIRS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 1, 0), // metal ceilings → hang underneath
];

// Spawn on the CORE spire platform (y≈81), offset from its centre pad + a small
// random jitter so two players don't stack — fixes the endless jump-pad bounce
// you got spawning in the middle of the arena. КВЕЙК-АРЕНЫ: точка из карты.
const SPAWN: [number, number, number] = getPlayerSpawn();
const _endPoint = new THREE.Vector3();
const _laserStartPoint = new THREE.Vector3(0.3, -0.3, -1);

// Shared Geometries and Materials for sparks
const sparkGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const sparkMaterialEnemy = new THREE.MeshBasicMaterial({ color: 0xf72585 });
const sparkMaterialWall = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });

import { socket } from '../socket';

// Weapon tuning + feel colors live in src/config/weapons.ts (single source).

export const Player = () => {
  const { camera, scene } = useThree();
  const keys = useKeyboard();
  const { isPlaying, gameOver, roomId, currentWeapon, setWeapon } = useStore();
  const controlsRef = useRef<any>(null);
  const playerRef = useRef<any>(null);
  const weaponRef = useRef<THREE.Group>(null);
  const raycaster = useRef(new THREE.Raycaster());
  const lastSyncTime = useRef(0);

  // bhop / jump state
  const prevJump = useRef(false);
  const lastJumpPressed = useRef(-Infinity);
  const lastGrounded = useRef(-Infinity);
  const airJumpsUsed = useRef(0);
  const bootsOn = useRef(false); // WS-4 magnetic boots (toggle KeyC)

  // weapon feel
  const muzzleRef = useRef<THREE.Mesh>(null);
  const muzzleFade = useRef(0);
  const recoilAmt = useRef(0);
  // V4 CS gunfeel: spray index + minigun heat
  const sprayIdx = useRef(0);
  const heatRef = useRef(0);
  const prevWeaponRef = useRef(-1); // V8 Ф2: therm resets on weapon swap
  const prevShoot = useRef(false);  // ЛОАДАУТ: фронт ЛКМ
  const downedRef = useRef(false);  // V9 Б: добит — сцена доминации
  const crippledRef = useRef(false);// V9 Б: контужен — ползёшь
  const armsRef = useRef(false);    // V9 К: руки прострелены — ствол пляшет
  const scaleRef = useRef(1);       // V9 Р: свой рост (L больше / K меньше)
  const prevYawRef = useRef(0);     // V8 Ф2.5: look-lag deltas
  const prevPitchRef = useRef(0);

  useEffect(() => { loadBest(); }, []);

  // V8.5: the admin sandbox can teleport me (портальный паттерн)
  useEffect(() => {
    registerTeleport((x, y, z) => {
      const b = playerRef.current;
      if (!b) return;
      b.setTranslation({ x, y, z }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    return () => registerTeleport(null);
  }, []);
  // V4.1 dragon flight
  const flightVel = useRef(new THREE.Vector3());
  const lastCannon = useRef(0);
  const cannonTick = useRef(0);

  // jetpack (double-tap space)
  const jetOn = useRef(false);
  const jetFuel = useRef(MOVE.jetFuelMax);
  const lastSpaceTap = useRef(-Infinity);
  const lastStunSeen = useRef(0);
  const lastFuelWrite = useRef(0);

  // grappling hook (right mouse) — Spider-Man swing state
  const grappleOn = useRef(false);
  const prevGrapple = useRef(false);
  const grappleAnchor = useRef(new THREE.Vector3());
  const grappleLineRef = useRef<THREE.Line>(null);
  const ropeLen = useRef(0);
  const grappleCandleId = useRef(-1); // >=0 → anchored to a MOVING voxel star
  const grappleCandleOff = useRef(new THREE.Vector3());
  const smoothFov = useRef(80);

  const [isThirdPerson, setIsThirdPerson] = useState(false);
  const thirdPersonRef = useRef<THREE.Group>(null);
  const bodyScale = useStore((s) => s.bodyScale); // V9 Р: капсула растёт вместе с тобой
  
  // Input: spell wheel (hold E), boots (C), build (B), 3rd-person (V), weapon
  // digits/wheel. Merged across WS-2 (wheel), WS-3 (E spell wheel), WS-4 (C boots).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPlaying) return;
      const st = useStore.getState();
      // V8.5: Tab = the clickable HUB (unlock pointer to click; re-lock in the gesture)
      if (e.code === 'Tab') {
        e.preventDefault();
        if (st.hubOpen) {
          st.setHub(false);
          (document.querySelector('canvas') as HTMLCanvasElement | null)?.requestPointerLock();
        } else {
          st.setHub(true);
          document.exitPointerLock();
        }
        return;
      }
      if (st.hubOpen) return; // hub owns the screen — game keys sleep
      if (e.code === 'KeyE') { if (!e.repeat) st.setSpellWheel(true); return; } // hold E → spell wheel
      if (e.code === 'KeyQ' && !st.editorMode) {                                // V7 $SOUL (в стройке Q крутит деталь)
        if (e.repeat) return;
        if (st.position) { st.closePosition(marketNow.price); playHitTick(); }
        else st.setMarketWheel(true);
        return;
      }
      if (e.code === 'KeyP') { st.setBuyMenu(!st.buyMenuOpen); return; }        // CS buy menu
      if (e.code === 'KeyN') { st.setWorkbench(!st.workbenchOpen); return; }    // V8 Ф3: мастерская
      if (e.code === 'KeyC') { bootsOn.current = !bootsOn.current; return; }    // magnetic boots toggle
      if (e.code === 'KeyR') { st.toggleEditor(); return; }   // СТРОЙКА — только R
      // V9 Р: РОСТ. L — расти, K — уменьшаться. Тело поднимаем на разницу,
      // чтобы новая капсула не выросла сквозь пол.
      if (e.code === 'KeyL' || e.code === 'KeyK') {
        const before = st.bodyScale;
        st.setBodyScale(e.code === 'KeyL' ? before * 1.25 : before / 1.25);
        const after = useStore.getState().bodyScale;
        const b = playerRef.current;
        if (b && after > before) {
          const t = b.translation();
          b.setTranslation({ x: t.x, y: t.y + (after - before) * 1.05, z: t.z }, true);
        }
        playHitTick();
        return;
      }
      if (e.code === 'KeyV') { setIsThirdPerson(prev => !prev); return; }
      if (e.code === 'KeyT') {
        // Universal interact: car enter/exit first (WS-B), else tame (WS-E).
        const body = playerRef.current;
        const wasDriving = st.driving;
        const p = body ? body.translation() : null;
        if (p && tryToggleCar(p.x, p.y, p.z)) {
          if (wasDriving && body) {
            // exited → pop the body out beside the car so capsules don't overlap
            const car = carPositions[wasDriving];
            if (car) {
              body.setTranslation({
                x: car.x + Math.cos(car.heading) * 2.5,
                y: car.y + 2,
                z: car.z - Math.sin(car.heading) * 2.5,
              }, true);
              body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
          }
          return;
        }
        // dragon second: mount/dismount the beast (V4.1)
        if (p && tryMountDragon(p.x, p.y, p.z)) return;
        tryTame(camera, scene);
        return;
      }
      if (st.editorMode) {
        // Digits jump to an asset by index; scroll cycles (Editor.tsx owns it).
        const m = e.code.match(/^Digit([1-9])$/);
        if (m) { const i = +m[1] - 1; if (i < BUILD_IDS.length) st.setEditorSelect(BUILD_IDS[i]); }
      } else if (st.workbenchOpen) {
        // V8 Ф3: digits 1-4 cycle the socket's module (none → … → none)
        const m = e.code.match(/^Digit([1-4])$/);
        if (m) st.cycleMod(st.currentWeapon, SOCKETS[+m[1] - 1]);
      } else if (st.buyMenuOpen) {
        // Buy menu open: digits BUY (or equip if already owned).
        const m = e.code.match(/^Digit([1-9])$/);
        if (m) {
          const i = +m[1] - 1;
          if (st.ownedWeapons[i]) setWeapon(i);
          else st.buyWeapon(i);
        }
      } else if (!st.spellWheelOpen) {
        // While the spell wheel is open, digits pick spell slices (SpellWheel owns that).
        const m = e.code.match(/^Digit([1-9])$/);
        if (m) { const i = +m[1] - 1; if (st.ownedWeapons[i]) setWeapon(i); } // only weapons you BOUGHT
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyE') useStore.getState().setSpellWheel(false); // release → commit + close
      if (e.code === 'KeyQ') useStore.getState().setMarketWheel(false); // release → rose commits
    };
    // Mouse-wheel cycles the whole arsenal (reaches weapons 10-20). Editor owns
    // the wheel in build mode; the spell wheel owns it while open.
    const handleWheel = (e: WheelEvent) => {
      if (!isPlaying) return;
      const st = useStore.getState();
      if (st.editorMode || st.spellWheelOpen || st.buyMenuOpen || st.marketWheelOpen || st.workbenchOpen || st.hubOpen) return;
      const n = WEAPONS.length;
      const dir = e.deltaY > 0 ? 1 : -1;
      let i = st.currentWeapon;
      for (let step = 0; step < n; step++) {
        i = (i + dir + n) % n;
        if (st.ownedWeapons[i]) { st.setWeapon(i); break; }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [isPlaying, setWeapon]);
  
  // Create a persistent laser mesh
  const laserRef = useRef<THREE.Line>(null);
  
  const [lastShootTime, setLastShootTime] = useState(0);

  const { rapier, world } = useRapier();

  // NOTE: losing pointer lock (Esc / alt-tab) no longer ejects to a menu — the
  // UI shows a "click to play" overlay instead and re-locks on click. Pointer
  // lock is acquired via that overlay (a user gesture), not auto-locked here.

  useFrame((fs, delta) => {
    // V7 W1: the $SOUL index ticks on the liturgy clock — even while menus are
    // open, so the rose/strip stay live and liquidations never wait for you.
    tickMarket(fs.clock.elapsedTime);
    {
      const pos = useStore.getState().position;
      if (pos && isLiquidated(pos, marketNow.price)) {
        useStore.getState().liquidate();
        playExplosionSound();
      }
    }
    if (!controlsRef.current || !controlsRef.current.isLocked || !isPlaying || !playerRef.current) return;

    // In build/editor mode, LMB/RMB place & delete props (see Editor.tsx), so
    // weapons and the grapple are suppressed this frame.
    const editorMode = useStore.getState().editorMode;

    // ---- V2 WS-B: drive mode. Player is pinned into the car; chase cam; all
    // on-foot movement / shooting / grapple skipped this frame. ----
    const drivingId = useStore.getState().driving;
    if (drivingId) {
      const car = carPositions[drivingId];
      if (car) {
        // seat the body in the car (2.0 up so the capsule clears the car collider)
        playerRef.current.setTranslation({ x: car.x, y: car.y + 2.0, z: car.z }, true);
        playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        if (weaponRef.current) weaponRef.current.visible = false;
        // chase cam: 8 back along heading, 3 up, lerped (forward = (sin h, 0, cos h))
        _camTarget.set(car.x - Math.sin(car.heading) * 8, car.y + 3, car.z - Math.cos(car.heading) * 8);
        camera.position.lerp(_camTarget, Math.min(1, delta * 8));
        camera.lookAt(car.x, car.y + 1, car.z);
        // minimal net sync — the driver's own 'update' carries their position
        const tSync = performance.now();
        if (roomId && tSync - lastSyncTime.current > 50) {
          lastSyncTime.current = tSync;
          socket.emit('update', {
            x: car.x, y: car.y + 2.0, z: car.z,
            rotation: car.heading, isShooting: false, currentWeapon,
            minions: useStore.getState().localMinions,
            avatar: useStore.getState().avatarId,
          });
        }
      }
      return; // skip everything on-foot
    }

    // ---- V4.1: DRAGON FLIGHT. You are the god now. WASD aims with the camera,
    // W surges, Space climbs, S brakes; LMB = RAINBOW MEGA-CANNON with foam. ----
    const ridingId = useStore.getState().ridingDragon;
    if (ridingId !== null) {
      if (!dragonAlive(ridingId)) {
        useStore.getState().setRidingDragon(null); // shot out from under you
      } else {
        const def = DRAGONS[ridingId];
        camera.getWorldDirection(_recoilVec); // full 3D aim = flight dir
        const thrust = keys.forward ? 1 : keys.backward ? -0.35 : 0.12;
        _velFull.set(
          _recoilVec.x * def.speed * thrust,
          _recoilVec.y * def.speed * thrust + (keys.jump ? 11 : 0),
          _recoilVec.z * def.speed * thrust,
        );
        flightVel.current.lerp(_velFull, Math.min(1, delta * 2.6));
        dragonRide.x += flightVel.current.x * delta;
        dragonRide.y = Math.max(-30, dragonRide.y + flightVel.current.y * delta);
        dragonRide.z += flightVel.current.z * delta;
        dragonRide.heading = cameraYaw(camera);
        dragonRide.pitch = -_recoilVec.y;
        dragonRide.active = true;
        playerRef.current.setTranslation({ x: dragonRide.x, y: dragonRide.y + 1.6 * def.scale, z: dragonRide.z }, true);
        playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        if (weaponRef.current) weaponRef.current.visible = false;
        // chase cam behind the beast
        _camTarget.set(
          dragonRide.x - _recoilVec.x * 9 * def.scale,
          dragonRide.y + 3.2 * def.scale,
          dragonRide.z - _recoilVec.z * 9 * def.scale,
        );
        camera.position.lerp(_camTarget, Math.min(1, delta * 6));

        // RAINBOW MEGA-CANNON: hue-cycling lance + foam at the impact
        const nowMs = performance.now();
        if (keys.shoot && nowMs - lastCannon.current > 100) {
          lastCannon.current = nowMs;
          cannonTick.current++;
          const hue = RAINBOW[cannonTick.current % RAINBOW.length];
          raycaster.current.setFromCamera(_center2, camera);
          raycaster.current.far = 260;
          const hits = raycaster.current.intersectObjects(scene.children, true);
          raycaster.current.far = Infinity;
          for (const h of hits) {
            const ud = h.object.userData;
            let o: THREE.Object3D | null = h.object;
            let pid: string | null = null;
            let pLimb: LimbZone = 'body';
            while (o) { if (o.userData?.isEnemy && o.userData?.isPlayer) { pid = o.userData.id; pLimb = limbZoneAt(o, h.point); break; } o = o.parent; }
            const dmg = 26;
            if (ud?.isBot) {
              if (useStore.getState().isHost) botHitInbox.push({ id: +ud.id, damage: dmg });
              else socket.emit('bhit', { id: +ud.id, damage: dmg });
            } else if (ud?.isCreature) damageCreature(ud.id, dmg);
            else if (ud?.isVoxCandle) carveVoxCandle(+ud.id, h.point.x, h.point.y, h.point.z, 2.6);
            else if (pid) socket.emit('hit', { targetId: pid, damage: Math.round(dmg * ZONE_DMG[pLimb]), limb: pLimb });
            else if (ud?.isEnemy && ud.id) {
              if (useStore.getState().isHost) useStore.getState().damageEnemy(ud.id, dmg, [h.point.x, h.point.y, h.point.z]);
              else socket.emit('ehit', { id: ud.id, damage: dmg, point: [h.point.x, h.point.y, h.point.z] });
            } else if (!ud?.isFloor && !ud?.isWall && !ud?.isJumpPad) continue;
            // FOAM + rainbow burn at the impact point
            useStore.getState().addDebris(makePixelFlames([h.point.x, h.point.y, h.point.z], hue, 5));
            useStore.getState().addDebris([0, 1, 2].map(() => ({
              x: h.point.x, y: h.point.y, z: h.point.z,
              vx: (Math.random() - 0.5) * 5, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 5,
              color: FOAM[Math.floor(Math.random() * FOAM.length)],
              size: 0.16 + Math.random() * 0.18,
              rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
              life: 700 + Math.random() * 500,
            })));
            useStore.getState().addMoney(dmg * ECON.moneyPerDamage);
            _endPoint.copy(h.point);
            break;
          }
          // the lance itself (reuses the shared laser line, hue-cycled + fat)
          if (laserRef.current) {
            laserRef.current.visible = true;
            const mat = laserRef.current.material as THREE.LineBasicMaterial;
            mat.color.set(hue);
            mat.opacity = 0.95;
            const positions = laserRef.current.geometry.attributes.position.array as Float32Array;
            positions[0] = dragonRide.x; positions[1] = dragonRide.y + 0.4; positions[2] = dragonRide.z;
            positions[3] = _endPoint.x; positions[4] = _endPoint.y; positions[5] = _endPoint.z;
            laserRef.current.geometry.attributes.position.needsUpdate = true;
          }
          addTrauma(0.05);
          playShootSound(90 * (0.9 + Math.random() * 0.2), 0.08);
        }

        // net sync — my position IS the dragon
        const tS = performance.now();
        if (roomId && tS - lastSyncTime.current > 50) {
          lastSyncTime.current = tS;
          socket.emit('update', {
            x: dragonRide.x, y: dragonRide.y + 1.2, z: dragonRide.z,
            rotation: dragonRide.heading, isShooting: keys.shoot, currentWeapon,
            minions: useStore.getState().localMinions,
            avatar: useStore.getState().avatarId,
            money: useStore.getState().money,
            dragon: ridingId,
          });
        }
        return; // skip everything on-foot
      }
    }

    // Movement
    const velocity = playerRef.current.linvel();
    const currentPos = playerRef.current.translation();
    
    if (isThirdPerson) {
      const offset = new THREE.Vector3(0, 2, 6); // Up 2, back 6
      offset.applyQuaternion(camera.quaternion);
      camera.position.set(currentPos.x, currentPos.y + 0.8, currentPos.z).add(offset);
      
      if (thirdPersonRef.current) {
        thirdPersonRef.current.scale.setScalar(scaleRef.current); // V9 Р
        thirdPersonRef.current.position.set(currentPos.x, currentPos.y - scaleRef.current, currentPos.z);
        const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
        thirdPersonRef.current.rotation.set(0, eul.y, 0);
      }
    } else {
      // V9 Б: ползком глаза ниже, при добивании — щекой в пол
      // V9 Р: и всё это ×рост — гигант смотрит с высоты своего тела
      const eyeY = (downedRef.current ? 0.18 : crippledRef.current ? 0.42 : 0.8) * scaleRef.current;
      camera.position.set(currentPos.x, currentPos.y + eyeY, currentPos.z); // Eye level
      if (downedRef.current) {
        // смотрим на ближайшего живого — он и есть твой палач
        let bx = currentPos.x, by = currentPos.y + 2, bz = currentPos.z + 6, bd = Infinity;
        for (const rp of Object.values(useStore.getState().remotePlayers)) {
          const d = (rp.x - currentPos.x) ** 2 + (rp.z - currentPos.z) ** 2;
          if (d < bd) { bd = d; bx = rp.x; by = rp.y + 1.2; bz = rp.z; }
        }
        camera.lookAt(bx, by, bz);
        camera.rotation.z = 1.15 + Math.sin(performance.now() * 0.002) * 0.06; // щека в полу
      } else if (crippledRef.current) {
        camera.rotation.z += Math.sin(performance.now() * 0.006) * 0.02; // контузия плывёт
      }
    }

    // Screen-shake as a positional offset, applied AFTER camera placement so it
    // never fights PointerLockControls (which owns yaw/pitch). See game/shake.ts.
    sampleShake(delta, _shake);
    camera.position.x += _shake.x;
    camera.position.y += _shake.y;
    camera.position.z += _shake.z;

    // Weapon recoil as a positional camera kick (also PLC-safe): shove the eye
    // back along the view + up, then spring back fast. Bumped in the shoot block.
    if (recoilAmt.current > 0.0001) {
      camera.getWorldDirection(_recoilVec);
      camera.position.addScaledVector(_recoilVec, -recoilAmt.current * 0.5);
      camera.position.y += recoilAmt.current * 0.2;
      recoilAmt.current = Math.max(0, recoilAmt.current - delta * 9);
    }
    // FOV = base + recoil punch + SPEED RUSH (the world widens as you fly —
    // the core of the swing euphoria). Smoothed so it never snaps.
    {
      const spd = Math.hypot(velocity.x, velocity.z);
      // V5 C1: feed the CS crosshair (gap breathes with run + spray + heat)
      gunState.speed = spd;
      gunState.spread = Math.min(1, sprayIdx.current * 0.09 + heatRef.current * 0.6);
      gunState.heat = heatRef.current;
      // МАТ-БАШНЯ: высота = смысл жизни (дудл-джамп)
      if (isTower()) {
        heightState.now = camera.position.y;
        if (heightState.now > heightState.best) {
          heightState.best = heightState.now;
          if ((heightState.now | 0) % 25 === 0) saveBest();
        }
      }
      // V8.5: admin context — where «у меня» is for the sandbox panel
      adminCtx.x = camera.position.x;
      adminCtx.y = camera.position.y;
      adminCtx.z = camera.position.z;
      adminCtx.t = fs.clock.elapsedTime;
      // V8 Ф2.5: look-lag feed — per-frame camera rotation delta (wrapped)
      {
        const yaw = camera.rotation.y, pitch = camera.rotation.x;
        gunState.lookX = Math.atan2(Math.sin(yaw - prevYawRef.current), Math.cos(yaw - prevYawRef.current));
        gunState.lookY = pitch - prevPitchRef.current;
        prevYawRef.current = yaw;
        prevPitchRef.current = pitch;
      }
      const speedFov = Math.min(11, Math.max(0, (spd - 26) * 0.18));
      const target = (80 - adsState.v * 30) + recoilAmt.current * 5 + speedFov * (1 - adsState.v * 0.7);
      smoothFov.current += (target - smoothFov.current) * Math.min(1, delta * 7);
      const pc = camera as THREE.PerspectiveCamera;
      if (Math.abs(pc.fov - smoothFov.current) > 0.02) {
        pc.fov = smoothFov.current;
        pc.updateProjectionMatrix();
      }
    }

    if (weaponRef.current) {
      weaponRef.current.visible = !isThirdPerson;
    }

    // ---- Movement: Quake/CS air-strafe + bhop (see src/game/movement.ts) ----
    const yaw = cameraYaw(camera);
    const hasInput = wishDirection(_wishDir, keys.forward, keys.backward, keys.left, keys.right, yaw);

    // Grounded / jump-pad probe: cast straight down from the player's feet
    // (from the body, not the camera, so it also works in third-person).
    _rayOrigin.set(currentPos.x, currentPos.y + 0.8, currentPos.z);
    _downRaycaster.set(_rayOrigin, _downRayDir);
    _downRaycaster.near = 0;
    _downRaycaster.far = 2.2;
    const downHits = _downRaycaster.intersectObjects(scene.children, true);

    let grounded = false;
    let isOnJumpPad = false;
    let customJumpForce = JUMP_FORCE * 1.8;
    let groundFriction = MOVE.friction; // WS-4: per-surface friction (ice = low)
    let groundIsMetal = false;          // WS-4: down-probe hit a magnetic surface
    let onTrain = false;                // WS-B: standing on the moving train
    for (const dHit of downHits) {
      const ud = dHit.object.userData;
      if (ud?.isJumpPad) {
        isOnJumpPad = true;
        grounded = true;
        if (ud.jumpForce) customJumpForce = ud.jumpForce;
        break;
      }
      if (ud?.isFloor || ud?.isWall) {
        grounded = true;
        groundFriction = ud.friction ?? MOVE.friction;
        groundIsMetal = !!ud.isMetal;
        onTrain = ud.id === 'train';
        break;
      }
    }

    // --- WS-4 Magnetic boots: cling to a nearby metal surface (walk walls / hang) ---
    let magnetHold = false;
    _bootNormal.set(0, 0, 0); // accumulates the outward surface normal (toward player)
    if (bootsOn.current) {
      if (groundIsMetal) { magnetHold = true; _bootNormal.set(0, 1, 0); }
      for (let d = 0; d < BOOT_DIRS.length; d++) {
        _rayOrigin.set(currentPos.x, currentPos.y, currentPos.z);
        _bootRaycaster.set(_rayOrigin, BOOT_DIRS[d]);
        _bootRaycaster.near = 0;
        _bootRaycaster.far = 1.6;
        const bHits = _bootRaycaster.intersectObjects(scene.children, true);
        for (const bh of bHits) {
          const ud = bh.object.userData;
          if (ud?.isMetal && (ud.isWall || ud.isFloor)) {
            magnetHold = true;
            _bootNormal.sub(BOOT_DIRS[d]); // normal points from surface toward player
            break;
          }
        }
      }
      if (magnetHold) grounded = true; // clinging counts as grounded (walk + jump off)
    }

    const tNow = performance.now();

    // Jetpack knock-out: a fresh takeDamage bumps jetpackStunUntil.
    const stunUntil = useStore.getState().jetpackStunUntil;
    if (stunUntil > lastStunSeen.current) {
      lastStunSeen.current = stunUntil;
      jetFuel.current *= 0.4; // a hit dumps most of the fuel
      jetOn.current = false;
    }
    const jetStunned = Date.now() < stunUntil;

    // jump input edges + timers: autohop while held, double-jump on re-press,
    // and a double-TAP of Space while airborne engages the jetpack.
    if (keys.jump && !prevJump.current) {
      if (tNow - lastSpaceTap.current < MOVE.doubleTapMs && !grounded && jetFuel.current > 0 && !jetStunned) {
        jetOn.current = true;
      }
      lastSpaceTap.current = tNow;
      lastJumpPressed.current = tNow;
    }
    prevJump.current = keys.jump;
    if (grounded) { lastGrounded.current = tNow; airJumpsUsed.current = 0; }

    const canGroundJump = tNow - lastGrounded.current <= MOVE.coyoteMs;
    const jumpBuffered = tNow - lastJumpPressed.current <= MOVE.bufferMs;

    _moveVel.set(velocity.x, 0, velocity.z);
    // WS-B: work in train-local space so friction doesn't fight the carrier
    if (onTrain) { _moveVel.x -= trainVelocity.x; _moveVel.z -= trainVelocity.z; }
    let newY = velocity.y;
    let didJump = false;

    if (isOnJumpPad) {
      newY = customJumpForce;
      didJump = true;
      playJumpSound();
    } else if (keys.jump && canGroundJump) {
      // bhop / autohop: hold jump, keep hopping — momentum is preserved
      newY = MOVE.jumpVelocity;
      didJump = true;
      lastGrounded.current = -Infinity;
      lastJumpPressed.current = -Infinity;
      playJumpSound();
    } else if (jumpBuffered && !canGroundJump && airJumpsUsed.current < MOVE.airJumps) {
      // mid-air jump → vertical chaining (Chained Together taste)
      newY = MOVE.jumpVelocity;
      didJump = true;
      airJumpsUsed.current++;
      lastJumpPressed.current = -Infinity;
      playJumpSound();
    }

    // --- Jetpack: hold Space (after double-tap) to thrust up while fueled ---
    if (jetOn.current) {
      if (!keys.jump || grounded || jetFuel.current <= 0 || jetStunned) {
        jetOn.current = false;
      } else {
        newY = Math.min(velocity.y + MOVE.jetThrust * delta, MOVE.jetMaxUp);
        jetFuel.current = Math.max(0, jetFuel.current - MOVE.jetDrain * delta);
      }
    }
    if (!jetOn.current && jetFuel.current < MOVE.jetFuelMax) {
      jetFuel.current = Math.min(MOVE.jetFuelMax, jetFuel.current + (grounded ? MOVE.jetRegen : MOVE.jetRegen * 0.3) * delta);
    }
    // throttled fuel → store for the HUD bar (~12Hz, no per-frame re-render)
    if (tNow - lastFuelWrite.current > 80) {
      lastFuelWrite.current = tNow;
      const f = Math.round(jetFuel.current);
      if (f !== Math.round(useStore.getState().jetpackFuel)) useStore.getState().setJetpackFuel(f);
    }

    // Magnetic cling: cancel the fall + draw toward the metal surface so you can
    // walk metal walls / hang under metal decks. Skip the frame you jump off.
    if (magnetHold && !didJump) {
      newY = newY > 0 ? newY : newY * 0.15; // kill downward velocity, keep hops
      const nlen = Math.hypot(_bootNormal.x, _bootNormal.y, _bootNormal.z);
      if (nlen > 1e-3) {
        const pull = 8 * delta; // move along -normal = toward the surface
        _moveVel.x -= (_bootNormal.x / nlen) * pull;
        newY       -= (_bootNormal.y / nlen) * pull;
        _moveVel.z -= (_bootNormal.z / nlen) * pull;
      }
    }

    // V4: the minigun owns your legs — firing it slows the walk; SURGE buff lifts them
    const wcfgSlow = WEAPONS[currentWeapon].slow;
    const surgeMul = useStore.getState().buffs.surge > Date.now() ? 1.35 : 1;
    const slowMul = (keys.shoot && !editorMode && wcfgSlow ? wcfgSlow : 1) * surgeMul;
    if (grounded && !didJump) {
      applyFriction(_moveVel, delta, groundFriction); // WS-4: ice decks stay slippery
      accelerate(_moveVel, _wishDir, hasInput ? MOVE.maxGroundSpeed * slowMul : 0, MOVE.groundAccel, delta);
    } else {
      // airborne (or the frame we jumped): the air-strafe engine, momentum kept
      accelerate(_moveVel, _wishDir, hasInput ? MOVE.airAccelCap : 0, MOVE.airAccel, delta);
    }
    clampHorizontal(_moveVel);

    // V9 Р: шаг по росту — колосс шагает шире, мышь семенит (×1 при обычном
    // размере, так что базовый фил движения не тронут).
    if (scaleRef.current !== 1) {
      const k = Math.sqrt(scaleRef.current);
      _moveVel.x *= k; _moveVel.z *= k;
    }

    // ── V9 Б: КОНТУЗИЯ и ДОБИВАНИЕ ─────────────────────────────────────────
    {
      const stx = useStore.getState();
      const nowMs = Date.now();
      downedRef.current = stx.downedUntil > nowMs;
      crippledRef.current = !downedRef.current && stx.crippledUntil > nowMs;
      armsRef.current = !downedRef.current && stx.armsUntil > nowMs; // V9 К
      scaleRef.current = stx.bodyScale;                              // V9 Р
      if (downedRef.current) {
        _moveVel.x = 0; _moveVel.z = 0;   // ты лежишь. смотри, как тебя добили
      } else if (crippledRef.current) {
        _moveVel.x *= 0.32; _moveVel.z *= 0.32; // ползёшь
      } else if (stx.health === 0 && stx.downedUntil !== 0) {
        stx.reviveMe();                   // подъём после сцены доминации
        const b = playerRef.current;
        if (b) { b.setTranslation({ x: SPAWN[0], y: SPAWN[1], z: SPAWN[2] }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }
      }
    }

    // КЛАССИКА: ЛКМ — огонь · ПКМ — крюк · Shift — прицел · колесо — стволы
    const grabHeld = !editorMode && keys.grapple;
    const grabEdge = grabHeld && !prevGrapple.current;
    const fireHeld = keys.shoot;
    adsState.v += ((keys.aim && !editorMode ? 1 : 0) - adsState.v) * Math.min(1, delta * 12);
    prevShoot.current = keys.shoot;

    // --- Grappling hook (right mouse): latch a surface, then reel + swing ---
    if (editorMode) grappleOn.current = false; // RMB deletes props in build mode
    // --- Grapple 2.0: magnetic assist cone — «цепляется всегда» -----------
    if (!editorMode && grabEdge) {
      let anchorDist = Infinity;
      grappleCandleId.current = -1;
      for (const [ax, ay] of ASSIST_OFFSETS) {
        _assistNdc.set(ax, ay);
        raycaster.current.setFromCamera(_assistNdc, camera);
        raycaster.current.far = MOVE.grappleRange;
        const hits = raycaster.current.intersectObjects(scene.children, true);
        for (const h of hits) {
          const ud = h.object.userData;
          let o: THREE.Object3D | null = h.object;
          let isEnemy = false;
          while (o) { if (o.userData?.isEnemy) { isEnemy = true; break; } o = o.parent; }
          if (ud?.isWall || ud?.isFloor || ud?.isJumpPad || ud?.isCreature || isEnemy) {
            grappleAnchor.current.copy(h.point);
            anchorDist = h.distance;
            // moving voxel star → remember id + local offset so the anchor RIDES it
            if (ud?.isVoxCandle && getVoxCandlePos(+ud.id, _candlePos)) {
              grappleCandleId.current = +ud.id;
              grappleCandleOff.current.copy(h.point).sub(_candlePos);
            }
            break;
          }
        }
        if (anchorDist < Infinity) break; // first assist ray that latched wins
        // skyscrapers are raycast-noop for probes — test them explicitly per ray
        const cityHits = grappleCityHits(raycaster.current);
        if (cityHits.length && cityHits[0].distance <= MOVE.grappleRange) {
          grappleAnchor.current.copy(cityHits[0].point);
          anchorDist = cityHits[0].distance;
          break;
        }
      }
      raycaster.current.far = Infinity;
      if (anchorDist < Infinity) {
        grappleOn.current = true;
        ropeLen.current = anchorDist;
        playShootSound(150, 0.09);
      }
    }
    prevGrapple.current = keys.grapple;

    // --- Grapple 2.0: pendulum swing + reel (the Spider-Man frame) --------
    if (grappleOn.current) {
      // anchor rides a moving star (and lets go if the star died/fell)
      if (grappleCandleId.current >= 0) {
        if (voxCandleAlive(grappleCandleId.current) && getVoxCandlePos(grappleCandleId.current, _candlePos)) {
          grappleAnchor.current.copy(_candlePos).add(grappleCandleOff.current);
        } else {
          grappleCandleId.current = -1; // star gone — keep the last point static
        }
      }
      _grappleVec.set(
        grappleAnchor.current.x - currentPos.x,
        grappleAnchor.current.y - (currentPos.y + 0.8),
        grappleAnchor.current.z - currentPos.z,
      );
      const dist = _grappleVec.length();
      if (!grabHeld || dist < MOVE.grappleRelease) {
        // release = the FLING: keep momentum + a boost, Spider-Man exit
        grappleOn.current = false;
        _moveVel.multiplyScalar(MOVE.grappleBoost);
        newY *= MOVE.grappleBoost;
      } else {
        _grappleVec.multiplyScalar(1 / dist);
        // steady pull (the original кайф — unchanged)
        const pull = MOVE.grapplePull * delta;
        _moveVel.x += _grappleVec.x * pull;
        _moveVel.z += _grappleVec.z * pull;
        newY += _grappleVec.y * pull;
        // reel in while holding → rope shortens, arcs tighten
        ropeLen.current = Math.max(5, ropeLen.current - MOVE.grappleReel * delta);
        // pendulum constraint: outside the rope, the rope kills the OUTWARD
        // radial velocity → energy converts into a swing arc instead of a stall
        if (dist > ropeLen.current) {
          _velFull.set(_moveVel.x, newY, _moveVel.z);
          const vr = _velFull.dot(_grappleVec); // toward anchor = positive
          if (vr < 0) {
            _velFull.addScaledVector(_grappleVec, -vr * MOVE.swingDamp);
            _moveVel.x = _velFull.x;
            newY = _velFull.y;
            _moveVel.z = _velFull.z;
          }
        }
      }
    }

    // rope visual
    if (grappleLineRef.current) {
      if (grappleOn.current) {
        grappleLineRef.current.visible = true;
        const pos = grappleLineRef.current.geometry.attributes.position.array as Float32Array;
        _ropeStart.copy(_laserStartPoint).applyMatrix4(camera.matrixWorld);
        pos[0] = _ropeStart.x; pos[1] = _ropeStart.y; pos[2] = _ropeStart.z;
        pos[3] = grappleAnchor.current.x; pos[4] = grappleAnchor.current.y; pos[5] = grappleAnchor.current.z;
        grappleLineRef.current.geometry.attributes.position.needsUpdate = true;
      } else if (grappleLineRef.current.visible) {
        grappleLineRef.current.visible = false;
      }
    }

    // WS-B: ride the train — add carrier velocity back so you move WITH the roof
    if (onTrain) {
      _moveVel.x += trainVelocity.x;
      _moveVel.z += trainVelocity.z;
      if (!didJump) newY = trainVelocity.y + Math.min(0, newY); // glued on climbs/dives
    }

    playerRef.current.setLinvel({ x: _moveVel.x, y: newY, z: _moveVel.z }, true);

    // Weapon sway
    const now = performance.now();
    if (weaponRef.current) {
      weaponRef.current.position.copy(camera.position);
      weaponRef.current.quaternion.copy(camera.quaternion);
      
      const swayAmount = 0.05;
      const swaySpeed = 10;
      if (keys.forward || keys.backward || keys.left || keys.right) {
        const time = now * 0.001;
        weaponRef.current.position.y += Math.sin(time * swaySpeed) * swayAmount;
      }
      // V9 К: прострелены руки — ствол виснет, дрожит и заваливается набок
      if (armsRef.current) {
        weaponRef.current.position.y -= 0.13;
        weaponRef.current.rotateZ(0.34 + Math.sin(now * 0.011) * 0.07);
        weaponRef.current.rotateX(0.2 + Math.sin(now * 0.017) * 0.05);
      }
    }

    // Muzzle-flash fade
    if (muzzleRef.current && muzzleFade.current > 0) {
      muzzleFade.current = Math.max(0, muzzleFade.current - delta * 18);
      (muzzleRef.current.material as THREE.MeshBasicMaterial).opacity = muzzleFade.current;
      muzzleRef.current.visible = muzzleFade.current > 0.01;
    }

    // Process laser fade
    if (laserRef.current) {
      const mat = laserRef.current.material as THREE.LineBasicMaterial;
      if (mat.opacity > 0) {
        mat.opacity -= 5 * delta; // fade out over 0.2 seconds
        if (mat.opacity <= 0) {
          mat.opacity = 0;
          laserRef.current.visible = false;
        }
      }
    }

    // Shooting logic (suppressed in build/editor mode — LMB places props).
    // Selected spell ('none' = fire the weapon's own shot) can override; the
    // fire rate is the slower of the weapon rate and the spell cooldown.
    const config = WEAPONS[currentWeapon];
    const spell = getSpell(useStore.getState().selectedSpell);
    // V4 CS gunfeel: minigun heat (spin-up rate + growing cone) + spray reset
    const wantsFire = !downedRef.current && !editorMode && fireHeld && !useStore.getState().spellWheelOpen && !useStore.getState().buyMenuOpen && !useStore.getState().marketWheelOpen && !useStore.getState().workbenchOpen;
    if (config.heat) {
      heatRef.current = Math.min(1, Math.max(0, heatRef.current + (wantsFire ? 2.2 : -1.8) * delta));
    } else if (heatRef.current > 0) heatRef.current = 0;
    if (now - lastShootTime > 260) sprayIdx.current = 0; // let go → pattern resets
    // V8 Ф2: per-weapon thermal state — cools in idle, resets on weapon swap
    if (prevWeaponRef.current !== currentWeapon) { prevWeaponRef.current = currentWeapon; gunState.therm = 0; }
    gunState.therm = Math.max(0, gunState.therm - delta * 0.3);
    // overheated barrel vents smoke wisps at the muzzle
    if (gunState.therm > 0.8 && Math.random() < delta * 6) {
      camera.getWorldDirection(_recoilVec);
      useStore.getState().addDebris([{
        x: camera.position.x + _recoilVec.x * 1.1,
        y: camera.position.y - 0.12,
        z: camera.position.z + _recoilVec.z * 1.1,
        vx: (Math.random() - 0.5) * 0.5, vy: 1.1 + Math.random() * 0.7, vz: (Math.random() - 0.5) * 0.5,
        color: '#8d8a84', size: 0.06 + Math.random() * 0.05,
        rx: Math.random() * 3, ry: Math.random() * 3, rz: Math.random() * 3,
        life: 600 + Math.random() * 300,
      }]);
    }
    // V8 Ф3: constructor mults (rate/recoil/spread/therm from equipped mods)
    const mm = modMults(useStore.getState().weaponMods[currentWeapon]);
    let effRate = config.heat ? config.rate + (140 - config.rate) * (1 - heatRef.current) : config.rate;
    effRate *= mm.rate;
    if (armsRef.current) effRate *= 1.8;                             // V9 К: руки не слушаются
    if (useStore.getState().buffs.rage > Date.now()) effRate /= 1.6; // RAGE: тратата быстрее
    const fireGate = Math.max(effRate, spell.cooldown ?? 0);
    if (wantsFire && now - lastShootTime > fireGate) {
      setLastShootTime(now);
      // V8 Ф1: the five-layer shot; Ф2: a hot barrel rings up to +8% sharper
      playWeaponSound(config.sound * (0.92 + Math.random() * 0.16) * (1 + gunState.therm * 0.08), config.sonic);
      // Ф2 thermal accumulation (× constructor therm mult)
      gunState.therm = Math.min(1, gunState.therm + (config.rate < 150 ? 0.045 : 0.13) * mm.therm);
      const effRecoil = config.recoil * mm.recoil; // Ф3: compensator/stabilizer
      fireShot(effRecoil); // crosshair bloom + viewmodel punch

      // --- weapon feel: recoil kick + muzzle flash + fire shake ---
      recoilAmt.current = Math.min(1.2, recoilAmt.current + effRecoil);
      addTrauma(0.055 + effRecoil * 0.26);
      gunState.firedAt = performance.now();
      // дымок из ствола — каждый 3-й выстрел
      if (Math.random() < 0.34) {
        camera.getWorldDirection(_recoilVec);
        useStore.getState().addDebris([{
          x: camera.position.x + _recoilVec.x * 1.2,
          y: camera.position.y - 0.1,
          z: camera.position.z + _recoilVec.z * 1.2,
          vx: (Math.random() - 0.5) * 0.7 + _recoilVec.x * 0.6,
          vy: 1.0 + Math.random() * 0.9,
          vz: (Math.random() - 0.5) * 0.7 + _recoilVec.z * 0.6,
          color: '#9c988f', size: 0.07 + Math.random() * 0.07,
          rx: Math.random() * 3, ry: Math.random() * 3, rz: Math.random() * 3,
          life: 520 + Math.random() * 320,
        }]);
      }
      if (muzzleRef.current) {
        muzzleFade.current = 1;
        muzzleRef.current.visible = true;
        muzzleRef.current.scale.setScalar(0.7 + Math.random() * 0.6);
        muzzleRef.current.rotation.z = Math.random() * Math.PI;
        const mm = muzzleRef.current.material as THREE.MeshBasicMaterial;
        mm.color.set(config.muzzle); // per-weapon flash color
        mm.opacity = 1;
      }

      // (viewmodel recoil punch is handled in WeaponModel via the fire event)

      // V8 Ф1: per-weapon shell theatre — brass style from the spec; «none»
      // weapons vent steam/sparks instead (wands, rail, harpoon).
      if (spell.kind === 'none') {
        camera.getWorldDirection(_recoilVec);
        const rx = -_recoilVec.z, rz = _recoilVec.x; // right = dir × up (y terms drop)
        const sh = config.shell;
        if (sh?.none) {
          if (Math.random() < 0.4) {
            useStore.getState().addDebris([{
              x: camera.position.x + _recoilVec.x * 1.1,
              y: camera.position.y - 0.15,
              z: camera.position.z + _recoilVec.z * 1.1,
              vx: (Math.random() - 0.5) * 0.8,
              vy: 1.4 + Math.random() * 0.8,
              vz: (Math.random() - 0.5) * 0.8,
              color: '#cfd6d9', size: 0.05 + Math.random() * 0.04,
              rx: Math.random() * 4, ry: Math.random() * 4, rz: Math.random() * 4,
              life: 420 + Math.random() * 200,
            }]);
          }
        } else if (!config.type || sh) {
          const size = sh?.size ?? 0.055;
          const color = sh?.color ?? '#e9c46a';
          const count = sh?.count ?? 2;
          useStore.getState().addDebris(Array.from({ length: count }, () => ({
            x: camera.position.x + _recoilVec.x * 0.9 + rx * 0.3,
            y: camera.position.y - 0.25,
            z: camera.position.z + _recoilVec.z * 0.9 + rz * 0.3,
            vx: rx * (2.2 + Math.random() * 1.5) + (Math.random() - 0.5),
            vy: 1.6 + Math.random() * 1.2,
            vz: rz * (2.2 + Math.random() * 1.5) + (Math.random() - 0.5),
            color, size: size + Math.random() * size * 0.5,
            rx: Math.random() * 8, ry: Math.random() * 8, rz: Math.random() * 8,
            life: 650 + Math.random() * 250,
          })));
        }
      }

      const center = new THREE.Vector2(0, 0);

      // ===== V6 Ш4: PORTAL RIG — LMB places portals A/B on floors/walls =====
      if (config.portal) {
        raycaster.current.setFromCamera(center, camera);
        raycaster.current.far = 400;
        const hits = raycaster.current.intersectObjects(scene.children, true);
        raycaster.current.far = Infinity;
        for (const h of hits) {
          const ud = h.object.userData;
          if ((ud?.isFloor || ud?.isWall) && h.face) {
            _recoilVec.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize();
            const slot = portalState.nextIsB ? 'b' : 'a';
            portalState.nextIsB = !portalState.nextIsB;
            placePortal(slot, h.point.x, h.point.y, h.point.z, _recoilVec.x, _recoilVec.y, _recoilVec.z);
            socket.emit('portal', { slot, x: h.point.x, y: h.point.y, z: h.point.z, nx: _recoilVec.x, ny: _recoilVec.y, nz: _recoilVec.z });
            break;
          }
        }
      } else if (spell.kind !== 'none') {
        // ===== SPELL CAST (WS-3): the selected spell overrides the weapon shot.
        // Weapon still governs recoil/muzzle/sound above. "матрица без правил". =====
        raycaster.current.setFromCamera(center, camera);
        const sdir = raycaster.current.ray.direction.clone();
        const muzzlePos = camera.position.clone().add(sdir.clone().multiplyScalar(1));

        if (spell.kind === 'beam') {
          const intersects = raycaster.current.intersectObjects(scene.children, true);
          raycaster.current.ray.at(120, _endPoint);
          let anyHit = false, anyKill = false;
          for (const hitObj of intersects) {
            let obj: THREE.Object3D | null = hitObj.object; let isHit = false;
            while (obj) {
              if (obj.userData?.isBot) {
                const bid = +obj.userData.id;
                if (useStore.getState().isHost) botHitInbox.push({ id: bid, damage: spell.damage });
                else socket.emit('bhit', { id: bid, damage: spell.damage });
                useStore.getState().addDebris(makeGore(hitObj.point.x, hitObj.point.y, hitObj.point.z, 8));
                useStore.getState().addMoney(spell.damage * ECON.moneyPerDamage);
                anyHit = true; isHit = true; break;
              }
              if (obj.userData?.isCreature) {
                damageCreature(obj.userData.id, spell.damage);
                useStore.getState().addMoney(spell.damage * ECON.moneyPerDamage);
                anyHit = true; isHit = true; break;
              }
              if (obj.userData?.isEnemy) {
                const eid = obj.userData.id;
                const pt: [number, number, number] = [hitObj.point.x, hitObj.point.y, hitObj.point.z];
                if (obj.userData?.isPlayer) {
                  const zone = limbZoneAt(obj, hitObj.point);
                  socket.emit('hit', { targetId: eid, damage: Math.round(spell.damage * ZONE_DMG[zone]), limb: zone });
                  useStore.getState().addDebris(makeGore(hitObj.point.x, hitObj.point.y, hitObj.point.z, 8));
                }
                else if (useStore.getState().isHost) {
                  useStore.getState().damageEnemy(eid, spell.damage, pt);
                  if (!useStore.getState().enemies.some((en) => en.id === eid)) anyKill = true;
                } else socket.emit('ehit', { id: eid, damage: spell.damage, point: pt });
                useStore.getState().addMoney(spell.damage * ECON.moneyPerDamage);
                anyHit = true; isHit = true; break;
              }
              obj = obj.parent;
            }
            if (isHit || hitObj.object.userData?.isWall || hitObj.object.userData?.isFloor || hitObj.object.userData?.isJumpPad) {
              _endPoint.copy(hitObj.point);
              if (hitObj.object.userData?.isVoxCandle) {
                carveVoxCandle(+hitObj.object.userData.id, hitObj.point.x, hitObj.point.y, hitObj.point.z, 1.0 + spell.damage * 0.012);
              }
              break;
            }
          }
          if (laserRef.current) {
            laserRef.current.visible = true;
            const mat = laserRef.current.material as THREE.LineBasicMaterial;
            mat.color.set(spell.color); mat.opacity = 0.9; mat.linewidth = 6;
            const positions = laserRef.current.geometry.attributes.position.array as Float32Array;
            const start = _laserStartPoint.clone().applyMatrix4(camera.matrixWorld);
            positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
            positions[3] = _endPoint.x; positions[4] = _endPoint.y; positions[5] = _endPoint.z;
            laserRef.current.geometry.attributes.position.needsUpdate = true;
          }
          if (anyHit) {
            fireHitmarker(anyKill);
            if (anyKill) { playExplosionSound(); noteKill(); useStore.getState().addMoney(Math.round(ECON.killBonus * registerKill())); }
            else playHitTick();
          }
        } else if (spell.kind === 'nova') {
          const count = spell.novaCount ?? 12;
          const half = (spell.novaSpread ?? Math.PI) * 0.5;
          const up = Math.abs(sdir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const right = new THREE.Vector3().crossVectors(sdir, up).normalize();
          const rup = new THREE.Vector3().crossVectors(right, sdir).normalize();
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const off = right.clone().multiplyScalar(Math.cos(a)).add(rup.clone().multiplyScalar(Math.sin(a)));
            const d = sdir.clone().multiplyScalar(Math.cos(half)).add(off.multiplyScalar(Math.sin(half))).normalize();
            useStore.getState().addProjectile({
              position: [muzzlePos.x, muzzlePos.y, muzzlePos.z],
              velocity: [d.x * spell.speed, d.y * spell.speed, d.z * spell.speed],
              fromPlayer: true, kind: 'bolt', color: spell.color, damage: spell.damage, speed: spell.speed,
            });
          }
          socket.emit('shoot', { weapon: currentWeapon, position: [muzzlePos.x, muzzlePos.y, muzzlePos.z], velocity: [sdir.x * spell.speed, sdir.y * spell.speed, sdir.z * spell.speed] });
        } else {
          useStore.getState().addProjectile({
            position: [muzzlePos.x, muzzlePos.y, muzzlePos.z],
            velocity: [sdir.x * spell.speed, sdir.y * spell.speed, sdir.z * spell.speed],
            fromPlayer: true, kind: spell.kind, color: spell.color, damage: spell.damage, speed: spell.speed,
          });
          socket.emit('shoot', { weapon: currentWeapon, position: [muzzlePos.x, muzzlePos.y, muzzlePos.z], velocity: [sdir.x * spell.speed, sdir.y * spell.speed, sdir.z * spell.speed] });
        }
      } else if (config.type === 'projectile') {
        raycaster.current.setFromCamera(center, camera);
        const dir = raycaster.current.ray.direction;
        const startPos = camera.position.clone().add(dir.clone().multiplyScalar(1));
        
        useStore.getState().addProjectile({
          position: [startPos.x, startPos.y, startPos.z],
          velocity: [dir.x * 50, dir.y * 50, dir.z * 50],
          fromPlayer: true
        });
        
        socket.emit("shoot", {
          weapon: currentWeapon,
          position: [startPos.x, startPos.y, startPos.z],
          velocity: [dir.x * 50, dir.y * 50, dir.z * 50]
        });
      } else {
        // Hitscan (Auto, Shotgun, Railgun)
        const raysToFire = config.rays || 1;
        // Tally the whole trigger pull, then fire ONE kill-aware marker + sound
        // (a shotgun's 8 pellets shouldn't stack 8 hitmarkers/ticks).
        let anyEnemyHit = false;
        let anyKill = false;

        // V4 CS spray: fixed pattern climbs while you hold the trigger
        const sprayOff = config.spray
          ? config.spray[Math.min(sprayIdx.current, config.spray.length - 1)]
          : null;
        sprayIdx.current++;
        // V8 Ф2: an overheated barrel (therm > 0.75) blooms the cone +30%
        const thermBloom = 1 + Math.max(0, gunState.therm - 0.75) * 1.2;
        const effSpread = config.spread ? config.spread * (config.heat ? 0.35 + heatRef.current : 1) * thermBloom * mm.spread * (1 - adsState.v * 0.7) : 0;

        for (let r = 0; r < raysToFire; r++) {
          let spreadX = 0;
          let spreadY = 0;
          if (effSpread) {
            spreadX = (Math.random() - 0.5) * effSpread;
            spreadY = (Math.random() - 0.5) * effSpread;
          }
          if (sprayOff) { spreadX += sprayOff[0]; spreadY += sprayOff[1]; }
          // V9 К: прострелены руки — ствол гуляет даже у снайперки
          if (armsRef.current) {
            spreadX += (Math.random() - 0.5) * 0.055;
            spreadY += (Math.random() - 0.5) * 0.055;
          }

          raycaster.current.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
          const intersects = raycaster.current.intersectObjects(scene.children, true);
          raycaster.current.ray.at(100, _endPoint);

          let hitEnemy = false;
          let targetId: string | null = null;
          let targetLimb: LimbZone = 'body';

          for (const hitObj of intersects) {
            let obj: THREE.Object3D | null = hitObj.object;
            let isHit = false;
            while (obj) {
              if (obj.userData?.isDragon) {
                const did = +obj.userData.id;
                if (useStore.getState().ridingDragon !== did) { // не пили свою лошадь
                  const killed = applyDragonHit(did, config.damage);
                  socket.emit('dhit', { id: did, damage: config.damage, x: hitObj.point.x, y: hitObj.point.y, z: hitObj.point.z });
                  useStore.getState().addDebris(makeGore(hitObj.point.x, hitObj.point.y, hitObj.point.z, 8, 9));
                  useStore.getState().addMoney(config.damage * ECON.moneyPerDamage);
                  if (killed) dragonFxInbox.push({ x: hitObj.point.x, y: hitObj.point.y, z: hitObj.point.z, scale: DRAGONS[did].scale });
                  anyEnemyHit = true; hitEnemy = true;
                }
                isHit = true; break;
              }
              if (obj.userData?.isBot) {
                const bid = +obj.userData.id;
                if (useStore.getState().isHost) botHitInbox.push({ id: bid, damage: config.damage });
                else socket.emit('bhit', { id: bid, damage: config.damage });
                useStore.getState().addDebris(makeGore(hitObj.point.x, hitObj.point.y, hitObj.point.z, 6 + Math.round(config.damage * 0.08)));
                useStore.getState().addMoney(config.damage * ECON.moneyPerDamage);
                anyEnemyHit = true; isHit = true; hitEnemy = true; break;
              }
              if (obj.userData?.isCreature) {
                damageCreature(obj.userData.id, config.damage);
                useStore.getState().addMoney(config.damage * ECON.moneyPerDamage);
                anyEnemyHit = true; isHit = true; hitEnemy = true; break;
              }
              if (obj.userData?.isEnemy) {
                if (obj.userData?.isPlayer) {
                  targetId = obj.userData.id;
                  // V9 К: КУДА попал — ноги/руки/корпус/голова (Kenshi)
                  targetLimb = limbZoneAt(obj, hitObj.point);
                } else {
                  const eid = obj.userData.id;
                  const pt: [number, number, number] = [hitObj.point.x, hitObj.point.y, hitObj.point.z];
                  if (useStore.getState().isHost) {
                    useStore.getState().damageEnemy(eid, config.damage, pt);
                    // Gone from the authoritative list ⇒ this shot killed it.
                    if (!useStore.getState().enemies.some((e) => e.id === eid)) anyKill = true;
                  } else {
                    socket.emit('ehit', { id: eid, damage: config.damage, point: pt }); // host applies
                  }
                }
                useStore.getState().addMoney(config.damage * ECON.moneyPerDamage);
                anyEnemyHit = true;
                isHit = true;
                hitEnemy = true;
                break;
              }
              obj = obj.parent;
            }
            // V5 C3: vice totems take damage → the rain of coins
            if (hitObj.object.userData?.isTotem) {
              totemHitInbox.push({ id: +hitObj.object.userData.id, damage: config.damage });
              _endPoint.copy(hitObj.point);
              useStore.getState().addDebris(makeFlames([hitObj.point.x, hitObj.point.y, hitObj.point.z], '#e9c46a', 3));
              break;
            }
            // МАТ-БАШНЯ: построенные свечи ломаются (и роняют всё сверху)
            if (hitObj.object.userData?.isBuilt) {
              builtHitInbox.push({ id: String(hitObj.object.userData.id), damage: config.damage });
              _endPoint.copy(hitObj.point);
              useStore.getState().addDebris(makeFlames([hitObj.point.x, hitObj.point.y, hitObj.point.z], config.muzzle, 4));
              break;
            }
            // V5 C9: crates take the shot's impulse and FLY
            if (hitObj.object.userData?.isProp) {
              const d = raycaster.current.ray.direction;
              propHitInbox.push({ id: +hitObj.object.userData.id, damage: config.damage, dx: d.x, dy: d.y, dz: d.z });
              _endPoint.copy(hitObj.point);
              useStore.getState().addDebris(makeFlames([hitObj.point.x, hitObj.point.y, hitObj.point.z], config.muzzle, 3));
              break;
            }
            if (isHit || hitObj.object.userData?.isWall || hitObj.object.userData?.isFloor || hitObj.object.userData?.isJumpPad) {
              _endPoint.copy(hitObj.point);

              // Teardown voxel candles: carve a damage-scaled sphere of voxels out.
              if (hitObj.object.userData?.isVoxCandle) {
                carveVoxCandle(+hitObj.object.userData.id, hitObj.point.x, hitObj.point.y, hitObj.point.z, 1.0 + config.damage * 0.012);
              }

              // Pixel-fire burn at the impact point, in the weapon's muzzle color.
              useStore.getState().addDebris(
                makeFlames([hitObj.point.x, hitObj.point.y, hitObj.point.z], config.muzzle, hitEnemy ? 6 : 3),
              );

              // Sparks
              const sparkCount = hitEnemy ? 6 : 2;
              const mat = hitEnemy ? sparkMaterialEnemy : sparkMaterialWall;
              for(let i=0; i<sparkCount; i++) {
                const spark = new THREE.Mesh(sparkGeometry, mat);
                spark.position.copy(hitObj.point);
                spark.position.x += (Math.random() - 0.5) * 0.8;
                spark.position.y += (Math.random() - 0.5) * 0.8;
                spark.position.z += (Math.random() - 0.5) * 0.8;
                scene.add(spark);
                setTimeout(() => { scene.remove(spark); }, 100 + Math.random() * 150);
              }
              break;
            }
          }

          if (targetId) {
             // V9 К: голова карает, конечности берут меньше — но калечат
             const zoneDmg = Math.round(config.damage * ZONE_DMG[targetLimb]);
             socket.emit("hit", { targetId, damage: zoneDmg, limb: targetLimb });
             // Draw local damage number for hitting a player
             useStore.getState().addDamageNumber(
               [_endPoint.x, _endPoint.y, _endPoint.z], zoneDmg,
               targetLimb === 'head' ? '#ff2d2d' : targetLimb === 'body' ? '#4361ee' : '#ffd166',
             );
             // instant voxel GORE at the impact for the shooter (broadcast
             // self:false — everyone else gets it via the 'hit' goreInbox)
             useStore.getState().addDebris(makeGore(_endPoint.x, _endPoint.y, _endPoint.z, 8 + Math.round(config.damage * 0.1)));
             anyEnemyHit = true;
          }

          // Draw Laser (per-weapon color; railgun draws fat)
          if (laserRef.current && r === 0) {
             laserRef.current.visible = true;
             const mat = laserRef.current.material as THREE.LineBasicMaterial;
             mat.color.set(config.tracer);
             mat.opacity = 0.8;
             mat.linewidth = config.thick ? 10 : 3;

             const positions = laserRef.current.geometry.attributes.position.array as Float32Array;
             const start = _laserStartPoint.clone().applyMatrix4(camera.matrixWorld);
             positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
             positions[3] = _endPoint.x; positions[4] = _endPoint.y; positions[5] = _endPoint.z;
             laserRef.current.geometry.attributes.position.needsUpdate = true;
          }
        }

        // One feedback pulse for the whole shot: gold kill-marker + boom on a
        // kill, else a white hitmarker + crisp tick. Kills pay the CS bonus.
        if (anyEnemyHit) {
          fireHitmarker(anyKill);
          if (anyKill) {
            playExplosionSound();
            // V5 C10: chained kills pay MORE (×1 → ×3)
            useStore.getState().addMoney(Math.round(ECON.killBonus * registerKill()));
          } else playHitTick();
        }
      }
    }
    
    // Command Target (Minions)
    if (keys.command && now - lastSyncTime.current > 300) {
      raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersects = raycaster.current.intersectObjects(scene.children, true);
      if (intersects.length > 0) {
        useStore.getState().setCommandTarget([intersects[0].point.x, intersects[0].point.y, intersects[0].point.z]);
      }
    }

    // ===== V6 Ш4: walk into a portal → out of the twin, speed redirected =====
    {
      const exit = tryPortal('me', currentPos.x, currentPos.y, currentPos.z);
      if (exit && playerRef.current) {
        const spd = Math.max(10, Math.hypot(_moveVel.x, newY, _moveVel.z));
        playerRef.current.setTranslation({
          x: exit.x + exit.nx * 2.4, y: exit.y + exit.ny * 2.4 + 0.6, z: exit.z + exit.nz * 2.4,
        }, true);
        playerRef.current.setLinvel({ x: exit.nx * spd, y: Math.max(4, exit.ny * spd), z: exit.nz * spd }, true);
        addTrauma(0.1);
        playShootSound(500, 0.12);
      }
    }

    // Fell into the void — respawn to the calm spire spot (never eject).
    if (currentPos.y < -55) {
      playerRef.current.setTranslation({ x: SPAWN[0], y: SPAWN[1], z: SPAWN[2] }, true);
      playerRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Sync state
    if (roomId && now - lastSyncTime.current > 50) {
      lastSyncTime.current = now;
      const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      socket.emit("update", {
        x: currentPos.x,
        y: currentPos.y,
        z: currentPos.z,
        rotation: eul.y,
        isShooting: keys.shoot,
        currentWeapon: currentWeapon,
        minions: useStore.getState().localMinions,
        avatar: useStore.getState().avatarId,
        money: useStore.getState().money,
        scale: scaleRef.current,   // V9 Р: друг видит твой настоящий рост
        dragon: null
      });
    }
  });

  return (
    <>
      <PointerLockControls ref={controlsRef} />
      {isPlaying && (
        <RigidBody ref={playerRef} colliders={false} mass={1} type="dynamic" position={SPAWN} enabledRotations={[false, false, false]}>
          <CapsuleCollider args={[0.5 * bodyScale, 0.5 * bodyScale]} />
        </RigidBody>
      )}
      <group ref={weaponRef}>
        {/* Synty 3D viewmodel per weapon (re-shaded neon). Suspense fallback is
            null so a still-loading FBX just shows no gun for a frame. */}
        <Suspense fallback={null}>
          <WeaponModel weapon={currentWeapon} />
        </Suspense>
        {/* muzzle flash (toggled + faded in useFrame) */}
        <mesh ref={muzzleRef} position={[0.3, -0.3, -1.15]} visible={false}>
          <planeGeometry args={[0.7, 0.7]} />
          <meshBasicMaterial color="#fff2b0" transparent opacity={0} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      
      {/* 3rd-person body — the white blocky voxel dude (V3.2), 3rd person only */}
      <group ref={thirdPersonRef} visible={isThirdPerson}>
        <VoxDude
          weapon={currentWeapon}
          getSpeed={() => {
            const v = playerRef.current?.linvel();
            return v ? Math.hypot(v.x, v.z) : 0;
          }}
        />
      </group>
      {/* Reusable Laser Mesh */}
      <primitive object={new THREE.Line(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
        new THREE.LineBasicMaterial({ color: 0x00f5d4, linewidth: 3, transparent: true, opacity: 0.8 })
      )} ref={laserRef as any} visible={false} />
      {/* Grappling-hook rope */}
      <primitive object={new THREE.Line(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
        new THREE.LineBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.95, toneMapped: false })
      )} ref={grappleLineRef as any} visible={false} />
    </>
  );
};
