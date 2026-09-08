import type { PluginModule } from "@read-aware/plugin-types";

/** Diagnostic provider: low-volume two-second PCM tone, no network or secrets. */
function tone(): ArrayBuffer {
  const samples = 16_000 * 2;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const data = new DataView(bytes);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF"); data.setUint32(4, bytes.byteLength - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, 16_000, true); data.setUint32(28, 32_000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  ascii(36, "data"); data.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) data.setInt16(44 + i * 2, Math.round(Math.sin(i / 16_000 * Math.PI * 440) * 650), true);
  return bytes;
}

export default {
  activate(ctx) {
    let mode = "tone";
    ctx.contributions.voiceProviders.register({ id: "tone", label: "Capability test tone",
      listVoices: () => [{ id: "tone", label: "Capability test tone" }],
      synthesize: async () => {
        if (mode === "reject") throw new Error("Intentional synthesis failure");
        if (mode === "delay") await new Promise(resolve => setTimeout(resolve, 2500));
        return tone();
      },
    });
    for (const next of ["tone", "reject", "delay"]) ctx.contributions.commands.register({ id: next, title: `Probe: ${next}`, run: () => { mode = next; } });
  },
} satisfies PluginModule;
