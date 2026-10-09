package com.aliangvibecodingphone

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.module.annotations.ReactModule

/**
 * 本机 app 版本桥(读 PackageManager,constants 同步暴露,JS 端见
 * src/native/AppVersion.ts)。版本单源 = versionName/versionCode,
 * 即 build.gradle 的 VERSION_NAME/VERSION_CODE 构建产物。
 */
@ReactModule(name = AliangAppVersionModule.NAME)
class AliangAppVersionModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  private val packageInfo by lazy {
    reactApplicationContext.packageManager.getPackageInfo(
      reactApplicationContext.packageName,
      0,
    )
  }

  override fun getConstants(): Map<String, Any> = mapOf(
    "versionName" to (packageInfo.versionName ?: ""),
    "versionCode" to packageInfo.versionCode,
  )

  companion object {
    const val NAME = "AliangAppVersion"
  }
}
