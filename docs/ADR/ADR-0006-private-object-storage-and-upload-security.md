# ADR 0006: Private object storage

## Decision

Use a private S3-compatible MinIO bucket locally and S3-compatible private object storage in deployment.

## Consequences

Real upload and download flows will use short-lived signed URLs. Real supplier files never enter Git.
