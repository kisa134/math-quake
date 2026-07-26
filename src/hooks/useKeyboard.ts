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
    grapple: false,
    aim: false,
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
        case 'ShiftLeft': case 'ShiftRight': setKeys((k) => ({ ...k, aim: true })); break;
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
        case 'ShiftLeft': case 'ShiftRight': setKeys((k) => ({ ...k, aim: false })); break;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) setKeys((k) => ({ ...k, shoot: true }));
      if (e.button === 2) setKeys((k) => ({ ...k, grapple: true }));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) setKeys((k) => ({ ...k, shoot: false }));
      if (e.button === 2) setKeys((k) => ({ ...k, grapple: false }));
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault(); // right mouse = grapple

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  return keys;
};
