# Decisions

Choices made where the spec (Doc 01 and Master Design §2) is silent, each with one line of reasoning, plus every change to a golden transcript and its reason. Christopher reviews this file at each checkpoint.

## Tooling

- **TypeScript 6.0, not 7.** typescript-eslint 8.72 supports TypeScript below 6.1. Move to 7 when it does.
- **pnpm 12 with a 14-day `minimumReleaseAge`.** A newly published package version can't be installed until it has been public for two weeks, which guards a new repository against compromised releases.
- **No build step.** Workspace packages export their TypeScript sources, and Node 24 strips types when it runs the conformance CLI, so the same files serve the Worker, Node and Vitest.

## Language and runtime

## Golden changes

None yet.

## Deferred

Features that came up and were left out because Doc 01 doesn't list them.
