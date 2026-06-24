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
}
