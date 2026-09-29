# Graph Report - studio  (2026-09-29)

## Corpus Check
- 93 files · ~135,403 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: .css 7, .example 1, (none) 1)

## Summary
- 538 nodes · 1075 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Component Tests
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Mascot Catalog
- Studio Scripts
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21

## God Nodes (most connected - your core abstractions)
1. `react` - 40 edges
2. `StudioShell()` - 35 edges
3. `HistoryList()` - 33 edges
4. `apiUrl()` - 21 edges
5. `usePrefersReducedMotion()` - 20 edges
6. `compilerOptions` - 19 edges
7. `authFetch()` - 18 edges
8. `compilerOptions` - 15 edges
9. `VoicePicker()` - 13 edges
10. `scripts` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Session-local Mascot Positioning` --rationale_for--> `MascotPicker`  [EXTRACTED]
  README.md → apps/studio/src/components/MascotPicker.tsx
- `Studio Mascot Release QA` --references--> `MascotPicker`  [EXTRACTED]
  docs/BUILD.md → apps/studio/src/components/MascotPicker.tsx
- `Mascot 4` --conceptually_related_to--> `MascotPicker`  [INFERRED]
  apps/studio/public/mascots/4a.webp → apps/studio/src/components/MascotPicker.tsx
- `Mascot 5` --conceptually_related_to--> `MascotPicker`  [INFERRED]
  apps/studio/public/mascots/5a.webp → apps/studio/src/components/MascotPicker.tsx
- `Mascot 6` --conceptually_related_to--> `MascotPicker`  [INFERRED]
  apps/studio/public/mascots/6a.webp → apps/studio/src/components/MascotPicker.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Numbered Mascot Navigation Cycle** — mascot_picker_component, mascot_1, mascot_2, mascot_3 [EXTRACTED 1.00]

## Communities (22 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (53): framer-motion, mediaUrl(), AdminPasswordModal(), close(), Props, selectRow(), NameControl, PendingRow() (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (55): ApiError, ApiErrorBody, apiUrl(), authFetch(), cancelQueuedJob(), createPreset(), deleteHistoryEntry(), deletePreset() (+47 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (35): ThemeIcon(), clamp(), OptionWheel(), OptionWheelItem, OptionWheelProps, MenuPos, ThemeSwitch(), Props (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (38): name, private, type, version, boneyard-js, @fontsource/ibm-plex-mono, @fontsource/inter, @fontsource-variable/archivo (+30 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (34): sonner, Estimate, getEstimate(), HistoryEntry, Preset, Props, HelpIcon(), UploadIcon() (+26 more)

### Community 5 - "Component Tests"
Cohesion: 0.07
Nodes (25): motion, page-mascot, @testing-library/jest-dom, @testing-library/react, vitest, GenerateButton(), ArrowLeftIcon(), ArrowRightIcon() (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (19): driver.js, react, react-dom, DEFAULT_SPRING, DockItem(), DockItemData, DockProps, DockSpringOptions (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (13): audioEngine, cache, compute(), getPeaks(), PeaksResult, proceduralPeaks(), wavSampleRate(), AudioActivityContext (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (20): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (19): dependencies, boneyard-js, driver.js, @fontsource/ibm-plex-mono, @fontsource/inter, @fontsource-variable/archivo, framer-motion, motion (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (14): listQueue(), QueueEntry, BootOverlay(), Props, GenerationActivityContext, GenerationActivityProvider(), GenerationActivityValue, BootStatus (+6 more)

### Community 11 - "Community 11"
Cohesion: 0.17
Nodes (14): @tanstack/query-sync-storage-persister, @tanstack/react-query-persist-client, HistoryFilters, HistoryPage, listHistory(), fetchHistoryPage(), HISTORY_CACHE_VERSION, HISTORY_GC_MS (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.19
Nodes (11): ogl, Props, Kbd(), Props, colour(), Rgb, SpecularButton(), SpecularButtonProps (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (13): devDependencies, jsdom, oxlint, @tailwindcss/cli, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react (+5 more)

### Community 15 - "Mascot Catalog"
Cohesion: 0.17
Nodes (12): Mascot 1, Mascot 2, Mascot 3, Mascot 4, Mascot 5, Mascot 6, Mascot 7, MascotPicker (+4 more)

### Community 16 - "Studio Scripts"
Cohesion: 0.17
Nodes (12): scripts, bones:build, build, dev, generate:mascot-catalog, lint, prebuild, predev (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.24
Nodes (9): CursorGrid(), CursorGridFalloff, CursorGridProps, FALLBACK, Point, Pulse, resolveCanvasColor(), Rgb (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.38
Nodes (6): Particle, ParticleText(), ParticleTextProps, ParticleTextTrigger, randomBetween(), resolveColor()

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

## Knowledge Gaps
- **169 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `name` (+164 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 219 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Community 6` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Component Tests`, `Community 7`, `Community 10`, `Community 13`, `Community 17`, `Community 18`?**
  _High betweenness centrality (0.220) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 9` to `Community 3`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `HistoryList()` connect `Community 1` to `Community 0`, `Community 11`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `$schema`, `plugins`, `react/rules-of-hooks` to the rest of the system?**
  _169 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0517503805175038 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.073224043715847 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06980392156862746 - nodes in this community are weakly interconnected._