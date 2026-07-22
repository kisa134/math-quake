/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Game } from './components/Game';
import { UI } from './components/UI';

export default function App() {
  return (
    <div className="w-full h-screen bg-black overflow-hidden relative">
      <Game />
      <UI />
    </div>
  );
}
