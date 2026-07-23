// Live enemy positions, written by EnemyMesh each frame on the HOST and read by
// the host broadcaster. A plain module map avoids per-frame zustand churn.
export const enemyLive = new Map<string, { x: number; y: number; z: number }>();
