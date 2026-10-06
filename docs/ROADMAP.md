# Roadmap

## Implemented in v0.1

- [x] TypeScript strict mode, Fastify, PostgreSQL, and SQL migrations
- [x] Registration, login, and current user
- [x] Organizations and database-backed roles
- [x] Scheduled events and capacity reads
- [x] Transactional holds, confirmation, and cancellation
- [x] Idempotency and concurrent capacity protection
- [x] Expiration worker and reservation audit records
- [x] Swagger UI, integration tests, Compose, and CI
- [x] English README and Turkish walkthrough
- [x] Minimal browser demo using the existing API
- [x] Owner/manager reservation and audit views with pagination and filters

## Suggested next iteration

- [ ] Refresh sessions with token rotation and revocation
- [ ] Membership removal and role updates with last-owner protection
- [ ] Waitlist promotion when cancellation releases seats
- [ ] Cursor pagination and reproducible load-test reports
- [ ] A scripted portfolio walkthrough

## Add only when the use case needs them

- [ ] Email notifications with a transactional outbox and retrying delivery worker
- [ ] Shared rate limiting for multiple API instances
- [ ] OpenTelemetry tracing and metrics
- [ ] Hosted demo with deployment-specific configuration
- [ ] Arbitrary time intervals and overlap rules for room booking

Keep each addition tied to a concrete failure scenario and a test. Finish and explain the reservation lifecycle before adding infrastructure.
