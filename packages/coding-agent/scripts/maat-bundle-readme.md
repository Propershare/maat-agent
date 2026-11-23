# Ma'at Runtime Portable Bundle

This bundle contains local tarballs for the four Ma'at Runtime packages and an installer that checks Node 22+, Bubblewrap, and unprivileged user namespaces before installation.

Run:

    ./install.sh /path/to/runtime

The installer uses the bundled local package tarballs for the Ma'at packages and does not require the unpublished @earendil-works/pi-agent-core registry version.

It fails closed if the required Linux isolation facilities are unavailable. It does not configure production services or alter Hermes.
