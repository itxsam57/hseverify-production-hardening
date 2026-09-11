# M1.03 Owner Hard Test — Worker Sign-In and Session Management PASS

Status: PASS

Owner acceptance date: 4 August 2026

Scope: M1.03 section E — Worker fixed-role sign-in and database-backed session management.

## Owner-confirmed result

The owner completed the Worker sign-in and session lifecycle test and confirmed that:

- the registered Worker signed in through the Worker portal;
- the Worker Dashboard loaded and the session persisted across refresh;
- the account sessions page listed the current Worker session;
- a second sign-in created a second independent session;
- both sessions were visible to the same account;
- the normal browser revoked the other session;
- the revoked browser was denied on its next protected request and returned to Worker login;
- the remaining browser session stayed active;
- no role switching was used or exposed.

## Security boundary covered

This owner test confirms the browser-visible behavior of:

- fixed-role Worker authentication;
- opaque database-backed session resolution;
- multiple active sessions per account;
- account-owned session listing;
- revocation of another owned session;
- next-request denial after revocation;
- preservation of the non-revoked session.

## Gate effect

- M1.03 section E is owner accepted.
- The next owner hard-test section is Worker lockout and password recovery.
- M1.04 remains blocked until the complete M1.03 owner hard test passes.
