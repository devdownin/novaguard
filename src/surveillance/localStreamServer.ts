import { NativeModules } from 'react-native';

export interface LocalServerStatus {
  running: boolean;
  port: number;
  ipAddress: string | null;
  url: string | null;
  hasPin?: boolean;
  activeClients?: number;
}

export async function startLocalStreamServer(port: number = 8080, pin: string = ''): Promise<LocalServerStatus> {
  const module = NativeModules.LocalStreamServer;
  if (!module) {
    return { running: false, port, ipAddress: null, url: null, hasPin: false, activeClients: 0 };
  }
  return module.startServer(port, pin);
}

export function pushLocalStreamFrameBase64(base64Jpeg: string): void {
  const module = NativeModules.LocalStreamServer;
  if (!module || !module.updateFrameBase64) return;
  module.updateFrameBase64(base64Jpeg);
}

export async function stopLocalStreamServer(): Promise<boolean> {
  const module = NativeModules.LocalStreamServer;
  if (!module) return true;
  return module.stopServer();
}

export async function getLocalStreamServerStatus(): Promise<LocalServerStatus> {
  const module = NativeModules.LocalStreamServer;
  if (!module) {
    return { running: false, port: 8080, ipAddress: null, url: null };
  }
  return module.getServerStatus();
}
