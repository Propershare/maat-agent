# Source and Secret Review

## Reviewed scope

Untracked Ma'at source under packages/coding-agent/src/maat and Ma'at tests under packages/coding-agent/test was reviewed for the RC.

## Laboratory paths

Absolute Imhotep backup paths were removed from research-methods.ts. Process-file metadata now uses the relative art-of-research/ prefix. The original 27 method IDs and titles were preserved.

## Secret scan

Patterns scanned included API keys, passwords, tokens, private keys, home-directory paths, private IPv4 ranges, OpenClaw, and Hermes.

Findings:

- No production credential was found in the Ma'at source.
- Test fixtures contain the literal values test-token, test-machine, test-identity-secret, and local in-memory secrets. These are disposable fixtures, not credentials.
- No laboratory home directory path remains in research-methods.ts.
- Local test endpoints use 127.0.0.1 only.
- No production Guard endpoint is embedded.

## Dependencies

No OpenClaw or Hermes runtime import was found in the Ma'at source. The package remains based on the Prime Agent package and its declared dependencies.

## Licensing

The upstream MIT license is copied into the RC as LICENSE. Upstream copyright and package attribution are preserved in THIRD_PARTY_NOTICES.md.

## Version control

The untracked files have not been committed. No Git history was altered.
