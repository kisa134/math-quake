import { useEffect, useRef, useState, useMemo, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../store';
import { playShootSound, playJumpSound, playHitTick, playExplosionSound } from '../utils/audio';
import { MOVE, cameraYaw, wishDirection, applyFriction, accelerate, clampHorizontal } from '../game/movement';
import { sampleShake, addTrauma } from '../game/shake';
import { fireHitmarker, fireShot } from '../game/fx';
import { WEAPONS } from '../config/weapons';
import { WeaponModel } from './WeaponModel';
import { ASSET_IDS } from '../config/assets';

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

// Spawn on the CORE spire platform (y≈81), offset from its centre pad + a small
// random jitter so two players don't stack — fixes the endless jump-pad bounce
// you got spawning in the middle of the arena.
const SPAWN: [number, number, number] = [
  12 + (Math.random() - 0.5) * 12,
  84,
  12 + (Math.random() - 0.5) * 12,
];
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

  // weapon feel
  const muzzleRef = useRef<THREE.Mesh>(null);
  const muzzleFade = useRef(0);
  const recoilAmt = useRef(0);

  // jetpack (double-tap space)
  const jetOn = useRef(false);
  const jetFuel = useRef(MOVE.jetFuelMax);
  const lastSpaceTap = useRef(-Infinity);
  const lastStunSeen = useRef(0);
  const lastFuelWrite = useRef(0);

  // grappling hook (right mouse)
  const grappleOn = useRef(false);
  const prevGrapple = useRef(false);
  const grappleAnchor = useRef(new THREE.Vector3());
  const grappleLineRef = useRef<THREE.Line>(null);

  const [isThirdPerson, setIsThirdPerson] = useState(false);
  const thirdPersonRef = useRef<THREE.Group>(null);
  
  // Weapon switching, camera toggle, and build-editor keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPlaying) return;
      const st = useStore.getState();
      if (e.code === 'KeyB') { st.toggleEditor(); return; }
      if (e.code === 'KeyV') { setIsThirdPerson(prev => !prev); return; }
      if (st.editorMode) {
        // Digits jump to an asset by index; scroll cycles (Editor.tsx owns it).
        const m = e.code.match(/^Digit([1-9])$/);
        if (m) { const i = +m[1] - 1; if (i < ASSET_IDS.length) st.setEditorSelect(ASSET_IDS[i]); }
      } else {
        const m = e.code.match(/^Digit([1-9])$/);
        if (m) setWeapon(+m[1] - 1); // clamped in setWeapon usage; WS-2 adds wheel
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, setWeapon]);
  
  // Create a persistent laser mesh
  const laserRef = useRef<THREE.Line>(null);
  
  const [lastShootTime, setLastShootTime] = useState(0);

  const { rapier, world } = useRapier();

  // NOTE: losing pointer lock (Esc / alt-tab) no longer ejects to a menu — the
  // UI shows a "click to play" overlay instead and re-locks on click. Pointer
  // lock is acquired via that overlay (a user gesture), not auto-locked here.

  useFrame((_, delta) => {
    if (!controlsRef.current || !controlsRef.current.isLocked || !isPlaying || !playerRef.current) return;

    // In build/editor mode, LMB/RMB place & delete props (see Editor.tsx), so
    // weapons and the grapple are suppressed this frame.
    const editorMode = useStore.getState().editorMode;

    // Movement
    const velocity = playerRef.current.linvel();
    const currentPos = playerRef.current.translation();
    
    if (isThirdPerson) {
      const offset = new THREE.Vector3(0, 2, 6); // Up 2, back 6
      offset.applyQuaternion(camera.quaternion);
      camera.position.set(currentPos.x, currentPos.y + 0.8, currentPos.z).add(offset);
      
      if (thirdPersonRef.current) {
        thirdPersonRef.current.position.set(currentPos.x, currentPos.y - 1, currentPos.z);
        const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
        thirdPersonRef.current.rotation.set(0, eul.y, 0);
      }
    } else {
      camera.position.set(currentPos.x, currentPos.y + 0.8, currentPos.z); // Eye level
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
    for (const dHit of downHits) {
      if (dHit.object.userData?.isJumpPad) {
        isOnJumpPad = true;
        grounded = true;
        if (dHit.object.userData.jumpForce) customJumpForce = dHit.object.userData.jumpForce;
        break;
      }
      if (dHit.object.userData?.isFloor || dHit.object.userData?.isWall) {
        grounded = true;
        break;
      }
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

    if (grounded && !didJump) {
      applyFriction(_moveVel, delta);
      accelerate(_moveVel, _wishDir, hasInput ? MOVE.maxGroundSpeed : 0, MOVE.groundAccel, delta);
    } else {
      // airborne (or the frame we jumped): the air-strafe engine, momentum kept
      accelerate(_moveVel, _wishDir, hasInput ? MOVE.airAccelCap : 0, MOVE.airAccel, delta);
    }
    clampHorizontal(_moveVel);

    // --- Grappling hook (right mouse): latch a surface, then reel + swing ---
    if (editorMode) grappleOn.current = false; // RMB deletes props in build mode
    if (!editorMode && keys.grapple && !prevGrapple.current) {
      raycaster.current.setFromCamera(_center2, camera);
      const hits = raycaster.current.intersectObjects(scene.children, true);
      for (const h of hits) {
        const ud = h.object.userData;
        let o: THREE.Object3D | null = h.object;
        let isEnemy = false;
        while (o) { if (o.userData?.isEnemy) { isEnemy = true; break; } o = o.parent; }
        if (ud?.isWall || ud?.isFloor || ud?.isJumpPad || isEnemy) {
          if (h.distance <= MOVE.grappleRange) {
            grappleAnchor.current.copy(h.point);
            grappleOn.current = true;
            playShootSound(150, 0.09);
          }
          break;
        }
      }
    }
    prevGrapple.current = keys.grapple;

    if (grappleOn.current) {
      _grappleVec.set(
        grappleAnchor.current.x - currentPos.x,
        grappleAnchor.current.y - (currentPos.y + 0.8),
        grappleAnchor.current.z - currentPos.z,
      );
      const dist = _grappleVec.length();
      if (!keys.grapple || dist < MOVE.grappleRelease) {
        grappleOn.current = false; // release keeps momentum → satisfying fling
      } else {
        _grappleVec.multiplyScalar(1 / dist);
        const pull = MOVE.grapplePull * delta;
        _moveVel.x += _grappleVec.x * pull;
        _moveVel.z += _grappleVec.z * pull;
        newY += _grappleVec.y * pull;
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

    // Shooting logic (suppressed in build/editor mode — LMB places props)
    const config = WEAPONS[currentWeapon];
    if (!editorMode && keys.shoot && now - lastShootTime > config.rate) {
      setLastShootTime(now);
      playShootSound(config.sound, 0.05);
      fireShot(config.recoil); // crosshair bloom + viewmodel punch

      // --- weapon feel: recoil kick + muzzle flash + fire shake ---
      recoilAmt.current = Math.min(1.2, recoilAmt.current + config.recoil);
      addTrauma(0.03 + config.recoil * 0.12);
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

      const center = new THREE.Vector2(0, 0);
      
      if (config.type === 'projectile') {
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

        for (let r = 0; r < raysToFire; r++) {
          let spreadX = 0;
          let spreadY = 0;
          if (config.spread) {
            spreadX = (Math.random() - 0.5) * config.spread;
            spreadY = (Math.random() - 0.5) * config.spread;
          }

          raycaster.current.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
          const intersects = raycaster.current.intersectObjects(scene.children, true);
          raycaster.current.ray.at(100, _endPoint);

          let hitEnemy = false;
          let targetId: string | null = null;

          for (const hitObj of intersects) {
            let obj: THREE.Object3D | null = hitObj.object;
            let isHit = false;
            while (obj) {
              if (obj.userData?.isEnemy) {
                if (obj.userData?.isPlayer) {
                  targetId = obj.userData.id;
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
                anyEnemyHit = true;
                isHit = true;
                hitEnemy = true;
                break;
              }
              obj = obj.parent;
            }
            if (isHit || hitObj.object.userData?.isWall || hitObj.object.userData?.isFloor || hitObj.object.userData?.isJumpPad) {
              _endPoint.copy(hitObj.point);

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
             socket.emit("hit", { targetId, damage: config.damage });
             // Draw local damage number for hitting a player
             useStore.getState().addDamageNumber([_endPoint.x, _endPoint.y, _endPoint.z], config.damage, '#4361ee');
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
        // kill, else a white hitmarker + crisp tick.
        if (anyEnemyHit) {
          fireHitmarker(anyKill);
          if (anyKill) playExplosionSound();
          else playHitTick();
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
        minions: useStore.getState().localMinions
      });
    }
  });

  return (
    <>
      <PointerLockControls ref={controlsRef} />
      {isPlaying && (
        <RigidBody ref={playerRef} colliders={false} mass={1} type="dynamic" position={SPAWN} enabledRotations={[false, false, false]}>
          <CapsuleCollider args={[0.5, 0.5]} />
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
      
      {/* 3rd Person Mesh */}
      <group ref={thirdPersonRef} visible={false}>
        <mesh castShadow receiveShadow>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
          <meshStandardMaterial color="#00f5d4" />
        </mesh>
        <mesh position={[0, 0.5, -0.4]} castShadow>
          <boxGeometry args={[0.6, 0.2, 0.4]} />
          <meshStandardMaterial color="#222" emissive="#00f5d4" emissiveIntensity={0.5} />
        </mesh>
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
