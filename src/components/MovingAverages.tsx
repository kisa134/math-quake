import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLACK_HOLE, conductorState } from '../game/voxCandles';
import { accent } from '../game/accent';

/**
 * V4.3 — THREE MOVING-AVERAGE NERVES threaded through the candle belts
 * (spec §3). No scans of candle positions: the MA is the COHERENT part of the
 * breathing field (random-phase epicycles cancel; the belt wave remains), so
 * each line is a pure function of (θ, t). MA-20 gold rides the retail pit and
 * performs the golden/death cross; MA-50 wine holds the middle; MA-200 bone
 * barely moves — eternity. 3 draw calls, 32 points per line per frame,
 * opacity breathes with the donut's heart.
 */
const N_PTS = 128;
const LINES = [
  { color: '#e9c46a', beltAmp: 6, emaK: 0.8, baseR: 120, belt: 0 },  // MA-20 gold (radius animated)
  { color: '#a4133c', beltAmp: 9, emaK: 0.5, baseR: 270, belt: 1 },  // MA-50 wine
  { color: '#f5f0e6', beltAmp: 14, emaK: 0.25, baseR: 470, belt: 2 }, // MA-200 bone
];
const NO_RAYCAST = () => {};

export const MovingAverages = () => {
  const geoms = useMemo(
    () => LINES.map(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_PTS * 3), 3));
      return g;
    }),
    [],
  );
  const mats = useMemo(
    () => LINES.map((l) => new THREE.LineBasicMaterial({
      color: l.color, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })),
    [],
  );
  const cursor = useRef(0);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cs = conductorState(t);
    const heart = 0.5 + 0.5 * Math.sin(cs.heartPhase);
    for (let li = 0; li < LINES.length; li++) {
      const L = LINES[li];
      const R = li === 0 ? cs.ma20R : L.baseR;
      const arr = geoms[li].attributes.position.array as Float32Array;
      // 32 points per line per frame — the ribbon flows through in 4 frames
      for (let k = 0; k < 32; k++) {
        const i = (cursor.current + k) % N_PTS;
        const th = (i / N_PTS) * Math.PI * 2;
        const r = R * (1 + 0.03 * Math.sin(th * 2 - t * 0.2));
        arr[i * 3] = BLACK_HOLE.x + Math.cos(th) * r;
        arr[i * 3 + 1] = BLACK_HOLE.y + L.beltAmp * L.emaK * Math.sin(3 * th - 0.35 * t + L.belt * 2.1);
        arr[i * 3 + 2] = BLACK_HOLE.z + Math.sin(th) * r;
      }
      geoms[li].attributes.position.needsUpdate = true;
      mats[li].opacity = (0.3 + 0.25 * heart) * cs.dimGain;
    }
    mats[0].color.copy(accent); // MA-20 wears the market's accent (V5 monochrome)
    cursor.current = (cursor.current + 32) % N_PTS;
  });

  return (
    <>
      {LINES.map((_, i) => (
        // eslint-disable-next-line react/no-unknown-property
        <lineLoop key={i} geometry={geoms[i]} material={mats[i]} frustumCulled={false} onUpdate={(o: THREE.Object3D) => { o.raycast = NO_RAYCAST; }} />
      ))}
    </>
  );
};
