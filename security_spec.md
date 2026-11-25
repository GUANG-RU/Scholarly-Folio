# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict Multi-Tenant Isolation**: A user can only read, list, create, update, or delete `/users/{userId}` and its subcollections (`topics`, `notes`, `course_refs`) when `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **PII Isolation**: `email` only lives on `/users/{userId}`. `allow list` on `/users` is strictly denied (`false`), and `share_bundles` / `items` never store `email`.
3. **System Inbox Protection**: A topic with `isSystemInbox == true` cannot be deleted or converted into a regular topic (`incoming().isSystemInbox == existing().isSystemInbox`).
4. **Relational Sync & Atomicity**: Notes require an existing (or batch-created `existsAfter`) topic under `/users/{userId}/topics/{topicId}`. Course references require an existing note. Share bundle items require `getAfter` ownership match on `/share_bundles/{slug}`.
5. **High-Entropy Public Sharing**: `/share_bundles/{slug}` disables unauthenticated `list` scraping; `get` requires a valid slug of 16–64 URL-safe characters.
6. **Temporal Integrity**: `createdAt` and `updatedAt` are strictly validated against `request.time`; `createdAt` and `userId` are immutable after creation.

## 2. The "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)
1. Unauthenticated read of `/users/uid-1`
2. Authenticated user `uid-2` attempting `get` or `list` on `/users/uid-1/notes`
3. Unverified email user (`email_verified: false`) attempting `create` on `/users/uid-1/notes/note-1`
4. Shadow field injection (`isAdmin: true`) on `/users/uid-1` creation
5. Identity spoofing (`userId: "uid-2"`) on `/users/uid-1/notes/note-1`
6. Oversized path variable ID (`"a".repeat(200)`) on `/users/uid-1/topics/{id}`
7. Deleting the system `Inbox` topic (`isSystemInbox: true`)
8. Creating a note referencing a non-existent `topicId`
9. Client-forged `createdAt` or `updatedAt` timestamp not equal to `request.time`
10. Invalid `course_refs` URL (`javascript:alert(1)`) or non-whitelisted provider
11. Unauthenticated `list` query across `/share_bundles`
12. Creating a `share_bundles/{slug}` with a weak/short slug (`"abc"`) or updating an immutable `share_bundles/{slug}`
