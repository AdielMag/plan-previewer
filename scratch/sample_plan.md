# Add rate limiting to the API gateway

**Goal:** Prevent a single client from overwhelming downstream services by enforcing per-route request limits at the gateway.

## Context

- Auth middleware already exists at `gateway/middleware/auth.go` — limiter will sit just before it in the chain.

## Plan

### 1. Token bucket middleware

- [x] Add `RateLimiter` middleware in `gateway/middleware/ratelimit.go`
- [ ] Support per-route limits via config (`routes.yaml`)
- [ ] Return `429` with a `Retry-After` header on rejection

### 2. Observability

- [ ] Emit a `gateway.ratelimit.rejected` metric, tagged by route
- [ ] Add a panel to the gateway Grafana dashboard
