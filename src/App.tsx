/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Game } from './components/Game';
import { UI } from './components/UI';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <div className="w-full h-screen bg-black overflow-hidden relative">
      <ErrorBoundary>
        <Game />
        <UI />
      </ErrorBoundary>
    </div>
  );
}
