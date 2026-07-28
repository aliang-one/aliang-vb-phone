package com.aliangvibecodingphone

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.views.view.setEdgeToEdgeFeatureFlagOn

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    setEdgeToEdgeFeatureFlagOn()
    // Pass null so Android does NOT restore Fragment state. react-native-screens
    // owns its Screen fragments and refuses to be re-instantiated from a saved
    // state — restoring them after the OS kills the process in the background
    // throws `Screen fragments should never be restored` on launch.
    // See https://github.com/software-mansion/react-native-screens/issues/17#issuecomment-424704067
    super.onCreate(null)
    configureSystemBars()
  }

  private fun configureSystemBars() {
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "AliangVibeCodingPhone"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
