// 本机 app 版本桥(读 Info.plist,constants 同步暴露,JS 端见 src/native/AppVersion.ts)。
// 检查更新功能以此为版本单源(iOS 侧权威 = CFBundleShortVersionString/CFBundleVersion,
// 即 MARKETING_VERSION/CURRENT_PROJECT_VERSION 的构建产物)。
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface AliangAppVersion : NSObject <RCTBridgeModule>
@end

@implementation AliangAppVersion

RCT_EXPORT_MODULE(AliangAppVersion)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

// 新旧桥双兼容:TurboModule interop 读 getConstants,legacy 读 constantsToExport。
- (NSDictionary *)constantsToExport
{
  NSDictionary *info = [[NSBundle mainBundle] infoDictionary];
  return @{
    @"versionName": info[@"CFBundleShortVersionString"] ?: @"",
    @"versionCode": info[@"CFBundleVersion"] ?: @"",
  };
}

- (NSDictionary *)getConstants
{
  return [self constantsToExport];
}

@end
