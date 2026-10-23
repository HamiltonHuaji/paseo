// A delayed Headless JS start can arrive after its service has stopped or restarted.
// Subscribe before querying native state so neither ordering loses completion.
export function createViewerTaskLifetime(getServiceId: () => Promise<string | null>) {
  const tasks = new Map<string, Set<() => void>>();
  return {
    run(serviceId: string): Promise<void> {
      return new Promise((resolve) => {
        const finish = () => {
          const waiting = tasks.get(serviceId);
          waiting?.delete(finish);
          if (waiting?.size === 0) tasks.delete(serviceId);
          resolve();
        };
        const waiting = tasks.get(serviceId) ?? new Set();
        waiting.add(finish);
        tasks.set(serviceId, waiting);
        void getServiceId().then((current) => {
          if (current !== serviceId) finish();
          return undefined;
        }, finish);
      });
    },
    stop(serviceId: string): void {
      for (const finish of tasks.get(serviceId) ?? []) finish();
    },
  };
}
