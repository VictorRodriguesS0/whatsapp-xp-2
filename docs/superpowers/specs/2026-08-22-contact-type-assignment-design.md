# Contact Type Assignment Design

**Date:** 2026-08-22
**Status:** Approved for implementation
**Scope:** Apply one contact type from the conversation inbox

## Goal

Let every active attendant classify a contact with zero or one active contact type while working in the inbox. The current type must be easy to see and change without opening the administrator settings page.

## Confirmed product rules

- A contact has at most one type.
- The attendant can select an active type or `Sem tipo`.
- All active attendants may read the active type catalog and change a contact's type.
- Only administrators may create, edit, reorder, or deactivate type definitions.
- An inactive type already assigned to a contact remains visible for historical clarity, but cannot be newly selected.
- Changing a type does not alter responsibility, read state, response state, reminders, tags, or WhatsApp/Meta state.

## Existing foundations

The database and domain already provide the nullable `Contact.contactTypeId` relation, seeded default types, administrator definition management, contact DTO classification data, validation for active definitions, and the authenticated `PATCH /api/contacts/:id` operation. No schema change or migration is required.

The implementation will extend the same inbox patterns already used for contact tags instead of creating a second classification subsystem.

## Architecture and API

### Active catalog

Add an authenticated attendant endpoint:

```text
GET /api/contact-types
```

It returns only active type definitions in stable administrator order using the standard success envelope. The contact repository gains a dedicated active-type query, and the service verifies that the actor is an active user before querying definitions. This endpoint does not grant access to administrator mutation operations.

### Assignment

Reuse the existing contact update operation:

```text
PATCH /api/contacts/:contactId
Content-Type: application/json

{ "contactTypeId": "<active-type-uuid>" }
```

Clearing the type sends:

```json
{ "contactTypeId": null }
```

The server remains authoritative. It rejects missing, inactive, malformed, or unauthorized choices through the existing safe error envelope and returns the updated contact DTO on success.

### Realtime reconciliation

The successful contact update continues publishing only the existing PII-free `contact.updated` event. Every session refreshes matching conversation rows, and the selected session refreshes the contact detail only when it still refers to that contact. No type name, contact identifier beyond the existing opaque contact ID, phone number, or other PII is added to realtime payloads.

Administrative `settings.updated` events with scope `contact-types`, and ordinary reconnect synchronization, reload the active type catalog.

## Inbox state

`useInbox` will expose:

- the ordered active type catalog;
- catalog loading and safe error state;
- one pending contact ID for type saves;
- a save error scoped to the affected contact;
- an explicit catalog retry action;
- `setContactType(contactId, contactTypeId | null): Promise<boolean>`.

The action suppresses duplicate submissions for the same contact. It updates every cached row for the returned contact and updates selected detail only when the selected contact still matches. A failure preserves the last server-confirmed type. Authentication failure follows the existing login navigation behavior; uncertain failures trigger authoritative reconciliation rather than optimistic state.

## Interface

### Customer panel

Add a `Tipo de contato` section above `Etiquetas` in both desktop and mobile customer panels.

The section contains:

- a compact textual/color marker for the currently assigned type;
- `Sem tipo` when no type is assigned;
- a directly visible select control with `Sem tipo` plus all active definitions;
- a short pending status and a safe inline error with retry behavior.

The select is disabled while its contact is saving or while the catalog is unavailable. A currently assigned inactive type is shown as historical state but is not offered as a new selectable active option. Selecting another value replaces it; selecting `Sem tipo` clears it.

### Conversation list

Show at most one compact textual/color type marker on each conversation row, visually distinct from the existing label chips. Invalid stored colors use the neutral safe fallback and are never passed through to unsafe CSS. Empty types render no marker.

The marker must not displace unread, overdue, responsibility, or response-state indicators. The 390×844 layout must retain no horizontal overflow and all interactive controls must remain at least 44 px high.

## Error handling and accessibility

- The server-confirmed value stays visible until a save succeeds.
- Failed saves leave the previous type intact and show `Não foi possível atualizar o tipo de contato.` without leaking provider or database details.
- Catalog load failures show `Não foi possível carregar os tipos de contato.` and an explicit retry action.
- A 429 response uses the shared request-throttling message.
- The select has an explicit accessible label and communicates disabled/pending state.
- Contact switches cannot apply a stale response or stale error to the newly selected contact.
- Reconnect and settings refreshes cannot overwrite a pending authoritative contact result with stale catalog state.

## Verification

TDD coverage will include:

1. active-user catalog authorization, stable ordering, active-only results, and safe route envelopes;
2. exact PATCH body for a type UUID and `null`, duplicate suppression, stale contact guards, safe failures, and authentication navigation;
3. cached row and selected-detail reconciliation after save and `contact.updated`;
4. customer-panel current, empty, inactive, pending, failure, retry, and clear states;
5. list marker visibility, color fallback, and coexistence with label chips and queue indicators;
6. reconnect and `settings.updated/contact-types` catalog refresh;
7. desktop and 390×844 browser acceptance, including a second session receiving the change without reload;
8. complete unit/integration suite, lint, TypeScript, Prisma validation, production build, dependency audit, immutable Linux image inspection, and real FFmpeg regression.

## Deployment

After all gates pass, create an immutable Linux/amd64 image labeled with the exact code revision. Take and validate a new production database/media backup, record the current application image and a deterministic non-app container snapshot, then recreate only `xp-whatsapp-app` with the canonical Compose file and `--no-deps --force-recreate --wait`.

Automatic rollback may recreate only the previous application image. PostgreSQL, Caddy, Meta subscriptions, DNS, networks, volumes, and unrelated containers must remain unchanged. Post-deploy verification requires exact revision/image/UID/networks, restart zero, unchanged database identity, migrations `9|0|0`, local/public health, protected routes, invalid webhook signature rejection, three soak samples, read-only Meta invariants, and a byte-identical non-app snapshot.

## Out of scope

- Multiple simultaneous contact types.
- Creating or editing type definitions from the inbox.
- Automatic classification or AI suggestions.
- Filtering the conversation list by type in this slice.
- Changing labels, reminders, preferred names, contact avatars, responsibility, or message behavior.
- Any Meta subscription or WhatsApp provider write.
