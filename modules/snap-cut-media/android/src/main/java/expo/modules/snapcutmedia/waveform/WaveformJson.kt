package expo.modules.snapcutmedia.waveform

import java.util.Locale

internal object WaveformJson {
  fun encode(data: WaveformData): String {
    data.requireValid()
    return buildString(32 + data.binCount * 20) {
      append("{\"schemaVersion\":1,\"durationMs\":")
      append(data.durationMs)
      append(",\"binCount\":")
      append(data.binCount)
      append(",\"rms\":[")
      appendValues(data.rms)
      append("],\"peak\":[")
      appendValues(data.peak)
      append("]}")
    }
  }

  private fun StringBuilder.appendValues(values: DoubleArray) {
    values.forEachIndexed { index, value ->
      if (index > 0) append(',')
      append(String.format(Locale.US, "%.8f", value))
    }
  }
}
