import type { Server as HttpServer } from "node:http";

export async function listenWithPortFallback(input: {
  server: HttpServer;
  host: string;
  ports: readonly number[];
}): Promise<number> {
  for (const port of input.ports) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          input.server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          input.server.off("error", onError);
          resolve();
        };
        input.server.once("error", onError);
        input.server.once("listening", onListening);
        input.server.listen(port, input.host);
      });
      const address = input.server.address();
      if (!address || typeof address === "string") throw new Error("Proxy did not bind a TCP port");
      return address.port;
    } catch (error) {
      const conflict = error instanceof Error && "code" in error && error.code === "EADDRINUSE";
      if (!conflict) throw error;
    }
  }
  throw new Error("No available proxy port");
}
