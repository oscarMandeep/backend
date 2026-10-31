import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.io on the same HTTP port as the REST API. CORS is set here because the
 * web URL comes from the validated config, which is not loaded yet when the
 * gateway decorator runs.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly webUrl: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const merged = {
      ...options,
      cors: { origin: this.webUrl, credentials: true },
    } as ServerOptions;
    return super.createIOServer(port, merged) as Server;
  }
}
