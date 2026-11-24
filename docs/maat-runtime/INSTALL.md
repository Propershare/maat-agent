# Ma'at Runtime Development Release Candidate - Installation

## Status

This is a development release candidate, not a production release. It has not been published to GitHub.

## Prerequisites

- Linux x86_64
- Node.js 22.x
- npm
- Bubblewrap and user namespaces for the sandbox capability check

## Install

    cd /mnt/stash/clawd/maat-runtime-rc/bundle
    ./install.sh /tmp/maat-runtime-install

The installer copies the portable tarballs, installs the package graph, checks host security capabilities, and runs the installed smoke check.

## Verify

    node /tmp/maat-runtime-install/node_modules/@earendil-works/pi-coding-agent/dist/maat/cli.js --help

Expected CLI surface:

    usage: maat [status|identity|policy|events|apps]

The package manifest also exposes the maat binary.

## Installed layout

    /tmp/maat-runtime-install/node_modules/@earendil-works/pi-coding-agent/dist/maat/
    /tmp/maat-runtime-install/node_modules/@earendil-works/pi-coding-agent/dist/governance/

## Security

Do not use production Tehuti Guard credentials with this RC. The verified security path uses a disposable local HTTP fixture and test credentials only.

## Packaging notes

- The native package name is @earendil-works/pi-coding-agent because Ma'at is distributed through the Prime Agent package infrastructure.
- Ma'at modules are included in dist/maat and governance modules in dist/governance.
- The RC is intended for disposable development hosts and controlled evaluation.