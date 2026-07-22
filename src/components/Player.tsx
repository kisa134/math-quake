import { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { useKeyboard } from '../hooks/useKeyboard';
import { useStore } from '../store';
import { playShootSound, playJumpSound } from '../utils/audio';
import { MOVE, cameraYaw, wishDirection, applyFriction, accelerate, clampHorizontal } from '../game/movement';
import { sampleShake, addTrauma } from '../game/shake';
import { fireHitmarker } from '../game/fx';

const JUMP_FORCE = 15;

// Shared allocations to prevent Garbage Collection stutter in useFrame
const _wishDir = new THREE.Vector3();
const _moveVel = new THREE.Vector3();
const _downRayDir = new THREE.Vector3(0, -1, 0);
const _downRaycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _shake = { x: 0, y: 0, z: 0 };
const _recoilVec = new THREE.Vector3();
const _endPoint = new THREE.Vector3();
const _laserStartPoint = new THREE.Vector3(0.3, -0.3, -1);

// Shared Geometries and Materials for sparks
const sparkGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const sparkMaterialEnemy = new THREE.MeshBasicMaterial({ color: 0xf72585 });
const sparkMaterialWall = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });

import { socket } from '../socket';

// ... other imports

const WEAPON_CONFIG = [
  { rate: 120, damage: 15, recoil: 0.1, sound: 800 },
  { rate: 800, damage: 10, recoil: 0.4, sound: 200, spread: 0.1, rays: 8 },
  { rate: 400, damage: 40, recoil: 0.2, sound: 400, type: 'projectile' },
  { rate: 1500, damage: 120, recoil: 0.6, sound: 100, thick: true }
];

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

  const [isThirdPerson, setIsThirdPerson] = useState(false);
  const thirdPersonRef = useRef<THREE.Group>(null);
  
  // Weapon switching & camera toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPlaying) return;
      if (e.code === 'Digit1') setWeapon(0);
      if (e.code === 'Digit2') setWeapon(1);
      if (e.code === 'Digit3') setWeapon(2);
      if (e.code === 'Digit4') setWeapon(3);
      if (e.code === 'KeyV') setIsThirdPerson(prev => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, setWeapon]);
  
  // Create a persistent laser mesh
  const laserRef = useRef<THREE.Line>(null);
  
  const [lastShootTime, setLastShootTime] = useState(0);

  const { rapier, world } = useRapier();

  // Handle pointer lock logic
  useEffect(() => {
    const handlePointerLockChange = () => {
      if (!document.pointerLockElement && isPlaying) {
        gameOver();
      }
    };
    
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [isPlaying, gameOver]);

  useEffect(() => {
    if (isPlaying && controlsRef.current) {
      controlsRef.current.lock();
    }
  }, [isPlaying]);

  useFrame((_, delta) => {
    if (!controlsRef.current || !controlsRef.current.isLocked || !isPlaying || !playerRef.current) return;

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

    // Shooting logic
    const config = WEAPON_CONFIG[currentWeapon];
    if (keys.shoot && now - lastShootTime > config.rate) {
      setLastShootTime(now);
      playShootSound(config.sound, 0.05);

      // --- weapon feel: recoil kick + muzzle flash + fire shake ---
      recoilAmt.current = Math.min(1.2, recoilAmt.current + config.recoil);
      addTrauma(0.03 + config.recoil * 0.12);
      if (muzzleRef.current) {
        muzzleFade.current = 1;
        muzzleRef.current.visible = true;
        muzzleRef.current.scale.setScalar(0.7 + Math.random() * 0.6);
        muzzleRef.current.rotation.z = Math.random() * Math.PI;
        (muzzleRef.current.material as THREE.MeshBasicMaterial).opacity = 1;
      }

      if (weaponRef.current) {
        const weaponMesh = weaponRef.current.children[0];
        weaponMesh.position.z += config.recoil;
        setTimeout(() => { if (weaponMesh) weaponMesh.position.z -= config.recoil; }, 40);
      }
      
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
                  useStore.getState().damageEnemy(obj.userData.id, config.damage, [hitObj.point.x, hitObj.point.y, hitObj.point.z]);
                }
                fireHitmarker(false);
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
          }
          
          // Draw Laser
          if (laserRef.current && r === 0) {
             laserRef.current.visible = true;
             const mat = laserRef.current.material as THREE.LineBasicMaterial;
             mat.opacity = 0.8;
             mat.linewidth = config.thick ? 10 : 3;
             
             const positions = laserRef.current.geometry.attributes.position.array as Float32Array;
             const start = _laserStartPoint.clone().applyMatrix4(camera.matrixWorld);
             positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
             positions[3] = _endPoint.x; positions[4] = _endPoint.y; positions[5] = _endPoint.z;
             laserRef.current.geometry.attributes.position.needsUpdate = true;
          }
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

    // Bounds check death (falling off)
    if (currentPos.y < -50) {
       gameOver();
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
        <RigidBody ref={playerRef} colliders={false} mass={1} type="dynamic" position={[0, 5, 0]} enabledRotations={[false, false, false]}>
          <CapsuleCollider args={[0.5, 0.5]} />
        </RigidBody>
      )}
      <group ref={weaponRef}>
        <mesh position={[0.3, -0.3, -0.8]}>
          <boxGeometry args={[0.1, 0.1, 0.4]} />
          <meshStandardMaterial color="#888" />
        </mesh>
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
    </>
  );
};
