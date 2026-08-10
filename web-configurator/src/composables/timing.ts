export function useTiming() {
  const timeoutMap = new Map<() => void, ReturnType<typeof setTimeout>>();
  function timeoutHelper(callback: () => void, duration: number) {
    clearTimeout(timeoutMap.get(callback));

    const timer = setTimeout(() => {
      callback();
      clearTimeout(timer);
      timeoutMap.delete(callback);
    }, duration);

    timeoutMap.set(callback, timer);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function debounce<T extends (...args: any[]) => void>(
    func: T,
    delay: number,
  ): T {
    let timer: ReturnType<typeof setTimeout>;
    return function (this: unknown, ...args: Parameters<T>) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    } as T;
  }

  return {
    timeoutHelper,
    sleep,
    debounce,
  };
}
