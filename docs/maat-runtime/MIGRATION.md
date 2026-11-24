# Migration

## From older Ma'at runtimes

This RC is an installable package beside an existing Ma'at installation. It does not replace the installed maat executable automatically.

## Steps

1. Install the RC into a separate directory.
2. Keep the existing Ma'at installation and credentials untouched.
3. Point a test host at the RC package directory.
4. Recreate Guard, broker, policy, and evidence configuration explicitly in the host application.
5. Run the installed three-agent, real-session, and security smokes.
6. Cut over only after a separate review.

## Method migration

The original 27 methods are preserved. Their process-file metadata now uses the relative art-of-research/ prefix instead of a laboratory backup path. The method IDs and titles are unchanged.

## Configuration migration

Older deployments may have absolute Guard, broker, and evidence paths. Replace those with host-local or injected values. The RC does not load production credentials implicitly.

## Not included

- Phase 3 domain migrations
- Automatic replacement of the installed maat binary
- Production Guard credential migration
- Organizational intake
