import { defineConfig } from 'vitest/config';

// Unit tests cover the framework-independent DICOM logic (series grouping,
// slice ordering, window presets). They run in Node and never touch
// Cornerstone3D or real patient data.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
