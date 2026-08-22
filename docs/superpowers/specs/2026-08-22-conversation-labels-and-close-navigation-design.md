# Conversation labels and close navigation

Date: 2026-08-22
Status: approved for implementation

## Goal

Let any active attendant apply zero or more active labels to a contact from the open conversation, make those labels visible in daily inbox work, and let the user leave the selected conversation without changing its business state. Leaving a conversation only returns to the list; it does not archive, finish, delete, mark unread, or change responsibility.

## Scope

This slice includes:

- an authenticated read-only source of active label definitions for attendants;
- multi-label selection in the customer details panel and its mobile dialog;
- explicit save and safe retry behavior;
- label chips in the conversation list and customer details;
- realtime reconciliation when labels or label definitions change;
- desktop `Escape` behavior;
- mobile header-back and browser/device-back behavior;
- focus restoration and stale-conversation guards.

It does not add conversation statuses, archiving, reminders, contact types, preferred-name editing, or new Meta writes.

## Permissions and API

The existing administrative `/api/settings/contact-tags` routes remain admin-only and continue to own create, edit, and deactivate operations.

The new `GET /api/contact-tags` endpoint returns only active definitions, ordered by position and stable ID. Its domain service verifies that the authenticated actor still exists and is active before reading. The response uses the existing safe definition fields and never exposes provider identifiers or contact data.

Applying labels continues to use `PUT /api/contacts/:contactId/tags` with the complete selected ID set. The existing service validates a maximum of 20 unique UUIDs, accepts only active labels, replaces assignments atomically, publishes `contact.updated` after commit, and is available to active attendants and administrators.

## Inbox state and realtime behavior

`useInbox` loads active label definitions when the inbox mounts and exposes them with loading, mutation-pending, and safe error state. A successful save uses the authoritative contact returned by the API to update both the selected detail and every matching list row, then refreshes the list in the background.

Each mutation captures both contact ID and selected conversation ID. A late response may update matching cached contact data, but must not overwrite the newly selected conversation or its controls.

Realtime behavior is completed as follows:

- `contact.updated` refreshes the list and refreshes the open conversation only when its contact matches;
- `settings.updated` for contact labels reloads active definitions, refreshes the list, and refreshes the selected conversation;
- a reconnect sync reloads definitions alongside existing list, detail, and user refreshes.

If an assigned label is later deactivated, it remains visible on historical contact data as inactive, but it is not available for new selection. Saving a contact removes any inactive historical label not explicitly available in the active selection list only after the user confirms the new complete set; the dialog explains the resulting selection before save.

## User interface

The customer details panel gains an “Etiquetas” section. Current labels render as compact text chips with validated hexadecimal colors; color is supplementary and the label name is always visible. “Gerenciar etiquetas” opens an accessible dialog containing checkboxes for all active definitions and explicit Cancel/Save actions.

The same component is reused in the desktop side panel and the existing mobile customer-details dialog. Only one label editor can be active. It initializes from the currently selected contact, permits clearing all labels, disables duplicate submission, keeps the dialog open on failure, and restores focus to its trigger when closed.

Conversation rows show the first two label chips below their existing metadata and an accessible `+N` chip for additional labels. Empty label sets add no visual noise. All interactive targets remain at least 44 CSS pixels on touch layouts and the list keeps its compact height.

Safe user-facing failures distinguish an expired session from a retryable save/load problem. Session expiry navigates to login; other failures do not discard the user’s pending selection.

## Closing and navigation behavior

Desktop `Escape` closes the active conversation and restores focus to the exact conversation button. It does nothing when no conversation is selected. An open Radix dialog or other dismissible overlay gets the first `Escape`; the conversation closes only after the overlay is gone.

On mobile, opening the first thread from the list creates one same-URL history layer. Switching conversations while already in thread view replaces that layer instead of stacking additional entries. The header back button consumes the thread layer through `history.back()`, and a `popstate` consumes it by closing the thread, clearing the selected conversation, closing customer details, and restoring focus to the originating list item.

Opening the customer-details dialog on mobile creates a second same-URL history layer. Device/browser back closes that dialog first; a second back closes the thread. Closing via a visible dialog action consumes only the dialog layer. When a history API action cannot be used, the controls fall back to the same local close operations. On the conversation list, browser back retains its normal browser behavior.

History entries contain only opaque UI markers and no contact, phone, conversation, or message identifiers.

## Accessibility and edge cases

- Checkbox labels expose their visible names and selected state to assistive technology.
- Color swatches are decorative; text communicates identity.
- `Escape` listeners ignore repeated/composed events already handled by an overlay.
- Close operations abort the in-flight conversation request through the existing hook behavior.
- Focus restoration is scheduled after the mobile layout paints and is cancelled on unmount.
- A merged or deleted conversation cannot leave a stale history layer that reopens it.
- A label save response for contact A cannot change controls while conversation B is selected.

## Tests and release gates

Test-driven implementation must first demonstrate failing tests for:

- active-user label-definition read access and inactive/anonymous rejection;
- ordered active-only response envelopes;
- successful, failed, duplicate, empty-set, unauthorized, and stale label saves;
- authoritative list/detail contact updates and realtime refreshes;
- chips, overflow count, accessible checkbox dialog, focus restoration, and safe errors;
- desktop `Escape` priority and focus restoration;
- one thread history layer, one optional dialog layer, conversation switching without stacking, `popstate`, visible back controls, and list-level normal back behavior.

Before deployment, run focused tests through red/green, affected lint, TypeScript, the production build, and the full database-backed suite. Build an immutable Linux image, confirm FFmpeg/FFprobe and migration 006 remain present, take a validated production backup, recreate only `xp-whatsapp-app`, and verify health, restart count, migration state, protected routes, webhook rejection, Meta subscription read-only invariants, and a byte-identical snapshot of all non-app containers.

## Rollback

This slice adds no schema migration. The current production image remains the immediate app-only rollback target. Label assignments created through the already-deployed schema remain valid if the application binary is rolled back. No Meta, database, proxy, network, volume, or unrelated-container rollback is required.
