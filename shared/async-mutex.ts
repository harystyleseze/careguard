/** A small FIFO mutex for serialising asynchronous critical sections. */
export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this.queue.shift();
        if (next) next();
        else this.locked = false;
      };
      if (this.locked) this.queue.push(() => resolve(release));
      else {
        this.locked = true;
        resolve(release);
      }
    });
  }
}
