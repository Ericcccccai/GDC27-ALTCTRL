import { SerialPort } from 'serialport';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { ServerResponse } from 'node:http';
import { ImuParser, SENSOR_PATHS, type Side, type SensorLink, type ImuFrame } from '../src/sensors';

/** One local owner for both USB ports; browsers receive every sampled frame in bounded batches. */
export function sensorBridge(): Plugin {
  let cleanup = () => {};
  const attach = (server: ViteDevServer | PreviewServer) => {
    const clients = new Set<ServerResponse>();
    const ports = new Map<Side, SerialPort>();
    const links = (['L', 'R'] as Side[]).map(side => ({ side, path: SENSOR_PATHS[side], connected: false, message: 'Connecting…', receivedAt: 0, frames: 0, rejected: 0, frame: null } as SensorLink));
    let stopped = false;
    let samples: { side: Side; at: number; frame: ImuFrame }[] = [];
    let overflow = false;
    const packet = (includeSamples: boolean) => JSON.stringify({ throughAt: Date.now(), links, samples: includeSamples ? samples : [], overflow: includeSamples && overflow });
    function open(link: SensorLink): void {
      if (stopped || ports.has(link.side)) return;
      const port = new SerialPort({ path: link.path, baudRate: 115200, autoOpen: false });
      ports.set(link.side, port);
      const parser = new ImuParser();
      const fail = (error: Error) => { link.message = error.message; link.connected = false; link.frame = null; };
      port.on('error', error => {
        fail(error);
        if (port.isOpen) port.close();
      });
      port.on('close', () => { ports.delete(link.side); link.connected = false; link.frame = null; link.message = 'Disconnected. Retrying…'; });
      port.on('data', (data: Buffer) => {
        const frames = parser.push(data.toString('utf8'));
        link.rejected = parser.rejected;
        if (!frames.length) return;
        link.frame = frames[frames.length - 1];
        link.frames += frames.length;
        link.receivedAt = Date.now();
        samples.push(...frames.map(frame => ({ side: link.side, at: link.receivedAt, frame })));
        if (samples.length > 512) { samples = samples.slice(-512); overflow = true; }
        link.message = link.frame.side === link.side ? 'Receiving' : `Firmware says ${link.frame.side}; using USB path assignment`;
      });
      port.open(error => {
        if (error) { fail(error); ports.delete(link.side); return; }
        if (stopped) { port.close(); return; }
        link.connected = true; link.message = 'Port open. Waiting for readings…';
        port.set({ dtr: true }, error => { if (error) link.message = error.message; });
      });
    }
    links.forEach(open);
    const retry = setInterval(() => links.forEach(open), 2000);
    const broadcast = setInterval(() => {
      const body = `data: ${packet(true)}\n\n`;
      for (const client of clients) {
        if (client.writableLength > 64 * 1024) { client.destroy(); clients.delete(client); }
        else client.write(body);
      }
      samples = []; overflow = false;
    }, 50);
    server.middlewares.use('/api/sensors', (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${packet(false)}\n\n`);
      clients.add(res);
      res.on('close', () => clients.delete(res));
    });
    cleanup = () => {
      stopped = true; clearInterval(retry); clearInterval(broadcast);
      for (const client of clients) client.end();
      for (const port of ports.values()) if (port.isOpen) port.close();
    };
    server.httpServer?.once('close', cleanup);
  };
  return { name: 'local-imu-sensors', configureServer: attach, configurePreviewServer: attach, closeBundle: () => cleanup() };
}
