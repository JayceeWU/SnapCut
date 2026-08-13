package expo.modules.snapcutmedia.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class PrivateOutputUriInstrumentedTest {
  @Test
  fun acceptsAChildOfTheRealAndroidAppFilesDirectory() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val stagingRoot = File(context.filesDir, "SnapCut/staging").apply { mkdirs() }
    val output = File(stagingRoot, ".import-device-alias/source.m4a.partial")

    assertEquals(
      output.canonicalFile,
      PrivateOutputUri.requireSafeFileUri(output.toURI().toString(), listOf(stagingRoot))
    )
  }
}
