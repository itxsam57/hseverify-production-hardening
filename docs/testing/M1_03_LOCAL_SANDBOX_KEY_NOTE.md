# M1.03 Owner Test — Local Sandbox Key Rule

For every M1.03 owner-test step that opens an authentication sandbox page, use the exact current value of:

```text
HSE_AUTH_SANDBOX_ACCESS_KEY
```

from the owner's active local `.env.local` file.

Do not assume that an example key written in a guide, prior chat or copied setup block matches an existing local environment. If `.env.local` is changed, restart the development server before retrying because validated server environment values are cached for the running process.

A `Sandbox access denied.` message means sandbox mode is disabled or the submitted key does not exactly match the running server environment. It is not evidence that a locked Worker account is forbidden from retrieving a recovery delivery.

This clarification was added after the 4 August 2026 M1.03 Section F owner test, where an incorrect key was supplied in the test instruction while the application and the owner's previously configured key were working correctly.
