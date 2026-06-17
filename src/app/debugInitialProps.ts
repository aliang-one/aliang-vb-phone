export type DebugDeviceTerminalTarget = {
  deviceId?: string;
  directory?: string;
  terminalId?: string;
};

export type AppInitialProps = {
  debugDeviceTerminal?: DebugDeviceTerminalTarget;
};

export const FIRST_ONLINE_DEVICE_TARGET = 'FIRST_ONLINE';
