export function createGate() {
  let current: Promise<void> = Promise.resolve();
  return function gate<T>(isLocal: boolean, fn: () => Promise<T>): Promise<T> {
    if (!isLocal) return fn();
    const prev = current;
    let release: () => void;
    current = new Promise<void>((r) => {
      release = r;
    });
    return prev.then(fn).finally(() => release!());
  };
}
