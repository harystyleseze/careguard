declare module 'proper-lockfile' {
  export interface LockOptions {
    retries?: number;
    stale?: number;
  }

  export interface Unlock {
    (): Promise<void>;
  }

  export function lock(path: string, options?: LockOptions): Promise<Unlock>;
  export function unlock(path: string): Promise<void>;
  export function lockSync(path: string, options?: LockOptions): () => void;
  export function unlockSync(path: string): void;

  const _default: {
    lock: typeof lock;
    unlock: typeof unlock;
    lockSync: typeof lockSync;
    unlockSync: typeof unlockSync;
  };
  export default _default;
}
