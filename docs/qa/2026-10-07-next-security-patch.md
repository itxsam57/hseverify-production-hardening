# Next dependency security repair

Current-head independent audit37702053046 at a0f failed both npm production audit and full regression because new advisories affect the pinned Next16.3.7 package. The original FAILED report remains retained.

Pin Next, @next/env and eslint-config-next to16.3.8, preserving the existing React and other dependency versions. Raise the permanent dependency floor to16.3.8. This is the smallest available patch release; npm audit enforcement remains intact. No force-install, advisory exception or audit threshold reduction.

Acceptance requires current locked/installed versions, zero moderate-or-higher production audit findings, compiler/lint, actual private multi-role browser journeys, production build/preview and full regression at the final committed SHA. Earlier availability proof remains at16.3.7 until composed and rerun.
