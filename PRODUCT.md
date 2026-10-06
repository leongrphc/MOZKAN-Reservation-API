# MOZKAN

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner is building a GitHub portfolio project to demonstrate backend skills slightly above entry level. The demo lets an evaluator act as an organization owner or member.

## Product Purpose

Manage fixed-capacity event reservations safely when requests compete, repeat, expire, or cancel. The small web screen makes the existing API directly usable.

## Capabilities and Constraints

TypeScript and Node.js are confirmed requirements. The existing application uses Fastify and PostgreSQL. It implements organizations, roles, events, holds, confirmation, cancellation, and an expiration worker. Owners and managers can read organization-wide bookings and audit history through explicitly protected management endpoints; members see their own reservations. Waitlists and email notifications remain outside this iteration.

## Brand Commitments

The product name is MOZKAN. The user explicitly requests a basic frontend with little time spent on visual design. Turkish UI copy follows the user's language; this is an implementation assumption.

## Product Principles

- Keep backend behavior visible through working user actions.
- Use a simple page and standard forms.
- Make capacity, reservation state, and errors understandable.
- Keep the frontend dependency footprint small.

## Evidence on Hand

Real PostgreSQL API tests and deterministic demo accounts exist in this repository. Display data must come from the API; demo accounts only work after local seeding.
