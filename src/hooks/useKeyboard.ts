import { useEffect, useState } from 'react';

export const useKeyboard = () => {
  const [keys, setKeys] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    shoot: false,
    command: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': setKeys((k) => ({ ...k, forward: true })); break;
        case 'KeyS': setKeys((k) => ({ ...k, backward: true })); break;
        case 'KeyA': setKeys((k) => ({ ...k, left: true })); break;
        case 'KeyD': setKeys((k) => ({ ...k, right: true })); break;
        case 'Space': setKeys((k) => ({ ...k, jump: true })); break;
        case 'KeyF': setKeys((k) => ({ ...k, command: true })); break;
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': setKeys((k) => ({ ...k, forward: false })); break;
        case 'KeyS': setKeys((k) => ({ ...k, backward: false })); break;
        case 'KeyA': setKeys((k) => ({ ...k, left: false })); break;
        case 'KeyD': setKeys((k) => ({ ...k, right: false })); break;
        case 'Space': setKeys((k) => ({ ...k, jump: false })); break;
        case 'KeyF': setKeys((k) => ({ ...k, command: false })); break;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) setKeys((k) => ({ ...k, shoot: true }));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) setKeys((k) => ({ ...k, shoot: false }));
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return keys;
};
