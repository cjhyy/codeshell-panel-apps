// One catalog for the default offline gate. Existing script paths remain valid
// while their application ownership is explicit here.
export const suites = [
  {
    id: "packages",
    label: "Package rules and existing application regressions",
    commands: [["scripts/validate.mjs"]],
  },
  {
    id: "build",
    label: "Source packaging, determinism and installation closure",
    commands: [["--test", "tests/panel-build.test.mjs"]],
  },
  {
    id: "quant-lab",
    label: "Quant Lab data, portfolio and market workflows",
    commands: ["portfolio", "portfolio-rules", "portfolio-data", "today", "news", "notes"]
      .map((name) => [`scripts/quant-lab-${name}.mjs`]),
  },
  {
    id: "video-studio",
    label: "Video Studio project model and Host contracts",
    commands: [
      [
        "scripts/run-typescript-tests.mjs",
        "tests/video-studio-local-voice.test.ts",
        "apps/video-studio/native/tests/audio8.test.ts",
        "apps/video-studio/native/tests/qwen.test.ts",
        "tests/video-studio-model.test.ts",
        "tests/video-studio-rough-cut.test.ts",
        "tests/video-studio-rough-cut-controls.test.ts",
        "tests/video-studio-voice-preparation-ui.test.ts",
        "tests/video-studio-host.test.ts",
        "tests/video-studio-production.test.ts",
        "tests/video-studio-production-ui.test.ts",
        "tests/video-studio-production-tools.test.ts",
        "tests/video-studio-tts.test.ts",
        "tests/video-studio-voiceover-publication.test.ts",
        "tests/video-studio-spoken.test.ts",
        "tests/video-studio-enhancement.test.ts",
        "tests/video-studio-caption-style.test.ts",
        "tests/video-studio-workflow.test.ts",
        "tests/video-studio-narration.test.ts",
        "tests/video-studio-narration-alignment.test.ts",
      ],
      ["--test", "apps/video-studio/native/tests/voice-runtime.test.mjs"],
    ],
  },
];
