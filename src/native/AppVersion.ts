/**
 * 本机 app 版本单源。经原生小模块(iOS: AliangAppVersion.m 读 Info.plist,
 * Android: AliangAppVersionModule.kt 读 PackageManager)以 constants 同步
 * 暴露——同步取值避免启动期 promise 竞态。
 *
 * 模块缺失(老安装包/桥接失败)时返回 null:调用方一律按"无法判定"处理,
 * 跳过更新检查——绝不因版本读取失败而误判强制升级。
 */
import { NativeModules } from 'react-native';

interface AliangAppVersionModule {
  versionName?: string;
  versionCode?: string | number;
}

const nativeModule =
  NativeModules.AliangAppVersion as AliangAppVersionModule | undefined;

export interface InstalledAppVersion {
  versionName: string;
  versionCode: string;
}

export function getInstalledAppVersion(): InstalledAppVersion | null {
  const name = nativeModule?.versionName;
  if (typeof name !== 'string' || !name.trim()) return null;
  return {
    versionName: name,
    versionCode:
      nativeModule?.versionCode === undefined
        ? ''
        : String(nativeModule.versionCode),
  };
}
