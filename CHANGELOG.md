# Changelog

All notable changes to Ignition are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, a minor release (0.x.0) may include breaking changes.

## [Unreleased]

Working toward **0.1.0 — Phase 1 ("Spark")**: the Level 1 interpreter, the golden-transcript conformance suite and the browser IDE. The release gate is in the [implementation plan](docs/ignition-implementation-plan.md#gate).

### Added

- Design documents:
  - [Master Design](docs/ignition-00-master-design.md): the language, the compiler pipeline, the IDE and the phase plan.
  - [Doc 01 — Phase 1 Semantics](docs/ignition-01-phase1-semantics.md): the exact Phase 1 rules, with test vectors for number formatting, `ROUND` and the random-number generator.
  - [Implementation plan](docs/ignition-implementation-plan.md): the phases, their build order and their gates.
  - [Phase 1 kickoff prompt](docs/ignition-kickoff-prompt.md): the brief for the coding agent that builds Phase 1.
- Repository basics: README, MIT license, this changelog, `.gitignore`, and `.nvmrc` pinning Node 24.
- Design for six period dialects (Microsoft 8K BASIC, TRS-80 Level II, Commodore BASIC V2, Applesoft, Sinclair BASIC, Palo Alto Tiny BASIC) and a Games library of David Ahl's *BASIC Computer Games*, planned for after Phase 2 ([Master Design §9](docs/ignition-00-master-design.md#9-period-dialects)).

### Changed

- The README calls the project Ignition BASIC.

[Unreleased]: https://github.com/cschweda/ignition-basic/commits/main
