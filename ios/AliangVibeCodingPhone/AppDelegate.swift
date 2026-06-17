import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)
    let initialProperties = Self.debugInitialProperties()

    factory.startReactNative(
      withModuleName: "AliangVibeCodingPhone",
      in: window,
      initialProperties: initialProperties,
      launchOptions: launchOptions
    )

    return true
  }

  private static func debugInitialProperties() -> [String: Any] {
#if DEBUG
    let arguments = ProcessInfo.processInfo.arguments
    var terminalTarget: [String: String] = [:]

    if let deviceId = debugArgument("AliangDebugTerminalDeviceId", in: arguments) {
      terminalTarget["deviceId"] = deviceId
    }
    if let directory = debugArgument("AliangDebugTerminalDirectory", in: arguments) {
      terminalTarget["directory"] = directory
    }
    if let terminalId = debugArgument("AliangDebugTerminalId", in: arguments) {
      terminalTarget["terminalId"] = terminalId
    }

    guard !terminalTarget.isEmpty else {
      return [:]
    }

    return ["debugDeviceTerminal": terminalTarget]
#else
    return [:]
#endif
  }

#if DEBUG
  private static func debugArgument(_ name: String, in arguments: [String]) -> String? {
    let assignmentPrefix = "--\(name)="
    if let argument = arguments.first(where: { $0.hasPrefix(assignmentPrefix) }) {
      return String(argument.dropFirst(assignmentPrefix.count))
    }

    let flag = "-\(name)"
    guard
      let flagIndex = arguments.firstIndex(of: flag),
      arguments.indices.contains(flagIndex + 1)
    else {
      return nil
    }

    let value = arguments[flagIndex + 1]
    return value.hasPrefix("-") ? nil : value
  }
#endif
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
