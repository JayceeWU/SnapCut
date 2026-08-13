package expo.modules.snapcutmedia.exportmedia

import expo.modules.snapcutmedia.errors.SnapCutMediaError
import expo.modules.snapcutmedia.errors.mediaError
import expo.modules.snapcutmedia.models.M4aExportPlan
import expo.modules.snapcutmedia.models.NativePreviewClip

internal data class ExportClipSignature(
  val clipId: String,
  val sourceId: String,
  val audioFileUri: String,
  val startMs: Long,
  val endMs: Long
)

/** Process-local capability registry. A plan is usable only if native preflight issued it. */
internal class M4aPlanRegistry(private val maximumProjects: Int = 16) {
  private data class IssuedPlan(
    val projectId: String,
    val plan: M4aExportPlan,
    val clips: List<ExportClipSignature>
  )

  private val lock = Any()
  private val byProject = LinkedHashMap<String, IssuedPlan>(16, 0.75f, true)

  init {
    require(maximumProjects > 0)
  }

  fun issue(projectId: String, plan: M4aExportPlan, clips: List<NativePreviewClip>) {
    if (projectId.isBlank()) throw mediaError(SnapCutMediaError.INVALID_REQUEST)
    val issued = IssuedPlan(projectId, plan.deepCopy(), clips.map { it.signature() })
    synchronized(lock) {
      byProject[projectId] = issued
      while (byProject.size > maximumProjects) {
        val eldestProjectId = byProject.entries.firstOrNull()?.key ?: break
        byProject.remove(eldestProjectId)
      }
    }
  }

  fun invalidate(projectId: String) {
    synchronized(lock) { byProject.remove(projectId) }
  }

  fun clear() {
    synchronized(lock) { byProject.clear() }
  }

  fun requireIssued(projectId: String, plan: M4aExportPlan, clips: List<NativePreviewClip>) {
    val issued = synchronized(lock) { byProject[projectId] }
      ?: throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
    if (
      !plan.eligible ||
      issued.projectId != projectId ||
      issued.plan != plan ||
      issued.clips != clips.map { it.signature() }
    ) {
      throw mediaError(SnapCutMediaError.M4A_PLAN_STALE)
    }
  }

  private fun NativePreviewClip.signature() = ExportClipSignature(
    clipId,
    sourceId,
    audioFileUri,
    startMs,
    endMs
  )

  private fun M4aExportPlan.deepCopy(): M4aExportPlan = copy(
    reasons = reasons.toList(),
    sourceSnapshots = sourceSnapshots.map { it.copy() },
    clips = clips.map { it.copy() }
  )
}
