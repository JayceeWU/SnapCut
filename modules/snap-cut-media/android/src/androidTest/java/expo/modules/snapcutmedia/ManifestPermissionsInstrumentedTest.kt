package expo.modules.snapcutmedia.permissions

import android.Manifest
import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ManifestPermissionsInstrumentedTest {
  @Suppress("DEPRECATION")
  @Test
  fun installedTargetDoesNotRequestBroadMediaStorageCapturePermissions() {
    val targetContext = InstrumentationRegistry.getInstrumentation().targetContext
    val packageInfo = targetContext.packageManager.getPackageInfo(
      targetContext.packageName,
      PackageManager.GET_PERMISSIONS
    )
    val requested = packageInfo.requestedPermissions.orEmpty().toSet()

    FORBIDDEN_PERMISSIONS.forEach { permission ->
      assertFalse("Installed target unexpectedly requests $permission", permission in requested)
    }
  }

  private companion object {
    val FORBIDDEN_PERMISSIONS = setOf(
      Manifest.permission.CAMERA,
      Manifest.permission.RECORD_AUDIO,
      Manifest.permission.MANAGE_EXTERNAL_STORAGE,
      Manifest.permission.READ_EXTERNAL_STORAGE,
      Manifest.permission.WRITE_EXTERNAL_STORAGE,
      Manifest.permission.READ_MEDIA_AUDIO,
      Manifest.permission.READ_MEDIA_IMAGES,
      Manifest.permission.READ_MEDIA_VIDEO,
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      Manifest.permission.ACCESS_MEDIA_LOCATION
    )
  }
}
