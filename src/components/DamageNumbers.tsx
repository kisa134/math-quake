import React from 'react';
import { useStore } from '../store';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

export const DamageNumbers = () => {
  const damageNumbers = useStore(state => state.damageNumbers);
  
  return (
    <>
      {damageNumbers.map(d => (
        <DamageNumber key={d.id} damage={d} />
      ))}
    </>
  );
};

const DamageNumber = ({ damage }: { damage: any }) => {
  const ref = React.useRef<any>(null);
  const removeDamageNumber = useStore(state => state.removeDamageNumber);
  
  // Bigger hits punch bigger; a quick upward arc that eases out.
  const size = 1.1 + Math.min(damage.amount, 120) / 45;
  const big = damage.amount >= 80;

  useFrame((state, delta) => {
    if (ref.current) {
      const age = (Date.now() - damage.createdAt) / 1000;
      ref.current.position.y += delta * (age < 0.15 ? 9 : 2.5); // fast initial pop, then drift
      const mat = ref.current.material;
      if (mat) mat.opacity = Math.max(0, mat.opacity - delta * 1.2);

      if (age > 1) {
        removeDamageNumber(damage.id);
      }
    }
  });

  return (
    <Text
      ref={ref}
      position={[damage.x, damage.y + 1, damage.z]}
      fontSize={size}
      color={big ? '#ffffff' : (damage.color || '#00f5d4')}
      outlineWidth={0.12}
      outlineColor="#000000"
    >
      {damage.amount}
    </Text>
  );
};
