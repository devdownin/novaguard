import { NativeModules } from 'react-native';

export interface LocalServerStatus {
  running: boolean;
  port: number;
  ipAddress: string | null;
  url: string | null;
}

export async function startLocalStreamServer(port: number = 8080): Promise<LocalServerStatus> {
  const module = NativeModules.LocalStreamServer;
  if (!module) {
    return { running: false, port, ipAddress: null, url: null };
  }
  return module.startServer(port);
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
