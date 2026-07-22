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
  
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.position.y += delta * 2;
      ref.current.material.opacity = Math.max(0, ref.current.material.opacity - delta);
      
      if (Date.now() - damage.createdAt > 1000) {
        removeDamageNumber(damage.id);
      }
    }
  });

  return (
    <Text
      ref={ref}
      position={[damage.x, damage.y + 1, damage.z]}
      fontSize={1.5}
      color={damage.color || '#00f5d4'}
      outlineWidth={0.1}
      outlineColor="#000000"
      font="/Geist-Bold.ttf" // Drei will load default if not found
    >
      {damage.amount}
    </Text>
  );
};
