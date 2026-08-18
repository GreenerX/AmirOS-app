# Managed release-rollout contract

## Device entitlement addition

`POST /api/devices/entitlement` keeps its existing fields. It adds this object:

```json
{
  "release": {
    "action": "available",
    "channel": "beta",
    "version": "0.10.11",
    "downloadUrl": "https://example.com/AmirOS-0.10.11.zip",
    "sha256": "64-lowercase-hex-characters",
    "releaseNotesUrl": "https://example.com/releases/0.10.11"
  }
}
```

`action` is one of:

- `available`: all artifact fields except `releaseNotesUrl` are present.
- `hold`: no artifact fields are present; do not prompt or install.
- `none`: no artifact fields are present; do not prompt or install.

For revoked, paused, or setup-pending devices, the response supplies only `{ "action": "none", "channel": "…" }`.

## Local policy

For a configured managed install, only `action: "available"` may cause a manual update prompt, and only when the approved version is newer. `hold`, `none`, a missing release object, malformed data, or a failed Control Center release decision means **no prompt and no install**. Access to the local dashboard is unchanged.

Only unmanaged or Control-Center-unconfigured installs may retain the existing GitHub-latest updater path.

## Deployment order

1. Apply `202608180002_release_rollout_controls.sql`.
2. Deploy the Control Center functions and UI.
3. Enter a tested artifact but leave its channel on **Hold**.
4. Ship the local managed-beta package that consumes this additive field.
5. Complete clean-Mac and updater dry runs.
6. Explicitly make the intended channel available.

Rollback is setting the channel to **Hold**; never delete a release solely to stop prompts.
