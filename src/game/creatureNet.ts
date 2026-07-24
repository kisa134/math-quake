// Live creature positions (WS-E), written by CreatureMesh each frame on the
// HOST and read by the host broadcaster — mirrors game/enemyNet.ts. A plain
// module map avoids per-frame zustand churn.
export const creatureLive = new Map<string, { x: number; y: number; z: number }>();

// Inbox for peer→host creature interactions ('chit' damage relays and 'tame'
// requests). socket.ts pushes here instead of importing Creatures.tsx (which
// would create an import cycle); the host sim drains it every frame.
export const creatureHitInbox: { id: string; damage: number; tame?: boolean }[] = [];
